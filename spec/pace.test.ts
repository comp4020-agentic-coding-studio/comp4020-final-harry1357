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
}

const ACTION_KINDS = new Set([
  "brace", "intercept", "anchor", "bastion", "counterweight", "mend", "ward", "quicken", "restore", "jab", "cleave",
  "finisher", "feint", "scan", "pry", "mark", "shatter", "delay", "haste", "relay", "stillpoint",
]);

/** A private room's fight, played from Start to its ending: `people` as persons, `echoes` seated by the first. */
function play(e: PaceEngine, policy: Policy, people: string[], echoes: string[] = []): Fight {
  let now = 9_000_000;
  const c = () => ({ ...clock(now), beatMs: 3_000 });
  let b = e.createBattle("pace", false, now);
  (b as Battle & { room: string | null }).room = "PACE1";
  people.forEach((role, i) => (b = e.join(b, { id: `p${i}`, name: `Person ${i}`, role }, c()).battle));
  echoes.forEach((role, i) => (b = e.seatEcho(b, { id: `e${i}`, role, seatedBy: "p0" }, c()).battle));
  b = e.start(b, "p0", c()).battle;

  const fight: Fight = { outcome: "", bossTurns: 0, playerTurns: 0, phases: [] };
  const bossTurns = (x: Battle) => (x as Battle & { bossTurns: number }).bossTurns;
  const note = (step: Step) => {
    for (const ev of step.effects.events) {
      if (ev.kind === "phase") fight.phases.push(bossTurns(step.battle));
      if (ACTION_KINDS.has(ev.kind) && typeof ev.actorId === "string" && ev.actorId !== "orrery" && ev.seq !== undefined) {
        const line = step.battle.log.find((l) => (l as { seq?: number }).seq === ev.seq);
        if (line?.kind === "action") fight.playerTurns++;
      }
    }
  };
  for (let i = 0; i < 200_000 && b.status === "fighting"; i++) {
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
/** ADR-010: about three player turns per Orrery turn. The band every room size must sit in. */
const BAND: [number, number] = [2.5, 4.5];

describe("the Orrery keeps the room's pace", () => {
  it("its turns per player turn stay within one band across one, three and five seats", async () => {
    const { e, policy } = await parts();
    const rooms: [string, string[], string[]][] = [
      ["one person, four Echoes", ["mender"], ["warden", "striker", "breaker", "chronist"]],
      ["one person, one Echo", ["warden"], ["mender"]],
      ["three people", ["warden", "mender", "striker"], []],
      ["five people", ROLES, []],
    ];
    for (const [what, people, echoes] of rooms) {
      const f = play(e, policy, people, echoes);
      const ratio = f.playerTurns / Math.max(1, f.bossTurns);
      expect(ratio, `${what}: ${f.playerTurns} player turns to ${f.bossTurns} Orrery turns`).toBeGreaterThanOrEqual(BAND[0]);
      expect(ratio, `${what}: ${f.playerTurns} player turns to ${f.bossTurns} Orrery turns`).toBeLessThanOrEqual(BAND[1]);
    }
  });
});

describe("the fight is long enough to see its phases", () => {
  it("a solo person with four Echoes reaches phase III and takes at least twelve Orrery turns before the ending, in every role", async () => {
    const { e, policy } = await parts();
    for (const role of ROLES) {
      const echoes = ROLES.filter((r) => r !== role).slice(0, 4);
      const f = play(e, policy, [role], echoes);
      expect(["won", "lost"], `a ${role} with four Echoes reaches an ending`).toContain(f.outcome);
      expect(f.bossTurns, `a ${role} with four Echoes: the Orrery took ${f.bossTurns} turns`).toBeGreaterThanOrEqual(12);
      expect(f.phases.length, `a ${role} with four Echoes saw phase lines at Orrery turns ${JSON.stringify(f.phases)}`).toBe(2);
    }
  });

  it("five people take about as long, and see every phase too", async () => {
    const { e, policy } = await parts();
    const f = play(e, policy, ROLES);
    expect(f.bossTurns, `five people: the Orrery took ${f.bossTurns} turns`).toBeGreaterThanOrEqual(12);
    expect(f.bossTurns, "but not an endless fight").toBeLessThanOrEqual(40);
    expect(f.phases.length, `five people saw phase lines at Orrery turns ${JSON.stringify(f.phases)}`).toBe(2);
  });
});
