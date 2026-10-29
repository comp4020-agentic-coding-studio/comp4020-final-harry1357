// Phase two, area (a): the strip as the play surface. The events whose
// meaning is on the turn strip: a portrait reaching the plate, boss cards, the
// Chain, Resonance, Retrograde, the Alignment, and the actions that move
// someone or something on it. Each reduced variant shows the same state change
// with no movement, and declares that state in `expected` (review F25).
//
// The strip has already drawn the state these events produced by the time
// they play (the conductor renders it on arrival): a card announced is on the
// strip, a Quickened portrait has moved up, a Retrograde's portraits are in
// their new order. So each renderer marks the moment: which card, which
// portrait, what just happened to it. The full variants add the motion (an
// afterimage, a wind-up, the rings spun up); the reduced ones make the same
// marks and move nothing.
import type { AreaRenderers, EffectContext } from "../api.ts";
import { BOSS_ID } from "../../../shared/protocol.ts";
import { HOLD, bounded, castFor, rest, roleOf, showMarks, showRingMarks, showRings, stage, type Fx } from "./kit.ts";

/** Acting on your turn ends a Brace (rules.ts clears it as every turn begins), as party.ts does. */
function begins(ctx: EffectContext, actorId: string): void {
  ctx.scene.guard(actorId, false);
}

// --- plate ------------------------------------------------------------------------

/** Someone reached the strike plate. Instant: it must never hold up the strike that follows. */
export const plate: Fx<"plate"> = (raw, e) => {
  const ctx = stage(raw);
  ctx.audio.play("plate");
  ctx.strip.flag(e.actorId, "plate");
};

// --- the Orrery's cards (rule 19) -------------------------------------------------

/** A card goes up on the strip. It's drawn from state already; this marks it new (it drops in, under no-preference). */
export const card: Fx<"card"> = (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.card(e.card.id, "announced");
};

// --- the Chain (rule 15) ------------------------------------------------------------

export const chain: Fx<"chain"> = (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.chain(e.links, e.broken);
};

// --- Resonance (rule 14) --------------------------------------------------------------

/** A weakness hit refunded a rank: the portrait jumps forward, trailing afterimages, and a gold number says so. */
export const resonance: Fx<"resonance"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.jump(e.actorId, e.from, e.to);
  ctx.scene.number(e.actorId, e.from - e.to, "resonance", e.seq);
  await bounded(ctx, ctx.strip.afterimage(e.actorId), 500);
};

export const resonanceReduced: Fx<"resonance"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.jump(e.actorId, e.from, e.to);
  ctx.scene.number(e.actorId, e.from - e.to, "resonance", e.seq);
  await ctx.wait(HOLD);
};

// --- Reactions (rule 18) --------------------------------------------------------------

/** A Reaction out of turn, against a card on the strip. Takes no turn, so it ends no Brace. */
export const reaction: Fx<"reaction"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.flag(e.actorId, "reacted");
  await bounded(ctx, ctx.scene.windUp(e.actorId), 300);
};

export const reactionReduced: Fx<"reaction"> = (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.flag(e.actorId, "reacted");
};

/** A Warden steps in front of a blow meant for an ally: the card now points at the Warden. */
export const intercept: Fx<"intercept"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.card(e.cardId, "retargeted");
  const guard = ctx.scene.frame(e.actorId, "guard");
  await bounded(ctx, ctx.scene.afterimage(e.actorId), 360);
  await bounded(ctx, guard, 400);
  rest(ctx, e.actorId);
};

export const interceptReduced: Fx<"intercept"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.card(e.cardId, "retargeted");
  void ctx.scene.frame(e.actorId, "guard");
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

// --- ADR-011: a Reaction for every role, and the sting each one leaves ------------------------

/** The Mender's Veil: whoever the blow is aimed at is Warded now, before it lands. */
export const veil: Fx<"veil"> = async (raw, e) => {
  const ctx = stage(raw);
  const pose = ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.strip.card(e.cardId, "retargeted");
  if (e.targetId !== e.actorId) await bounded(ctx, ctx.scene.projectile(e.actorId, e.targetId, "spark"), 420);
  ctx.scene.ward(e.targetId, true);
  showMarks(ctx, e.targetId);
  await bounded(ctx, pose, 400);
  rest(ctx, e.actorId);
};

export const veilReduced: Fx<"veil"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.strip.card(e.cardId, "retargeted");
  ctx.scene.ward(e.targetId, true);
  showMarks(ctx, e.targetId);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/** The Striker's Riposte: feet set against the blow aimed at them, guarded and Warded; the sting follows. */
export const riposte: Fx<"riposte"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.card(e.cardId, "retargeted");
  const guard = ctx.scene.frame(e.actorId, "guard");
  await bounded(ctx, ctx.scene.windUp(e.actorId), 260);
  ctx.scene.guard(e.actorId, true);
  ctx.scene.ward(e.actorId, true);
  showMarks(ctx, e.actorId);
  await bounded(ctx, guard, 400);
};

export const riposteReduced: Fx<"riposte"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.card(e.cardId, "retargeted");
  void ctx.scene.frame(e.actorId, "guard");
  ctx.scene.guard(e.actorId, true);
  ctx.scene.ward(e.actorId, true);
  showMarks(ctx, e.actorId);
  await ctx.wait(HOLD);
};

/** The Breaker's Fracture: the outer ring's shield cracks as a blow on everyone gathers. */
export const fracture: Fx<"fracture"> = async (raw, e) => {
  const ctx = stage(raw);
  const pose = ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  await bounded(ctx, ctx.scene.projectile(e.actorId, BOSS_ID, "spark"), 420);
  ctx.scene.hit(BOSS_ID);
  showRingMarks(ctx);
  await bounded(ctx, pose, 400);
  rest(ctx, e.actorId);
};

export const fractureReduced: Fx<"fracture"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.hit(BOSS_ID);
  showRingMarks(ctx);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/** The Chronist's Nudge: a card pushed back a slot (a Retrograde so touched comes apart on the Orrery's turn). */
export const nudge: Fx<"nudge"> = async (raw, e) => {
  const ctx = stage(raw);
  const pose = ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.strip.card(e.cardId, "delayed");
  await bounded(ctx, pose, 360);
  rest(ctx, e.actorId);
};

export const nudgeReduced: Fx<"nudge"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.strip.card(e.cardId, "delayed");
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/** A Reaction's counter-blow: a number on the Orrery, and its rings and bar where the server has them. */
export const sting: Fx<"sting"> = async (raw, e) => {
  const ctx = stage(raw);
  await bounded(ctx, ctx.scene.projectile(e.actorId, BOSS_ID, "spark"), 360);
  ctx.scene.hit(BOSS_ID);
  ctx.scene.number(BOSS_ID, e.amount, "harm", e.seq);
  showRings(ctx);
};

export const stingReduced: Fx<"sting"> = (raw, e) => {
  const ctx = stage(raw);
  ctx.scene.hit(BOSS_ID);
  ctx.scene.number(BOSS_ID, e.amount, "harm", e.seq);
  showRings(ctx);
};

// --- the actions that move something on the strip ---------------------------------------

/** Anchor: the Warden pulls the next targeted card onto themself (it visibly retargets). */
export const anchor: Fx<"anchor"> = async (raw, e) => {
  const ctx = stage(raw);
  begins(ctx, e.actorId);
  await bounded(ctx, ctx.scene.windUp(e.actorId), 300);
  ctx.strip.card(e.cardId, "retargeted");
  await bounded(ctx, ctx.scene.frame(e.actorId, "guard"), 500);
  rest(ctx, e.actorId);
};

export const anchorReduced: Fx<"anchor"> = async (raw, e) => {
  const ctx = stage(raw);
  begins(ctx, e.actorId);
  ctx.strip.card(e.cardId, "retargeted");
  void ctx.scene.frame(e.actorId, "guard");
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/** A cast, by whoever's role casts: the pose, then back to idle. */
async function cast(ctx: EffectContext, actorId: string): Promise<void> {
  begins(ctx, actorId);
  await bounded(ctx, ctx.scene.windUp(actorId), 300);
  void ctx.scene.frame(actorId, castFor(roleOf(ctx, actorId)));
}

function castReduced(ctx: EffectContext, actorId: string): void {
  begins(ctx, actorId);
  void ctx.scene.frame(actorId, castFor(roleOf(ctx, actorId)));
}

/** Quicken: an ally's wait is cut, and their portrait moves up the strip (already drawn there), trailing afterimages. */
export const quicken: Fx<"quicken"> = async (raw, e) => {
  const ctx = stage(raw);
  await cast(ctx, e.actorId);
  ctx.strip.flag(e.targetId, "quickened");
  await bounded(ctx, ctx.strip.afterimage(e.targetId), 500);
  rest(ctx, e.actorId);
};

export const quickenReduced: Fx<"quicken"> = async (raw, e) => {
  const ctx = stage(raw);
  castReduced(ctx, e.actorId);
  ctx.strip.flag(e.targetId, "quickened");
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/** Delay: the Chronist pushes a boss card back. */
export const delay: Fx<"delay"> = async (raw, e) => {
  const ctx = stage(raw);
  await cast(ctx, e.actorId);
  ctx.strip.card(e.cardId, "delayed");
  await ctx.wait(360);
  rest(ctx, e.actorId);
};

export const delayReduced: Fx<"delay"> = async (raw, e) => {
  const ctx = stage(raw);
  castReduced(ctx, e.actorId);
  ctx.strip.card(e.cardId, "delayed");
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/** Relay: the Chronist ends their turn and hands a bonus to the next player portrait (or to nobody, if there's none). */
export const relay: Fx<"relay"> = async (raw, e) => {
  const ctx = stage(raw);
  await cast(ctx, e.actorId);
  ctx.strip.flag(e.toId ?? e.actorId, "relayed");
  if (e.toId) await bounded(ctx, ctx.strip.afterimage(e.toId), 420);
  rest(ctx, e.actorId);
};

export const relayReduced: Fx<"relay"> = async (raw, e) => {
  const ctx = stage(raw);
  castReduced(ctx, e.actorId);
  ctx.strip.flag(e.toId ?? e.actorId, "relayed");
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/** Stillpoint: a boss card is frozen for a cycle. */
export const stillpoint: Fx<"stillpoint"> = async (raw, e) => {
  const ctx = stage(raw);
  await cast(ctx, e.actorId);
  await bounded(ctx, ctx.scene.hitStop(), 160);
  ctx.strip.card(e.cardId, "frozen");
  await ctx.wait(360);
  rest(ctx, e.actorId);
};

export const stillpointReduced: Fx<"stillpoint"> = async (raw, e) => {
  const ctx = stage(raw);
  castReduced(ctx, e.actorId);
  ctx.strip.card(e.cardId, "frozen");
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

// --- the Orrery's strip moves -----------------------------------------------------------

/** Retrograde: the next five slots flip (already drawn flipped), or a Chronist's touch makes it come apart. */
export const retrograde: Fx<"retrograde"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.audio.play("revolution");
  void ctx.scene.frame(BOSS_ID, "attack");
  if (e.flipped) await bounded(ctx, ctx.scene.spinUp(), 400);
  ctx.strip.retrograde(e.flipped, e.cancelledBy, e.slots ?? []);
  await ctx.wait(500);
  rest(ctx, BOSS_ID);
};

export const retrogradeReduced: Fx<"retrograde"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.audio.play("revolution");
  void ctx.scene.frame(BOSS_ID, "attack");
  ctx.strip.retrograde(e.flipped, e.cancelledBy, e.slots ?? []);
  await ctx.wait(HOLD);
  rest(ctx, BOSS_ID);
};

/** An Alignment resolves: the clock grows toward the wipe, or reaches it. The downs that follow are their own events. */
export const alignment: Fx<"alignment"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.audio.play("revolution");
  void ctx.scene.frame(BOSS_ID, "attack");
  await bounded(ctx, ctx.scene.spinUp(), 400);
  ctx.strip.alignment(e.countdown, e.wipe);
  if (e.wipe) await bounded(ctx, Promise.all([ctx.scene.pulse(), ctx.scene.shake("heavy")]), 700);
  else await ctx.wait(360);
  rest(ctx, BOSS_ID);
};

export const alignmentReduced: Fx<"alignment"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.audio.play("revolution");
  void ctx.scene.frame(BOSS_ID, "attack");
  ctx.strip.alignment(e.countdown, e.wipe);
  await ctx.wait(HOLD);
  rest(ctx, BOSS_ID);
};

export const STRIP: AreaRenderers = {
  renderers: {
    plate: { full: plate, reduced: plate },
    card: { full: card, reduced: card },
    chain: { full: chain, reduced: chain },
    resonance: { full: resonance, reduced: resonanceReduced },
    reaction: { full: reaction, reduced: reactionReduced },
    intercept: { full: intercept, reduced: interceptReduced },
    veil: { full: veil, reduced: veilReduced },
    riposte: { full: riposte, reduced: riposteReduced },
    fracture: { full: fracture, reduced: fractureReduced },
    nudge: { full: nudge, reduced: nudgeReduced },
    sting: { full: sting, reduced: stingReduced },
    anchor: { full: anchor, reduced: anchorReduced },
    quicken: { full: quicken, reduced: quickenReduced },
    delay: { full: delay, reduced: delayReduced },
    relay: { full: relay, reduced: relayReduced },
    stillpoint: { full: stillpoint, reduced: stillpointReduced },
    retrograde: { full: retrograde, reduced: retrogradeReduced },
    alignment: { full: alignment, reduced: alignmentReduced },
  },
  // What each reduced renderer must draw ("me" the actor, "target" its
  // targetId, "card" its card's id; api.ts). Only state; never a motion.
  expected: {
    plate: [["strip.flag", "me", "plate"]],
    card: [["strip.card", "card", "announced"]],
    chain: [["strip.chain", "*", "*"]],
    resonance: [
      ["strip.jump", "me", "*", "*"],
      ["scene.number", "me", "*", "resonance"],
    ],
    reaction: [["strip.flag", "me", "reacted"]],
    intercept: [
      ["strip.card", "card", "retargeted"],
      ["scene.frame", "me", "guard"],
    ],
    veil: [
      ["strip.card", "card", "retargeted"],
      ["scene.ward", "target", true],
      ["scene.status", "target", "*"],
    ],
    riposte: [
      ["strip.card", "card", "retargeted"],
      ["scene.guard", "me", true],
      ["scene.ward", "me", true],
    ],
    fracture: [
      ["scene.hit", BOSS_ID],
      ["scene.ringMarks", "*", "*"],
    ],
    nudge: [["strip.card", "card", "delayed"]],
    sting: [
      ["scene.number", BOSS_ID, "*", "harm"],
      ["scene.rings", "*", "*"],
    ],
    anchor: [
      ["strip.card", "card", "retargeted"],
      ["scene.guard", "me", false],
      ["scene.frame", "me", "guard"],
    ],
    quicken: [
      ["strip.flag", "target", "quickened"],
      ["scene.guard", "me", false],
    ],
    delay: [
      ["strip.card", "card", "delayed"],
      ["scene.guard", "me", false],
    ],
    // the bonus goes to the next player portrait, or to nobody (toId null): the flag lands on whichever
    relay: [
      ["strip.flag", "*", "relayed"],
      ["scene.guard", "me", false],
    ],
    stillpoint: [
      ["strip.card", "card", "frozen"],
      ["scene.guard", "me", false],
    ],
    retrograde: [["strip.retrograde", "*", "*"]],
    alignment: [["strip.alignment", "*", "*"]],
  },
};
