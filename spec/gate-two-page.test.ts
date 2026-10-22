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

/**
 * Sit down through the form: a door, a role, a name. A room made at the
 * "create" door is a lobby (rule 27; docs/adr/009), so this waits for the
 * lobby there and for the fight anywhere else.
 */
async function sit(tab: Tab, door: string, role: string, name: string): Promise<void> {
  await tab.evaluate(`(() => { const f = document.querySelector("form[data-join]");
    f.querySelector('input[name="door"][value="${door}"]')?.click();
    const n = f.querySelector('input[name="name"]'); n.value = ${JSON.stringify(name)}; n.dispatchEvent(new Event("input", { bubbles: true }));
    f.querySelector('input[name="role"][value="${role}"]').click(); f.requestSubmit(); })()`);
  const where = door === "create" ? "lobby" : "fight";
  await tab.until(`document.querySelector("#battle").dataset.phase === "${where}"`, `${name} seated`, 15_000);
}

/** The host seats an Echo of each role from the lobby's buttons (rule 25: only there). */
async function echoes(tab: Tab, roles: string[]): Promise<void> {
  for (const role of roles) {
    await tab.until(`!!document.querySelector('[data-lobby] [data-add-echo="${role}"]:not([disabled])')`, `the ${role} Echo button`, 10_000);
    await tab.evaluate(`document.querySelector('[data-lobby] [data-add-echo="${role}"]').click()`);
    await tab.until(`!document.querySelector('[data-lobby] [data-add-echo="${role}"]')`, `the ${role} Echo seated`, 10_000);
  }
}

/** The host presses Start (rule 27), and the page comes into the fight. */
async function start(tab: Tab): Promise<void> {
  await tab.until(`!!document.querySelector('[data-lobby] [data-start]:not([hidden]):not([disabled])')`, "the Start button", 10_000);
  await tab.evaluate(`document.querySelector('[data-lobby] [data-start]').click()`);
  await tab.until(`document.querySelector("#battle").dataset.phase === "fight"`, "the fight started", 15_000);
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
  await start(tab);
  await tab.until(`${LIVE} > 0`, "my turn", 30_000);
  await tab.evaluate(`window.__refuseNext = true; document.querySelector('button[data-action="jab"]').click(); document.querySelector("[data-confirm]").click()`);
  // Refused: the server never took the turn, so it's still yours, and the window says so.
  const back = await tab.until<number>(`${LIVE}`, "the turn's commands live again after the refusal", 2_000).catch(() => 0);
  expect(back, "after a refusal, the turn's commands are live again (not dark until the timeout Braces for you)").toBeGreaterThan(0);
  // And a second try goes through.
  await tab.evaluate(`document.querySelector('button[data-action="jab"]').click(); document.querySelector("[data-confirm]").click()`);
  await tab.until(`[...document.querySelectorAll("[data-log] li")].some((l) => /Refused Once jabs/.test(l.textContent))`, "the second Jab to land", 10_000);
}, 60_000);

/** Wrap the page's socket: log every URL, let `window.__react` rewrite your token's Reaction card in each state, and `window.__rewrite(state, me)` anything else. */
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
          if (m.type === "state" && typeof window.__rewrite === "function") {
            window.__rewrite(m.battle, me);
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
  await echoes(tab, ["mender"]);
  await start(tab);
  // From the next state on, the server names the strip's first card. A state that came before still carries
  // its own name (the card Intercept can really answer), so the test waits for a newer one.
  const named = await tab.evaluate<string>(`(window.__react = "first", document.querySelector("[data-rail]").dataset.version)`);
  // The strip's first card is the one named; the Orrery keeps the room's pace (docs/adr/010), so a state
  // can land between two reads. The named card, the click and the aim are read in one turn of the page,
  // with nothing able to arrive between them. Waited for a raid-wide card first: the test tells the
  // server's word from the page's own pick only if the named card is one no Intercept could answer (the
  // re-review's note on U2).
  await tab.until(
    `document.querySelector("[data-rail]").dataset.version !== ${JSON.stringify(named)} && !!document.querySelector('button[data-action="intercept"]:not([disabled])') && ${LIVE} === 0 && document.querySelector("[data-rail] [data-card-id]")?.dataset.target === "party"`,
    "the Reaction live off-turn, a raid-wide card named",
    30_000,
  );
  const read = await tab.evaluate<{ first: string; target: string; aimed: string }>(`(() => {
    const card = document.querySelector("[data-rail] [data-card-id]");
    const first = card.dataset.intent, target = card.dataset.target;
    document.querySelector('button[data-action="intercept"]').click();
    return { first, target, aimed: document.querySelector("[data-aim-name]").textContent };
  })()`);
  const { first } = read;
  expect(read.target, "the card named is aimed at everyone").toBe("party");
  const aimed = read.aimed;
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
  await t.evaluate(`new Promise((r) => setTimeout(r, 3000))`);
  const sockets = await t.evaluate<string[]>(`window.__sockets`);
  const fetches = await t.evaluate<string[]>(`window.__fetches`);
  // Exactly the room the default door named, and no other (the third review's M3: a page falling back to
  // another room after the 4404, the public raid's hard-coded "RAID" say, passed "some socket went there").
  expect(sockets.map((u) => u.replace(/^.*\/ws/, "/ws")), "the room the default door named, and no other").toEqual(["/ws?room=QZXWV"]);
  expect(sockets.filter((u) => /[?&]battle=/.test(u)), "no battle socket of its own").toEqual([]);
  expect(fetches.filter((f) => /^POST .*\/api\/battles$/.test(f)), "and no bare battle made").toEqual([]);
}, 60_000);

it("Q2 and Q1: a room closing under the end panel keeps the ending it shows, and its log", async () => {
  // Phase two's gate, the breaker's Q2: with the end panel up, the room's empty
  // next fight was closed when the room expired, and the panel changed to
  // "Nobody stayed", a fight nobody played. And Q1, in the page: the last
  // fight's lines stay in the log while its ending is up. Since ADR-009 a
  // room returns to its lobby with everyone seated, so the end panel is the
  // view of a page with no seat in the next fight: a second browser watching
  // the room by its code. The host plays the fight out with four Echoes on a
  // fast clock, then leaves the lobby; the room closes two seconds after it's
  // empty, under the watcher's end panel.
  const own = await boot(scratchDatabase(), { TICK_MS: "5", TURN_TIMEOUT_MS: "250", ECHO_BEAT_MS: "100", ROOM_EMPTY_MS: "2000" });
  // Each in a browser of its own: the watcher is another session, not the host's cookie in a second tab,
  // and neither is a background tab behind the earlier tests' live fights, whose timers Chrome clamps.
  const mine = await launchChrome();
  const tab = await mine.open("about:blank");
  const other = await launchChrome();
  const watcher = await other.open("about:blank");
  try {
    await tab.send("Page.navigate", { url: `${own.base}/` });
    await tab.until(`!!document.querySelector("form[data-join]") && !document.querySelector("form[data-join]").hidden`, "the join form", 15_000);
    await sit(tab, "create", "striker", "Stays Shown");
    await echoes(tab, ["warden", "mender", "breaker", "chronist"]);
    const code = await tab.evaluate<string>(`document.querySelector("#battle").dataset.room`);
    await watcher.send("Page.navigate", { url: `${own.base}/?room=${encodeURIComponent(code)}` });
    await watcher.until(`!!document.querySelector("form[data-join]") && !document.querySelector("form[data-join]").hidden`, "the watcher's join form", 15_000);
    await start(tab);

    const visible = `(() => { const p = document.querySelector("[data-join-end]"); return !!p && !p.hidden && !p.closest("[hidden]"); })()`;
    await watcher.until(visible, "the end panel, on the watcher's screen", 60_000);
    const title = await watcher.evaluate<string>(`document.querySelector("[data-join-end] .join-end-title").textContent`);
    expect(title, "a fight four Echoes and a person played out ends won or lost").not.toBe("Nobody stayed");
    // The host is back in the room's lobby, the last fight's outcome on it; then leaves, and the room empties.
    // At a 5 ms tick a whole fight lands at once, and the page shows every event of it before the next fight
    // (rule 11), so the lobby comes a while after the ending: about twenty seconds, measured.
    await tab.until(`document.querySelector("#battle").dataset.phase === "lobby"`, "the host back in the lobby", 60_000);
    expect(await tab.evaluate<string>(`document.querySelector(".lobby-last").textContent`), "the lobby says how the last fight went").toMatch(/victory|defeat/i);
    await tab.evaluate(`document.querySelector('[data-lobby] [data-lobby-leave]').click()`);
    await watcher.until(`document.querySelector("#battle").dataset.closed === "expired"`, "the empty room to close", 20_000);
    await watcher.evaluate(`new Promise((r) => setTimeout(r, 300))`);
    expect(await watcher.evaluate<boolean>(visible), "the end panel is still up").toBe(true);
    expect(await watcher.evaluate<string>(`document.querySelector("[data-join-end] .join-end-title").textContent`), "and still says how the fight that was played ended").toBe(title);
    expect(await watcher.evaluate<string>(`document.querySelector("[data-join-end] a").getAttribute("href")`), "the room's gone: the link is the front door").toBe("/");
    const log = await watcher.evaluate<string>(`document.querySelector("[data-log]").textContent`);
    expect(log, "the last fight's end line is still in the log (Q1)").toMatch(/The table wins|has fallen|fall/i);
  } finally {
    await other.close();
    await mine.close();
    await own.kill();
  }
}, 180_000);

it("N11 (rule 2): a refused Reaction off-turn lights nothing of the turn", async () => {
  // Phase two's re-review, N11: R1's test refused only an on-turn action, where
  // it's your turn either way, so a window re-enabled unconditionally on any
  // refusal passed, and would light the turn's actions off-turn. Here the
  // server names a card (the socket tampered, as for U2), the Reaction is sent
  // off-turn, and the POST is answered 409.
  const tab = await page(`${SOCKET_TAMPER}
  (() => {
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
  await sit(tab, "create", "warden", "Refused Off Turn");
  await echoes(tab, ["mender"]);
  await start(tab);
  await tab.evaluate(`window.__react = "first"`);
  const mine = `(() => { const me = document.body.dataset.me; const up = document.querySelector('[data-rail] [data-token-id][data-active="true"]'); return !!up && up.dataset.tokenId === me; })()`;
  await tab.until(`!!document.querySelector('button[data-action="intercept"]:not([disabled])') && ${LIVE} === 0 && !${mine}`, "the Reaction live off-turn", 30_000);
  // Watched, not sampled: a state each tick darkens the window again, so a lit moment is caught as it happens.
  const lit = await tab.evaluate<number>(`(async () => {
    let lit = 0;
    const menu = document.querySelector("[data-command]");
    const watch = new MutationObserver(() => { if (!${mine} && ${LIVE} > 0) lit++; });
    watch.observe(menu, { subtree: true, attributes: true, attributeFilter: ["disabled"] });
    window.__refuseNext = true;
    document.querySelector('button[data-action="intercept"]').click();
    document.querySelector("[data-confirm]").click();
    await new Promise((r) => setTimeout(r, 300));
    watch.disconnect();
    return lit;
  })()`);
  // The refusal must really have happened (the third review's M4: a Reaction never sent lit nothing either).
  expect(await tab.evaluate<boolean>(`window.__refuseNext`), "the Reaction was sent, and the 409 served").toBe(false);
  expect(await tab.evaluate<string>(`document.querySelector("[data-announce]").textContent`), "and the refusal said").toContain("Refused, for the test.");
  expect(lit, "off-turn, a refused Reaction never lights the turn's actions").toBe(0);
}, 60_000);

it("N12 (P2): Restore is offered the downed, as the page's own state has them", async () => {
  // Phase two's re-review, N12: P2's test handed the window its own list of
  // the fallen, so a main.ts passing the standing allies, or those who left,
  // passed. Here the page's states are rewritten: one Echo downed, one gone
  // (fallen with HP left), and the server's Restore refusal lifted, so what
  // the window offers is what main.ts hands it.
  const tab = await page(SOCKET_TAMPER);
  await sit(tab, "create", "mender", "Brings Back");
  await echoes(tab, ["warden", "striker"]);
  await start(tab);
  await tab.evaluate(`window.__rewrite = (b, me) => {
    const take = (role, hp) => {
      const i = b.queue.findIndex((t) => t.echo && t.role === role);
      if (i < 0) return;
      const [t] = b.queue.splice(i, 1);
      b.fallen.push({ ...t, hp });
    };
    take("warden", 0);
    take("striker", 30);
    const restore = b.preview && b.preview.actorId === me ? b.preview.actions.restore : null;
    if (restore) restore.refusal = null;
  }`);
  await tab.until(`[...document.querySelectorAll("button[data-action]:not([data-reaction])")].some((b) => !b.disabled) && !document.querySelector('button[data-action="restore"][data-refused]')`, "my turn, Restore open", 30_000);
  await tab.evaluate(`document.querySelector('button[data-action="restore"]').click()`);
  const offered = await tab.evaluate<{ name: string; several: boolean }>(`({ name: document.querySelector("[data-aim-name]").textContent, several: !document.querySelector('.command-step[data-step="1"]').hidden })`);
  expect(offered.name, "Restore aims at the downed Warden Echo").toBe("Warden Echo");
  expect(offered.several, "and at nobody else: not the one who left, not anyone standing").toBe(false);
  await tab.evaluate(`document.querySelector("[data-cancel]").click()`);
}, 60_000);
