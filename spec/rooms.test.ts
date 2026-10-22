import Database from "better-sqlite3";
import { afterAll, afterEach, describe, expect, inject, it } from "vitest";
import { boot, cleanScratch, scratchDatabase, type Booted } from "./boot.ts";
import {
  act,
  battleLog,
  createRoom,
  join,
  joinRoom,
  me,
  newBattle,
  raid,
  room,
  seatEcho,
  sleep,
  startRoom,
  suffix,
  token,
  watch,
  watchRoom,
  type BattleState,
  type Event,
  type Watcher,
} from "./raid.ts";

// Rooms (docs/adr/007; CLAUDE.md rules 22-24 and 26). A room is a short code
// the server mints for a seated player, private until shared, with no owner
// and no account behind it. The public raid is a permanent room, always
// open, and the default door. Each room has its own fight, queue and
// broadcast; a character persists across rooms and the seat is per room.
// Rooms expire after fifteen minutes empty; finished fights' logs don't.
//
// The live tests run against the app like the rest of spec/. A seated player
// is made by sitting down in a bare battle of the test's own, so nothing here
// takes a seat in the shared public raid. The two that need the public raid
// itself, or a room's expiry, boot their own server with a short window.
const base = inject("baseUrl");

const open: Watcher[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});
afterAll(cleanScratch);

function watching(at: string, code: string): Watcher {
  const w = watchRoom(at, code);
  open.push(w);
  return w;
}

/** A session that has sat down somewhere, and so has a character: a seated player (rule 22). */
async function seatedPlayer(at: string, role = "warden") {
  const name = `host-${suffix()}`;
  const battleId = await newBattle(at);
  const seat = await join(at, battleId, name, role);
  if (seat.status !== 200 || !seat.characterId) throw new Error(`a bare battle refused a seat (${seat.status})`);
  return { ...seat, name, role, characterId: seat.characterId, battleId };
}

/** A room made by a seated player, or a failure saying what the server answered. */
async function madeRoom(at: string, cookie: string): Promise<{ code: string; battleId: string }> {
  const made = await createRoom(at, cookie);
  expect(made.status, "POST /api/rooms from a seated player makes a room (201)").toBe(201);
  expect(made.code, "and answers its code").toEqual(expect.any(String));
  expect(made.battleId, "and the room's fight").toEqual(expect.any(String));
  return { code: made.code as string, battleId: made.battleId as string };
}

/** The first event from index `from` on that satisfies `test`. */
async function eventFrom(w: Watcher, test: (ev: Event) => boolean, what: string, timeoutMs: number, from = 0): Promise<Event> {
  for (const deadline = Date.now() + timeoutMs; ; await sleep(25)) {
    const found = w.events.slice(from).find(test);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`waited ${timeoutMs}ms for ${what}; saw ${w.events.length - from} event(s)`);
  }
}

describe("a room is a code", () => {
  it("creating a room returns a code", async () => {
    const host = await seatedPlayer(base);
    const made = await madeRoom(base, host.cookie);
    expect(made.code, "a room's code is short enough to read out").toMatch(/^[A-Za-z0-9]{4,8}$/);

    const found = await room(base, made.code);
    expect(found.status, "the code finds the room").toBe(200);
    expect(found.room, "a private room, holding the fight it was made with").toMatchObject({
      code: made.code,
      isPublic: false,
      battleId: made.battleId,
    });

    const another = await madeRoom(base, host.cookie);
    expect(another.code, "every room gets a code of its own").not.toBe(made.code);
    expect(another.battleId, "and a fight of its own").not.toBe(made.battleId);

    // A room is made by someone who has sat down, not by anyone who asks.
    expect((await createRoom(base, "")).status, "no session: no room").toBe(403);
    expect((await createRoom(base, "raid_sid=made-up")).status, "a cookie the server never minted: no room").toBe(403);
  });

  it("someone new creates a room by sitting down in it", async () => {
    // Phase two's "create a room" door: a newcomer has no character, so a room
    // can't be asked for first and sat in after. Asking with a name and a role
    // is sitting down: the room is made and its creator seated in it, one
    // request, and they are then a seated player like any other (rule 22).
    const name = `founder-${suffix()}`;
    const res = await fetch(new URL("/api/rooms", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role: "chronist" }),
    });
    expect(res.status, "a name and a role make a room and a seat").toBe(201);
    const made = (await res.json()) as { code?: string; battleId?: string; characterId?: string };
    expect(made.code, "with its code").toEqual(expect.any(String));
    expect(made.characterId, "and the founder's character").toEqual(expect.any(String));
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    expect(cookie, "the founder is given a session").not.toBe("");
    const w = watching(base, made.code as string);
    const st = await w.waitFor((s) => token(s, made.characterId as string) !== undefined, "the founder on the new room's strip", 5_000);
    expect(token(st, made.characterId as string)?.name, "seated under the name given").toBe(name);
    // Still no room from nothing: no session and no seat asked for.
    expect((await createRoom(base, "")).status, "no session, no name: no room").toBe(403);
    const bad = await fetch(new URL("/api/rooms", base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "", role: "chronist" }),
    });
    expect(bad.status, "a seat asked for with no name is refused, and makes no room").toBe(400);
  });

  it("joining with a wrong code is refused", async () => {
    const host = await seatedPlayer(base);
    const made = await madeRoom(base, host.cookie);

    // A code one letter off the real one (rule 22: never guessed at, never redirected).
    const last = made.code.at(-1) as string;
    const wrong = made.code.slice(0, -1) + (last === "Q" ? "W" : "Q");
    const refused = await joinRoom(base, wrong, `lost-${suffix()}`, "mender");
    expect(refused.status, "a wrong code is refused").toBe(404);
    expect(refused.cookie, "and the refusal mints no session").toBe("");
    expect((await room(base, wrong)).status, "and describes no room").toBe(404);
    // Breaker Q1: the code is matched as typed letters and digits, any case,
    // and nothing else: padding, or a Unicode letter that upper-cases onto
    // one ("raıd" with a dotless i becomes "RAID"), is a different string.
    expect((await room(base, made.code.toLowerCase())).status, "the code in lower case is the code").toBe(200);
    expect((await room(base, ` ${made.code} `)).status, "a padded code is not the code").toBe(404);
    expect((await room(base, "ra\u0131d")).status, "a dotless i doesn't upper-case into the public raid").toBe(404);

    // The right code, from a stranger with no cookie, gets in.
    const right = await joinRoom(base, made.code, `found-${suffix()}`, "mender");
    expect(right.status, "the right code seats you").toBe(200);
    expect(right.battleId, "in that room's fight").toBe(made.battleId);
    const w = watching(base, made.code);
    const st = await w.waitFor((s) => token(s, right.characterId) !== undefined, "the new seat on the room's strip", 5_000);
    expect(st.queue.some((t) => t.name.startsWith("lost-")), "the wrong code seated nobody in the right room").toBe(false);
  });
});

describe("a refusal says what's true", () => {
  it("a refused role names the roles there are", async () => {
    // Breaker Q3: the refusal still listed the four roles from before the
    // overhaul, none of which a join accepts.
    const res = await fetch(new URL(`/api/battles/${await newBattle(base)}/join`, base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `roleless-${suffix()}`, role: "herald" }),
    });
    expect(res.status, "a role that isn't one is refused").toBe(400);
    const { error } = (await res.json()) as { error: string };
    for (const role of ["warden", "mender", "striker", "breaker", "chronist"]) expect(error, `the refusal names the ${role}`).toContain(role);
    for (const gone of ["bulwark", "lancer", "herald"]) expect(error, `and not the ${gone}, who's gone`).not.toContain(gone);
  });
});

describe("the code is the only key", () => {
  it("a private room's fight is reachable only through its code, and nothing lists rooms or owns one", async () => {
    // Review R4: the fight was reachable by its battle id too, seated, watched
    // and read by anyone holding the id, and every state carried the code.
    // Review R10: nothing held "nothing lists rooms, nothing owns one".
    const host = await seatedPlayer(base);
    const made = await madeRoom(base, host.cookie);

    expect((await fetch(new URL(`/api/battles/${made.battleId}`, base))).status, "its state isn't served by battle id").toBe(404);
    expect((await fetch(new URL(`/api/battles/${made.battleId}/log`, base))).status, "nor its log, while it lasts").toBe(404);
    const byId = await join(base, made.battleId, `sidedoor-${suffix()}`, "mender");
    expect(byId.status, "nobody sits down by battle id").toBe(404);
    expect(byId.cookie, "and the refusal mints no session").toBe("");
    // The battle socket opens first, then someone sits down by the code, which
    // the fight broadcasts: a socket subscribed silently would get that
    // (re-review N4: checked before anything in the fight broadcast, a held-back
    // first state passed).
    const peek = watch(base, made.battleId);
    open.push(peek);
    const seat = await joinRoom(base, made.code, `frontdoor-${suffix()}`, "mender");
    expect(seat.status, "the code still seats you").toBe(200);
    await sleep(750);
    expect(peek.states.length, "nobody watches it by battle id, not even the seat it broadcast").toBe(0);

    // The public raid isn't a secret, and today's client reaches it by battle id.
    const door = await raid(base);
    expect((await fetch(new URL(`/api/battles/${door.battleId}`, base))).status, "the public raid's fight stays open by id").toBe(200);

    // Nothing lists rooms, and a room names no owner.
    expect((await fetch(new URL("/api/rooms", base))).status, "no route lists the rooms").toBe(404);
    const found = await room(base, made.code);
    expect(Object.keys(found.room ?? {}).sort(), "a room is its code, whether it's public, and its fight: no owner").toEqual([
      "battleId",
      "code",
      "isPublic",
    ]);
  });
});

describe("the public raid", () => {
  let server: Booted | null = null;
  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  it("the public raid always exists and is the default join", async () => {
    // Its own server, so the public raid's seat is the test's, and with a short
    // room window, so "never expires" is measured rather than assumed.
    server = await boot(scratchDatabase(), { TICK_MS: "20", ROOM_EMPTY_MS: "400" });
    const door = await raid(server.base);
    expect(door.code, "/api/raid names the public raid's room code").toEqual(expect.any(String));
    expect(door.battleId, "and its fight now").toEqual(expect.any(String));

    const found = await room(server.base, door.code as string);
    expect(found.status, "the public raid is a room like any other").toBe(200);
    expect(found.room, "a public one, holding the fight the door names").toMatchObject({
      code: door.code,
      isPublic: true,
      battleId: door.battleId,
    });

    // Empty for well past the room window, and still there, with the same code.
    await sleep(1_500);
    const later = await raid(server.base);
    expect(later.code, "the public raid's code never changes").toBe(door.code);
    expect((await room(server.base, door.code as string)).status, "and it never expires").toBe(200);

    // The default door seats you in the public raid's fight.
    const seat = await joinRoom(server.base, door.code as string, `walk-in-${suffix()}`, "striker");
    expect(seat.status, "anyone arriving can sit down at the default door").toBe(200);
    expect(seat.battleId, "in the public raid's fight").toBe(later.battleId);
  }, 20_000);
});

describe("nothing crosses between rooms", () => {
  it("an action in room A changes nothing in room B's queue", async () => {
    const host = await seatedPlayer(base);
    const a = await madeRoom(base, host.cookie);
    const b = await madeRoom(base, host.cookie);
    const s = suffix();
    const alice = await joinRoom(base, a.code, `alice-${s}`, "striker");
    expect(alice.status, "alice sits in room A").toBe(200);

    // Two clients, one in each room, both probed.
    const wa = watching(base, a.code);
    const wb = watching(base, b.code);
    await Promise.all([wa.opened, wb.opened]);

    // Room A starts on its host's Start (rule 27): alice is its first person
    // seated, so she is its host. Then it's Alice's turn.
    expect((await startRoom(base, a.code, alice.cookie)).status, "alice, room A's host, starts its fight").toBe(200);
    await wa.waitFor((st) => st.activeId === alice.characterId, "alice's turn in room A", 25_000);

    // Bob sits in room B only now, so room B is a lobby while Alice strikes:
    // a lobby's clock moves nothing and broadcasts nothing. Anything room B's socket carries from here on came from
    // somewhere else (review R17: comparing B's members alone passed if A's
    // action moved B's counters or order).
    const bob = await joinRoom(base, b.code, `bob-${s}`, "breaker");
    expect(bob.status, "bob sits in room B").toBe(200);
    const bSeated = await wb.waitFor((st) => token(st, bob.characterId) !== undefined, "bob on room B's strip", 5_000);
    expect(bSeated.status, "room B is still a lobby, waiting on its host").toBe("waiting");
    const bQuiet = wb.messages.length;
    const bRooms = wb.rooms.length;

    const fromA = wa.events.length;
    const struck = await act(base, a.battleId, alice.cookie, "jab");
    expect(struck.status, "alice strikes in room A").toBe(200);
    await eventFrom(wa, (ev) => ev.kind === "jab" && ev.actorId === alice.characterId, "alice's Jab on room A's socket", 5_000, fromA);
    await sleep(750); // several ticks for anything stray to reach room B

    expect(wb.messages.length - bQuiet, "room B's socket carried nothing while alice struck: no state, no event, no tick").toBe(0);
    expect(wb.rooms.length - bRooms, "and no room message either").toBe(0);
    expect(wb.states.at(-1), "room B's fight is exactly as bob's seat left it").toEqual(bSeated);
    // Read afresh, not only as broadcast (re-review, R17): a change to B made
    // without a broadcast would show here, in a new socket's first state.
    const fresh = watching(base, b.code);
    const now = await fresh.waitFor(() => true, "room B's state, read afresh", 5_000);
    expect(now, "room B, read afresh after alice struck, is as bob's seat left it").toEqual(bSeated);
    expect(wb.events.some((ev) => ev.actorId === alice.characterId), "nothing alice did ever reached room B").toBe(false);
    expect(wb.states.every((st) => !st.queue.some((t) => t.id === alice.characterId)), "alice never appears on room B's strip").toBe(true);
    expect(wb.states.every((st) => st.battleId === b.battleId), "room B's socket only carried room B's fight").toBe(true);

    // A seat acts only in its own room. To someone not seated in it, a private room's fight doesn't exist
    // by its id at all (rule 22; phase two's gate, Q5): the same 404 as an id nobody has.
    const cross = await act(base, b.battleId, alice.cookie, "jab");
    expect(cross.status, "alice's seat is in room A; room B's fight is no fight to her").toBe(404);
  }, 45_000);

  it("the same character seated in two rooms is two seats and one record", async () => {
    const host = await seatedPlayer(base, "striker");
    const a = await madeRoom(base, host.cookie);
    const b = await madeRoom(base, host.cookie);
    const inA = await joinRoom(base, a.code, host.name, host.role, host.cookie);
    // One character, so one name and one role (review R1, R15): seated in room
    // A, it can't sit down in room B as someone else.
    expect((await joinRoom(base, b.code, `other-${suffix()}`, host.role, host.cookie)).status, "not under another name").toBe(409);
    expect((await joinRoom(base, b.code, host.name, "mender", host.cookie)).status, "not as another role").toBe(409);
    const inB = await joinRoom(base, b.code, host.name, host.role, host.cookie);
    expect([inA.status, inB.status], "one character sits down in both rooms").toEqual([200, 200]);
    expect(inA.characterId, "as the same character in room A").toBe(host.characterId);
    expect(inB.characterId, "and in room B").toBe(host.characterId);
    const turnsBefore = (await me(base, host.cookie)).character?.turns ?? 0;

    const wa = watching(base, a.code);
    const wb = watching(base, b.code);
    await Promise.all([wa.opened, wb.opened]);
    const id = host.characterId;
    // The host of both lobbies starts each fight (rule 27).
    for (const r of [a, b]) expect((await startRoom(base, r.code, host.cookie)).status, `the host starts room ${r.code}`).toBe(200);
    const [sa, sb] = await Promise.all([
      wa.waitFor((st) => token(st, id) !== undefined, "the seat on room A's strip", 5_000),
      wb.waitFor((st) => token(st, id) !== undefined, "the seat on room B's strip", 5_000),
    ]);
    expect(sa.battleId, "two rooms, two fights").not.toBe(sb.battleId);

    // Two seats: each takes its own turn, in its own room.
    async function playOnce(w: Watcher, battleId: string, what: string): Promise<void> {
      await w.waitFor((st) => st.activeId === id, `the character's turn in ${what}`, 25_000);
      const res = await act(base, battleId, host.cookie, "jab");
      expect(res.status, `the seat in ${what} takes its turn`).toBe(200);
    }
    await Promise.all([playOnce(wa, a.battleId, "room A"), playOnce(wb, b.battleId, "room B")]);
    await sleep(300);

    // One record: both turns land in it.
    const record = (await me(base, host.cookie)).character;
    expect(record?.id, "one character behind both seats").toBe(id);
    expect([record?.name, record?.role], "under the name and role it sat down with").toEqual([host.name, host.role]);
    expect(record?.turns, "both seats' turns are in the one record").toBe(turnsBefore + 2);
  }, 45_000);
});

describe("a name is for life, a role is for a fight", () => {
  let server: Booted | null = null;
  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  it("between fights a person may change role, keeping their name and record, and may not change name", async () => {
    // Rule 24 (the owner's decision on re-review N2): the app tells people
    // apart by name, so a character's name stays with its cookie for life; its
    // role may change between fights. A restart puts the person between fights:
    // fights don't survive one, characters do (rule 6).
    const db = scratchDatabase();
    server = await boot(db, { TICK_MS: "5" });
    const name = `lifer-${suffix()}`;
    const first = await newBattle(server.base);
    const seat = await join(server.base, first, name, "striker");
    expect(seat.status, "sits down as a Striker").toBe(200);
    const w = watch(server.base, first);
    open.push(w);
    await w.waitFor((st) => st.activeId === seat.characterId, "the Striker's turn", 20_000);
    expect((await act(server.base, first, seat.cookie, "jab")).status, "takes a turn, so the record has something in it").toBe(200);
    const before = (await me(server.base, seat.cookie)).character;
    expect(before?.turns, "one turn on the record").toBe(1);
    w.close();
    await server.kill();

    server = await boot(db, { TICK_MS: "5" });
    // Seated nowhere now. A new name, even between fights: refused, and
    // nothing renamed.
    const rename = await join(server.base, await newBattle(server.base), `renamed-${suffix()}`, "striker", seat.cookie);
    expect(rename.status, "a name is for life: a rename between fights is refused").toBe(409);
    expect((await me(server.base, seat.cookie)).character?.name, "the character still has its name").toBe(name);

    // Still seated nowhere. A new role under the same name: allowed, the same character.
    const rerole = await join(server.base, await newBattle(server.base), name, "warden", seat.cookie);
    expect(rerole.status, "between fights, a new role is allowed").toBe(200);
    expect(rerole.characterId, "as the same character").toBe(before?.id);
    const after = (await me(server.base, seat.cookie)).character;
    expect([after?.name, after?.role], "the name kept, the role changed").toEqual([name, "warden"]);
    expect(after?.turns, "and the record carried over").toBe(before?.turns);
  }, 60_000);
});

describe("rooms expire; logs don't", () => {
  let server: Booted | null = null;
  afterEach(async () => {
    await server?.kill();
    server = null;
  });

  it("a room empty for fifteen minutes is gone, and its finished fight's log is not", async () => {
    // Fifteen minutes is ROOM_EMPTY_MS; here three seconds. A fast clock, a short
    // turn and a short beat, and four Echoes beside one person who never acts,
    // so the fight plays itself to an ending (rule 25) in seconds, not minutes.
    // After the fight the room returns to its lobby with the host still seated
    // (rule 27); a host with no socket on it has left after LOBBY_GRACE_MS,
    // short here, and only then is the room empty.
    const WINDOW_MS = 3_000;
    server = await boot(scratchDatabase(), {
      TICK_MS: "5",
      TURN_TIMEOUT_MS: "150",
      ECHO_BEAT_MS: "10",
      ROOM_EMPTY_MS: String(WINDOW_MS),
      LOBBY_GRACE_MS: "1500",
    });
    const at = server.base;
    const host = await seatedPlayer(at);
    const made = await madeRoom(at, host.cookie);
    expect((await joinRoom(at, made.code, host.name, host.role, host.cookie)).status, "the host sits down in the room").toBe(200);
    for (const role of ["mender", "striker", "breaker", "chronist"]) {
      expect((await seatEcho(at, made.code, host.cookie, role)).status, `a ${role} Echo takes a seat`).toBe(201);
    }

    const w = watching(at, made.code);
    await w.opened;
    expect((await startRoom(at, made.code, host.cookie)).status, "the host starts the fight (rule 27)").toBe(200);
    const ended = await w.waitFor(
      (st) => st.battleId === made.battleId && ["won", "lost", "abandoned"].includes(st.status),
      "the room's fight to finish",
      100_000,
    );
    expect(ended.status, "the fight finished: won or lost, not abandoned by the room going away").toMatch(/^(won|lost)$/);

    // The room's next fight is a lobby with the host carried into it (rule 27); with no socket of theirs on
    // the room they have left it once the grace is up, and then it has nobody in it. Inside the window, the
    // room is still there.
    await sleep(1_500 + WINDOW_MS / 3);
    expect((await room(at, made.code)).status, "a room isn't gone before its window is up").toBe(200);
    // Re-review N1: the finished fight, read by its id, carried the code of the
    // room, still open. While the room is open, its fights stay behind the code.
    expect((await fetch(new URL(`/api/battles/${made.battleId}`, at))).status, "the finished fight isn't read by id while its room is open").toBe(404);
    expect((await fetch(new URL(`/api/battles/${made.battleId}/log`, at))).status, "nor its log, yet").toBe(404);

    // Past the window, it is.
    await sleep(WINDOW_MS + 1_500);
    expect((await room(at, made.code)).status, "an empty room is gone once its window is up").toBe(404);
    expect((await joinRoom(at, made.code, `late-${suffix()}`, "mender")).status, "and its code seats nobody").toBe(404);

    // The finished fight's log outlives the room.
    const log = await battleLog(at, made.battleId);
    expect(log.status, "the finished fight is still on record").toBe(ended.status);
    const lines = log.entries as { kind: string }[];
    expect(lines.some((l) => l.kind === "end"), "with its log, to the last line").toBe(true);
  }, 130_000);

  it("a bare battle nobody sits in goes the same way", async () => {
    // Breaker B1: POST /api/battles, which needs no cookie, made a fight that
    // nobody could find without its id and that never went away: a private
    // room with no code, no seated player behind it, and no expiry (rules 22,
    // 26). A bare battle with no person seated is closed on the room window.
    server = await boot(scratchDatabase(), { TICK_MS: "20", ROOM_EMPTY_MS: "1500" });
    const empty = await newBattle(server.base);
    const host = await seatedPlayer(server.base);
    // Inside the window it is still open (re-review N5: only checked after it,
    // a sweep that closed an empty bare battle at once passed).
    await sleep(500);
    const early = (await (await fetch(new URL(`/api/battles/${empty}`, server.base))).json()) as { status: string };
    expect(early.status, "an empty bare battle inside the window is still open").toBe("waiting");
    await sleep(2_500);
    const late = await join(server.base, empty, `late-${suffix()}`, "mender");
    expect(late.status, "an empty bare battle past the window seats nobody").toBe(409);
    const log = await battleLog(server.base, empty);
    expect(log.status, "it was closed").toBe("abandoned");
    expect((log.entries as { kind: string }[]).some((l) => l.kind === "end"), "with a line saying so").toBe(true);
    const kept = await join(server.base, host.battleId, `second-${suffix()}`, "striker");
    expect(kept.status, "a bare battle with someone in it is still open").toBe(200);
  }, 20_000);

  it("a join still arriving as its room goes is answered for the room as it is then", async () => {
    // Breaker Q10: the room's fight was looked up before the body was read, so
    // a join in flight across a change of fight was answered for the fight it
    // started against ("already over"), not the room as it then was. The
    // re-review showed the window can be held open: stream the body, and let
    // the room expire before the last byte. A room gone mid-join is gone.
    // A seated player's room seats them in it (rule 27; the lobby gate's B4). With no socket of theirs on it they
    // have left the lobby after LOBBY_GRACE_MS, short here, and then it is empty.
    server = await boot(scratchDatabase(), { TICK_MS: "20", ROOM_EMPTY_MS: "800", LOBBY_GRACE_MS: "200" });
    const host = await seatedPlayer(server.base);
    const made = await madeRoom(server.base, host.cookie);
    const encode = (text: string) => new TextEncoder().encode(text);
    let push: (text: string) => void = () => {};
    let finish: () => void = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        push = (text) => stream.enqueue(encode(text));
        finish = () => stream.close();
      },
    });
    const pending = fetch(new URL(`/api/rooms/${made.code}/join`, server.base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      duplex: "half",
    } as RequestInit);
    push(`{"name":"slow-${suffix()}",`);
    await sleep(2_000); // past the window: the room expires with the body half sent
    expect((await room(server.base, made.code)).status, "the room has gone while the join was in flight").toBe(404);
    push(`"role":"mender"}`);
    finish();
    const res = await pending;
    expect(res.status, "the join is answered for the room as it is now: gone").toBe(404);
    expect(((await res.json()) as { error: string }).error, "not as the fight it started against").toBe("No such room.");
    expect(res.headers.getSetCookie(), "and it mints no session").toEqual([]);
  }, 20_000);

  it("an expired room leaves no fight behind", async () => {
    // Review R3, breaker Q8: closing an expired room's fight opened a successor
    // for the room it had just removed: a waiting fight nobody could reach,
    // never dropped, and "lost to a restart" on the next boot (rule 6). After
    // the rooms go, the only fights still live are the ones someone can reach.
    const db = scratchDatabase();
    // Each room seats the player who asked for it (B4); gone from it after LOBBY_GRACE_MS, it is empty.
    server = await boot(db, { TICK_MS: "20", ROOM_EMPTY_MS: "800", LOBBY_GRACE_MS: "200" });
    const door = await raid(server.base);
    const host = await seatedPlayer(server.base);
    const gone = [await madeRoom(server.base, host.cookie), await madeRoom(server.base, host.cookie)];
    await sleep(2_500);
    for (const r of gone) expect((await room(server.base, r.code)).status, `room ${r.code} has expired`).toBe(404);
    await server.kill();
    server = null;

    const sqlite = new Database(db, { readonly: true });
    try {
      const live = sqlite.prepare("select id from battles where status in ('waiting', 'fighting')").all() as { id: string }[];
      expect(live.map((b) => b.id).sort(), "live: the public raid's fight and the host's own, and no fight for a room that's gone").toEqual(
        [door.battleId, host.battleId].sort(),
      );
    } finally {
      sqlite.close();
    }
  }, 20_000);

  it("a private room's finished fight stays behind its code once it leaves memory (B3)", async () => {
    // Phase two's gate, the breaker's B3 (rule 22: "none of its fights, live
    // or finished, is joined, watched or read by battle id" while the room is
    // open): an ended fight leaves memory after a while, and then it was
    // served by id, log and socket, the room still open. A fast clock, four
    // Echoes and a founder who times out play the fight to its end; the drop
    // is made short so the test needn't wait ten minutes.
    server = await boot(scratchDatabase(), { TICK_MS: "5", TURN_TIMEOUT_MS: "250", ECHO_BEAT_MS: "100", DROP_AFTER_MS: "300", ROOM_EMPTY_MS: "4000" });
    const res = await fetch(new URL("/api/rooms", server.base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `kept-${suffix()}`, role: "striker" }),
    });
    expect(res.status, "the room made and its founder seated").toBe(201);
    const made = (await res.json()) as { code: string; battleId: string };
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    for (const role of ["warden", "mender", "breaker", "chronist"]) expect((await seatEcho(server.base, made.code, cookie, role)).status).toBe(201);
    expect((await startRoom(server.base, made.code, cookie)).status, "the founder, its host, starts the fight (rule 27)").toBe(200);
    for (const deadline = Date.now() + 60_000; ; await sleep(200)) {
      const now = await room(server.base, made.code);
      if (now.room && now.room.battleId !== made.battleId) break;
      if (Date.now() > deadline) throw new Error("the room's first fight never ended in 60s");
    }
    await sleep(1_000); // past the drop
    expect((await room(server.base, made.code)).status, "the room is still open").toBe(200);
    expect((await fetch(new URL(`/api/battles/${made.battleId}`, server.base))).status, "its finished fight isn't read by id").toBe(404);
    expect((await fetch(new URL(`/api/battles/${made.battleId}/log`, server.base))).status, "nor its log").toBe(404);
    // Nor watched (re-review N5): the battle socket by id is refused as a fight that isn't there.
    const url = new URL(`/ws?battle=${encodeURIComponent(made.battleId)}`, server.base);
    url.protocol = "ws:";
    const ws = new WebSocket(url);
    const states: unknown[] = [];
    ws.addEventListener("message", (ev) => states.push(ev.data));
    const closed = await new Promise<number>((resolve) => {
      ws.addEventListener("close", (ev) => resolve(ev.code), { once: true });
      setTimeout(() => resolve(-1), 3_000);
    });
    expect(states.length, "the socket carries nothing of it").toBe(0);
    expect(closed, "and closes as a fight that isn't there").toBe(4404);
    // And it really had left memory (re-review N5: "never dropped" passed all of the above): once the room
    // closes, the fight is read by id from the database, an archived state (version 0), not the live one.
    for (const deadline = Date.now() + 15_000; (await room(server.base, made.code)).status !== 404; await sleep(200)) {
      if (Date.now() > deadline) throw new Error("the empty room never closed");
    }
    const after = await fetch(new URL(`/api/battles/${made.battleId}`, server.base));
    expect(after.status, "the room's gone: its fights are readable by id (rule 26)").toBe(200);
    expect(((await after.json()) as { version: number }).version, "from the database: it had left memory").toBe(0);
  }, 90_000);

  it("a private room's fight answers an action only from someone seated in it (Q5)", async () => {
    // Phase two's gate, the breaker's Q5 (rule 22): the fight's state, log,
    // join and socket answer 404 by battle id, but its action route answered
    // 403 ("You aren't standing in this fight") where an unknown id gets 404,
    // so it told anyone holding an id that the fight exists.
    server = await boot(scratchDatabase(), { TICK_MS: "20" });
    const res = await fetch(new URL("/api/rooms", server.base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: `founder-${suffix()}`, role: "striker" }),
    });
    const made = (await res.json()) as { battleId: string };
    const founder = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const outsider = await seatedPlayer(server.base);
    const unknown = await act(server.base, "no-such-battle", outsider.cookie, "jab");
    expect(unknown.status, "an id nobody has: 404").toBe(404);
    expect((await act(server.base, made.battleId, outsider.cookie, "jab")).status, "someone seated elsewhere: the same 404").toBe(404);
    expect((await act(server.base, made.battleId, "", "jab")).status, "no session: the same 404").toBe(404);
    expect((await act(server.base, made.battleId, founder, "jab")).status, "its own seat is answered as any seat is").not.toBe(404);
  }, 20_000);

  it("sitting down again where you're already seated, as another role, is refused, not ignored (Q9)", async () => {
    // Phase two's gate, the breaker's Q9 (rule 24: a role is for a fight):
    // re-joining your own room's fight with another role answered 200 and
    // the old role, saying nothing.
    server = await boot(scratchDatabase(), { TICK_MS: "20" });
    const name = `seated-${suffix()}`;
    const res = await fetch(new URL("/api/rooms", server.base), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name, role: "striker" }),
    });
    const made = (await res.json()) as { code: string };
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    const other = await joinRoom(server.base, made.code, name, "warden", cookie);
    expect(other.status, "another role in the fight you're seated in: refused").toBe(409);
    expect((await joinRoom(server.base, made.code, name, "striker", cookie)).status, "the same role: you're already here, as before").toBe(200);
  }, 20_000);

  it("a founder refused a seat makes no room", async () => {
    // Phase two's gate, the reviewer's R3 and T8: asking for a room with a name
    // and a role is sitting down in it (rule 22), so a seat refused is a room
    // not made. The room was minted before the seat was checked, and a refused
    // founder left a fight in the database nobody sat in.
    const db = scratchDatabase();
    server = await boot(db, { TICK_MS: "20" });
    const door = await raid(server.base);
    const host = await seatedPlayer(server.base);
    const ask = (body: object, cookie = "") =>
      fetch(new URL("/api/rooms", server!.base), {
        method: "POST",
        headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
        body: JSON.stringify(body),
      });
    const kept = await ask({ name: "Mender Echo", role: "mender" });
    expect(kept.status, "an Echo's kept name: refused").toBe(409);
    expect(((await kept.json()) as { code?: string }).code, "and no code handed out").toBeUndefined();
    const renamed = await ask({ name: `someone-else-${suffix()}`, role: "warden" }, host.cookie);
    expect(renamed.status, "a seated player under another name (rule 24): refused").toBe(409);
    await server.kill();
    server = null;

    const sqlite = new Database(db, { readonly: true });
    try {
      const fights = sqlite.prepare("select id from battles").all() as { id: string }[];
      expect(fights.map((b) => b.id).sort(), "no fight but the public raid's and the host's own").toEqual([door.battleId, host.battleId].sort());
    } finally {
      sqlite.close();
    }
  }, 20_000);
});
