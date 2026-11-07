// @vitest-environment jsdom
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { servedCss } from "./served-css.ts";

// Your next card, pinned (ADR-012, piece 4; CLAUDE.md rule 34;
// docs/features-rice.md item 10). At 1920×1080 the strip truncates its cards,
// and at 390×844 it hides most targets, so the card about to down you is one
// you have to find. When a card on the strip is aimed at your seat, the command
// window shows it above the commands with its countdown and amount, in
// --ember, in the order the server sent the cards (rule 1: never re-sorted).
// Drawn from state, as the window's meters are; it enables nothing (rule 2).

type Win = { setEnabled(on: boolean): void; setSeat(info: Record<string, unknown>): void; destroy(): void };
const token = (id: string, role = "striker") => ({
  id, kind: "character", name: id, role, counter: 3, hp: 100, maxHp: 100, hasted: false, braced: false, seat: 1, charge: 0,
  resource: 0, gravity: 0, drifting: false, echo: false, reactionReady: true, warded: false, seatedBy: null, reactionCard: null,
});
const card = (id: string, intent: string, targetId: string | null, countdown: number, amount: number | null = 20, frozen = false) => ({
  id, intent, targetId, amount, countdown, frozen,
});

async function mount() {
  const { mountCommandWindow } = (await import(resolve("src/client/command/window.ts"))) as {
    mountCommandWindow: (root: HTMLElement, o: Record<string, unknown>) => Win;
  };
  const root = document.createElement("div");
  document.body.append(root);
  const chosen: string[] = [];
  const win = mountCommandWindow(root, { actions: ["brace", "riposte", "jab"], allies: () => [], onTarget() {}, onChoose: (a: string) => chosen.push(a) });
  const pinned = () => root.querySelector<HTMLElement>("[data-threat]");
  return { root, win, pinned, chosen };
}

describe("a card aimed at you is pinned in the command window", () => {
  it("shows what, how soon and how much, for your seat only", async () => {
    const { win, pinned } = await mount();
    win.setSeat({
      token: token("ada"),
      preview: null,
      threats: [card("c1", "revolution", "party", 0, 8), card("c2", "lunge", "ada", 1, 18), card("c3", "eclipse", "bo", 0, 30)],
    });
    expect(pinned()?.hidden, "a card is aimed at you: the line is up").toBe(false);
    const items = [...(pinned()?.querySelectorAll<HTMLElement>("[data-threat-card]") ?? [])];
    expect(items.map((i) => i.dataset.threatCard), "only the card aimed at you, not the one on everyone or on Bo").toEqual(["c2"]);
    expect(items[0].textContent, "its intent, its countdown, at you, and its amount").toBe("Lunge in 1 → you, 18");
    win.destroy();
  });

  it("several, in the order the server sent them, never re-sorted", async () => {
    const { win, pinned } = await mount();
    // The server's order: a frozen Eclipse at 0 first (it waits a cycle), then a Lunge at 1. Sorting by countdown
    // would keep this; sorting by when it lands would swap them. The window keeps the server's.
    // The gate's 3d: an order no sort the client could pick would give (not by countdown either way, not by id).
    win.setSeat({
      token: token("ada"),
      preview: null,
      threats: [card("m", "eclipse", "ada", 1, 30), card("z", "lunge", "ada", 2, 18), card("a", "eclipse", "ada", 0, 12)],
    });
    const ids = [...(pinned()?.querySelectorAll<HTMLElement>("[data-threat-card]") ?? [])].map((i) => i.dataset.threatCard);
    expect(ids, "drawn in the order sent").toEqual(["m", "z", "a"]);
    win.destroy();
  });

  it("next, frozen, and no amount are said as they are", async () => {
    const { win, pinned } = await mount();
    win.setSeat({ token: token("ada"), preview: null, threats: [card("a", "eclipse", "ada", 0, 30), card("b", "lunge", "ada", 2, null, true)] });
    const text = [...(pinned()?.querySelectorAll<HTMLElement>("[data-threat-card]") ?? [])].map((i) => i.textContent);
    expect(text).toEqual(["Eclipse next → you, 30", "Lunge in 2, frozen → you"]);
    win.destroy();
  });

  it("nothing aimed at you, or no seat: the line is down", async () => {
    const { win, pinned } = await mount();
    win.setSeat({ token: token("ada"), preview: null, threats: [card("c1", "revolution", "party", 0, 8)] });
    expect(pinned()?.hidden, "a card on everyone isn't pinned: the strip shows it").toBe(true);
    win.setSeat({ token: null, preview: null, threats: [card("c2", "lunge", "ada", 1)] });
    expect(pinned()?.hidden, "no seat, nothing is yours").toBe(true);
    win.destroy();
  });

  it("is said to a screen reader, and changes nothing that is live (rule 2)", async () => {
    const { win, pinned, root, chosen } = await mount();
    win.setEnabled(false);
    const live = () => [...root.querySelectorAll<HTMLButtonElement>("button[data-action]")].map((b) => b.disabled);
    win.setSeat({ token: token("ada"), preview: null, threats: [] });
    const before = live();
    win.setSeat({ token: token("ada"), preview: null, threats: [card("c2", "lunge", "ada", 1, 18)] });
    expect(pinned()?.getAttribute("aria-label") ?? pinned()?.textContent, "it has words").toMatch(/Lunge in 1/);
    expect(live(), "the same options live and dark").toEqual(before);
    expect(chosen).toEqual([]);
    win.destroy();
  });

  it("main.ts hands the window the state's cards as sent, not a list of its own", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(resolve("src/client/main.ts"), "utf8");
    expect(src, "the window is told the server's cards, untouched (the gate's 3c)").toMatch(/threats:\s*state\.cards,/);
    expect(src, "and no client re-sorts them on the way").not.toMatch(/state\.cards\s*\.\s*(?:slice|sort|toSorted|filter|reverse)/);
  });
});

describe("the pinned card is drawn in --ember", () => {
  it("the served CSS paints [data-threat] text in --ember on the window's ink", async () => {
    const css = await servedCss(process.env.APP_URL ?? "http://localhost:8080", ["/"]);
    const rule = /#battle \.command-threat\s*\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(rule, "a rule for the pinned line").not.toBe("");
    expect(rule, "its text is --ember, the colour of harm").toMatch(/color:\s*var\(--ember\)/);
  });
});
