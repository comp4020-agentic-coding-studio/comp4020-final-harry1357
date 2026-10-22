import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { clock, engine, type Battle, type Engine, type Step } from "./engine.ts";

// The fight is as long as the room (docs/adr/010; CLAUDE.md rule 28). The
// Orrery's reset follows the room's pace, so it comes round about once per
// three player turns whatever the room's size, and a fight is long enough to
// see its phases: a solo person with four Echoes sees at least twelve Orrery
// turns and all three phases before an ending.
//
// Held on the pure engine with whole fights played out: every person on the
// plate plays their role's policy (src/server/echoes.ts, the one fixed policy
// the app already has) at a person's full output, and every Echo is played by
// the clock as it is live. A scripted room isn't a real one, but it is the
// same room every run, so a retune that breaks the target goes red here.

interface PaceEngine extends Engine {
  start(b: Battle, by: string, c: ReturnType<typeof clock>): Step;
  seatEcho(b: Battle, who: { id: string; role: string; seatedBy: string }, c: ReturnType<typeof clock>): Step;
}

type Policy = { onTurn(state: unknown, id: string): { action: string; targetId: string | null } };

async function parts(): Promise<{ e: PaceEngine; policy: Policy }> {
  const e = (await engine()) as unknown as Record<string, unknown>;
  const missing = ["start", "seatEcho"].filter((name) => typeof e[name] !== "function");
  if (missing.length) throw new Error(`the battle engine doesn't export ${missing.join(", ")} yet (src/server/rules.ts)`);
  const policy = (await import(resolve("src/server/echoes.ts"))) as Policy;
  return { e: e as unknown as PaceEngine, policy };
}

interface Fight {
  outcome: string;
  bossTurns: number;
  playerTurns: number;
  /** The Orrery turn on which each phase line was crossed: [II, III]. */
  phases: number[];
  /** The phase each of those events named, in order: [2, 3] for a fight that saw both. */
  phaseNumbers: number[];
  /** The Orrery turn on which each Alignment resolved. */
  alignments: number[];
  /** The Orrery turn of the Alignment's wipe, if one came. */
  wipedAt: number | null;
  /** The log line the wipe wrote. */
  wipeLine: string | null;
}

const ACTION_KINDS = new Set([
  "brace", "intercept", "anchor", "bastion", "counterweight", "mend", "ward", "quicken", "restore", "jab", "cleave",
  "finisher", "feint", "scan", "pry", "mark", "shatter", "delay", "haste", "relay", "stillpoint",
]);

/** A private room's fight, played from Start to its ending: `people` as persons, `echoes` seated by the first. */
function play(e: PaceEngine, policy: Policy, people: string[], echoes: string[] = [], maxBossTurns = Infinity): Fight {
  let now = 9_000_000;
  const c = () => ({ ...clock(now), beatMs: 3_000 });
  let b = e.createBattle("pace", false, now);
  (b as Battle & { room: string | null }).room = "PACE1";
  people.forEach((role, i) => (b = e.join(b, { id: `p${i}`, name: `Person ${i}`, role }, c()).battle));
  echoes.forEach((role, i) => (b = e.seatEcho(b, { id: `e${i}`, role, seatedBy: "p0" }, c()).battle));
  b = e.start(b, "p0", c()).battle;

  const fight: Fight = { outcome: "", bossTurns: 0, playerTurns: 0, phases: [], phaseNumbers: [], alignments: [], wipedAt: null, wipeLine: null };
  const bossTurns = (x: Battle) => (x as Battle & { bossTurns: number }).bossTurns;
  const note = (step: Step) => {
    for (const ev of step.effects.events) {
      if (ev.kind === "phase") {
        fight.phases.push(bossTurns(step.battle));
        fight.phaseNumbers.push(Number(ev.phase));
      }
      if (ev.kind === "alignment") {
        fight.alignments.push(bossTurns(step.battle));
        if (ev.wipe) {
          fight.wipedAt = bossTurns(step.battle);
          fight.wipeLine = step.battle.log.find((l) => (l as { seq?: number }).seq === ev.seq)?.text ?? null;
        }
      }
      if (ACTION_KINDS.has(ev.kind) && typeof ev.actorId === "string" && ev.actorId !== "orrery" && ev.seq !== undefined) {
        const line = step.battle.log.find((l) => (l as { seq?: number }).seq === ev.seq);
        if (line?.kind === "action") fight.playerTurns++;
      }
    }
  };
  for (let i = 0; i < 200_000 && b.status === "fighting" && bossTurns(b) < maxBossTurns; i++) {
    now += 150;
    const up = b.standing.find((f) => f.id === b.activeId);
    if (up && up.kind === "character" && !up.echo && up.counter === 0) {
      now += 4_000; // a person takes a few seconds to decide
      const move = policy.onTurn(e.view(b, { tickMs: 0, turnMs: 12_000 }), up.id);
      const ok = "status" in e.checkAction(b, up.id, move.action, move.targetId) ? { action: "brace", targetId: null } : move;
      const step = e.act(b, up.id, ok.action, ok.targetId, c());
      note(step);
      b = step.battle;
      continue;
    }
    const step = e.advance(b, c());
    if (!step) continue;
    note(step);
    b = step.battle;
  }
  fight.outcome = b.status;
  fight.bossTurns = bossTurns(b);
  return fight;
}

const ROLES = ["warden", "mender", "striker", "breaker", "chronist"];
/** Whole fights played out on the engine: a few hundred ms alone, several times that in a parallel roster
 *  (the lobby gate's reviewer: the 5 s default went red under load). */
const WHOLE_FIGHTS_MS = 30_000;
/** ADR-010: about three player turns per Orrery turn. The band every room size must sit in. */
const BAND: [number, number] = [2.5, 4.5];

describe("the Orrery keeps the room's pace", () => {
  it("its turns per player turn stay within one band for a solo person with four Echoes, three people and five", async () => {
    const { e, policy } = await parts();
    // Rule 28's band, for the rooms ADR-010 claims it for: a solo person with the
    // four Echoes a solo visitor brings (three seats at the pull), three people,
    // and five. A room of one or two seats isn't held: its ratio is its players'
    // rank choices (a Striker who only Jabs, rank 1, takes three Quick turns to
    // one Standard), not the room's size. Measured, they ran from 2.1 to 7.7 by
    // role. (93304d1 had swapped one person with one Echo, which measured 2.42,
    // for one with two Echoes: a narrowing toward what passed, the lobby gate's
    // reviewer found. The rule now says which rooms it holds, and these are they.)
    const rooms: [string, string[], string[]][] = [
      ["one person, four Echoes", ["mender"], ["warden", "striker", "breaker", "chronist"]],
      ["three people, a Warden, Mender and Striker", ["warden", "mender", "striker"], []],
      ["three people, a Striker, Breaker and Chronist", ["striker", "breaker", "chronist"], []],
      ["five people", ROLES, []],
    ];
    for (const [what, people, echoes] of rooms) {
      const f = play(e, policy, people, echoes);
      const ratio = f.playerTurns / Math.max(1, f.bossTurns);
      expect(ratio, `${what}: ${f.playerTurns} player turns to ${f.bossTurns} Orrery turns`).toBeGreaterThanOrEqual(BAND[0]);
      expect(ratio, `${what}: ${f.playerTurns} player turns to ${f.bossTurns} Orrery turns`).toBeLessThanOrEqual(BAND[1]);
    }
  }, WHOLE_FIGHTS_MS);
});

describe("the fight is long enough to see its phases", () => {
  it("a solo person with four Echoes reaches phase III and takes at least twelve Orrery turns before the ending, in every role", async () => {
    const { e, policy } = await parts();
    for (const role of ROLES) {
      const echoes = ROLES.filter((r) => r !== role).slice(0, 4);
      const f = play(e, policy, [role], echoes);
      expect(["won", "lost"], `a ${role} with four Echoes reaches an ending`).toContain(f.outcome);
      expect(f.bossTurns, `a ${role} with four Echoes: the Orrery took ${f.bossTurns} turns`).toBeGreaterThanOrEqual(12);
      expect(f.phaseNumbers, `a ${role} with four Echoes saw phases II then III (at Orrery turns ${JSON.stringify(f.phases)})`).toEqual([2, 3]);
    }
  }, WHOLE_FIGHTS_MS);

  it("five people take about as long, and see every phase too", async () => {
    const { e, policy } = await parts();
    const f = play(e, policy, ROLES);
    // ADR-010's target for five people: twelve to thirty Orrery turns (the lobby gate's reviewer: 40 passed the
    // tuning ADR-010 rejected, 34 turns and a loss). And they win it: five roles, every one at the table.
    expect(f.bossTurns, `five people: the Orrery took ${f.bossTurns} turns`).toBeGreaterThanOrEqual(12);
    expect(f.bossTurns, "within ADR-010's thirty").toBeLessThanOrEqual(30);
    expect(f.outcome, "and the table wins").toBe("won");
    expect(f.phaseNumbers, `five people saw phases II then III (at Orrery turns ${JSON.stringify(f.phases)})`).toEqual([2, 3]);
  }, WHOLE_FIGHTS_MS);
});

describe("every fight ends (L1)", () => {
  // The lobby gate's L1: after ADR-010's retune, a heal-heavy room's damage
  // dealers fell and a lone Mender, Bracing and Warding, outlasted cards at
  // half the script's damage, with the Orrery above 35%, where the Grand
  // Alignment (which ends any fight that reaches phase III) never begins. An
  // Echo is the policy (rule 25) and a seat that times out becomes one (rule
  // 8), so a table whose people have walked away is this room, and a room with
  // a person seated in it never expires (rule 26). Every room of one to three
  // seats, played out by its roles' policies, reaches an ending within
  // MAX_TURNS Orrery turns, won or lost.
  const MAX_TURNS = 200;
  /** ADR-010's enrage clock, a tuning value marked ours: past the 12-30 target, so no fight that ends on its own meets it. */
  const ENRAGE_AFTER = 40;

  it("every room of one, two or three seats reaches an ending", async () => {
    const { e, policy } = await parts();
    const rooms: string[][] = [];
    for (let i = 0; i < ROLES.length; i++) {
      rooms.push([ROLES[i]]);
      for (let j = i; j < ROLES.length; j++) {
        rooms.push([ROLES[i], ROLES[j]]);
        for (let k = j + 1; k < ROLES.length; k++) if (i !== j) rooms.push([ROLES[i], ROLES[j], ROLES[k]]);
      }
    }
    const endless: string[] = [];
    for (const people of rooms) {
      const f = play(e, policy, people, [], MAX_TURNS);
      if (!["won", "lost"].includes(f.outcome)) endless.push(`${people.join("/")} (${f.bossTurns} Orrery turns, still ${f.outcome})`);
    }
    expect(endless, `rooms with no ending within ${MAX_TURNS} Orrery turns`).toEqual([]);
  }, WHOLE_FIGHTS_MS);

  it("past forty Orrery turns the Orrery enrages whatever the phase: every fourth card an Alignment, the third the wipe", async () => {
    // The owner's ruling on L1 (ADR-010, "The enrage"): the enrage clock is the Orrery's answer to a table that
    // only defends, and no fight may be endless. A Warden, Mender and Breaker stall in phase II under the
    // policies; past the clock they meet the Alignment, and the third to resolve ends the fight.
    const { e, policy } = await parts();
    const f = play(e, policy, ["warden", "mender", "breaker"], [], MAX_TURNS);
    expect(f.phaseNumbers.includes(3), "a table that never brought it to phase III").toBe(false);
    expect(f.alignments.length, "met the Alignment anyway").toBeGreaterThan(0);
    expect(f.alignments[0], `its first Alignment past the clock (at Orrery turn ${f.alignments[0]})`).toBeGreaterThan(ENRAGE_AFTER);
    expect(f.outcome, "and the third ended it: a wipe").toBe("lost");
    expect(f.wipedAt, "about twelve Orrery turns past the clock").toBeLessThanOrEqual(ENRAGE_AFTER + 4 * 3 + 2);
    // The fight log says so (the owner's ruling): the wipe is told as the enrage, not as phase III's Alignment.
    expect(f.wipeLine, "the wipe's line names the clock").toMatch(/forty|40/);
  }, WHOLE_FIGHTS_MS);

  it("no fight that ends on its own meets the enrage: every room in ADR-010's table ends before turn forty", async () => {
    const { e, policy } = await parts();
    const rooms: [string[], string[]][] = [
      ...ROLES.map((r) => [[r], ROLES.filter((x) => x !== r).slice(0, 4)] as [string[], string[]]),
      [["warden", "mender", "striker"], []],
      [["striker", "breaker", "chronist"], []],
      [ROLES, []],
    ];
    for (const [people, echoes] of rooms) {
      const f = play(e, policy, people, echoes);
      expect(f.bossTurns, `${people.join("/")}${echoes.length ? " + four Echoes" : ""} ended at Orrery turn ${f.bossTurns}`).toBeLessThan(ENRAGE_AFTER);
      expect(f.alignments.every((t) => f.phaseNumbers.includes(3) && t >= f.phases[1]), "any Alignment it met was phase III's own").toBe(true);
    }
  }, WHOLE_FIGHTS_MS);
});

describe("the Orrery's reset is the room's pace (ADR-010)", () => {
  type Reset = (b: Battle) => number;
  const resetOf = async (): Promise<{ e: PaceEngine; reset: Reset }> => {
    const { e } = await parts();
    const reset = (e as unknown as Record<string, unknown>).orreryReset;
    if (typeof reset !== "function") throw new Error("the battle engine doesn't export orreryReset yet (src/server/rules.ts)");
    return { e, reset: reset as Reset };
  };
  const roomOf = (e: PaceEngine, roles: string[]): Battle => {
    let b = e.createBattle("reset", false, 9_000_000);
    (b as Battle & { room: string | null }).room = "PACE2";
    roles.forEach((role, i) => (b = e.join(b, { id: `p${i}`, name: `P${i}`, role }, clock()).battle));
    return e.start(b, "p0", clock()).battle;
  };

  it("weights seats by their speed, not their number", async () => {
    const { e, reset } = await resetOf();
    const fast = reset(roomOf(e, ["chronist", "chronist", "chronist"]));
    const slow = reset(roomOf(e, ["warden", "warden", "warden"]));
    expect(fast, `three Chronists (tick speed 4) meet a faster Orrery than three Wardens (8): ${fast} against ${slow}`).toBeLessThan(slow);
    expect(slow / fast, "about as much faster as the Chronists are").toBeCloseTo(2, 0);
  });

  it("a bigger room meets a faster Orrery, and a seat downed slows it", async () => {
    const { e, reset } = await resetOf();
    const one = reset(roomOf(e, ["striker"]));
    const three = reset(roomOf(e, ["striker", "striker", "striker"]));
    expect(one / three, `three Strikers come round three times as often as one: ${one} against ${three}`).toBeCloseTo(3, 0);
    const b = roomOf(e, ["striker", "striker", "striker"]);
    const downed = structuredClone(b);
    const gone = downed.standing.find((f) => f.id === "p2")!;
    downed.standing = downed.standing.filter((f) => f.id !== "p2");
    downed.fallen.push({ ...gone, hp: 0 });
    expect(reset(downed), "with one downed, it slows to the two left").toBe(reset(roomOf(e, ["striker", "striker"])));
  });

  it("never resets below two ticks, and its first turn comes at the room's pace", async () => {
    const { e, reset } = await resetOf();
    const crowd = roomOf(e, ["chronist", "chronist", "chronist", "chronist", "chronist"]);
    const many = structuredClone(crowd);
    for (let i = 0; i < 40; i++) many.standing.push({ ...many.standing.find((f) => f.id === "p0")!, id: `x${i}` });
    expect(reset(many), "forty-five fast seats: still two ticks").toBe(2);
    const b = roomOf(e, ["striker", "striker", "striker"]);
    expect(b.standing.find((f) => f.id === "orrery")!.counter, "the Orrery's first counter, set at Start, is the room's reset").toBe(reset(b));
  });
});
