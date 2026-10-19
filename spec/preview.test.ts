import { describe, expect, it } from "vitest";
import { clock, engine, fighter, sent, table, type Battle, type Engine } from "./engine.ts";

// What the strip and the command window draw that only the server may decide
// (CLAUDE.md rules 1 and 2; phase two). The ghost of your portrait in its new
// strip position, shown before you commit, is a prediction of turn order, so
// the server makes it: for whoever is on the plate, each turn action's reset
// counter and the slot it would land in, and why it would be refused if it
// would be. And a Reaction is live only "against the card the server names",
// so each token names the card its Reaction may answer now.

interface Preview {
  actorId: string;
  actions: Record<string, { counter: number; slot: number; resonance: boolean; refusal: string | null }>;
}
const previewOf = (e: Engine, b: Battle): Preview | null => (sent(e, b) as unknown as { preview?: Preview | null }).preview ?? null;
const reactionCard = (e: Engine, b: Battle, id: string): string | null | undefined =>
  (sent(e, b).queue.find((t) => t.id === id) as { reactionCard?: string | null } | undefined)?.reactionCard;

/** Where `id` stands in the server's queue: its slot. */
const slotOf = (b: Battle, id: string): number => b.standing.findIndex((f) => f.id === id);

describe("the ghost is the server's", () => {
  it("previews, for whoever is on the plate, the counter and slot each action would leave them at", async () => {
    const e = await engine();
    const b = e.plate(table(e, ["striker", "warden", "mender"]), "striker-1", clock());
    const preview = previewOf(e, b);
    expect(preview, "a character on the plate gets a preview").not.toBeNull();
    expect(preview?.actorId, "for the character on the plate").toBe("striker-1");
    for (const action of ["brace", "jab", "cleave"]) {
      const shown = preview?.actions[action];
      expect(shown, `a preview for ${action}`).toBeDefined();
      const after = e.act(b, "striker-1", action, null, clock()).battle;
      expect(shown?.counter, `${action}: the counter the preview shows is the one the turn leaves`).toBe(fighter(after, "striker-1").counter);
      expect(shown?.slot, `${action}: and the slot it lands in`).toBe(slotOf(after, "striker-1"));
    }
    expect(preview?.actions.intercept, "a Reaction takes no turn, so it has no place to preview").toBeUndefined();
  });

  it("knows a Resonance before you commit, and why an action would be refused", async () => {
    const e = await engine();
    let b = table(e, ["striker", "warden"]);
    const scanned = structuredClone(b);
    for (const r of scanned.rings) r.weakness = r.element; // every weakness known: a Jab resonates
    b = e.plate(scanned, "striker-1", clock());
    const jab = previewOf(e, b)?.actions.jab;
    expect(jab?.resonance, "a Jab on a known weakness is previewed as a Resonance").toBe(true);
    expect(jab?.counter, "at the refunded rank's counter").toBe(fighter(e.act(b, "striker-1", "jab", null, clock()).battle, "striker-1").counter);
    expect(previewOf(e, b)?.actions.finisher?.refusal, "a Finisher with no Momentum is previewed with the server's refusal").toMatch(/Momentum/);
    expect(jab?.refusal, "an allowed action has no refusal").toBeNull();
  });

  it("previews nothing while the clock runs or the Orrery is on the plate", async () => {
    const e = await engine();
    const b = table(e, ["striker"]);
    expect(previewOf(e, { ...b, activeId: null }), "nobody on the plate: no preview").toBeNull();
    expect(previewOf(e, e.plate(b, "orrery", clock())), "the Orrery on the plate: no preview").toBeNull();
  });
});

describe("the server names the card a Reaction answers", () => {
  it("names the card a ready Warden may Intercept, and no card once the Reaction is spent", async () => {
    const e = await engine();
    let b = table(e, ["warden", "mender"]);
    const clean = structuredClone(b);
    clean.cards = [];
    b = e.announce(clean, { intent: "eclipse", targetId: "mender-2", amount: 20, countdown: 0 });
    const card = b.cards[0].id;
    expect(reactionCard(e, b, "warden-1"), "a ready Warden is named the blow on the Mender").toBe(card);
    expect(reactionCard(e, b, "mender-2"), "a Mender has no Reaction to name a card for").toBeNull();
    const spent = e.act(b, "warden-1", "intercept", card, clock()).battle;
    expect(reactionCard(e, spent, "warden-1"), "a spent Reaction names no card").toBeNull();
  });

  it("names no card the Reaction couldn't answer", async () => {
    const e = await engine();
    let b = table(e, ["warden", "mender"]);
    const clean = structuredClone(b);
    clean.cards = [];
    b = e.announce(clean, { intent: "revolution", targetId: "party", amount: 10, countdown: 0 });
    b = e.announce(b, { intent: "eclipse", targetId: "warden-1", amount: 20, countdown: 0 });
    expect(reactionCard(e, b, "warden-1"), "a raid-wide card, and a blow already meant for the Warden: nothing to Intercept").toBeNull();
  });
});
