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
import { ROLES } from "../shared/protocol.ts";
import { checkAction, checkJoin, checkSeatEcho, cleanName, isRole, nameKey } from "./rules.ts";
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
  async function seatIn(c: Context, id: string): Promise<JoinResponse | Response> {
    const body = await readJson(c);
    if (!body) return fail(c, 400, "Send a JSON object with a name and a role.");
    const name = cleanName(body.name);
    if (!name) return fail(c, 400, "A name is 1 to 24 characters, with no control characters.");
    if (!isRole(body.role)) return fail(c, 400, "Choose a role: bulwark, lancer, mender or herald.");

    // No awaits from here on: the check and the seat see the same battle.
    const battle = table.get(id);
    if (!battle) return store.battle(id) ? fail(c, 409, "This fight is already over.") : fail(c, 404, "No such battle.");

    const sid = getCookie(c, COOKIE);
    const known = sid ? store.characterBySession(sessionKey(sid)) : null;
    // A character (name, role, record) persists across rooms (rule 24): seated
    // at another live table, it sits down here as the same name and role, or
    // not at all, never as someone else (review R1). Seated nowhere, a person
    // may come back under a new name or role, and the character takes it.
    const elsewhere = known !== null && table.seatedElsewhere(known.id, id);
    if (known && elsewhere && (nameKey(name) !== nameKey(known.name) || body.role !== known.role)) {
      return fail(c, 409, `You're seated at another table as ${known.name} the ${ROLES[known.role].label}; sit down here as them.`);
    }
    const seatName = known && elsewhere ? known.name : name;
    const check = checkJoin(battle, known?.id ?? null, seatName);
    if (check === "already" && known) return { battleId: id, characterId: known.id, character: known };
    if (check && check !== "already") return fail(c, check.status, check.error);

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
    const seat = await seatIn(c, c.req.param("id"));
    return seat instanceof Response ? seat : c.json(seat);
  });

  // Rooms (docs/adr/007): a code is the only key, and a wrong one is a 404.
  app.post("/api/rooms", (c) => {
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
    const room = table.room(c.req.param("code"));
    if (!room) return fail(c, 404, "No such room.");
    const seat = await seatIn(c, room.battleId);
    return seat instanceof Response ? seat : c.json({ ...seat, code: room.code } satisfies RoomJoinResponse);
  });

  app.post("/api/rooms/:code/echoes", async (c) => {
    const room = table.room(c.req.param("code"));
    if (!room) return fail(c, 404, "No such room.");
    const body = await readJson(c);
    if (!body) return fail(c, 400, "Send a JSON object with a role.");

    // No awaits from here on: the check and the seat see the same battle.
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
    const state = table.state(c.req.param("id"));
    return state ? c.json(state) : fail(c, 404, "No such battle.");
  });

  app.post("/api/battles/:id/actions", async (c) => {
    const body = await readJson(c);
    if (!body) return fail(c, 400, "Send a JSON object with an action.");

    // No awaits from here on: the check and the turn see the same battle.
    const id = c.req.param("id");
    const battle = table.get(id);
    if (!battle) return store.battle(id) ? fail(c, 409, "This fight is over.") : fail(c, 404, "No such battle.");

    const sid = getCookie(c, COOKIE);
    const actorId = sid ? table.characterFor(sessionKey(sid)) : undefined;
    if (!actorId) return fail(c, 403, "You aren't standing in this fight.");

    // Rejected here means dropped: nothing is stored, deferred or replayed (rule 2).
    const checked = checkAction(battle, actorId, body.action, body.targetId);
    if ("status" in checked) return fail(c, checked.status, checked.error);

    const tick = table.act(id, actorId, checked.action, checked.targetId);
    return c.json({ ok: true, tick } satisfies ActionResponse);
  });

  app.get("/api/battles/:id/log", (c) => {
    const id = c.req.param("id");
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
