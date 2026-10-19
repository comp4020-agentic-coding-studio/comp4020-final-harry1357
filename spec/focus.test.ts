import { afterAll, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase } from "./boot.ts";
import { launchChrome, type Tab } from "./browser.ts";
import { sleep } from "./raid.ts";

// Phase two's gate, P1 (from play): after sitting down, focus fell to the page
// body, and the commands were three Tabs away. The join screen hides as you
// sit, taking the focused field with it. Sitting down is the moment the
// commands matter, so focus goes into the command window: its list while it's
// dark, and the live command once your turn comes (the window moves it there
// itself), with no Tab at all. Trusted key events (Input.dispatchKeyEvent), as
// check:keyboard does: a page's own dispatchEvent is not a person.

afterAll(cleanScratch);

const KEYS: Record<string, { code: string; vk: number; text?: string }> = {
  Tab: { code: "Tab", vk: 9 },
  Enter: { code: "Enter", vk: 13, text: "\r" },
};

async function key(tab: Tab, k: string): Promise<void> {
  const d = KEYS[k];
  const base = { key: k, code: d.code, windowsVirtualKeyCode: d.vk, nativeVirtualKeyCode: d.vk };
  await tab.send("Input.dispatchKeyEvent", { type: "keyDown", ...base, ...(d.text ? { text: d.text, unmodifiedText: d.text } : {}) });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(30);
}

it("P1: sitting down by keyboard puts focus in the command window, and your turn's command needs no Tab", async () => {
  const server = await boot(scratchDatabase(), { TICK_MS: "20" });
  const chrome = await launchChrome();
  try {
    const tab = await chrome.open(`${server.base}/`);
    await tab.until(`!!document.querySelector("form[data-join]") && !document.querySelector("form[data-join]").hidden`, "the join form", 15_000);
    // Tab to the name field, type it, Enter: the form's own submit.
    let tabs = 0;
    while (!(await tab.evaluate<boolean>(`document.activeElement?.name === "name"`))) {
      if (++tabs > 40) throw new Error("40 Tabs never reached the name field");
      await key(tab, "Tab");
    }
    await tab.send("Input.insertText", { text: "Focus Test" });
    await key(tab, "Enter");
    await tab.until(`document.querySelector("#battle").dataset.phase === "fight"`, "seated", 15_000);
    await sleep(150);
    const where = await tab.evaluate<string>(
      `(() => { const a = document.activeElement; return !a || a === document.body ? "body" : (a.closest("[data-command]") ? "command:" + (a.dataset.action ?? a.className) : a.tagName + "." + a.className); })()`,
    );
    expect(where, "seated: focus is in the command window, not on the page body").toMatch(/^command:/);

    await tab.until(`[...document.querySelectorAll("button[data-action]:not([data-reaction])")].some((b) => !b.disabled)`, "my turn", 30_000);
    await sleep(100);
    const live = await tab.evaluate<string | null>(`document.activeElement?.matches("button[data-action]:enabled") ? document.activeElement.dataset.action : null`);
    expect(live, "on your turn, focus is on a live command already: no Tab to reach it").not.toBeNull();
  } finally {
    await chrome.close();
    await server.kill();
  }
}, 60_000);
