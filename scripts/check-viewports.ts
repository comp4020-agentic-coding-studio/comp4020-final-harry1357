import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { join as joinBattle, newBattle } from "../spec/raid.ts";

// Does the raid fit the two viewports it is marked at?
//
//   APP_URL=http://localhost:8094 pnpm check:viewports
//
// Carried from comp4020-crit7-harry1357 and re-pointed at a running app
// (APP_URL, the same variable the spec uses) rather than booting one: the
// server here is TypeScript run straight from source, so there is no built
// artefact to own, and the thing worth measuring is whatever you're running.
//
// Deliberately NOT in `pnpm check`: it needs Chrome, and a roster that can go
// red because a browser didn't launch teaches you to ignore it. Run it after
// any layout work and before you ship.
//
// The claim is narrow: no page body scrolls sideways, at 1920×1080 or at
// 390×844, on /readme/, on / before joining, and on / after joining a battle
// that has people in it. Wide content may scroll inside its own
// `overflow-x: auto` container --- that is the fix, not the failure.
//
// The order of the checks is CLAUDE.md's (design gates), and they fail
// differently on purpose:
//   1. `documentElement.clientWidth` must equal the width asked for. If it
//      doesn't, the EMULATION never took and every number after it describes
//      a viewport nobody asked for, so the run throws.
//   2. `innerWidth` must equal it too. Under mobile emulation the layout
//      viewport grows to meet content wider than itself, so a mismatch is the
//      browser reporting overflow. That fails the route.
//   3. No visible element's box may cross `clientWidth`, which names what
//      pushed the page out.
//
// This file also carries the CDP plumbing (launch, attach, input) that
// scripts/check-keyboard.ts imports, so the two sensors drive the browser the
// same way. Nothing runs on import: main() is guarded at the bottom.

export const APP_URL = process.env.APP_URL ?? "http://localhost:8080";
const CHROME = process.env.CHROME ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const CDP_PORT = Number(process.env.CDP_PORT ?? 9401);

export interface Viewport {
  name: string;
  width: number;
  height: number;
  mobile: boolean;
  scale: number;
}

/** The two viewports the work is marked at, per the course assessment page. */
export const DESKTOP: Viewport = { name: "desktop", width: 1920, height: 1080, mobile: false, scale: 1 };
export const PHONE: Viewport = { name: "phone", width: 390, height: 844, mobile: true, scale: 3 };

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The probe itself is broken (no browser, an emulation that didn't take, a
 *  blind self-test). Distinct from a finding about the page: it aborts the run
 *  instead of being reported as one route among many. */
export class ProbeError extends Error {}

// --- CDP over Node's global WebSocket -----------------------------------------

type Params = Record<string, unknown>;

interface Wire {
  id?: number;
  method?: string;
  params?: Params;
  sessionId?: string;
  result?: Params;
  error?: { message?: string };
}

interface Connection {
  send: (method: string, params?: Params, sessionId?: string) => Promise<Params>;
  on: (listener: (message: Wire) => void) => () => void;
  close: () => void;
}

async function connect(wsUrl: string): Promise<Connection> {
  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new ProbeError(`could not open ${wsUrl}`)), { once: true });
  });
  let next = 0;
  const pending = new Map<number, { resolve: (v: Params) => void; reject: (e: Error) => void; method: string }>();
  const listeners = new Set<(message: Wire) => void>();
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as Wire;
    if (message.id === undefined) {
      for (const listener of listeners) listener(message);
      return;
    }
    const waiter = pending.get(message.id);
    if (!waiter) return;
    pending.delete(message.id);
    if (message.error) waiter.reject(new Error(`${waiter.method}: ${message.error.message ?? JSON.stringify(message.error)}`));
    else waiter.resolve(message.result ?? {});
  });
  socket.addEventListener("close", () => {
    for (const waiter of pending.values()) waiter.reject(new ProbeError(`the browser hung up during ${waiter.method}`));
    pending.clear();
  });
  return {
    send: (method, params = {}, sessionId) =>
      new Promise((resolve, reject) => {
        const id = ++next;
        pending.set(id, { resolve, reject, method });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      }),
    on: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => socket.close(),
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One tab, in its own browser context (its own cookie jar), attached and
 *  emulating one viewport. */
export interface Page {
  viewport: Viewport;
  send: (method: string, params?: Params) => Promise<Params>;
  /** Runs in the page; awaits promises; returns by value; throws on a page exception. */
  evaluate: <T>(expression: string) => Promise<T>;
  /** Polls `expression` until it is truthy, and returns that value. */
  until: <T>(expression: string, what: string, timeoutMs: number) => Promise<T>;
  goto: (url: string) => Promise<void>;
  /** A trusted key press (Input.dispatchKeyEvent). */
  press: (key: KeyName, modifiers?: number) => Promise<void>;
  /** Trusted typing, one key event per character. */
  type: (text: string) => Promise<void>;
  /** A trusted click (desktop) or tap (phone) at the middle of `selector`,
   *  after scrolling it into view and checking nothing else is on top of it. */
  activate: (selector: string) => Promise<void>;
  screenshot: (path: string) => Promise<void>;
  close: () => Promise<void>;
}

export interface Browser {
  open: (viewport: Viewport) => Promise<Page>;
  close: () => Promise<void>;
}

export const SHIFT = 8;

const KEYS = {
  Tab: { key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 },
  Enter: { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, text: "\r" },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
} as const;
export type KeyName = keyof typeof KEYS;

async function cdpVersion(): Promise<{ webSocketDebuggerUrl: string } | null> {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`, { signal: AbortSignal.timeout(1000) });
    return res.ok ? ((await res.json()) as { webSocketDebuggerUrl: string }) : null;
  } catch {
    return null;
  }
}

/** Headless Chrome on CDP_PORT with a throwaway profile. Refuses to start if
 *  something already answers on that port: a probe that attached to someone
 *  else's browser would measure their tabs and report it as yours. */
export async function launch(): Promise<Browser> {
  if (await cdpVersion()) {
    throw new ProbeError(
      `something is already answering on the debugging port ${CDP_PORT}; refusing to drive a browser this run didn't start`,
    );
  }
  const profile = mkdtempSync(join(tmpdir(), "raid-cdp-profile-"));
  const chrome: ChildProcess = spawn(
    CHROME,
    [
      "--headless=new",
      `--remote-debugging-port=${CDP_PORT}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let exited = false;
  let spawnError: Error | null = null;
  chrome.on("error", (error) => (spawnError = error));
  chrome.on("exit", () => (exited = true));

  const kill = async (): Promise<void> => {
    if (!exited) {
      chrome.kill("SIGTERM");
      for (let i = 0; i < 30 && !exited; i++) await sleep(100);
      if (!exited) chrome.kill("SIGKILL");
    }
    // Best-effort: Chrome is still writing its profile as it dies, so a
    // recursive remove can race it and throw ENOTEMPTY. The OS reaps tmp.
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      /* the OS will reap it */
    }
  };

  let version: { webSocketDebuggerUrl: string } | null = null;
  for (let attempt = 0; attempt < 100 && !version; attempt++) {
    if (spawnError || exited) break;
    await sleep(100);
    version = await cdpVersion();
  }
  if (!version) {
    await kill();
    throw new ProbeError(
      spawnError ? `could not start Chrome at ${CHROME} (${String(spawnError)}); set CHROME` : `Chrome never exposed port ${CDP_PORT}`,
    );
  }

  const conn = await connect(version.webSocketDebuggerUrl);

  return {
    close: async () => {
      conn.close();
      await kill();
    },
    open: async (viewport) => {
      const { browserContextId } = (await conn.send("Target.createBrowserContext", { disposeOnDetach: true })) as {
        browserContextId: string;
      };
      const { targetId } = (await conn.send("Target.createTarget", { url: "about:blank", browserContextId })) as {
        targetId: string;
      };
      const { sessionId } = (await conn.send("Target.attachToTarget", { targetId, flatten: true })) as {
        sessionId: string;
      };
      const send = (method: string, params: Params = {}): Promise<Params> => conn.send(method, params, sessionId);

      const event = (method: string, timeoutMs: number): Promise<Params> =>
        new Promise((resolve, reject) => {
          const off = conn.on((message) => {
            if (message.sessionId !== sessionId || message.method !== method) return;
            off();
            clearTimeout(timer);
            resolve(message.params ?? {});
          });
          const timer = setTimeout(() => {
            off();
            reject(new Error(`no ${method} within ${timeoutMs}ms`));
          }, timeoutMs);
        });

      const evaluate = async <T>(expression: string): Promise<T> => {
        const { result, exceptionDetails } = (await send("Runtime.evaluate", {
          expression,
          returnByValue: true,
          awaitPromise: true,
        })) as { result: { value: T }; exceptionDetails?: { text?: string; exception?: { description?: string } } };
        if (exceptionDetails) {
          throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text ?? "page exception");
        }
        return result.value;
      };

      const until = async <T>(expression: string, what: string, timeoutMs: number): Promise<T> => {
        const deadline = Date.now() + timeoutMs;
        let lastError = "";
        for (;;) {
          try {
            const value = await evaluate<T>(expression);
            if (value) return value;
          } catch (error) {
            // Mid-navigation the context is destroyed under the evaluation;
            // that is "not yet", not an answer.
            lastError = ` (last error: ${(error as Error).message.split("\n")[0]})`;
          }
          if (Date.now() > deadline) throw new Error(`waited ${timeoutMs / 1000}s for ${what}${lastError}`);
          await sleep(100);
        }
      };

      await send("Page.enable");
      await send("Runtime.enable");
      // Headless tabs aren't focused windows unless told to be, and a page
      // without focus is a page where :focus-visible and key events are
      // somebody else's guess.
      await send("Emulation.setFocusEmulationEnabled", { enabled: true });
      await send("Emulation.setDeviceMetricsOverride", {
        width: viewport.width,
        height: viewport.height,
        deviceScaleFactor: viewport.scale,
        mobile: viewport.mobile,
        // Without these, a desktop override leaves screen.width at Chrome's
        // own 800 --- and screen.width is how the probe tells "the emulation
        // didn't take" apart from "the page has no viewport meta".
        screenWidth: viewport.width,
        screenHeight: viewport.height,
      });
      await send("Emulation.setTouchEmulationEnabled", { enabled: viewport.mobile, maxTouchPoints: viewport.mobile ? 5 : 1 });

      const press = async (name: KeyName, modifiers = 0): Promise<void> => {
        const key = KEYS[name];
        await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers, ...key });
        const { text: _text, ...up } = key as { text?: string };
        await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, ...up });
      };

      return {
        viewport,
        send,
        evaluate,
        until,
        goto: async (url) => {
          const loaded = event("Page.loadEventFired", 20_000);
          loaded.catch(() => {}); // awaited below; don't let an early throw orphan it
          const nav = (await send("Page.navigate", { url })) as { errorText?: string };
          if (nav.errorText) throw new Error(`could not load ${url}: ${nav.errorText}`);
          await loaded;
          await evaluate("document.fonts.ready.then(() => true)");
        },
        press,
        type: async (text) => {
          for (const ch of text) {
            await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, text: ch, unmodifiedText: ch });
            await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch });
          }
        },
        activate: async (selector) => {
          const sel = JSON.stringify(selector);
          await evaluate(`document.querySelector(${sel})?.scrollIntoView({ block: "center", inline: "center" })`);
          await settleScroll(evaluate);
          // A visually hidden radio is operated through its label; aim at
          // whichever of the two a person could actually see.
          const point = await evaluate<{ x: number; y: number; hit: boolean; why: string } | null>(`(() => {
            const el = document.querySelector(${sel});
            if (!el) return null;
            const box = (n) => n.getBoundingClientRect();
            let target = el;
            const r0 = box(el);
            if ((r0.width < 4 || r0.height < 4) && el.labels && el.labels[0]) target = el.labels[0];
            const r = box(target);
            const x = r.left + r.width / 2, y = r.top + r.height / 2;
            if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return { x, y, hit: false, why: "off screen at " + Math.round(x) + "," + Math.round(y) };
            const top = document.elementFromPoint(x, y);
            const ok = top && (top === el || el.contains(top) || target.contains(top) || (el.labels && [...el.labels].some((l) => l.contains(top))));
            return { x, y, hit: !!ok, why: ok ? "" : "covered by " + (top ? top.tagName.toLowerCase() + (top.className ? "." + String(top.className).split(" ")[0] : "") : "nothing") };
          })()`);
          if (!point) throw new Error(`no ${selector} on the page`);
          if (!point.hit) throw new Error(`can't reach ${selector}: ${point.why}`);
          if (viewport.mobile) {
            await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: point.x, y: point.y }] });
            await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
          } else {
            await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: point.x, y: point.y });
            await send("Input.dispatchMouseEvent", { type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1 });
            await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1 });
          }
        },
        screenshot: async (path) => {
          const { data } = (await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true })) as {
            data: string;
          };
          writeFileSync(path, Buffer.from(data, "base64"));
        },
        close: async () => {
          await conn.send("Target.closeTarget", { targetId }).catch(() => {});
          await conn.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
        },
      };
    },
  };
}

/** `scroll-behavior: smooth` makes every rect a race: scrolling into view
 *  takes several frames, and a rect read one frame later says "off screen"
 *  about something that's on its way. Poll until the page AND the focused
 *  element's position stop moving (a nested scroller can be animating too). */
export async function settleScroll(evaluate: <T>(expression: string) => Promise<T>): Promise<void> {
  let last = "";
  let steady = 0;
  for (let i = 0; i < 60 && steady < 3; i++) {
    const now = await evaluate<string>(
      `[scrollX, scrollY, document.activeElement ? Math.round(document.activeElement.getBoundingClientRect().top) : 0].join(",")`,
    );
    steady = now === last ? steady + 1 : 0;
    last = now;
    await sleep(50);
  }
}

// --- the measurement -----------------------------------------------------------

interface Measurement {
  clientWidth: number;
  innerWidth: number;
  scrollWidth: number;
  screenWidth: number;
  dpr: number;
  touch: number;
  viewportMeta: string | null;
  count: number;
  offenders: string[];
}

// Per element, against clientWidth: no visible box may cross the edge.
// Skipped: anything with an ancestor below <body> whose overflow-x isn't
// `visible` (auto/scroll is the allowed fix; hidden/clip means the ancestor's
// own box is the one that can cross the edge, and it's measured itself).
// <html> and <body> are deliberately NOT exempt: `body { overflow-x: hidden }`
// hides overflow from the scrollbar, not from the person whose content got cut
// off, and exempting it would make every element on the page invisible here.
const MEASURE = `(() => {
  const html = document.documentElement;
  const vw = html.clientWidth;
  const contained = (el) => {
    for (let p = el.parentElement; p && p !== document.body && p !== html; p = p.parentElement) {
      if (getComputedStyle(p).overflowX !== "visible") return true;
    }
    return false;
  };
  const describe = (el, rect) => {
    let s = el.tagName.toLowerCase();
    if (el.id) s += "#" + el.id;
    if (typeof el.className === "string" && el.className.trim()) s += "." + el.className.trim().split(/\\s+/).join(".");
    for (const a of el.attributes) if (a.name.startsWith("data-")) s += "[" + a.name + (a.value ? '="' + a.value.slice(0, 16) + '"' : "") + "]";
    const text = (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 30);
    return s + " [" + Math.round(rect.left) + "…" + Math.round(rect.right) + "px]" + (text ? ' "' + text + '"' : "");
  };
  const offenders = [];
  for (const el of document.querySelectorAll("body *")) {
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") continue;
    if (!el.getClientRects().length) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) continue;
    if (rect.right > vw + 1 || rect.left < -1) {
      if (contained(el)) continue;
      offenders.push(describe(el, rect));
    }
  }
  const meta = document.querySelector('meta[name="viewport"]');
  return {
    clientWidth: vw, innerWidth, scrollWidth: html.scrollWidth,
    screenWidth: screen.width, dpr: devicePixelRatio, touch: navigator.maxTouchPoints,
    viewportMeta: meta ? meta.getAttribute("content") : null,
    count: offenders.length, offenders: offenders.slice(0, 8),
  };
})()`;

/** Measures, and throws if the emulation itself is what's wrong. */
async function measure(page: Page, where: string): Promise<{ m: Measurement; problems: string[] }> {
  const { width, mobile, scale } = page.viewport;
  const m = await page.evaluate<Measurement>(MEASURE);
  // The setup is part of what's being trusted. A canary can pass in conditions
  // the real measurements never meet, so assert the emulation directly.
  if (m.screenWidth !== width || m.dpr !== scale || (mobile && m.touch < 1)) {
    throw new ProbeError(
      `${where}: the ${width}px emulation didn't take (screen ${m.screenWidth}px, dpr ${m.dpr}, touch points ${m.touch})`,
    );
  }
  const problems: string[] = [];
  if (m.clientWidth !== width) {
    // A phone with no `width=device-width` lays the page out at 980px. That is
    // the page's doing, not the probe's, and it is the one way clientWidth can
    // be wrong while the emulation took --- so it's reported, not thrown.
    if (mobile && !/width\s*=\s*device-width/.test(m.viewportMeta ?? "")) {
      problems.push(
        `no <meta name="viewport" content="width=device-width">, so a phone lays it out at ${m.clientWidth}px ` +
          `(viewport meta: ${m.viewportMeta === null ? "missing" : JSON.stringify(m.viewportMeta)})`,
      );
      return { m, problems };
    }
    throw new ProbeError(
      `${where}: documentElement.clientWidth is ${m.clientWidth}px, not the ${width}px asked for. ` +
        "The emulation didn't take (or a classic scrollbar is eating width), so every number in this run " +
        "would describe a viewport nobody asked for.",
    );
  }
  if (m.innerWidth !== width) {
    problems.push(`innerWidth is ${m.innerWidth}px: the viewport grew to fit content wider than ${width}px`);
  }
  // Under mobile emulation scrollWidth is no verdict (it grows with the
  // viewport, see CLAUDE.md), but at a desktop width it is the plain fact of
  // a horizontal scrollbar --- and it sees ::before/::after boxes, which the
  // per-element walk can't.
  if (!mobile && m.scrollWidth > m.clientWidth) {
    problems.push(`the page scrolls sideways by ${m.scrollWidth - m.clientWidth}px (scrollWidth ${m.scrollWidth})`);
  }
  if (m.count > 0) {
    problems.push(`${m.count} element(s) cross the ${width}px edge`);
  }
  return { m, problems };
}

/**
 * Prove the probe can fail before trusting a green one, on the real page.
 *
 * Crit 7's lesson: a 3000px canary is far enough out to beat the expanding
 * viewport, and a 486px field isn't, so "the probe sees the canary" meant it
 * could see the easy case. This canary is 96px too wide --- a field or a long
 * name, not a billboard --- and BOTH signals have to see it. The opposite
 * case is planted too: something wide inside an `overflow-x: auto` box must
 * NOT count, or every honest scroller would be reported as overflow.
 */
async function selfTest(page: Page): Promise<string[]> {
  const { width, mobile } = page.viewport;
  const where = `self-test at ${width}px`;
  const before = (await measure(page, where)).m;
  const failures: string[] = [];

  await page.evaluate(
    `document.body.insertAdjacentHTML("beforeend", '<div id="probe-allowed" style="position:absolute;left:0;top:0;width:48px;height:8px;overflow-x:auto"><div style="width:${width * 3}px;height:4px"></div></div>')`,
  );
  await sleep(100);
  const allowed = (await measure(page, where)).m;
  if (allowed.count !== before.count || allowed.innerWidth !== before.innerWidth) {
    throw new ProbeError(
      `${where}: content inside an overflow-x:auto box was counted as overflow (${before.count} → ${allowed.count} offenders, ` +
        `innerWidth ${before.innerWidth} → ${allowed.innerWidth}). The probe would fail honest scrollers.`,
    );
  }

  await page.evaluate(
    `document.body.insertAdjacentHTML("beforeend", '<div id="probe-canary" style="display:block;flex:none;width:${width + 96}px;min-width:${width + 96}px;max-width:none;height:8px"></div>')`,
  );
  await sleep(100);
  const after = (await measure(page, where)).m;
  if (after.count <= before.count) {
    throw new ProbeError(`${where}: a planted ${width + 96}px element was NOT detected per element. The probe is blind.`);
  }
  if (mobile && after.innerWidth <= width) {
    // Not the probe's fault: the page clips horizontal overflow at the root,
    // so the browser can't report it by growing, and one of the two signals
    // CLAUDE.md relies on is switched off for this page.
    failures.push(
      `the page clips overflow at the root (overflow-x on <html> or <body>): a ${width + 96}px element left innerWidth at ` +
        `${after.innerWidth}px. Overflow there is hidden, not fixed, and content past the edge is unreachable.`,
    );
  }
  if (!mobile && after.scrollWidth <= after.clientWidth) {
    failures.push(
      `the page clips overflow at the root (overflow-x on <html> or <body>): a ${width + 96}px element didn't make it scroll.`,
    );
  }
  return failures;
}

// --- the walk ------------------------------------------------------------------

/** 24 is NAME_MAX, and W is the widest letter. The server allows this name,
 *  so the layout has to carry it: a tag that only fits "Ada" is a tag that
 *  overflows the day someone types their full gamer tag. */
const longName = (n: number): string => "W".repeat(22) + String(n).padStart(2, "0");

/** A battle with a full table in it, so the rail is measured with tokens on
 *  it. An empty page fits no matter what the stylesheet says, and a sensor
 *  that measured the easy version reports exactly what a clean page reports. */
async function seededBattle(): Promise<string> {
  const battleId = await newBattle(APP_URL);
  for (const [i, role] of (["bulwark", "lancer", "mender"] as const).entries()) {
    const seat = await joinBattle(APP_URL, battleId, longName(i + 1), role);
    if (seat.status !== 200) {
      throw new Error(`could not seat ${role} via the API (POST join answered ${seat.status}); the rail would be measured near-empty`);
    }
  }
  return battleId;
}

/** Chrome renders its own error page for a 404 or a refused connection, and
 *  that page fits a phone perfectly. Ask the server before measuring it. */
async function mustAnswer(route: string): Promise<void> {
  const res = await fetch(new URL(route, APP_URL));
  if (!res.ok) throw new Error(`GET ${route} answered ${res.status}`);
}

/** Joins through the real form with trusted input, as a person would. */
async function joinByForm(page: Page): Promise<string> {
  await page.until(`!!document.querySelector("form[data-join]")`, "form[data-join]", 10_000);
  await page.activate(`form[data-join] input[name="name"]`);
  await page.until(`document.activeElement === document.querySelector('form[data-join] input[name="name"]')`, "the name field to take focus", 2_000);
  await page.type(longName(0));
  const typed = await page.evaluate<string>(`document.querySelector('form[data-join] input[name="name"]').value`);
  if (typed !== longName(0)) throw new Error(`typed ${longName(0)} into the name field and it holds ${JSON.stringify(typed)}`);
  await page.activate(`form[data-join] input[type="radio"][name="role"][value="herald"]`);
  await page.until(`document.querySelector('input[type="radio"][name="role"][value="herald"]').checked`, "the herald radio to be checked", 2_000);
  await page.activate(`form[data-join] button[type="submit"]`);
  const me = await page.until<string>(`document.body.dataset.me`, "document.body.dataset.me after joining", 10_000);
  await page.until(`!!document.querySelector('[data-token-id="${me}"]')`, `my token [data-token-id="${me}"] on the rail`, 5_000);
  return me;
}

async function main(): Promise<void> {
  try {
    const res = await fetch(APP_URL);
    if (!res.ok) throw new Error(`answered ${res.status}`);
  } catch (error) {
    console.error(`✗ nothing healthy at APP_URL=${APP_URL} (${(error as Error).message}). Start the app first.`);
    process.exit(2);
  }

  const shots = mkdtempSync(join(tmpdir(), "raid-viewports-"));
  const browser = await launch();
  let failures = 0;
  let passes = 0;
  const saved: string[] = [];
  const fail = (label: string, problems: string[], offenders: string[] = []): void => {
    failures += 1;
    console.error(`✗ ${label}`);
    for (const problem of problems) console.error(`    ${problem}`);
    for (const offender of offenders) console.error(`      ${offender}`);
  };

  try {
    for (const viewport of [DESKTOP, PHONE]) {
      const page = await browser.open(viewport);
      const size = `${viewport.width}×${viewport.height}`;
      try {
        // Self-test first, on the real page, at this viewport.
        await page.goto(new URL("/", APP_URL).href);
        await page.until(`!!document.querySelector("form[data-join]")`, "form[data-join] on /", 10_000);
        const rootClips = await selfTest(page);
        if (rootClips.length) fail(`/ at ${size}: self-test`, rootClips);
        else console.log(`✓ self-test at ${size}: a ${viewport.width + 96}px canary is seen, an overflow-x:auto scroller isn't`);

        const routes: { label: string; slug: string; open: () => Promise<void> }[] = [
          {
            label: "/readme/",
            slug: "readme",
            open: async () => {
              await mustAnswer("/readme/");
              await page.goto(new URL("/readme/", APP_URL).href);
              await page.until(`!!document.querySelector("h1, h2")`, "a heading on /readme/", 5_000);
            },
          },
          {
            label: "/ before joining",
            slug: "home",
            open: async () => {
              await page.goto(new URL("/", APP_URL).href);
              await page.until(`!!document.querySelector("form[data-join]")`, "form[data-join] on /", 10_000);
            },
          },
          {
            label: "/ after joining (four at the table)",
            slug: "joined",
            open: async () => {
              const battleId = await seededBattle();
              await page.goto(new URL(`/?battle=${encodeURIComponent(battleId)}`, APP_URL).href);
              await joinByForm(page);
              const tokens = await page.evaluate<number>(`document.querySelectorAll("[data-token-id]").length`);
              if (tokens < 5) throw new Error(`only ${tokens} token(s) on the rail; expected four characters and the Orrery`);
            },
          },
        ];

        for (const route of routes) {
          const label = `${route.label} at ${size}`;
          try {
            await route.open();
            await sleep(400); // let a token's slide land
            const { m, problems } = await measure(page, label);
            const shot = join(shots, `${viewport.name}-${route.slug}.png`);
            await page.screenshot(shot);
            saved.push(shot);
            if (problems.length) fail(label, problems, m.offenders);
            else {
              passes += 1;
              console.log(`✓ ${label}`);
            }
          } catch (error) {
            if (error instanceof ProbeError) throw error;
            fail(label, [`couldn't measure it: ${(error as Error).message}`]);
          }
        }
      } finally {
        await page.close();
      }
    }
  } catch (error) {
    console.error(`✗ the probe itself failed: ${(error as Error).message}`);
    failures += 1;
  } finally {
    await browser.close();
  }

  if (saved.length) {
    console.log(`\nscreenshots (taken after the numbers, never instead of them):`);
    for (const shot of saved) console.log(`  ${shot}`);
  }
  if (failures > 0) {
    console.error(`\n✗ ${failures} failure(s); ${passes} route×viewport pair(s) fit`);
    process.exit(1);
  }
  console.log(`\n✓ ${passes} route×viewport pairs fit, at ${DESKTOP.width} and ${PHONE.width}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
