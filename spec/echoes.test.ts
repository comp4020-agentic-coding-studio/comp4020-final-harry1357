import { afterEach, describe, expect, inject, it } from "vitest";
import { clock, engine, fighter, sent, table, type Battle, type Clock, type Engine, type Step } from "./engine.ts";
import {
  createRoom,
  join,
  joinRoom,
  newBattle,
  seatEcho,
  sleep,
  suffix,
  token,
  watchRoom,
  type Event,
  type Watcher,
} from "./raid.ts";

// Echoes seated on purpose (docs/adr/007; CLAUDE.md rule 25). An Echo is the
// same automated character a timed-out seat becomes (rule 8), seated by
// someone in the room: one per role, at most four. It plays a fixed policy
// for its role, from that role's actions only and from what every client is
// sent, and every action it takes goes through the check a person's does, so
// it's refused exactly as a person is. It counts half a seat at the pull
// (rule 20), and every state marks it.

const base = inject("baseUrl");

/** Each role's actions, Brace first (protocol.ts ROLES; docs/design/overhaul.md). */
const CATALOGUE: Readonly<Record<string, readonly string[]>> = {
  warden: ["brace", "intercept", "anchor", "bastion", "counterweight"],
  mender: ["brace", "mend", "ward", "quicken", "restore"],
  striker: ["brace", "jab", "cleave", "finisher", "feint"],
  breaker: ["brace", "scan", "pry", "mark", "shatter"],
  chronist: ["brace", "delay", "haste", "relay", "stillpoint"],
};
const ROLES = Object.keys(CATALOGUE);
const EVERY_ACTION = new Set(Object.values(CATALOGUE).flat());

type Refusal = { status: number; error: string };

/** The engine, plus what rule 25 adds to it. */
interface EchoEngine extends Engine {
  /** Why `seatedBy` can't seat an Echo of `role` in this fight, or null to go ahead. */
  checkSeatEcho(b: Battle, seatedBy: string, role: string): Refusal | null;
  /** Seat an Echo (already checked). */
  seatEcho(b: Battle, who: { id: string; role: string; seatedBy: string }, clock: Clock): Step;
  /** The Echo picks its move by its role's policy and submits it like any action: the step, or the refusal a person would get. */
  echoMove(b: Battle, echoId: string, clock: Clock): Step | Refusal;
}

/** The engine with Echo seating, or a failure naming what isn't built yet. */
async function echoEngine(): Promise<EchoEngine> {
  const e = (await engine()) as unknown as Record<string, unknown>;
  const missing = ["checkSeatEcho", "seatEcho", "echoMove"].filter((name) => typeof e[name] !== "function");
  if (missing.length) throw new Error(`the battle engine doesn't export ${missing.join(", ")} yet (src/server/rules.ts)`);
  return e as unknown as EchoEngine;
}

const T0 = 3_000_000;
const PAST_BEAT = 3_500;

/** A table with one person (`<role>-1` for each role given) and an Echo of `role` seated by the first of them. */
function withEcho(e: EchoEngine, role: string, people: string[] = ["mender"]): { b: Battle; echoId: string; seatedBy: string } {
  const b = table(e, people);
  const seatedBy = `${people[0]}-1`;
  const echoId = `echo-${role}`;
  const refused = e.checkSeatEcho(b, seatedBy, role);
  expect(refused, `someone seated in the fight can seat a ${role} Echo`).toBeNull();
  return { b: e.seatEcho(b, { id: echoId, role, seatedBy }, clock()).battle, echoId, seatedBy };
}

/** The Echo's turn: on the plate, past its beat, played by the clock. */
function echoTurn(e: Engine, b: Battle, echoId: string): Step {
  const step = e.advance(e.plate(b, echoId, clock(T0)), clock(T0 + PAST_BEAT));
  if (!step) throw new Error(`${echoId} was on the plate past its beat and the clock did nothing`);
  return step;
}

/** The actions an Echo took in a step: its events whose kind is some role's action. */
const actionsBy = (s: Step, id: string) =>
  s.effects.events.filter((ev) => ev.actorId === id && EVERY_ACTION.has(ev.kind));

describe("an Echo is seated on purpose", () => {
  it("adding an Echo seats a character that acts on its own turn with its role's actions", async () => {
    const e = await echoEngine();
    for (const role of ROLES) {
      const { b, echoId, seatedBy } = withEcho(e, role);
      expect(fighter(b, echoId).echo, `a seated ${role} Echo is an Echo`).toBe(true);
      expect(sent(e, b).queue.find((t) => t.id === echoId), `the ${role} Echo is on the strip, marked, with who seated it`).toMatchObject({
        echo: true,
        seatedBy,
        role,
      });

      const step = echoTurn(e, b, echoId);
      const acted = actionsBy(step, echoId);
      expect(acted.length, `the ${role} Echo acts on its turn`).toBeGreaterThan(0);
      for (const ev of acted) expect(CATALOGUE[role], `a ${role} Echo uses a ${role}'s actions, not ${ev.kind}`).toContain(ev.kind);
      expect(fighter(step.battle, echoId).echo, `and is still an Echo after it`).toBe(true);
      const credited = step.effects.stats[echoId] ?? { turns: 0, damage: 0, healing: 0 };
      expect([credited.turns, credited.damage, credited.healing], `the ${role} Echo's turn is in nobody's record`).toEqual([0, 0, 0]);
      expect(step.effects.stats[seatedBy]?.turns ?? 0, "not even the record of whoever seated it").toBe(0);
    }
  });

  it("an Echo reads only what every client is sent", async () => {
    // Rule 25: a policy never reads anything a player can't see. Two fights
    // identical on the wire, differing only in what the server keeps back (the
    // rings' unscanned weaknesses), get the same move from every role's Echo.
    const e = await echoEngine();
    const rotate: Record<string, string> = { ember: "frost", frost: "aether", aether: "ember" };
    for (const role of ROLES) {
      const { b, echoId } = withEcho(e, role);
      const twin = structuredClone(b);
      for (const r of twin.rings) if (r.weakness === null) r.element = rotate[r.element] ?? r.element;
      expect(sent(e, twin), "the twin is the same fight on the wire").toEqual(sent(e, b));
      const move = (s: Step) =>
        actionsBy(s, echoId).map((ev) => ({ kind: ev.kind, ringId: ev.ringId, targetId: ev.targetId, cardId: ev.cardId }));
      expect(move(echoTurn(e, twin, echoId)), `the ${role} Echo's move doesn't depend on what it can't see`).toEqual(
        move(echoTurn(e, b, echoId)),
      );
    }
  });

  it("a seat that times out becomes the same Echo, and plays its role's policy", async () => {
    // ADR-007: "the same automated character a timed-out player becomes". A
    // Breaker who misses three turns running plays a Breaker's actions, not a
    // plain blow no Breaker has. Only the engine's existing steps are needed.
    const e = await engine();
    let b = table(e, ["breaker", "warden"]);
    for (let i = 0; i < 3; i++) b = e.advance(e.plate(b, "breaker-1", clock()), clock(9_000_000 + i))!.battle;
    expect(fighter(b, "breaker-1").echo, "three timeouts in a row make an Echo").toBe(true);
    const step = echoTurn(e, b, "breaker-1");
    const acted = actionsBy(step, "breaker-1");
    expect(acted.length, "the Echo acts on its turn").toBeGreaterThan(0);
    for (const ev of acted) expect(CATALOGUE.breaker, `the timed-out Breaker's Echo plays a Breaker's action, not ${ev.kind}`).toContain(ev.kind);
  });
});

describe("an Echo seated on purpose waits for nobody", () => {
  it("is played on the next tick, with no reclaim beat", async () => {
    // Review R2: ADR-006 gives a timed-out seat's Echo a three-second beat so
    // its person can come back (and accepted that cost for it alone, ADR-002).
    // A seated Echo has no person, so a beat would stop the table for nobody:
    // one person and four Echoes would wait twelve seconds a cycle.
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "breaker");
    const onPlate = e.plate(b, echoId, clock(T0));
    expect(sent(e, onPlate).plateMs, "the client is told the seat's window is nothing").toBe(0);
    const step = e.advance(onPlate, clock(T0 + 1));
    expect(step, "a millisecond on, the server has played it").not.toBeNull();
    expect(actionsBy(step!, echoId).length, "and the Echo acted").toBeGreaterThan(0);
    // A timed-out seat still waits for its person (spec/echo.test.ts).
    const timedOut = structuredClone(b);
    const f = timedOut.standing.find((x) => x.id === "mender-1")!;
    f.echo = true;
    expect(e.advance(e.plate(timedOut, "mender-1", clock(T0)), clock(T0 + 1)), "a timed-out seat's Echo still waits its beat").toBeNull();
  });
});

describe("an Echo gets no favours", () => {
  it("an Echo's out-of-turn action is refused exactly as a human's is", async () => {
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "breaker", ["warden", "striker"]);

    // Someone else's turn: the Warden is on the plate.
    const wardenUp = e.plate(b, "warden-1", clock());
    const person = e.checkAction(wardenUp, "striker-2", "brace", null);
    expect(person, "a person acting on someone else's turn is refused").toMatchObject({ status: 409 });
    const echo = e.echoMove(wardenUp, echoId, clock());
    expect("status" in echo ? echo : null, "an Echo acting on someone else's turn is refused, in the same words").toEqual(person);

    // Two at once (rule 10): the Warden has just taken the turn, and the plate is empty.
    const took = e.act(wardenUp, "warden-1", "brace", null, clock());
    expect(took.battle.activeId, "nobody is on the plate straight after the Warden's turn").toBeNull();
    const late = e.checkAction(took.battle, "striker-2", "brace", null);
    expect(late, "a person a moment late is told whose turn it was").toMatchObject({ status: 409 });
    const lateEcho = e.echoMove(took.battle, echoId, clock());
    expect("status" in lateEcho ? lateEcho : null, "and so is an Echo, word for word").toEqual(late);

    // On its own turn, the same call is a move.
    const own = e.echoMove(e.plate(b, echoId, clock()), echoId, clock());
    expect("status" in own ? own : null, "on its own turn the Echo's move goes through").toBeNull();
  });
});

describe("Echoes in a room, live", () => {
  const open: Watcher[] = [];
  afterEach(() => {
    for (const w of open.splice(0)) w.close();
  });

  async function hostedRoom(role = "warden") {
    const name = `host-${suffix()}`;
    const host = await join(base, await newBattle(base), name, role);
    const made = await createRoom(base, host.cookie);
    expect(made.status, "a seated player makes a room").toBe(201);
    const code = made.code as string;
    const seat = await joinRoom(base, code, name, role, host.cookie);
    expect(seat.status, "and sits down in it").toBe(200);
    const w = watchRoom(base, code);
    open.push(w);
    await w.opened;
    return { code, cookie: host.cookie, hostId: seat.characterId as string, battleId: made.battleId as string, w };
  }

  it("only someone seated in the room seats an Echo, and it acts on its own turn, as its role", async () => {
    const { code, cookie, hostId, w } = await hostedRoom();

    const outsider = await join(base, await newBattle(base), `outsider-${suffix()}`, "mender");
    expect((await seatEcho(base, code, outsider.cookie, "breaker")).status, "someone seated elsewhere can't seat an Echo here").toBe(403);
    expect((await seatEcho(base, code, "", "breaker")).status, "nor can someone seated nowhere").toBe(403);

    const seated = await seatEcho(base, code, cookie, "breaker");
    expect(seated.status, "someone in the room seats a Breaker Echo").toBe(201);
    const echoId = seated.echoId as string;
    const marked = await w.waitFor((st) => token(st, echoId) !== undefined, "the Echo on the strip", 5_000);
    expect(token(marked, echoId), "marked as an Echo, with who seated it").toMatchObject({ echo: true, seatedBy: hostId, role: "breaker" });

    // The pull (ten seconds after the last seat), then the Echo's turn and its beat.
    let at = -1;
    for (const deadline = Date.now() + 35_000; at < 0; await sleep(50)) {
      at = w.messages.findIndex((m) => m.events.some((ev: Event) => ev.actorId === echoId && EVERY_ACTION.has(ev.kind)));
      if (Date.now() > deadline) throw new Error("waited 35s for the Breaker Echo to act");
    }
    const acted = w.messages[at].events.filter((ev: Event) => ev.actorId === echoId && EVERY_ACTION.has(ev.kind));
    for (const ev of acted) expect(CATALOGUE.breaker, `the Breaker Echo plays a Breaker's action, not ${ev.kind}`).toContain(ev.kind);
    expect(w.messages[at - 1]?.state.activeId, "it acted on its own turn: it was on the plate").toBe(echoId);
  }, 50_000);

  it("a fifth Echo is refused", async () => {
    const { code, cookie, w } = await hostedRoom();
    expect((await seatEcho(base, code, cookie, "warden")).status, "a Warden Echo").toBe(201);
    expect((await seatEcho(base, code, cookie, "warden")).status, "one Echo per role: a second Warden Echo is refused").toBe(409);
    for (const role of ["mender", "striker", "breaker"]) {
      expect((await seatEcho(base, code, cookie, role)).status, `a ${role} Echo`).toBe(201);
    }
    const fifth = await seatEcho(base, code, cookie, "chronist");
    expect(fifth.status, "four Echoes is the most a room seats: a fifth is refused").toBe(409);
    expect(fifth.error, "with a reason").toEqual(expect.any(String));

    // Four Echoes on the strip, and at the pull each counts half a seat (rule 20).
    const pulled = await w.waitFor((st) => st.status === "fighting", "the pull", 25_000);
    expect(pulled.queue.filter((t) => t.echo === true).length, "four Echoes on the strip").toBe(4);
    expect(pulled.pullSeats, "one person and four Echoes: 1 + 4 × ½ seats").toBe(3);
  }, 40_000);
});
