import Database from "better-sqlite3";
import { resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase } from "./boot.ts";
import { clock, engine, table, turn, type Battle, type Clock, type Engine, type Step } from "./engine.ts";
import { join, newBattle, sleep } from "./raid.ts";

// The owner's ruling on phase two's gate, Q4 (rules 4 and 25, on intent): the
// app tells people apart by name, and the log speaks in names, so a person
// named like an Echo must not write lines like an Echo's. Two halves:
//   - every log line says whether an Echo wrote it (echo: true or false), on
//     the wire and in the database, so a line is told apart by what wrote it,
//     not by the name in it;
//   - the five names kept for the Echoes are compared by confusable skeleton
//     (Unicode TR39, for that fixed set only), so "Wаrden Echo" with a Cyrillic
//     а is refused as "Warden Echo" is.

afterAll(cleanScratch);

interface EchoEngine extends Engine {
  seatEcho(b: Battle, who: { id: string; role: string; seatedBy: string }, clock: Clock): Step;
}

type Line = { seq: number; actorId: string | null; kind: string; text: string; echo?: unknown };

describe("every log line says whether an Echo wrote it", () => {
  it("an Echo's lines say echo: true, a person's echo: false, whatever their names", async () => {
    const e = (await engine()) as EchoEngine;
    // A person who chose a name like an Echo's narration (not a kept name, so allowed).
    let b = table(e, ["mender"]);
    b = e.join(b, { id: "echo-of-1", name: "The Echo of Ada", role: "warden" }, clock()).battle;
    b = e.seatEcho(b, { id: "echo-striker", role: "striker", seatedBy: "mender-1" }, clock()).battle;
    const echoTurn = e.advance(e.plate(b, "echo-striker", clock(3_000_000)), clock(3_003_500));
    expect(echoTurn, "the Echo's turn was played").not.toBeNull();
    b = echoTurn!.battle;
    b = turn(e, b, "echo-of-1", "brace").battle;
    const lines = b.log as Line[];
    expect(lines.every((l) => typeof l.echo === "boolean"), "every line carries echo, true or false").toBe(true);
    const byEcho = lines.filter((l) => l.actorId === "echo-striker" && l.kind === "action");
    expect(byEcho.length, "the Echo acted").toBeGreaterThan(0);
    expect(byEcho.every((l) => l.echo === true), "the Echo's lines say so").toBe(true);
    const byPerson = lines.filter((l) => l.actorId === "echo-of-1" && l.kind === "action");
    expect(byPerson.length, "the person acted").toBeGreaterThan(0);
    expect(byPerson.every((l) => l.echo === false), "a person named like an Echo's narration writes echo: false").toBe(true);
  });

  it("the database keeps it: a timed-out seat's Echo lines are echo: true there too", async () => {
    // A person who never acts: three timeouts make the seat an Echo (rule 8), and its turns are logged as its.
    const db = scratchDatabase();
    const server = await boot(db, { TICK_MS: "5", TURN_TIMEOUT_MS: "200", ECHO_BEAT_MS: "50" });
    let battleId = "";
    let me = "";
    try {
      battleId = await newBattle(server.base);
      const seat = await join(server.base, battleId, "Steps Away", "striker");
      me = seat.characterId as string;
      for (const deadline = Date.now() + 30_000; ; await sleep(200)) {
        const log = (await (await fetch(new URL(`/api/battles/${battleId}/log`, server.base))).json()) as { entries: Line[] };
        if (log.entries.some((l) => l.actorId === me && l.kind === "action")) break;
        if (Date.now() > deadline) throw new Error("the timed-out seat's Echo never acted in 30s");
      }
    } finally {
      await server.kill();
    }
    const sqlite = new Database(db, { readonly: true });
    try {
      const rows = sqlite.prepare("select kind, echo from battle_log where battle_id = ? and actor_id = ?").all(battleId, me) as { kind: string; echo: number }[];
      const acted = rows.filter((r) => r.kind === "action");
      expect(acted.length, "the Echo's actions were written").toBeGreaterThan(0);
      expect(acted.every((r) => r.echo === 1), "written as an Echo's").toBe(true);
      const joined = rows.find((r) => r.kind === "join");
      expect(joined?.echo, "and the person's own seat line as a person's").toBe(0);
    } finally {
      sqlite.close();
    }
  }, 60_000);
});

describe("the names kept for the Echoes are compared by confusable skeleton (TR39)", () => {
  const cases: [string, string][] = [
    ["Wаrden Echo", "a Cyrillic а in Warden"],
    ["Mender Εcho", "a Greek capital Ε in Echo"],
    ["Strіker Echo", "a Cyrillic і in Striker"],
    ["Breaker Ech0", "a zero for the o"],
    ["Chronist Еcho", "a Cyrillic capital Е in Echo"],
    ["Rnender Echo", "rn for the m (TR39's own sequence)"],
    ["Brеaker Eсho", "two at once: a Cyrillic е and с"],
  ];
  for (const [name, what] of cases) {
    it(`refuses "${name}": ${what}`, async () => {
      const { checkJoin } = (await import(resolve("src/server/rules.ts"))) as {
        checkJoin: (b: unknown, characterId: string | null, name: string) => { status: number; error: string } | "already" | null;
      };
      const e = await engine();
      const refused = checkJoin(table(e, ["mender"]), null, name);
      expect(refused && refused !== "already" ? refused.status : null, `"${name}" passes for a kept Echo name`).toBe(409);
      expect(refused && refused !== "already" ? refused.error : "", "and says which").toMatch(/is kept for the .*'s Echo/);
    });
  }

  it("leaves names that only share letters alone", async () => {
    const { checkJoin } = (await import(resolve("src/server/rules.ts"))) as {
      checkJoin: (b: unknown, characterId: string | null, name: string) => unknown;
    };
    const e = await engine();
    for (const name of ["Wardens Echo", "Echo", "The Echo of Ada", "Mender", "Ward Echo"]) {
      expect(checkJoin(table(e, ["mender"]), null, name), `"${name}" is a person's name`).toBeNull();
    }
  });
});
