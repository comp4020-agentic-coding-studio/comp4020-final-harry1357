// The one process (docs/adr/001): open the database on the volume, close any
// fight the last process left open, start the one clock, and serve HTTP and
// the WebSocket on the same port. Run with `node src/server/main.ts`.

import { serve } from "@hono/node-server";
import { join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { createApp } from "./app.ts";
import { openStore } from "./db.ts";
import { createTable, DROP_AFTER_MS } from "./table.ts";
import { ROOM_EMPTY_MS } from "./tuning.ts";

/** The repo root (/app in the image), whatever directory the process was started from. */
const ROOT = resolve(import.meta.dirname, "../..");

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
const table = createTable(store, turnMs, tickMs, beatMs, roomEmptyMs, dropAfterMs);
const app = createApp(ROOT, store, table);

const server = serve(
  { fetch: app.fetch, port, hostname: "0.0.0.0", websocket: { server: new WebSocketServer({ noServer: true }) } },
  (info) =>
    console.log(
      `The Orrery is listening on 0.0.0.0:${info.port} (database ${databasePath}, tick ${tickMs}ms, ` +
        `turn ${turnMs}ms); closed ${closed} fight(s) left open by the last process.`,
    ),
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
