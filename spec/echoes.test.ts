import { resolve } from "node:path";
import { afterEach, describe, expect, inject, it } from "vitest";
import { clock, engine, fighter, lobbyTable, sent, table, turn, type Battle, type Clock, type Engine, type Step } from "./engine.ts";
import {
  createRoom,
  join,
  joinRoom,
  newBattle,
  seatEcho,
  startRoom,
  sleep,
  suffix,
  token,
  watchRoom,
  type Event,
  type Watcher,
} from "./raid.ts";

// Echoes seated on purpose (docs/adr/007; CLAUDE.md rule 25). An Echo is the
// same automated character a timed-out seat becomes (rule 8), seated by
// someone in the room: one per role, at most four. It plays a fixed policy
// for its role, from that role's actions only and from what every client is
// sent, and every action it takes goes through the check a person's does, so
// it's refused exactly as a person is. It counts half a seat at the pull
// (rule 20), and every state marks it.

const base = inject("baseUrl");

/** Each role's actions, Brace first (protocol.ts ROLES; docs/design/overhaul.md). */
const CATALOGUE: Readonly<Record<string, readonly string[]>> = {
  warden: ["brace", "intercept", "anchor", "bastion", "counterweight"],
  mender: ["brace", "mend", "ward", "quicken", "restore"],
  striker: ["brace", "jab", "cleave", "finisher", "feint"],
  breaker: ["brace", "scan", "pry", "mark", "shatter"],
  chronist: ["brace", "delay", "haste", "relay", "stillpoint"],
};
const ROLES = Object.keys(CATALOGUE);
const EVERY_ACTION = new Set(Object.values(CATALOGUE).flat());

type Refusal = { status: number; error: string };

/** The engine, plus what rule 25 adds to it. */
interface EchoEngine extends Engine {
  /** Why `seatedBy` can't seat an Echo of `role` in this fight, or null to go ahead. */
  checkSeatEcho(b: Battle, seatedBy: string, role: string): Refusal | null;
  /** Seat an Echo (already checked). */
  seatEcho(b: Battle, who: { id: string; role: string; seatedBy: string }, clock: Clock): Step;
  /** The Echo picks its move by its role's policy and submits it like any action: the step, or the refusal a person would get. */
  echoMove(b: Battle, echoId: string, clock: Clock): Step | Refusal;
}

/** The engine with Echo seating, or a failure naming what isn't built yet. */
async function echoEngine(): Promise<EchoEngine> {
  const e = (await engine()) as unknown as Record<string, unknown>;
  const missing = ["checkSeatEcho", "seatEcho", "echoMove"].filter((name) => typeof e[name] !== "function");
  if (missing.length) throw new Error(`the battle engine doesn't export ${missing.join(", ")} yet (src/server/rules.ts)`);
  return e as unknown as EchoEngine;
}

const T0 = 3_000_000;
const PAST_BEAT = 3_500;

/**
 * A table with one person (`<role>-1` for each role given) and an Echo of
 * `role` seated by the first of them, the host, in a private room's lobby
 * before the host's Start: the one door an Echo has (rule 25; docs/adr/009).
 */
function withEcho(e: EchoEngine, role: string, people: string[] = ["mender"]): { b: Battle; echoId: string; seatedBy: string } {
  const seatedBy = `${people[0]}-1`;
  const echoId = `echo-${role}`;
  let lobby = e.createBattle("spec", false, 1_000_000);
  (lobby as Battle & { room: string | null }).room = "SPEC1";
  people.forEach((r, i) => (lobby = e.join(lobby, { id: `${r}-${i + 1}`, name: `${r} ${i + 1}`, role: r }, clock()).battle));
  expect(e.checkSeatEcho(lobby, seatedBy, role), `the host can seat a ${role} Echo in the lobby`).toBeNull();
  return { b: lobbyTable(e, people, [{ id: echoId, role }]), echoId, seatedBy };
}

/** The Echo's turn: on the plate, past its beat, played by the clock. */
function echoTurn(e: Engine, b: Battle, echoId: string): Step {
  const step = e.advance(e.plate(b, echoId, clock(T0)), clock(T0 + PAST_BEAT));
  if (!step) throw new Error(`${echoId} was on the plate past its beat and the clock did nothing`);
  return step;
}

/** The actions an Echo took in a step: its events whose kind is some role's action. */
const actionsBy = (s: Step, id: string) =>
  s.effects.events.filter((ev) => ev.actorId === id && EVERY_ACTION.has(ev.kind));

describe("an Echo is seated on purpose", () => {
  it("adding an Echo seats a character that acts on its own turn with its role's actions", async () => {
    const e = await echoEngine();
    for (const role of ROLES) {
      const { b, echoId, seatedBy } = withEcho(e, role);
      expect(fighter(b, echoId).echo, `a seated ${role} Echo is an Echo`).toBe(true);
      expect(sent(e, b).queue.find((t) => t.id === echoId), `the ${role} Echo is on the strip, marked, with who seated it`).toMatchObject({
        echo: true,
        seatedBy,
        role,
      });

      const step = echoTurn(e, b, echoId);
      const acted = actionsBy(step, echoId);
      expect(acted.length, `the ${role} Echo acts on its turn`).toBeGreaterThan(0);
      for (const ev of acted) expect(CATALOGUE[role], `a ${role} Echo uses a ${role}'s actions, not ${ev.kind}`).toContain(ev.kind);
      expect(fighter(step.battle, echoId).echo, `and is still an Echo after it`).toBe(true);
      const credited = step.effects.stats[echoId] ?? { turns: 0, damage: 0, healing: 0 };
      expect([credited.turns, credited.damage, credited.healing], `the ${role} Echo's turn is in nobody's record`).toEqual([0, 0, 0]);
      // Review R14: turns alone passed if the Echo's damage or healing went to the seater.
      const seater = step.effects.stats[seatedBy] ?? { turns: 0, damage: 0, healing: 0 };
      expect([seater.turns, seater.damage, seater.healing], "not even the record of whoever seated it").toEqual([0, 0, 0]);
    }
  });

  it("an Echo reads only what every client is sent", async () => {
    // Rule 25: a policy never reads anything a player can't see. Two fights
    // identical on the wire, differing only in what the server keeps back (the
    // rings' unscanned weaknesses and the Orrery's script), get the same move
    // from every role's Echo.
    const e = await echoEngine();
    const rotate: Record<string, string> = { ember: "frost", frost: "aether", aether: "ember" };
    for (const role of ROLES) {
      const { b, echoId } = withEcho(e, role);
      const twin = structuredClone(b);
      for (const r of twin.rings) if (r.weakness === null) r.element = rotate[r.element] ?? r.element;
      // And the Orrery's script, never sent (review R16): its place in the
      // rotation and the Alignment's count.
      const held = twin as unknown as { orreryScript: Record<string, unknown> | null };
      expect(held.orreryScript, "the pull has written the Orrery's script").not.toBeNull();
      // Every field of it, not two (re-review N9).
      held.orreryScript = {
        ...held.orreryScript,
        played: 7,
        phase: 3,
        periheliaFor: 3,
        lastPerihelion: 9,
        aligned: 2,
        aimedAt: { "card-90": "mender-1" },
        touchedBy: { "card-90": "mender-1" },
      };
      expect(sent(e, twin), "the twin is the same fight on the wire").toEqual(sent(e, b));
      const move = (s: Step) =>
        actionsBy(s, echoId).map((ev) => ({ kind: ev.kind, ringId: ev.ringId, targetId: ev.targetId, cardId: ev.cardId }));
      expect(move(echoTurn(e, twin, echoId)), `the ${role} Echo's move doesn't depend on what it can't see`).toEqual(
        move(echoTurn(e, b, echoId)),
      );
    }
  });

  it("a seat that times out becomes the same Echo, and plays its role's policy", async () => {
    // ADR-007: "the same automated character a timed-out player becomes". A
    // Breaker who misses three turns running plays a Breaker's actions, not a
    // plain blow no Breaker has. Only the engine's existing steps are needed.
    const e = await engine();
    let b = table(e, ["breaker", "warden"]);
    for (let i = 0; i < 3; i++) b = e.advance(e.plate(b, "breaker-1", clock()), clock(9_000_000 + i))!.battle;
    expect(fighter(b, "breaker-1").echo, "three timeouts in a row make an Echo").toBe(true);
    const step = echoTurn(e, b, "breaker-1");
    const acted = actionsBy(step, "breaker-1");
    expect(acted.length, "the Echo acts on its turn").toBeGreaterThan(0);
    for (const ev of acted) expect(CATALOGUE.breaker, `the timed-out Breaker's Echo plays a Breaker's action, not ${ev.kind}`).toContain(ev.kind);
  });
});

describe("each role's policy, branch by branch", () => {
  // Review R12: every policy test passed if all but the Striker always Braced,
  // since Brace is in every catalogue. Here each branch of ADR-007's policies
  // gets a state built for it, and the exact move it must make.

  /** The Echo's move on its turn: its action, and what it aimed at. */
  const moveOf = (e: Engine, b: Battle, id: string) => {
    const ev = actionsBy(echoTurn(e, b, id), id)[0];
    return ev ? { kind: ev.kind, ring: ev.ringId, target: ev.targetId ?? ev.toId, card: ev.cardId } : null;
  };
  /** A clone with no boss cards, then these announced (rule 19), so a test knows exactly what's on the strip. */
  const withCards = (e: Engine, b: Battle, cards: { intent: string; targetId: string | null; countdown: number }[]): Battle => {
    let next = structuredClone(b);
    next.cards = [];
    for (const c of cards) next = e.announce(next, { ...c, amount: c.intent === "retrograde" ? null : 10 });
    return next;
  };
  const edit = (b: Battle, change: (b: Battle) => void): Battle => {
    const next = structuredClone(b);
    change(next);
    return next;
  };
  const scanned = (b: Battle) => {
    for (const r of b.rings) r.weakness = r.element;
  };

  it("Warden: Counterweights, Bastions at three Resolve with no Charge; never Anchors a Lunge, even one from lethal", async () => {
    // ADR-011 (rule 25): the swap on Gravity is a person's answer, not an Echo's. Was: "Anchors a blow on an
    // ally one Lunge from lethal"; the Anchor is now the cost of not having a person in the Warden's seat.
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "warden", ["mender", "striker"]);
    const heavy = edit(withCards(e, b, [{ intent: "lunge", targetId: "mender-1", countdown: 1 }]), (x) => {
      x.standing.find((f) => f.id === "mender-1")!.gravity = 2;
    });
    expect(moveOf(e, heavy, echoId), "a Lunge on an ally at two Gravity: no Anchor, a Counterweight").toMatchObject({ kind: "counterweight" });
    const resolve = edit(withCards(e, b, []), (x) => (x.standing.find((f) => f.id === echoId)!.resource = 3));
    expect(moveOf(e, resolve, echoId), "three Resolve, no Charge: Bastion").toMatchObject({ kind: "bastion" });
    const charged = edit(resolve, (x) => (x.standing.find((f) => f.id === echoId)!.charge = 1));
    expect(moveOf(e, charged, echoId), "with Charge banked it never spends it: no Bastion").toMatchObject({ kind: "counterweight" });
  });

  it("an Echo takes no Reaction off its turn, whatever the strip holds (ADR-011, rule 25)", async () => {
    // Was: the Warden Echo Intercepted a blow about to land (and, M6, the one the server names). ADR-011: a
    // Reaction is a person's answer to a card; an Echo of any role takes none, even with one named for it.
    const e = await echoEngine();
    for (const role of ROLES) {
      const { b, echoId } = withEcho(e, role, ["mender", "striker"]);
      const board = withCards(e, b, [
        { intent: "eclipse", targetId: "mender-1", countdown: 0 },
        { intent: "lunge", targetId: echoId, countdown: 0 },
        { intent: "revolution", targetId: "party", countdown: 0 },
      ]);
      const plated = e.plate(board, "mender-1", clock(T0));
      const named = (sent(e, plated).queue as { id: string; reactionCard: string | null }[]).find((t) => t.id === echoId)?.reactionCard;
      expect(named, `the server names a card for the ${role} Echo's Reaction`).not.toBeNull();
      const step = e.advance(plated, clock(T0 + 10));
      expect(step?.effects.events.filter((ev) => ev.kind === "reaction") ?? [], `the ${role} Echo takes none`).toEqual([]);
    }
  });

  it("Mender: Wards the one a blow is aimed at, else Mends the lowest, else Quickens the next player", async () => {
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "mender", ["warden", "striker"]);
    const aimed = withCards(e, b, [{ intent: "eclipse", targetId: "striker-2", countdown: 1 }]);
    expect(moveOf(e, aimed, echoId), "a blow announced at the Striker: Ward the Striker").toMatchObject({ kind: "ward", target: "striker-2" });
    const hurt = edit(withCards(e, b, []), (x) => {
      x.standing.find((f) => f.id === "warden-1")!.hp -= 20; // 150/170
      x.standing.find((f) => f.id === "striker-2")!.hp -= 30; // 80/110, the lowest share
    });
    expect(moveOf(e, hurt, echoId), "no blow announced: Mend the lowest by share").toMatchObject({ kind: "mend", target: "striker-2" });
    const whole = withCards(e, b, []);
    const next = sent(e, e.plate(whole, echoId, clock(T0))).queue.find((t) => t.kind === "character" && t.id !== echoId)!.id;
    expect(moveOf(e, whole, echoId), "nobody hurt: Quicken the next player on the strip").toMatchObject({ kind: "quicken", target: next });
  });

  it("Striker: Finishes with three Momentum and no Charge, where the server aims it, else Jabs", async () => {
    // ADR-011 (rule 25): no ring of its own choosing, and never a Charge spent. The server's default Finisher
    // ring is a Broken one, so a Broken middle ring is still where it lands.
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "striker");
    const broken = edit(b, (x) => {
      x.rings[1].broken = true;
      x.rings[1].pips = 0;
      x.standing.find((f) => f.id === echoId)!.resource = 3;
    });
    expect(moveOf(e, broken, echoId), "a Broken middle ring and Momentum: Finish, and the server aims it there").toMatchObject({ kind: "finisher", ring: "middle" });
    const charged = edit(broken, (x) => {
      x.standing.find((f) => f.id === echoId)!.charge = 1;
    });
    expect(moveOf(e, charged, echoId), "with Charge banked it never spends it: Jab").toMatchObject({ kind: "jab" });
    const empty = edit(broken, (x) => {
      x.standing.find((f) => f.id === echoId)!.resource = 0;
    });
    expect(moveOf(e, empty, echoId), "no Momentum: Jab").toMatchObject({ kind: "jab" });
  });

  it("Breaker: Scans the unknown, Shatters at two pips, Marks a bare ring, else Pries, each at the server's default ring", async () => {
    // ADR-011 (rule 25): an Echo never chooses a ring; every move goes at the server's default (null), which is
    // the outermost ring where that action does something.
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "breaker");
    expect(moveOf(e, b, echoId), "every weakness unknown: Scan the outer ring").toMatchObject({ kind: "scan", ring: "outer" });
    const thin = edit(b, (x) => {
      scanned(x);
      x.rings[1].pips = 2;
      x.standing.find((f) => f.id === echoId)!.resource = 3;
    });
    expect(moveOf(e, thin, echoId), "all Scanned, the middle ring at two pips, Insight for it: Shatter it").toMatchObject({ kind: "shatter", ring: "middle" });
    const bare = edit(b, (x) => {
      scanned(x);
      x.rings[0].exposed = [{ appliedBy: "mender-1" }];
    });
    expect(moveOf(e, bare, echoId), "all Scanned, none thin: Mark, where the server aims it").toMatchObject({ kind: "mark" });
    const marked = edit(b, (x) => {
      scanned(x);
      for (const r of x.rings) r.exposed = [{ appliedBy: "mender-1" }];
    });
    expect(moveOf(e, marked, echoId), "every ring Marked: Pry the outermost toward Shatter's range").toMatchObject({ kind: "pry", ring: "outer" });
  });

  it("Chronist: Delays a boss card within two slots, but never a Retrograde, else Relays", async () => {
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "chronist", ["warden"]);
    const near = withCards(e, b, [
      { intent: "revolution", targetId: "party", countdown: 2 },
      { intent: "eclipse", targetId: "warden-1", countdown: 1 },
    ]);
    const soon = near.cards.find((c) => c.countdown === 1)!;
    expect(moveOf(e, near, echoId), "a card one slot out: Delay it").toMatchObject({ kind: "delay", card: soon.id });
    const far = withCards(e, b, [{ intent: "revolution", targetId: "party", countdown: 2 }]);
    expect(moveOf(e, far, echoId), "nothing within two slots: Relay").toMatchObject({ kind: "relay" });
    // ADR-011 (rule 25): cancelling a Retrograde is a person's answer.
    const turning = withCards(e, b, [{ intent: "retrograde", targetId: null, countdown: 0 }]);
    expect(moveOf(e, turning, echoId), "a Retrograde about to land: no Delay, a Relay").toMatchObject({ kind: "relay" });
  });

  it("an Echo never chooses a ring, never spends Charge, never swaps, never cancels (ADR-011, rule 25)", async () => {
    // Held on the policy itself, over many states, so a branch added later can't slip a person's answer in.
    const e = await echoEngine();
    const policy = (await import(resolve("src/server/echoes.ts"))) as { onTurn(s: unknown, id: string): { action: string; targetId: string | null } };
    const RING_ACTIONS = new Set(["jab", "cleave", "finisher", "feint", "counterweight", "scan", "pry", "mark", "shatter"]);
    const SIGNATURES = new Set(["bastion", "restore", "finisher", "shatter", "stillpoint"]);
    for (const role of ROLES) {
      const { b, echoId } = withEcho(e, role, ["mender", "striker"]);
      for (const charge of [0, 2]) {
        for (const cards of [
          [{ intent: "lunge", targetId: "mender-1", countdown: 0 }],
          [{ intent: "retrograde", targetId: null, countdown: 0 }],
          [{ intent: "eclipse", targetId: "striker-2", countdown: 1 }],
        ]) {
          const board = edit(withCards(e, b, cards), (x) => {
            const me = x.standing.find((f) => f.id === echoId)!;
            me.charge = charge;
            me.resource = 5;
            x.standing.find((f) => f.id === "mender-1")!.gravity = 2;
            for (const r of x.rings) r.weakness = r.element;
          });
          const move = policy.onTurn(sent(e, e.plate(board, echoId, clock(T0))), echoId);
          const what = `a ${role} Echo, Charge ${charge}, facing ${cards[0].intent}: ${move.action} ${move.targetId}`;
          if (RING_ACTIONS.has(move.action)) expect(move.targetId, `${what}: no ring of its own choosing`).toBeNull();
          if (charge > 0) expect(SIGNATURES.has(move.action), `${what}: no Charge spent`).toBe(false);
          expect(move.action, `${what}: no swap`).not.toBe("anchor");
          if (cards[0].intent === "retrograde") expect(["delay", "stillpoint"].includes(move.action), `${what}: no cancel`).toBe(false);
        }
      }
    }
  });

  it("a timed-out seat's Echo makes the same move as a seated Echo in its place", async () => {
    const e = await echoEngine();
    for (const role of ROLES) {
      const { b, echoId } = withEcho(e, role, ["warden", "striker"]);
      // The same seat, timed out instead of seated on purpose.
      const timedOut = edit(b, (x) => {
        const f = x.standing.find((t) => t.id === echoId)!;
        (f as unknown as { seatedBy: string | null }).seatedBy = null;
      });
      expect(moveOf(e, timedOut, echoId), `a ${role}: one policy, whoever's seat it is`).toEqual(moveOf(e, b, echoId));
    }
  });
});

describe("an Echo plays at low output", () => {
  it("deals and heals the Echo's share of what a person in its seat would", async () => {
    // Review R8: low output was held only for a Striker's Jab. Output is
    // potency, as the Chain's is: what an action deals and heals. An Echo's
    // other effects (a Ward, a Scan, a Delay) are its role's action's own.
    const e = await echoEngine();
    const share = (await import("../src/server/tuning.ts")).ECHO_POTENCY;
    expect(share, "an Echo's share is less than a person's").toBeLessThan(1);
    const asPerson = (b: Battle, id: string): Battle => {
      const next = structuredClone(b);
      next.standing.find((f) => f.id === id)!.echo = false;
      return next;
    };

    // A Warden Echo's Counterweight, against the same Counterweight by a person.
    const w = withEcho(e, "warden");
    const hp = (b: Battle) => fighter(b, "orrery").hp;
    const echoBlow = hp(w.b) - hp(echoTurn(e, w.b, w.echoId).battle);
    const personBlow = hp(w.b) - hp(turn(e, asPerson(w.b, w.echoId), w.echoId, "counterweight").battle);
    expect(echoBlow, "the Echo's blow is the person's at the Echo's share").toBe(Math.round(personBlow * share));

    // A Mender Echo's Mend on a hurt ally, against the same Mend by a person.
    const m = withEcho(e, "mender", ["warden"]);
    const hurt = structuredClone(m.b);
    hurt.cards = []; // no blow announced, so the policy Mends rather than Wards
    hurt.standing.find((f) => f.id === "warden-1")!.hp -= 100;
    const wardenHp = (b: Battle) => fighter(b, "warden-1").hp;
    const echoHeal = wardenHp(echoTurn(e, hurt, m.echoId).battle) - wardenHp(hurt);
    const personHeal = wardenHp(turn(e, asPerson(hurt, m.echoId), m.echoId, "mend", "warden-1").battle) - wardenHp(hurt);
    expect(echoHeal, "the Echo's Mend is the person's at the Echo's share").toBe(Math.round(personHeal * share));
  });
});

describe("an Echo seated on purpose waits for nobody", () => {
  it("is played on the next tick, with no reclaim beat", async () => {
    // Review R2: ADR-006 gives a timed-out seat's Echo a three-second beat so
    // its person can come back (and accepted that cost for it alone, ADR-002).
    // A seated Echo has no person, so a beat would stop the table for nobody:
    // one person and four Echoes would wait twelve seconds a cycle.
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "breaker");
    const onPlate = e.plate(b, echoId, clock(T0));
    expect(sent(e, onPlate).plateMs, "the client is told the seat's window is nothing").toBe(0);
    const step = e.advance(onPlate, clock(T0 + 1));
    expect(step, "a millisecond on, the server has played it").not.toBeNull();
    expect(actionsBy(step!, echoId).map((ev) => [ev.kind, ev.ringId]), "and the Echo acted: every weakness hidden, it Scans the outer ring").toEqual([
      ["scan", "outer"],
    ]);
    // A timed-out seat still waits for its person (spec/echo.test.ts).
    const timedOut = structuredClone(b);
    const f = timedOut.standing.find((x) => x.id === "mender-1")!;
    f.echo = true;
    expect(e.advance(e.plate(timedOut, "mender-1", clock(T0)), clock(T0 + 1)), "a timed-out seat's Echo still waits its beat").toBeNull();
  });
});

describe("a refused Echo is told why", () => {
  it("a second Echo of a role is refused for its role, even at four", async () => {
    // Breaker Q4: at the cap, a second Warden Echo was told the table was full,
    // not that it already had a Warden Echo.
    const e = await echoEngine();
    let b = e.createBattle("spec", false, 1_000_000);
    (b as Battle & { room: string | null }).room = "SPEC1";
    b = e.join(b, { id: "mender-1", name: "mender 1", role: "mender" }, clock()).battle;
    for (const role of ["warden", "mender", "striker", "breaker"]) {
      b = e.seatEcho(b, { id: `echo-${role}`, role, seatedBy: "mender-1" }, clock()).battle;
    }
    expect(e.checkSeatEcho(b, "mender-1", "warden")?.error, "a second Warden Echo: one per role").toMatch(/already a Warden Echo/);
    expect(e.checkSeatEcho(b, "mender-1", "chronist")?.error, "a fifth Echo of a new role: four at most").toMatch(/4 Echoes at most/);
  });
});

describe("an Echo gets no favours", () => {
  it("an Echo's out-of-turn action is refused exactly as a human's is", async () => {
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "breaker", ["warden", "striker"]);

    // Someone else's turn: the Warden is on the plate.
    const wardenUp = e.plate(b, "warden-1", clock());
    const person = e.checkAction(wardenUp, "striker-2", "brace", null);
    expect(person, "a person acting on someone else's turn is refused").toMatchObject({ status: 409 });
    const echo = e.echoMove(wardenUp, echoId, clock());
    expect("status" in echo ? echo : null, "an Echo acting on someone else's turn is refused, in the same words").toEqual(person);

    // Two at once (rule 10): the Warden has just taken the turn, and the plate is empty.
    const took = e.act(wardenUp, "warden-1", "brace", null, clock());
    expect(took.battle.activeId, "nobody is on the plate straight after the Warden's turn").toBeNull();
    const late = e.checkAction(took.battle, "striker-2", "brace", null);
    expect(late, "a person a moment late is told whose turn it was").toMatchObject({ status: 409 });
    const lateEcho = e.echoMove(took.battle, echoId, clock());
    expect("status" in lateEcho ? lateEcho : null, "and so is an Echo, word for word").toEqual(late);

    // On its own turn, the same call is a move.
    const own = e.echoMove(e.plate(b, echoId, clock()), echoId, clock());
    expect("status" in own ? own : null, "on its own turn the Echo's move goes through").toBeNull();
  });

  it("the clock's Echo turn goes through the check a person's does", async () => {
    // Review R13: in a real fight an Echo's policy only proposes legal moves, so
    // nothing showed the clock submitting them through checkAction rather than
    // performing them straight. A state play can't reach does: each ring shows
    // a weakness that isn't its element, so the Breaker's policy proposes a Pry
    // that checkAction refuses ("Pry needs the weakness revealed"). Through the
    // check, the Echo Braces instead; around it, the Pry would land.
    const e = await echoEngine();
    const { b, echoId } = withEcho(e, "breaker");
    const wrong: Record<string, string> = { ember: "frost", frost: "aether", aether: "ember" };
    const doctored = structuredClone(b);
    for (const r of doctored.rings) {
      r.weakness = wrong[r.element] ?? null;
      r.exposed = [{ appliedBy: "mender-1" }];
    }
    const step = echoTurn(e, doctored, echoId);
    const kinds = actionsBy(step, echoId).map((ev) => ev.kind);
    expect(kinds, "the refused Pry never lands").not.toContain("pry");
    expect(kinds, "the Echo Braces in its place, as the check leaves it").toEqual(["brace"]);
  });
});

describe("Echoes in a room, live", () => {
  const open: Watcher[] = [];
  afterEach(() => {
    for (const w of open.splice(0)) w.close();
  });

  async function hostedRoom(role = "warden") {
    const name = `host-${suffix()}`;
    const host = await join(base, await newBattle(base), name, role);
    const made = await createRoom(base, host.cookie);
    expect(made.status, "a seated player makes a room").toBe(201);
    const code = made.code as string;
    const seat = await joinRoom(base, code, name, role, host.cookie);
    expect(seat.status, "and sits down in it").toBe(200);
    const w = watchRoom(base, code);
    open.push(w);
    await w.opened;
    return { code, cookie: host.cookie, hostId: seat.characterId as string, battleId: made.battleId as string, w };
  }

  it("only someone seated in the room seats an Echo, and it acts on its own turn, as its role", async () => {
    const { code, cookie, hostId, w } = await hostedRoom();

    const outsider = await join(base, await newBattle(base), `outsider-${suffix()}`, "mender");
    expect((await seatEcho(base, code, outsider.cookie, "breaker")).status, "someone seated elsewhere can't seat an Echo here").toBe(403);
    expect((await seatEcho(base, code, "", "breaker")).status, "nor can someone seated nowhere").toBe(403);

    const seated = await seatEcho(base, code, cookie, "breaker");
    expect(seated.status, "someone in the room seats a Breaker Echo").toBe(201);
    const echoId = seated.echoId as string;
    const marked = await w.waitFor((st) => token(st, echoId) !== undefined, "the Echo on the strip", 5_000);
    expect(token(marked, echoId), "marked as an Echo, with who seated it").toMatchObject({ echo: true, seatedBy: hostId, role: "breaker" });

    expect((await startRoom(base, code, cookie)).status, "the host starts the fight").toBe(200);
    // The host's Start (rule 27), then the Echo's turn.
    let at = -1;
    for (const deadline = Date.now() + 35_000; at < 0; await sleep(50)) {
      at = w.messages.findIndex((m) => m.events.some((ev: Event) => ev.actorId === echoId && EVERY_ACTION.has(ev.kind)));
      if (Date.now() > deadline) throw new Error("waited 35s for the Breaker Echo to act");
    }
    const acted = w.messages[at].events.filter((ev: Event) => ev.actorId === echoId && EVERY_ACTION.has(ev.kind));
    for (const ev of acted) expect(CATALOGUE.breaker, `the Breaker Echo plays a Breaker's action, not ${ev.kind}`).toContain(ev.kind);
    expect(w.messages[at - 1]?.state.activeId, "it acted on its own turn: it was on the plate").toBe(echoId);
  }, 50_000);

  it("nobody can take an Echo's name, so nobody can keep a role's Echo out", async () => {
    // Breaker Q6: a person sitting down as "mender echo" stopped that table
    // ever seating a Mender Echo, because two at a table can't share a name.
    const { code, cookie } = await hostedRoom();
    const squatter = await joinRoom(base, code, " mender ECHO ", "striker");
    expect(squatter.status, "an Echo's name, however it's cased or padded, is kept for the Echo").toBe(409);
    expect((await seatEcho(base, code, cookie, "mender")).status, "so the Mender Echo can still be seated").toBe(201);
  }, 20_000);

  it("a fifth Echo is refused", async () => {
    const { code, cookie, w } = await hostedRoom();
    expect((await seatEcho(base, code, cookie, "warden")).status, "a Warden Echo").toBe(201);
    expect((await seatEcho(base, code, cookie, "warden")).status, "one Echo per role: a second Warden Echo is refused").toBe(409);
    for (const role of ["mender", "striker", "breaker"]) {
      expect((await seatEcho(base, code, cookie, role)).status, `a ${role} Echo`).toBe(201);
    }
    const fifth = await seatEcho(base, code, cookie, "chronist");
    expect(fifth.status, "four Echoes is the most a room seats: a fifth is refused").toBe(409);
    expect(fifth.error, "with a reason").toEqual(expect.any(String));

    // Four Echoes on the strip, and at the host's Start each counts half a seat (rule 20).
    expect((await startRoom(base, code, cookie)).status, "the host starts the fight").toBe(200);
    const pulled = await w.waitFor((st) => st.status === "fighting", "the pull", 25_000);
    expect(pulled.queue.filter((t) => t.echo === true).length, "four Echoes on the strip").toBe(4);
    expect(pulled.pullSeats, "one person and four Echoes: 1 + 4 × ½ seats").toBe(3);
  }, 40_000);
});
