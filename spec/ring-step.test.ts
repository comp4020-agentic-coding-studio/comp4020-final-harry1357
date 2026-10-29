// @vitest-environment jsdom
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Pick the ring (ADR-011; docs/features-rice.md item 9). The server takes a
// ring as a blow's target, and the command window offers one: every action
// aimed at the Orrery has a ring step, by arrow keys and Enter alone, that
// starts on the ring the server's preview says it would take with none
// chosen (rule 1: the window draws the server's default, never works one out),
// so a Breaker can open the inner ring while the Striker finishes the outer.

interface CommandWindow {
  setEnabled(on: boolean): void;
  setSeat(info: unknown): void;
  destroy(): void;
}
type Mount = (root: HTMLElement, options: Record<string, unknown>) => CommandWindow;

it("a blow at the Orrery steps through its rings, starting on the server's preview target, and sends the ring chosen", async () => {
  const { mountCommandWindow } = (await import(resolve("src/client/command/window.ts"))) as { mountCommandWindow: Mount };
  const root = document.createElement("div");
  document.body.append(root);
  const targets: (string | null)[] = [];
  const chosen: [string, string | null][] = [];
  const win = mountCommandWindow(root, {
    actions: ["cleave"],
    allies: () => [],
    rings: () => [
      { id: "outer", name: "Outer ring" },
      { id: "middle", name: "Middle ring" },
      { id: "inner", name: "Inner ring" },
    ],
    onTarget: (t: string | null) => targets.push(t),
    onChoose: (a: string, t: string | null) => chosen.push([a, t]),
  });
  win.setEnabled(true);
  // The server's preview: with no ring named, it would take the middle (a revealed weakness, say).
  win.setSeat({
    token: { id: "me", role: "striker", resource: 0, charge: 0 },
    preview: { cleave: { counter: 9, slot: 1, resonance: true, refusal: null, target: "middle" } },
    prompts: {},
  });
  const menu = root.querySelector<HTMLElement>('[role="menu"], [role="listbox"], [tabindex="0"]') ?? root;
  menu.focus();
  const key = (k: string) => (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

  key("Enter");
  expect(targets.at(-1), "the ring step starts where the server would aim it").toBe("middle");
  expect(root.querySelector("[data-aim-name]")?.textContent, "and names that ring").toMatch(/middle/i);
  key("ArrowDown");
  expect(targets.at(-1), "the arrows step to the next ring").toBe("inner");
  key("ArrowDown");
  expect(targets.at(-1), "and round").toBe("outer");
  key("Enter");
  expect(chosen, "Enter sends the ring chosen").toEqual([["cleave", "outer"]]);
  win.destroy();
});

it("with no preview target, the ring step starts on the first ring, never a ring of the window's own choosing", async () => {
  const { mountCommandWindow } = (await import(resolve("src/client/command/window.ts"))) as { mountCommandWindow: Mount };
  const root = document.createElement("div");
  document.body.append(root);
  const targets: (string | null)[] = [];
  const win = mountCommandWindow(root, {
    actions: ["jab"],
    allies: () => [],
    rings: () => [
      { id: "outer", name: "Outer ring" },
      { id: "middle", name: "Middle ring" },
      { id: "inner", name: "Inner ring" },
    ],
    onTarget: (t: string | null) => targets.push(t),
    onChoose: () => undefined,
  });
  win.setEnabled(true);
  const menu = root.querySelector<HTMLElement>('[role="menu"], [role="listbox"], [tabindex="0"]') ?? root;
  menu.focus();
  (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  expect(targets.at(-1)).toBe("outer");
  win.destroy();
});
