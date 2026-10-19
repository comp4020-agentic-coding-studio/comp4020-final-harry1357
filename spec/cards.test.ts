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
});
