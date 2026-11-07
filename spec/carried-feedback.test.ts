import { describe, expect, it } from "vitest";
import { bossTurn, engine, lobbyTable, turn, type Battle, type Engine, type Step } from "./engine.ts";

// The feedback gate's findings (docs/review/feedback.md), each a spec ahead of
// its fix. The reviewer's 1a, 1b, 1c and 1f, and the weak tests 3a and 3b: the
// ending is the truth of the fight in situations piece 1's spec didn't set up.

interface Ending {
  outcome: string;
  intent: string | null;
  targetId: string | null;
  found: string[];
  answers: { role: string; action: string; by: string | null }[];
  by: string | null;
  brokenBy: string | null;
  chain: number;
  line: string;
}

const clockAt = { now: 1_000_000, turnMs: 12_000 };
const edit = (b: Battle, change: (x: Battle) => void): Battle => {
  const next = structuredClone(b);
  change(next);
  return next;
};
const endOf = (s: Step): Ending => {
  const e = s.effects.events.find((ev) => ev.kind === "end")?.ending as Ending | undefined;
  if (!e) throw new Error(`no ending in this step (status ${s.battle.status})`);
  return e;
};
const said = (a: Ending["answers"]) => a.map((x) => `${x.role}:${x.action}:${x.by ?? "-"}`);
type Ext = Engine & { echoMove(b: Battle, id: string, clock: typeof clockAt): Step };

async function room(people: string[], echoes: string[] = []) {
  const e = (await engine()) as Ext;
  const b = lobbyTable(
    e,
    people,
    echoes.map((r, i) => ({ id: `${r}-echo-${i}`, role: r })),
  );
  return { e, b };
}

/** Everyone but `keep` is already down, and the strip is clear. */
function leaveOnly(b: Battle, keep: string[]): Battle {
  return edit(b, (x) => {
    for (const f of x.standing.filter((f) => f.kind === "character" && !keep.includes(f.id))) {
      f.hp = 0;
      x.fallen.push(f);
    }
    x.standing = x.standing.filter((f) => f.kind !== "character" || keep.includes(f.id));
    (x as Battle & { someoneFell: boolean }).someoneFell = true;
    x.cards = [];
  });
}
const fighterIn = (b: Battle, id: string) => b.standing.find((f) => f.id === id)!;

describe("1a: an Echo's turns are the Echo's, in the ending too (rules 8 and 25)", () => {
  it("a timed-out seat's Echo lands the last blow: the ending never credits its person", async () => {
    const { e, b: started } = await room(["striker", "warden"]);
    // The Warden's person timed out three times: their seat is an Echo now, playing its policy.
    const b = edit(started, (x) => {
      x.cards = [];
      fighterIn(x, "orrery").hp = 1;
      const w = fighterIn(x, "warden-2");
      w.echo = true;
      (w as typeof w & { timeouts: number }).timeouts = 3;
    });
    const step = e.echoMove(e.plate(b, "warden-2", clockAt), "warden-2", clockAt);
    expect(step.battle.status, "the Echo's blow ends it").toBe("won");
    const ending = endOf(step);
    expect(ending.line, "the line speaks of the Echo, as the blow's own line did").toMatch(/^The Echo of warden 2's /);
    expect(ending.line, "never of the person as if they struck it").not.toMatch(/^warden 2's /);
  });

  it("a timed-out seat's Echo Breaks the ring: the ending says the Echo Broke it", async () => {
    const { e, b: started } = await room(["striker", "breaker"]);
    let b = edit(started, (x) => {
      x.cards = [];
      fighterIn(x, "orrery").hp = 1;
      fighterIn(x, "striker-1").resource = 3;
      // Every weakness revealed, so the Echo's policy doesn't Scan first; the outer ring thin enough to Shatter.
      for (const r of x.rings) r.weakness = (r as typeof r & { element: string }).element as typeof r.weakness;
      x.rings.find((r) => r.id === "outer")!.pips = 1;
      const bk = fighterIn(x, "breaker-2");
      bk.echo = true;
      bk.resource = 3;
      bk.charge = 0;
      (bk as typeof bk & { timeouts: number }).timeouts = 3;
    });
    b = e.echoMove(e.plate(b, "breaker-2", clockAt), "breaker-2", clockAt).battle;
    expect(b.rings.find((r) => r.id === "outer")!.broken, "the Echo's Shatter Broke the outer ring").toBe(true);
    const ending = endOf(turn(e, b, "striker-1", "finisher", "outer"));
    expect(ending.line).toContain("The Echo of breaker 2 Broke the ring.");
  });
});

describe("1b: the answers are the ones the table had and didn't make, when the card landed", () => {
  it("a Braced seat downed by a halved blow is never told its Brace would have met it", async () => {
    const { e, b: started } = await room(["striker"], ["mender"]);
    let b = leaveOnly(started, ["striker-1"]);
    b = edit(b, (x) => {
      const s = fighterIn(x, "striker-1");
      s.braced = true;
      s.hp = 5;
    });
    b = e.announce(b, { intent: "eclipse", targetId: "striker-1", amount: 40, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending.found, "it was Braced").not.toContain("unbraced");
    expect(said(ending.answers), "the Brace it made is no answer it lacked").not.toContain("striker:brace:striker-1");
    expect(ending.line).not.toMatch(/striker 1's Brace would have met it/);
  });

  it("a Perihelion that met a standing Bastion and still downed the last seat doesn't list the Bastion", async () => {
    const { e, b: started } = await room(["warden"]);
    let b = leaveOnly(started, ["warden-1"]);
    b = edit(b, (x) => {
      (x as Battle & { bastion: boolean; bastionCut: number }).bastion = true;
      (x as Battle & { bastionCut: number }).bastionCut = 0.6;
      fighterIn(x, "warden-1").hp = 3;
    });
    b = e.announce(b, { intent: "perihelion", targetId: "party", amount: 180, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending.found, "a Bastion stood").not.toContain("no-bastion");
    expect(said(ending.answers), "the Bastion was made").not.toContain("warden:bastion:warden-1");
  });

  it("a Warden who is the card's own target is never offered Anchor (the server refuses it)", async () => {
    const { e, b: started } = await room(["warden"], ["mender"]);
    let b = leaveOnly(started, ["warden-1"]);
    b = edit(b, (x) => (fighterIn(x, "warden-1").gravity = 2));
    b = e.announce(b, { intent: "lunge", targetId: "warden-1", amount: 20, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(said(ending.answers), "Anchor can't take your own blow").not.toContain("warden:anchor:warden-1");
    expect(said(ending.answers), "Intercept can: it stands into it and Wards").toContain("warden:intercept:warden-1");
  });

  it("a person already downed when the card landed is never named as holding an answer", async () => {
    const { e, b: started } = await room(["striker", "mender"]);
    // The Mender person fell earlier; the Eclipse that ends it finds them gone.
    let b = leaveOnly(started, ["striker-1"]);
    b = e.announce(b, { intent: "eclipse", targetId: "striker-1", amount: 20, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(said(ending.answers), "the downed Mender couldn't Ward anyone").not.toContain("mender:ward:mender-2");
    expect(ending.answers.every((a) => a.by !== "mender-2"), "not named for any answer").toBe(true);
  });

  it("every answer already made: the line says so, and lists none", async () => {
    const { e, b: started } = await room(["striker"]);
    let b = leaveOnly(started, ["striker-1"]);
    b = edit(b, (x) => {
      const s = fighterIn(x, "striker-1");
      s.braced = true;
      s.hp = 2;
      s.reactionReady = false;
    });
    b = e.announce(b, { intent: "eclipse", targetId: "striker-1", amount: 40, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending.answers).toEqual([]);
    expect(ending.line).toBe("Eclipse landed on striker 1, unwarded. It was met, and still took the last of them.");
  });
});

describe("1c: a Reaction against a blow aimed at you is an answer (ADR-011)", () => {
  for (const [role, reaction] of [
    ["striker", "riposte"],
    ["chronist", "nudge"],
  ] as const) {
    it(`a ${role} downed by a Lunge aimed at them is told of their own ${reaction}`, async () => {
      const { e, b: started } = await room([role]);
      let b = leaveOnly(started, [`${role}-1`]);
      b = edit(b, (x) => (fighterIn(x, `${role}-1`).gravity = 2));
      b = e.announce(b, { intent: "lunge", targetId: `${role}-1`, amount: 20, countdown: 0 });
      const ending = endOf(bossTurn(e, b));
      expect(said(ending.answers)).toContain(`${role}:${reaction}:${role}-1`);
    });
  }
});

describe("1f: Conjunction's line names both cancels (ADR-011, the owner's ruling on C5)", () => {
  it("a Chronist or a Breaker's charged Shatter cancels a Retrograde", async () => {
    const e = await engine();
    const { table } = await import("./engine.ts");
    let b = structuredClone(table(e, ["striker"]));
    const boss = b.standing.find((f) => f.id === "orrery")!;
    boss.hp = Math.ceil(boss.maxHp * 0.71);
    b = e.plate(b, "striker-1", clockAt);
    const phase = e.act(b, "striker-1", "cleave", "outer", clockAt).effects.events.find((ev) => ev.kind === "phase");
    expect(phase?.change).toBe("Conjunction: the Orrery flips the strip; a Chronist, or a Breaker's charged Shatter, cancels it. Every weakness hides again.");
  });
});

describe("3a and 3b: the longest Chain, and the clock's Alignment", () => {
  it("the longest Chain is the longest, not the one standing at the end", async () => {
    const { e, b: started } = await room(["striker", "warden"]);
    let b = edit(started, (x) => (x.cards = []));
    // Three links, then a boss turn breaks it, then one more link ends the fight.
    b = turn(e, b, "striker-1", "jab", "outer").battle;
    b = turn(e, b, "warden-2", "brace").battle;
    b = turn(e, b, "striker-1", "jab", "outer").battle;
    b = bossTurn(e, edit(b, (x) => (x.cards = []))).battle;
    b = edit(b, (x) => (fighterIn(x, "orrery").hp = 1));
    const ending = endOf(turn(e, b, "striker-1", "jab", "outer"));
    expect(ending.chain, "three links before the boss turn broke it").toBe(3);
    expect(ending.line).toMatch(/The longest Chain was 3\.$/);
  });

  it("an Alignment the clock began says the clock began it, with the server's own turn count", async () => {
    const { e, b: started } = await room(["chronist"]);
    const { ENRAGE_AFTER } = (await import("../src/server/tuning.ts")) as { ENRAGE_AFTER: number };
    let b = edit(started, (x) => {
      x.cards = [];
      const s = (x as Battle & { orreryScript: { aligned: number; enraged: boolean } }).orreryScript;
      s.aligned = 2;
      s.enraged = true;
    });
    b = e.announce(b, { intent: "alignment", targetId: "party", amount: null, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending.line).toBe(`The Grand Alignment completed. Nothing answers it but the Orrery falling first. The clock began it: the Orrery had turned ${ENRAGE_AFTER} times.`);
  });
});
