import { afterEach, describe, expect, inject, it } from "vitest";
import {
  act,
  battleLog,
  join,
  newBattle,
  sleep,
  suffix,
  token,
  watch,
  type BattleState,
  type Watcher,
} from "./raid.ts";

// Two people act at once (docs/adr/005). The strike plate holds one character,
// but two clients can press Strike inside the same few hundred milliseconds.
// The server's clock decides: exactly one is applied, the other is refused with
// the name of whose turn it is (never queued), and afterwards every client
// holds the same queue. Run against the running app, like everything in spec/.
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

// Which request leaves first isn't the server's to know and isn't the test's to
// choose, so the race is run both ways round: the holder of the plate first,
// then the other one first. Whichever order the server sees them in, the same
// things must be true.
describe("two actions for one turn", () => {
  it.each([
    ["the plate's holder sends first", true],
    ["the other client sends first", false],
  ])("the clock decides, and the second is refused by name (%s)", async (_order, holderFirst) => {
    const battleId = await newBattle(base);
    const s = suffix();
    const ada = await join(base, battleId, `ada-${s}`, "striker");
    const bo = await join(base, battleId, `bo-${s}`, "warden");
    expect(ada.status).toBe(200);
    expect(bo.status).toBe(200);

    // two clients, two sockets, each its own view of the rail
    const wa = watching(battleId);
    const wb = watching(battleId);
    await Promise.all([wa.opened, wb.opened]);

    const people = [
      { name: `ada-${s}`, who: ada },
      { name: `bo-${s}`, who: bo },
    ];
    const ready = await wa.waitFor(
      (st) => people.some((p) => st.activeId === p.who.characterId),
      "one of us on the strike plate",
      25_000,
    );
    const holder = people.find((p) => p.who.characterId === ready.activeId) as (typeof people)[number];
    const other = people.find((p) => p !== holder) as (typeof people)[number];

    const fromA = wa.states.length;
    const fromB = wb.states.length;
    const sends = holderFirst
      ? [act(base, battleId, holder.who.cookie, "brace"), act(base, battleId, other.who.cookie, "brace")]
      : [act(base, battleId, other.who.cookie, "brace"), act(base, battleId, holder.who.cookie, "brace")];
    const results = await Promise.all(sends);
    const [held, refused] = holderFirst ? results : [results[1], results[0]];

    expect(held.status, "the character on the plate is the one whose action is applied").toBe(200);
    expect(refused.status, "the other action for the same turn is refused").toBe(409);
    expect(refused.error, "the refusal names the acting character").toContain(holder.name);

    // exactly one action happened: the log has one, and it's the holder's
    const { entries } = await battleLog(base, battleId);
    const actions = (entries as { kind: string; actorId: string | null }[]).filter((e) => e.kind === "action");
    expect(actions.map((e) => e.actorId), "one action in the log, never two").toEqual([holder.who.characterId]);

    // and the refused one wasn't kept for later: when the dust settles the
    // refused character has not acted on their own
    const moved = (st: BattleState): boolean =>
      st.activeId !== holder.who.characterId && (token(st, holder.who.characterId)?.counter ?? 0) > 0;
    await Promise.all([
      wa.waitFor(moved, "the queue to move on my screen", 5_000, fromA),
      wb.waitFor(moved, "the queue to move on theirs", 5_000, fromB),
    ]);
    await sleep(600); // a few ticks more, so there are broadcasts to compare

    const left = new Map(wa.states.slice(fromA).map((st) => [st.version, st]));
    const right = new Map(wb.states.slice(fromB).map((st) => [st.version, st]));
    const common = [...left.keys()].filter((v) => right.has(v));
    expect(common.length, "broadcasts that reached both clients after the action").toBeGreaterThanOrEqual(3);
    for (const v of common) {
      const l = left.get(v) as BattleState;
      const r = right.get(v) as BattleState;
      expect({ activeId: r.activeId, queue: r.queue }, `broadcast ${v} differs between the two clients`).toEqual({
        activeId: l.activeId,
        queue: l.queue,
      });
    }

    const after = await battleLog(base, battleId);
    const later = (after.entries as { kind: string; actorId: string | null }[]).filter((e) => e.kind === "action");
    expect(later.length, "nothing the refused client sent fired afterwards").toBe(1);
  }, 45_000);
});
