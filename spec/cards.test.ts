import { describe, expect, it } from "vitest";
import { bossTurn, engine, events, sent, table, type Battle, type Engine } from "./engine.ts";

// What the strip needs from the Orrery's turns (rule 19; phase two, area (a)'s
// findings). A card announced on the strip resolves into an event, and the
// strip has to know which card it was, so it can show that card land, or pass
// over a target who fell. A Retrograde says which portraits it turned about,
// so the strip flips exactly those and keeps no copy of the server's five.
// And the Grand Alignment's clock is in the state, so a client that joins in
// phase III sees how near the wipe is before the next Alignment resolves.

/** A clone with no boss cards, then this one announced to resolve on the Orrery's next turn. */
function only(e: Engine, b: Battle, card: { intent: string; targetId: string | null; amount: number | null }): Battle {
  const clean = structuredClone(b);
  clean.cards = [];
  return e.announce(clean, { ...card, countdown: 0 });
}

describe("each resolution names its card", () => {
  for (const [intent, targetId, amount] of [
    ["eclipse", "warden-1", 20],
    ["lunge", "warden-1", 16],
    ["revolution", "party", 8],
    ["perihelion", "party", 32],
  ] as const) {
    it(`a ${intent} names the card that resolved`, async () => {
      const e = await engine();
      const b = only(e, table(e, ["warden", "mender"]), { intent, targetId, amount });
      const card = b.cards[0].id;
      const landed = events(bossTurn(e, b), intent);
      expect(landed.length, `the ${intent} resolved`).toBe(1);
      expect(landed[0].cardId, `and says which card it was`).toBe(card);
    });
  }

  it("a blow spent on nobody names its card too", async () => {
    const e = await engine();
    let b = only(e, table(e, ["warden", "mender"]), { intent: "eclipse", targetId: "mender-2", amount: 20 });
    const card = b.cards[0].id;
    const gone = structuredClone(b);
    const mender = gone.standing.find((f) => f.id === "mender-2")!;
    gone.standing = gone.standing.filter((f) => f !== mender);
    gone.fallen.push({ ...mender, hp: 0 });
    b = gone;
    const passed = events(bossTurn(e, b), "eclipse")[0];
    expect(passed?.spent, "the Eclipse passes over the fallen").toBe(true);
    expect(passed?.cardId, "and names the card that passed").toBe(card);
  });
});

describe("Retrograde and the Alignment, for the strip", () => {
  it("a Retrograde names the portraits it turned about, in the order they stood", async () => {
    const e = await engine();
    const b = only(e, table(e, ["warden", "mender", "striker", "breaker", "chronist", "warden"]), { intent: "retrograde", targetId: null, amount: null });
    const before = b.standing.filter((f) => f.kind === "character").map((f) => f.id);
    const turned = events(bossTurn(e, b), "retrograde")[0];
    expect(turned?.flipped, "it flipped").toBe(true);
    expect(turned?.cardId, "it names its card").toBe(b.cards[0].id);
    expect(turned?.slots, "the five it turned about, as they stood").toEqual(before.slice(0, 5));
  });

  it("the state carries how many Alignments are left, once the Grand Alignment has begun", async () => {
    const e = await engine();
    const b = table(e, ["warden", "mender"]);
    const left = (x: Battle): unknown => (sent(e, x) as { alignmentLeft?: unknown }).alignmentLeft;
    expect(left(b), "before phase III, no clock").toBeNull();
    const three = structuredClone(b);
    three.phase = 3;
    expect(left(three), "in phase III, all three Alignments to come").toBe(3);
    const turned = bossTurn(e, only(e, three, { intent: "alignment", targetId: null, amount: null })).battle;
    expect(left(turned), "one resolved: two left").toBe(2);
  });

  it("the state says whether a Bastion stands, until the blow on everyone it meets", async () => {
    // The Warden's prompt to raise one, and the mark the room sees on the blow
    // it will meet, are drawn from this, not from a bastion event remembered.
    const e = await engine();
    const b = only(e, table(e, ["warden", "mender"]), { intent: "revolution", targetId: "party", amount: 8 });
    const stands = (x: Battle): unknown => (sent(e, x) as { bastion?: unknown }).bastion;
    expect(stands(b), "none raised: none stands").toBe(false);
    const raised = structuredClone(b);
    raised.bastion = true;
    expect(stands(raised), "raised: it stands").toBe(true);
    expect(stands(bossTurn(e, raised).battle), "the Revolution met it: gone").toBe(false);
  });

  // Phase two's gate (R2, T2): which card a Bastion meets is the server's to
  // say, as the Reaction's card is (rule 2). Only a Revolution or a Perihelion
  // spends one; an Alignment doesn't, and a frozen card waits a cycle. The
  // state's bastionCard must name the card whose resolution actually spends it.
  for (const [what, phase, cards, frozen] of [
    ["an Alignment ahead of a Revolution", 3, [["alignment", "party", null, 0], ["revolution", "party", 12, 1]], [] as number[]],
    ["a frozen Revolution beside a Perihelion due now", 1, [["revolution", "party", 8, 0], ["perihelion", "party", 32, 0]], [0]],
  ] as const) {
    it(`the state names the card a Bastion meets: ${what}`, async () => {
      const e = await engine();
      let b = structuredClone(table(e, ["warden", "mender"]));
      b.phase = phase;
      b.cards = [];
      for (const [intent, targetId, amount, countdown] of cards) b = e.announce(b, { intent, targetId, amount, countdown });
      b = structuredClone(b);
      const ids = b.cards.map((c) => c.id);
      for (const i of frozen) b.cards.find((c) => c.id === ids[i])!.frozen = true;
      b.bastion = true;
      const named = (sent(e, b) as { bastionCard?: unknown }).bastionCard;
      // Play the Orrery's turns until the Bastion is spent, and see on whose resolution.
      let spentOn: unknown = "never";
      for (let i = 0; i < 4 && spentOn === "never"; i++) {
        const step = bossTurn(e, b);
        const line = (step.battle.log as { seq?: number; text: string }[]).find((l) => l.text.includes("a Bastion took"));
        if (line) spentOn = step.effects.events.find((ev) => ev.seq === line.seq)?.cardId ?? "an event with no card";
        b = step.battle;
      }
      expect(spentOn, "the Bastion was spent within four Orrery turns").not.toBe("never");
      expect(named, "the state named, beforehand, the card that spent it").toBe(spentOn);
    });
  }
});
