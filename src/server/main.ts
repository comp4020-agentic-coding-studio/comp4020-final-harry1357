// The one process (docs/adr/001): open the database on the volume, close any
// fight the last process left open, start the one clock, and serve HTTP and
// the WebSocket on the same port. Run with `node src/server/main.ts`.

import { serve } from "@hono/node-server";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { createApp } from "./app.ts";
import { openStore } from "./db.ts";
import { started } from "./log.ts";
import { createTable, DROP_AFTER_MS } from "./table.ts";
import { LOBBY_GRACE_MS, ROOM_EMPTY_MS } from "./tuning.ts";

/** The repo root (/app in the image), whatever directory the process was started from. */
const ROOT = resolve(import.meta.dirname, "../..");

/** The commit this process runs: GIT_SHA in the image (a build arg), else the checkout's HEAD. */
function gitSha(): string {
  const baked = process.env.GIT_SHA;
  if (baked && baked !== "unknown") return baked.slice(0, 7);
  try {
    return execFileSync("git", ["rev-parse", "--short=7", "HEAD"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
  } catch {
    return "unknown";
  }
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${name} must be a positive integer, not "${raw}"`);
  return value;
}

// PORT=0 asks the OS for a free port; the log line reports the one bound,
// which is how the spec's own servers find theirs without racing each other.
const port = process.env.PORT === "0" ? 0 : intEnv("PORT", 8080);
const tickMs = intEnv("TICK_MS", 150);
const turnMs = intEnv("TURN_TIMEOUT_MS", 12_000);
// An Echo's beat on the plate (rule 8); short in a fast spec so Echo turns don't cost seconds each.
const beatMs = intEnv("ECHO_BEAT_MS", 3_000);
const databasePath = resolve(process.env.DATABASE_PATH || "/data/raid.db");

const store = openStore(databasePath, join(ROOT, "drizzle"));
const closed = store.closeLiveBattles(Date.now());
const roomEmptyMs = intEnv("ROOM_EMPTY_MS", ROOM_EMPTY_MS);
// How long an ended fight stays in memory; short in a spec that needs it gone (breaker B3).
const dropAfterMs = intEnv("DROP_AFTER_MS", DROP_AFTER_MS);
// How long a lobby seat may have no socket on its room before it has left (rule 27).
const lobbyGraceMs = intEnv("LOBBY_GRACE_MS", LOBBY_GRACE_MS);
const table = createTable(store, turnMs, tickMs, beatMs, roomEmptyMs, dropAfterMs, lobbyGraceMs);
const app = createApp(ROOT, store, table);

const server = serve(
  { fetch: app.fetch, port, hostname: "0.0.0.0", websocket: { server: new WebSocketServer({ noServer: true }) } },
  (info) =>
    started({ sha: gitSha(), listen: `0.0.0.0:${info.port}`, database: databasePath, tickMs, turnMs, closed }),
);
const clock = table.start();

// Node as PID 1 in a container ignores SIGTERM unless told otherwise.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    clearInterval(clock);
    server.close();
    store.close();
    process.exit(0);
  });
}
