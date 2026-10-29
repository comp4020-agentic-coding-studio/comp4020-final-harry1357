import { beforeAll, describe, expect, it } from "vitest";
import { announced, bossTurn, clock, engine, events, fighter, table, turn, type Battle } from "./engine.ts";
import { competent, expert, loadReactions, naive, type Policy } from "./difficulty/policies.ts";
import { engine as tableEngine, play, rooms, ROLES, type Seat } from "./difficulty/table.ts";

// The Orrery can kill you (ADR-011; CLAUDE.md rule 33). Difficulty is the
// cost of not knowing the mechanics, measured, not felt: three scripted
// players per role (./difficulty/policies.ts) play the thirty-one rooms of one
// to five distinct roles on the pure engine, deterministic and with no wall
// clock (./difficulty/table.ts), and the targets are ADR-011's. The tuning
// values are ours and live in src/server/tuning.ts; this file holds the
// targets, never the values.
//
// Each tooth is one spec below that names the mechanic and the seat it
// downs, so the fight can later say what killed you.

/** Whole fights played out: a few seconds alone, more under a parallel roster. */
const WHOLE_FIGHTS_MS = 120_000;
const edit = (b: Battle, change: (b: Battle) => void): Battle => {
  const next = structuredClone(b);
  change(next);
  return next;
};
const clearCards = (b: Battle): Battle => edit(b, (x) => (x.cards = []));
const down = (b: Battle, id: string): boolean => b.fallen.some((f) => f.id === id) || fighter(b, id).hp === 0;

describe("the teeth: what an unanswered card costs, and the seat it costs", () => {
  it("Gravity: a Lunge on an unbraced, unswapped seat already carrying Gravity downs that seat", async () => {
    const e = await engine();
    const lunge = (prep: (x: Battle) => void) =>
      bossTurn(e, e.announce(clearCards(edit(table(e, ["striker", "warden"]), prep)), { intent: "lunge", targetId: "striker-1", amount: 20, countdown: 0 }));
    const carried = (x: Battle) => (x.standing.find((f) => f.id === "striker-1")!.gravity = 2);

    const unmet = lunge(carried);
    expect(down(unmet.battle, "striker-1"), "the Striker, Gravity 2, unbraced and unswapped: downed").toBe(true);
    expect(events(unmet, "gravity")[0], "and the fight says Gravity did it, to the Striker").toMatchObject({ targetId: "striker-1", lethal: true });

    const braced = lunge((x) => {
      carried(x);
      x.standing.find((f) => f.id === "striker-1")!.braced = true;
    });
    expect(down(braced.battle, "striker-1"), "Braced, it stands").toBe(false);

    // Swapped: the second Warden Anchors it, and a Lunge a Warden takes on purpose is never lethal.
    let b = clearCards(edit(table(e, ["striker", "warden"]), (x) => (x.standing.find((f) => f.id === "warden-2")!.gravity = 2)));
    b = e.announce(b, { intent: "lunge", targetId: "striker-1", amount: 20, countdown: 1 });
    const anchored = turn(e, b, "warden-2", "anchor", announced(b).id);
    const after = bossTurn(e, bossTurn(e, anchored.battle).battle);
    expect(down(after.battle, "warden-2"), "a Warden at Gravity 2 who swaps the Lunge onto themself stands").toBe(false);
  });

  it("Gravity is counted as it stood when the Orrery's turn began: two Lunges on one turn can't stack and crush (the gate's T2)", async () => {
    const e = await engine();
    let b = clearCards(edit(table(e, ["striker", "warden"]), (x) => (x.standing.find((f) => f.id === "striker-1")!.gravity = 1)));
    b = e.announce(b, { intent: "lunge", targetId: "striker-1", amount: 10, countdown: 0 });
    b = e.announce(b, { intent: "lunge", targetId: "striker-1", amount: 10, countdown: 0 });
    const step = bossTurn(e, b);
    expect(down(step.battle, "striker-1"), "one stack carried in: the second Lunge of the turn is an ordinary blow").toBe(false);
    expect(events(step, "gravity").filter((x) => x.lethal === true), "nothing lethal").toEqual([]);
  });

  it("Perihelion: unmet, it deals its full amount to every seat, and that downs them", async () => {
    const e = await engine();
    const roles = ["warden", "mender", "striker", "breaker", "chronist"];
    const b = clearCards(table(e, roles));
    const card = { intent: "perihelion", targetId: "party", amount: null as number | null, countdown: 0 };
    // The script's own amount, as the Orrery announces it at the pull.
    const strip = table(e, roles).cards.find((c) => c.intent === "perihelion");
    expect(strip, "the Orrery announces a Perihelion at the pull").toBeTruthy();
    const peri = strip!.amount as number;
    const hit = bossTurn(e, e.announce(b, { ...card, amount: peri }));
    const landed = events(hit, "perihelion")[0] as unknown as { hits: { targetId: string; amount: number }[] };
    for (const id of roles.map((r, i) => `${r}-${i + 1}`)) {
      expect(landed.hits.find((h) => h.targetId === id)?.amount, `${id} takes Perihelion's full ${peri}`).toBe(peri);
      expect(down(hit.battle, id), `and ${id} is downed by it`).toBe(true);
    }
    // Met: the Breaker Shatters the outer ring under the scripted Perihelion, and the server cuts what it will
    // deal (the gate's W1: the amount is read off the server, never set by the test).
    const ready = edit(e.announce(b, { ...card, amount: peri }), (x) => {
      x.rings.find((r) => r.id === "outer")!.pips = 2;
      x.standing.find((f) => f.id === "breaker-4")!.resource = 3;
    });
    const shattered = turn(e, ready, "breaker-4", "shatter", "outer");
    const cut = shattered.battle.cards.find((c) => c.intent === "perihelion")!;
    expect(cut.amount, "a Break cuts the Perihelion to an eighth").toBe(Math.floor(peri / 8));
    const lands = edit(shattered.battle, (x) => {
      x.cards = x.cards.filter((c) => c.id === cut.id);
      x.cards[0].countdown = 0;
    });
    const met = bossTurn(e, lands);
    expect(roles.every((r, i) => !down(met.battle, `${r}-${i + 1}`)), "met by a Break: every seat stands").toBe(true);
  });

  it("Retrograde: uncancelled, it costs the table a full rotation of the strip", async () => {
    const e = await engine();
    const b = e.announce(clearCards(table(e, ["warden", "mender", "striker"])), { intent: "retrograde", targetId: null, amount: null, countdown: 0 });
    const party = (x: Battle) => x.standing.filter((f) => f.kind === "character");
    // The waits as they stand when the Orrery takes its turn (on the plate: everyone else's lead taken off).
    const plated = e.plate(b, "orrery", clock());
    const before = Object.fromEntries(party(plated).map((f) => [f.id, f.counter]));
    const turned = bossTurn(e, b);
    const ev = events(turned, "retrograde")[0] as unknown as { setBack: number; flipped: boolean };
    expect(ev.flipped, "it flips").toBe(true);
    // A full rotation: every seat's wait grows by at least the slowest seat's Standard turn.
    const slowest = Math.max(...party(b).map((f) => 3 * (f.agility >= 62 ? 5 : f.agility >= 44 ? 6 : f.agility >= 29 ? 8 : 9)));
    expect(ev.setBack, "a whole rotation of the strip").toBeGreaterThanOrEqual(slowest);
    // After the flip every seat carries one of the waits that stood before it, plus the rotation: so the
    // soonest any seat now comes round is a whole rotation later than the soonest did before.
    const soonest = (x: Battle) => Math.min(...party(x).map((f) => f.counter));
    expect(soonest(turned.battle), "the table's next turn is a whole rotation further off").toBeGreaterThanOrEqual(Math.min(...Object.values(before)) + ev.setBack);
    expect(fighter(turned.battle, "orrery").counter, "and the Orrery's next turn comes before any seat's").toBeLessThan(soonest(turned.battle));
    // Cancelled by a Chronist's Delay, the table loses nothing.
    const c = e.announce(clearCards(table(e, ["chronist", "striker"])), { intent: "retrograde", targetId: null, amount: null, countdown: 1 });
    const delayed = turn(e, c, "chronist-1", "delay", announced(c).id);
    let cur = delayed.battle;
    const setBacks: number[] = [];
    for (let i = 0; i < 4; i++) {
      const step = bossTurn(e, cur);
      setBacks.push(...events(step, "retrograde").map((x) => Number(x.setBack)));
      cur = step.battle;
    }
    expect(setBacks.every((x) => x === 0), "a Delayed Retrograde comes apart and sets nobody back").toBe(true);
  });

  it("Eclipse: on a seat that isn't Warded, it downs it", async () => {
    const e = await engine();
    const shadow = (prep: (x: Battle) => void) =>
      bossTurn(e, e.announce(clearCards(edit(table(e, ["warden", "mender"]), prep)), { intent: "eclipse", targetId: "warden-1", amount: 10, countdown: 0 }));
    const bare = shadow(() => undefined);
    expect(down(bare.battle, "warden-1"), "the Warden, 170 HP, unwarded: downed by a 10-point Eclipse").toBe(true);
    expect(events(bare, "eclipse")[0], "and the fight says the Eclipse did it").toMatchObject({ targetId: "warden-1" });
    // Braced (the gate's T1): halved as an ordinary blow, and the seat stands.
    const braced = shadow((x) => (x.standing.find((f) => f.id === "warden-1")!.braced = true));
    expect(down(braced.battle, "warden-1"), "Braced, it stands").toBe(false);
    expect(events(braced, "eclipse")[0], "taking half").toMatchObject({ targetId: "warden-1", amount: 5 });
    const warded = shadow((x) => (x.standing.find((f) => f.id === "warden-1")!.warded = true));
    expect(down(warded.battle, "warden-1"), "Warded, it stands untouched").toBe(false);
    expect(fighter(warded.battle, "warden-1").hp, "for nothing").toBe(fighter(table(e, ["warden", "mender"]), "warden-1").hp);
  });

  it("the Grand Alignment's third card wipes, as before", async () => {
    const e = await engine();
    let b = clearCards(table(e, ["warden", "mender", "striker"]));
    for (let i = 0; i < 3; i++) b = bossTurn(e, e.announce(clearCards(b), { intent: "alignment", targetId: "party", amount: null, countdown: 0 })).battle;
    expect(b.status, "the third Alignment ends the fight").toBe("lost");
  });
});

describe("the targets, over the thirty-one rooms (ADR-011)", () => {
  type Run = { won: number; wipedBeforeIII: number; lost: string[] };
  const results: Partial<Record<"naive" | "competent" | "expert", Run>> = {};
  let e: Awaited<ReturnType<typeof tableEngine>>;

  beforeAll(async () => {
    await loadReactions();
    e = await tableEngine();
    const comp = await competent();
    for (const [name, policy] of [["naive", naive], ["competent", comp], ["expert", expert]] as [keyof typeof results, Policy][]) {
      const run: Run = { won: 0, wipedBeforeIII: 0, lost: [] };
      for (const roles of rooms()) {
        const f = play(e, roles.map((role) => ({ role, policy })));
        if (f.outcome === "won") run.won++;
        else run.lost.push(`${roles.join("/")} (${f.outcome} at Orrery turn ${f.bossTurns}, phase ${f.phase})`);
        if (f.outcome === "lost" && f.phase < 3) run.wipedBeforeIII++;
      }
      results[name] = run;
    }
  }, WHOLE_FIGHTS_MS);

  it("there are thirty-one rooms: every set of distinct roles, one to five seats", () => {
    expect(rooms().length).toBe(31);
    expect(new Set(rooms().map((r) => r.join("/"))).size).toBe(31);
  });

  it("a naive table wipes before phase III in at least 25 of 31", () => {
    expect(results.naive!.wipedBeforeIII, `naive: ${results.naive!.wipedBeforeIII} wiped before phase III`).toBeGreaterThanOrEqual(25);
  });

  it("a competent table (the Echo's policy at a person's output) wins between 10 and 20 of 31", () => {
    const won = results.competent!.won;
    expect(won, `competent won ${won}`).toBeGreaterThanOrEqual(10);
    expect(won, `competent won ${won}`).toBeLessThanOrEqual(20);
  });

  it("an expert table wins at least 25 of 31", () => {
    expect(results.expert!.won, `expert won ${results.expert!.won}; lost: ${results.expert!.lost.join("; ")}`).toBeGreaterThanOrEqual(25);
  });
});

describe("a solo table needs its player (ADR-011; ADR-007's floor)", () => {
  const brace: Policy = { onTurn: () => ({ action: "brace", targetId: null }), offTurn: () => null };
  const echoesFor = (role: string): Seat[] => ROLES.filter((r) => r !== role).map((r) => ({ role: r, policy: "echo" }));

  it("a solo Brace-only person with four Echoes wipes before phase III, in every role", async () => {
    const e = await tableEngine();
    for (const role of ROLES) {
      const f = play(e, [{ role, policy: brace }, ...echoesFor(role)]);
      expect(f.outcome, `a Brace-only ${role} with four Echoes`).toBe("lost");
      expect(f.phase, `and the ${role}'s table fell in phase ${f.phase}, at Orrery turn ${f.bossTurns}`).toBeLessThan(3);
    }
  }, WHOLE_FIGHTS_MS);

  it("a solo expert with four Echoes wins, in every role", async () => {
    await loadReactions();
    const e = await tableEngine();
    for (const role of ROLES) {
      const f = play(e, [{ role, policy: expert }, ...echoesFor(role)]);
      expect(f.outcome, `an expert ${role} with four Echoes (Orrery turn ${f.bossTurns}, downs ${f.downs.map((d) => `${d.id}:${d.by}`).join(" ")})`).toBe("won");
    }
  }, WHOLE_FIGHTS_MS);
});

describe("the policies play by the rules every person does", () => {
  it("a scripted player's every move goes through checkAction; an Echo takes no Reaction", async () => {
    await loadReactions();
    const e = await tableEngine();
    const f = play(e, [{ role: "mender", policy: expert }, ...ROLES.filter((r) => r !== "mender").map((role) => ({ role, policy: "echo" as const }))], 30);
    const reactors = new Set(f.events.filter((ev) => ev.kind === "reaction").map((ev) => String(ev.actorId)));
    expect([...reactors], "only the person reacted").toEqual(["p0"]);
  }, WHOLE_FIGHTS_MS);
});
