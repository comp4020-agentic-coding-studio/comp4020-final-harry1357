import { afterAll, beforeAll, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase, type Booted } from "./boot.ts";
import { launchChrome, type Chrome, type Tab } from "./browser.ts";

// Phase two's gate (docs/review/phase-two.md): findings that only a page can
// show, held in real Chrome against a server of the spec's own. Where a test
// needs the server to say something it wouldn't say on cue (a refusal, a
// Reaction's card), the page's own fetch or socket is tampered with before the
// client's code runs, so what's held is the client following the server's word.

let server: Booted;
let chrome: Chrome;

beforeAll(async () => {
  server = await boot(scratchDatabase(), { TICK_MS: "20" });
  chrome = await launchChrome();
}, 30_000);

afterAll(async () => {
  await chrome?.close();
  await server?.kill();
  cleanScratch();
});

/** A page with its fetch and socket wrapped before the client's code runs; `tamper` is page source run first. */
async function page(tamper = ""): Promise<Tab> {
  const tab = await chrome.open("about:blank");
  await tab.send("Page.addScriptToEvaluateOnNewDocument", { source: tamper });
  await tab.send("Page.navigate", { url: `${server.base}/` });
  await tab.until(`!!document.querySelector("form[data-join]") && !document.querySelector("form[data-join]").hidden`, "the join form", 15_000);
  return tab;
}

/** Sit down through the form: a door, a role, a name. */
async function sit(tab: Tab, door: string, role: string, name: string): Promise<void> {
  await tab.evaluate(`(() => { const f = document.querySelector("form[data-join]");
    f.querySelector('input[name="door"][value="${door}"]')?.click();
    const n = f.querySelector('input[name="name"]'); n.value = ${JSON.stringify(name)}; n.dispatchEvent(new Event("input", { bubbles: true }));
    f.querySelector('input[name="role"][value="${role}"]').click(); f.requestSubmit(); })()`);
  await tab.until(`document.querySelector("#battle").dataset.phase === "fight"`, `${name} seated`, 15_000);
}

const LIVE = `[...document.querySelectorAll("button[data-action]:not([data-reaction])")].filter((b) => !b.disabled).length`;

it("R1: a refused command gives the turn back, as the server still has it", async () => {
  // The page's next action POST is answered 409, as the server answers a refused one.
  const tab = await page(`(() => {
    const real = window.fetch.bind(window);
    window.__refuseNext = false;
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      if (window.__refuseNext && /\\/actions$/.test(url)) {
        window.__refuseNext = false;
        return Promise.resolve(new Response(JSON.stringify({ error: "Refused, for the test." }), { status: 409, headers: { "content-type": "application/json" } }));
      }
      return real(input, init);
    };
  })();`);
  await sit(tab, "create", "striker", "Refused Once");
  await tab.until(`${LIVE} > 0`, "my turn", 30_000);
  await tab.evaluate(`window.__refuseNext = true; document.querySelector('button[data-action="jab"]').click(); document.querySelector("[data-confirm]").click()`);
  // Refused: the server never took the turn, so it's still yours, and the window says so.
  const back = await tab.until<number>(`${LIVE}`, "the turn's commands live again after the refusal", 2_000).catch(() => 0);
  expect(back, "after a refusal, the turn's commands are live again (not dark until the timeout Braces for you)").toBeGreaterThan(0);
  // And a second try goes through.
  await tab.evaluate(`document.querySelector('button[data-action="jab"]').click(); document.querySelector("[data-confirm]").click()`);
  await tab.until(`[...document.querySelectorAll("[data-log] li")].some((l) => /Refused Once jabs/.test(l.textContent))`, "the second Jab to land", 10_000);
}, 60_000);
