import { describe, expect, it } from "vitest";
import { clock, engine, type Battle, type Engine } from "./engine.ts";

// The pull (docs/adr/006, "The pull"; CLAUDE.md rule 20). The Orrery's HP is
// set once, at the pull, from the seats present, so the room needs a moment to
// sit down first. The countdown starts at the first seat and restarts to ten
// seconds whenever someone new sits down, but never runs past thirty seconds
// from the first seat: after that it pulls regardless, so a steady trickle of
// arrivals can't hold the fight off for ever.
//
// It is counted in seconds on the clock the caller supplies, not in ticks: a
// tick is 150 ms live and 5 ms in a fast spec, and the countdown must be ten
// seconds either way. The engine is pure, so the clock is injected here.

const RESTART_MS = 10_000;
const CAP_MS = 30_000;
const T0 = 1_000_000;

/** Seat one character at `at`. */
function sit(e: Engine, b: Battle, n: number, at: number): Battle {
  return e.join(b, { id: `seat-${n}`, name: `Seat ${n}`, role: "striker" }, clock(at)).battle;
}

/** Run the clock to `at`, in 150 ms ticks as the live server would; the battle as it stands then. */
function runTo(e: Engine, b: Battle, from: number, at: number): Battle {
  for (let now = from; now <= at; now += 150) b = e.advance(b, clock(now))?.battle ?? b;
  return b;
}

describe("the pull", () => {
  it("waits ten seconds from the first seat, then pulls", async () => {
    const e = await engine();
    let b = sit(e, e.createBattle("pull", false, T0), 1, T0);
    expect(b.status, "nobody is fought the moment they sit down").toBe("waiting");

    b = runTo(e, b, T0, T0 + RESTART_MS - 500);
    expect(b.status, "still seating, half a second short of ten").toBe("waiting");
    b = runTo(e, b, T0 + RESTART_MS - 500, T0 + RESTART_MS + 500);
    expect(b.status, "ten seconds on, the Orrery wakes").toBe("fighting");
    expect(b.pullSeats, "pulled for the one seat present").toBe(1);
  });

  it("restarts to ten seconds when a new seat joins during the countdown", async () => {
    const e = await engine();
    let b = sit(e, e.createBattle("pull", false, T0), 1, T0);
    b = runTo(e, b, T0, T0 + 8_000);
    b = sit(e, b, 2, T0 + 8_000);

    // Without the restart it would pull at T0 + 10 s; with it, not before T0 + 18 s.
    b = runTo(e, b, T0 + 8_000, T0 + 17_500);
    expect(b.status, "the second seat bought the room another ten seconds").toBe("waiting");
    b = runTo(e, b, T0 + 17_500, T0 + 18_500);
    expect(b.status, "ten seconds after the last seat, it pulls").toBe("fighting");
    expect(b.pullSeats, "counting both").toBe(2);
  });

  it("pulls at thirty seconds from the first seat regardless, however many keep arriving", async () => {
    const e = await engine();
    let b = sit(e, e.createBattle("pull", false, T0), 1, T0);
    // A new seat every eight seconds would restart a plain countdown for ever.
    let n = 2;
    let now = T0;
    for (const at of [8_000, 16_000, 24_000]) {
      b = runTo(e, b, now, T0 + at);
      b = sit(e, b, n++, T0 + at);
      now = T0 + at;
    }
    b = runTo(e, b, now, T0 + CAP_MS - 500);
    expect(b.status, "the last arrival at 24 s would push it to 34 s, but not past the cap yet").toBe("waiting");
    b = runTo(e, b, T0 + CAP_MS - 500, T0 + CAP_MS + 500);
    expect(b.status, "at thirty seconds from the first seat it pulls anyway").toBe("fighting");
    expect(b.pullSeats, "with everyone who had sat down").toBe(4);
  });

  it("announces the pull as an event, so the screen can show it before the log does", async () => {
    const e = await engine();
    let b = sit(e, e.createBattle("pull", false, T0), 1, T0);
    let pulled: { kind: string; seats?: unknown; maxHp?: unknown } | undefined;
    for (let now = T0; now <= T0 + RESTART_MS + 500 && !pulled; now += 150) {
      const step = e.advance(b, clock(now));
      if (!step) continue;
      b = step.battle;
      pulled = step.effects.events.find((x) => x.kind === "pull");
    }
    expect(pulled, "the pull is an event").toMatchObject({ seats: 1, maxHp: e.orreryHp(1) });
  });
});
