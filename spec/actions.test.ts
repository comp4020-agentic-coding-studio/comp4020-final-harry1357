import { describe, expect, it } from "vitest";
import { announced, bossTurn, clock, engine, events, fighter, ring, table, turn, type Battle } from "./engine.ts";

// What each action does, not only that it fires (review R6; ADR-006 §Decision,
// "every role gets one action that changes the turn strip"). Each claim is the
// effect itself, pinned to the number in src/server/tuning.ts, so an action
// that emits its event and does nothing fails here. The strip-changing actions
// come first: they are what ADR-006 rests on.

const tuning = await import("../src/server/tuning.ts");

/** A battle with a few changes made directly, the way a test sets a situation. */
function edit(b: Battle, change: (b: Battle) => void): Battle {
  const next = structuredClone(b);
  change(next);
  return next;
}

describe("the strip-changing actions move the strip", () => {
  it("Quicken (Mender) cuts an ally's wait by 30%: they move up", async () => {
    const e = await engine();
    const b = table(e, ["mender", "striker"]);
    // Put the Mender on the plate with the ally well back, so there's a wait to cut.
    const ready = edit(e.plate(b, "mender-1", clock()), (x) => (x.standing.find((f) => f.id === "striker-2")!.counter = 20));
    const before = fighter(ready, "striker-2").counter;
    const step = e.act(ready, "mender-1", "quicken", "striker-2", clock());
    expect(fighter(step.battle, "striker-2").counter, "the ally's counter is cut by QUICKEN_CUT").toBe(
      Math.max(1, Math.floor(before * (1 - tuning.QUICKEN_CUT))),
    );
    expect(fighter(step.battle, "striker-2").counter, "which is a real cut").toBeLessThan(before);
  });

  it("Delay (Chronist) pushes the next boss card back a slot", async () => {
    const e = await engine();
    const b = e.announce(table(e, ["chronist", "striker"]), { intent: "eclipse", targetId: "striker-2", amount: 20, countdown: 1 });
    const card = announced(b);
    const step = turn(e, b, "chronist-1", "delay", card.id);
    expect(step.battle.cards.find((c) => c.id === card.id)?.countdown, "one slot later").toBe(2);
  });

  it("Stillpoint (Chronist) freezes a boss card", async () => {
    const e = await engine();
    let b = e.announce(table(e, ["chronist", "striker"]), { intent: "eclipse", targetId: "striker-2", amount: 20, countdown: 1 });
    b = edit(b, (x) => (x.standing.find((f) => f.id === "chronist-1")!.resource = tuning.FLUX_MAX));
    const card = announced(b);
    const step = turn(e, b, "chronist-1", "stillpoint", card.id);
    expect(step.battle.cards.find((c) => c.id === card.id)?.frozen, "frozen").toBe(true);
  });

  it("Anchor (Warden) pulls a targeted card onto the Warden", async () => {
    const e = await engine();
    const b = e.announce(table(e, ["warden", "striker"]), { intent: "eclipse", targetId: "striker-2", amount: 20, countdown: 1 });
    const card = announced(b);
    const step = turn(e, b, "warden-1", "anchor", card.id);
    expect(step.battle.cards.find((c) => c.id === card.id)?.targetId, "the card now names the Warden").toBe("warden-1");
  });

  it("a Break (Breaker's Shatter) pushes the soonest card back a slot", async () => {
    const e = await engine();
    let b = e.announce(table(e, ["breaker", "striker"]), { intent: "eclipse", targetId: "striker-2", amount: 20, countdown: 1 });
    b = edit(b, (x) => {
      x.standing.find((f) => f.id === "breaker-1")!.resource = tuning.SHATTER_COST;
      x.rings.find((r) => r.id === "outer")!.pips = tuning.SHATTER_AT;
    });
    const soonest = [...b.cards].filter((c) => !c.frozen).sort((x, y) => x.countdown - y.countdown)[0];
    const step = turn(e, b, "breaker-1", "shatter", "outer");
    expect(ring(step.battle, "outer").broken, "the ring is Broken").toBe(true);
    expect(step.battle.cards.find((c) => c.id === soonest.id)?.countdown, "and the soonest card is pushed back a slot").toBe(
      soonest.countdown + 1,
    );
  });

  it("Relay (Chronist) hands +25% to the next player, who deals it", async () => {
    const e = await engine();
    const b = table(e, ["chronist", "striker"]);
    const relayed = turn(e, b, "chronist-1", "relay");
    expect(events(relayed, "relay")[0], "the baton goes to the Striker").toMatchObject({ toId: "striker-2" });
    // The Striker's next Jab deals 1.25x a plain one (no Chain on either).
    const plain = (x: Battle) => events(turn(e, edit(x, (y) => (y.chain = { links: 0, potency: 1 })), "striker-2", "cleave", "outer"), "cleave")[0]!.amount as number;
    const without = plain(b);
    const withBaton = plain(relayed.battle);
    expect(withBaton, "the relayed blow is stronger").toBeGreaterThan(without);
    expect(withBaton / without, "by RELAY_BONUS").toBeCloseTo(1 + tuning.RELAY_BONUS, 1);
  });
});

describe("the other actions do what they say", () => {
  it("Ward (Mender) absorbs the next blow whole", async () => {
    const e = await engine();
    let b = table(e, ["mender", "warden"]);
    // Clear the strip, so the Eclipse below is the next blow to land; a Ward
    // absorbs the next blow, whichever card it is.
    b = edit(b, (x) => (x.cards = []));
    b = turn(e, b, "mender-1", "ward", "warden-2").battle;
    const hp = fighter(b, "warden-2").hp;
    const hit = bossTurn(e, e.announce(b, { intent: "eclipse", targetId: "warden-2", amount: 40, countdown: 0 }));
    const eclipse = events(hit, "eclipse").find((x) => x.targetId === "warden-2");
    expect(eclipse?.amount, "the Warded blow lands for nothing").toBe(0);
    expect(fighter(hit.battle, "warden-2").hp, "and the Warden loses nothing").toBe(hp);
    expect(fighter(hit.battle, "warden-2").warded, "the Ward is spent by it").toBe(false);
  });

  it("Bastion (Warden) blunts the next raid-wide card by 40%", async () => {
    const e = await engine();
    const raid = (bastion: boolean) => {
      let b = table(e, ["warden", "striker"]);
      b = edit(b, (x) => {
        x.cards = [];
        x.standing.find((f) => f.id === "warden-1")!.resource = tuning.RESOLVE_MAX;
      });
      if (bastion) b = turn(e, b, "warden-1", "bastion").battle;
      const hit = bossTurn(e, e.announce(b, { intent: "revolution", targetId: "party", amount: 50, countdown: 0 }));
      return (events(hit, "revolution")[0]!.hits as { targetId: string; amount: number }[]).find((h) => h.targetId === "striker-2")!.amount;
    };
    expect(raid(true), "with a Bastion up, the striker takes 60% of the raid-wide blow").toBe(Math.round(raid(false) * (1 - tuning.BASTION_CUT)));
  });

  it("Pry (Breaker) strips two pips from a revealed ring", async () => {
    const e = await engine();
    let b = table(e, ["breaker", "striker"]);
    b = edit(b, (x) => {
      const r = x.rings.find((y) => y.id === "middle")!;
      r.weakness = r.element;
    });
    const pips = ring(b, "middle").pips;
    const step = turn(e, b, "breaker-1", "pry", "middle");
    expect(ring(step.battle, "middle").pips, "PRY_PIPS fewer").toBe(pips - tuning.PRY_PIPS);
  });

  it("Restore (Mender) brings a fallen ally back to the strip", async () => {
    const e = await engine();
    let b = table(e, ["mender", "striker"]);
    b = edit(b, (x) => {
      const ally = x.standing.find((f) => f.id === "striker-2")!;
      x.standing = x.standing.filter((f) => f !== ally);
      x.fallen.push({ ...ally, hp: 0, out: "downed" } as typeof ally);
      x.standing.find((f) => f.id === "mender-1")!.resource = tuning.RESTORE_COST;
    });
    const step = turn(e, b, "mender-1", "restore", "striker-2");
    const back = step.battle.standing.find((f) => f.id === "striker-2");
    expect(back, "the ally is standing again").toBeDefined();
    expect(back!.hp, "with HP").toBeGreaterThan(0);
    expect(step.battle.fallen.some((f) => f.id === "striker-2"), "and off the fallen").toBe(false);
  });

  it("Finisher (Striker) deals double against a Broken ring", async () => {
    const e = await engine();
    const finish = (broken: boolean) => {
      let b = table(e, ["striker", "warden"]);
      b = edit(b, (x) => {
        x.chain = { links: 0, potency: 1 };
        x.standing.find((f) => f.id === "striker-1")!.resource = tuning.MOMENTUM_MAX;
        const r = x.rings.find((y) => y.id === "outer")!;
        r.broken = broken;
        r.pips = broken ? 0 : r.pips;
      });
      return events(turn(e, b, "striker-1", "finisher", "outer"), "finisher")[0]!.amount as number;
    };
    expect(finish(true), "FINISHER_BROKEN times a Finisher on a whole ring").toBe(finish(false) * tuning.FINISHER_BROKEN);
  });

  it("Mend heals by the Chain too, exactly (review F12, R10)", async () => {
    // A heal is big enough that rounding can't hide a wrong multiplier.
    const e = await engine();
    const heal = (potency: number) => {
      let b = table(e, ["mender", "warden"]);
      b = edit(b, (x) => {
        x.chain = { links: 6, potency };
        x.standing.find((f) => f.id === "warden-2")!.hp = 1;
      });
      return events(turn(e, b, "mender-1", "mend", "warden-2"), "mend")[0]!.amount as number;
    };
    const plain = heal(1);
    expect(plain, "a plain Mend heals something").toBeGreaterThan(20);
    expect(heal(1.5), "at +50% a Mend heals exactly 1.5x, rounded").toBe(Math.round(plain * 1.5));
  });
});
