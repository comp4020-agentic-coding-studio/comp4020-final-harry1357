import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase, type Booted } from "./boot.ts";
import { joinRoom, raid, sleep, suffix } from "./raid.ts";

// Every refusal is exactly one log line (CLAUDE.md rule 32; docs/adr/008),
// held for every route the app has, not for a hand-written list of them: the
// owner's ruling on the merge that brought the logger, "so a 32nd path can't
// arrive unlogged". Two halves:
//
// 1. Structural: in src/server/app.ts, nothing answers a refusal but the one
//    function that logs it. A refusal written any other way fails here.
// 2. Behavioural: every API route the app registers (read from the app's own
//    route table, so a route added tomorrow is walked too) is sent a battery of
//    requests that should be refused, and every answer that isn't 2xx has
//    exactly one refusal line on stdout with the same status. And every route
//    is refused at least once, so a route the battery never reaches is seen.

afterAll(cleanScratch);

const ROOT = resolve(".");

describe("nothing answers a refusal but the one function that logs it", () => {
  it("src/server/app.ts writes no non-2xx answer outside refuse()", () => {
    const source = readFileSync(resolve(ROOT, "src/server/app.ts"), "utf8");
    // The bare responder, wherever it is: `c.json({ error … }, status)` and `fail(` calls.
    const lines = source.split("\n");
    const bare: string[] = [];
    let inRefuse = false;
    let depth = 0;
    for (const [i, line] of lines.entries()) {
      if (/^function refuse\b|^const refuse\b/.test(line)) {
        inRefuse = true;
        depth = 0;
      }
      if (inRefuse) {
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (depth <= 0 && line.includes("}")) inRefuse = false;
        continue;
      }
      if (/\bfail\(/.test(line) || /c\.json\(\s*\{\s*error\b/.test(line)) bare.push(`${i + 1}: ${line.trim()}`);
    }
    // The one answer that isn't a refusal: a crash's 500, whose trace goes to stderr (rule 32), not a refusal line.
    const crash = bare.filter((l) => /, 500\);/.test(l));
    expect(crash.length, "one crash answer, the error handler's").toBeLessThanOrEqual(1);
    expect(source, "and it writes the crash to stderr").toMatch(/app\.onError\(\(err, c\) => \{\s*console\.error\(err\);/);
    expect(bare.filter((l) => !crash.includes(l)), "refusals answered without the logger").toEqual([]);
  });
});

/** A line of key=value pairs, or null. */
function parse(line: string): Record<string, string> | null {
  const pair = /([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|[^\s"=\\]+)(?: +|$)/y;
  const fields: Record<string, string> = {};
  for (let at = 0; at < line.length; at = pair.lastIndex) {
    pair.lastIndex = at;
    const m = pair.exec(line);
    if (!m) return null;
    fields[m[1]] = m[2].startsWith('"') ? (JSON.parse(m[2]) as string) : m[2];
  }
  return fields;
}

const refusedLines = (server: Booted) =>
  server
    .stdout()
    .map(parse)
    .filter((l): l is Record<string, string> => l !== null && l.outcome === "refused");

async function routesOfTheApp(): Promise<string[]> {
  const { createApp } = (await import(resolve(ROOT, "src/server/app.ts"))) as { createApp: (...a: unknown[]) => { routes: { method: string; path: string }[] } };
  const { openStore } = (await import(resolve(ROOT, "src/server/db.ts"))) as { openStore: (p: string, m: string) => unknown };
  const { createTable } = (await import(resolve(ROOT, "src/server/table.ts"))) as { createTable: (...a: unknown[]) => unknown };
  const store = openStore(scratchDatabase(), resolve(ROOT, "drizzle"));
  const app = createApp(ROOT, store, createTable(store, 12_000, 150));
  return [...new Set(app.routes.filter((r) => r.path.startsWith("/api/")).map((r) => `${r.method} ${r.path}`))];
}

describe("every refusal on every route is one log line", () => {
  it("walks every API route with requests that should be refused, and finds one refusal line per refusal", async () => {
    const routes = await routesOfTheApp();
    expect(routes.length, "the app's route table lists its API routes").toBeGreaterThan(5);
    const server = await boot(scratchDatabase(), { TICK_MS: "20", LOBBY_GRACE_MS: "600000" });
    try {
      const at = server.base;
      // Fixtures the battery needs: a person seated in the public raid, a private room with a host and a
      // guest, a finished fight, and a stranger's cookie that the server never minted.
      const door = await raid(at);
      const raider = await joinRoom(at, door.code as string, `raider-${suffix()}`, "striker");
      const made = await fetch(new URL("/api/rooms", at), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: `host-${suffix()}`, role: "warden" }),
      });
      const room = (await made.json()) as { code: string; battleId: string };
      const host = made.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      const guest = await joinRoom(at, room.code, `guest-${suffix()}`, "mender");
      const forged = "raid_sid=" + "x".repeat(43);

      const fill = (path: string) =>
        path
          .replace(":code", room.code)
          .replace(":id", room.battleId)
          .replace(/:\w+/g, "nope");
      const ids = { badCode: "NOPE9", badBattle: `no-such-${suffix()}` };
      const variants = (method: string, path: string): { path: string; cookie: string; body?: string }[] => {
        const own = fill(path);
        const wrong = path.replace(":code", ids.badCode).replace(":id", ids.badBattle).replace(/:\w+/g, "nope");
        const bodies = method === "GET" ? [undefined] : ["not json", "[]", "{}", JSON.stringify({ name: "", role: "orrery", action: "fireball", seatId: "someone-else" })];
        const out: { path: string; cookie: string; body?: string }[] = [];
        for (const cookie of ["", forged, guest.cookie, raider.cookie, host]) {
          for (const body of bodies) {
            out.push({ path: own, cookie, body });
            out.push({ path: wrong, cookie, body });
          }
        }
        return out;
      };

      let refusals = 0;
      const refusedRoutes = new Set<string>();
      const statuses: number[] = [];
      for (const route of routes) {
        const [method, path] = route.split(" ");
        for (const v of variants(method, path)) {
          const before = refusedLines(server).length;
          const res = await fetch(new URL(v.path, at), {
            method,
            headers: { ...(v.body !== undefined ? { "content-type": "application/json" } : {}), ...(v.cookie ? { cookie: v.cookie } : {}) },
            body: v.body,
          });
          await res.arrayBuffer();
          if (res.status >= 200 && res.status < 300) continue;
          refusals++;
          refusedRoutes.add(route);
          statuses.push(res.status);
          // Its line, and only its line: the count goes up by exactly one, with this status.
          let after = refusedLines(server);
          for (let i = 0; i < 40 && after.length === before; i++) {
            await sleep(10);
            after = refusedLines(server);
          }
          await sleep(5);
          after = refusedLines(server);
          expect(after.length - before, `${method} ${v.path} answered ${res.status}: one refusal line for it`).toBe(1);
          expect(after.at(-1)?.status, `${method} ${v.path}: the line says ${res.status}`).toBe(String(res.status));
          expect(after.at(-1)?.reason, `${method} ${v.path}: and why`).toBeTruthy();
        }
      }
      expect(refusals, "the battery was refused, so there was something to count").toBeGreaterThan(50);
      // Every API route was refused at least once: a route this battery can't reach is seen, not passed.
      const quiet = routes.filter((r) => !refusedRoutes.has(r) && !["GET /api/raid", "GET /api/me", "POST /api/battles"].includes(r));
      expect(quiet, "API routes the battery never saw refuse").toEqual([]);
    } finally {
      await server.kill();
    }
  }, 120_000);
});
