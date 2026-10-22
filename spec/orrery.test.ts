import { afterAll, describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase } from "./boot.ts";
import { announced, bossTurn, engine, events, fighter, ring, table, turn } from "./engine.ts";
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

    // Pin each line from both sides: a blow that leaves the Orrery one HP above
    // the line keeps the phase, and one that takes it a HP below crosses. A
    // line set anywhere else fails one side or the other.
    const jab = (() => {
      const probe = turn(e, b, "striker-1", "jab", "outer");
      return events(probe, "jab")[0]!.amount as number;
    })();
    const setTo = (hp: number, phase: number) => {
      const next = structuredClone(b);
      next.standing.find((f) => f.id === "orrery")!.hp = hp;
      next.phase = phase;
      return next;
    };
    const max = b.standing.find((f) => f.id === "orrery")!.maxHp;
    for (const [fraction, from, to] of [[0.7, 1, 2], [0.35, 2, 3]] as const) {
      const line = Math.ceil(max * fraction); // the lowest HP still at or above the line
      const stays = turn(e, setTo(line + jab, from), "striker-1", "jab", "outer");
      expect(stays.battle.phase, `a Jab that leaves it on ${line} (${fraction * 100}%) keeps phase ${from}`).toBe(from);
      expect(events(stays, "phase"), "and announces no crossing").toEqual([]);
      const crosses = turn(e, setTo(line + jab - 1, from), "striker-1", "jab", "outer");
      expect(crosses.battle.phase, `a Jab that takes it to ${line - 1}, below ${fraction * 100}%, enters phase ${to}`).toBe(to);
      expect(events(crosses, "phase")[0], "crossing is an event").toMatchObject({ phase: to });
    }
  });

  it("announces every boss attack on the strip as a card before it resolves", async () => {
    const e = await engine();
    const b = table(e, ["warden", "striker"]);
    const MOVES = ["revolution", "eclipse", "lunge", "perihelion", "retrograde", "alignment"];
    // Exactly the cards that were due resolve: one move per card at countdown
    // 0 and not frozen, each of that card's intent. Nothing extra lands, and
    // nothing not yet due goes off early.
    const due = b.cards.filter((c) => c.countdown === 0 && !c.frozen).map((c) => c.intent).sort();
    expect(due.length, "a card was due on the Orrery's turn").toBeGreaterThan(0);
    const step = bossTurn(e, b);
    const resolved = step.effects.events.filter((x) => MOVES.includes(x.kind)).map((x) => x.kind).sort();
    expect(resolved, "the moves resolved are exactly the cards that were due, by intent").toEqual(due);

    // Every card the Orrery put up this turn was announced with a card event,
    // carrying its intent, target and countdown.
    const before = new Set(b.cards.map((c) => c.id));
    const added = step.battle.cards.filter((c) => !before.has(c.id));
    const announcedIds = new Set(events(step, "card").map((x) => (x.card as { id: string }).id));
    expect(added.length, "the Orrery keeps the strip filled with cards").toBeGreaterThan(0);
    for (const card of added) {
      expect(announcedIds.has(card.id), `card ${card.id} (${card.intent}) went up without a card event`).toBe(true);
      expect(card, "a card carries an intent, a target and a countdown").toMatchObject({ intent: expect.any(String), countdown: expect.any(Number) });
      expect("targetId" in card, "a card names its target (or null)").toBe(true);
    }
  });

  it("holds the card rule on every turn of a long fight, through all three phases", async () => {
    // Review R11: one phase-I turn sees only a Revolution. Here the Orrery is
    // walked down through phases II and III, and on every one of its turns
    // exactly the due cards resolve and every new card is announced.
    const e = await engine();
    let b = table(e, ["warden", "striker", "mender", "breaker", "chronist"]);
    const MOVES = ["revolution", "eclipse", "lunge", "perihelion", "retrograde", "alignment"];
    const seen = new Set<string>();
    const phases = new Set<number>();
    for (let turnNo = 0; turnNo < 60 && b.status === "fighting"; turnNo++) {
      // Keep the party standing, and walk the Orrery's HP down a little each turn.
      const next = structuredClone(b);
      for (const f of next.standing) if (f.kind === "character") f.hp = f.maxHp;
      const o = next.standing.find((f) => f.id === "orrery")!;
      o.hp = Math.max(1, Math.round(o.maxHp * (1 - (turnNo + 1) / 70)));
      if (o.hp < o.maxHp * 0.7 && next.phase < 2) next.phase = 2;
      if (o.hp < o.maxHp * 0.35 && next.phase < 3) next.phase = 3;
      b = next;
      phases.add(b.phase);

      const due = b.cards.filter((c) => c.countdown === 0 && !c.frozen).map((c) => c.intent).sort();
      const before = new Set(b.cards.map((c) => c.id));
      const step = bossTurn(e, b);
      const resolved = step.effects.events.filter((x) => MOVES.includes(x.kind)).map((x) => x.kind).sort();
      expect(resolved, `turn ${turnNo} (phase ${b.phase}): the moves resolved are exactly the cards that were due`).toEqual(due);
      for (const k of resolved) seen.add(k);
      const announcedIds = new Set(events(step, "card").map((x) => (x.card as { id: string }).id));
      for (const card of step.battle.cards.filter((c) => !before.has(c.id))) {
        expect(announcedIds.has(card.id), `turn ${turnNo}: card ${card.id} (${card.intent}) went up without a card event`).toBe(true);
      }
      b = step.battle;
    }
    expect([...phases].sort(), "the walk reached all three phases").toEqual([1, 2, 3]);
    for (const move of ["revolution", "eclipse", "lunge", "perihelion", "retrograde", "alignment"]) {
      expect(seen.has(move), `the walk saw a ${move} resolve, so the rule was held for it`).toBe(true);
    }
  });

  it("Perihelion is announced four slots ahead, with 3 + squads shield pips on the outer ring (one squad)", async () => {
    const e = await engine();
    let b = table(e, ["striker", "breaker", "warden"]);
    b = e.announce(b, { intent: "perihelion", targetId: "party", amount: 40, countdown: 4 });
    const card = announced(b);
    expect(card?.countdown, "four slots ahead").toBe(4);
    expect(ring(b, "outer").maxPips, "3 pips, plus 1 for the one squad").toBe(4);
  });

  it("a card whose target has fallen lands on nobody: it never re-aims at someone no card named", async () => {
    const e = await engine();
    for (const intent of ["eclipse", "lunge"] as const) {
      let b = table(e, ["striker", "warden", "mender"]);
      b = e.announce(b, { intent, targetId: "striker-1", amount: 40, countdown: 0 });
      // The named target falls before the card resolves.
      const next = structuredClone(b);
      const gone = next.standing.find((f) => f.id === "striker-1")!;
      next.standing = next.standing.filter((f) => f !== gone);
      next.fallen.push({ ...gone, hp: 0 });
      b = next;
      const before = Object.fromEntries(b.standing.map((f) => [f.id, f.hp]));
      const step = bossTurn(e, b);
      const struck = events(step, intent).filter((x) => x.targetId !== undefined && x.targetId !== "striker-1");
      expect(struck, `a ${intent} aimed at a fallen striker struck someone else instead`).toEqual([]);
      // Review R1: and the event says it landed on nobody, so the screen can
      // draw it passing over rather than as a hit on the fallen.
      const passed = events(step, intent).find((x) => x.targetId === "striker-1");
      expect(passed, `the spent ${intent} is still announced`).toBeDefined();
      expect(passed?.spent, `the spent ${intent} says it was spent, not a hit`).toBe(true);
      for (const id of ["warden-2", "mender-3"]) {
        const took = (before[id] ?? 0) - fighter(step.battle, id).hp;
        const named = step.effects.events
          .filter((x) => x.kind !== intent)
          .flatMap((x) => (Array.isArray(x.hits) ? (x.hits as { targetId: string; amount: number }[]).filter((h) => h.targetId === id).map((h) => h.amount) : x.targetId === id && typeof x.amount === "number" && x.actorId === "orrery" ? [x.amount] : []));
        expect(took, `${id} took a ${intent} meant for someone else`).toBe(named.reduce((n, a) => n + a, 0));
      }
    }
  });

  it("the Lunge that brings Gravity to three isn't lethal; the next one is (the design record's reading)", async () => {
    const e = await engine();
    // docs/design/overhaul.md: "At 3 stacks the next Lunge is lethal". The
    // Lunge that makes the third stack is an ordinary blow.
    const lungeOn = (stacks: number) => {
      const b = table(e, ["warden", "striker", "mender"]);
      const next = structuredClone(b);
      const w = next.standing.find((f) => f.id === "warden-1")!;
      w.gravity = stacks;
      w.hp = w.maxHp; // full, so only lethality can fell them
      return bossTurn(e, e.announce(next, { intent: "lunge", targetId: "warden-1", amount: 20, countdown: 0 }));
    };
    const third = lungeOn(2);
    expect(fighter(third.battle, "warden-1").hp, "the Lunge that makes three stacks leaves them standing").toBeGreaterThan(0);
    expect(fighter(third.battle, "warden-1").gravity, "and they now carry three").toBe(3);
    expect(events(third, "gravity").filter((x) => x.lethal === true), "nothing lethal yet").toEqual([]);

    const fourth = lungeOn(3);
    const fell = fourth.battle.fallen.some((f) => f.id === "warden-1") || fighter(fourth.battle, "warden-1").hp === 0;
    expect(fell, "at three stacks, the next Lunge is lethal").toBe(true);
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
    const card = announced(b);
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

    const fresh = setUp();
    const card = announced(fresh);
    const delayed = turn(e, fresh, "chronist-1", "delay", card.id);
    expect(delayed.battle.cards.find((c) => c.id === card.id)?.countdown, "Delay pushes it back a slot").toBe(1);

    // And the point of it: a Delayed Retrograde never flips the strip. A Delay
    // only moves it a slot, so follow the card through the Orrery's turns until
    // it is off the strip, not just the next one, and no turn may flip.
    let cur = delayed.battle;
    const flips: unknown[] = [];
    for (let i = 0; i < 4 && cur.cards.some((c) => c.id === card.id); i++) {
      const next = bossTurn(e, cur);
      flips.push(...events(next, "retrograde").filter((x) => x.flipped === true));
      cur = next.battle;
    }
    expect(cur.cards.some((c) => c.id === card.id), "the Delayed Retrograde has left the strip").toBe(false);
    expect(flips, "and at no point did it flip the strip").toEqual([]);
  });

  it("Retrograde is cancelled outright by a Chronist's Stillpoint", async () => {
    const e = await engine();
    let b = e.announce(table(e, ["chronist", "striker", "warden"]), { intent: "retrograde", targetId: null, amount: null, countdown: 0 });
    const next = structuredClone(b);
    next.standing.find((f) => f.id === "chronist-1")!.resource = 5;
    b = next;
    const card = announced(b);
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

  it("a join during a running fight grows max HP with its share kept, and the next fight re-scales", async () => {
    // Rule 20 as ADR-009 amends it: a late joiner raises the Orrery to the
    // curve for the seats now present, its percentage kept. 20 ms ticks: the
    // ready window is long enough for two joins to land inside it.
    const server = await boot(scratchDatabase(), { TICK_MS: "20" });
    try {
      const battleId = await newBattle(server.base);
      const s = suffix();
      expect((await join(server.base, battleId, `first-${s}`, "striker")).status).toBe(200);
      expect((await join(server.base, battleId, `second-${s}`, "warden")).status).toBe(200);
      const running = await until(server.base, battleId, (st) => st.status === "fighting" && (st.pullSeats ?? 0) > 0, "the pull");
      const pulled = boss(running)?.maxHp;
      expect(running.pullSeats, "the pull counted the seats present").toBe(2);

      const share = (st: BattleState) => (boss(st)?.hp ?? 0) / (boss(st)?.maxHp ?? 1);
      const before = await until(server.base, battleId, (st) => st.status === "fighting", "the fight");
      expect((await join(server.base, battleId, `late-${s}`, "mender")).status, "a late joiner still gets a seat").toBe(200);
      const after = await until(server.base, battleId, (st) => st.queue.some((t) => t.name === `late-${s}`), "the late joiner on the strip");
      expect(boss(after)?.maxHp, "a late joiner grows the running fight's HP to the curve for three").toBe((await engine()).orreryHp(3));
      expect(Math.abs(share(after) - share(before)), "with the share it stood at kept (within a blow or two)").toBeLessThan(0.1);
      void pulled;

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
