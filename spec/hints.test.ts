// @vitest-environment jsdom
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A hint for every role (ADR-012, piece 3; CLAUDE.md rule 34;
// docs/features-rice.md item 7). The Warden's Bastion prompt is the model:
// read from the state every client is sent and nothing else, a note on the
// command it asks for. One per role, each on the condition the ADR names, and
// none otherwise. A hint is advice: it changes the words on an option and
// nothing about whether the option is live (rule 2). The last test proves it:
// a window told every hint accepts exactly what a window told none accepts.

type Prompts = (s: unknown, token: unknown) => Record<string, string>;
const load = async () => ((await import(resolve("src/client/command/prompts.ts"))) as { prompts: Prompts }).prompts;

const token = (id: string, role: string, over: Record<string, unknown> = {}) => ({
  id, kind: role === "orrery" ? "boss" : "character", name: id === "orrery" ? "The Orrery" : id.charAt(0).toUpperCase() + id.slice(1), role,
  counter: 3, hp: 100, maxHp: 100, hasted: false, braced: false, seat: 1, charge: 0, resource: 0, gravity: 0,
  drifting: false, echo: false, reactionReady: true, warded: false, seatedBy: null, reactionCard: null, ...over,
});
const ring = (id: string, over: Record<string, unknown> = {}) => ({ id, pips: 4, maxPips: 4, weakness: null, broken: false, exposed: [], ...over });
const card = (id: string, intent: string, targetId: string | null, countdown: number, amount: number | null = 20) => ({
  id, intent, targetId, amount, countdown, frozen: false,
});

/** A table of all five, nothing on the strip that asks anything of anyone. */
function state(over: Record<string, unknown> = {}) {
  return {
    battleId: "b", version: 1, tick: 1, tickMs: 150, turnMs: 12_000, plateMs: null, status: "fighting", activeId: null, turnDeadline: null,
    queue: [token("wren", "warden"), token("mae", "mender"), token("sol", "striker"), token("bex", "breaker"), token("cy", "chronist"), token("orrery", "orrery")],
    fallen: [], log: [], phase: 1, chain: { links: 0, potency: 1 }, pullSeats: 5, spentExposed: [], room: null, preview: null,
    alignmentLeft: null, echoRoles: [], bastion: false, bastionCard: null, gravityLethal: 2, hostId: null, lobby: false, pullAt: null, ending: null,
    rings: [ring("outer"), ring("middle"), ring("inner")],
    cards: [card("rev", "revolution", "party", 0, 8)],
    ...over,
  };
}
const me = (s: ReturnType<typeof state>, id: string) => s.queue.find((t) => t.id === id);

describe("every role has a hint, read from state, on the condition the ADR names", () => {
  it("the Warden: a Lunge on the strip aimed at an ally carrying Gravity asks for Anchor", async () => {
    const prompts = await load();
    const s = state({
      queue: [token("wren", "warden"), token("mae", "mender", { gravity: 1 }), token("orrery", "orrery")],
      cards: [card("lun", "lunge", "mae", 1)],
    });
    expect(prompts(s, me(s, "wren")).anchor).toBe("Lunge in 1 on Mae, at Gravity 1: Anchor it onto yourself.");
    // No Gravity on the mark: no hint. A Lunge on the Warden: no hint (Anchor can't take your own).
    const plain = state({ cards: [card("lun", "lunge", "mae", 1)] });
    expect(prompts(plain, me(plain, "wren")).anchor, "no Gravity: nothing to swap").toBeUndefined();
    const mine = state({ queue: [token("wren", "warden", { gravity: 2 }), token("orrery", "orrery")], cards: [card("lun", "lunge", "wren", 0)] });
    expect(prompts(mine, me(mine, "wren")).anchor, "aimed at the Warden: Anchor isn't the answer").toBeUndefined();
  });

  it("the Mender: a Lunge or Eclipse aimed at a seat that isn't Warded asks for Ward", async () => {
    const prompts = await load();
    const s = state({ cards: [card("ecl", "eclipse", "sol", 1)] });
    expect(prompts(s, me(s, "mae")).ward).toBe("Eclipse in 1 on Sol: Ward them.");
    const lunge = state({ cards: [card("lun", "lunge", "bex", 0)] });
    expect(prompts(lunge, me(lunge, "mae")).ward).toBe("Lunge next on Bex: Ward them.");
    const warded = state({ queue: [token("mae", "mender"), token("sol", "striker", { warded: true }), token("orrery", "orrery")], cards: [card("ecl", "eclipse", "sol", 1)] });
    expect(prompts(warded, me(warded, "mae")).ward, "already Warded: no hint").toBeUndefined();
    const self = state({ cards: [card("ecl", "eclipse", "mae", 1)] });
    expect(prompts(self, me(self, "mae")).ward, "aimed at the Mender: Ward yourself").toBe("Eclipse in 1 on you: Ward yourself.");
  });

  it("the Striker: a Broken ring asks for Finisher", async () => {
    const prompts = await load();
    const s = state({ rings: [ring("outer", { pips: 0, broken: true }), ring("middle"), ring("inner")] });
    expect(prompts(s, me(s, "sol")).finisher).toBe("The outer ring is Broken: a Finisher into it doubles.");
    expect(prompts(state(), me(state(), "sol")).finisher, "no ring Broken: no hint").toBeUndefined();
  });

  it("the Breaker: a revealed weakness on a ring that still has a shield asks for Pry", async () => {
    const prompts = await load();
    const s = state({ rings: [ring("outer"), ring("middle", { weakness: "frost" }), ring("inner")] });
    expect(prompts(s, me(s, "bex")).pry).toBe("The middle ring is weak to frost: Pry it.");
    const broken = state({ rings: [ring("outer"), ring("middle", { weakness: "frost", pips: 0, broken: true }), ring("inner")] });
    expect(prompts(broken, me(broken, "bex")).pry, "weak but Broken: nothing left to pry").toBeUndefined();
    expect(prompts(state(), me(state(), "bex")).pry, "nothing revealed: no hint").toBeUndefined();
  });

  it("the Chronist: a Retrograde on the strip asks for Delay", async () => {
    const prompts = await load();
    const s = state({ cards: [card("rev", "revolution", "party", 0, 8), card("ret", "retrograde", null, 2, null)] });
    expect(prompts(s, me(s, "cy")).delay).toBe("Retrograde in 2: Delay it and it comes apart.");
    expect(prompts(state(), me(state(), "cy")).delay, "no Retrograde: no hint").toBeUndefined();
  });

  it("each hint is its own role's: nobody is asked for another role's command", async () => {
    const prompts = await load();
    const s = state({
      queue: [token("wren", "warden"), token("mae", "mender", { gravity: 2 }), token("sol", "striker"), token("bex", "breaker"), token("cy", "chronist"), token("orrery", "orrery")],
      rings: [ring("outer", { pips: 0, broken: true }), ring("middle", { weakness: "frost" }), ring("inner")],
      cards: [card("lun", "lunge", "mae", 1), card("ret", "retrograde", null, 2, null)],
    });
    const asked: Record<string, string[]> = {};
    for (const id of ["wren", "mae", "sol", "bex", "cy"]) asked[id] = Object.keys(prompts(s, me(s, id)));
    expect(asked).toEqual({ wren: ["anchor"], mae: ["ward"], sol: ["finisher"], bex: ["pry"], cy: ["delay"] });
    expect(prompts(state({ status: "won" }), me(s, "sol")), "an ended fight asks nothing").toEqual({});
  });
});

describe("a hint is advice: it never changes what the window accepts (rule 2)", () => {
  type Win = { setEnabled(on: boolean): void; setReactionReady(id: string | null): void; setSeat(info: Record<string, unknown>): void; destroy(): void };
  const mount = async (role: string, actions: string[]) => {
    const { mountCommandWindow } = (await import(resolve("src/client/command/window.ts"))) as {
      mountCommandWindow: (root: HTMLElement, o: Record<string, unknown>) => Win;
    };
    const root = document.createElement("div");
    document.body.append(root);
    const chosen: string[] = [];
    const win = mountCommandWindow(root, {
      actions,
      allies: () => [{ id: "mae", name: "Mae" }],
      cards: () => [{ id: "lun", name: "Lunge on Mae, in 1" }],
      rings: () => [{ id: "outer", name: "Outer" }],
      onTarget() {},
      onChoose: (a: string) => chosen.push(a),
    });
    return { root, win, chosen, role };
  };

  const ROLES: Record<string, string[]> = {
    warden: ["brace", "intercept", "anchor", "bastion", "counterweight"],
    mender: ["brace", "veil", "mend", "ward", "quicken", "restore"],
    striker: ["brace", "riposte", "jab", "cleave", "finisher", "feint"],
    breaker: ["brace", "fracture", "scan", "pry", "mark", "shatter"],
    chronist: ["brace", "nudge", "delay", "haste", "relay", "stillpoint"],
  };
  const HINT = "Something to do: this is only advice.";

  for (const [role, actions] of Object.entries(ROLES)) {
    it(`${role}: told every hint, the window is live, dark and refused exactly where it is told none`, async () => {
      const every = Object.fromEntries(actions.map((a) => [a, HINT]));
      // Off the turn, with no Reaction named; off the turn with one; on the turn, with one action refused.
      const situations = [
        { enabled: false, reaction: null, preview: null },
        { enabled: false, reaction: "lun", preview: null },
        { enabled: true, reaction: null, preview: Object.fromEntries(actions.map((a, i) => [a, { counter: 9, slot: 1, resonance: false, refusal: i === 1 ? "Not now." : null, target: null }])) },
      ];
      for (const s of situations) {
        const seen: Record<string, unknown>[] = [];
        for (const prompts of [{}, every]) {
          const { root, win } = await mount(role, actions);
          win.setEnabled(s.enabled);
          win.setReactionReady(s.reaction);
          win.setSeat({ token: token("me", role), preview: s.preview, prompts });
          const options = [...root.querySelectorAll<HTMLButtonElement>("button[data-action]")];
          seen.push(
            Object.fromEntries(
              options.map((o) => [o.dataset.action, { disabled: o.disabled, refused: o.hasAttribute("data-refused"), ariaDisabled: o.getAttribute("aria-disabled") }]),
            ),
          );
          if (prompts === every) {
            // The hints are drawn (so this compared something), and nothing more.
            expect(options.filter((o) => o.hasAttribute("data-prompt")).length, "the hints are drawn").toBeGreaterThan(0);
          }
          win.destroy();
        }
        expect(seen[1], `${role} ${JSON.stringify({ enabled: s.enabled, reaction: s.reaction })}: the same options live, dark and refused`).toEqual(seen[0]);
      }
    });
  }

  it("a hinted option that is dark sends nothing when pressed", async () => {
    const { root, win, chosen } = await mount("warden", ROLES.warden);
    win.setEnabled(false);
    win.setSeat({ token: token("wren", "warden"), preview: null, prompts: { anchor: HINT } });
    const anchor = root.querySelector<HTMLButtonElement>('button[data-action="anchor"]')!;
    expect(anchor.hasAttribute("data-prompt"), "the hint is on it").toBe(true);
    expect(anchor.disabled, "and it is dark off the turn").toBe(true);
    anchor.click();
    anchor.focus();
    anchor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    anchor.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(chosen, "nothing was handed over").toEqual([]);
    win.destroy();
  });
});
