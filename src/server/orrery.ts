// The Orrery (docs/design/overhaul.md, Priority 3; CLAUDE.md rules 19-20).
// Area (c) owns this file: its HP at the pull, its three phases, its rings
// with their shield pips and weaknesses, and its script, every move announced
// on the strip as a card before it resolves.
//
// Nothing here decides turn order (rule 1). The Orrery's own counter is reset
// by rules.ts; the only counters touched here are Retrograde's, which swaps
// the next five portraits' waits so the strip genuinely runs backwards when
// rules.ts re-sorts it.
//
// THE CARD MODEL. b.cards is the strip's boss cards, soonest first. A card's
// countdown is how many Orrery turns until it resolves; 0 resolves on the
// Orrery's next turn. Each Orrery turn:
//   1. a Retrograde that a Chronist has Delayed or frozen comes apart;
//   2. every card at 0 that isn't frozen resolves, in strip order;
//   3. every other card counts down by 1, except a frozen one, which skips the
//      cycle and thaws (Stillpoint: "freeze one boss card for a full cycle");
//   4. the script tops the strip up: the next AHEAD Orrery turns (countdown 0
//      to 2) always hold a card, and a Perihelion goes up PERIHELION_LEAD
//      slots ahead on entering each phase.
// The script fills its slots every turn whatever the room did, so a Delay
// can't stall the Orrery forever: pushing its next card back empties this
// turn and doubles up the next. Delay buys time; it doesn't erase damage.
//
// THE SCRIPT, phase by phase (rotations below, in SCRIPT):
//   I   Outer Ring (100-70%): Revolution, Lunge, Revolution, Eclipse,
//       Revolution. A Perihelion at the pull teaches Break: the outer ring's
//       shield.
//   II  Conjunction (70-35%): Lunge, Revolution, Retrograde, Eclipse,
//       Revolution, Lunge. More Lunges (the Gravity Well's tank swap), and the
//       strip starts to turn. A Perihelion on entry.
//   III Grand Alignment (<35%): Eclipse, Revolution, Lunge, Revolution, with every
//       ALIGNMENT_EVERY-th card an Alignment. The ALIGNMENT_STEPS-th Alignment
//       to resolve is the wipe: the visible enrage. A Perihelion on entry.
//   Any phase that runs PERIHELION_AGAIN Orrery turns without one gets another.
//   THE ENRAGE (ADR-010; the owner's ruling on L1): past ENRAGE_AFTER Orrery
//   turns, whatever the phase, the Grand Alignment begins as it does in phase
//   III. It is the Orrery's answer to a table that only defends: no fight may
//   be endless.
//
// Judgement calls, so the integrator can see them in one place:
//
// - Shield pips are set in rings(), so the waiting room already shows them:
//   outer 3 + SQUADS = 4, middle 5, inner 6. The outer ring is re-shielded to
//   its 4 (and un-Broken) whenever a Perihelion is announced, so every
//   Perihelion is a fresh Break check. Middle and inner, once Broken, stay so.
// - Weaknesses: outer ember, middle frost, inner aether, hidden until a
//   Breaker Scans (roles.ts counts a weakness only once it's revealed).
// - Lethal Gravity (ADR-011's first tooth): a Lunge on someone already
//   carrying GRAVITY_LETHAL stacks takes all their HP, unless it was swapped,
//   Braced or Warded; the Lunge that makes that stack is an ordinary blow. A
//   Ward takes it (and is spent). A Brace halves it as an ordinary blow. A
//   swap (a Warden's Anchor or Intercept: `swapped`) lands it as an ordinary
//   blow: a blow a Warden takes on purpose is never lethal. The stack lands
//   either way.
// - Eclipse (ADR-011's fourth tooth): on a seat that isn't Warded or Braced,
//   it takes everything. A Ward takes it; a Brace halves it as an ordinary
//   blow; a swapped Eclipse lands on its Warden as an ordinary blow.
// - An uncancelled Retrograde (ADR-011's third tooth) costs the table a full
//   rotation: after the flip, every seat's counter is set back by the slowest
//   standing seat's Standard reset, the same for all, so the flipped order
//   holds. The Orrery's counter isn't touched: the table is slowed, the
//   Orrery isn't hastened (rule 13).
// - Weaknesses re-hide and reshuffle at each phase change (ADR-011): every
//   ring's weakness hidden again and the three elements dealt anew, by a
//   rotation fixed by the phase and the pull's seats (no randomness, ADR-001),
//   never the same as before.
// - The well holds one body at a time: when a Lunge lands, everyone else's
//   Gravity falls to 0. That's what makes Anchor a real tank swap. The Lunge
//   aims at whoever holds the most Gravity, else the highest HP.
// - A "gravity" event is raised for a lethal Lunge, and for any Lunge that
//   landed on someone it wasn't aimed at when announced (an Anchor, or an
//   Intercept, which is a Warden taking it too): anchoredBy names them.
// - Retrograde is cancelled outright by a Chronist's Delay or Stillpoint, as
//   the design record says ("A Chronist's Delay or Stillpoint cancels it"):
//   the touched card stays on the strip, pushed or frozen, until the Orrery's
//   next turn, when it comes apart with cancelledBy naming the Chronist. Any
//   other card frozen by Stillpoint just skips a cycle.
// - A single-target card whose target has fallen or left is spent on nobody:
//   it never re-aims at someone no card named (rule 19; review F8).
// - A Break pushes the soonest unfrozen card back a slot (Octopath), and a
//   Break of the outer ring halves the pending Perihelion on the strip, so the
//   number the room sees is the number that lands.
// - Bastion takes BASTION_CUT off the next raid-wide card, Revolution or
//   Perihelion, and is spent by it. The Alignment's wipe ignores it.
//
// What the script remembers between turns (its place in the rotation, who
// touched which card, how far the Alignment has come) is carried on the
// battle's declared `orreryScript` (rules.ts), so it survives each step's
// structuredClone. view() builds the wire state field by field, so it is
// never sent.

import { BOSS_ID, type BossCard, type Intent, type RingId } from "../shared/protocol.ts";
import * as roles from "./roles.ts";
import { downTheFallen, harm, listNames, type Battle, type Ctx, type Fighter, type RingState } from "./rules.ts";
import { counterReset } from "./ctb.ts";
import {
  ALIGNMENT_EVERY,
  CARD_DAMAGE,
  ENRAGE_AFTER,
  GRAVITY_LETHAL,
  HP_EXPONENT,
  ORRERY_BASE_HP,
  PERIHELION_BASE_PIPS,
  PERIHELION_LEAD,
  PHASE_THREE_BELOW,
  PHASE_TWO_BELOW,
  RETROGRADE_SLOTS,
  SQUADS,
} from "./tuning.ts";

export const NAME = "The Orrery";
/** Tick speed 7: a rank-3 reset is 21 ticks, slower than every role but the Warden. */
export const AGILITY = 40;

// --- numbers the design record doesn't give --------------------------------
// Ours, to playtest (docs/design/overhaul.md, Caveats). Candidates for tuning.ts.

type Phase = 1 | 2 | 3;
type Dealt = "revolution" | "eclipse" | "lunge" | "perihelion";

/** What each card deals before mitigation, in phases I, II and III, before CARD_DAMAGE (tuning.ts) scales it. */
const AMOUNT: Readonly<Record<Dealt, readonly [number, number, number]>> = {
  // ADR-011: a Revolution is chip, not the threat; the teeth are the cards a table must answer.
  revolution: [4, 5, 6],
  eclipse: [20, 24, 28],
  lunge: [16, 20, 24],
  // ADR-011's second tooth: unmet, more than any seat's HP; a Break takes it to an eighth, a Bastion 60% off.
  perihelion: [360, 360, 360],
};
/** The rotation of ordinary cards in each phase. Phase III's every ALIGNMENT_EVERY-th is an Alignment instead. */
const SCRIPT: Readonly<Record<Phase, readonly Intent[]>> = {
  // ADR-011: one Eclipse and one Lunge in each rotation, a Revolution between, so a Mender can meet each shadow.
  1: ["revolution", "lunge", "revolution", "eclipse", "revolution"],
  2: ["lunge", "revolution", "retrograde", "eclipse", "revolution", "lunge"],
  3: ["eclipse", "revolution", "lunge", "revolution"],
};
/** The middle and inner rings' shields. The outer ring's is the record's 3 + squads. */
const MIDDLE_PIPS = 5;
const INNER_PIPS = 6;
/** How many Orrery turns ahead the strip always holds a card: countdown 0, 1 and 2 (ADR-011: was 2; a third slot
 *  gives a Mender a turn between a shadow's announcing and its landing). Ours. */
const AHEAD = 3;
/** Alignments that resolve before the wipe: the countdown runs 2, 1, then 0 is the wipe. */
const ALIGNMENT_STEPS = 3;
/** ADR-011: a Break divides a pending Perihelion by this (the design record's 2, steeper). Ours. */
const BREAK_PERIHELION = 8;
/** A phase that runs this many Orrery turns without a Perihelion gets another. */
const PERIHELION_AGAIN = 8;

const PHASE_NAME: Readonly<Record<Phase, string>> = { 1: "the Outer Ring", 2: "Conjunction", 3: "the Grand Alignment" };

// --- what rules.ts calls -----------------------------------------------------

/** Base × seats^0.75 (rule 20). An Echo's half seat is counted by rules.ts seatsOf. */
export function orreryHp(seats: number): number {
  return Math.round(ORRERY_BASE_HP * Math.max(1, seats) ** HP_EXPONENT);
}

/** The three rings at the start of a fight, outermost first, shields up, weaknesses hidden. */
export function rings(): RingState[] {
  const outer = PERIHELION_BASE_PIPS + SQUADS;
  return [
    { id: "outer", pips: outer, maxPips: outer, weakness: null, element: "ember", broken: false, exposed: [] },
    { id: "middle", pips: MIDDLE_PIPS, maxPips: MIDDLE_PIPS, weakness: null, element: "frost", broken: false, exposed: [] },
    { id: "inner", pips: INNER_PIPS, maxPips: INNER_PIPS, weakness: null, element: "aether", broken: false, exposed: [] },
  ];
}

/** The fight has just begun: lay out the opening cards, a Perihelion among them. */
export function onPull(ctx: Ctx): void {
  plan(ctx);
}

/** The Orrery has just taken damage: say so if it crossed a phase line. Phases only advance. */
export function onWound(ctx: Ctx): void {
  const boss = ctx.orrery();
  if (boss.hp <= 0) return; // the fight is over; finish() says so
  const share = boss.hp / boss.maxHp;
  const lines: readonly [2 | 3, number][] = [
    [2, PHASE_TWO_BELOW],
    [3, PHASE_THREE_BELOW],
  ];
  for (const [phase, below] of lines) {
    if (ctx.b.phase >= phase || share >= below) continue;
    ctx.b.phase = phase;
    reshuffle(ctx.b, phase);
    ctx.say(
      "boss",
      BOSS_ID,
      phase === 2
        ? `The Orrery falls below ${pct(below)}. Its rings lock into ${PHASE_NAME[2]}, and the strip begins to turn.`
        : script(ctx.b).enraged
          ? `The Orrery falls below ${pct(below)}. ${cap(PHASE_NAME[3])}, already begun by the clock, goes on.`
          : `The Orrery falls below ${pct(below)}. ${cap(PHASE_NAME[3])} begins: every ${nth(ALIGNMENT_EVERY)} card brings it closer.`,
      { kind: "phase", actorId: BOSS_ID, phase, name: PHASE_NAME[phase], reshuffled: true },
    );
  }
}

/** Put a card on the strip (rule 19). A Perihelion raises the outer ring's shield for the Break check. */
export function announce(ctx: Ctx, card: Omit<BossCard, "id" | "frozen">): void {
  const placed: BossCard = { ...card, id: `card-${ctx.b.nextCard++}`, frozen: false };
  ctx.b.cards.push(placed);
  sortCards(ctx.b);
  script(ctx.b).aimedAt[placed.id] = placed.targetId;
  if (placed.intent === "perihelion") {
    const outer = ctx.ring("outer");
    outer.maxPips = PERIHELION_BASE_PIPS + SQUADS;
    outer.pips = outer.maxPips;
    outer.broken = false;
  }
  ctx.emit({ kind: "card", actorId: BOSS_ID, card: { ...placed } });
}

/** The Orrery's turn: resolve what's due, count the rest down, and top the strip up. */
export function takeTurn(ctx: Ctx): void {
  const { b } = ctx;
  const s = script(b);
  b.bossTurns += 1;

  // 1. A Retrograde a Chronist touched comes apart.
  for (const card of b.cards.filter((c) => c.intent === "retrograde" && c.id in s.touchedBy)) {
    const by = s.touchedBy[card.id];
    b.cards = b.cards.filter((c) => c !== card);
    forget(s, card.id);
    ctx.say("boss", BOSS_ID, `The Orrery's Retrograde comes apart: ${b.joined[by] ?? "a Chronist"} threw its gears out of true. The strip holds.`, {
      kind: "retrograde",
      actorId: BOSS_ID,
      flipped: false,
      cancelledBy: by,
      cardId: card.id,
      slots: [],
      setBack: 0,
    });
  }

  // 2. Everything due resolves, in strip order. Gravity counts as it stood before this turn (ADR-011): two Lunges
  //    landing on one turn (a Delay can double one up) can't make a stack and crush with it before anyone acts.
  const due = b.cards.filter((c) => c.countdown <= 0 && !c.frozen);
  b.cards = b.cards.filter((c) => !due.includes(c));
  s.gravityBefore = Object.fromEntries(ctx.party().map((f) => [f.id, f.gravity]));
  for (const card of due) {
    if (ctx.party().length > 0) resolve(ctx, card);
    forget(s, card.id);
  }

  // 3. The rest count down; a frozen card skips this cycle and thaws.
  for (const card of b.cards) {
    if (card.frozen) card.frozen = false;
    else card.countdown = Math.max(0, card.countdown - 1);
  }
  sortCards(b);

  // 4. The script tops the strip up.
  plan(ctx);
}

// --- for the other areas -----------------------------------------------------

/** Strip shield pips from a ring, never below 0; at 0 it Breaks. */
export function stripPips(ctx: Ctx, ringId: RingId, pips: number, by: Fighter): void {
  const ring = ctx.ring(ringId);
  if (ring.broken) return;
  ring.pips = Math.max(0, ring.pips - Math.max(0, pips));
  if (ring.pips === 0) breakRing(ctx, ringId, by);
}

/**
 * Break a ring: its shield is gone, the soonest unfrozen card is pushed back a
 * slot, and a Break of the outer ring halves the pending Perihelion.
 */
export function breakRing(ctx: Ctx, ringId: RingId, by: Fighter): void {
  const ring = ctx.ring(ringId);
  if (ring.broken) return;
  ring.pips = 0;
  ring.broken = true;
  const pushed = nextCard(ctx, (c) => !c.frozen);
  if (pushed) push(ctx.b, pushed, 1);
  const perihelion = ringId === "outer" ? nextCard(ctx, (c) => c.intent === "perihelion") : undefined;
  // ADR-011: a Break is how a table meets Perihelion, so it takes three quarters off (the design record's half, steeper).
  if (perihelion?.amount) perihelion.amount = Math.floor(perihelion.amount / BREAK_PERIHELION);
  const consequences = [
    pushed ? `its ${label(pushed.intent)} slips back a slot` : null,
    perihelion ? `Perihelion's heat falls to ${perihelion.amount}` : null,
  ].filter((x): x is string => x !== null);
  ctx.say(
    "boss",
    BOSS_ID,
    `The Orrery's ${ringId} ring breaks under ${by.name}${consequences.length ? `: ${consequences.join(", and ")}` : ""}.`,
    { kind: "break", actorId: BOSS_ID, ringId, by: by.id },
  );
}

/** Push a card back `slots` Orrery turns (Delay). roles.ts says so; this only moves it. */
export function delayCard(ctx: Ctx, cardId: string, slots: number, by: Fighter): void {
  const card = ctx.b.cards.find((c) => c.id === cardId);
  if (!card) return;
  push(ctx.b, card, slots);
  script(ctx.b).touchedBy[card.id] = by.id;
}

/** Freeze a card for one Orrery turn (Stillpoint): it neither resolves nor counts down, then thaws. */
export function freezeCard(ctx: Ctx, cardId: string, by: Fighter): void {
  const card = ctx.b.cards.find((c) => c.id === cardId);
  if (!card) return;
  card.frozen = true;
  script(ctx.b).touchedBy[card.id] = by.id;
}

/** Aim a card at someone else (Anchor). */
export function retargetCard(ctx: Ctx, cardId: string, toId: string): void {
  const card = ctx.b.cards.find((c) => c.id === cardId);
  if (card) card.targetId = toId;
}

/** A Warden took this card on purpose (Anchor, Intercept): it lands as an ordinary blow, never lethal (ADR-011). */
export function swapped(ctx: Ctx, cardId: string): void {
  script(ctx.b).swapped[cardId] = true;
}

/** The three elements, dealt to the rings outer first, rotated by `shift`. */
const ELEMENTS: readonly RingState["element"][] = ["ember", "frost", "aether"];

/**
 * A new phase (ADR-011): every ring's weakness hidden again, and the elements dealt anew by a rotation of
 * one or two places, fixed by the phase and the pull's seats, so it is never the same as before and is the
 * same every run of the same room.
 */
function reshuffle(b: Battle, phase: number): void {
  const shift = 1 + ((phase + Math.round(b.pullSeats * 2)) % 2);
  const at = b.rings.map((r) => ELEMENTS.indexOf(r.element));
  b.rings.forEach((r, i) => {
    r.element = ELEMENTS[(at[i] + shift) % ELEMENTS.length];
    r.weakness = null;
  });
}

/** Whether the Grand Alignment has begun: phase III, or the enrage past ENRAGE_AFTER Orrery turns (ADR-010). */
const aligning = (b: Battle): boolean => b.phase === 3 || b.bossTurns >= ENRAGE_AFTER;

/** How many Alignments are still to resolve before the wipe, once the Grand Alignment has begun (phase III, or the enrage); null before. For the strip's clock. */
export function alignmentLeft(b: Battle): number | null {
  if (!aligning(b)) return null;
  return Math.max(0, ALIGNMENT_STEPS - script(b).aligned);
}

/**
 * The announced card a Bastion, standing or raised now, would be spent on: the
 * first Revolution or Perihelion to resolve (raidWide() spends it; an
 * Alignment's wipe ignores it). A frozen card skips one Orrery turn before it
 * counts again, so it resolves a turn later than its countdown says; cards due
 * on the same turn resolve in strip order. Null if none is on the strip. For
 * the Warden's prompt and the room's mark (phase two's gate, R2).
 */
export function bastionCard(b: Battle): string | null {
  let best: { id: string; turn: number } | null = null;
  for (const c of b.cards) {
    if (c.intent !== "revolution" && c.intent !== "perihelion") continue;
    const turn = c.countdown + (c.frozen ? 1 : 0);
    if (!best || turn < best.turn) best = { id: c.id, turn };
  }
  return best?.id ?? null;
}

/** The soonest card that passes the filter: lowest countdown, first on the strip on a tie. */
export function nextCard(ctx: Ctx, filter?: (c: BossCard) => boolean): BossCard | undefined {
  let best: BossCard | undefined;
  for (const c of ctx.b.cards) if ((!filter || filter(c)) && (!best || c.countdown < best.countdown)) best = c;
  return best;
}

// --- the script --------------------------------------------------------------

interface Script {
  /** Ordinary cards announced in `phase`, for its rotation. */
  played: number;
  phase: Phase;
  /** The latest phase whose Perihelion has gone up, and the Orrery turn it went up on. */
  periheliaFor: number;
  lastPerihelion: number;
  /** Alignments resolved. */
  aligned: number;
  /** The clock began the Grand Alignment (the enrage, ADR-010), not phase III: every Alignment it brings says so. */
  enraged: boolean;
  /** Card id → who it was aimed at when announced, so a retarget reads as an Anchor. */
  aimedAt: Record<string, string | null>;
  /** Card id → the Chronist who Delayed or froze it. */
  touchedBy: Record<string, string>;
  /** Card ids a Warden took on purpose (Anchor, Intercept): an ordinary blow, never lethal (ADR-011). */
  swapped: Record<string, true>;
  /** Each seat's Gravity as this Orrery turn began: what a Lunge on it is judged lethal by (ADR-011). */
  gravityBefore: Record<string, number>;
}

/** The script's memory, on the battle's declared `orreryScript` (rules.ts), so it survives each step's clone. */
function script(b: Battle): Script {
  b.orreryScript ??= { played: 0, phase: 1, periheliaFor: 0, lastPerihelion: 0, aligned: 0, enraged: false, aimedAt: {}, touchedBy: {}, swapped: {} };
  const s = b.orreryScript as Script;
  s.swapped ??= {};
  s.gravityBefore ??= {};
  return s;
}

function forget(s: Script, cardId: string): void {
  delete s.aimedAt[cardId];
  delete s.touchedBy[cardId];
  delete s.swapped[cardId];
}

/** Top the strip up: a Perihelion when one is owed, and a card for each of the next AHEAD Orrery turns. */
function plan(ctx: Ctx): void {
  const { b } = ctx;
  if (ctx.party().length === 0) return;
  const s = script(b);
  if (s.phase !== b.phase) {
    s.phase = b.phase;
    // A new phase starts its rotation afresh, except once the clock has begun the Grand Alignment: it goes on
    // across the line, four cards apart still (ADR-010; the second confirm pass's 5).
    if (!s.enraged) s.played = 0;
  }
  // The clock begins the Grand Alignment, before phase III does (ADR-010, "The enrage"): its count starts
  // afresh, so its first Alignment is the fourth card, as phase III's is (the confirm pass's F6), and every
  // Alignment it brings says the clock began it, whatever phase it resolves in (F1).
  if (!s.enraged && b.phase !== 3 && b.bossTurns >= ENRAGE_AFTER) {
    s.enraged = true;
    s.played = 0;
  }
  const owed = s.periheliaFor < b.phase || b.bossTurns - s.lastPerihelion >= PERIHELION_AGAIN;
  if (owed && !b.cards.some((c) => c.intent === "perihelion")) {
    s.periheliaFor = b.phase;
    s.lastPerihelion = b.bossTurns;
    announce(ctx, { intent: "perihelion", targetId: "party", amount: amount("perihelion", b.phase), countdown: PERIHELION_LEAD });
  }
  for (let slot = 0; slot < AHEAD; slot++) {
    if (!b.cards.some((c) => c.countdown === slot)) announce(ctx, ordinary(ctx, slot));
  }
}

/** The next card in this phase's rotation, aimed, for `countdown`. */
function ordinary(ctx: Ctx, countdown: number): Omit<BossCard, "id" | "frozen"> {
  const { b } = ctx;
  const s = script(b);
  const at = s.played++;
  const rotation = SCRIPT[b.phase];
  const intent: Intent = aligning(b) && (at + 1) % ALIGNMENT_EVERY === 0 ? "alignment" : rotation[at % rotation.length];
  switch (intent) {
    case "eclipse":
    case "lunge": {
      const target = intent === "eclipse" ? weakest(ctx) : wellBody(ctx);
      if (target) return { intent, targetId: target.id, amount: amount(intent, b.phase), countdown };
      return { intent: "revolution", targetId: "party", amount: amount("revolution", b.phase), countdown };
    }
    case "retrograde":
      return { intent, targetId: null, amount: null, countdown };
    case "alignment":
      return { intent, targetId: "party", amount: null, countdown };
    default:
      return { intent, targetId: "party", amount: amount(intent as Dealt, b.phase), countdown };
  }
}

// --- resolutions -------------------------------------------------------------

function resolve(ctx: Ctx, card: BossCard): void {
  switch (card.intent) {
    case "revolution":
      return revolution(ctx, card);
    case "perihelion":
      return perihelion(ctx, card);
    case "eclipse":
      return eclipse(ctx, card);
    case "lunge":
      return lunge(ctx, card);
    case "retrograde":
      return retrograde(ctx, card);
    case "alignment":
      return alignment(ctx, card);
  }
}

function revolution(ctx: Ctx, card: BossCard): void {
  const { amount, hits, bastion } = raidWide(ctx, card.amount ?? 0);
  ctx.say("boss", BOSS_ID, `The Orrery turns: Revolution, ${amount} to everyone standing${bastion}.`, {
    kind: "revolution",
    actorId: BOSS_ID,
    hits,
    cardId: card.id,
  });
  downTheFallen(ctx);
}

function perihelion(ctx: Ctx, card: BossCard): void {
  const broken = ctx.ring("outer").broken;
  const { amount, hits, bastion } = raidWide(ctx, card.amount ?? 0);
  ctx.say(
    "boss",
    BOSS_ID,
    `Perihelion: the Orrery swings closest and burns ${amount} into everyone${broken ? ", its outer ring Broken and its heat halved" : ""}${bastion}.`,
    { kind: "perihelion", actorId: BOSS_ID, hits, broken, cardId: card.id },
  );
  downTheFallen(ctx);
}

/**
 * A card is a promise about who it lands on (rule 19). If that one has fallen
 * or left, the blow has nobody to land on and is spent: it never re-aims at
 * someone no card named.
 */
function spent(ctx: Ctx, card: BossCard, what: string): void {
  const named = card.targetId ? (ctx.b.joined[card.targetId] ?? "its mark") : "its mark";
  const text = `${what} finds no one where ${named} stood, and passes over the table.`;
  const targetId = card.targetId ?? "";
  if (card.intent === "lunge") {
    ctx.say("boss", BOSS_ID, text, { kind: "lunge", actorId: BOSS_ID, targetId, amount: 0, gravity: 0, spent: true, cardId: card.id });
  } else {
    ctx.say("boss", BOSS_ID, text, { kind: "eclipse", actorId: BOSS_ID, targetId, amount: 0, spent: true, cardId: card.id });
  }
}

function eclipse(ctx: Ctx, card: BossCard): void {
  const target = standing(ctx, card.targetId);
  if (!target) return spent(ctx, card, "Eclipse");
  // ADR-011's fourth tooth: a shadow on a seat with nothing between it and the Orrery takes everything. A Ward
  // absorbs it; a Brace (the seat's own shield) halves it as an ordinary blow; a Warden who took it on purpose
  // takes it as an ordinary blow.
  const swap = script(ctx.b).swapped[card.id] === true;
  const whole = !target.warded && !target.braced && !swap;
  const taken = whole ? target.hp : harm(target, card.amount ?? 0);
  if (whole) target.hp = 0;
  ctx.say("boss", BOSS_ID, `Eclipse: the Orrery's shadow falls on ${target.name} for ${taken}${whole ? ", and nothing stood between them" : ""}.`, {
    kind: "eclipse",
    actorId: BOSS_ID,
    targetId: target.id,
    amount: taken,
    cardId: card.id,
  });
  downTheFallen(ctx);
}

/** A Lunge: damage and a Gravity stack. At GRAVITY_LETHAL stacks it takes everything, unless a Ward takes it first. */
function lunge(ctx: Ctx, card: BossCard): void {
  const s = script(ctx.b);
  const target = standing(ctx, card.targetId);
  if (!target) return spent(ctx, card, "The Lunge");
  const aimed = s.aimedAt[card.id];
  const anchoredBy = aimed !== undefined && card.targetId !== aimed && target.id === card.targetId ? target.id : null;
  // "At 3 stacks the next Lunge is lethal" (docs/design/overhaul.md): lethal
  // only on someone already carrying GRAVITY_LETHAL; the Lunge that makes the
  // third stack is an ordinary blow (review F21).
  const gravity = target.gravity + 1;
  // ADR-011's first tooth: lethal on a seat already carrying GRAVITY_LETHAL stacks, unless a Warden took it on
  // purpose (the swap), it was Braced (halved, as an ordinary blow) or Warded (absorbed).
  const swap = s.swapped[card.id] === true;
  const carried = Math.min(target.gravity, s.gravityBefore[target.id] ?? target.gravity);
  let lethal = carried >= GRAVITY_LETHAL && !swap && !target.braced;
  let taken: number;
  if (lethal && target.warded) {
    target.warded = false;
    lethal = false;
    taken = 0;
  } else if (lethal) {
    taken = target.hp;
    target.hp = 0;
  } else {
    taken = harm(target, card.amount ?? 0);
  }
  target.gravity = gravity;
  // The well holds one body at a time.
  for (const f of ctx.party()) if (f !== target) f.gravity = 0;
  ctx.say(
    "boss",
    BOSS_ID,
    `Lunge: the Orrery drives at ${target.name} for ${taken}, and the well's pull on them grows to ${gravity}.`,
    { kind: "lunge", actorId: BOSS_ID, targetId: target.id, amount: taken, gravity, cardId: card.id },
  );
  if (lethal || anchoredBy) {
    ctx.say(
      "boss",
      BOSS_ID,
      lethal
        ? `${gravity} Gravity: the well crushes ${target.name}.`
        : `${target.name} anchored the Lunge and holds the well now, at ${gravity} Gravity.`,
      { kind: "gravity", actorId: BOSS_ID, targetId: target.id, anchoredBy, lethal },
    );
  }
  downTheFallen(ctx);
}

/**
 * Retrograde: the next RETROGRADE_SLOTS portraits on the strip run backwards.
 * Only their counters change: each takes the wait of its mirror, nudged up a
 * tick where a tie would let the seat order undo the flip, and rules.ts
 * finish() re-sorts the strip into the reversed order.
 */
function retrograde(ctx: Ctx, card: BossCard): void {
  const party = ctx.party();
  const next = ctx.b.standing.filter((f) => f.kind === "character").slice(0, RETROGRADE_SLOTS);
  const waits = next.map((f) => f.counter).sort((x, y) => x - y);
  const flipped = [...next].reverse();
  flipped.forEach((f, i) => {
    const before = flipped[i - 1];
    f.counter = before ? Math.max(waits[i], before.counter + (f.seat < before.seat ? 1 : 0)) : waits[i];
  });
  // ADR-011's third tooth: the whole table loses a rotation, the slowest seat's Standard turn, every seat alike.
  const setBack = Math.max(0, ...party.map((f) => counterReset(f.agility, "normal", 3)));
  for (const f of party) f.counter += setBack;
  ctx.say(
    "boss",
    BOSS_ID,
    next.length > 1
      ? `Retrograde: the Orrery runs backwards. ${listNames(next)} now come round as ${listNames(flipped)}, and the whole table loses a turn of the strip.`
      : "Retrograde: the Orrery runs backwards, and the table loses a turn of the strip.",
    { kind: "retrograde", actorId: BOSS_ID, flipped: next.length > 1, cancelledBy: null, cardId: card.id, slots: next.map((f) => f.id), setBack },
  );
  roles.stripMoved(ctx);
}

function alignment(ctx: Ctx, card: BossCard): void {
  const s = script(ctx.b);
  s.aligned += 1;
  const countdown = Math.max(0, ALIGNMENT_STEPS - s.aligned);
  const wipe = countdown === 0;
  if (wipe) for (const f of ctx.party()) f.hp = 0;
  // Begun by the clock, not by phase III (the enrage, ADR-010): every line says so, whatever phase it resolves
  // in, so a table wiped while it was winning slowly knows why (the owner's ruling on L1; the confirm pass's F1).
  const why = s.enraged ? ` The Orrery has turned ${ENRAGE_AFTER} times and will be outlasted no longer.` : "";
  ctx.say(
    "boss",
    BOSS_ID,
    wipe
      ? `The Grand Alignment is complete. Every ring stands in line, and nothing at the table survives it.${why}`
      : `The rings creep into line: ${countdown} more ${countdown === 1 ? "Alignment" : "Alignments"} and the Grand Alignment is complete.${why}`,
    { kind: "alignment", actorId: BOSS_ID, countdown, wipe, cardId: card.id },
  );
  downTheFallen(ctx);
}

/** A raid-wide blow: a standing Bastion takes BASTION_CUT off it and is spent. */
function raidWide(ctx: Ctx, base: number): { amount: number; hits: { targetId: string; amount: number }[]; bastion: string } {
  let amount = base;
  let bastion = "";
  if (ctx.b.bastion) {
    const cut = ctx.b.bastionCut;
    amount = Math.round(base * (1 - cut));
    ctx.b.bastion = false;
    bastion = ` (a Bastion took ${pct(cut)} off ${base})`;
  }
  const hits = ctx.party().map((f) => ({ targetId: f.id, amount: harm(f, amount) }));
  return { amount, hits, bastion };
}

// --- internals ---------------------------------------------------------------

/** What a card deals: the script's amount × CARD_DAMAGE (ADR-010), at least 1. */
function amount(intent: Dealt, phase: Phase): number {
  return Math.max(1, Math.round(AMOUNT[intent][phase - 1] * CARD_DAMAGE));
}

function standing(ctx: Ctx, id: string | null): Fighter | undefined {
  return ctx.party().find((f) => f.id === id);
}

/** Eclipse's mark: the lowest HP standing, earliest seat on a tie. */
function weakest(ctx: Ctx): Fighter | undefined {
  return [...ctx.party()].sort((x, y) => x.hp - y.hp || x.seat - y.seat)[0];
}

/** The Lunge's mark: whoever the well holds (most Gravity), else the highest HP, earliest seat on a tie. */
function wellBody(ctx: Ctx): Fighter | undefined {
  return [...ctx.party()].sort((x, y) => y.gravity - x.gravity || y.hp - x.hp || x.seat - y.seat)[0];
}

function push(b: Battle, card: BossCard, slots: number): void {
  card.countdown = Math.max(0, card.countdown + slots);
  sortCards(b);
}

/** Soonest first; a stable sort keeps the order they went up in on a tie. */
function sortCards(b: Battle): void {
  b.cards.sort((x, y) => x.countdown - y.countdown);
}

function label(intent: Intent): string {
  return intent === "alignment" ? "Alignment" : cap(intent);
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const pct = (x: number): string => `${Math.round(x * 100)}%`;
const nth = (n: number): string => `${n}${n === 2 ? "nd" : n === 3 ? "rd" : "th"}`;
