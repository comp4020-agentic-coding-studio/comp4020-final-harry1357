import { afterAll, afterEach, describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase, type Booted } from "./boot.ts";
import { clock, engine, sent, type Battle, type Clock, type Engine, type Step } from "./engine.ts";
import {
  joinRoom,
  raid,
  seatEcho,
  sleep,
  suffix,
  watchRoom,
  type BattleState,
  type Watcher,
} from "./raid.ts";

// The lobby (docs/adr/009; CLAUDE.md rules 20, 25 and 27). A private room
// starts on its host's decision, never a timer: creating a room seats its
// creator as host in a lobby where nothing runs, only the host's Start
// starts the fight, and HP is set then from the seats present. The host
// passes to the next seat if they leave first. Echoes are seated only in a
// private lobby. The public raid has no lobby: a join to its running fight
// grows the Orrery with its percentage kept.
//
// The engine half drives src/server/rules.ts directly (pure: every step a
// new battle), so "no counter runs" is a claim about every counter on every
// tick, not one sample. The wire half boots servers of its own.

/** The lobby's engine contract, beyond spec/engine.ts. A missing export fails with its name. */
interface LobbyEngine extends Engine {
  /** Start a waiting fight (already checked): HP set from the seats present, the fight under way. */
  start(b: Battle, by: string, clock: Clock): Step;
  /** Why `by` can't Start this fight, or null to go ahead. */
  checkStart(b: Battle, by: string): { status: number; error: string } | null;
  /** A person leaves a fight that hasn't started: unseated, and the host passes on. */
  leave(b: Battle, id: string, clock: Clock): Step;
  seatEcho(b: Battle, who: { id: string; role: string; seatedBy: string }, clock: Clock): Step;
  checkSeatEcho(b: Battle, seatedBy: string, role: unknown): { status: number; error: string } | null;
}

async function lobbyEngine(): Promise<LobbyEngine> {
  const e = (await engine()) as unknown as Record<string, unknown>;
  const missing = ["start", "checkStart", "leave", "seatEcho", "checkSeatEcho"].filter((name) => typeof e[name] !== "function");
  if (missing.length) throw new Error(`the battle engine doesn't export ${missing.join(", ")} yet (src/server/rules.ts)`);
  return e as unknown as LobbyEngine;
}

const T0 = 5_000_000;
/** The state's host, as the client is sent it. */
const hostOf = (e: Engine, b: Battle): unknown => sent(e, b).hostId;

/** A private room's first fight with these seated, in order, as people (`<role>-<n>`). */
function lobby(e: LobbyEngine, roles: string[]): Battle {
  let b = e.createBattle("lobby", false, T0);
  (b as Battle & { room: string | null }).room = "QZ7MK";
  roles.forEach((role, i) => {
    b = e.join(b, { id: `${role}-${i + 1}`, name: `${role} ${i + 1}`, role }, clock(T0)).battle;
  });
  return b;
}

describe("a private room waits for its host", () => {
  it("creating a room seats the host in a lobby, and no counter runs until Start", async () => {
    const e = await lobbyEngine();
    let b = lobby(e, ["mender", "striker"]);
    expect(b.status, "a private room's fight waits").toBe("waiting");
    expect(hostOf(e, b), "its first seat is the host, and every client is told so").toBe("mender-1");
    expect(sent(e, b).lobby, "and the state says this is a lobby").toBe(true);

    // A whole minute of ticks: far past any countdown the old pull had.
    const counters = (x: Battle) => x.standing.map((f) => `${f.id}:${f.counter}`).join(",");
    const before = counters(b);
    for (let now = T0; now <= T0 + 60_000; now += 150) b = e.advance(b, clock(now))?.battle ?? b;
    expect(b.status, "a minute on, nobody has pressed Start, so nothing has started").toBe("waiting");
    expect(counters(b), "and not one counter moved").toBe(before);
    expect(b.tick, "nor the clock").toBe(0);
    expect(b.cards, "and no boss card is announced").toEqual([]);
    expect(b.activeId, "and nobody is on the plate").toBeNull();
  });

  it("only the host's Start starts the fight, and only once", async () => {
    const e = await lobbyEngine();
    const b = lobby(e, ["mender", "striker"]);
    expect(e.checkStart(b, "striker-1"), "a Start from someone who isn't host is refused").toMatchObject({ status: 403 });
    expect(e.checkStart(b, "nobody"), "and from someone not seated").toMatchObject({ status: 403 });
    expect(e.checkStart(b, "mender-1"), "the host may").toBeNull();
    const started = e.start(b, "mender-1", clock(T0 + 1_000)).battle;
    expect(started.status, "the host's Start starts the fight").toBe("fighting");
    expect(e.checkStart(started, "mender-1"), "a second Start is refused").toMatchObject({ status: 409 });
  });

  it("HP at Start is the curve for the seats present, an Echo counting half", async () => {
    const e = await lobbyEngine();
    let b = lobby(e, ["mender"]);
    for (const [i, role] of ["warden", "striker", "breaker", "chronist"].entries()) {
      expect(e.checkSeatEcho(b, "mender-1", role), `the host seats a ${role} Echo in the lobby`).toBeNull();
      b = e.seatEcho(b, { id: `echo-${i}`, role, seatedBy: "mender-1" }, clock(T0)).battle;
    }
    const step = e.start(b, "mender-1", clock(T0 + 1_000));
    const boss = step.battle.standing.find((f) => f.id === "orrery")!;
    expect(step.battle.pullSeats, "one person and four Echoes: 1 + 4 × ½").toBe(3);
    expect(boss.maxHp, "the Orrery's HP is the curve at three seats").toBe(e.orreryHp(3));
    expect(boss.hp, "at full").toBe(boss.maxHp);
    expect(step.effects.events.some((ev) => ev.kind === "start" && ev.actorId === "mender-1"), "Start is an event the screen draws").toBe(true);
    expect(step.effects.events.find((ev) => ev.kind === "pull"), "and the pull says what it set").toMatchObject({ seats: 3, maxHp: e.orreryHp(3) });
  });

  it("the host leaving before Start passes the room to the next seat, never to an Echo", async () => {
    const e = await lobbyEngine();
    let b = lobby(e, ["mender"]);
    b = e.seatEcho(b, { id: "echo-w", role: "warden", seatedBy: "mender-1" }, clock(T0)).battle;
    b = e.join(b, { id: "striker-2", name: "striker 2", role: "striker" }, clock(T0)).battle;
    b = e.join(b, { id: "breaker-3", name: "breaker 3", role: "breaker" }, clock(T0)).battle;
    const step = e.leave(b, "mender-1", clock(T0 + 500));
    b = step.battle;
    expect(b.standing.some((f) => f.id === "mender-1"), "the host who left is unseated").toBe(false);
    expect(hostOf(e, b), "the next person seated is host: not the Echo seated before them").toBe("striker-2");
    expect(step.effects.events.some((ev) => ev.kind === "host" && ev.actorId === "striker-2"), "and the change is an event").toBe(true);
    expect(e.checkStart(b, "striker-2"), "the new host may Start").toBeNull();
    expect(e.checkStart(b, "mender-1"), "the old one may not").toMatchObject({ status: 403 });
  });
});

describe("Echoes are seated only in a private lobby", () => {
  it("an Echo can't be seated in the public raid, in its lobby or its fight", async () => {
    const e = await lobbyEngine();
    let b = e.createBattle("public", true, T0);
    (b as Battle & { room: string | null }).room = "RAID";
    b = e.join(b, { id: "mender-1", name: "mender 1", role: "mender" }, clock(T0)).battle;
    expect(e.checkSeatEcho(b, "mender-1", "warden"), "no Echo in the public raid").toMatchObject({ status: 403 });
  });

  it("nor mid-fight in a private room, nor by anyone but the host", async () => {
    const e = await lobbyEngine();
    const b = lobby(e, ["mender", "striker"]);
    expect(e.checkSeatEcho(b, "striker-2", "warden"), "a guest at the table asks the host").toMatchObject({ status: 403 });
    const started = e.start(b, "mender-1", clock(T0 + 1_000)).battle;
    expect(e.checkSeatEcho(started, "mender-1", "warden"), "once started, no Echo").toMatchObject({ status: 409 });
  });
});

describe("the public raid grows with its room", () => {
  it("a join to the running public fight raises max HP, with the percentage kept", async () => {
    const e = await lobbyEngine();
    let b = e.createBattle("public", true, T0);
    (b as Battle & { room: string | null }).room = "RAID";
    b = e.join(b, { id: "striker-1", name: "striker 1", role: "striker" }, clock(T0)).battle;
    for (let now = T0; now <= T0 + 30_000 && b.status !== "fighting"; now += 150) b = e.advance(b, clock(now))?.battle ?? b;
    expect(b.status, "the public raid needs nobody's Start").toBe("fighting");
    const boss = (x: Battle) => x.standing.find((f) => f.id === "orrery")!;
    // Wound it to 60%, as a fight in progress would be.
    b = structuredClone(b);
    boss(b).hp = Math.round(boss(b).maxHp * 0.6);
    const share = boss(b).hp / boss(b).maxHp;

    const step = e.join(b, { id: "warden-2", name: "warden 2", role: "warden" }, clock(T0 + 40_000));
    const after = boss(step.battle);
    expect(after.maxHp, "max HP rises to the curve for two seats").toBe(e.orreryHp(2));
    expect(Math.abs(after.hp / after.maxHp - share), "and the bar stands where it stood").toBeLessThan(0.005);
    expect(step.effects.events.find((ev) => ev.kind === "grow"), "the growth is an event the screen draws").toMatchObject({ maxHp: e.orreryHp(2) });
  });
});

describe("the lobby gate's breaker findings, on the engine", () => {
  type Next = (ended: Battle, fresh: Battle, c: Clock) => Step;
  const nextFightOf = (e: LobbyEngine): Next => {
    const fn = (e as unknown as Record<string, unknown>).nextFight;
    if (typeof fn !== "function") throw new Error("the battle engine doesn't export nextFight yet (src/server/rules.ts)");
    return fn as Next;
  };
  const freshOf = (e: LobbyEngine, isPublic: boolean): Battle => {
    const b = e.createBattle("next", isPublic, T0);
    (b as Battle & { room: string | null }).room = isPublic ? "RAID" : "QZ7MK";
    return b;
  };

  it("B2: the Echoes come back to the next lobby though the host who seated them left it", async () => {
    // Rule 27: the room returns to its lobby "with everyone still seated"; ADR-009: the Echoes "belong to the
    // table, not to one fight". They were carried only if the person who seated them was carried too.
    const e = await lobbyEngine();
    let b = lobby(e, ["warden", "striker"]);
    for (const [i, role] of ["mender", "breaker"].entries()) b = e.seatEcho(b, { id: `echo-${i}`, role, seatedBy: "warden-1" }, clock(T0)).battle;
    b = e.leave(b, "warden-1", clock(T0))!.battle;
    expect(hostOf(e, b), "the Striker is host now").toBe("striker-2");
    b = e.start(b, "striker-2", clock(T0)).battle;
    const ended = structuredClone(b);
    ended.status = "won";
    const next = nextFightOf(e)(ended, freshOf(e, false), clock(T0)).battle;
    const seated = next.standing.filter((f) => f.kind === "character").map((f) => f.id).sort();
    expect(seated, "the host and both Echoes are in the next lobby").toEqual(["echo-0", "echo-1", "striker-2"]);
    expect(hostOf(e, next), "the host is the same").toBe("striker-2");
    expect(e.checkSeatEcho(next, "striker-2", "mender"), "and their Echoes count against the table's: one Mender Echo").toMatchObject({ status: 409 });
  });

  it("B3: the public raid carries the people still standing, never a seat its person left to an Echo", async () => {
    // ADR-009: the public raid's next fight seats "everyone still standing"; rule 8: an Echo plays "until the
    // person acts again". A seat that timed out into an Echo isn't a person standing at the table, and carried
    // as a person it was counted whole at the next pull (rule 20: an Echo is half).
    const e = await lobbyEngine();
    let b = e.createBattle("raid", true, T0);
    (b as Battle & { room: string | null }).room = "RAID";
    for (const [i, role] of ["warden", "mender", "striker"].entries()) b = e.join(b, { id: `p${i}`, name: `p ${i}`, role }, clock(T0)).battle;
    const ended = structuredClone(b);
    ended.status = "won";
    (ended.standing.find((f) => f.id === "p1") as Battle["standing"][number]).echo = true; // timed out into an Echo
    const fallen = ended.standing.find((f) => f.id === "p2") as Battle["standing"][number];
    ended.standing = ended.standing.filter((f) => f.id !== "p2");
    ended.fallen.push({ ...fallen, hp: 0 }); // downed
    const next = nextFightOf(e)(ended, freshOf(e, true), clock(T0)).battle;
    const seated = next.standing.filter((f) => f.kind === "character").map((f) => f.id);
    expect(seated, "only the person still standing as themselves").toEqual(["p0"]);
  });

  it("B5: a late joiner in a private room takes a seat at the back of the strip", async () => {
    // ADR-009: "A late joiner in a private room … takes a seat at the back of the strip".
    const e = await lobbyEngine();
    let b = lobby(e, ["warden", "mender", "breaker"]);
    b = e.start(b, "warden-1", clock(T0)).battle;
    b = e.join(b, { id: "chronist-9", name: "late 9", role: "chronist" }, clock(T0)).battle;
    const party = b.standing.filter((f) => f.kind === "character");
    expect(party.at(-1)?.id, `the late joiner is last on the strip: ${party.map((f) => `${f.id}:${f.counter}`).join(", ")}`).toBe("chronist-9");
  });

  it("B6: a name a lobby guest took stays theirs in that battle after they leave it", async () => {
    // Rule 4: no two people in one battle share a name. Leaving the lobby forgot the name, so a stranger took it
    // and the guest was refused their own.
    const e = await lobbyEngine();
    let b = lobby(e, ["warden"]);
    b = e.join(b, { id: "guest", name: "Gale", role: "striker" }, clock(T0)).battle;
    b = e.leave(b, "guest", clock(T0))!.battle;
    const check = (e as unknown as { checkJoin(b: Battle, id: string | null, name: string): unknown }).checkJoin;
    expect(check(b, null, "GALE"), "a stranger can't take it").toMatchObject({ status: 409 });
    expect(check(b, "guest", "Gale"), "the guest sits down under it again").toBeNull();
  });
});

// --- over the wire -----------------------------------------------------------

let server: Booted | null = null;
const open: Watcher[] = [];
afterEach(async () => {
  for (const w of open.splice(0)) w.close();
  await server?.kill();
  server = null;
});
afterAll(cleanScratch);

/** Ask for a room with a name and a role, as someone new: the founder's seat and cookie. */
async function founded(base: string, role = "mender") {
  const name = `host-${suffix()}`;
  const res = await fetch(new URL("/api/rooms", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, role }),
  });
  expect(res.status, "someone new makes a room by sitting down in it").toBe(201);
  const made = (await res.json()) as { code: string; battleId: string; characterId: string };
  const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
  return { ...made, cookie, name, role };
}

const post = (base: string, path: string, cookie: string, body: object = {}) =>
  fetch(new URL(path, base), { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });

describe("the lobby, over the wire", () => {
  it("the host's Start starts the room's fight; a guest's is refused; the room sits still until then", async () => {
    server = await boot(scratchDatabase(), { TICK_MS: "5" });
    const host = await founded(server.base);
    const guest = await joinRoom(server.base, host.code, `guest-${suffix()}`, "striker");
    expect(guest.status, "a guest sits down in the lobby").toBe(200);
    const w = watchRoom(server.base, host.code);
    open.push(w);
    await w.opened;

    await sleep(1_500); // three hundred ticks at 5 ms: far past the old countdown
    const waiting = await w.waitFor((st) => st.battleId === host.battleId, "the room's fight", 2_000);
    const last = w.states.at(-1) as BattleState & { hostId?: string; lobby?: boolean };
    expect([last.status, last.hostId, last.lobby], "still a lobby, with its host named").toEqual(["waiting", host.characterId, true]);
    expect(last.tick, "and its clock never moved").toBe(waiting.tick);

    const refused = await post(server.base, `/api/rooms/${host.code}/start`, guest.cookie);
    expect(refused.status, "a guest's Start is refused").toBe(403);
    const started = await post(server.base, `/api/rooms/${host.code}/start`, host.cookie);
    expect(started.status, "the host's Start is taken").toBe(200);
    const fighting = await w.waitFor((st) => st.status === "fighting", "the fight to start", 5_000);
    expect(fighting.pullSeats, "pulled for the two seated").toBe(2);
    expect((await post(server.base, `/api/rooms/${host.code}/start`, host.cookie)).status, "a second Start is refused").toBe(409);
  }, 20_000);

  it("an Echo can't be seated in the public raid", async () => {
    server = await boot(scratchDatabase(), { TICK_MS: "20" });
    const door = await raid(server.base);
    const seat = await joinRoom(server.base, door.code as string, `public-${suffix()}`, "mender");
    expect(seat.status, "someone sits down in the public raid").toBe(200);
    const refused = await seatEcho(server.base, door.code as string, seat.cookie, "warden");
    expect(refused.status, "and is refused an Echo there").toBe(403);
    expect(refused.error, "with a reason that says why").toMatch(/public/i);
  }, 15_000);

  it("the host leaving the lobby passes the Start to the next seat", async () => {
    server = await boot(scratchDatabase(), { TICK_MS: "5" });
    const host = await founded(server.base);
    const guest = await joinRoom(server.base, host.code, `guest-${suffix()}`, "striker");
    expect((await post(server.base, `/api/rooms/${host.code}/leave`, host.cookie)).status, "the host leaves the lobby").toBe(200);
    expect((await post(server.base, `/api/rooms/${host.code}/start`, host.cookie)).status, "and can't Start it now").toBe(403);
    expect((await post(server.base, `/api/rooms/${host.code}/start`, guest.cookie)).status, "the next seat can").toBe(200);
  }, 15_000);

  it("a join during Start is counted once, before or after it, never lost", async () => {
    // Rule 10's clock decides between a Start and a join that arrive together.
    server = await boot(scratchDatabase(), { TICK_MS: "5" });
    const host = await founded(server.base);
    const [start, late] = await Promise.all([
      post(server.base, `/api/rooms/${host.code}/start`, host.cookie),
      joinRoom(server.base, host.code, `racer-${suffix()}`, "warden"),
    ]);
    expect(start.status, "the Start is taken").toBe(200);
    expect(late.status, "and so is the join, on whichever side of it the clock put it").toBe(200);
    const st = (await (await fetch(new URL(`/api/rooms/${host.code}`, server.base))).json()) as { battleId: string };
    const w = watchRoom(server.base, host.code);
    open.push(w);
    const now = await w.waitFor((x) => x.battleId === st.battleId, "the room's fight", 2_000);
    const seats = now.queue.filter((t) => t.kind === "character").length;
    expect(seats, "both seated in the one fight").toBe(2);
    const boss = now.queue.find((t) => t.kind === "boss")!;
    expect(boss.maxHp, "and the Orrery sized for the two of them, whichever came first").toBe((await engine()).orreryHp(2));
  }, 15_000);

  it("after a fight ends the room returns to its lobby, with everyone still seated", async () => {
    server = await boot(scratchDatabase(), { TICK_MS: "5", TURN_TIMEOUT_MS: "150", ECHO_BEAT_MS: "10" });
    const host = await founded(server.base, "striker");
    for (const role of ["warden", "mender", "breaker", "chronist"]) {
      expect((await seatEcho(server.base, host.code, host.cookie, role)).status, `the host seats a ${role} Echo`).toBe(201);
    }
    const w = watchRoom(server.base, host.code);
    open.push(w);
    await w.opened;
    expect((await post(server.base, `/api/rooms/${host.code}/start`, host.cookie)).status).toBe(200);
    await w.waitFor((st) => st.battleId === host.battleId && ["won", "lost"].includes(st.status), "the fight to end", 120_000);
    const next = await w.waitFor((st) => st.battleId !== host.battleId, "the room's next fight", 5_000);
    const lobbyState = next as BattleState & { hostId?: string; lobby?: boolean };
    expect([lobbyState.status, lobbyState.lobby, lobbyState.hostId], "a lobby again, the same host").toEqual(["waiting", true, host.characterId]);
    expect(next.queue.filter((t) => t.kind === "character").length, "the host and the four Echoes, still seated").toBe(5);
  }, 140_000);
});

describe("the lobby gate's breaker findings, over the wire", () => {
  it("B4: a seated player who asks for a room with no body is seated in it as its host", async () => {
    // Rule 27: "Creating a room seats its creator as host in a lobby"; rule 22 lets a seated player ask for one.
    server = await boot(scratchDatabase(), { TICK_MS: "20" });
    const door = await raid(server.base);
    const seat = await joinRoom(server.base, door.code as string, `asker-${suffix()}`, "warden");
    expect(seat.status).toBe(200);
    const res = await fetch(new URL("/api/rooms", server.base), { method: "POST", headers: { cookie: seat.cookie } });
    expect(res.status, "a seated player makes a room").toBe(201);
    const made = (await res.json()) as { code: string };
    const w = watchRoom(server.base, made.code);
    open.push(w);
    const st = (await w.waitFor(() => true, "the room's state", 3_000)) as BattleState & { hostId?: string };
    expect(st.queue.some((t) => t.id === seat.characterId), "the asker is seated in it").toBe(true);
    expect(st.hostId, "as its host").toBe(seat.characterId);
    const started = await post(server.base, `/api/rooms/${made.code}/start`, seat.cookie);
    expect(started.status, "and may Start it").toBe(200);
  }, 15_000);
});

describe("the public raid, over the wire", () => {
  it("a join to the running public fight raises the Orrery, its bar where it was", async () => {
    server = await boot(scratchDatabase(), { TICK_MS: "20" });
    const door = await raid(server.base);
    const first = await joinRoom(server.base, door.code as string, `first-${suffix()}`, "warden");
    expect(first.status).toBe(200);
    const w = watchRoom(server.base, door.code as string);
    open.push(w);
    const running = await w.waitFor((st) => st.status === "fighting", "the public fight to run", 20_000);
    const before = running.queue.find((t) => t.kind === "boss")!;
    const from = w.states.length;
    expect((await joinRoom(server.base, door.code as string, `second-${suffix()}`, "mender")).status).toBe(200);
    const grown = await w.waitFor((st) => st.queue.filter((t) => t.kind === "character").length === 2, "the second seat", 5_000, from);
    const after = grown.queue.find((t) => t.kind === "boss")!;
    expect(after.maxHp, "the Orrery grew for two").toBe((await engine()).orreryHp(2));
    expect(Math.abs(after.hp / after.maxHp - before.hp / before.maxHp), "and its bar didn't jump").toBeLessThan(0.02);
  }, 30_000);
});
