import { describe, expect, it } from "vitest";
import { counterReset } from "../src/server/ctb.ts";
import { announced, bossTurn, clock, engine, events, fighter, ring, sent, table, turn } from "./engine.ts";

// The action economy (CLAUDE.md rules 8 and 13-18; docs/adr/006). Every claim
// is held on the pure engine, so the situation is exact: a weakness hit, a run
// of player turns, a stack set by one person and spent by another. Committed
// red: the economy isn't built yet, and these are its target.

describe("the action economy", () => {
  it("a weakness hit refunds one rank (Resonance), and says so for the strip to draw", async () => {
    const e = await engine();
    // A Breaker reveals the outer ring, then a Striker Cleaves it on its weakness.
    let b = table(e, ["breaker", "striker"]);
    b = turn(e, b, "breaker-1", "scan", "outer").battle;
    expect(ring(b, "outer").weakness, "Scan reveals the ring's weakness to the room").toBe(ring(b, "outer").element);

    const striker = fighter(b, "striker-2");
    const step = turn(e, b, "striker-2", "cleave", "outer");
    const after = fighter(step.battle, "striker-2");
    // Cleave is rank 3; a Resonance resets it as rank 2 (A1's model, rule 13).
    expect(after.counter, "the counter resets one rank lower than the action's").toBe(counterReset(striker.agility, "normal", 2));
    const jump = events(step, "resonance");
    expect(jump, "a Resonance is an event, so the portrait can visibly jump").toHaveLength(1);
    expect(jump[0], "it says the rank it came from and went to").toMatchObject({ actorId: "striker-2", from: 3, to: 2 });
  });

  it("a hit on a Broken ring refunds a rank too, even with its weakness hidden", async () => {
    const e = await engine();
    let b = table(e, ["striker", "warden"]);
    // Break the outer ring without Scanning it, so only Broken can resonate.
    const next = structuredClone(b);
    const outer = next.rings.find((r) => r.id === "outer")!;
    outer.pips = 0;
    outer.broken = true;
    outer.weakness = null;
    b = next;
    const striker = fighter(b, "striker-1");
    const step = turn(e, b, "striker-1", "cleave", "outer");
    expect(fighter(step.battle, "striker-1").counter, "Cleave on a Broken ring resets as rank 2, not 3").toBe(
      counterReset(striker.agility, "normal", 2),
    );
    expect(events(step, "resonance")[0], "and the portrait jumps").toMatchObject({ actorId: "striker-1", from: 3, to: 2 });
  });

  it("Haste halves the reset, never the rate (rule 13)", async () => {
    const e = await engine();
    let b = table(e, ["chronist", "striker"]);
    b = turn(e, b, "chronist-1", "haste", "striker-2").battle;
    const striker = fighter(b, "striker-2");
    // A hasted rank-3 action resets to half of a plain one.
    const step = turn(e, b, "striker-2", "cleave", "middle");
    expect(fighter(step.battle, "striker-2").counter, "a hasted reset is tickSpeed × rank × ½").toBe(
      counterReset(striker.agility, "haste", 3),
    );
    expect(counterReset(striker.agility, "haste", 3), "which is half a plain one, so the test can tell").toBeLessThan(
      counterReset(striker.agility, "normal", 3),
    );
    // The rate: one tick still takes every counter down by exactly 1, the
    // hasted Striker's included. Nobody is on the plate, so the clock runs.
    const before = step.battle.standing.map((f) => [f.id, f.counter] as const);
    expect(before.every(([, c]) => c > 0), "nobody is on the plate, so the next step is a tick").toBe(true);
    const ticked = e.advance(step.battle, clock())?.battle;
    expect(ticked, "the clock ticked").toBeDefined();
    for (const [id, c] of before) {
      expect(fighter(ticked!, id).counter, `${id} dropped by exactly 1 in a tick, hasted or not`).toBe(c - 1);
    }
  });

  it("never refunds below rank 1, and a refund of nothing isn't a jump", async () => {
    const e = await engine();
    let b = table(e, ["breaker", "striker"]);
    b = turn(e, b, "breaker-1", "scan", "outer").battle;
    const striker = fighter(b, "striker-2");
    const step = turn(e, b, "striker-2", "jab", "outer");
    expect(fighter(step.battle, "striker-2").counter, "a rank-1 Jab on a weakness still resets as rank 1").toBe(
      counterReset(striker.agility, "normal", 1),
    );
    expect(events(step, "resonance"), "nothing was refunded, so the portrait doesn't jump").toEqual([]);
  });

  it("consecutive player turns form a Chain, +10% a link to +50%, and a boss turn breaks it", async () => {
    const e = await engine();
    let b = table(e, ["striker", "warden", "mender", "breaker", "chronist"]);
    expect(b.chain.links, "a fresh fight has no Chain").toBe(0);

    const order = ["striker-1", "warden-2", "mender-3", "breaker-4", "chronist-5", "striker-1", "warden-2"];
    const seen: number[] = [];
    for (const id of order) {
      b = turn(e, b, id, "brace").battle;
      seen.push(b.chain.potency);
    }
    expect(b.chain.links, "seven player turns in a row, no boss card between").toBe(7);
    expect(
      seen.map((p) => Number(p.toFixed(2))),
      "the first turn starts it at 1.0, each after adds 10%, and it holds at the +50% cap",
    ).toEqual([1, 1.1, 1.2, 1.3, 1.4, 1.5, 1.5]);

    const broken = bossTurn(e, b);
    expect(broken.battle.chain.links, "any boss action resets the Chain").toBe(0);
    expect(broken.battle.chain.potency).toBe(1);
    expect(events(broken, "chain").some((x) => x.broken === true), "and the break is an event the strip can show").toBe(true);
  });

  it("the Chain multiplies what an action deals, not only the number on the strip (rule 15)", async () => {
    const e = await engine();
    // The same Jab, with no Chain and with a full one.
    const jabWith = (links: number): number => {
      const b = table(e, ["striker", "warden"]);
      const next = structuredClone(b);
      next.chain = { links, potency: 1 + Math.min(0.5, 0.1 * Math.max(0, links - 1)) };
      const step = turn(e, next, "striker-1", "jab", "outer");
      const jab = events(step, "jab")[0];
      expect(typeof jab?.amount, "a Jab says what it dealt").toBe("number");
      return jab!.amount as number;
    };
    const plain = jabWith(0);
    const chained = jabWith(6);
    expect(plain, "a plain Jab deals something, so the ratio means something").toBeGreaterThan(0);
    expect(chained / plain, "at +50% the same Jab deals 1.5× as much").toBeCloseTo(1.5, 1);
  });

  it("an Exposed stack applied by A and spent by B records both", async () => {
    const e = await engine();
    let b = table(e, ["breaker", "striker"]);
    const marked = turn(e, b, "breaker-1", "mark", "outer");
    b = marked.battle;
    expect(ring(b, "outer").exposed, "Mark sets 2 stacks, each naming who set it").toEqual([
      { appliedBy: "breaker-1" },
      { appliedBy: "breaker-1" },
    ]);
    expect(events(marked, "exposed")[0], "the stacks are an event, with who applied them").toMatchObject({
      ringId: "outer",
      appliedBy: "breaker-1",
      spentBy: null,
    });

    const feint = turn(e, b, "striker-2", "feint", "outer");
    expect(ring(feint.battle, "outer").exposed, "Feint spends one, and the other is still Breaker's").toEqual([
      { appliedBy: "breaker-1" },
    ]);
    // Rule 16: both are "in the state the client is sent", so read what view()
    // sends, not the engine's own battle.
    expect(sent(e, feint.battle).spentExposed, "the state a client is sent records who set the spent stack and who spent it").toContainEqual({
      ringId: "outer",
      appliedBy: "breaker-1",
      spentBy: "striker-2",
    });
    expect(sent(e, feint.battle).rings.find((r) => r.id === "outer")?.exposed, "and the stack still waiting, with who set it").toEqual([
      { appliedBy: "breaker-1" },
    ]);
    expect(events(feint, "exposed").find((x) => x.spentBy === "striker-2"), "and the spend is an event naming both").toMatchObject({
      appliedBy: "breaker-1",
    });
  });

  it("Brace is rank 2, halves the next blow, and banks Charge to a maximum of 3", async () => {
    const e = await engine();
    let b = table(e, ["warden"]);
    const counters: number[] = [];
    for (let i = 0; i < 4; i++) {
      const step = turn(e, b, "warden-1", "brace");
      b = step.battle;
      counters.push(fighter(b, "warden-1").counter);
      expect(fighter(b, "warden-1").braced, "a Brace stands until their next turn").toBe(true);
    }
    expect(fighter(b, "warden-1").charge, "four Braces bank three Charge, not four").toBe(3);
    expect(counters[0], "Brace resets as rank 2").toBe(counterReset(fighter(b, "warden-1").agility, "normal", 2));

    // Braced, the next blow lands at half. The strip already holds the
    // Orrery's own opening card, which resolves on the same turn, so the blow
    // is read from its own event, and the HP has to account for every card
    // that landed, this one at exactly half.
    const hp = fighter(b, "warden-1").hp;
    const hit = bossTurn(e, e.announce(b, { intent: "eclipse", targetId: "warden-1", amount: 30, countdown: 0 }));
    const blow = events(hit, "eclipse").find((x) => x.targetId === "warden-1" && x.amount !== undefined);
    expect(blow?.amount, "a 30 blow on a braced Warden takes 15").toBe(15);
    const landed = hit.effects.events.flatMap((x) =>
      Array.isArray(x.hits)
        ? (x.hits as { targetId: string; amount: number }[]).filter((h) => h.targetId === "warden-1").map((h) => h.amount)
        : x.targetId === "warden-1" && typeof x.amount === "number" && x.actorId === "orrery" ? [x.amount] : [],
    );
    expect(hp - fighter(hit.battle, "warden-1").hp, "and every blow that landed came off, that one at half").toBe(
      landed.reduce((n, a) => n + a, 0),
    );
  });

  it("a timeout Braces for them, banks Charge and dims the portrait", async () => {
    const e = await engine();
    let b = table(e, ["mender", "striker"]);
    b = e.plate(b, "mender-1", clock());
    const step = e.advance(b, clock(2_000_000)); // long past the 12 s deadline
    expect(step, "a turn past its deadline is taken by the clock").not.toBeNull();
    const after = fighter(step!.battle, "mender-1");
    expect(after.braced, "the server Braced for them").toBe(true);
    expect(after.charge, "and the Brace banked a Charge").toBe(1);
    expect(after.timeouts, "one timeout counted").toBe(1);
    expect(events(step!, "hold")[0], "the timeout is an event: the portrait dims").toMatchObject({ actorId: "mender-1" });
    expect(step!.battle.standing.some((f) => f.id === "mender-1"), "nobody leaves on a timeout").toBe(true);
  });

  it("three timeouts in a row make an Echo that acts, until the person acts again", async () => {
    const e = await engine();
    let b = table(e, ["striker", "warden"]);
    for (let i = 0; i < 3; i++) {
      b = e.plate(b, "striker-1", clock());
      b = e.advance(b, clock(9_000_000 + i))!.battle;
    }
    expect(fighter(b, "striker-1").echo, "the third timeout in a row makes an Echo").toBe(true);

    // An Echo's turn is taken by the server with a real action, at low output
    // (rule 8). It plays its role's policy (ADR-007, rule 25): a Striker with
    // no Broken ring to Finish Jabs. So it deals the person's own Jab, at the
    // Echo's share. Measured with no Chain, so only the Echo's share is in it.
    const calm = structuredClone(b);
    calm.chain = { links: 0, potency: 1 };
    const hp = fighter(calm, "orrery").hp;
    // Past the Echo's three-second beat, so the server plays it (rule 8).
    const echoTurn = e.advance(e.plate(calm, "striker-1", clock()), clock(1_000_000 + 3_500))!;
    const acted = echoTurn.effects.events.filter((x) => x.actorId === "striker-1" && x.kind !== "plate");
    expect(acted.some((x) => x.kind === "hold"), "an Echo's turn isn't another timeout").toBe(false);
    expect(acted.map((x) => x.kind), "the Striker's Echo Jabs: its policy, with no Broken ring to Finish").toContain("jab");
    const dealt = hp - fighter(echoTurn.battle, "orrery").hp;
    // The same Jab, in the same spot, by the person.
    const person = structuredClone(calm);
    person.standing.find((f) => f.id === "striker-1")!.echo = false;
    const theirs = turn(e, person, "striker-1", "jab", "outer");
    const jab = hp - fighter(theirs.battle, "orrery").hp;
    const share = (await import("../src/server/tuning.ts")).ECHO_POTENCY;
    expect(share, "an Echo is low output: less than a whole person").toBeLessThan(1);
    expect(dealt, "an Echo deals the person's Jab at the Echo's share, no more and no less").toBe(Math.round(jab * share));

    // The person comes back: acting ends the Echo.
    const back = turn(e, echoTurn.battle, "striker-1", "jab", "outer");
    expect(fighter(back.battle, "striker-1").echo, "acting ends the Echo at once").toBe(false);
    expect(fighter(back.battle, "striker-1").timeouts, "and resets the count").toBe(0);
  });

  it("each player has one Reaction per boss turn, against a card already on the strip", async () => {
    const e = await engine();
    // The strip cleared first: a Reaction answers only the card the server names, the soonest it
    // can (rule 2; phase two's gate, B1), and the Orrery's own cards could come before this one.
    const clean = structuredClone(table(e, ["warden", "striker"]));
    clean.cards = [];
    const b = e.announce(clean, { intent: "eclipse", targetId: "striker-2", amount: 30, countdown: 1 });
    const card = announced(b);
    expect(fighter(b, "warden-1").reactionReady, "a Reaction is ready at the start").toBe(true);

    // Out of turn: the Orrery or someone else is on the plate, and the Warden still Intercepts.
    const offTurn = e.plate(b, "striker-2", clock());
    const first = e.checkAction(offTurn, "warden-1", "intercept", card.id);
    expect("status" in first ? first : null, "Intercept is taken out of turn, against the card").toBeNull();
    const reacted = e.act(offTurn, "warden-1", "intercept", card.id, clock());
    expect(fighter(reacted.battle, "warden-1").reactionReady, "the Reaction is spent").toBe(false);

    const again = e.checkAction(reacted.battle, "warden-1", "intercept", card.id);
    expect("status" in again && again.status, "a second Reaction before the next boss turn is refused").toBe(409);

    const reset = bossTurn(e, reacted.battle);
    expect(fighter(reset.battle, "warden-1").reactionReady, "a boss turn gives the Reaction back").toBe(true);
  });

  it("a Reaction with no telegraphed card to answer is refused, never kept for later", async () => {
    const e = await engine();
    const b = e.plate(table(e, ["warden", "striker"]), "striker-2", clock());
    const res = e.checkAction(b, "warden-1", "intercept", "no-such-card");
    expect("status" in res && res.status, "nothing on the strip to answer: refused").toBe(409);
  });
});

describe("the five roles", () => {
  // The design record's table (docs/design/overhaul.md, Priority 2), with each
  // action's rank. Intercept is a Reaction and takes no turn (rank 0 here).
  // Brace is everyone's (rule 17).
  const ROLE_TABLE: Record<string, Record<string, number>> = {
    warden: { brace: 2, intercept: 0, anchor: 2, bastion: 4, counterweight: 3 },
    mender: { brace: 2, mend: 2, ward: 3, quicken: 3, restore: 5 },
    striker: { brace: 2, jab: 1, cleave: 3, finisher: 4, feint: 2 },
    breaker: { brace: 2, scan: 2, pry: 3, mark: 2, shatter: 4 },
    chronist: { brace: 2, delay: 3, haste: 3, relay: 1, stillpoint: 5 },
  };

  it("each of the five roles has every action in the design record, at the stated rank", async () => {
    const protocol = (await import("../src/shared/protocol.ts")) as unknown as {
      ROLES: Record<string, { actions: readonly string[] } | undefined>;
      ACTIONS: Record<string, { rank: number; reaction?: boolean } | undefined>;
    };
    for (const [role, actions] of Object.entries(ROLE_TABLE)) {
      expect(protocol.ROLES[role], `there is no ${role}`).toBeDefined();
      expect([...(protocol.ROLES[role]?.actions ?? [])].sort(), `the ${role}'s actions`).toEqual(Object.keys(actions).sort());
      for (const [action, rank] of Object.entries(actions)) {
        expect(protocol.ACTIONS[action]?.rank, `${action} is rank ${rank}`).toBe(rank);
      }
    }
    expect(protocol.ACTIONS.intercept?.reaction, "Intercept is a Reaction").toBe(true);
    expect(Object.keys(protocol.ROLES).sort(), "five roles, and only these").toEqual(Object.keys(ROLE_TABLE).sort());
  });

  it("each role takes each of its actions in the engine, and each one happens", async () => {
    const e = await engine();
    // Each action's precondition, set up so a refusal can't pass for an action
    // and a silent no-op can't either: every one must be accepted and emit
    // its own event.
    const prepare = (b: ReturnType<typeof table>, role: string, action: string) => {
      const next = structuredClone(b);
      const me = next.standing.find((f) => f.id === `${role}-1`)!;
      me.resource = 5; // a full Resolve, Grace, Momentum, Insight or Flux
      const outer = next.rings.find((r) => r.id === "outer")!;
      if (action === "pry") outer.weakness = outer.element; // revealed, pips up
      if (action === "shatter") outer.pips = 2;
      if (action === "feint") outer.exposed = [{ appliedBy: "striker-2" }];
      if (action === "restore") {
        const ally = next.standing.find((f) => f.id === "striker-2")!;
        next.standing = next.standing.filter((f) => f !== ally);
        next.fallen.push({ ...ally, hp: 0, out: "downed" } as typeof ally);
      }
      return next;
    };
    const targets: Record<string, string | null> = { mend: "striker-2", ward: "striker-2", quicken: "striker-2", haste: "striker-2", restore: "striker-2" };
    for (const [role, actions] of Object.entries(ROLE_TABLE)) {
      for (const action of Object.keys(actions)) {
        if (action === "intercept") continue; // a Reaction, held above
        let b = prepare(table(e, [role, "striker"]), role, action);
        let target = targets[action] ?? null;
        if (["anchor", "delay", "stillpoint"].includes(action)) {
          b = e.announce(b, { intent: "eclipse", targetId: "striker-2", amount: 20, countdown: 2 });
          target = announced(b).id;
        }
        const ready = e.plate(b, `${role}-1`, clock());
        const ok = e.checkAction(ready, `${role}-1`, action, target);
        expect("status" in ok ? `${ok.status} ${ok.error}` : null, `${role} can ${action}`).toBeNull();
        const step = e.act(ready, `${role}-1`, action, target, clock());
        expect(events(step, action).length, `${role}'s ${action} happened: it emitted its own event`).toBeGreaterThan(0);
      }
    }
  });
});
