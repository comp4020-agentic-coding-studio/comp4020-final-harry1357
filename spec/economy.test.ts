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
    expect(seen.slice(0, 2).map((p) => Number(p.toFixed(2))), "the first turn starts it; each after adds a link").toEqual([1, 1.1]);
    expect(Math.max(...seen), "the Chain is capped at +50%").toBeCloseTo(1.5, 5);

    const broken = bossTurn(e, b);
    expect(broken.battle.chain.links, "any boss action resets the Chain").toBe(0);
    expect(broken.battle.chain.potency).toBe(1);
    expect(events(broken, "chain").some((x) => x.broken === true), "and the break is an event the strip can show").toBe(true);
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

    // An Echo's turn is taken by the server, at once, with a real action.
    const hp = fighter(b, "orrery").hp;
    const echoTurn = e.advance(e.plate(b, "striker-1", clock()), clock())!;
    const acted = echoTurn.effects.events.filter((x) => x.actorId === "striker-1" && x.kind !== "plate");
    expect(acted.length, "an Echo acts on its turn rather than waiting it out").toBeGreaterThan(0);
    expect(acted.some((x) => x.kind === "hold"), "an Echo's turn isn't another timeout").toBe(false);
    expect(fighter(echoTurn.battle, "orrery").hp <= hp, "an Echo's action is a real one").toBe(true);

    // The person comes back: acting ends the Echo.
    const back = turn(e, echoTurn.battle, "striker-1", "jab", "outer");
    expect(fighter(back.battle, "striker-1").echo, "acting ends the Echo at once").toBe(false);
    expect(fighter(back.battle, "striker-1").timeouts, "and resets the count").toBe(0);
  });

  it("each player has one Reaction per boss turn, against a card already on the strip", async () => {
    const e = await engine();
    let b = table(e, ["warden", "striker"]);
    b = e.announce(b, { intent: "eclipse", targetId: "striker-2", amount: 30, countdown: 1 });
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

  it("each role can take each of its actions in the engine", async () => {
    const e = await engine();
    for (const [role, actions] of Object.entries(ROLE_TABLE)) {
      for (const action of Object.keys(actions)) {
        if (action === "intercept") continue; // a Reaction, held above
        const b = table(e, [role, "striker"]);
        const target = ["mend", "ward", "quicken", "haste", "restore"].includes(action) ? "striker-2" : null;
        const ready = e.plate(b, `${role}-1`, clock());
        const ok = e.checkAction(ready, `${role}-1`, action, target);
        // Some actions need a resource or a card first; the refusal must say so, not "can't do that".
        if ("status" in ok) expect(ok.error, `${role} ${action}: refused for the wrong reason`).not.toMatch(/can't do that/i);
      }
    }
  });
});
