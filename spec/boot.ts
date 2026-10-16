import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { sleep } from "./raid.ts";

// A server of the spec's own, booted from source against a scratch database,
// for claims the shared running app can't be used for: a restart (somebody
// else's process, and in CI a tmpfs /data a restart would wipe), or a clock
// and a timeout short enough to test in seconds. See docs/adr/001.
const SERVER = "src/server/main.ts";

const scratch: string[] = [];

export function scratchDatabase(): string {
  const dir = mkdtempSync(joinPath(tmpdir(), "raid-spec-"));
  scratch.push(dir);
  return joinPath(dir, "raid.db");
}

export function cleanScratch(): void {
  for (const dir of scratch.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export interface Booted {
  base: string;
  /** What the server has written to stdout so far, one entry per line. */
  stdout(): string[];
  /** stdout and stderr together, as a log tail would show them. */
  output(): string;
  kill(): Promise<void>;
}

/** Boot the server on a free port; resolves once / answers. `kill` is SIGKILL, on purpose. */
export async function boot(databasePath: string, env: Record<string, string> = {}): Promise<Booted> {
  // PORT=0: the OS picks, the server's start line says which. Choosing a port
  // here and handing it over raced when two spec files booted at once.
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: "0", DATABASE_PATH: databasePath, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  let stdout = "";
  child.stdout.on("data", (chunk: Buffer) => {
    output += chunk;
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: Buffer) => (output += chunk));
  let exited = false;
  const exit = new Promise<void>((resolve) =>
    child.once("exit", () => {
      exited = true;
      resolve();
    }),
  );

  let base = "";
  for (const deadline = Date.now() + 15_000; ; await sleep(100)) {
    if (exited) throw new Error(`${SERVER} exited before it answered:\n${output}`);
    // the start line as prose, or as the key=value line docs/adr/008 makes it
    const port = /(?:listening on |listen=)[\d.]+:(\d+)/.exec(output)?.[1];
    if (port) {
      base = `http://127.0.0.1:${port}`;
      try {
        if ((await fetch(base)).ok) break;
      } catch {
        // not answering yet
      }
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`${SERVER} didn't answer within 15s:\n${output}`);
    }
  }

  return {
    base,
    stdout: () => stdout.split("\n").filter((line) => line !== ""),
    output: () => output,
    kill: async () => {
      if (!exited) child.kill("SIGKILL");
      await exit;
    },
  };
}
