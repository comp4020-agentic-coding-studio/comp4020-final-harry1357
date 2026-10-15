import { afterAll, describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase } from "./boot.ts";
import { bossTurn, engine, events, fighter, ring, table, turn } from "./engine.ts";
import { boss, join, newBattle, sleep, suffix, type BattleState } from "./raid.ts";

// The Orrery (CLAUDE.md rules 19-20; docs/design/overhaul.md, Priority 3).
// Its script is held on the pure engine, where a phase threshold or a third
// Gravity stack can be set up exactly. What crosses the wire (HP set at the
// pull, a late join leaving it alone) is held over HTTP. Committed red.

afterAll(cleanScratch);

describe("the Orrery's script", () => {
  it("crosses into phase II at 70% and phase III at 35%", async () => {
    const e = await engine();
    let b = table(e, ["striker", "breaker"]);
    expect(b.phase, "the fight opens in phase I").toBe(1);

    // Put the Orrery exactly on a threshold; any blow carries it below.
    const at = (fraction: number, phase: number) => {
      const next = structuredClone(b);
      const o = next.standing.find((f) => f.id === "orrery")!;
      o.hp = Math.ceil(o.maxHp * fraction);
      next.phase = phase;
      return next;
    };
    const two = turn(e, at(0.7, 1), "striker-1", "jab", "outer");
    expect(two.battle.phase, "below 70%: phase II").toBe(2);
    expect(events(two, "phase")[0], "crossing is an event").toMatchObject({ phase: 2 });

    const three = turn(e, at(0.35, 2), "striker-1", "jab", "outer");
    expect(three.battle.phase, "below 35%: phase III").toBe(3);
    expect(events(three, "phase")[0], "crossing is an event").toMatchObject({ phase: 3 });
  });

  it("announces every boss attack on the strip as a card before it resolves", async () => {
    const e = await engine();
    const b = table(e, ["warden", "striker"]);
    const step = bossTurn(e, b);
    const resolved = step.effects.events.filter((x) => ["revolution", "eclipse", "lunge", "perihelion", "retrograde", "alignment"].includes(x.kind));
    expect(resolved.length, "the Orrery did something on its turn").toBeGreaterThan(0);
    for (const hit of resolved) {
      expect(b.cards.some((c) => c.intent === hit.kind), `"${hit.kind}" resolved without its card on the strip beforehand`).toBe(true);
    }
    const cards = [...b.cards, ...events(step, "card").map((c) => c.card as { intent: string; targetId: unknown; countdown: unknown })];
    expect(cards.length, "the Orrery keeps at least one card on the strip").toBeGreaterThan(0);
    for (const card of cards) {
      expect(card, "a card carries an intent, a target and a countdown").toMatchObject({
        intent: expect.any(String),
        countdown: expect.any(Number),
      });
      expect("targetId" in card, "a card names its target (or null)").toBe(true);
    }
  });

  it("Perihelion is announced four slots ahead, with 3 + squads shield pips on the outer ring (one squad)", async () => {
    const e = await engine();
    let b = table(e, ["striker", "breaker", "warden"]);
    b = e.announce(b, { intent: "perihelion", targetId: "party", amount: 40, countdown: 4 });
    const card = b.cards.find((c) => c.intent === "perihelion");
    expect(card?.countdown, "four slots ahead").toBe(4);
    expect(ring(b, "outer").maxPips, "3 pips, plus 1 for the one squad").toBe(4);
  });

  it("Gravity is lethal at three stacks unless a second Warden Anchors the Lunge", async () => {
    const e = await engine();
    const setUp = () => {
      let b = table(e, ["warden", "warden", "striker"]);
      const next = structuredClone(b);
      next.standing.find((f) => f.id === "warden-1")!.gravity = 3;
      b = e.announce(next, { intent: "lunge", targetId: "warden-1", amount: 30, countdown: 0 });
      return b;
    };

    const unanswered = bossTurn(e, setUp());
    const fell = unanswered.battle.fallen.some((f) => f.id === "warden-1") || fighter(unanswered.battle, "warden-1").hp === 0;
    expect(fell, "a Lunge on three Gravity stacks, unanswered, is lethal").toBe(true);
    expect(events(unanswered, "gravity")[0], "and says so").toMatchObject({ targetId: "warden-1", lethal: true, anchoredBy: null });

    const b = setUp();
    const card = b.cards.find((c) => c.intent === "lunge")!;
    const anchored = turn(e, b, "warden-2", "anchor", card.id);
    expect(anchored.battle.cards.find((c) => c.id === card.id)?.targetId, "Anchor pulls the Lunge onto the second Warden").toBe("warden-2");
    const after = bossTurn(e, anchored.battle);
    expect(fighter(after.battle, "warden-1").hp, "the first Warden survives").toBeGreaterThan(0);
    expect(events(after, "gravity")[0] ?? { lethal: false }, "nothing lethal happened").toMatchObject({ lethal: false });
  });

  it("Retrograde flips the next five slots, unless a Chronist Delays it", async () => {
    const e = await engine();
    const setUp = () => e.announce(table(e, ["chronist", "striker", "warden", "mender", "breaker"]), {
      intent: "retrograde",
      targetId: null,
      amount: null,
      countdown: 0,
    });

    const b = setUp();
    const before = b.standing.filter((f) => f.id !== "orrery").slice(0, 5).map((f) => f.id);
    const flipped = bossTurn(e, b);
    const after = flipped.battle.standing.filter((f) => f.id !== "orrery").slice(0, 5).map((f) => f.id);
    expect(after, "the next five slots, reversed").toEqual([...before].reverse());
    expect(events(flipped, "retrograde")[0], "the flip is an event").toMatchObject({ flipped: true, cancelledBy: null });

    const card = setUp().cards.find((c) => c.intent === "retrograde")!;
    const delayed = turn(e, setUp(), "chronist-1", "delay", card.id);
    expect(delayed.battle.cards.find((c) => c.id === card.id)?.countdown, "Delay pushes it back a slot").toBe(1);
  });

  it("Retrograde is cancelled outright by a Chronist's Stillpoint", async () => {
    const e = await engine();
    let b = e.announce(table(e, ["chronist", "striker", "warden"]), { intent: "retrograde", targetId: null, amount: null, countdown: 0 });
    const next = structuredClone(b);
    next.standing.find((f) => f.id === "chronist-1")!.resource = 5;
    b = next;
    const card = b.cards.find((c) => c.intent === "retrograde")!;
    const frozen = turn(e, b, "chronist-1", "stillpoint", card.id);
    expect(frozen.battle.cards.find((c) => c.id === card.id)?.frozen, "Stillpoint freezes the card").toBe(true);
    const order = frozen.battle.standing.map((f) => f.id);
    const after = bossTurn(e, frozen.battle);
    expect(events(after, "retrograde").filter((x) => x.flipped === true), "a frozen Retrograde flips nothing").toEqual([]);
    expect(after.battle.standing.filter((f) => f.id !== "orrery").map((f) => f.id).slice(0, 2), "the order holds").toEqual(
      order.filter((id) => id !== "orrery").slice(0, 2),
    );
  });
});

describe("the Orrery's hit points", () => {
  it("five seats give less than five times one seat's HP, but more than one seat's", async () => {
    const e = await engine();
    expect(e.orreryHp(5), "sub-linear: a bigger room is slightly favoured").toBeLessThan(5 * e.orreryHp(1));
    expect(e.orreryHp(5), "but a room of five still faces more than one person does").toBeGreaterThan(e.orreryHp(1));
    expect(e.orreryHp(5) / e.orreryHp(1), "base × seats^0.75").toBeCloseTo(5 ** 0.75, 1);
  });

  it("four Echoes and one person count for less than five people", async () => {
    const e = await engine();
    let b = table(e, ["striker", "warden", "mender", "breaker", "chronist"]);
    const people = e.seatsOf(b);
    const next = structuredClone(b);
    for (const f of next.standing) if (f.kind === "character" && f.id !== "striker-1") f.echo = true;
    b = next;
    expect(people, "five people are five seats").toBe(5);
    expect(e.seatsOf(b), "an Echo is half a seat: 1 + 4 × ½").toBe(3);
    expect(e.orreryHp(e.seatsOf(b)), "so less HP than five people").toBeLessThan(e.orreryHp(people));
  });
});

describe("HP is set at the pull, over the wire", () => {
  async function until(base: string, battleId: string, test: (s: BattleState & { pullSeats?: number }) => boolean, what: string) {
    for (const deadline = Date.now() + 15_000; ; await sleep(20)) {
      const s = (await (await fetch(new URL(`/api/battles/${battleId}`, base))).json()) as BattleState & { pullSeats?: number };
      if (test(s)) return s;
      if (Date.now() > deadline) throw new Error(`waited 15s for ${what}; the battle is ${s.status}`);
    }
  }

  it("a join during a running fight leaves max HP unchanged, and the next fight re-scales", async () => {
    // 20 ms ticks: the pull's countdown is long enough for two joins to land inside it.
    const server = await boot(scratchDatabase(), { TICK_MS: "20" });
    try {
      const battleId = await newBattle(server.base);
      const s = suffix();
      expect((await join(server.base, battleId, `first-${s}`, "striker")).status).toBe(200);
      expect((await join(server.base, battleId, `second-${s}`, "warden")).status).toBe(200);
      const running = await until(server.base, battleId, (st) => st.status === "fighting" && (st.pullSeats ?? 0) > 0, "the pull");
      const pulled = boss(running)?.maxHp;
      expect(running.pullSeats, "the pull counted the seats present").toBe(2);

      expect((await join(server.base, battleId, `late-${s}`, "mender")).status, "a late joiner still gets a seat").toBe(200);
      const after = await until(server.base, battleId, (st) => st.queue.some((t) => t.name === `late-${s}`), "the late joiner on the strip");
      expect(boss(after)?.maxHp, "a late joiner doesn't change a running fight's HP").toBe(pulled);

      // The next fight, with the same three, is pulled for three.
      const next = await newBattle(server.base);
      for (const [name, role] of [[`first-${s}`, "striker"], [`second-${s}`, "warden"], [`late-${s}`, "mender"]] as const) {
        expect((await join(server.base, next, `${name}-again`, role)).status).toBe(200);
      }
      const rescaled = await until(server.base, next, (st) => (st.pullSeats ?? 0) === 3, "the next fight's pull");
      expect(boss(rescaled)?.maxHp, "the next fight re-scales to the room").toBeGreaterThan(pulled ?? 0);
    } finally {
      await server.kill();
    }
  }, 45_000);
});
