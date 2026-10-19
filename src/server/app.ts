// The routes: HTTP for joining and acting, a WebSocket for watching. Identity
// is always the raid_sid cookie the server minted (CLAUDE.md rule 3), never a
// name or id in a request body. The battle rules decide; this file only turns
// their answers into status codes.

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
} from "../shared/protocol.ts";
import { newId, type Store } from "./db.ts";
import { mountPages } from "./pages.ts";
import { ROLE_IDS, ROLES } from "../shared/protocol.ts";
import { checkAction, checkJoin, checkSeatEcho, cleanName, createBattle, isRole, nameKey, type Battle } from "./rules.ts";
import type { Table } from "./table.ts";

const COOKIE = "raid_sid";
const ONE_YEAR_S = 60 * 60 * 24 * 365;
const RECENT_BATTLES = 10;

/** The database keeps a hash of the session, never the cookie itself. */
const sessionKey = (sid: string): string => createHash("sha256").update(sid).digest("base64url");

const fail = (c: Context, status: 400 | 403 | 404 | 409, error: string) =>
  c.json({ error } satisfies ErrorResponse, status);

/** The body as a JSON object, or null if it isn't one. */
async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function createApp(root: string, store: Store, table: Table): Hono {
  const app = new Hono();

  mountPages(app, root);

  app.get("/api/raid", (c) => c.json(table.publicRaid() satisfies RaidResponse));

  app.post("/api/battles", (c) => c.json({ battleId: table.create() } satisfies NewBattleResponse, 201));

  /**
   * Seat the caller in a battle: a battle's join and a room's are this one
   * function. The answer is the seat, or the refusal to send as it is.
   */
  /** A join body's name and role, or the refusal to answer with. */
  function seatRequest(c: Context, body: Record<string, unknown> | null): { name: string; role: RoleId } | Response {
    if (!body) return fail(c, 400, "Send a JSON object with a name and a role.");
    const name = cleanName(body.name);
    if (!name) return fail(c, 400, "A name is 1 to 24 characters, with no control characters.");
    if (!isRole(body.role)) return fail(c, 400, `Choose a role: ${ROLE_IDS.slice(0, -1).join(", ")} or ${ROLE_IDS.at(-1)}.`);
    return { name, role: body.role };
  }

  /**
   * Whether the cookie's person (`known`, or nobody yet) may sit in `battle`
   * under this name and role: the refusal to send, "already" if they're in it,
   * or null. No awaits, no writes: the room door asks it before minting a room,
   * and the seat asks it again just before seating (review R3).
   */
  function vetSeat(c: Context, known: ReturnType<Store["characterBySession"]>, name: string, role: RoleId, battle: Battle): Response | "already" | null {
    // A name is for life, a role is for a fight (rule 24). The app tells people
    // apart by name, so a character's name stays with its cookie: it never
    // sits down under another (re-review N2). Its role may change between
    // fights, but seated at another live table it sits down here as the same
    // role (review R1). Either way it keeps its record.
    if (known && nameKey(name) !== nameKey(known.name)) {
      return fail(c, 409, `You sat down as ${known.name}, and a name stays with you: sit down as ${known.name}.`);
    }
    if (known && role !== known.role && table.seatedElsewhere(known.id, battle.id)) {
      return fail(c, 409, `You're seated at another table as ${known.name} the ${ROLES[known.role].label}; sit down here as the same role, or finish that fight first.`);
    }
    const check = checkJoin(battle, known?.id ?? null, known ? known.name : name);
    if (check === "already") return known ? "already" : null;
    return check ? fail(c, check.status, check.error) : null;
  }

  /** Seat the cookie's person in the fight `where()` names once the body is read (null: the room went). */
  async function seatIn(c: Context, where: () => string | null, preread?: { name: string; role: RoleId }): Promise<JoinResponse | Response> {
    const asked = preread ?? seatRequest(c, await readJson(c));
    if (asked instanceof Response) return asked;
    const { name } = asked;
    const body = { role: asked.role };

    // No awaits from here on: the check and the seat see the same battle. Which
    // battle is asked only now, after the body: a room's fight can end, and its
    // next one open, while the body is in flight (breaker Q10).
    const id = where();
    if (id === null) return fail(c, 404, "No such room.");
    const battle = table.get(id);
    if (!battle) return store.battle(id) ? fail(c, 409, "This fight is already over.") : fail(c, 404, "No such battle.");

    const sid = getCookie(c, COOKIE);
    const known = sid ? store.characterBySession(sessionKey(sid)) : null;
    const vetted = vetSeat(c, known, name, body.role, battle);
    if (vetted === "already" && known) return { battleId: id, characterId: known.id, character: known };
    if (vetted instanceof Response) return vetted;
    const seatName = known ? known.name : name;

    // A cookie the database doesn't know is never adopted: mint a fresh one.
    const session = known && sid ? sid : randomBytes(32).toString("base64url");
    const characterId = known?.id ?? newId();
    table.seat(id, { id: characterId, sessionId: sessionKey(session), name: seatName, role: body.role });

    if (session !== sid) {
      setCookie(c, COOKIE, session, {
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
    if (table.behindCode(id)) return fail(c, 404, "No such battle.");
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
    if (body && ("name" in body || "role" in body)) {
      const asked = seatRequest(c, body);
      if (asked instanceof Response) return asked;
      // A founder refused a seat makes no room (review R3): vet the seat against an empty fight, unsaved, first.
      const sid = getCookie(c, COOKIE);
      const refused = vetSeat(c, sid ? store.characterBySession(sessionKey(sid)) : null, asked.name, asked.role, createBattle("unminted", false, Date.now()));
      if (refused instanceof Response) return refused;
      const room = table.createRoom();
      const seat = await seatIn(c, () => table.room(room.code)?.battleId ?? null, asked);
      if (seat instanceof Response) return seat;
      return c.json({ ...seat, code: room.code } satisfies RoomJoinResponse, 201);
    }
    const sid = getCookie(c, COOKIE);
    if (!sid || !store.characterBySession(sessionKey(sid))) return fail(c, 403, "Sit down at a table before you make a room.");
    const { code, battleId } = table.createRoom();
    return c.json({ code, battleId } satisfies NewRoomResponse, 201);
  });

  app.get("/api/rooms/:code", (c) => {
    const room = table.room(c.req.param("code"));
    return room ? c.json(room satisfies RoomResponse) : fail(c, 404, "No such room.");
  });

  app.post("/api/rooms/:code/join", async (c) => {
    const code = c.req.param("code");
    const room = table.room(code);
    if (!room) return fail(c, 404, "No such room.");
    const seat = await seatIn(c, () => table.room(code)?.battleId ?? null);
    return seat instanceof Response ? seat : c.json({ ...seat, code: room.code } satisfies RoomJoinResponse);
  });

  app.post("/api/rooms/:code/echoes", async (c) => {
    const code = c.req.param("code");
    if (!table.room(code)) return fail(c, 404, "No such room.");
    const body = await readJson(c);
    if (!body) return fail(c, 400, "Send a JSON object with a role.");

    // No awaits from here on: the check and the seat see the same battle,
    // the room's fight as it is now the body is in (breaker Q10).
    const room = table.room(code);
    if (!room) return fail(c, 404, "No such room.");
    const battle = table.get(room.battleId);
    if (!battle) return fail(c, 409, "This fight is already over.");
    const sid = getCookie(c, COOKIE);
    const callerId = sid ? table.characterFor(sessionKey(sid)) : undefined;
    if (!callerId) return fail(c, 403, "Only someone seated at this table can seat an Echo here.");

    const refused = checkSeatEcho(battle, callerId, body.role);
    if (refused) return fail(c, refused.status, refused.error);
    const echoId = table.seatEcho(room.battleId, body.role as RoleId, callerId);
    return c.json({ code: room.code, battleId: room.battleId, echoId } satisfies EchoResponse, 201);
  });

  app.get("/api/battles/:id", (c) => {
    if (table.behindCode(c.req.param("id"))) return fail(c, 404, "No such battle.");
    const state = table.state(c.req.param("id"));
    return state ? c.json(state) : fail(c, 404, "No such battle.");
  });

  app.post("/api/battles/:id/actions", async (c) => {
    const body = await readJson(c);
    if (!body) return fail(c, 400, "Send a JSON object with an action.");

    // No awaits from here on: the check and the turn see the same battle.
    const id = c.req.param("id");
    const battle = table.get(id);
    const sid = getCookie(c, COOKIE);
    const actorId = sid ? table.characterFor(sessionKey(sid)) : undefined;
    // A private room's fight answers only someone seated in it; to anyone else holding its id it doesn't
    // exist, as its state, log, join and socket already say (rule 22; breaker Q5).
    if (table.behindCode(id) && !(battle && actorId && [...battle.standing, ...battle.fallen].some((f) => f.id === actorId))) {
      return fail(c, 404, "No such battle.");
    }
    if (!battle) return store.battle(id) ? fail(c, 409, "This fight is over.") : fail(c, 404, "No such battle.");
    if (!actorId) return fail(c, 403, "You aren't standing in this fight.");

    // Rejected here means dropped: nothing is stored, deferred or replayed (rule 2).
    const checked = checkAction(battle, actorId, body.action, body.targetId);
    if ("status" in checked) return fail(c, checked.status, checked.error);

    const tick = table.act(id, actorId, checked.action, checked.targetId);
    return c.json({ ok: true, tick } satisfies ActionResponse);
  });

  app.get("/api/battles/:id/log", (c) => {
    const id = c.req.param("id");
    // Readable by id once it's over (rule 26), not while a private room is playing it.
    if (table.behindCode(id)) return fail(c, 404, "No such battle.");
    const battle = store.battle(id);
    if (!battle) return fail(c, 404, "No such battle.");
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
      return {
        onOpen(_event, ws) {
          if (!table.watch(query, ws)) ws.close(4404, query.room !== undefined ? "No such room." : "No such battle.");
        },
        onClose(_event, ws) {
          table.unwatch(ws);
        },
      };
    }),
  );

  app.notFound((c) => c.json({ error: "Not found." } satisfies ErrorResponse, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "Something went wrong at the table." } satisfies ErrorResponse, 500);
  });

  return app;
}
