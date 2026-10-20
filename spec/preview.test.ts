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
    for (const r of scanned.rings) r.weakness = r.element; // every weakness known: a Cleave resonates
    b = e.plate(scanned, "striker-1", clock());
    const cleave = previewOf(e, b)?.actions.cleave;
    expect(cleave?.resonance, "a Cleave on a known weakness is previewed as a Resonance").toBe(true);
    expect(cleave?.counter, "at the refunded rank's counter").toBe(fighter(e.act(b, "striker-1", "cleave", null, clock()).battle, "striker-1").counter);
    // Jab is rank 1, already the floor (rule 14: never below 1): nothing to refund.
    expect(previewOf(e, b)?.actions.jab?.resonance, "a Jab has no rank to refund, weakness or not").toBe(false);
    expect(previewOf(e, b)?.actions.finisher?.refusal, "a Finisher with no Momentum is previewed with the server's refusal").toMatch(/Momentum/);
    expect(cleave?.refusal, "an allowed action has no refusal").toBeNull();
  });

  it("refuses an ally action only when no ally could take it", async () => {
    // Area (b)'s finding: the preview checked each action at its default
    // target, which for an ally action is the actor, so Quicken (never on
    // yourself) was always "refused" and a Mender could never Quicken; Ward
    // too, whenever the Mender was already Warded. An ally action is refused
    // only if every standing ally would be refused.
    const e = await engine();
    const b = e.plate(table(e, ["mender", "warden"]), "mender-1", clock());
    expect(previewOf(e, b)?.actions.quicken?.refusal, "a Mender with an ally beside them can Quicken").toBeNull();
    const warded = structuredClone(b);
    warded.standing.find((f) => f.id === "mender-1")!.warded = true;
    expect(previewOf(e, warded)?.actions.ward?.refusal, "a Warded Mender can still Ward the Warden").toBeNull();
    const alone = e.plate(table(e, ["mender"]), "mender-1", clock());
    expect(previewOf(e, alone)?.actions.quicken?.refusal, "alone, there's nobody to Quicken: refused, in the server's words").toMatch(/Quicken/);
  });

  it("for every role, every action's preview is where the action, sent, leaves you (T3)", async () => {
    // Phase two's gate, the reviewer's T3: the first test checks three of a
    // Striker's actions. The preview's own arithmetic missed what an action
    // does to its actor before the reset: a Chronist's Haste on themselves
    // (its default target) halves their own next wait, and the ghost showed it
    // whole. Each action is sent at the target the server would take: none
    // given, or, for an ally action it won't take on yourself, the first ally
    // it would.
    const e = await engine();
    // Each role's turn actions: all five, but the Warden's Intercept is a Reaction.
    const turnActions: Record<string, number> = { warden: 4, mender: 5, striker: 5, breaker: 5, chronist: 5 };
    for (const role of Object.keys(turnActions)) {
      const id = `${role}-1`;
      const b = e.plate(table(e, [role, "mender", "warden", "striker"]), id, clock());
      const preview = previewOf(e, b);
      const shown = Object.entries(preview?.actions ?? {});
      expect(shown.length, `a ${role} on the plate is previewed every turn action`).toBe(turnActions[role]);
      for (const [action, p] of shown) {
        if (p.refusal !== null) {
          // A refusal previewed is a refusal the server gives (re-review N15: refused previews went unchecked):
          // at no target, and, for an ally action, at every ally standing.
          const allies = b.standing.filter((f) => f.kind === "character" && f.id !== id).map((f) => f.id);
          const targets = [null, ...(action === "restore" ? [] : ["mend", "ward", "quicken", "haste"].includes(action) ? allies : [])];
          for (const t of targets) {
            expect("status" in (e.checkAction(b, id, action, t) as object), `${role} ${action}: previewed refused, and refused at ${t ?? "no target"}`).toBe(true);
          }
          continue;
        }
        const refusedBare = "status" in (e.checkAction(b, id, action, null) as object);
        const target = refusedBare
          ? (b.standing.find((f) => f.kind === "character" && f.id !== id && !("status" in (e.checkAction(b, id, action, f.id) as object)))?.id ?? null)
          : null;
        const after = e.act(b, id, action, target, clock()).battle;
        expect(p.counter, `${role} ${action}: the counter the preview shows is the one the turn leaves`).toBe(fighter(after, id).counter);
        expect(p.slot, `${role} ${action}: and the slot it lands in`).toBe(slotOf(after, id));
      }
    }
  });

  it("names the target the server would take, so a command starts aimed where it would land (T6)", async () => {
    // Phase two's gate, the reviewer's T6 and R1: the window opened Quicken on
    // yourself (refused: never on yourself) and Anchor on the first card, often
    // a raid-wide one (refused: Anchor takes a blow aimed at one ally). The
    // preview names the target the server would take, and the window starts
    // its aim there.
    const e = await engine();
    let b = table(e, ["warden", "mender", "striker"]);
    const clean = structuredClone(b);
    clean.cards = [];
    b = e.announce(clean, { intent: "revolution", targetId: "party", amount: 8, countdown: 0 });
    b = e.announce(b, { intent: "eclipse", targetId: "mender-2", amount: 20, countdown: 1 });
    const eclipse = b.cards.find((c) => c.intent === "eclipse")!.id;
    const warden = previewOf(e, e.plate(b, "warden-1", clock()))?.actions as Record<string, { target?: string | null }>;
    expect(warden.anchor?.target, "Anchor: the blow aimed at one ally, not the raid-wide card ahead of it").toBe(eclipse);
    const mender = previewOf(e, e.plate(b, "mender-2", clock()))?.actions as Record<string, { target?: string | null }>;
    expect(mender.quicken?.target, "Quicken: an ally, never yourself").toMatch(/^(warden-1|striker-3)$/);
    expect(mender.mend?.target, "Mend with none chosen: yourself, as the server takes it").toBe("mender-2");
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

  it("names the soonest of two cards it could answer (T3)", async () => {
    const e = await engine();
    let b = table(e, ["warden", "mender", "striker"]);
    const clean = structuredClone(b);
    clean.cards = [];
    b = e.announce(clean, { intent: "eclipse", targetId: "mender-2", amount: 20, countdown: 1 });
    b = e.announce(b, { intent: "lunge", targetId: "striker-3", amount: 16, countdown: 0 });
    const soonest = b.cards.find((c) => c.countdown === 0)!.id;
    expect(reactionCard(e, b, "warden-1"), "of two blows on allies, the one landing first").toBe(soonest);
  });

  it("takes a Reaction only at the card it names (B1)", async () => {
    // Phase two's gate, the breaker's B1 (rule 2: a Reaction is live "only
    // against the card the server names"): with two blows on allies on the
    // strip, the server named the soonest and accepted an Intercept at the other.
    const e = await engine();
    let b = table(e, ["warden", "mender", "striker"]);
    const clean = structuredClone(b);
    clean.cards = [];
    b = e.announce(clean, { intent: "eclipse", targetId: "mender-2", amount: 20, countdown: 1 });
    b = e.announce(b, { intent: "lunge", targetId: "striker-3", amount: 16, countdown: 0 });
    const named = reactionCard(e, b, "warden-1");
    const other = b.cards.find((c) => c.id !== named && c.intent === "eclipse")!.id;
    const refused = e.checkAction(b, "warden-1", "intercept", other) as { status?: number; error?: string };
    expect(refused.status, "an Intercept at the card the server didn't name is refused").toBe(409);
    expect(refused.error, "and says which it answers").toMatch(/names|first/);
    expect("status" in (e.checkAction(b, "warden-1", "intercept", named) as object), "at the card it named, taken").toBe(false);
  });

  it("names the blow that lands first, counting a frozen card's lost turn (N16)", async () => {
    // Phase two's re-review, N16: the named card was the lowest countdown, but
    // a frozen card skips a turn (orrery.ts), so a frozen blow at 0 lands after
    // an unfrozen one at 0, and B1 made the name binding: the Intercept at the
    // blow landing first was refused.
    const e = await engine();
    let b = table(e, ["warden", "mender", "striker"]);
    const clean = structuredClone(b);
    clean.cards = [];
    b = e.announce(clean, { intent: "eclipse", targetId: "mender-2", amount: 20, countdown: 0 });
    b = e.announce(b, { intent: "lunge", targetId: "striker-3", amount: 16, countdown: 0 });
    b = structuredClone(b);
    const [held, lands] = b.cards;
    held.frozen = true;
    expect(reactionCard(e, b, "warden-1"), "the unfrozen blow lands first, so it's the one named").toBe(lands.id);
    expect("status" in (e.checkAction(b, "warden-1", "intercept", lands.id) as object), "and an Intercept at it is taken").toBe(false);
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
