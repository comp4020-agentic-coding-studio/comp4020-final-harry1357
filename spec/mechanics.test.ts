import { describe, expect, it } from "vitest";
import { announced, bossTurn, clock, engine, events, fighter, ring, table, turn, type Battle, type Engine } from "./engine.ts";

// The mechanics three rules promised and the build didn't have (ADR-011;
// docs/features-rice.md items 8, 14 and 19), each held on the pure engine.
// Item 9, the ring step, is the command window's: spec/command.test.ts.

const edit = (b: Battle, change: (b: Battle) => void): Battle => {
  const next = structuredClone(b);
  change(next);
  return next;
};
const clearCards = (b: Battle): Battle => edit(b, (x) => (x.cards = []));
type Ev = Record<string, unknown>;

describe("Charge spends on each role's signature move (rule 17, item 8)", () => {
  // Each role's signature, as the join screen names it: a move that empties Charge, is the stronger for every
  // pip, and says how many it spent, so the screen can draw the spend before the log says it (rule 11).
  const SIGNATURE: Record<string, string> = { warden: "bastion", mender: "restore", striker: "finisher", breaker: "shatter", chronist: "stillpoint" };

  /** A table where `role` can take its signature now, with `charge` pips banked. */
  const ready = (e: Engine, role: string, charge: number) => {
    let b = clearCards(table(e, [role, "striker"]));
    b = edit(b, (x) => {
      const me = x.standing.find((f) => f.id === `${role}-1`)!;
      me.charge = charge;
      me.resource = 5;
      if (role === "breaker") x.rings.find((r) => r.id === "outer")!.pips = 2;
      if (role === "striker") x.rings.find((r) => r.id === "outer")!.broken = true;
      if (role === "mender") {
        const ally = x.standing.find((f) => f.id === "striker-2")!;
        x.standing = x.standing.filter((f) => f !== ally);
        x.fallen.push({ ...ally, hp: 0, out: "downed" } as typeof ally);
      }
    });
    if (role === "chronist" || role === "breaker") {
      b = e.announce(b, { intent: "eclipse", targetId: "striker-2", amount: 20, countdown: 2 });
      b = e.announce(b, { intent: "revolution", targetId: "party", amount: 8, countdown: 3 });
    }
    const target = role === "chronist" ? announced(b).id : role === "mender" ? "striker-2" : role === "breaker" || role === "striker" ? "outer" : null;
    return { b, target };
  };

  for (const [role, action] of Object.entries(SIGNATURE)) {
    it(`the ${role}'s ${action} empties Charge, says how much it spent, and is the stronger for it`, async () => {
      const e = await engine();
      const plain = ready(e, role, 0);
      const charged = ready(e, role, 3);
      const a = turn(e, plain.b, `${role}-1`, action, plain.target);
      const c = turn(e, charged.b, `${role}-1`, action, charged.target);
      const ev = events(c, action)[0] as Ev | undefined;
      expect(ev, `${action} happened`).toBeTruthy();
      expect(ev?.charge, `the ${action} event says it spent 3 Charge`).toBe(3);
      expect((events(a, action)[0] as Ev | undefined)?.charge, "and 0 when there was none").toBe(0);
      expect(fighter(c.battle, `${role}-1`).charge, "Charge is emptied").toBe(0);

      // What Charge adds, per role: measured against the same move with none.
      switch (role) {
        case "warden": {
          const blow = (b: Battle) => events(bossTurn(e, e.announce(clearCards(b), { intent: "revolution", targetId: "party", amount: 40, countdown: 0 })), "revolution")[0] as Ev;
          const hit = (x: Ev) => ((x.hits as { amount: number }[])[0] ?? { amount: 0 }).amount;
          expect(hit(blow(c.battle)), "a charged Bastion cuts deeper than a plain one").toBeLessThan(hit(blow(a.battle)));
          break;
        }
        case "mender":
          expect(fighter(c.battle, "striker-2").hp, "a charged Restore brings back more").toBeGreaterThan(fighter(a.battle, "striker-2").hp);
          break;
        case "striker":
          expect(Number(ev?.amount), "a charged Finisher hits harder").toBeGreaterThan(Number((events(a, action)[0] as Ev).amount));
          break;
        case "breaker": {
          const soonest = (b: Battle) => Math.min(...b.cards.map((x) => x.countdown));
          expect(soonest(c.battle), "a charged Shatter pushes the cards further back").toBeGreaterThan(soonest(a.battle));
          break;
        }
        case "chronist":
          expect(fighter(c.battle, `${role}-1`).resource, "a charged Stillpoint costs less Flux").toBeGreaterThan(fighter(a.battle, `${role}-1`).resource);
          break;
      }
    });
  }

  it("a charged Stillpoint can be taken with less than full Flux, Charge paying the rest", async () => {
    const e = await engine();
    let b = clearCards(table(e, ["chronist", "striker"]));
    b = edit(b, (x) => {
      const me = x.standing.find((f) => f.id === "chronist-1")!;
      me.resource = 2;
      me.charge = 3;
    });
    b = e.announce(b, { intent: "eclipse", targetId: "striker-2", amount: 20, countdown: 2 });
    const ready = e.plate(b, "chronist-1", clock());
    expect(e.checkAction(ready, "chronist-1", "stillpoint", announced(b).id), "two Flux and three Charge make five").not.toHaveProperty("status");
    const none = e.plate(edit(b, (x) => (x.standing.find((f) => f.id === "chronist-1")!.charge = 0)), "chronist-1", clock());
    expect(e.checkAction(none, "chronist-1", "stillpoint", announced(b).id), "two Flux and no Charge don't").toHaveProperty("status", 409);
  });
});

describe("every role has one Reaction (rule 18, item 14)", () => {
  const REACTION: Record<string, string> = { warden: "intercept", mender: "veil", striker: "riposte", breaker: "fracture", chronist: "nudge" };

  it("each role's catalogue holds exactly one action marked reaction: true, at rank 0", async () => {
    const { ACTIONS, ROLES } = await import("../src/shared/protocol.ts");
    for (const [role, action] of Object.entries(REACTION)) {
      const reactions = ROLES[role as keyof typeof ROLES].actions.filter((a) => ACTIONS[a].reaction);
      expect(reactions, `the ${role}'s Reaction`).toEqual([action]);
      expect(ACTIONS[action as keyof typeof ACTIONS].rank, `${action} takes no turn`).toBe(0);
    }
  });

  /** A table of `role` and a Striker, the strip holding only `card`, with the Striker on the plate. */
  const offTurn = (e: Engine, role: string, card: { intent: string; targetId: string | null; amount: number | null }) => {
    const b = e.announce(clearCards(table(e, [role, "striker", "warden"])), { ...card, countdown: 0 });
    return { b: e.plate(b, role === "striker" ? "warden-3" : "striker-2", clock()), card: announced(b) };
  };

  for (const [role, action] of Object.entries(REACTION)) {
    it(`the ${role}'s ${action} is taken off-turn, once per boss turn, against the card the server names, and refused otherwise`, async () => {
      const e = await engine();
      const aimed: Record<string, { intent: string; targetId: string | null; amount: number | null }> = {
        warden: { intent: "eclipse", targetId: "striker-2", amount: 20 },
        mender: { intent: "eclipse", targetId: "striker-2", amount: 20 },
        striker: { intent: "lunge", targetId: "striker-1", amount: 20 },
        breaker: { intent: "perihelion", targetId: "party", amount: 100 },
        chronist: { intent: "eclipse", targetId: "striker-2", amount: 20 },
      };
      const { b, card } = offTurn(e, role, aimed[role]);
      const me = `${role}-1`;
      const token = (e.view(b, { tickMs: 150, turnMs: 12_000 }).queue as { id: string; reactionCard: string | null }[]).find((t) => t.id === me);
      expect(token?.reactionCard, `the server names the ${aimed[role].intent} for the ${role}'s Reaction`).toBe(card.id);
      expect(b.activeId, "and it isn't the reactor's turn").not.toBe(me);

      expect(e.checkAction(b, me, action, card.id), `${action} off-turn is taken`).not.toHaveProperty("status");
      const step = e.act(b, me, action, card.id, clock());
      expect(events(step, "reaction")[0], "a Reaction, said as one").toMatchObject({ actorId: me, action, cardId: card.id });
      expect(events(step, action)[0], `${action} is drawn by its own event`).toMatchObject({ actorId: me, cardId: card.id });
      expect(events(step, "sting")[0], "and stings the Orrery").toMatchObject({ actorId: me });
      expect(fighter(step.battle, me).reactionReady, "the Reaction is spent").toBe(false);
      expect(step.battle.activeId, "it took no turn").toBe(b.activeId);

      expect(e.checkAction(step.battle, me, action, card.id), "a second before the next boss turn").toHaveProperty("status", 409);
      expect(e.checkAction(b, me, action, "card-none"), "against a card not on the strip").toHaveProperty("status", 409);
    });
  }

  it("each Reaction does what it is for", async () => {
    const e = await engine();
    // Veil: the Eclipse's mark is Warded, and the Eclipse lands for nothing.
    {
      const { b, card } = offTurn(e, "mender", { intent: "eclipse", targetId: "striker-2", amount: 20 });
      const veiled = e.act(b, "mender-1", "veil", card.id, clock());
      expect(fighter(veiled.battle, "striker-2").warded, "Veil Wards the mark").toBe(true);
      const after = bossTurn(e, veiled.battle);
      expect(fighter(after.battle, "striker-2").hp, "and the Eclipse is absorbed").toBe(fighter(b, "striker-2").hp);
    }
    // Riposte: the Striker braced and Warded against the Lunge aimed at it.
    {
      const { b, card } = offTurn(e, "striker", { intent: "lunge", targetId: "striker-1", amount: 20 });
      const met = e.act(b, "striker-1", "riposte", card.id, clock());
      expect(fighter(met.battle, "striker-1").warded, "Riposte Wards the Striker against the blow at it").toBe(true);
    }
    // Fracture: the outer ring loses its pips.
    {
      const { b, card } = offTurn(e, "breaker", { intent: "perihelion", targetId: "party", amount: 100 });
      const before = ring(b, "outer").pips;
      const cracked = e.act(b, "breaker-1", "fracture", card.id, clock());
      expect(ring(cracked.battle, "outer").pips, "Fracture cracks the outer ring").toBeLessThan(before);
    }
    // Nudge: the card goes back a slot; a Nudged Retrograde comes apart.
    {
      const { b, card } = offTurn(e, "chronist", { intent: "retrograde", targetId: null, amount: null });
      const nudged = e.act(b, "chronist-1", "nudge", card.id, clock());
      expect(nudged.battle.cards.find((c) => c.id === card.id)?.countdown, "Nudge pushes it a slot").toBe(1);
      const after = bossTurn(e, nudged.battle);
      expect(events(after, "retrograde")[0], "and a Nudged Retrograde comes apart").toMatchObject({ flipped: false, cancelledBy: "chronist-1" });
    }
  });

  it("a Reaction against a blow aimed at the reactor Wards them (an Eclipse is met without a Mender)", async () => {
    const e = await engine();
    const b = e.plate(e.announce(clearCards(table(e, ["chronist", "striker"])), { intent: "eclipse", targetId: "chronist-1", amount: 20, countdown: 0 }), "striker-2", clock());
    const card = announced(b);
    const nudged = e.act(b, "chronist-1", "nudge", card.id, clock());
    expect(fighter(nudged.battle, "chronist-1").warded, "the Chronist who Nudged the Eclipse at them is Warded").toBe(true);
  });
});

describe("ring weaknesses re-hide and reshuffle at each phase change (item 19)", () => {
  it("every ring's weakness is hidden again, the elements dealt anew, and the phase event says so", async () => {
    const e = await engine();
    let b = table(e, ["striker", "breaker"]);
    b = edit(b, (x) => {
      for (const r of x.rings) r.weakness = r.element;
      x.standing.find((f) => f.id === "orrery")!.hp = Math.ceil(x.standing.find((f) => f.id === "orrery")!.maxHp * 0.7) + 1;
    });
    const before = b.rings.map((r) => r.element);
    const crossed = turn(e, b, "striker-1", "cleave", "outer");
    const phase = events(crossed, "phase")[0] as Ev | undefined;
    expect(phase, "the blow carried the Orrery into phase II").toMatchObject({ phase: 2, reshuffled: true });
    expect(crossed.battle.rings.map((r) => r.weakness), "every weakness hidden again").toEqual([null, null, null]);
    const after = crossed.battle.rings.map((r) => r.element);
    expect([...after].sort(), "the same three elements").toEqual([...before].sort());
    expect(after, "dealt to different rings").not.toEqual(before);
    expect(after.every((el, i) => el !== before[i]), "none left where it was").toBe(true);

    // The client is never sent an element it hasn't Scanned.
    const sent = e.view(crossed.battle, { tickMs: 150, turnMs: 12_000 }) as { rings: Record<string, unknown>[] };
    expect(sent.rings.every((r) => !("element" in r) && r.weakness === null), "nothing unscanned on the wire").toBe(true);
  });

  it("the same room deals the same rings every run: no randomness (ADR-001)", async () => {
    const e = await engine();
    const deal = () => {
      const b = edit(table(e, ["striker", "breaker"]), (x) => (x.standing.find((f) => f.id === "orrery")!.hp = Math.ceil(x.standing.find((f) => f.id === "orrery")!.maxHp * 0.7) + 1));
      return turn(e, b, "striker-1", "cleave", "outer").battle.rings.map((r) => r.element);
    };
    expect(deal()).toEqual(deal());
  });
});

describe("a Reaction is taken out of turn, never on your own (rule 18; the gate's F1)", () => {
  it("the seat on the plate is named no card and refused every Reaction", async () => {
    const e = await engine();
    const b = e.announce(clearCards(table(e, ["warden", "striker"])), { intent: "eclipse", targetId: "striker-2", amount: 20, countdown: 0 });
    const card = announced(b);
    const mine = e.plate(b, "warden-1", clock());
    const token = (e.view(mine, { tickMs: 150, turnMs: 12_000 }).queue as { id: string; reactionCard: string | null }[]).find((t) => t.id === "warden-1");
    expect(token?.reactionCard, "on the plate, no card is named for its Reaction").toBeNull();
    expect(e.checkAction(mine, "warden-1", "intercept", card.id), "an Intercept on your own turn").toHaveProperty("status", 409);
  });
});
