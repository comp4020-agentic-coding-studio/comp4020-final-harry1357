import { describe, expect, it } from "vitest";
import { clock, engine, fighter, table, type Battle, type Engine } from "./engine.ts";

// The Echo's beat (docs/adr/006, "The Echo", as amended by ADR-007; CLAUDE.md
// rule 8). A timed-out seat's Echo is a seat the server plays after three
// timeouts in a row. When it reaches the plate, the person gets a three-second
// beat: any action from them in it reclaims the seat and plays as theirs;
// otherwise the server plays the Echo. (An Echo seated on purpose has no person
// and no beat: spec/echoes.test.ts.) Off its turn an Echo takes only a Reaction,
// as anyone may (rule 18), so rule 2 stands. And an Echo's turn is the Echo's:
// logged as the Echo's, never counted in the person's record.

const BEAT_MS = 3_000;
const T0 = 2_000_000;

/** A table with striker-1 an Echo, sitting on the plate at T0. */
function echoOnPlate(e: Engine): Battle {
  let b = table(e, ["striker", "warden"]);
  const next = structuredClone(b);
  const s = next.standing.find((f) => f.id === "striker-1")!;
  s.echo = true;
  s.timeouts = 3;
  b = next;
  return e.plate(b, "striker-1", clock(T0));
}

describe("the Echo's beat", () => {
  it("gives the person three seconds on the plate before the server plays the Echo", async () => {
    const e = await engine();
    const b = echoOnPlate(e);
    expect(b.activeId, "the Echo's seat is on the plate").toBe("striker-1");
    // Inside the beat the server waits: nothing is played for them yet.
    const waiting = e.advance(b, clock(T0 + BEAT_MS - 500));
    expect(waiting, "half a second short of three, the server doesn't play the Echo").toBeNull();
  });

  it("an action from the person in the beat reclaims the seat and plays as theirs", async () => {
    const e = await engine();
    const b = echoOnPlate(e);
    const ok = e.checkAction(b, "striker-1", "jab", "outer");
    expect("status" in ok ? ok : null, "the person can act on their Echo's turn, in the beat").toBeNull();
    const step = e.act(b, "striker-1", "jab", "outer", clock(T0 + 1_000));
    expect(fighter(step.battle, "striker-1").echo, "acting in the beat ends the Echo").toBe(false);
    expect(step.effects.stats["striker-1"]?.turns, "and the turn is theirs, counted in their record").toBe(1);
    const jab = step.effects.events.find((x) => x.kind === "jab" && x.actorId === "striker-1");
    expect(jab, "it plays as the person's own Jab").toBeDefined();
  });

  it("with no action in the beat, the server plays the Echo", async () => {
    const e = await engine();
    const b = echoOnPlate(e);
    const step = e.advance(b, clock(T0 + BEAT_MS + 500));
    expect(step, "three seconds on, the server plays the Echo").not.toBeNull();
    const played = step!.effects.events.filter((x) => x.actorId === "striker-1" && x.kind !== "plate");
    expect(played.length, "the Echo takes its turn").toBeGreaterThan(0);
    expect(played.some((x) => x.kind === "hold"), "an Echo's turn isn't a timeout").toBe(false);
    expect(fighter(step!.battle, "striker-1").echo, "and it's still an Echo").toBe(true);
  });

  it("an Echo's turn is the Echo's: never counted in the person's record", async () => {
    const e = await engine();
    const b = echoOnPlate(e);
    const step = e.advance(b, clock(T0 + BEAT_MS + 500))!;
    const record = step.effects.stats["striker-1"] ?? { turns: 0, damage: 0, healing: 0, wins: 0, losses: 0 };
    expect(record.turns, "an Echo's turn doesn't add to the person's turns").toBe(0);
    expect(record.damage, "or to the damage they're credited with").toBe(0);
    const line = step.battle.log.findLast((l) => l.actorId === "striker-1");
    expect(line?.text, "the log says it was the Echo").toMatch(/Echo/);
  });

  it("the beat's length comes from the clock, and the client is told the plate's real window", async () => {
    // Review R7: a fixed 3 s no env could shorten made every Echo turn in a
    // fast spec cost 3 s. Review R8: the client drew the beat as a full turn
    // already 75% gone, because only turnMs was sent.
    const e = await engine();
    let b = table(e, ["striker", "warden"]);
    const next = structuredClone(b);
    next.standing.find((f) => f.id === "striker-1")!.echo = true;
    b = next;
    const fast = { now: T0, turnMs: 12_000, beatMs: 200 };
    const onPlate = e.plate(b, "striker-1", fast);
    expect(e.advance(onPlate, { ...fast, now: T0 + 150 }), "inside a 200 ms beat the server still waits").toBeNull();
    expect(e.advance(onPlate, { ...fast, now: T0 + 250 }), "past it, the server plays the Echo").not.toBeNull();
    // view() is handed the same timing the server runs on, beat included.
    const sent = e.view(onPlate, { tickMs: 150, turnMs: 12_000, beatMs: 200 } as { tickMs: number; turnMs: number }) as { plateMs?: number };
    expect(sent.plateMs, "the client is sent the Echo's beat, not the person's twelve seconds").toBe(200);
  });

  it("an Echo seat at the end isn't credited the win or the loss", async () => {
    // Review F4 (re-review): Echo turns are never counted in the person's
    // record, and the outcome is the record's clearest line. A seat that is an
    // Echo when the fight ends didn't see it through.
    const e = await engine();
    let b = table(e, ["striker", "warden"]);
    const next = structuredClone(b);
    next.standing.find((f) => f.id === "striker-1")!.echo = true;
    next.standing.find((f) => f.id === "orrery")!.hp = 1; // one blow from the end
    b = next;
    const won = e.act(e.plate(b, "warden-2", clock(T0)), "warden-2", "counterweight", "outer", clock(T0));
    expect(won.battle.status, "the Warden's blow ends the fight").toBe("won");
    expect(won.effects.stats["warden-2"]?.wins, "the person who saw it through wins").toBe(1);
    expect(won.effects.stats["striker-1"]?.wins ?? 0, "the Echo seat is credited no win").toBe(0);
  });
});
