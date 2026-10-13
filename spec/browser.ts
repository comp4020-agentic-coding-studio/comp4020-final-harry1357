import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sleep } from "./raid.ts";

// A real browser for the one spec claim that only a rendered page can answer:
// what B's screen does, and in what order. Headless Chrome over CDP, with no
// dependency (Node's global WebSocket speaks CDP). It asks Chrome for port 0
// and reads the port back from DevToolsActivePort, so it never collides with
// another browser. It finds Chrome on macOS and on the CI runner (ubuntu-latest
// ships google-chrome); CHROME overrides. No Chrome is a failure with that
// sentence on it, never a skip.

const CANDIDATES = [
  process.env.CHROME,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter((p): p is string => Boolean(p));

type Params = Record<string, unknown>;

export interface Tab {
  /** Runs in the page, awaits promises, returns by value; throws on a page exception. */
  evaluate<T>(expression: string): Promise<T>;
  until<T>(expression: string, what: string, timeoutMs: number): Promise<T>;
  send(method: string, params?: Params): Promise<Params>;
}

export interface Chrome {
  open(url: string, viewport?: { width: number; height: number }): Promise<Tab>;
  close(): Promise<void>;
}

export async function launchChrome(): Promise<Chrome> {
  const binary = CANDIDATES.find((p) => existsSync(p));
  if (!binary) throw new Error(`no Chrome found (looked in ${CANDIDATES.join(", ")}); set CHROME to its path`);
  const profile = mkdtempSync(join(tmpdir(), "raid-spec-chrome-"));
  const args = [
    "--headless=new",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    ...(process.env.CI ? ["--no-sandbox"] : []),
    "about:blank",
  ];
  const child: ChildProcess = spawn(binary, args, { stdio: "ignore" });
  let exited = false;
  child.once("exit", () => (exited = true));

  let port = 0;
  for (const deadline = Date.now() + 15_000; !port; await sleep(50)) {
    if (exited) throw new Error(`Chrome exited during startup (${binary})`);
    try {
      port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]);
    } catch {
      // not written yet
    }
    if (Date.now() > deadline) throw new Error("Chrome never wrote DevToolsActivePort");
  }
  const version = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()) as { webSocketDebuggerUrl: string };

  const socket = new WebSocket(version.webSocketDebuggerUrl);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("couldn't attach to Chrome")), { once: true });
  });
  let nextId = 0;
  const pending = new Map<number, { resolve: (v: Params) => void; reject: (e: Error) => void }>();
  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(String(event.data)) as { id?: number; result?: Params; error?: { message: string } };
    if (msg.id === undefined) return;
    const waiter = pending.get(msg.id);
    if (!waiter) return;
    pending.delete(msg.id);
    if (msg.error) waiter.reject(new Error(msg.error.message));
    else waiter.resolve(msg.result ?? {});
  });
  const call = (method: string, params: Params = {}, sessionId?: string): Promise<Params> =>
    new Promise((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });

  return {
    async open(url, viewport = { width: 1920, height: 1080 }) {
      const { browserContextId } = (await call("Target.createBrowserContext")) as { browserContextId: string };
      const { targetId } = (await call("Target.createTarget", { url: "about:blank", browserContextId })) as { targetId: string };
      const { sessionId } = (await call("Target.attachToTarget", { targetId, flatten: true })) as { sessionId: string };
      const send = (method: string, params: Params = {}) => call(method, params, sessionId);
      await send("Page.enable");
      await send("Runtime.enable");
      await send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
      await send("Page.navigate", { url });

      async function evaluate<T>(expression: string): Promise<T> {
        const res = (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })) as {
          result?: { value?: T };
          exceptionDetails?: { exception?: { description?: string }; text?: string };
        };
        if (res.exceptionDetails) {
          throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "page exception");
        }
        return res.result?.value as T;
      }

      async function until<T>(expression: string, what: string, timeoutMs: number): Promise<T> {
        let last = "";
        for (const deadline = Date.now() + timeoutMs; ; await sleep(25)) {
          try {
            const value = await evaluate<T>(expression);
            if (value) return value;
          } catch (err) {
            last = ` (last error: ${(err as Error).message})`;
          }
          if (Date.now() > deadline) throw new Error(`waited ${timeoutMs}ms for ${what}${last}`);
        }
      }

      return { evaluate, until, send };
    },

    async close() {
      try {
        await call("Browser.close");
      } catch {
        // already going
      }
      socket.close();
      if (!exited) child.kill("SIGKILL");
      await sleep(200);
      try {
        rmSync(profile, { recursive: true, force: true });
      } catch {
        // Chrome may still be writing its profile as it dies
      }
    },
  };
}
