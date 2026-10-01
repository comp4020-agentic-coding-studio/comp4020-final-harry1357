import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BattleState, NewBattleResponse } from "../src/shared/protocol.ts";

// When one person acts, how long until a DIFFERENT browser shows it?
//
// The brief wants a change in one session to appear in every other session
// within about a second, and the crit will ask for the number. This measures
// it end to end, the way a person at the table would experience it: a trusted
// click in one real Chrome, through the client's handler, the HTTP POST, the
// server's turn, the broadcast and the other client's render, until the other
// Chrome's DOM shows the actor's token leaving the strike plate.
//
//   APP_URL=http://localhost:8080 pnpm probe      (PROBE_SAMPLES=6, CHROME=...)
//
// Two people, not two tabs: two separate Chrome processes, each with its own
// throwaway profile and so its own cookie jar, joined through the real join
// form with trusted CDP input. No puppeteer: Node 24's global WebSocket speaks
// the DevTools protocol directly (the pattern from crit 7's check-viewports).
//
// The timing. Both browsers run on this machine, so `performance.timeOrigin +
// performance.now()` in each is a sub-millisecond reading of the same wall
// clock. The actor side reads it just before the click is dispatched; the
// observer side reads it inside a MutationObserver callback, which runs the
// moment the client's render has changed the DOM. Observer minus actor is the
// propagation. "Same clock" is an assumption, so it is measured, not trusted:
// see compareClocks().
//
// What it does NOT measure: paint. The DOM commit is followed by at most one
// frame (~16 ms) before pixels change. That is noise against a 1000 ms budget,
// and naming it is better than pretending the number includes it.
//
// Like check-viewports, deliberately NOT in `pnpm check`: it needs Chrome and a
// running app, and a roster that can go red because a browser didn't launch
// teaches you to ignore it.

const APP_URL = (process.env.APP_URL ?? "http://localhost:8080").replace(/\/+$/, "");
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const SAMPLES = Number(process.env.PROBE_SAMPLES ?? "6");

/** The brief: other sessions see a change within about a second. */
const BUDGET_MS = 1000;
/** A change that hasn't arrived in this long is a failure, not a slow sample. */
const TIMEOUT_MS = 10_000;
/** The Orrery's turn and a slow Bulwark's wait both sit between our turns. */
const TURN_WAIT_MS = 30_000;
/** Above this, "same machine, same clock" is false and the numbers are not comparable. */
const SKEW_LIMIT_MS = 5;
const PORTS = { A: 9301, B: 9302 } as const;
const VIEWPORT = { width: 1280, height: 900 };

const STRIKE = 'button[data-action="strike"]';
const STRIKE_READY = `${STRIKE}:not([disabled])`;

type Json = Record<string, unknown>;
const j = (value: unknown): string => JSON.stringify(value);
const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));
/** Node's reading of the same wall clock the pages read. */
const nodeNow = (): number => performance.timeOrigin + performance.now();
const ms = (value: number): string => `${value.toFixed(1)} ms`;

// --- the in-page half -------------------------------------------------------
//
// Installed lazily by every evaluate that needs it (`??=`), so a client that
// reloads its page on join still gets it back. Plain JS: it runs in the page.
//
// The counter observer watches the whole document (subtree, attributes AND
// childList), then re-queries the token on every mutation. A MutationObserver
// on the token element itself would see a client that sets `data-counter` in
// place and miss one that re-renders the rail by replacing its nodes. The
// self-test drives both shapes, because a sensor that only sees the easy case
// reports exactly what a sensor seeing everything reports.
const LIB = String.raw`window.__probe ??= (() => {
  const now = () => performance.timeOrigin + performance.now();
  const tokenSelector = (id) => '[data-token-id="' + CSS.escape(id) + '"]';
  const counterOf = (id) => {
    const el = document.querySelector(tokenSelector(id));
    return el ? el.getAttribute('data-counter') : null;
  };
  const version = () => {
    const rail = document.querySelector('[data-rail]');
    return rail ? rail.getAttribute('data-version') : null;
  };

  const watches = new Map();
  const view = (w) => ({ id: w.id, start: w.start, armedAt: w.armedAt, firedAt: w.firedAt,
    counter: w.counter, version: w.version, timedOut: w.timedOut, last: counterOf(w.id) });
  const settle = (w) => {
    if (w.observer) w.observer.disconnect();
    w.observer = null;
    for (const done of w.waiters.splice(0)) done();
  };
  // Arms only on a token this page currently shows ON the plate (counter 0).
  // Armed on a token already off the plate, it would fire at once on stale
  // state and report a propagation of nothing.
  const arm = (key, id) => {
    const old = watches.get(key);
    if (old) settle(old);
    const w = { id, start: counterOf(id), armedAt: now(), firedAt: null, counter: null,
      version: null, timedOut: false, observer: null, waiters: [] };
    watches.set(key, w);
    if (w.start === null || Number(w.start) !== 0) return view(w);
    w.observer = new MutationObserver(() => {
      const c = counterOf(id);
      if (c === null || !(Number(c) > 0)) return;
      w.firedAt = now();
      w.counter = c;
      w.version = version();
      settle(w);
    });
    w.observer.observe(document.documentElement,
      { subtree: true, childList: true, attributes: true, attributeFilter: ['data-counter'] });
    return view(w);
  };
  const wait = (key, timeout) => new Promise((resolve) => {
    const w = watches.get(key);
    if (!w) return resolve(null);
    if (!w.observer) return resolve(view(w));
    const timer = setTimeout(() => { w.timedOut = true; settle(w); }, timeout);
    w.waiters.push(() => { clearTimeout(timer); resolve(view(w)); });
  });

  // Every click the page receives, captured before the app's own handler:
  // proves the click was trusted and landed on Strike, and when it arrived.
  const clicks = [];
  window.addEventListener('click', (e) => {
    clicks.push({ trusted: e.isTrusted,
      onTarget: e.target instanceof Element && !!e.target.closest('button[data-action="strike"]'),
      at: performance.timeOrigin + e.timeStamp });
  }, true);

  // Every distinct data-version this page has shown, in order.
  const versions = [];
  const noteVersion = () => {
    const v = version();
    if (v !== null && versions[versions.length - 1] !== v) versions.push(v);
  };
  let versionObserver = null;
  const trackVersions = () => {
    if (versionObserver) return true;
    noteVersion();
    versionObserver = new MutationObserver(noteVersion);
    versionObserver.observe(document.documentElement,
      { subtree: true, childList: true, attributes: true, attributeFilter: ['data-version'] });
    return true;
  };

  // A point that a click there would really hit, computed from the rendered
  // box, never assumed. A visually hidden radio is clicked through its label.
  const point = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return { error: 'nothing matches ' + selector };
    el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const labels = el.labels ? Array.from(el.labels) : [];
    for (const candidate of [el, ...labels]) {
      const r = candidate.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) continue;
      const hit = document.elementFromPoint(x, y);
      if (hit && [el, ...labels].some((n) => n === hit || n.contains(hit))) {
        return { x, y, via: candidate === el ? 'itself' : 'its label' };
      }
    }
    return { error: selector + ' has no point on screen where a click would reach it' };
  };

  return { now, arm, wait, point, version, trackVersions,
    peek: (key) => (watches.has(key) ? view(watches.get(key)) : null),
    resetClicks: () => { clicks.length = 0; },
    clicks: () => clicks.slice(),
    versions: () => versions.slice() };
})();`;

/** Wrap an expression so it can use the in-page probe as `P`. */
const lib = (body: string): string => `(() => { ${LIB}\nconst P = window.__probe;\nreturn (${body}); })()`;

// Prove the observer can see, and can stay quiet, before believing it. A
// canary token is planted, armed on, poked in ways that must NOT fire it, then
// raised in place, then replaced outright.
const SELF_TEST = lib(String.raw`(async () => {
  const id = 'probe-canary-' + Math.random().toString(36).slice(2);
  const make = (counter) => {
    const el = document.createElement('div');
    el.hidden = true;
    el.dataset.tokenId = id;
    el.dataset.counter = counter;
    return el;
  };
  const cleanup = () => document.querySelectorAll('[data-probe-canary]').forEach((n) => n.remove());
  let el = make('0');
  el.dataset.probeCanary = '';
  document.body.append(el);
  try {
    const armed = P.arm('selftest', id);
    if (armed.start !== '0') return { ok: false, why: 'arming did not read the canary counter (read ' + armed.start + ')' };
    el.dataset.active = 'true';
    el.dataset.counter = '0';
    const noise = document.createElement('span');
    noise.dataset.probeCanary = '';
    document.body.append(noise);
    await new Promise((r) => setTimeout(r, 50));
    if (P.peek('selftest').firedAt !== null) return { ok: false, why: 'it fired on changes that never raised the counter' };

    const t0 = P.now();
    el.dataset.counter = '3';
    const inPlace = await P.wait('selftest', 1000);
    if (inPlace.firedAt === null) return { ok: false, why: 'it did not fire when data-counter went 0 to 3 in place' };

    el.dataset.counter = '0';
    P.arm('selftest', id);
    const fresh = make('5');
    fresh.dataset.probeCanary = '';
    const t1 = P.now();
    el.replaceWith(fresh);
    const replaced = await P.wait('selftest', 1000);
    if (replaced.firedAt === null) return { ok: false, why: 'it did not fire when the token node was replaced' };
    return { ok: true, inPlaceMs: inPlace.firedAt - t0, replacedMs: replaced.firedAt - t1 };
  } finally {
    cleanup();
  }
})()`);

interface SelfTest {
  ok: boolean;
  why?: string;
  inPlaceMs?: number;
  replacedMs?: number;
}
interface Watch {
  id: string;
  start: string | null;
  armedAt: number;
  firedAt: number | null;
  counter: string | null;
  version: string | null;
  timedOut: boolean;
  last: string | null;
}
type Point = { x: number; y: number; via: string } | { error: string };
interface Click {
  trusted: boolean;
  onTarget: boolean;
  at: number;
}

// --- Chrome over CDP --------------------------------------------------------

interface Browser {
  label: string;
  proc: ChildProcess;
  profile: string;
}

interface Page {
  label: string;
  /** A command to this page's session. */
  send: <T = Json>(method: string, params?: Json, timeoutMs?: number) => Promise<T>;
  /** A browser-level command (no session). */
  root: <T = Json>(method: string, params?: Json) => Promise<T>;
  /** Runtime.evaluate, by value, awaiting a returned promise. */
  evaluate: <T>(expression: string, timeoutMs?: number) => Promise<T>;
  /** Uncaught exceptions and console.error lines from the page, for the post-mortem. */
  errors: string[];
  close: () => void;
}

const browsers: Browser[] = [];
const pages: Page[] = [];

const assertPortFree = (port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", (error) =>
      reject(
        new Error(
          `port ${port} is already taken (${error.message}). A Chrome left over from an earlier run? ` +
            "The probe would be driving somebody else's browser.",
        ),
      ),
    );
    server.listen(port, "127.0.0.1", () => server.close(() => resolve()));
  });

async function launch(label: string, port: number): Promise<{ wsUrl: string; pid: number | undefined }> {
  await assertPortFree(port);
  const profile = mkdtempSync(join(tmpdir(), `probe-${label.toLowerCase()}-`));
  const proc = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-extensions",
      "--mute-audio",
      "--password-store=basic",
      "--use-mock-keychain",
      // Two windows in two processes: neither may be throttled as a
      // background page, or the probe measures Chrome's power saving.
      "--disable-background-timer-throttling",
      "--disable-renderer-backgrounding",
      "--disable-backgrounding-occluded-windows",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  browsers.push({ label, proc, profile });

  // The DevTools URL is read from THIS process's stderr rather than fetched
  // from the port, so it can only ever be the Chrome this run started.
  const wsUrl = await new Promise<string>((resolve, reject) => {
    let tail = "";
    const fail = (error: Error): void => {
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(
      () => fail(new Error(`Chrome ${label} never opened its debugging port:\n${tail.slice(-800)}`)),
      15_000,
    );
    proc.on("error", (error) =>
      fail(new Error(`could not start Chrome at ${CHROME} (${error.message}). Set CHROME to its path.`)),
    );
    proc.on("exit", (code, signal) =>
      fail(new Error(`Chrome ${label} exited (${code ?? signal}) before it was ready:\n${tail.slice(-800)}`)),
    );
    proc.stderr.on("data", (chunk: Buffer) => {
      tail = (tail + chunk.toString()).slice(-4000);
      const found = /DevTools listening on (ws:\/\/\S+)/.exec(tail);
      if (found?.[1]) {
        clearTimeout(timer);
        resolve(found[1]);
      }
    });
  });
  if (new URL(wsUrl).port !== String(port)) {
    throw new Error(`Chrome ${label} is listening on ${wsUrl}, not on port ${port}`);
  }
  return { wsUrl, pid: proc.pid };
}

async function attach(label: string, wsUrl: string): Promise<Page> {
  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error(`${label}: no DevTools socket at ${wsUrl}`)), {
      once: true,
    });
  });

  let nextId = 0;
  let sessionId: string | undefined;
  const errors: string[] = [];
  const pending = new Map<
    number,
    { resolve: (v: Json) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();

  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as {
      id?: number;
      method?: string;
      params?: Json;
      error?: { message?: string };
      result?: Json;
    };
    if (msg.id !== undefined) {
      const waiter = pending.get(msg.id);
      if (!waiter) return;
      pending.delete(msg.id);
      clearTimeout(waiter.timer);
      if (msg.error) waiter.reject(new Error(`${label}: ${msg.error.message ?? j(msg.error)}`));
      else waiter.resolve(msg.result ?? {});
      return;
    }
    if (msg.method === "Runtime.exceptionThrown") {
      const details = msg.params?.exceptionDetails as
        | { text?: string; exception?: { description?: string } }
        | undefined;
      errors.push(details?.exception?.description ?? details?.text ?? "an uncaught exception");
    } else if (msg.method === "Runtime.consoleAPICalled" && msg.params?.type === "error") {
      const args = (msg.params.args ?? []) as { value?: unknown; description?: string }[];
      errors.push(`console.error: ${args.map((a) => a.description ?? String(a.value)).join(" ")}`);
    }
  });
  socket.addEventListener("close", () => {
    for (const waiter of pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(`${label}: the DevTools socket closed`));
    }
    pending.clear();
  });

  const call = <T>(method: string, params: Json, withSession: boolean, timeoutMs: number): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`${label}: ${method} got no answer in ${timeoutMs} ms`));
      }, timeoutMs);
      pending.set(id, { resolve: (v) => resolve(v as T), reject, timer });
      socket.send(j({ id, method, params, ...(withSession && sessionId ? { sessionId } : {}) }));
    });
  const send = <T = Json>(method: string, params: Json = {}, timeoutMs = 15_000): Promise<T> =>
    call<T>(method, params, true, timeoutMs);
  const root = <T = Json>(method: string, params: Json = {}): Promise<T> => call<T>(method, params, false, 15_000);

  // Drive the tab Chrome opened rather than a second one beside it.
  const { targetInfos } = await root<{ targetInfos: { targetId: string; type: string }[] }>("Target.getTargets");
  const targetId =
    targetInfos.find((t) => t.type === "page")?.targetId ??
    (await root<{ targetId: string }>("Target.createTarget", { url: "about:blank" })).targetId;
  sessionId = (await root<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true })).sessionId;
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: false });
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });

  const evaluate = async <T>(expression: string, timeoutMs = 15_000): Promise<T> => {
    const reply = await send<{
      result: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
    if (reply.exceptionDetails) {
      throw new Error(
        `${label}: ${reply.exceptionDetails.exception?.description ?? reply.exceptionDetails.text ?? "evaluate threw"}`,
      );
    }
    return reply.result.value as T;
  };

  return { label, send, root, evaluate, errors, close: () => socket.close() };
}

/** Poll until `probe` gives something other than null/undefined/false. Errors mid-navigation count as "not yet". */
async function until<T>(
  what: string,
  timeoutMs: number,
  probe: () => Promise<T | null | undefined | false>,
  everyMs = 20,
): Promise<T> {
  const deadline = performance.now() + timeoutMs;
  let lastError: unknown;
  for (;;) {
    try {
      const value = await probe();
      if (value !== null && value !== undefined && value !== false) return value as T;
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
    if (performance.now() > deadline) {
      throw new Error(`waited ${timeoutMs} ms for ${what}${lastError ? ` (last error: ${message(lastError)})` : ""}`);
    }
    await sleep(everyMs);
  }
}

const press = async (p: Page, x: number, y: number): Promise<void> => {
  await p.send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount: 1 });
  await p.send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount: 1 });
};

/** A trusted click at the centre of what `selector` renders, never element.click(). */
async function clickOn(p: Page, selector: string): Promise<void> {
  const at = await p.evaluate<Point>(lib(`P.point(${j(selector)})`));
  if ("error" in at) throw new Error(`${p.label}: ${at.error}`);
  await p.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
  await press(p, at.x, at.y);
}

async function joinAs(p: Page, name: string, role: string): Promise<string> {
  const field = 'form[data-join] input[name="name"]';
  const radio = `form[data-join] input[type="radio"][name="role"][value="${role}"]`;
  const submit = 'form[data-join] button[type="submit"]';
  await until(`${p.label} to show the join form`, TIMEOUT_MS, () =>
    p.evaluate<boolean>(`!!document.querySelector(${j(field)}) && !!document.querySelector(${j(submit)})`),
  );

  await clickOn(p, field);
  await until(`${p.label}'s name field to take focus from the click`, 2_000, () =>
    p.evaluate<boolean>(`document.activeElement === document.querySelector(${j(field)})`),
  );
  const prefilled = await p.evaluate<string>(`document.querySelector(${j(field)}).value`);
  if (prefilled !== "") throw new Error(`${p.label}: the name field came prefilled with "${prefilled}"`);
  await p.send("Input.insertText", { text: name });
  const typed = await p.evaluate<string>(`document.querySelector(${j(field)}).value`);
  if (typed !== name) throw new Error(`${p.label}: typed "${name}" but the field holds "${typed}"`);

  await clickOn(p, radio);
  if (!(await p.evaluate<boolean>(`document.querySelector(${j(radio)}).checked`))) {
    throw new Error(`${p.label}: clicked the ${role} radio but it is not checked`);
  }

  await clickOn(p, submit);
  return until(`${p.label}'s document.body.dataset.me after joining as ${name}`, TIMEOUT_MS, () =>
    p.evaluate<string | null>(`document.body?.dataset.me || null`),
  );
}

async function cookieJar(p: Page): Promise<string[]> {
  const { cookies } = await p.root<{ cookies: { domain: string; name: string; value: string }[] }>(
    "Storage.getCookies",
  );
  return cookies.map((c) => `${c.domain} ${c.name}=${c.value}`).sort();
}

const railVersion = (p: Page): Promise<string | null> =>
  p.evaluate<string | null>(`document.querySelector('[data-rail]')?.getAttribute('data-version') ?? null`);

interface Clocks {
  /** A's clock minus B's, each bracketed by Node's clock: the comparison the samples depend on. */
  skew: number;
  uncertainty: number;
  /** The same, from (timeOrigin + now − Date.now()) inside each page: both share the system clock. */
  dateSkew: number;
}

// The samples subtract a time read in one Chrome from a time read in another.
// That is only meaningful if the two clocks agree, so measure it: each page's
// clock is read between two readings of Node's, the tightest round trip of a
// few is kept, and A's offset is compared with B's. Separately, each page's
// high-resolution clock is compared with its own Date.now(), which both
// processes take from the one system clock.
async function compareClocks(a: Page, b: Page): Promise<Clocks> {
  const offset = async (p: Page): Promise<{ offset: number; rtt: number; dateOffset: number }> => {
    let best = { offset: 0, rtt: Number.POSITIVE_INFINITY, dateOffset: 0 };
    for (let i = 0; i < 9; i++) {
      const t0 = nodeNow();
      const r = await p.evaluate<{ hr: number; date: number }>(
        "({ hr: performance.timeOrigin + performance.now(), date: Date.now() })",
      );
      const t1 = nodeNow();
      if (t1 - t0 < best.rtt) best = { offset: r.hr - (t0 + t1) / 2, rtt: t1 - t0, dateOffset: r.hr - r.date };
    }
    return best;
  };
  const oa = await offset(a);
  const ob = await offset(b);
  return { skew: oa.offset - ob.offset, uncertainty: (oa.rtt + ob.rtt) / 2, dateSkew: oa.dateOffset - ob.dateOffset };
}

/** Prints the reading; returns the problem if the clocks disagree, else null. */
function checkClocks(when: string, c: Clocks): string | null {
  const line =
    `clocks (${when}): A − B = ${c.skew.toFixed(2)} ms ± ${c.uncertainty.toFixed(2)} bracketed by Node, ` +
    `${c.dateSkew.toFixed(2)} ms against Date.now() (±1 ms)`;
  if (Math.abs(c.skew) - c.uncertainty > SKEW_LIMIT_MS || Math.abs(c.dateSkew) - 1 > SKEW_LIMIT_MS) {
    return (
      `${line}. Over ${SKEW_LIMIT_MS} ms: the two browsers do not share a clock, so subtracting one's time ` +
      "from the other's would measure the skew, not the propagation."
    );
  }
  console.log(`✓ ${line}`);
  return null;
}

async function createBattle(): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${APP_URL}/api/battles`, { method: "POST" });
  } catch (error) {
    throw new Error(`nothing answered at ${APP_URL} (${message(error)}). Start the app, or set APP_URL.`);
  }
  if (res.status !== 201) throw new Error(`POST /api/battles answered ${res.status}, expected 201`);
  const body = (await res.json()) as Partial<NewBattleResponse>;
  if (typeof body.battleId !== "string") throw new Error("POST /api/battles sent no battleId");
  return body.battleId;
}

/** What the server says, for a failure message. Diagnosis only: nothing here is decided from it. */
async function serverSays(battleId: string): Promise<string> {
  try {
    const res = await fetch(`${APP_URL}/api/battles/${encodeURIComponent(battleId)}`);
    if (!res.ok) return `GET /api/battles/${battleId} answered ${res.status}`;
    const s = (await res.json()) as BattleState;
    return (
      `status ${s.status}, v${s.version}, tick ${s.tick}, active ${s.activeId ?? "nobody"}, ` +
      `queue ${s.queue.map((t) => `${t.name}=${t.counter}`).join(" ")}`
    );
  } catch (error) {
    return `could not ask the server (${message(error)})`;
  }
}

interface Sample {
  n: number;
  actor: string;
  observer: string;
  remoteMs: number | null;
  localMs: number | null;
  remoteVersion: string | null;
  localVersion: string | null;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((x, y) => x - y);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? (s[mid] as number) : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};
const spread = (xs: number[]): string =>
  `min ${ms(Math.min(...xs))} · median ${ms(median(xs))} · max ${ms(Math.max(...xs))}`;

// --- the run ----------------------------------------------------------------

async function run(): Promise<number> {
  if (!Number.isInteger(SAMPLES) || SAMPLES < 1) {
    throw new Error(`PROBE_SAMPLES must be a positive integer, not "${process.env.PROBE_SAMPLES}"`);
  }
  console.log(`probe-propagation: ${SAMPLES} sample(s) against ${APP_URL}`);
  const battleId = await createBattle();
  console.log(`  fresh battle ${battleId}`);

  const [la, lb] = await Promise.all([launch("A", PORTS.A), launch("B", PORTS.B)]);
  const a = await attach("A", la.wsUrl);
  pages.push(a);
  const b = await attach("B", lb.wsUrl);
  pages.push(b);
  console.log(
    `✓ two Chrome processes (pid ${la.pid} on :${PORTS.A}, pid ${lb.pid} on :${PORTS.B}), each with its own profile`,
  );

  const url = `${APP_URL}/?battle=${encodeURIComponent(battleId)}`;
  for (const p of [a, b]) {
    const nav = await p.send<{ errorText?: string }>("Page.navigate", { url });
    if (nav.errorText) throw new Error(`${p.label}: could not load ${url} (${nav.errorText})`);
  }
  await Promise.all(
    [a, b].map((p) =>
      until(`${p.label} to render form[data-join]`, TIMEOUT_MS, () =>
        p.evaluate<boolean>(`!!document.querySelector('form[data-join]')`),
      ),
    ),
  );

  // The sensor, before anything it reports is believed.
  const tests: Record<string, SelfTest> = {};
  for (const p of [a, b]) {
    const result = await p.evaluate<SelfTest>(SELF_TEST);
    if (!result.ok) throw new Error(`${p.label}: the observer self-test failed: ${result.why}`);
    tests[p.label] = result;
  }
  console.log(
    "✓ observer self-test in both pages: silent on changes that leave the counter at 0, " +
      `fired on a counter raised in place (A ${ms(tests.A?.inPlaceMs ?? 0)}, B ${ms(tests.B?.inPlaceMs ?? 0)}) ` +
      `and on a replaced token node (A ${ms(tests.A?.replacedMs ?? 0)}, B ${ms(tests.B?.replacedMs ?? 0)})`,
  );

  // Two people, through the real form. Herald is the fastest role, so A acts
  // most; B's Bulwark must still take its turns or the battle waits for it.
  const suffix = Math.random().toString(36).slice(2, 10);
  const meA = await joinAs(a, `probe-a-${suffix}`, "herald");
  const meB = await joinAs(b, `probe-b-${suffix}`, "bulwark");
  const me: Record<string, string> = { A: meA, B: meB };
  if (meA === meB) throw new Error(`both browsers report body.dataset.me = ${meA}: one person, not two`);
  const [jarA, jarB] = await Promise.all([cookieJar(a), cookieJar(b)]);
  if (jarA.length === 0 || jarB.length === 0) {
    throw new Error(
      `after joining, ${jarA.length === 0 ? "A" : "B"} holds no cookie at all. A person is a session cookie ` +
        "here, so this is not the setup the probe assumes.",
    );
  }
  if (jarA.join("\n") === jarB.join("\n")) throw new Error("both browsers hold the same cookies: one person, not two");
  console.log(`✓ two people: A is ${meA} (herald), B is ${meB} (bulwark), with different session cookies`);

  // The same battle, seen from both sides.
  for (const p of [a, b]) {
    const search = await p.evaluate<string | null>(`new URLSearchParams(location.search).get('battle')`);
    if (search !== battleId) throw new Error(`${p.label} is on battle ${search}, not ${battleId}`);
    await until(`${p.label}'s rail to carry both A's and B's tokens`, TIMEOUT_MS, () =>
      p.evaluate<boolean>(
        `!!document.querySelector('[data-rail]') && ${j([meA, meB])}.every((id) => ` +
          `document.querySelector('[data-token-id="' + CSS.escape(id) + '"]'))`,
      ),
    );
    await p.evaluate<boolean>(lib("P.trackVersions()"));
  }
  const agreed = await until("both rails to show the same data-version", TIMEOUT_MS, async () => {
    const x = await railVersion(a);
    const y = await railVersion(b);
    const z = await railVersion(a);
    return x !== null && x === y && y === z ? x : null;
  });
  console.log(`✓ same battle: each rail carries both characters, and both are on data-version ${agreed}`);

  const skewed = checkClocks("before", await compareClocks(a, b));
  if (skewed) throw new Error(skewed);

  const samples: Sample[] = [];
  const clickLags: number[] = [];
  const failures: string[] = [];

  // "My turn" is Strike enabled AND my own token on the plate in my own view.
  // The enabled button alone is not enough: right after acting it can still be
  // the previous state's button, and clicking it would be an early action.
  const myTurn = (p: Page): Promise<boolean> =>
    p.evaluate<boolean>(
      `!!document.querySelector(${j(STRIKE_READY)}) && ` +
        `Number(document.querySelector('[data-token-id="' + CSS.escape(${j(me[p.label])}) + '"]')` +
        `?.getAttribute('data-counter') ?? NaN) === 0`,
    );

  /** One action and its two observers. Throws when the run cannot go on. */
  const takeSample = async (n: number): Promise<Sample> => {
    const who = await until(`someone's turn (Strike enabled, own token on 0)`, TURN_WAIT_MS, async () => {
      const [readyA, readyB] = await Promise.all([myTurn(a), myTurn(b)]);
      return readyA && readyB ? "both" : readyA ? "A" : readyB ? "B" : null;
    }).catch(async (error: unknown) => {
      throw new Error(`${message(error)}. The server says: ${await serverSays(battleId)}`);
    });
    if (who === "both") throw new Error("Strike is enabled in both browsers at once: two people think it is their turn");
    const actor = who === "A" ? a : b;
    const other = who === "A" ? b : a;
    const actorId = me[who] as string;

    // Arm the other browser only once it shows the actor ON the plate. Armed
    // on a stale view, it would fire immediately and report nothing.
    await until(`${other.label} to show ${actor.label} on the strike plate`, TIMEOUT_MS, async () => {
      const w = await other.evaluate<Watch>(lib(`P.arm('remote', ${j(actorId)})`));
      return w.start !== null && Number(w.start) === 0;
    });
    await until(`${actor.label} to show itself on the strike plate`, TIMEOUT_MS, async () => {
      const w = await actor.evaluate<Watch>(lib(`P.arm('local', ${j(actorId)})`));
      return w.start !== null && Number(w.start) === 0;
    });

    const at = await actor.evaluate<Point>(lib(`P.point(${j(STRIKE_READY)})`));
    if ("error" in at) throw new Error(`${actor.label}: ${at.error}`);
    await actor.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: at.x, y: at.y });
    const clickAt = await actor.evaluate<number | null>(
      lib(`document.querySelector(${j(STRIKE_READY)}) ? (P.resetClicks(), P.now()) : null`),
    );
    if (clickAt === null) throw new Error(`${actor.label}'s Strike disabled itself before it was clicked`);
    await press(actor, at.x, at.y);

    const [remote, local] = await Promise.all([
      other.evaluate<Watch>(lib(`P.wait('remote', ${TIMEOUT_MS})`), TIMEOUT_MS + 5_000),
      actor.evaluate<Watch>(lib(`P.wait('local', ${TIMEOUT_MS})`), TIMEOUT_MS + 5_000),
    ]);
    const clicks = await actor.evaluate<Click[]>(lib("P.clicks()"));
    const click = clicks[0];
    if (!click) throw new Error(`${actor.label}'s page never received the click`);
    if (!click.trusted || !click.onTarget) {
      throw new Error(`the click was ${click.trusted ? "" : "untrusted and "}not on Strike`);
    }
    clickLags.push(click.at - clickAt);

    const sample: Sample = {
      n,
      actor: actor.label,
      observer: other.label,
      remoteMs: remote.firedAt === null ? null : remote.firedAt - clickAt,
      // Expect this to trail the other browser by a frame or two. Measured on
      // a mock: the broadcast reaches both sockets together, but the renderer
      // that just took a trusted click runs its onmessage ~30 ms later. That
      // is Chrome's scheduling after input, not the network.
      localMs: local.firedAt === null ? null : local.firedAt - clickAt,
      remoteVersion: remote.version,
      localVersion: local.version,
    };
    if ((sample.remoteMs ?? 0) < 0 || (sample.localMs ?? 0) < 0) {
      throw new Error("an observer fired before the click. The setup is wrong; nothing here is a measurement.");
    }

    const remoteText = sample.remoteMs === null ? "TIMED OUT" : ms(sample.remoteMs);
    const localText = sample.localMs === null ? "timed out" : ms(sample.localMs);
    const versions =
      remote.version === local.version ? `v${remote.version}` : `v${remote.version} there, v${local.version} here`;
    const over = sample.remoteMs !== null && sample.remoteMs > BUDGET_MS ? `   ✗ over ${BUDGET_MS} ms` : "";
    console.log(
      `  #${n}  ${actor.label} strikes → ${other.label} sees it in ${remoteText.padStart(9)}` +
        `   (${actor.label}'s own screen ${localText})   ${versions}${over}`,
    );
    if (sample.remoteMs === null || sample.localMs === null) {
      const stuck = sample.remoteMs === null ? other : actor;
      samples.push(sample);
      throw new Error(
        `${stuck.label} never showed ${actor.label} leave the plate within ${TIMEOUT_MS} ms ` +
          `(its token still reads ${(stuck === other ? remote : local).last}). The server says: ${await serverSays(battleId)}`,
      );
    }
    return sample;
  };

  console.log("");
  for (let n = 1; n <= SAMPLES; n++) {
    try {
      const sample = await takeSample(n);
      samples.push(sample);
      if ((sample.remoteMs ?? 0) > BUDGET_MS) {
        failures.push(`sample ${n}: ${ms(sample.remoteMs ?? 0)} is over the ${BUDGET_MS} ms budget`);
      }
    } catch (error) {
      // A battle stuck on one turn makes every later sample meaningless; keep
      // what was measured and say why it stopped.
      failures.push(`sample ${n}: ${message(error)}`);
      break;
    }
  }

  const drifted = checkClocks("after", await compareClocks(a, b));
  if (drifted) failures.push(drifted);

  // Both pages must have watched one battle move: versions strictly rising in
  // each, and largely the same versions in both.
  const tracks = await Promise.all([a, b].map((p) => p.evaluate<string[]>(lib("P.versions()"))));
  const [va, vb] = tracks.map((t) => t.map(Number)) as [number[], number[]];
  const rising = (vs: number[]): boolean => vs.length >= 2 && vs.every((v, i) => i === 0 || v > (vs[i - 1] as number));
  const common = va.filter((v) => vb.includes(v)).length;
  const range = (vs: number[]): string => (vs.length ? `v${vs[0]}…v${vs.at(-1)} (${vs.length} distinct)` : "none");
  console.log(`\n  server versions seen: A ${range(va)}, B ${range(vb)}, ${common} seen by both`);
  if (!rising(va) || !rising(vb) || common < 2) {
    failures.push(
      "the two pages did not watch the same data-version advance " +
        `(A rising: ${rising(va)}, B rising: ${rising(vb)}, in common: ${common}), so they may not be in one battle`,
    );
  }

  const remotes = samples.flatMap((s) => (s.remoteMs === null ? [] : [s.remoteMs]));
  const locals = samples.flatMap((s) => (s.localMs === null ? [] : [s.localMs]));
  if (remotes.length > 0) {
    console.log(`  another browser:  ${spread(remotes)}  (n=${remotes.length})`);
    console.log(`  actor's own:      ${spread(locals)}`);
    console.log(
      `  (the click reached the page ${ms(median(clickLags))} after it was timed, median; ` +
        "times are DOM updates, before the next paint)",
    );
  }

  if (failures.length > 0) {
    console.error(`\n✗ ${failures.length} problem(s):`);
    for (const f of failures) console.error(`  ${f}`);
    return 1;
  }
  console.log(
    `\n✓ ${samples.length} action(s): every other-browser update landed within ${BUDGET_MS} ms ` +
      `(worst ${ms(Math.max(...remotes))})`,
  );
  return 0;
}

// --- teardown, always -------------------------------------------------------

let tornDown = false;
async function teardown(): Promise<void> {
  if (tornDown) return;
  tornDown = true;
  for (const p of pages) p.close();
  await Promise.all(
    browsers.map(async (b) => {
      if (b.proc.exitCode === null && b.proc.signalCode === null) {
        const exited = once(b.proc, "exit").then(() => true);
        b.proc.kill("SIGTERM");
        if (!(await Promise.race([exited, sleep(3_000).then(() => false)]))) b.proc.kill("SIGKILL");
      }
      // Best-effort: Chrome is still writing its profile as it dies, so the
      // remove races it (ENOTEMPTY). The OS reaps temp dirs; a probe that
      // reports a cleanup race instead of its finding is worse than none.
      try {
        rmSync(b.profile, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        /* the OS will reap it */
      }
    }),
  );
}

process.on("exit", () => {
  for (const b of browsers) {
    try {
      b.proc.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
});
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void teardown().finally(() => process.exit(130));
  });
}

let code = 1;
try {
  code = await run();
} catch (error) {
  console.error(`\n✗ ${message(error)}`);
  for (const p of pages) {
    for (const e of p.errors.slice(0, 5)) console.error(`  ${p.label} page: ${e}`);
  }
} finally {
  await teardown();
}
process.exit(code);
