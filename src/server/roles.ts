// The five roles (docs/design/overhaul.md, Priority 2; docs/adr/006): Warden,
// Mender, Striker, Breaker, Chronist, each with its own resource and the
// actions the design record tables. Area (b) owns this file. rules.ts asks it
// whether an action may be taken (checkAction), what it lands on
// (resolveTarget), and to take it (perform). It leans on economy.ts for Brace,
// potency, Resonance and Exposed, and on orrery.ts for rings and cards.
//
// It never decides whose turn it is (rule 1). perform() returns the rank the
// actor's counter resets at, and economy.afterTurn does the reset. The only
// counters touched here are someone else's: Quicken cuts an ally's, and Restore
// sets a returning ally's to a rank-3 re-entry. rules.ts finish() re-sorts the
// strip after both.
//
// Judgement calls, so the integrator can see them in one place:
//
// - A weakness counts only once it's revealed (ring.weakness === ring.element).
//   Players carry no element, so an unrevealed weakness would make every hit a
//   weakness hit. Scan is what turns a ring into one.
// - Resonance (rule 14) comes from the five blows: Jab, Cleave, Finisher and
//   Counterweight on a revealed or Broken ring, and Feint always. Scan, Pry,
//   Mark and Shatter deal no blow, so they don't resonate.
// - The client names no ring yet, so each aimed action defaults to the
//   outermost ring where it does something, else the outermost that isn't
//   Broken, else the outer ring. Finisher looks for a Broken ring first, Feint
//   for an Exposed stack, Scan for a hidden weakness, Pry for a revealed ring
//   with pips, and Shatter for one at SHATTER_AT or fewer.
// - Cards default to the soonest (lowest countdown). For Anchor that's the
//   soonest aimed at one ally other than you; for Stillpoint, the soonest not
//   already frozen.
// - Flux: +1 to every standing Chronist whenever an action here moves
//   something on the strip: a Quicken that cut a wait, a Restore, a Resonance
//   jump, or a Delay, Pry or Shatter that changed a card's countdown (measured,
//   not assumed: a Break with no card to push moves nothing). GAP: moves made
//   elsewhere grant nothing yet: Retrograde's flip and a Break by damage in
//   orrery.ts, and Intercept and the Chain in economy.ts. `stripMoved` is
//   exported so those areas can call it.
// - Anchor banks 1 Resolve: like Intercept, it takes a blow meant for someone
//   else.
// - Ward's Grace is pre-emptive: +1 when a card on the strip is aimed at that
//   ally. A raid-wide card marks nobody in particular. A Ward on someone
//   already Warded is refused, so Grace can't be farmed.
// - Scan on a ring already revealed is allowed (the room is told again) but
//   banks no Insight. It's never refused: spec/shown.test.ts Scans untargeted
//   for a whole fight.
// - Quicken on yourself is refused: this very action resets your counter.
// - Relay hands on any bonus the Chronist was holding as well as its own. A
//   Chronist deals and heals nothing, so a baton handed to one would otherwise
//   never be spent. The receiver is the first other character in queue order.
// - Restore re-enters at rank 3 (FFX), at half HP rounded up, with Gravity,
//   Ward and Brace cleared. The HP it brings back counts as healing. Without
//   a target it picks the first downed ally; someone who left isn't downed.
// - Bastion can't be raised over one already standing (it would waste the
//   Resolve), and Stillpoint can't freeze a card that's already frozen.
// - Anchor and Delay at a card id the strip no longer holds are refused (409),
//   never kept for when it comes back (rule 2).
// - Each action writes its own line first, then its consequences (wound's
//   phase line, a break, Exposed stacks, a Resonance), so the screen shows the
//   blow before what it caused. A blow is clamped to the Orrery's HP before
//   it's said, which is exactly what wound() then takes off.

import { ACTIONS, BOSS_ID, type ActionId, type BossCard, type RingId, type RoleId } from "../shared/protocol.ts";
import { ATTACK_RANK, counterReset } from "./ctb.ts";
import * as economy from "./economy.ts";
import * as orrery from "./orrery.ts";
import { wound, type Battle, type Ctx, type Fighter, type Refusal, type RingState } from "./rules.ts";
import {
  FINISHER_BROKEN,
  FLUX_MAX,
  GRACE_MAX,
  HASTE_RESETS,
  INSIGHT_MAX,
  MARK_STACKS,
  MOMENTUM_MAX,
  PRY_PIPS,
  QUICKEN_CUT,
  RANK_MIN,
  RELAY_BONUS,
  RESOLVE_MAX,
  RESTORE_COST,
  SHATTER_AT,
  SHATTER_COST,
} from "./tuning.ts";

/** Each role's body. Server-only numbers; the client sees ranks and nothing else. */
export const STATS: Readonly<Record<RoleId, { agility: number; hp: number; power: number }>> = {
  warden: { agility: 30, hp: 170, power: 12 },
  mender: { agility: 50, hp: 100, power: 9 },
  striker: { agility: 70, hp: 110, power: 18 },
  breaker: { agility: 62, hp: 105, power: 12 },
  chronist: { agility: 110, hp: 90, power: 9 },
};

// --- numbers the design record doesn't give --------------------------------
// Ours, to playtest (docs/design/overhaul.md, Caveats). Candidates for tuning.ts.

/**
 * A blow is the role's power × its scale × potency. Per rank of wait, for a
 * Striker: Jab 0.35, Cleave 0.33 (0.5 on a weakness, with its Resonance),
 * Feint 0.8 (spending someone's stack), Finisher at 5 Momentum 0.75 (1.5 on a
 * Broken ring). So a lone Striker Jabbing and Cleaving does worst, and one
 * playing off a Breaker does best.
 */
const SCALE = { jab: 0.35, cleave: 1, counterweight: 1, feint: 0.8 } as const;
/** Finisher: power × this × Momentum spent (×FINISHER_BROKEN on a Broken ring). */
const FINISHER_PER_MOMENTUM = 0.6;
/** Mend heals this × potency (the old Mender's 36). */
const MEND_AMOUNT = 36;
/** The record's: Delay pushes a card back one slot; Jab +1 Momentum, Cleave +2 on a weakness. */
const DELAY_SLOTS = 1;
const JAB_MOMENTUM = 1;
const CLEAVE_MOMENTUM = 2;
/** Ours: Resolve per Anchor, Grace per pre-emptive Ward, Insight per Scan or Pry, Flux per strip move. */
const GAIN = 1;

const RING_IDS: readonly RingId[] = ["outer", "middle", "inner"];
const isRingId = (x: string): x is RingId => (RING_IDS as readonly string[]).includes(x);

// --- what rules.ts calls -----------------------------------------------------

/** Whether `actor` may take `action` now, beyond it being their turn and their role's; null to go ahead. */
export function checkAction(b: Battle, actor: Fighter, action: ActionId, target: string | null): Refusal | null {
  const unready = checkResource(actor, action);
  if (unready) return unready;
  const aimed = resolve(b, actor, action, target);
  if ("status" in aimed) return aimed;
  return checkTarget(b, actor, action, aimed.target);
}

/** The target an action lands on: a ring, a card or an ally (defaults above), or null for a self action. */
export function resolveTarget(b: Battle, actor: Fighter, action: ActionId, target: string | null): string | null {
  const aimed = resolve(b, actor, action, target);
  return "status" in aimed ? target : aimed.target;
}

/**
 * Perform `action` (already checked). Returns the rank the counter resets at:
 * the action's own, or one lower for a Resonance (rule 14), which
 * economy.afterTurn applies. The target is resolved again here, because a
 * caller may pass the one it was given rather than the one checkAction chose.
 */
export function perform(ctx: Ctx, actor: Fighter, action: ActionId, target: string | null): { rank: number } {
  const aimed = resolve(ctx.b, actor, action, target);
  if ("status" in aimed) throw new Error(`${action} by ${actor.id}: ${aimed.error} (checkAction should have refused)`);
  const at = aimed.target;
  const rank = ACTIONS[action].rank;
  switch (action) {
    case "brace":
      economy.brace(ctx, actor);
      return { rank };
    // Warden
    case "anchor":
      return { rank: anchor(ctx, actor, card(ctx, at), rank) };
    case "bastion":
      return { rank: bastion(ctx, actor, rank) };
    case "counterweight":
      return { rank: counterweight(ctx, actor, ctx.ring(at as RingId), rank) };
    // Mender
    case "mend":
      return { rank: mend(ctx, actor, ctx.fighter(at as string), rank) };
    case "ward":
      return { rank: ward(ctx, actor, ctx.fighter(at as string), rank) };
    case "quicken":
      return { rank: quicken(ctx, actor, ctx.fighter(at as string), rank) };
    case "restore":
      return { rank: restore(ctx, actor, at as string, rank) };
    // Striker
    case "jab":
      return { rank: jab(ctx, actor, ctx.ring(at as RingId), rank) };
    case "cleave":
      return { rank: cleave(ctx, actor, ctx.ring(at as RingId), rank) };
    case "finisher":
      return { rank: finisher(ctx, actor, ctx.ring(at as RingId), rank) };
    case "feint":
      return { rank: feint(ctx, actor, ctx.ring(at as RingId), rank) };
    // Breaker
    case "scan":
      return { rank: scan(ctx, actor, ctx.ring(at as RingId), rank) };
    case "pry":
      return { rank: pry(ctx, actor, ctx.ring(at as RingId), rank) };
    case "mark":
      return { rank: mark(ctx, actor, ctx.ring(at as RingId), rank) };
    case "shatter":
      return { rank: shatter(ctx, actor, ctx.ring(at as RingId), rank) };
    // Chronist
    case "delay":
      return { rank: delay(ctx, actor, card(ctx, at), rank) };
    case "haste":
      return { rank: haste(ctx, actor, ctx.fighter(at as string), rank) };
    case "relay":
      return { rank: relay(ctx, actor, rank) };
    case "stillpoint":
      return { rank: stillpoint(ctx, actor, card(ctx, at), rank) };
    case "intercept":
      // A Reaction: rules.ts hands it to economy.react and never brings it here.
      throw new Error("Intercept is a Reaction; economy.react takes it, not perform");
  }
}

/**
 * The rank a turn action would reset its actor at, aimed at its default
 * target, and whether that is a Resonance (rule 14): for the server's preview
 * of where a portrait lands (view.ts; rule 1 keeps the client from working it
 * out). The same resolve() and resonant() perform() uses, so they can't drift.
 */
export function previewRank(b: Battle, actor: Fighter, action: ActionId): { rank: number; resonance: boolean } {
  const rank = ACTIONS[action].rank;
  const aimed = resolve(b, actor, action, null);
  if ("status" in aimed) return { rank, resonance: false };
  const ring = aimed.target !== null && isRingId(aimed.target) ? b.rings.find((r) => r.id === aimed.target) : undefined;
  const blows: readonly ActionId[] = ["jab", "cleave", "finisher", "counterweight"];
  const hit = action === "feint" || (blows.includes(action) && !!ring && resonant(ring));
  const to = hit ? Math.max(RANK_MIN, rank - 1) : rank;
  return { rank: to, resonance: to < rank };
}

/**
 * Something on the strip just moved (a portrait jumped, a card was pushed or
 * a fallen ally re-entered): every standing Chronist gains a Flux. For the
 * other areas too: orrery.ts may call it for a Retrograde flip.
 */
export function stripMoved(ctx: Ctx): void {
  for (const f of ctx.party()) if (f.role === "chronist") f.resource = Math.min(FLUX_MAX, f.resource + GAIN);
}

// --- Warden: Resolve ---------------------------------------------------------

function anchor(ctx: Ctx, actor: Fighter, c: BossCard, rank: number): number {
  const fromId = c.targetId as string;
  const from = ctx.b.standing.find((f) => f.id === fromId) ?? ctx.b.fallen.find((f) => f.id === fromId);
  orrery.retargetCard(ctx, c.id, actor.id);
  actor.resource = Math.min(RESOLVE_MAX, actor.resource + GAIN);
  ctx.say(
    "action",
    actor.id,
    `${actor.name} anchors the Orrery's ${c.intent}, pulling it off ${from?.name ?? "an ally"} and onto themselves (Resolve ${actor.resource}).`,
    { kind: "anchor", actorId: actor.id, cardId: c.id },
  );
  return rank;
}

function bastion(ctx: Ctx, actor: Fighter, rank: number): number {
  const spent = actor.resource;
  actor.resource = 0;
  ctx.b.bastion = true;
  ctx.say("action", actor.id, `${actor.name} spends ${spent} Resolve to raise a Bastion against the next blow that falls on everyone.`, {
    kind: "bastion",
    actorId: actor.id,
    spent,
  });
  return rank;
}

function counterweight(ctx: Ctx, actor: Fighter, ring: RingState, rank: number): number {
  const stacks = Math.max(1, Math.floor(actor.resource / 2));
  const hit = resonant(ring);
  const dealt = aim(ctx, actor, SCALE.counterweight);
  ctx.say("action", actor.id, `${actor.name} swings a Counterweight into the ${ring.id} ring for ${dealt}.`, {
    kind: "counterweight",
    actorId: actor.id,
    ringId: ring.id,
    amount: dealt,
    exposed: stacks,
  });
  land(ctx, actor, dealt);
  economy.applyExposed(ctx, ring.id, actor, stacks);
  return resonate(ctx, actor, rank, hit);
}

// --- Mender: Grace -----------------------------------------------------------

function mend(ctx: Ctx, actor: Fighter, target: Fighter, rank: number): number {
  const healed = Math.max(0, Math.min(Math.round(MEND_AMOUNT * economy.potency(ctx, actor)), target.maxHp - target.hp));
  target.hp += healed;
  ctx.stat(actor.id).healing += healed;
  const whom = target === actor ? "their own wounds" : target.name;
  ctx.say(
    "action",
    actor.id,
    healed > 0 ? `${actor.name} mends ${whom} for ${healed}.` : `${actor.name} tends to ${whom}, but there is nothing to mend.`,
    { kind: "mend", actorId: actor.id, targetId: target.id, amount: healed },
  );
  return rank;
}

function ward(ctx: Ctx, actor: Fighter, target: Fighter, rank: number): number {
  target.warded = true;
  // Pre-emptive: Grace only for shielding someone a card on the strip is aimed at.
  const marked = ctx.b.cards.some((c) => c.targetId === target.id);
  if (marked) actor.resource = Math.min(GRACE_MAX, actor.resource + GAIN);
  const whom = target === actor ? "themselves" : target.name;
  const grace = marked ? ` ahead of the blow aimed there (Grace ${actor.resource})` : "";
  ctx.say("action", actor.id, `${actor.name} wards ${whom}${grace}. The next blow there is absorbed.`, {
    kind: "ward",
    actorId: actor.id,
    targetId: target.id,
  });
  return rank;
}

function quicken(ctx: Ctx, actor: Fighter, target: Fighter, rank: number): number {
  const from = target.counter;
  // Someone tied on the plate stays there; nobody else is put on it by a cut.
  const to = from > 0 ? Math.max(1, Math.floor(from * (1 - QUICKEN_CUT))) : from;
  target.counter = to;
  ctx.say(
    "action",
    actor.id,
    to < from
      ? `${actor.name} quickens ${target.name}: their wait falls from ${from} to ${to}.`
      : `${actor.name} quickens ${target.name}, but they're as close to the plate as they can be.`,
    { kind: "quicken", actorId: actor.id, targetId: target.id, from, to },
  );
  if (to < from) stripMoved(ctx);
  return rank;
}

function restore(ctx: Ctx, actor: Fighter, targetId: string, rank: number): number {
  const f = ctx.b.fallen.find((x) => x.id === targetId && x.out === "downed");
  if (!f) throw new Error(`Restore on ${targetId}, who isn't downed (checkAction should have refused)`);
  actor.resource -= RESTORE_COST;
  ctx.b.fallen = ctx.b.fallen.filter((x) => x !== f);
  f.out = null;
  f.hp = Math.ceil(f.maxHp / 2);
  // FFX: a revived character re-enters as if they had just used a rank-3 action.
  f.counter = counterReset(f.agility, "normal", ATTACK_RANK);
  f.braced = false;
  f.warded = false;
  f.gravity = 0;
  ctx.b.standing.push(f);
  ctx.stat(actor.id).healing += f.hp;
  ctx.say("action", actor.id, `${actor.name} spends ${RESTORE_COST} Grace and brings ${f.name} back to the table at ${f.hp} HP.`, {
    kind: "restore",
    actorId: actor.id,
    targetId: f.id,
  });
  stripMoved(ctx);
  return rank;
}

// --- Striker: Momentum -------------------------------------------------------

function jab(ctx: Ctx, actor: Fighter, ring: RingState, rank: number): number {
  const hit = resonant(ring);
  const dealt = aim(ctx, actor, SCALE.jab);
  actor.resource = Math.min(MOMENTUM_MAX, actor.resource + JAB_MOMENTUM);
  ctx.say("action", actor.id, `${actor.name} jabs the ${ring.id} ring for ${dealt} (Momentum ${actor.resource}).`, {
    kind: "jab",
    actorId: actor.id,
    ringId: ring.id,
    amount: dealt,
  });
  land(ctx, actor, dealt);
  return resonate(ctx, actor, rank, hit);
}

function cleave(ctx: Ctx, actor: Fighter, ring: RingState, rank: number): number {
  const weakness = weak(ring);
  const hit = resonant(ring);
  const dealt = aim(ctx, actor, SCALE.cleave);
  if (weakness) actor.resource = Math.min(MOMENTUM_MAX, actor.resource + CLEAVE_MOMENTUM);
  ctx.say(
    "action",
    actor.id,
    weakness
      ? `${actor.name} cleaves the ${ring.id} ring on its weakness for ${dealt} (Momentum ${actor.resource}).`
      : `${actor.name} cleaves the ${ring.id} ring for ${dealt}.`,
    { kind: "cleave", actorId: actor.id, ringId: ring.id, amount: dealt, weakness },
  );
  land(ctx, actor, dealt);
  return resonate(ctx, actor, rank, hit);
}

function finisher(ctx: Ctx, actor: Fighter, ring: RingState, rank: number): number {
  const spent = actor.resource;
  const broken = ring.broken;
  const hit = resonant(ring);
  actor.resource = 0;
  const dealt = aim(ctx, actor, FINISHER_PER_MOMENTUM * spent * (broken ? FINISHER_BROKEN : 1));
  ctx.say(
    "action",
    actor.id,
    broken
      ? `${actor.name} spends ${spent} Momentum on a Finisher into the Broken ${ring.id} ring for ${dealt}.`
      : `${actor.name} spends ${spent} Momentum on a Finisher into the ${ring.id} ring for ${dealt}.`,
    { kind: "finisher", actorId: actor.id, ringId: ring.id, amount: dealt, spent, broken },
  );
  land(ctx, actor, dealt);
  return resonate(ctx, actor, rank, hit);
}

function feint(ctx: Ctx, actor: Fighter, ring: RingState, rank: number): number {
  const dealt = aim(ctx, actor, SCALE.feint);
  ctx.say("action", actor.id, `${actor.name} feints at the ${ring.id} ring and strikes the opening for ${dealt}.`, {
    kind: "feint",
    actorId: actor.id,
    ringId: ring.id,
    amount: dealt,
  });
  if (!economy.spendExposed(ctx, ring.id, actor)) {
    throw new Error(`Feint on the ${ring.id} ring with no Exposed stack (checkAction should have refused)`);
  }
  land(ctx, actor, dealt);
  // A guaranteed Resonance: the opening someone else left is the weakness.
  return resonate(ctx, actor, rank, true);
}

// --- Breaker: Insight --------------------------------------------------------

function scan(ctx: Ctx, actor: Fighter, ring: RingState, rank: number): number {
  const fresh = ring.weakness === null;
  ring.weakness = ring.element;
  if (fresh) actor.resource = Math.min(INSIGHT_MAX, actor.resource + GAIN);
  ctx.say(
    "action",
    actor.id,
    fresh
      ? `${actor.name} scans the ${ring.id} ring: it is weak to ${ring.element} (Insight ${actor.resource}).`
      : `${actor.name} scans the ${ring.id} ring again: still weak to ${ring.element}.`,
    { kind: "scan", actorId: actor.id, ringId: ring.id, weakness: ring.element },
  );
  return rank;
}

function pry(ctx: Ctx, actor: Fighter, ring: RingState, rank: number): number {
  const pips = Math.min(PRY_PIPS, ring.pips);
  actor.resource = Math.min(INSIGHT_MAX, actor.resource + GAIN);
  ctx.say("action", actor.id, `${actor.name} pries ${pips} shield ${pips === 1 ? "pip" : "pips"} off the ${ring.id} ring (Insight ${actor.resource}).`, {
    kind: "pry",
    actorId: actor.id,
    ringId: ring.id,
    pips,
  });
  // A Break pushes the next card back, which moves the strip.
  movesCards(ctx, () => orrery.stripPips(ctx, ring.id, pips, actor));
  return rank;
}

function mark(ctx: Ctx, actor: Fighter, ring: RingState, rank: number): number {
  ctx.say("action", actor.id, `${actor.name} marks the ${ring.id} ring, leaving it Exposed.`, {
    kind: "mark",
    actorId: actor.id,
    ringId: ring.id,
    stacks: MARK_STACKS,
  });
  economy.applyExposed(ctx, ring.id, actor, MARK_STACKS);
  return rank;
}

function shatter(ctx: Ctx, actor: Fighter, ring: RingState, rank: number): number {
  actor.resource -= SHATTER_COST;
  ctx.say("action", actor.id, `${actor.name} spends ${SHATTER_COST} Insight and shatters the ${ring.id} ring's last shields.`, {
    kind: "shatter",
    actorId: actor.id,
    ringId: ring.id,
  });
  movesCards(ctx, () => orrery.breakRing(ctx, ring.id, actor));
  return rank;
}

// --- Chronist: Flux ----------------------------------------------------------

function delay(ctx: Ctx, actor: Fighter, c: BossCard, rank: number): number {
  const moved = movesCards(ctx, () => orrery.delayCard(ctx, c.id, DELAY_SLOTS, actor), false);
  const countdown = ctx.b.cards.find((x) => x.id === c.id)?.countdown ?? c.countdown;
  ctx.say("action", actor.id, `${actor.name} delays the Orrery's ${c.intent} by ${DELAY_SLOTS} ${DELAY_SLOTS === 1 ? "slot" : "slots"}.`, {
    kind: "delay",
    actorId: actor.id,
    cardId: c.id,
    countdown,
  });
  // The Flux comes after the line, so the screen shows the push before what it earned.
  if (moved) stripMoved(ctx);
  return rank;
}

function haste(ctx: Ctx, actor: Fighter, target: Fighter, rank: number): number {
  target.hasteLeft = HASTE_RESETS;
  const whom = target === actor ? "their own step" : target.name;
  ctx.say("action", actor.id, `${actor.name} hastens ${whom}: the next ${HASTE_RESETS} waits are halved.`, {
    kind: "haste",
    actorId: actor.id,
    targetId: target.id,
  });
  return rank;
}

function relay(ctx: Ctx, actor: Fighter, rank: number): number {
  const next = ctx.b.standing.find((f) => f.kind === "character" && f.id !== actor.id);
  if (!next) {
    ctx.say("action", actor.id, `${actor.name} relays, but there's nobody after them to take it.`, {
      kind: "relay",
      actorId: actor.id,
      toId: null,
      potency: 0,
    });
    return rank;
  }
  // Hand on the baton they were holding as well as their own.
  const potency = RELAY_BONUS + actor.relayBonus;
  actor.relayBonus = 0;
  next.relayBonus += potency;
  ctx.say("action", actor.id, `${actor.name} relays to ${next.name}: +${Math.round(potency * 100)}% on their next action.`, {
    kind: "relay",
    actorId: actor.id,
    toId: next.id,
    potency,
  });
  return rank;
}

function stillpoint(ctx: Ctx, actor: Fighter, c: BossCard, rank: number): number {
  actor.resource = 0;
  orrery.freezeCard(ctx, c.id, actor);
  ctx.say("action", actor.id, `${actor.name} spends all their Flux on a Stillpoint: the Orrery's ${c.intent} is frozen for a cycle.`, {
    kind: "stillpoint",
    actorId: actor.id,
    cardId: c.id,
  });
  return rank;
}

// --- blows -------------------------------------------------------------------

/** The ring's weakness is known and lands: revealed by a Scan. */
const weak = (ring: RingState): boolean => ring.weakness === ring.element;
/** A blow here refunds a rank (rule 14): a known weakness, or a Broken ring. */
const resonant = (ring: RingState): boolean => weak(ring) || ring.broken;

/** What a blow at `scale` will take off the Orrery: power × scale × potency, clamped to its HP. Spends any Relay. */
function aim(ctx: Ctx, actor: Fighter, scale: number): number {
  const raw = STATS[actor.role as RoleId].power * scale * economy.potency(ctx, actor);
  return Math.max(0, Math.min(Math.round(raw), ctx.orrery().hp));
}

/** Land an aimed blow on the Orrery and credit it. */
function land(ctx: Ctx, actor: Fighter, dealt: number): void {
  ctx.stat(actor.id).damage += wound(ctx, dealt);
}

/**
 * Run an orrery.ts call that may push cards back, and say whether any card's
 * countdown changed. By default a change is a strip move and grants Flux at once.
 */
function movesCards(ctx: Ctx, change: () => void, grant = true): boolean {
  const before = new Map(ctx.b.cards.map((c) => [c.id, c.countdown]));
  change();
  const moved = ctx.b.cards.some((c) => before.has(c.id) && before.get(c.id) !== c.countdown);
  if (moved && grant) stripMoved(ctx);
  return moved;
}

/** Ask for a Resonance; a refund moves the portrait, which is a strip move. */
function resonate(ctx: Ctx, actor: Fighter, rank: number, hit: boolean): number {
  const to = economy.resonance(ctx, actor, rank, hit);
  if (to < rank) stripMoved(ctx);
  return to;
}

// --- checks and targets ------------------------------------------------------

/** Refusals that depend only on the actor's own resource. */
function checkResource(actor: Fighter, action: ActionId): Refusal | null {
  const has = actor.resource;
  switch (action) {
    case "bastion":
      return has > 0 ? null : refuse("Bastion spends Resolve, and you have none yet. Take a blow meant for an ally (Anchor or Intercept) to build it.");
    case "restore":
      return has >= RESTORE_COST ? null : refuse(`Restore needs ${RESTORE_COST} Grace; you have ${has}. Ward an ally a boss card is aimed at to earn it.`);
    case "finisher":
      return has > 0 ? null : refuse("Finisher spends Momentum, and you have none. Jab, or Cleave a weakness, to build it.");
    case "shatter":
      return has >= SHATTER_COST ? null : refuse(`Shatter needs ${SHATTER_COST} Insight; you have ${has}. Scan or Pry to gain it.`);
    case "stillpoint":
      return has >= FLUX_MAX ? null : refuse(`Stillpoint needs full Flux (${FLUX_MAX}); you have ${has}. It builds whenever the strip moves.`);
    default:
      return null;
  }
}

/** Refusals that depend on what the action is aimed at. */
function checkTarget(b: Battle, actor: Fighter, action: ActionId, target: string | null): Refusal | null {
  const ring = target !== null && isRingId(target) && ACTIONS[action].target === "boss" ? b.rings.find((r) => r.id === target) : undefined;
  switch (action) {
    case "anchor": {
      const c = b.cards.find((x) => x.id === target);
      if (!c || !singleTarget(c)) return refuse("Anchor pulls a blow aimed at one ally, and that card isn't aimed at anyone in particular.");
      if (c.targetId === actor.id) return refuse("That blow is already aimed at you.");
      return null;
    }
    case "bastion":
      return b.bastion ? refuse("A Bastion already stands against the next blow that falls on everyone.") : null;
    case "ward": {
      const f = b.standing.find((x) => x.id === target);
      return f?.warded ? refuse(`${f.id === actor.id ? "You are" : `${f.name} is`} already Warded; the Ward holds until a blow lands.`) : null;
    }
    case "quicken":
      return target === actor.id ? refuse("Quicken moves an ally up the strip; your own wait is set by what you do this turn. Choose someone else.") : null;
    case "feint":
      return ring && ring.exposed.length === 0
        ? refuse(`There's no Exposed stack on the ${ring.id} ring to spend. Someone has to Mark it or Counterweight it first.`)
        : null;
    case "pry":
      if (!ring) return null;
      if (ring.broken) return refuse(`The ${ring.id} ring is already Broken; there's nothing left to pry.`);
      if (!weak(ring)) return refuse(`Pry needs the ${ring.id} ring's weakness revealed first. Scan it.`);
      if (ring.pips <= 0) return refuse(`The ${ring.id} ring has no shield pips left to pry.`);
      return null;
    case "shatter":
      if (!ring) return null;
      if (ring.broken) return refuse(`The ${ring.id} ring is already Broken.`);
      if (ring.pips > SHATTER_AT) return refuse(`Shatter needs a ring at ${SHATTER_AT} pips or fewer; the ${ring.id} ring has ${ring.pips}. Pry it first.`);
      return null;
    case "stillpoint": {
      const c = b.cards.find((x) => x.id === target);
      return c?.frozen ? refuse("That card is already frozen.") : null;
    }
    default:
      return null;
  }
}

/**
 * Where an action lands: an explicit target, checked, or the default. A ring
 * for a "boss" action, a card id for a "card" action, a character id for an
 * "ally" action (a fallen one for Restore), null for a "self" action.
 */
function resolve(b: Battle, actor: Fighter, action: ActionId, raw: string | null): Refusal | { target: string | null } {
  switch (ACTIONS[action].target) {
    case "self":
      return { target: null };
    case "boss": {
      if (raw === null || raw === BOSS_ID) return { target: defaultRing(b, action).id };
      return isRingId(raw) && b.rings.some((r) => r.id === raw)
        ? { target: raw }
        : { status: 400, error: `There's no ring called "${raw}". Aim at the outer, middle or inner ring.` };
    }
    case "card": {
      if (raw !== null) {
        return b.cards.some((c) => c.id === raw)
          ? { target: raw }
          : refuse(`${ACTIONS[action].label} aims at a boss card, and there's no such card on the strip; it may already have resolved.`);
      }
      const found = soonest(b.cards, cardFilter(actor, action));
      if (found) return { target: found.id };
      return refuse(
        action === "anchor"
          ? "There's no boss card aimed at an ally for you to Anchor."
          : `There's no boss card on the strip to ${action === "stillpoint" ? "hold with Stillpoint" : ACTIONS[action].label}.`,
      );
    }
    case "ally": {
      if (action === "restore") {
        if (raw === null) {
          const down = b.fallen.find((f) => f.kind === "character" && f.out === "downed");
          return down ? { target: down.id } : refuse("Nobody has fallen, so there's no one to Restore.");
        }
        if (b.fallen.some((f) => f.id === raw && f.out === "downed")) return { target: raw };
        const standing = b.standing.find((f) => f.id === raw && f.kind === "character");
        return standing
          ? refuse(`${standing.name} is still standing; Restore brings back someone who has fallen.`)
          : { status: 400, error: "That ally hasn't fallen in this fight." };
      }
      const id = raw ?? actor.id;
      return b.standing.some((f) => f.id === id && f.kind === "character")
        ? { target: id }
        : { status: 400, error: "That ally isn't standing at this table." };
    }
  }
}

/** The outermost ring where this action does something; else the outermost not Broken; else the outer ring. */
function defaultRing(b: Battle, action: ActionId): RingState {
  const known = (r: RingState) => !r.broken && weak(r);
  const prefer: Partial<Record<ActionId, (r: RingState) => boolean>> = {
    jab: (r) => known(r) || r.broken,
    cleave: known,
    counterweight: (r) => known(r) || r.broken,
    finisher: (r) => r.broken,
    feint: (r) => r.exposed.length > 0,
    scan: (r) => !r.broken && r.weakness === null,
    pry: (r) => known(r) && r.pips > 0,
    shatter: (r) => !r.broken && r.pips <= SHATTER_AT,
  };
  const first = prefer[action];
  return (first && b.rings.find(first)) ?? b.rings.find((r) => !r.broken) ?? b.rings[0];
}

/** Which cards an action may default to. */
function cardFilter(actor: Fighter, action: ActionId): (c: BossCard) => boolean {
  if (action === "anchor") return (c) => singleTarget(c) && c.targetId !== actor.id;
  if (action === "stillpoint") return (c) => !c.frozen;
  return () => true;
}

/** Aimed at one character: not the room ("party"), and not the strip (null). */
const singleTarget = (c: BossCard): boolean => c.targetId !== null && c.targetId !== "party";

/** The soonest card that passes: lowest countdown, first announced on a tie. */
function soonest(cards: readonly BossCard[], ok: (c: BossCard) => boolean): BossCard | undefined {
  let best: BossCard | undefined;
  for (const c of cards) if (ok(c) && (!best || c.countdown < best.countdown)) best = c;
  return best;
}

/** The card a checked action is aimed at, in the step's own battle. */
function card(ctx: Ctx, id: string | null): BossCard {
  const c = ctx.b.cards.find((x) => x.id === id);
  if (!c) throw new Error(`no card ${id} on the strip (checkAction should have refused)`);
  return c;
}

const refuse = (error: string): Refusal => ({ status: 409, error });
