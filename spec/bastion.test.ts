// @vitest-environment jsdom
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Phase two's verify: "the Warden's Bastion prompt shows". Bastion isn't a
// Reaction; it's the Warden's turn action that blunts the next blow on
// everyone (docs/design/overhaul.md: "Bastion is how the room survives
// Perihelion"). So while a Perihelion is on the strip and no Bastion stands, a
// Warden's screen says so twice: on the Perihelion card ("Answer: Bastion"),
// and on the Bastion command, in the note where a refusal or a Reaction's card
// goes. Nobody else is prompted. Once one stands (the state's `bastion`), every
// screen marks the blow it will meet, and the prompt goes. Which blow that is
// is the server's to say (the state's `bastionCard`, phase two's gate R2): an
// Alignment is aimed at everyone but doesn't spend a Bastion, and a frozen card
// waits a cycle, so "the first card aimed at everyone" is the wrong answer.

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof matchMedia;

const token = (id: string, role: string, kind = "character") => ({
  id, kind, name: id, role, counter: 3, hp: 100, maxHp: 100, hasted: false, braced: false, seat: 1,
  charge: 0, resource: 2, gravity: 0, drifting: false, echo: false, reactionReady: true,
});

/** The strip a fight in phase I shows: a Revolution next, an Eclipse, and the Perihelion four out. */
function state(over: Record<string, unknown> = {}) {
  return {
    battleId: "b", version: 1, tick: 1, tickMs: 150, turnMs: 12_000, plateMs: null, status: "fighting", activeId: null, turnDeadline: null,
    queue: [token("wren", "warden"), token("mae", "mender"), token("orrery", "orrery", "boss")],
    fallen: [], log: [], phase: 1, rings: [], chain: { links: 0, potency: 1 }, pullSeats: 2, spentExposed: [],
    room: null, preview: null, alignmentLeft: null, echoRoles: [], bastion: false, bastionCard: "rev",
    cards: [
      { id: "rev", intent: "revolution", targetId: "party", amount: 8, countdown: 0, frozen: false },
      { id: "ecl", intent: "eclipse", targetId: "mae", amount: 20, countdown: 1, frozen: false },
      { id: "peri", intent: "perihelion", targetId: "party", amount: 32, countdown: 4, frozen: false },
    ],
    ...over,
  };
}

type Strip = { render(s: unknown, me: string | null): void };

async function strip(): Promise<{ root: HTMLElement; strip: Strip }> {
  const { createStrip } = (await import(resolve("src/client/strip/strip.ts"))) as { createStrip: (root: HTMLElement, o: unknown) => Strip };
  const root = document.createElement("aside");
  document.body.append(root);
  return { root, strip: createStrip(root, { manifest: { facing: "left", required: [], roles: {} }, orrerySvg: "<svg></svg>" }) };
}

const card = (root: HTMLElement, id: string) => root.querySelector<HTMLElement>(`[data-card-id="${id}"]`);

describe("the Warden's Bastion prompt", () => {
  it("a Warden sees the Perihelion card ask for a Bastion; nobody else does", async () => {
    const warden = await strip();
    warden.strip.render(state(), "wren");
    expect(card(warden.root, "peri")?.dataset.prompt, "the Perihelion asks the Warden for a Bastion").toBe("bastion");
    expect(card(warden.root, "peri")?.textContent, "in words, not a glow alone").toContain("Bastion");
    expect(card(warden.root, "rev")?.dataset.prompt, "an ordinary Revolution isn't what Bastion is for").toBeUndefined();

    const mender = await strip();
    mender.strip.render(state(), "mae");
    expect(card(mender.root, "peri")?.dataset.prompt, "a Mender has no Bastion to raise").toBeUndefined();
  });

  it("once a Bastion stands, every screen marks the blow on everyone it meets, and the prompt goes", async () => {
    for (const me of ["wren", "mae"]) {
      const s = await strip();
      s.strip.render(state({ bastion: true }), me);
      expect(card(s.root, "peri")?.dataset.prompt, `${me}: no prompt while one stands`).toBeUndefined();
      // The server names the card it meets: here the Revolution, not the Perihelion.
      expect(card(s.root, "rev")?.dataset.bastion, `${me}: the Revolution the server names is the one it meets`).toBe("true");
      expect(card(s.root, "rev")?.textContent, `${me}: said in words`).toContain("Bastion");
      expect(card(s.root, "peri")?.dataset.bastion, `${me}: not the Perihelion behind it`).toBeUndefined();
    }
  });

  it("the card marked is the one the server names, not the first card aimed at everyone", async () => {
    const cards = [
      { id: "align", intent: "alignment", targetId: "party", amount: null, countdown: 0, frozen: false },
      { id: "rev", intent: "revolution", targetId: "party", amount: 12, countdown: 1, frozen: false },
      { id: "peri", intent: "perihelion", targetId: "party", amount: 48, countdown: 4, frozen: false },
    ];
    const s = await strip();
    s.strip.render(state({ phase: 3, cards, bastion: true, bastionCard: "rev" }), "mae");
    expect(card(s.root, "align")?.dataset.bastion, "an Alignment doesn't spend a Bastion, and isn't marked").toBeUndefined();
    expect(card(s.root, "rev")?.dataset.bastion, "the card the server names is").toBe("true");

    const later = await strip();
    later.strip.render(state({ bastion: true, bastionCard: "peri" }), "mae");
    expect(card(later.root, "rev")?.dataset.bastion, "even the soonest blow on everyone isn't marked if the server names another").toBeUndefined();
    expect(card(later.root, "peri")?.dataset.bastion, "the server's word is the mark").toBe("true");

    const none = await strip();
    none.strip.render(state({ bastion: true, bastionCard: null }), "mae");
    expect(none.root.querySelector("[data-bastion]"), "no card named: none marked").toBeNull();
  });

  it("the Warden's prompt says the blow the server names comes first, not one the client picks (N7)", async () => {
    // Phase two's re-review, N7: every fixture named the card the old client
    // logic would also pick, so a prompt working out "which blow comes first"
    // itself passed. Here the server names cards that logic gets wrong.
    const { bastionFor } = (await import(resolve("src/client/strip/cards.ts"))) as {
      bastionFor: (s: unknown, mine: unknown) => { card: { id: string }; first: { id: string } | null } | null;
    };
    const wren = token("wren", "warden");
    const align = [
      { id: "align", intent: "alignment", targetId: "party", amount: null, countdown: 0, frozen: false },
      { id: "rev", intent: "revolution", targetId: "party", amount: 12, countdown: 1, frozen: false },
      { id: "peri", intent: "perihelion", targetId: "party", amount: 48, countdown: 4, frozen: false },
    ];
    // An Alignment is aimed at everyone and spends no Bastion: the server names the Revolution behind it.
    expect(bastionFor(state({ phase: 3, cards: align, bastionCard: "rev" }), wren)?.first?.id, "the Revolution the server names, not the Alignment").toBe("rev");
    const s = await strip();
    s.strip.render(state({ phase: 3, cards: align, bastionCard: "rev" }), "wren");
    const said = card(s.root, "peri")?.querySelector(".visually-hidden")?.textContent ?? "";
    expect(said, "the Perihelion's words name the Revolution coming first").toMatch(/Revolution/);
    expect(said, "not the Alignment").not.toMatch(/Alignment before it/);
    // A frozen Revolution waits a cycle: the server names the Perihelion itself, so nothing comes first.
    const frozen = [
      { id: "rev", intent: "revolution", targetId: "party", amount: 8, countdown: 0, frozen: true },
      { id: "peri", intent: "perihelion", targetId: "party", amount: 32, countdown: 0, frozen: false },
    ];
    expect(bastionFor(state({ cards: frozen, bastionCard: "peri" }), wren)?.first ?? null, "the server says the Perihelion is met first: nothing before it").toBeNull();
  });

  it("the Bastion command carries the prompt in its note, on the turn and off it; a refusal takes its place", async () => {
    const { mountCommandWindow } = (await import(resolve("src/client/command/window.ts"))) as {
      mountCommandWindow: (
        root: HTMLElement,
        o: Record<string, unknown>,
      ) => { setEnabled(on: boolean): void; setSeat(info: Record<string, unknown>): void; destroy(): void };
    };
    const root = document.createElement("div");
    document.body.append(root);
    const win = mountCommandWindow(root, { actions: ["brace", "intercept", "anchor", "bastion", "counterweight"], allies: () => [], onTarget() {}, onChoose() {} });
    const bastion = () => root.querySelector<HTMLButtonElement>('button[data-action="bastion"]');
    const note = () => bastion()?.querySelector<HTMLElement>(".command-note");
    const say = "Perihelion in 4: a Bastion blunts it.";

    win.setEnabled(false);
    win.setSeat({ token: token("wren", "warden"), preview: null, prompts: { bastion: say } });
    expect(bastion()?.hasAttribute("data-prompt"), "off-turn, the Bastion command is marked").toBe(true);
    expect(note()?.hidden, "and its note is showing").toBe(false);
    expect(note()?.textContent, "with the prompt's words").toContain(say);
    expect(bastion()?.disabled, "still not live off-turn (rule 2)").toBe(true);

    win.setEnabled(true);
    win.setSeat({ token: token("wren", "warden"), preview: { bastion: { counter: 9, slot: 2, resonance: false, refusal: null } }, prompts: { bastion: say } });
    expect(note()?.textContent, "on the turn, the prompt still shows").toContain(say);

    const refused = "Bastion spends Resolve, and you have none yet.";
    win.setSeat({ token: token("wren", "warden"), preview: { bastion: { counter: 9, slot: 2, resonance: false, refusal: refused } }, prompts: { bastion: say } });
    expect(note()?.textContent, "the server's refusal comes first").toContain(refused);

    win.setSeat({ token: token("wren", "warden"), preview: { bastion: { counter: 9, slot: 2, resonance: false, refusal: null } }, prompts: {} });
    expect(bastion()?.hasAttribute("data-prompt"), "no prompt: unmarked").toBe(false);
    expect(note()?.hidden, "and the note gives way to the blurb").toBe(true);
    win.destroy();
  });
});
