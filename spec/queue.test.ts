import { afterEach, describe, expect, inject, it } from "vitest";
import { act, battle, boss, join, newBattle, sleep, suffix, token, watch, type BattleState, type Watcher } from "./raid.ts";

// The queue is the truth. The server owns turn order. Every client is shown the
// same rail, and an action is accepted only from whoever the server has put on
// the strike plate. Run against the running app, like everything in spec/.
// Each test makes its own battle so it never waits on somebody else's turn.
const base = inject("baseUrl");

const open: Watcher[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});

function watching(battleId: string): Watcher {
  const w = watch(base, battleId);
  open.push(w);
  return w;
}

describe("the queue is the truth", () => {
  it("two clients joined to the same battle receive identical queues", async () => {
    const battleId = await newBattle(base);
    const s = suffix();
    const a = await join(base, battleId, `ada-${s}`, "striker");
    const b = await join(base, battleId, `bo-${s}`, "warden");
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);
    expect(a.cookie, "two people, so two different sessions").not.toBe(b.cookie);

    const wa = watching(battleId);
    const wb = watching(battleId);
    await Promise.all([wa.opened, wb.opened]);

    const byVersion = (w: Watcher): Map<number, BattleState> => new Map(w.states.map((st) => [st.version, st]));
    const common = (): number[] => [...byVersion(wa).keys()].filter((v) => byVersion(wb).has(v));

    // A room waits for the pull before anything moves: ten seconds after the
    // last seat (docs/adr/006), so the window has to outlast that.
    for (const deadline = Date.now() + 20_000; common().length < 5; await sleep(50)) {
      if (Date.now() > deadline) throw new Error(`only ${common().length} broadcast(s) reached both clients in 20s`);
    }

    const left = byVersion(wa);
    const right = byVersion(wb);
    for (const v of common()) {
      const l = left.get(v) as BattleState;
      const r = right.get(v) as BattleState;
      expect({ activeId: r.activeId, queue: r.queue }, `broadcast ${v} differs between the two clients`).toEqual({
        activeId: l.activeId,
        queue: l.queue,
      });
    }

    const last = left.get(common().at(-1) as number) as BattleState;
    const ids = last.queue.map((t) => t.id);
    expect(ids).toContain(a.characterId);
    expect(ids).toContain(b.characterId);
    expect(boss(last), "the Orrery is on the rail too").toBeDefined();
  }, 30_000);

  it("an action from a character whose counter isn't zero is rejected", async () => {
    const battleId = await newBattle(base);
    const mine = await join(base, battleId, `early-${suffix()}`, "striker");
    expect(mine.status).toBe(200);

    const w = watching(battleId);
    await w.opened;
    const first = await w.waitFor((st) => token(st, mine.characterId) !== undefined, "me on the rail", 5_000);
    expect(token(first, mine.characterId)?.counter, "a fresh character starts with a full counter").toBeGreaterThan(0);

    const early = await act(base, battleId, mine.cookie, "cleave");
    expect(early.status, "an action before your turn is refused").toBe(409);

    // Rejected, never queued: when the turn does arrive, the strike that was
    // refused must not fire on its own.
    await w.waitFor((st) => st.activeId === mine.characterId, "my turn", 15_000);
    await sleep(1_000);
    const later = await battle(base, battleId);
    expect(later.activeId, "still my turn: nothing acted for me").toBe(mine.characterId);
    const orrery = boss(later);
    expect(orrery?.hp, "the refused strike never landed").toBe(orrery?.maxHp);
  }, 25_000);

  it("an action changes the queue within one tick", async () => {
    const battleId = await newBattle(base);
    const mine = await join(base, battleId, `quick-${suffix()}`, "striker");
    expect(mine.status).toBe(200);

    const w = watching(battleId);
    await w.opened;
    const ready = await w.waitFor((st) => st.activeId === mine.characterId, "my turn", 15_000);
    expect(token(ready, mine.characterId)?.counter).toBe(0);

    const from = w.states.length;
    const res = await act(base, battleId, mine.cookie, "cleave");
    expect(res.status).toBe(200);
    expect(res.tick, "an accepted action says which tick it landed on").not.toBeNull();

    const moved = await w.waitFor(
      (st) => st.activeId !== mine.characterId && (token(st, mine.characterId)?.counter ?? 0) > 0,
      "the queue to move after my action",
      5_000,
      from,
    );
    expect(moved.tick, "the change reached the other side within one tick").toBeLessThanOrEqual((res.tick as number) + 1);
    expect(moved.queue[0]?.id, "I'm off the strike plate").not.toBe(mine.characterId);
    const orrery = boss(moved);
    expect(orrery?.hp, "and the strike landed").toBeLessThan(orrery?.maxHp ?? 0);
  }, 25_000);

  it("a name already in the battle is refused", async () => {
    const battleId = await newBattle(base);
    const name = `dup-${suffix()}`;

    expect((await join(base, battleId, name, "warden")).status).toBe(200);
    expect((await join(base, battleId, name, "mender")).status, "same name, another person").toBe(409);
    expect((await join(base, battleId, name.toUpperCase(), "mender")).status, "names compare case-insensitively").toBe(
      409,
    );
    expect((await join(base, battleId, `  ${name}  `, "mender")).status, "names compare trimmed").toBe(409);
    expect((await join(base, battleId, `other-${suffix()}`, "mender")).status, "a free name still gets in").toBe(200);

    const elsewhere = await newBattle(base);
    expect((await join(base, elsewhere, name, "warden")).status, "unique within a battle, not across them").toBe(200);
  });

  it("a name can't be made unique, or empty, with characters nobody can see", async () => {
    // Breaker Q1 (docs/review/phase-one.md): zero-width and bidi characters
    // made "Dup" and "Dup" plus an invisible mark two names that render as one.
    const battleId = await newBattle(base);
    const name = `dup-${suffix()}`;
    expect((await join(base, battleId, name, "warden")).status).toBe(200);
    for (const [label, twin] of [
      ["a zero-width space", `${name}\u200b`],
      ["a zero-width joiner", `${name}\u200d`],
      ["a soft hyphen", `${name}\u00ad`],
      ["a right-to-left override", `\u202e${name}`],
      ["a byte-order mark", `\ufeff${name}`],
    ] as const) {
      expect((await join(base, battleId, twin, "mender")).status, `the same name with ${label} is the same name`).toBe(409);
    }
    for (const [label, blank] of [
      ["only a zero-width space", "\u200b"],
      ["only a soft hyphen", "\u00ad"],
      ["only a Hangul filler", "\u3164"],
      ["only a halfwidth Hangul filler", "\uffa0"],
      ["only a Braille blank", "\u2800"],
    ] as const) {
      expect((await join(base, battleId, blank, "mender")).status, `a name of ${label} is no name`).toBe(400);
    }
    // Review R4: invisible marks outside Cf, and the same letters composed
    // differently, are still the same name.
    for (const [label, twin] of [
      ["a combining grapheme joiner", `${name}\u034f`],
      ["a variation selector", `${name}\ufe0f`],
    ] as const) {
      expect((await join(base, battleId, twin, "mender")).status, `the same name with ${label} is the same name`).toBe(409);
    }
    const composed = `Jos\u00e9-${suffix()}`; // é as one character
    expect((await join(base, battleId, composed, "warden")).status).toBe(200);
    expect(
      (await join(base, battleId, composed.replace("\u00e9", "e\u0301"), "mender")).status,
      "é written as e plus an accent is the same name as é",
    ).toBe(409);
  });

  it("a name is kept as typed: joiners that shape emoji and scripts aren't stripped", async () => {
    // Review R2: stripping every format character turned 👩‍💻 into two emoji
    // and broke Persian and Indic spelling, renaming people silently (rule 4).
    const battleId = await newBattle(base);
    const s = suffix();
    for (const name of [`\u{1F469}\u200d\u{1F4BB} ${s}`, `\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645 ${s}`]) {
      const seat = await join(base, battleId, name, "warden");
      expect(seat.status, `${JSON.stringify(name)} is a name`).toBe(200);
      const st = (await (await fetch(new URL(`/api/battles/${battleId}`, base))).json()) as { queue: { id: string; name: string }[] };
      expect(st.queue.find((t) => t.id === seat.characterId)?.name, "stored and shown exactly as typed").toBe(name.normalize("NFC"));
    }
  });
});
