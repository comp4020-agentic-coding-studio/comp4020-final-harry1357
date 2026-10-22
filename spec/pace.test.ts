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
  /** Every Alignment's log line, in order. */
  alignmentLines: string[];
  /** The intent of every card announced after the Orrery's ENRAGE_AFTER-th turn, in order. */
  cardsAfterClock: string[];
  /** The strip's clock (the state's alignmentLeft) on each Orrery turn, by turn. */
  clockAt: Record<number, number | null>;
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

  const fight: Fight = { outcome: "", bossTurns: 0, playerTurns: 0, phases: [], phaseNumbers: [], alignments: [], wipedAt: null, wipeLine: null, alignmentLines: [], cardsAfterClock: [], clockAt: {} };
  const bossTurns = (x: Battle) => (x as Battle & { bossTurns: number }).bossTurns;
  const note = (step: Step) => {
    const turn = bossTurns(step.battle);
    if (!(turn in fight.clockAt)) fight.clockAt[turn] = (e.view(step.battle, { tickMs: 0, turnMs: 12_000 }) as { alignmentLeft?: number | null }).alignmentLeft ?? null;
    for (const ev of step.effects.events) {
      if (ev.kind === "phase") {
        fight.phases.push(bossTurns(step.battle));
        fight.phaseNumbers.push(Number(ev.phase));
      }
      if (ev.kind === "card" && bossTurns(step.battle) >= 40) fight.cardsAfterClock.push(String((ev.card as { intent: string }).intent));
      if (ev.kind === "alignment") {
        fight.alignmentLines.push(step.battle.log.find((l) => (l as { seq?: number }).seq === ev.seq)?.text ?? "");
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
    expect(f.phaseNumbers, "a table that stalls in phase II, never reaching phase III").toEqual([2]);
    // The clock starts at exactly forty (the confirm pass's F3, F4): the strip's clock is null before, and all
    // three Alignments to come from the fortieth Orrery turn on.
    expect(f.clockAt[ENRAGE_AFTER - 1], "no clock on the Orrery's thirty-ninth turn").toBeNull();
    expect(f.clockAt[ENRAGE_AFTER], "the strip's clock at three on its fortieth").toBe(3);
    // Every fourth card of the rotation after it, as in phase III: three before the first Alignment (F3, F6).
    // A Perihelion is the Orrery's other cadence, announced besides the rotation, so it isn't counted; phase
    // III counts the same way.
    const rotation = f.cardsAfterClock.filter((c) => c !== "perihelion");
    expect(rotation.indexOf("alignment"), `the first Alignment is the fourth card after the clock: ${rotation.join(", ")}`).toBe(3);
    const at = rotation.flatMap((c, i) => (c === "alignment" ? [i] : []));
    expect(at.slice(1).map((x, i) => x - at[i]), `Alignments four cards apart: ${rotation.join(", ")}`).toEqual(at.slice(1).map(() => 4));
    // Exactly three resolve, and the third is the wipe (F3).
    expect(f.alignments.length, "three Alignments resolve").toBe(3);
    expect(f.wipedAt, "the third is the wipe").toBe(f.alignments[2]);
    // When (the second confirm pass's 2: the bound f15b4fe dropped). The first Alignment is the fourth card of
    // the rotation after the clock, a card announced at most AHEAD (two) Orrery turns before it resolves, and the
    // others follow four cards apart; so the first lands within six Orrery turns of the clock and each after it
    // within six of the last. ADR-010's Cost: the wipe about twelve to sixteen Orrery turns after the clock.
    expect(f.alignments[0] - ENRAGE_AFTER, `the first Alignment within six Orrery turns of the clock (at ${f.alignments[0]})`).toBeLessThanOrEqual(6);
    expect(f.alignments[1] - f.alignments[0], "the second within six of the first").toBeLessThanOrEqual(6);
    expect(f.alignments[2] - f.alignments[1], "the third within six of the second").toBeLessThanOrEqual(6);
    expect((f.wipedAt as number) - ENRAGE_AFTER, `the wipe twelve to sixteen Orrery turns after the clock (at ${f.wipedAt})`).toBeGreaterThanOrEqual(12);
    expect((f.wipedAt as number) - ENRAGE_AFTER, "no more than sixteen").toBeLessThanOrEqual(16);
    expect(f.outcome, "which ends the fight").toBe("lost");
    // The fight log says so (the owner's ruling): every line of it, the wipe's included.
    expect(f.alignmentLines.every((l) => /40 times/.test(l)), "every Alignment line names the clock").toBe(true);
  }, WHOLE_FIGHTS_MS);

  it("a table that crosses into phase III after the clock is still told the clock began it (F1)", async () => {
    // The confirm pass's F1: the reason was read from the phase each Alignment resolved in, so a slow table that
    // crossed 35% after turn forty met a wipe the clock began, and no line said so. Rule 28: "its log saying the
    // clock began it". The stalled Warden, Mender and Breaker play by their policies past the clock; then a
    // Striker sits down late (a real join), the Orrery is set a hair above 35%, and the Striker's own blows,
    // through the engine, carry it across.
    const { e, policy } = await parts();
    let b = e.createBattle("f1", false, 9_000_000);
    (b as Battle & { room: string | null }).room = "F1";
    for (const [i, role] of ["warden", "mender", "breaker"].entries()) b = e.join(b, { id: `p${i}`, name: `P${i}`, role }, clock()).battle;
    b = e.start(b, "p0", clock()).battle;
    const turns = (x: Battle) => (x as Battle & { bossTurns: number }).bossTurns;
    const lines: string[] = [];
    const inPhase: number[] = [];
    let phaseLine = "";
    let primed = false;
    let crossedAt: number | null = null;
    for (let i = 0; i < 200_000 && b.status === "fighting" && turns(b) < 200; i++) {
      if (!primed && turns(b) >= ENRAGE_AFTER + 1) {
        b = e.join(b, { id: "late", name: "Late Striker", role: "striker" }, clock()).battle;
        b = structuredClone(b);
        const boss = b.standing.find((f) => f.id === "orrery")!;
        boss.hp = Math.ceil(boss.maxHp * 0.35) + 1;
        primed = true;
      }
      const up = b.standing.find((f) => f.id === b.activeId);
      let step: Step | null;
      if (up && up.kind === "character" && up.counter === 0) {
        const move = policy.onTurn(e.view(b, { tickMs: 0, turnMs: 12_000 }), up.id);
        const ok = "status" in e.checkAction(b, up.id, move.action, move.targetId) ? { action: "brace", targetId: null } : move;
        step = e.act(b, up.id, ok.action, ok.targetId, clock());
      } else step = e.advance(b, clock());
      if (!step) continue;
      for (const ev of step.effects.events) {
        const line = step.battle.log.find((l) => (l as { seq?: number }).seq === ev.seq)?.text ?? "";
        if (ev.kind === "phase" && ev.phase === 3) {
          crossedAt = turns(step.battle);
          phaseLine = line;
        }
        if (ev.kind === "alignment") {
          lines.push(line);
          inPhase.push(step.battle.phase);
        }
      }
      b = step.battle;
    }
    expect(crossedAt, "the table crossed into phase III after the clock").not.toBeNull();
    expect(crossedAt as number, "after it").toBeGreaterThanOrEqual(ENRAGE_AFTER);
    // Its phase line says the clock began it, not that it begins now (the first confirm pass's F1, its other half).
    expect(phaseLine, "the phase III line says it was already begun by the clock").toMatch(/already begun by the clock/);
    expect(phaseLine, "not that it begins").not.toMatch(/begins:/);
    // At least one Alignment the clock began resolves in phase III, so the old phase-read reason can't pass
    // (the second confirm pass's 4): and every line says the clock began it.
    expect(inPhase.filter((p) => p === 3).length, `an Alignment the clock began lands in phase III (phases ${JSON.stringify(inPhase)})`).toBeGreaterThan(0);
    expect(lines.every((l) => /40 times/.test(l)), `every line says the clock began it: ${JSON.stringify(lines)}`).toBe(true);
  }, WHOLE_FIGHTS_MS);

  it("a table already in phase III at the clock keeps phase III's own Grand Alignment: its reason and its count (2nd pass, 3)", async () => {
    // The second confirm pass's 3: a table in phase III before turn forty and still fighting at it was never held.
    // Its Grand Alignment was begun by phase III, not the clock: no line of it claims the clock, and its count
    // isn't restarted at forty.
    const { e } = await parts();
    let b = e.createBattle("p3", false, 9_000_000);
    (b as Battle & { room: string | null }).room = "P3";
    for (const [i, role] of ["warden", "mender", "mender"].entries()) b = e.join(b, { id: `p${i}`, name: `P${i}`, role }, clock()).battle;
    b = e.start(b, "p0", clock()).battle;
    const turns = (x: Battle) => (x as Battle & { bossTurns: number }).bossTurns;
    const lines: string[] = [];
    const cards: [number, string][] = [];
    let entered = false;
    for (let i = 0; i < 400_000 && b.status === "fighting" && turns(b) < 120; i++) {
      // Into phase III at turn 34, with too few Alignments to come before the clock to end it there.
      if (!entered && turns(b) >= ENRAGE_AFTER - 6) {
        b = structuredClone(b);
        b.phase = 3;
        b.standing.find((f) => f.id === "orrery")!.hp = Math.floor(b.standing.find((f) => f.id === "orrery")!.maxHp * 0.3);
        entered = true;
      }
      const up = b.standing.find((f) => f.id === b.activeId);
      const step =
        up && up.kind === "character" && up.counter === 0
          ? e.act(b, up.id, up.role === "mender" ? "ward" : "brace", up.role === "mender" ? up.id : null, clock())
          : e.advance(b, clock());
      if (!step) continue;
      for (const ev of step.effects.events) {
        if (ev.kind === "card" && entered) cards.push([turns(step.battle), String((ev.card as { intent: string }).intent)]);
        if (ev.kind === "alignment") lines.push(step.battle.log.find((l) => (l as { seq?: number }).seq === ev.seq)?.text ?? "");
      }
      b = step.battle;
    }
    expect(turns(b), "the table was still fighting past the clock").toBeGreaterThan(ENRAGE_AFTER);
    expect(lines.length, "its phase III Alignments resolved").toBeGreaterThan(0);
    expect(lines.filter((l) => /40 times/.test(l)), "none claims the clock: phase III began them").toEqual([]);
    const rotation = cards.map(([, c]) => c).filter((c) => c !== "perihelion");
    const at = rotation.flatMap((c, i) => (c === "alignment" ? [i] : []));
    expect(at.slice(1).map((x, i) => x - at[i]), `its Alignments four cards apart across the clock: ${rotation.join(", ")}`).toEqual(at.slice(1).map(() => 4));
  }, WHOLE_FIGHTS_MS);

  it("an enraged Grand Alignment goes on across a phase line: four cards apart still (2nd pass, 5)", async () => {
    // ADR-010: the Grand Alignment, begun by the clock, "goes on" if the table crosses into phase III; its count
    // restarted on the phase change, putting two Alignments up to seven cards apart.
    const { e, policy } = await parts();
    let b = e.createBattle("go", false, 9_000_000);
    (b as Battle & { room: string | null }).room = "GO";
    for (const [i, role] of ["warden", "mender", "breaker"].entries()) b = e.join(b, { id: `p${i}`, name: `P${i}`, role }, clock()).battle;
    b = e.start(b, "p0", clock()).battle;
    const turns = (x: Battle) => (x as Battle & { bossTurns: number }).bossTurns;
    const cards: string[] = [];
    let crossed = false;
    for (let i = 0; i < 400_000 && b.status === "fighting" && turns(b) < 120; i++) {
      // Past the clock, two cards after its first Alignment was announced (mid-way through the next four), the table
      // crosses into phase III: a recount there would put the next Alignment six cards on, not two.
      const sinceFirst = cards.filter((c) => c !== "perihelion").length - 1 - cards.filter((c) => c !== "perihelion").indexOf("alignment");
      if (!crossed && cards.includes("alignment") && sinceFirst >= 2) {
        b = structuredClone(b);
        b.phase = 3;
        crossed = true;
      }
      const up = b.standing.find((f) => f.id === b.activeId);
      let step: Step | null;
      if (up && up.kind === "character" && up.counter === 0) {
        const move = policy.onTurn(e.view(b, { tickMs: 0, turnMs: 12_000 }), up.id);
        const ok = "status" in e.checkAction(b, up.id, move.action, move.targetId) ? { action: "brace", targetId: null } : move;
        step = e.act(b, up.id, ok.action, ok.targetId, clock());
      } else step = e.advance(b, clock());
      if (!step) continue;
      for (const ev of step.effects.events) if (ev.kind === "card" && turns(step.battle) >= ENRAGE_AFTER) cards.push(String((ev.card as { intent: string }).intent));
      b = step.battle;
    }
    expect(crossed, "the table crossed into phase III during the enrage").toBe(true);
    const rotation = cards.filter((c) => c !== "perihelion");
    const at = rotation.flatMap((c, i) => (c === "alignment" ? [i] : []));
    expect(at.length, "more than one Alignment, either side of the line").toBeGreaterThan(1);
    expect(at.slice(1).map((x, i) => x - at[i]), `four cards apart across the phase line: ${rotation.join(", ")}`).toEqual(at.slice(1).map(() => 4));
  }, WHOLE_FIGHTS_MS);

  it("of the thirty rooms of one to three seats, every one that ends before the clock never meets it (F2)", async () => {
    // The confirm pass's F2: "no fight that ends on its own meets it" was held for ADR-010's eight rooms, not for
    // the thirty L1 lives in. Every one of the thirty that ends before turn forty meets no Alignment it didn't
    // earn in phase III, and the seven that run past it are the ones the owner's ruling is about. One of those,
    // a Mender, Breaker and Chronist, ended on its own before this pass, at 75 Orrery turns, and now meets the
    // clock at 48 (ADR-010's Cost: a slow table can be wiped). The seven are named, so a change to either side
    // of the line is seen.
    const { e, policy } = await parts();
    const rooms: string[][] = [];
    for (let i = 0; i < ROLES.length; i++) {
      rooms.push([ROLES[i]]);
      for (let j = i; j < ROLES.length; j++) {
        rooms.push([ROLES[i], ROLES[j]]);
        for (let k = j + 1; k < ROLES.length; k++) if (i !== j) rooms.push([ROLES[i], ROLES[j], ROLES[k]]);
      }
    }
    const past: string[] = [];
    for (const people of rooms) {
      const f = play(e, policy, people, [], MAX_TURNS);
      if (f.bossTurns >= ENRAGE_AFTER) past.push(people.join("/"));
      else expect(f.alignments.every((t) => f.phaseNumbers.includes(3) && t >= f.phases[f.phaseNumbers.indexOf(3)]), `${people.join("/")} ended at ${f.bossTurns}, every Alignment it met phase III's own`).toBe(true);
    }
    expect(past.sort(), "the rooms that run past the clock").toEqual(
      ["mender", "mender/mender", "mender/breaker", "warden/mender/breaker", "warden/mender/chronist", "mender/striker/chronist", "mender/breaker/chronist"].sort(),
    );
  }, WHOLE_FIGHTS_MS);

  it("phase III's own Grand Alignment says nothing of the clock (F5)", async () => {
    // A table that reaches phase III well before the clock and then only Braces: phase III's own Alignments
    // resolve, three of them, the third the wipe, and none of their lines claims the clock. (A table that wins
    // in phase III meets no Alignment at all, which would hold nothing: the confirm pass's F5, held for real.)
    const { e } = await parts();
    let b = e.createBattle("f5", false, 9_000_000);
    (b as Battle & { room: string | null }).room = "F5";
    for (const [i, role] of ["warden", "mender", "striker"].entries()) b = e.join(b, { id: `p${i}`, name: `P${i}`, role }, clock()).battle;
    b = e.start(b, "p0", clock()).battle;
    const ready = e.plate(structuredClone(b), "p2", clock());
    const boss = ready.standing.find((f) => f.id === "orrery")!;
    boss.hp = Math.ceil(boss.maxHp * 0.35) + 1;
    const entered = e.act(ready, "p2", "cleave", "outer", clock());
    expect(entered.effects.events.filter((ev) => ev.kind === "phase").map((ev) => ev.phase), "a blow carries it through II into phase III").toContain(3);
    b = entered.battle;
    const turns = (x: Battle) => (x as Battle & { bossTurns: number }).bossTurns;
    const lines: string[] = [];
    for (let i = 0; i < 200_000 && b.status === "fighting" && turns(b) < ENRAGE_AFTER; i++) {
      const up = b.standing.find((f) => f.id === b.activeId);
      const step = up && up.kind === "character" && up.counter === 0 ? e.act(b, up.id, "brace", null, clock()) : e.advance(b, clock());
      if (!step) continue;
      for (const ev of step.effects.events) if (ev.kind === "alignment") lines.push(step.battle.log.find((l) => (l as { seq?: number }).seq === ev.seq)?.text ?? "");
      b = step.battle;
    }
    expect(turns(b), "it all happened before the clock").toBeLessThan(ENRAGE_AFTER);
    expect(lines.length, "phase III's own Alignments resolved, to the wipe").toBe(3);
    expect(lines.filter((l) => /40 times/.test(l)), "and none of them claims the clock").toEqual([]);
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
