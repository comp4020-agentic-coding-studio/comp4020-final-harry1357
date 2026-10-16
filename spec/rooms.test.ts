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
  suffix,
  token,
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

    // The right code, from a stranger with no cookie, gets in.
    const right = await joinRoom(base, made.code, `found-${suffix()}`, "mender");
    expect(right.status, "the right code seats you").toBe(200);
    expect(right.battleId, "in that room's fight").toBe(made.battleId);
    const w = watching(base, made.code);
    const st = await w.waitFor((s) => token(s, right.characterId) !== undefined, "the new seat on the room's strip", 5_000);
    expect(st.queue.some((t) => t.name.startsWith("lost-")), "the wrong code seated nobody in the right room").toBe(false);
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
    const bob = await joinRoom(base, b.code, `bob-${s}`, "breaker");
    expect([alice.status, bob.status], "one person sits in each room").toEqual([200, 200]);

    // Two clients, one in each room, both probed.
    const wa = watching(base, a.code);
    const wb = watching(base, b.code);
    await Promise.all([wa.opened, wb.opened]);
    await wb.waitFor((st) => token(st, bob.characterId) !== undefined, "bob on room B's strip", 5_000);

    // Room A pulls ten seconds after its last seat (docs/adr/006); then it's Alice's turn.
    await wa.waitFor((st) => st.activeId === alice.characterId, "alice's turn in room A", 25_000);
    const bBefore = wb.states.at(-1) as BattleState;
    const bFrom = wb.events.length;
    const fromA = wa.events.length;
    const struck = await act(base, a.battleId, alice.cookie, "jab");
    expect(struck.status, "alice strikes in room A").toBe(200);
    await eventFrom(wa, (ev) => ev.kind === "jab" && ev.actorId === alice.characterId, "alice's Jab on room A's socket", 5_000, fromA);
    await sleep(750); // several ticks for anything stray to reach room B

    const members = (st: BattleState): string[] => st.queue.map((t) => t.id).sort();
    expect(wb.events.slice(bFrom).some((ev) => ev.actorId === alice.characterId), "nothing alice did reached room B").toBe(false);
    expect(wb.events.some((ev) => ev.kind === "jab"), "no Jab was ever broadcast in room B, where only a Breaker sits").toBe(false);
    expect(wb.states.every((st) => !st.queue.some((t) => t.id === alice.characterId)), "alice never appears on room B's strip").toBe(true);
    expect(wb.states.every((st) => st.battleId === b.battleId), "room B's socket only carried room B's fight").toBe(true);
    for (const st of wb.states.filter((x) => x.version > bBefore.version)) {
      expect(members(st), `room B's queue at v${st.version} holds who it held before alice struck`).toEqual(members(bBefore));
    }

    // A seat acts only in its own room.
    const cross = await act(base, b.battleId, alice.cookie, "jab");
    expect(cross.status, "alice's seat is in room A; room B's fight refuses her").toBe(403);
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
    const WINDOW_MS = 3_000;
    server = await boot(scratchDatabase(), {
      TICK_MS: "5",
      TURN_TIMEOUT_MS: "150",
      ECHO_BEAT_MS: "10",
      ROOM_EMPTY_MS: String(WINDOW_MS),
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
    const ended = await w.waitFor(
      (st) => st.battleId === made.battleId && ["won", "lost", "abandoned"].includes(st.status),
      "the room's fight to finish",
      100_000,
    );
    expect(ended.status, "the fight finished: won or lost, not abandoned by the room going away").toMatch(/^(won|lost)$/);

    // The room's next fight has nobody in it. Inside the window, the room is still there.
    await sleep(WINDOW_MS / 3);
    expect((await room(at, made.code)).status, "a room isn't gone before its window is up").toBe(200);

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
    server = await boot(scratchDatabase(), { TICK_MS: "20", ROOM_EMPTY_MS: "800" });
    const empty = await newBattle(server.base);
    const host = await seatedPlayer(server.base);
    await sleep(2_500);
    const late = await join(server.base, empty, `late-${suffix()}`, "mender");
    expect(late.status, "an empty bare battle past the window seats nobody").toBe(409);
    const log = await battleLog(server.base, empty);
    expect(log.status, "it was closed").toBe("abandoned");
    expect((log.entries as { kind: string }[]).some((l) => l.kind === "end"), "with a line saying so").toBe(true);
    const kept = await join(server.base, host.battleId, `second-${suffix()}`, "striker");
    expect(kept.status, "a bare battle with someone in it is still open").toBe(200);
  }, 20_000);

  it("an expired room leaves no fight behind", async () => {
    // Review R3, breaker Q8: closing an expired room's fight opened a successor
    // for the room it had just removed: a waiting fight nobody could reach,
    // never dropped, and "lost to a restart" on the next boot (rule 6). After
    // the rooms go, the only fights still live are the ones someone can reach.
    const db = scratchDatabase();
    server = await boot(db, { TICK_MS: "20", ROOM_EMPTY_MS: "800" });
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
});
