import { afterAll, describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase, type Booted } from "./boot.ts";
import { act, join, newBattle, sleep, suffix, type BattleState, type Token } from "./raid.ts";

// A room can't wait on one person (CLAUDE.md rule 8; docs/adr/002 and 006).
// After the turn timeout the server Braces for them: the safe action, which
// banks a Charge, and their portrait dims. Three timeouts in a row and the
// character becomes an Echo the server plays, at low output, until the person
// acts again. Nobody is sent away. This replaces the old hold rule (two holds
// and you leave) on purpose; see rule 8. It needs a timeout short enough to
// test, so this file boots its own server with a fast clock and a 400 ms turn.
const TURN_MS = 400;

afterAll(cleanScratch);

interface Line {
  kind: string;
  actorId: string | null;
}

interface Seat extends Token {
  braced?: boolean;
  charge?: number;
  drifting?: boolean;
  echo?: boolean;
}

interface Table extends BattleState {
  queue: Seat[];
  fallen: Seat[];
  log: Line[];
}

async function table(base: string, battleId: string): Promise<Table> {
  return (await (await fetch(new URL(`/api/battles/${battleId}`, base))).json()) as Table;
}

async function until(base: string, battleId: string, test: (t: Table) => boolean, what: string): Promise<Table> {
  for (const deadline = Date.now() + 15_000; ; await sleep(20)) {
    const t = await table(base, battleId);
    if (test(t)) return t;
    if (Date.now() > deadline) throw new Error(`waited 15s for ${what}; the battle is ${t.status}`);
  }
}

const seat = (t: Table, id: string | null): Seat | undefined => t.queue.find((s) => s.id === id);
const timeoutsBy = (lines: Line[], id: string | null): number =>
  lines.filter((l) => l.kind === "timeout" && l.actorId === id).length;

async function fastServer(): Promise<Booted> {
  return boot(scratchDatabase(), { TICK_MS: "5", TURN_TIMEOUT_MS: String(TURN_MS) });
}

describe("a room can't wait on one person", () => {
  it("braces for an absent player, dims them, and makes them an Echo after three, without sending them away", async () => {
    const server = await fastServer();
    try {
      const battleId = await newBattle(server.base);
      const mine = await join(server.base, battleId, `idle-${suffix()}`, "warden");
      expect(mine.status).toBe(200);
      const id = mine.characterId;

      const first = await until(server.base, battleId, (t) => timeoutsBy(t.log, id) >= 1, "the first timeout");
      expect(seat(first, id)?.braced, "the server Braced for them").toBe(true);
      expect(seat(first, id)?.charge, "and the Brace banked a Charge").toBeGreaterThanOrEqual(1);
      expect(seat(first, id)?.drifting, "their portrait dims").toBe(true);

      const echo = await until(server.base, battleId, (t) => seat(t, id)?.echo === true, "the Echo");
      expect(timeoutsBy(echo.log, id), "it took three timeouts in a row").toBe(3);
      expect(echo.fallen.some((f) => f.id === id), "nobody is sent away").toBe(false);
      expect(echo.queue.some((s) => s.id === id), "they're still on the strip").toBe(true);
    } finally {
      await server.kill();
    }
  }, 30_000);

  it("only counts timeouts in a row: acting resets the count and ends an Echo", async () => {
    const server = await fastServer();
    try {
      const battleId = await newBattle(server.base);
      const mine = await join(server.base, battleId, `slow-${suffix()}`, "striker");
      expect(mine.status).toBe(200);
      const id = mine.characterId;

      await until(server.base, battleId, (t) => timeoutsBy(t.log, id) === 2, "two timeouts");
      await until(server.base, battleId, (t) => t.activeId === id, "my turn");
      expect((await act(server.base, battleId, mine.cookie, "jab")).status, "I'm back, and I act").toBe(200);

      const back = await table(server.base, battleId);
      expect(seat(back, id)?.drifting, "acting brightens the portrait").toBe(false);
      await until(server.base, battleId, (t) => timeoutsBy(t.log, id) === 3, "a third timeout, after acting");
      const later = await table(server.base, battleId);
      expect(seat(later, id)?.echo, "three timeouts that weren't in a row make no Echo").toBe(false);
    } finally {
      await server.kill();
    }
  }, 45_000);
});
