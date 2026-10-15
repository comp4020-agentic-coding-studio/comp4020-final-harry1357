// @vitest-environment jsdom
import { resolve } from "node:path";
import { expect, it } from "vitest";

// The command window is operable by arrow keys and Enter alone: no pointer
// event is dispatched anywhere in this test. The window under test is the real
// module, mounted on a bare element with the two callbacks it hands choices to.

interface CommandWindow {
  setEnabled(on: boolean): void;
  setCountdown(fraction: number | null): void;
  destroy(): void;
}
type Mount = (
  root: HTMLElement,
  options: {
    actions: readonly string[];
    allies: () => { id: string; name: string }[];
    onTarget: (targetId: string | null) => void;
    onChoose: (action: string, targetId: string | null) => void;
  },
) => CommandWindow;

it("the command window is operable by arrow keys and Enter alone", async () => {
  let mountCommandWindow: Mount | undefined;
  try {
    ({ mountCommandWindow } = (await import(resolve("src/client/command/window.ts"))) as { mountCommandWindow?: Mount });
  } catch (err) {
    throw new Error(`the command window (src/client/command/window.ts) couldn't be loaded: ${(err as Error).message}`);
  }
  expect(typeof mountCommandWindow, "src/client/command/window.ts exports no mountCommandWindow").toBe("function");

  const root = document.createElement("div");
  document.body.append(root);
  const targets: (string | null)[] = [];
  const chosen: [string, string | null][] = [];
  const allies = [
    { id: "me", name: "Me" },
    { id: "ally", name: "Ally" },
  ];
  const win = (mountCommandWindow as Mount)(root, {
    actions: ["jab", "haste"],
    allies: () => allies,
    onTarget: (t) => targets.push(t),
    onChoose: (a, t) => chosen.push([a, t]),
  });
  win.setEnabled(true);

  const entry = root.querySelector<HTMLElement>('[role="menu"], [role="listbox"], [tabindex]') ?? root;
  entry.focus();
  const inside = () => document.activeElement !== null && root.contains(document.activeElement);
  expect(inside(), "nothing in the command window takes focus").toBe(true);
  const key = (k: string) => {
    (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));
    expect(inside(), `focus left the command window on ${k}`).toBe(true);
  };
  const cursor = () => root.querySelector<HTMLElement>("[data-cursor]")?.dataset.action;

  expect(root.querySelector('button[data-action="jab"]'), "each action is a button[data-action]").toBeTruthy();
  expect(cursor(), "the cursor starts on the first action").toBe("jab");
  key("ArrowDown");
  expect(cursor()).toBe("haste");
  key("ArrowDown");
  expect(cursor(), "the cursor wraps").toBe("jab");
  key("ArrowUp");
  expect(cursor()).toBe("haste");
  key("ArrowDown");

  key("Enter");
  expect(targets.at(-1), "choosing Jab highlights the Orrery first").toBe("orrery");
  expect(chosen, "and doesn't act yet").toEqual([]);
  key("Escape");
  expect(targets.at(-1), "Escape backs out and clears the highlight").toBe(null);
  expect(chosen).toEqual([]);
  key("Enter");
  key("Enter");
  expect(chosen, "Enter, Enter jabs the Orrery").toEqual([["jab", "orrery"]]);

  key("ArrowDown");
  key("Enter");
  expect(targets.at(-1), "an ally action starts on the first ally").toBe("me");
  key("ArrowDown");
  expect(targets.at(-1), "arrows move between allies").toBe("ally");
  key("Enter");
  expect(chosen.at(-1)).toEqual(["haste", "ally"]);

  win.setEnabled(false);
  const before = chosen.length;
  key("Enter");
  key("Enter");
  expect(chosen.length, "a disabled window chooses nothing").toBe(before);
  win.destroy();
});
