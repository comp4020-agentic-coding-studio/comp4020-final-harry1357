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
  // A tick long enough that off-turn time (the clock running between turns) can be seen.
  server = await boot(scratchDatabase(), { TICK_MS: "100" });
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

/** Wrap the page's socket: log every URL, and let `window.__react` rewrite your token's Reaction card in each state. */
const SOCKET_TAMPER = `(() => {
  window.__react = "off";
  window.__sockets = [];
  const Real = window.WebSocket;
  window.WebSocket = class extends Real {
    constructor(url, protocols) { super(url, protocols); window.__sockets.push(String(url)); }
    addEventListener(type, fn, opts) {
      if (type !== "message") return super.addEventListener(type, fn, opts);
      return super.addEventListener(type, (event) => {
        let data = event.data;
        try {
          const m = JSON.parse(data);
          const me = document.body.dataset.me;
          if (m.type === "state" && me && window.__react !== "off") {
            for (const t of m.battle.queue) if (t.id === me) t.reactionCard = window.__react === "first" ? (m.battle.cards[0]?.id ?? null) : null;
            data = JSON.stringify(m);
          }
        } catch {}
        fn.call(this, { type: "message", data });
      }, opts);
    }
  };
})();`;

it("U2 (rule 2): the Reaction offered off-turn is at the card the server names, whatever the page would think", async () => {
  // The server is made to name a raid-wide Revolution, a card no Intercept could
  // answer: a client that picked the card itself would never offer it. Then it
  // names none, and the Reaction goes dark.
  const tab = await page(SOCKET_TAMPER);
  await sit(tab, "create", "warden", "Named Card");
  await tab.until(`!!document.querySelector('[data-add-echo="mender"]:not([disabled])')`, "the Echo button", 10_000);
  await tab.evaluate(`document.querySelector('[data-add-echo="mender"]').click()`);
  await tab.evaluate(`window.__react = "first"`);
  await tab.until(`!!document.querySelector('button[data-action="intercept"]:not([disabled])') && ${LIVE} === 0`, "the Reaction live off-turn", 30_000);
  const first = await tab.evaluate<string>(`document.querySelector("[data-rail] [data-card-id]").dataset.intent`);
  await tab.evaluate(`document.querySelector('button[data-action="intercept"]').click()`);
  const aimed = await tab.evaluate<string>(`document.querySelector("[data-aim-name]").textContent`);
  expect(aimed.toLowerCase(), "Intercept is aimed at the card the server named (the strip's first, a raid-wide card)").toMatch(new RegExp(`^${first}`));
  await tab.evaluate(`document.querySelector("[data-cancel]").click()`);
  const version = await tab.evaluate<string>(`document.querySelector("[data-rail]").dataset.version`);
  await tab.evaluate(`window.__react = "none"`);
  await tab.until(`document.querySelector("[data-rail]").dataset.version !== ${JSON.stringify(version)}`, "the server's next word", 15_000);
  expect(await tab.evaluate<boolean>(`document.querySelector('button[data-action="intercept"]').disabled`), "the server names no card: the Reaction is dark").toBe(true);
}, 60_000);

it("T7 (rule 23): with no code, the page opens the room the server's default door names, and no bare battle", async () => {
  // The default door is made to answer a code the client couldn't know (the real
  // one is "RAID", which a client could hard-code). Whatever happens next, the
  // page must have asked for that room, and never made or watched a battle of its own.
  const t = await chrome.open("about:blank");
  await t.send("Page.addScriptToEvaluateOnNewDocument", { source: `${SOCKET_TAMPER}
  (() => {
    window.__fetches = [];
    const real = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === "string" ? input : input.url;
      window.__fetches.push(((init && init.method) || "GET") + " " + url);
      if (/\\/api\\/raid$/.test(url)) return Promise.resolve(new Response(JSON.stringify({ code: "QZXWV", isPublic: true, battleId: "b-elsewhere" }), { headers: { "content-type": "application/json" } }));
      return real(input, init);
    };
  })();` });
  // There's no such room, so the join form may never show; the page is judged by what it asked for.
  await t.send("Page.navigate", { url: `${server.base}/` });
  await t.until(`(window.__sockets || []).length > 0`, "a socket opened", 15_000);
  // And after the server refuses that room (4404), nothing else either (re-review N14: a client trying the
  // room, then falling back to a battle of its own, passed when read at its first socket).
  await t.until(`document.querySelector("#battle").dataset.closed === "missing"`, "the page saying there's no such room", 15_000);
  await t.evaluate(`new Promise((r) => setTimeout(r, 1500))`);
  const sockets = await t.evaluate<string[]>(`window.__sockets`);
  const fetches = await t.evaluate<string[]>(`window.__fetches`);
  expect(sockets.some((u) => /\/ws\?room=QZXWV$/.test(u)), `the room the default door named (sockets: ${sockets.join(", ")})`).toBe(true);
  expect(sockets.filter((u) => /[?&]battle=/.test(u)), "no battle socket of its own").toEqual([]);
  expect(fetches.filter((f) => /^POST .*\/api\/battles$/.test(f)), "and no bare battle made").toEqual([]);
}, 60_000);

it("Q2 and Q1: a room closing under the end panel keeps the ending it shows, and its log", async () => {
  // Phase two's gate, the breaker's Q2: with the end panel up, the room's empty
  // next fight was closed when the room expired, and the panel changed to
  // "Nobody stayed", a fight nobody played. And Q1, in the page: the last
  // fight's lines stay in the log while its ending is up. A fast clock and four
  // Echoes play the fight out; the room closes two seconds after it's empty.
  const own = await boot(scratchDatabase(), { TICK_MS: "5", TURN_TIMEOUT_MS: "250", ECHO_BEAT_MS: "100", ROOM_EMPTY_MS: "2000" });
  const tab = await chrome.open("about:blank");
  try {
    await tab.send("Page.navigate", { url: `${own.base}/` });
    await tab.until(`!!document.querySelector("form[data-join]") && !document.querySelector("form[data-join]").hidden`, "the join form", 15_000);
    await sit(tab, "create", "striker", "Stays Shown");
    for (const role of ["warden", "mender", "breaker", "chronist"]) {
      await tab.until(`!!document.querySelector('[data-add-echo="${role}"]:not([disabled])')`, `the ${role} Echo button`, 10_000);
      await tab.evaluate(`document.querySelector('[data-add-echo="${role}"]').click()`);
      await tab.until(`!document.querySelector('[data-add-echo="${role}"]')`, `the ${role} Echo seated`, 10_000);
    }
    const visible = `(() => { const p = document.querySelector("[data-join-end]"); return !!p && !p.hidden && !p.closest("[hidden]"); })()`;
    await tab.until(visible, "the end panel", 60_000);
    const title = await tab.evaluate<string>(`document.querySelector("[data-join-end] .join-end-title").textContent`);
    expect(title, "a fight four Echoes and a person played out ends won or lost").not.toBe("Nobody stayed");
    await tab.until(`document.querySelector("#battle").dataset.closed === "expired"`, "the empty room to close", 15_000);
    await tab.evaluate(`new Promise((r) => setTimeout(r, 300))`);
    expect(await tab.evaluate<boolean>(visible), "the end panel is still up").toBe(true);
    expect(await tab.evaluate<string>(`document.querySelector("[data-join-end] .join-end-title").textContent`), "and still says how the fight that was played ended").toBe(title);
    expect(await tab.evaluate<string>(`document.querySelector("[data-join-end] a").getAttribute("href")`), "the room's gone: the link is the front door").toBe("/");
    const log = await tab.evaluate<string>(`document.querySelector("[data-log]").textContent`);
    expect(log, "the last fight's end line is still in the log (Q1)").toMatch(/The table wins|has fallen|fall/i);
  } finally {
    await own.kill();
  }
}, 120_000);
