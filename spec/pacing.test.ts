import { afterAll, describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase, type Booted } from "./boot.ts";
import { act, boss, join, me, newBattle, sleep, suffix, type BattleState, type Token } from "./raid.ts";

// A room can't wait on one person (docs/adr/002, CLAUDE.md rule 8). After the
// turn timeout the server takes a hold: the turn passes and nothing is chosen
// on the person's behalf. Two holds in a row and they leave. Acting in between
// resets the count. The rule needs a timeout short enough to test, so this
// file boots its own server with a fast clock and a 400 ms turn.
const TURN_MS = 400;

afterAll(cleanScratch);

interface Line {
  kind: string;
  actorId: string | null;
}

interface Table extends BattleState {
  fallen: Token[];
  log: Line[];
}

async function table(base: string, battleId: string): Promise<Table> {
  return (await (await fetch(new URL(`/api/battles/${battleId}`, base))).json()) as Table;
}

async function fullLog(base: string, battleId: string): Promise<Line[]> {
  return ((await (await fetch(new URL(`/api/battles/${battleId}/log`, base))).json()) as { entries: Line[] }).entries;
}

async function until(base: string, battleId: string, test: (t: Table) => boolean, what: string): Promise<Table> {
  for (const deadline = Date.now() + 15_000; ; await sleep(20)) {
    const t = await table(base, battleId);
    if (test(t)) return t;
    if (Date.now() > deadline) throw new Error(`waited 15s for ${what}; the battle is ${t.status}`);
  }
}

const holdsBy = (lines: Line[], id: string | null): number =>
  lines.filter((l) => l.kind === "timeout" && l.actorId === id).length;

async function fastServer(): Promise<Booted> {
  return boot(scratchDatabase(), { TICK_MS: "5", TURN_TIMEOUT_MS: String(TURN_MS) });
}

describe("a room can't wait on one person", () => {
  it("holds an absent player's turn, chooses nothing for them, and lets them go after two", async () => {
    const server = await fastServer();
    try {
      const battleId = await newBattle(server.base);
      const mine = await join(server.base, battleId, `idle-${suffix()}`, "herald");
      expect(mine.status).toBe(200);
      const seated = Date.now();

      const gone = await until(
        server.base,
        battleId,
        (t) => t.fallen.some((f) => f.id === mine.characterId),
        "the idle player to leave",
      );
      expect(Date.now() - seated, "two whole turns were waited out first").toBeGreaterThanOrEqual(2 * TURN_MS);

      const log = await fullLog(server.base, battleId);
      expect(holdsBy(log, mine.characterId), "exactly two holds, then the leave").toBe(2);
      expect(log.filter((l) => l.kind === "leave" && l.actorId === mine.characterId)).toHaveLength(1);
      expect(log.some((l) => l.kind === "action" && l.actorId === mine.characterId), "no action taken in their name").toBe(
        false,
      );

      const orrery = boss(gone);
      expect(orrery, "the Orrery is still on the rail").toBeDefined();
      expect(orrery?.hp, "a hold deals nothing").toBe(orrery?.maxHp);
      expect((await me(server.base, mine.cookie)).character, "and credits nothing").toMatchObject({ turns: 0 });
    } finally {
      await server.kill();
    }
  }, 30_000);

  it("only counts holds in a row: acting resets the count", async () => {
    const server = await fastServer();
    try {
      const battleId = await newBattle(server.base);
      const mine = await join(server.base, battleId, `slow-${suffix()}`, "herald");
      expect(mine.status).toBe(200);
      const id = mine.characterId;

      await until(server.base, battleId, (t) => holdsBy(t.log, id) === 1, "the first hold");
      await until(server.base, battleId, (t) => t.activeId === id, "my turn after the hold");
      expect((await act(server.base, battleId, mine.cookie, "strike")).status, "I'm back, and I act").toBe(200);

      const second = await until(server.base, battleId, (t) => holdsBy(t.log, id) === 2, "a second hold, after acting");
      expect(
        second.queue.some((t) => t.id === id),
        "two holds that weren't in a row don't send anyone away",
      ).toBe(true);

      await until(server.base, battleId, (t) => t.fallen.some((f) => f.id === id), "the next hold in a row to send me away");
      expect(holdsBy(await fullLog(server.base, battleId), id), "it took the second consecutive hold, not the second hold").toBe(3);
    } finally {
      await server.kill();
    }
  }, 45_000);
});
