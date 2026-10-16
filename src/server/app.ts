// The routes: HTTP for joining and acting, a WebSocket for watching. Identity
// is always the raid_sid cookie the server minted (CLAUDE.md rule 3), never a
// name or id in a request body, and a body that names another seat is refused
// (docs/adr/008). The battle rules decide; this file only turns their answers
// into status codes. Every refusal on the two routes that change a fight goes
// out through refuse(), which logs it (src/server/log.ts) before answering.

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
  NewBattleResponse,
  RaidResponse,
} from "../shared/protocol.ts";
import { newId, type Store } from "./db.ts";
import { refused, type Refused } from "./log.ts";
import { mountPages } from "./pages.ts";
import { checkAction, checkJoin, cleanName, isRole } from "./rules.ts";
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

/** The refusal path: one log line for the refused request, then the answer. */
function refuse(c: Context, r: Refused & { status: 400 | 403 | 404 | 409 }) {
  refused(r);
  return fail(c, r.status, r.reason);
}

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

  mountPages(app, root);

  app.get("/api/raid", (c) => c.json({ battleId: table.publicRaid() } satisfies RaidResponse));

  app.post("/api/battles", (c) => c.json({ battleId: table.create() } satisfies NewBattleResponse, 201));

  app.post("/api/battles/:id/join", async (c) => {
    const body = await readJson(c);
    // No awaits from here on: the check and the seat see the same battle.
    const id = c.req.param("id");
    const battle = table.get(id);
    const sid = getCookie(c, COOKIE);
    const session = sid ? sessionKey(sid) : null;
    const known = session ? store.characterBySession(session) : null;
    const room = battle || store.battle(id) ? id : null;
    const no = (status: 400 | 403 | 404 | 409, reason: string, as?: unknown) =>
      refuse(c, { route: "join", battle, room, session, seat: known?.id ?? null, person: known ?? undefined, name: body?.name, as, status, reason });

    if (!body) return no(400, "Send a JSON object with a name and a role.");
    const as = otherSeat(body, known?.id ?? null);
    if (as !== undefined) return no(403, "You can only take your own seat.", as);
    const name = cleanName(body.name);
    if (!name) return no(400, "A name is 1 to 24 characters, with no control characters.");
    if (!isRole(body.role)) return no(400, "Choose a role: bulwark, lancer, mender or herald.");
    if (!battle) return room ? no(409, "This fight is already over.") : no(404, "No such battle.");

    const check = checkJoin(battle, known?.id ?? null, name);
    if (check === "already" && known) {
      return c.json({ battleId: id, characterId: known.id, character: known } satisfies JoinResponse);
    }
    if (check && check !== "already") return no(check.status, check.error);

    // A cookie the database doesn't know is never adopted: mint a fresh one.
    const cookie = known && sid ? sid : randomBytes(32).toString("base64url");
    const characterId = known?.id ?? newId();
    table.seat(id, { id: characterId, sessionId: sessionKey(cookie), name, role: body.role });

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
    return c.json({ battleId: id, characterId, character } satisfies JoinResponse);
  });

  app.get("/api/battles/:id", (c) => {
    const state = table.state(c.req.param("id"));
    return state ? c.json(state) : fail(c, 404, "No such battle.");
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
    const session = sid ? sessionKey(sid) : null;
    const actorId = (session && table.characterFor(session)) || null;
    const room = battle || store.battle(id) ? id : null;
    const no = (status: 400 | 403 | 404 | 409, reason: string, as?: unknown) =>
      refuse(c, { route: "action", battle, room, session, seat: actorId, action: body?.action, target: body?.targetId, as, status, reason });

    if (!body) return no(400, "Send a JSON object with an action.");
    const as = otherSeat(body, actorId);
    if (as !== undefined) return no(403, "You can only act for your own seat.", as);
    if (!battle) return room ? no(409, "This fight is over.") : no(404, "No such battle.");
    if (!actorId) return no(403, "You aren't standing in this fight.");

    const checked = checkAction(battle, actorId, body.action, body.targetId);
    if ("status" in checked) return no(checked.status, checked.error);

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
      const id = c.req.query("battle") ?? "";
      return {
        onOpen(_event, ws) {
          if (!table.watch(id, ws)) ws.close(4404, "No such battle.");
        },
        onClose(_event, ws) {
          table.unwatch(id, ws);
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
