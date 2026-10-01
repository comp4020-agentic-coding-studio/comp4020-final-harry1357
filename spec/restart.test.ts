import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { act, battle, battleLog, join, me, newBattle, sleep, suffix } from "./raid.ts";

// Characters and battle logs survive a restart; fights don't. A restart can't
// be done to the app the rest of spec/ runs against: that is somebody else's
// process, and in CI its /data is a tmpfs a container restart would wipe. So
// this file boots its own server from source against a temporary database,
// kills it with SIGKILL (no graceful shutdown to hide behind) and boots it
// again on the same file. See docs/adr/001.
const SERVER = "src/server/main.ts";

const dirs: string[] = [];
afterAll(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

function scratchDatabase(): string {
  const dir = mkdtempSync(joinPath(tmpdir(), "raid-restart-"));
  dirs.push(dir);
  return joinPath(dir, "raid.db");
}

async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

interface Booted {
  base: string;
  kill(): Promise<void>;
}

async function boot(databasePath: string, env: Record<string, string> = {}): Promise<Booted> {
  const port = await freePort();
  const child = spawn(process.execPath, [SERVER], {
    env: { ...process.env, PORT: String(port), DATABASE_PATH: databasePath, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk: Buffer) => (output += chunk));
  child.stderr.on("data", (chunk: Buffer) => (output += chunk));
  let exited = false;
  const exit = new Promise<void>((resolve) =>
    child.once("exit", () => {
      exited = true;
      resolve();
    }),
  );

  const base = `http://127.0.0.1:${port}`;
  for (const deadline = Date.now() + 15_000; ; await sleep(100)) {
    if (exited) throw new Error(`${SERVER} exited before it answered:\n${output}`);
    try {
      if ((await fetch(base)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) {
      child.kill("SIGKILL");
      throw new Error(`${SERVER} didn't answer at ${base} within 15s:\n${output}`);
    }
  }

  return {
    base,
    kill: async () => {
      if (!exited) child.kill("SIGKILL");
      await exit;
    },
  };
}

describe("what survives a restart", () => {
  it("a character survives a server restart", async () => {
    const db = scratchDatabase();
    const name = `keeper-${suffix()}`;

    const first = await boot(db);
    let cookie = "";
    let before;
    try {
      const joined = await join(first.base, await newBattle(first.base), name, "bulwark");
      expect(joined.status).toBe(200);
      expect(joined.cookie, "joining mints a session cookie").not.toBe("");
      cookie = joined.cookie;
      before = (await me(first.base, cookie)).character;
      expect(before).toMatchObject({ id: joined.characterId, name, role: "bulwark" });
    } finally {
      await first.kill();
    }

    const second = await boot(db);
    try {
      const after = (await me(second.base, cookie)).character;
      expect(after, "the same cookie finds the same character").toMatchObject({
        id: before?.id,
        name: before?.name,
        role: before?.role,
      });
    } finally {
      await second.kill();
    }
  }, 45_000);

  it("a completed battle's log is readable after restart", async () => {
    const db = scratchDatabase();

    // A fast clock, so a whole fight fits in a test.
    const first = await boot(db, { TICK_MS: "5" });
    let battleId = "";
    let status = "";
    let before;
    try {
      battleId = await newBattle(first.base);
      const mine = await join(first.base, battleId, `finisher-${suffix()}`, "lancer");
      expect(mine.status).toBe(200);

      for (const deadline = Date.now() + 45_000; ; ) {
        const st = await battle(first.base, battleId);
        if (st.status === "won" || st.status === "lost") {
          status = st.status;
          break;
        }
        if (Date.now() > deadline) throw new Error(`the battle was still ${st.status} after 45s`);
        if (st.activeId === mine.characterId) {
          expect((await act(first.base, battleId, mine.cookie, "strike")).status, "it was my turn").toBe(200);
        } else {
          await sleep(10);
        }
      }

      before = await battleLog(first.base, battleId);
      expect(before.status).toBe(status);
      expect(before.entries.length, "a finished fight has a log").toBeGreaterThan(0);
    } finally {
      await first.kill();
    }

    const second = await boot(db);
    try {
      const after = await battleLog(second.base, battleId);
      expect(after.status, "the outcome survived").toBe(status);
      expect(after.entries, "every line written before the kill is still there").toEqual(before?.entries);
    } finally {
      await second.kill();
    }
  }, 90_000);
});
