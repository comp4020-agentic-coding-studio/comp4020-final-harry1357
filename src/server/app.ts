// The routes: HTTP for joining and acting, a WebSocket for watching. Identity
// is always the raid_sid cookie the server minted (CLAUDE.md rule 3), never a
// name or id in a request body, and a body that names another seat is refused
// (docs/adr/008). The battle rules decide; this file only turns their answers
// into status codes. Every refusal, on every route, goes out through refuse(),
// which logs it (src/server/log.ts) before answering: one line per refusal
// (rule 32), held for every route by spec/refusals.test.ts. Each route makes a
// `no` from refusal() with what it knows of the request, and nothing else here
// answers a refusal.

import { upgradeWebSocket } from "@hono/node-server";
import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { createHash, randomBytes } from "node:crypto";
import type {
  ActionResponse,
  ErrorResponse,
  JoinResponse,
  LogResponse,
  MeResponse,
  EchoResponse,
  NewBattleResponse,
  NewRoomResponse,
  RaidResponse,
  RoleId,
  RoomJoinResponse,
  RoomResponse,
  StartResponse,
} from "../shared/protocol.ts";
import { newId, type Store } from "./db.ts";
import { refused, type Refused, type Route } from "./log.ts";
import { mountPages } from "./pages.ts";
import { ROLE_IDS, ROLES } from "../shared/protocol.ts";
import { checkAction, checkJoin, checkSeatEcho, checkStart, cleanName, createBattle, isRole, nameKey, type Battle } from "./rules.ts";
import type { Table } from "./table.ts";

const COOKIE = "raid_sid";
const ONE_YEAR_S = 60 * 60 * 24 * 365;
const RECENT_BATTLES = 10;

/** The database keeps a hash of the session, never the cookie itself. */
const sessionKey = (sid: string): string => createHash("sha256").update(sid).digest("base64url");

type Status = 400 | 403 | 404 | 409;

/** The body as a JSON object, or null if it isn't one. */
async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The refusal path, and the only answer a refusal gets: one log line for the refused request, then the answer. */
function refuse(c: Context, r: Refused & { status: Status }) {
  refused(r);
  return c.json({ error: r.reason } satisfies ErrorResponse, r.status);
}

/** A route's refusal: what it knows of the request, so each refusal is logged with it. */
type No = (status: Status, reason: string, more?: Partial<Omit<Refused, "status" | "reason">>) => Response;

/** The names a request body might give a seat by (docs/adr/008). */
const SEAT_FIELDS = ["seatId", "characterId", "actorId"] as const;

/** A seat the body names that isn't the session's own, or undefined if it names none or only its own. */
function otherSeat(body: Record<string, unknown>, own: string | null): unknown {
  for (const field of SEAT_FIELDS) {
    const named = body[field];
    if (named !== undefined && named !== null && named !== own) return named;
  }
  return undefined;
}

export function createApp(root: string, store: Store, table: Table): Hono {
  const app = new Hono();

  /**
   * A `no` for this request on this route. The session and its seat come from the cookie; a battle or a room is
   * named only once the server recognises it, so nothing a request smuggled is written (rule 32).
   */
  function refusal(c: Context, route: Route, where: { battleId?: string | null; code?: string | null; action?: unknown; target?: unknown; name?: unknown } = {}): No {
    const sid = getCookie(c, COOKIE);
    const session = sid ? sessionKey(sid) : null;
    const seat = session ? (table.characterFor(session) ?? store.characterBySession(session)?.id ?? null) : null;
    const known = session ? store.characterBySession(session) : null;
    const battle = where.battleId ? table.get(where.battleId) : undefined;
    const room = where.battleId && (battle || store.battle(where.battleId)) ? where.battleId : null;
    const code = where.code ? (table.room(where.code)?.code ?? null) : null;
    return (status, reason, more = {}) =>
      refuse(c, {
        route,
        battle,
        room,
        code,
        session,
        seat,
        person: known ? { name: known.name, role: known.role } : undefined,
        action: where.action,
        target: where.target,
        name: where.name,
        status,
        reason,
        ...more,
      });
  }

  mountPages(app, root);

  app.get("/api/raid", (c) => c.json(table.publicRaid() satisfies RaidResponse));

  app.post("/api/battles", (c) => c.json({ battleId: table.create() } satisfies NewBattleResponse, 201));

  /**
   * Seat the caller in a battle: a battle's join and a room's are this one
   * function. The answer is the seat, or the refusal to send as it is.
   */
  /** A join body's name and role, or the refusal to answer with. */
  function seatRequest(no: No, body: Record<string, unknown> | null, own: string | null): { name: string; role: RoleId } | Response {
    if (!body) return no(400, "Send a JSON object with a name and a role.");
    // Your own seat only: a body naming another is refused before anything else is looked at (rule 29; ADR-008).
    const as = otherSeat(body, own);
    if (as !== undefined) return no(403, "You can only take your own seat.", { as });
    const name = cleanName(body.name);
    if (!name) return no(400, "A name is 1 to 24 characters, with no control characters.");
    if (!isRole(body.role)) return no(400, `Choose a role: ${ROLE_IDS.slice(0, -1).join(", ")} or ${ROLE_IDS.at(-1)}.`);
    return { name, role: body.role };
  }

  /**
   * Whether the cookie's person (`known`, or nobody yet) may sit in `battle`
   * under this name and role: the refusal to send, "already" if they're in it,
   * or null. No awaits, no writes: the room door asks it before minting a room,
   * and the seat asks it again just before seating (review R3).
   */
  function vetSeat(no: No, known: ReturnType<Store["characterBySession"]>, name: string, role: RoleId, battle: Battle): Response | "already" | null {
    // A name is for life, a role is for a fight (rule 24). The app tells people
    // apart by name, so a character's name stays with its cookie: it never
    // sits down under another (re-review N2). Its role may change between
    // fights, but seated at another live table it sits down here as the same
    // role (review R1). Either way it keeps its record.
    if (known && nameKey(name) !== nameKey(known.name)) {
      return no(409, `You sat down as ${known.name}, and a name stays with you: sit down as ${known.name}.`);
    }
    if (known && role !== known.role && table.seatedElsewhere(known.id, battle.id)) {
      return no(409, `You're seated at another table as ${known.name} the ${ROLES[known.role].label}; sit down here as the same role, or finish that fight first.`);
    }
    const check = checkJoin(battle, known?.id ?? null, known ? known.name : name);
    if (check === "already" && known && role !== known.role) {
      // Seated here already: a role is for a fight, so it isn't changed mid-fight, and asking says so (breaker Q9).
      return no(409, `You're seated at this table already, as ${known.name} the ${ROLES[known.role].label}.`);
    }
    if (check === "already") return known ? "already" : null;
    return check ? no(check.status, check.error) : null;
  }

  /** Seat the cookie's person in the fight `where()` names once the body is read (null: the room went). */
  async function seatIn(c: Context, where: () => string | null, preread?: { name: string; role: RoleId }, code: string | null = null): Promise<JoinResponse | Response> {
    const own = (() => {
      const sid = getCookie(c, COOKIE);
      return sid ? (store.characterBySession(sessionKey(sid))?.id ?? null) : null;
    })();
    const body = preread ? null : await readJson(c);
    const early = refusal(c, "join", { code, name: body?.name });
    const asked = preread ?? seatRequest(early, body, own);
    if (asked instanceof Response) return asked;
    const { name, role } = asked;

    // No awaits from here on: the check and the seat see the same battle. Which
    // battle is asked only now, after the body: a room's fight can end, and its
    // next one open, while the body is in flight (breaker Q10).
    const id = where();
    const no = refusal(c, "join", { battleId: id, code, name });
    if (id === null) return no(404, "No such room.");
    const battle = table.get(id);
    if (!battle) return store.battle(id) ? no(409, "This fight is already over.") : no(404, "No such battle.");

    const sid = getCookie(c, COOKIE);
    const known = sid ? store.characterBySession(sessionKey(sid)) : null;
    const vetted = vetSeat(no, known, name, role, battle);
    if (vetted === "already" && known) return { battleId: id, characterId: known.id, character: known };
    if (vetted instanceof Response) return vetted;
    const seatName = known ? known.name : name;

    // A cookie the database doesn't know is never adopted: mint a fresh one.
    const cookie = known && sid ? sid : randomBytes(32).toString("base64url");
    const characterId = known?.id ?? newId();
    table.seat(id, { id: characterId, sessionId: sessionKey(cookie), name: seatName, role });

    if (cookie !== sid) {
      setCookie(c, COOKIE, cookie, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: ONE_YEAR_S,
        secure: c.req.header("x-forwarded-proto")?.split(",")[0]?.trim() === "https",
      });
    }
    const character = store.character(characterId);
    if (!character) throw new Error(`character ${characterId} was seated but not written`);
    return { battleId: id, characterId, character };
  }

  app.post("/api/battles/:id/join", async (c) => {
    // A private room's fight is joined by its code, never by its id (rule 22; review R4).
    const id = c.req.param("id");
    if (table.behindCode(id)) return refusal(c, "join")(404, "No such battle.");
    const seat = await seatIn(c, () => id);
    return seat instanceof Response ? seat : c.json(seat);
  });

  // Rooms (docs/adr/007): a code is the only key, and a wrong one is a 404.
  app.post("/api/rooms", async (c) => {
    // With a name and a role, asking for a room is sitting down in it: the room
    // is made and its founder seated, which is how someone new makes one (they
    // have no character to be a seated player with yet). Without them, only a
    // seated player may ask (rule 22).
    const body = await readJson(c);
    const sid = getCookie(c, COOKIE);
    const known = sid ? store.characterBySession(sessionKey(sid)) : null;
    const no = refusal(c, "room", { name: body?.name });
    if (body && ("name" in body || "role" in body)) {
      const asked = seatRequest(no, body, known?.id ?? null);
      if (asked instanceof Response) return asked;
      // A founder refused a seat makes no room (review R3): vet the seat against an empty fight, unsaved, first.
      const vetted = vetSeat(no, known, asked.name, asked.role, createBattle("unminted", false, Date.now()));
      if (vetted instanceof Response) return vetted;
      const room = table.createRoom();
      const seat = await seatIn(c, () => table.room(room.code)?.battleId ?? null, asked, room.code);
      if (seat instanceof Response) return seat;
      return c.json({ ...seat, code: room.code } satisfies RoomJoinResponse, 201);
    }
    if (!known) return no(403, "Sit down at a table before you make a room.");
    // A seated player's room seats them in it as its host (rule 27; breaker B4), under their name and role
    // (rule 24), vetted against an empty fight before anything is minted, as a founder's is.
    const vetted = vetSeat(no, known, known.name, known.role, createBattle("unminted", false, Date.now()));
    if (vetted instanceof Response) return vetted;
    const room = table.createRoom();
    const seat = await seatIn(c, () => table.room(room.code)?.battleId ?? null, { name: known.name, role: known.role }, room.code);
    if (seat instanceof Response) return seat;
    return c.json({ code: room.code, battleId: seat.battleId } satisfies NewRoomResponse, 201);
  });

  app.get("/api/rooms/:code", (c) => {
    const room = table.room(c.req.param("code"));
    return room ? c.json(room satisfies RoomResponse) : refusal(c, "read")(404, "No such room.");
  });

  app.post("/api/rooms/:code/join", async (c) => {
    const code = c.req.param("code");
    const room = table.room(code);
    if (!room) return refusal(c, "join")(404, "No such room.");
    const seat = await seatIn(c, () => table.room(code)?.battleId ?? null, undefined, room.code);
    return seat instanceof Response ? seat : c.json({ ...seat, code: room.code } satisfies RoomJoinResponse);
  });

  /** The room's fight now and the caller's character, for the lobby's routes, with the route's `no`; or the refusal sent. */
  function lobbyCall(c: Context, route: Route): { battle: Battle; callerId: string; code: string; no: No } | Response {
    const room = table.room(c.req.param("code") ?? "");
    if (!room) return refusal(c, route)(404, "No such room.");
    const no = refusal(c, route, { battleId: room.battleId, code: room.code });
    const battle = table.get(room.battleId);
    if (!battle) return no(409, "This fight is already over.");
    const sid = getCookie(c, COOKIE);
    const callerId = sid ? table.characterFor(sessionKey(sid)) : undefined;
    if (!callerId) return no(403, "Only someone seated at this table can do that.");
    return { battle, callerId, code: room.code, no };
  }

  // The host's Start (rule 27). Synchronous from the lookup to the step, so the
  // one process orders it against a join landing at the same moment (rule 10).
  app.post("/api/rooms/:code/start", (c) => {
    const call = lobbyCall(c, "start");
    if (call instanceof Response) return call;
    const refused = checkStart(call.battle, call.callerId);
    if (refused) return call.no(refused.status, refused.error);
    table.startFight(call.battle.id, call.callerId);
    return c.json({ ok: true, battleId: call.battle.id } satisfies StartResponse);
  });

  // Leaving a lobby (rule 27): unseated, and the host passes on.
  app.post("/api/rooms/:code/leave", (c) => {
    const call = lobbyCall(c, "leave");
    if (call instanceof Response) return call;
    if (!table.leave(call.battle.id, call.callerId)) return call.no(409, "You aren't seated in this room's lobby.");
    return c.json({ ok: true, battleId: call.battle.id } satisfies StartResponse);
  });

  app.post("/api/rooms/:code/echoes", async (c) => {
    const code = c.req.param("code");
    if (!table.room(code)) return refusal(c, "echo")(404, "No such room.");
    const body = await readJson(c);

    // No awaits from here on: the check and the seat see the same battle,
    // the room's fight as it is now the body is in (breaker Q10).
    const room = table.room(code);
    if (!room) return refusal(c, "echo")(404, "No such room.");
    const no = refusal(c, "echo", { battleId: room.battleId, code: room.code });
    if (!body) return no(400, "Send a JSON object with a role.");
    const battle = table.get(room.battleId);
    if (!battle) return no(409, "This fight is already over.");
    const sid = getCookie(c, COOKIE);
    const callerId = sid ? table.characterFor(sessionKey(sid)) : undefined;
    if (!callerId) return no(403, "Only someone seated at this table can seat an Echo here.");

    const refused = checkSeatEcho(battle, callerId, body.role);
    if (refused) return no(refused.status, refused.error);
    const echoId = table.seatEcho(room.battleId, body.role as RoleId, callerId);
    return c.json({ code: room.code, battleId: room.battleId, echoId } satisfies EchoResponse, 201);
  });

  app.get("/api/battles/:id", (c) => {
    if (table.behindCode(c.req.param("id"))) return refusal(c, "read")(404, "No such battle.");
    const state = table.state(c.req.param("id"));
    return state ? c.json(state) : refusal(c, "read")(404, "No such battle.");
  });

  // The one place an action enters, and so the one place ADR-008 is checked:
  // the seat is the cookie's, a body naming any other is refused before the
  // turn is looked at, and checkAction holds the role's catalogue and the
  // target. Rejected here means dropped: nothing is stored, deferred or
  // replayed (rule 2).
  app.post("/api/battles/:id/actions", async (c) => {
    const body = await readJson(c);
    // No awaits from here on: the check and the turn see the same battle.
    const id = c.req.param("id");
    const battle = table.get(id);
    const sid = getCookie(c, COOKIE);
    const actorId = sid ? table.characterFor(sessionKey(sid)) : undefined;
    // A private room's fight answers only someone seated in it; to anyone else holding its id it doesn't
    // exist, as its state, log, join and socket already say (rule 22; breaker Q5). Its line names no fight.
    const behind = table.behindCode(id) && !(battle && actorId && [...battle.standing, ...battle.fallen].some((f) => f.id === actorId));
    const no = refusal(c, "action", { battleId: behind ? null : id, code: behind ? null : battle?.room, action: body?.action, target: body?.targetId });
    if (behind) return no(404, "No such battle.");
    if (!body) return no(400, "Send a JSON object with an action.");
    // Your own seat only: a body naming another seat is refused before the turn is looked at (rule 29; ADR-008).
    const as = otherSeat(body, actorId ?? null);
    if (as !== undefined) return no(403, "You can only act for your own seat.", { as });
    if (!battle) return store.battle(id) ? no(409, "This fight is over.") : no(404, "No such battle.");
    if (!actorId) return no(403, "You aren't standing in this fight.");

    const checked = checkAction(battle, actorId, body.action, body.targetId);
    if ("status" in checked) return no(checked.status, checked.error);

    const tick = table.act(id, actorId, checked.action, checked.targetId);
    return c.json({ ok: true, tick } satisfies ActionResponse);
  });

  app.get("/api/battles/:id/log", (c) => {
    const id = c.req.param("id");
    // Readable by id once it's over (rule 26), not while a private room is playing it.
    if (table.behindCode(id)) return refusal(c, "read")(404, "No such battle.");
    const battle = store.battle(id);
    if (!battle) return refusal(c, "read")(404, "No such battle.");
    return c.json({ battleId: id, status: battle.status, entries: store.log(id) } satisfies LogResponse);
  });

  app.get("/api/me", (c) => {
    const sid = getCookie(c, COOKIE);
    const character = sid ? store.characterBySession(sessionKey(sid)) : null;
    const battles = character ? store.battlesOf(character.id, RECENT_BATTLES) : [];
    return c.json({ character, battles } satisfies MeResponse);
  });

  // State flows one way, server to browser. Anything a client sends is ignored.
  app.get(
    "/ws",
    upgradeWebSocket((c) => {
      const query = { battle: c.req.query("battle"), room: c.req.query("room") };
      // Whose socket it is, for a lobby's presence only (rule 27); still nothing a client sends is read.
      const sid = getCookie(c, COOKIE);
      const session = sid ? sessionKey(sid) : null;
      return {
        onOpen(_event, ws) {
          if (!table.watch(query, ws, session)) ws.close(4404, query.room !== undefined ? "No such room." : "No such battle.");
        },
        onClose(_event, ws) {
          table.unwatch(ws);
        },
      };
    }),
  );

  // A path nothing serves is a refused request too, and logged like one (rule 32).
  app.notFound((c) => refusal(c, "read")(404, "Not found."));
  // A crash isn't a refusal: its trace goes to stderr (rule 32), and the answer says only that it failed.
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Something went wrong at the table." } satisfies ErrorResponse, 500);
  });

  return app;
}
