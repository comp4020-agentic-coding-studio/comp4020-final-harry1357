import { describe, expect, it } from "vitest";
import { clock, engine, type Battle, type Engine } from "./engine.ts";

// The pull (docs/adr/006, amended by docs/adr/009; CLAUDE.md rules 20 and 27).
// A countdown assumes a table arrives together, and tables don't, so it is
// gone. A private room's fight pulls on its host's Start (spec/lobby.test.ts).
// The public raid, and a bare battle, have no host: theirs pulls after a short
// ready window from its first seat, READY_MS (eight seconds, ours), and a
// later seat doesn't put it off. Anyone who arrives after the pull grows the
// Orrery instead (rule 20), so nobody is missed by pulling early.
//
// It is counted in seconds on the clock the caller supplies, not in ticks: a
// tick is 150 ms live and 5 ms in a fast spec, and the window must be eight
// seconds either way. The engine is pure, so the clock is injected here.

const READY_MS = 8_000;
const T0 = 1_000_000;

/** Seat one character at `at` in this battle. */
function sit(e: Engine, b: Battle, n: number, at: number): Battle {
  return e.join(b, { id: `seat-${n}`, name: `Seat ${n}`, role: "striker" }, clock(at)).battle;
}

/** Run the clock to `at`, in 150 ms ticks as the live server would; the battle as it stands then. */
function runTo(e: Engine, b: Battle, from: number, at: number): Battle {
  for (let now = from; now <= at; now += 150) b = e.advance(b, clock(now))?.battle ?? b;
  return b;
}

/** A public raid's fight, as the table opens one. */
function publicFight(e: Engine): Battle {
  const b = e.createBattle("pull", true, T0);
  (b as Battle & { room: string | null }).room = "RAID";
  return b;
}

describe("the public raid's pull", () => {
  it("waits for the first seat, then pulls after the ready window", async () => {
    const e = await engine();
    let b = runTo(e, publicFight(e), T0, T0 + 60_000);
    expect(b.status, "with nobody seated, nothing pulls, however long").toBe("waiting");

    b = sit(e, b, 1, T0 + 60_000);
    b = runTo(e, b, T0 + 60_000, T0 + 60_000 + READY_MS - 500);
    expect(b.status, "half a second short of the window, still waiting").toBe("waiting");
    b = runTo(e, b, T0 + 60_000 + READY_MS - 500, T0 + 60_000 + READY_MS + 500);
    expect(b.status, "the window up, the Orrery wakes").toBe("fighting");
    expect(b.pullSeats, "pulled for the one seat present").toBe(1);
  });

  it("a later seat doesn't put the pull off: the window runs from the first", async () => {
    const e = await engine();
    let b = sit(e, publicFight(e), 1, T0);
    b = runTo(e, b, T0, T0 + 6_000);
    b = sit(e, b, 2, T0 + 6_000);
    // The old countdown would restart here, to T0 + 16 s. The window doesn't.
    b = runTo(e, b, T0 + 6_000, T0 + READY_MS + 500);
    expect(b.status, "it pulls on the first seat's window").toBe("fighting");
    expect(b.pullSeats, "counting everyone seated by then").toBe(2);
    const boss = b.standing.find((f) => f.id === "orrery")!;
    expect(boss.maxHp, "on the curve for two seats").toBe(e.orreryHp(2));
  });

  it("a private room's fight never pulls on a timer", async () => {
    const e = await engine();
    let b = e.createBattle("pull", false, T0);
    (b as Battle & { room: string | null }).room = "QZ7MK";
    b = sit(e, b, 1, T0);
    b = runTo(e, b, T0, T0 + 120_000);
    expect(b.status, "two minutes on, with no Start, it is still a lobby").toBe("waiting");
  });

  it("announces the pull as an event, so the screen can show it before the log does", async () => {
    const e = await engine();
    let b = sit(e, publicFight(e), 1, T0);
    let pulled: { kind: string; seats?: unknown; maxHp?: unknown } | undefined;
    for (let now = T0; now <= T0 + READY_MS + 500 && !pulled; now += 150) {
      const step = e.advance(b, clock(now));
      if (!step) continue;
      b = step.battle;
      pulled = step.effects.events.find((x) => x.kind === "pull");
    }
    expect(pulled, "the pull is an event").toMatchObject({ seats: 1, maxHp: e.orreryHp(1) });
  });
});
