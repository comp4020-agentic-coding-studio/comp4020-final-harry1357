// The party's actions. Each full variant is the choreography the design record
// asks for (docs/design/overhaul.md, Priority 5): anticipation (windUp, a
// 200-300 ms gathering), impact (the flash and a hit-stop of a few frames), and
// follow-through (the number pops, the bar's ghost drains, the marks land).
// Each reduced variant shows the same end state with no movement at all: the
// key frame, the number in place, the bar set, the mark drawn. No action here
// shakes the screen: that is kept for the Orrery's raid-wide blows.
//
// Acting ends a Brace (rules.ts clears `braced` at the start of every turn), so
// every action but brace drops the actor's guard as it begins.
import type { Anim, EffectContext, Tone } from "../api.ts";
import { BOSS_ID } from "../../../shared/protocol.ts";
import {
  HOLD,
  bounded,
  castFor,
  impact,
  isStanding,
  projectileFor,
  rest,
  roleOf,
  showHp,
  showMarks,
  showRingMarks,
  showRings,
  showSeat,
  stage,
  tokenOf,
  type Fx,
} from "./kit.ts";

// --- blows on the Orrery ------------------------------------------------------------

/** A blow by a party member on the Orrery: Jab, Cleave, Finisher, Feint, Counterweight. */
interface Blow {
  actorId: string;
  amount: number;
  seq?: number;
}

/** How a blow lands: how long it gathers, how hard it hits, what its number means. */
interface Look {
  weight: "quick" | "standard" | "heavy";
  tone: Tone;
  /** The sprite's animation for this blow: its own where its sheet has one (a Striker's jab), else the attack. */
  anim?: Anim;
  /** It changed the ring it struck (pips, stacks), so the ring's marks are redrawn as it lands. */
  ring?: boolean;
}

const GATHER = { quick: 160, standard: 240, heavy: 300 } as const;

/**
 * The attack frame is the very first call, before any await: another browser
 * must show it within one tick (spec/shown.test.ts times it on a Jab).
 */
async function blow(raw: EffectContext, e: Blow, look: Look): Promise<void> {
  const ctx = stage(raw);
  const attack = ctx.scene.frame(e.actorId, look.anim ?? "attack");
  ctx.scene.guard(e.actorId, false);
  ctx.audio.play("strike");
  // anticipation
  await bounded(ctx, ctx.scene.windUp(e.actorId), GATHER[look.weight]);
  const kind = projectileFor(roleOf(ctx, e.actorId));
  await bounded(ctx, ctx.scene.projectile(e.actorId, BOSS_ID, kind), 520);
  // impact
  if (look.weight === "heavy") void ctx.scene.pushIn();
  if (kind === "slash" || kind === "thrust") void ctx.scene.slash(BOSS_ID);
  ctx.audio.play("hit");
  await impact(ctx, BOSS_ID, look.weight === "heavy" ? 220 : 160);
  // follow-through
  ctx.scene.number(BOSS_ID, e.amount, look.tone, e.seq);
  showRings(ctx);
  if (look.ring) showRingMarks(ctx);
  await bounded(ctx, attack, look.weight === "heavy" ? 700 : 560);
  rest(ctx, e.actorId);
}

async function blowReduced(raw: EffectContext, e: Blow, look: Look): Promise<void> {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, look.anim ?? "attack");
  ctx.scene.guard(e.actorId, false);
  ctx.audio.play("strike");
  ctx.scene.hit(BOSS_ID);
  ctx.audio.play("hit");
  ctx.scene.number(BOSS_ID, e.amount, look.tone, e.seq);
  showRings(ctx);
  if (look.ring) showRingMarks(ctx);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
}

/**
 * A signature move spent the actor's Charge (rule 17, ADR-011): its meter mark is redrawn from state before the
 * renderer returns, so the spend is shown before its log line ("…3 Charge behind it…") is written (rule 11;
 * the gate's C1). The conductor's reconcile comes only after the queue drains, after the line.
 */
async function spends(raw: EffectContext, actorId: string, drawn: Promise<void> | void): Promise<void> {
  await drawn;
  showMarks(stage(raw), actorId);
}

// Jab: the Striker's own quick blow (its sheet's jab: ready, lunge, recover,
// without the attack's wind-up), rank 1, gathering the least.
const JAB: Look = { weight: "quick", tone: "harm", anim: "jab" };
export const jab: Fx<"jab"> = (ctx, e) => blow(ctx, e, JAB);
export const jabReduced: Fx<"jab"> = (ctx, e) => blowReduced(ctx, e, JAB);

/** Cleave: a weakness struck is a Resonance, drawn gold with its star. */
const cleaveLook = (e: { weakness: boolean }): Look => ({ weight: "standard", tone: e.weakness ? "resonance" : "harm", ring: true });
export const cleave: Fx<"cleave"> = (ctx, e) => blow(ctx, e, cleaveLook(e));
export const cleaveReduced: Fx<"cleave"> = (ctx, e) => blowReduced(ctx, e, cleaveLook(e));

/** Finisher: everything banked, at once. Double, and a Resonance, on a Broken ring. */
const finisherLook = (e: { broken: boolean }): Look => ({ weight: "heavy", tone: e.broken ? "resonance" : "harm", ring: true });
export const finisher: Fx<"finisher"> = (ctx, e) => spends(ctx, e.actorId, blow(ctx, e, finisherLook(e)));
export const finisherReduced: Fx<"finisher"> = (ctx, e) => spends(ctx, e.actorId, blowReduced(ctx, e, finisherLook(e)));

/** Feint: an Exposed stack spent for a sure Resonance. */
const FEINT: Look = { weight: "quick", tone: "resonance", ring: true };
export const feint: Fx<"feint"> = (ctx, e) => blow(ctx, e, FEINT);
export const feintReduced: Fx<"feint"> = (ctx, e) => blowReduced(ctx, e, FEINT);

/** Counterweight: the Warden strikes, and the ring is left Exposed. */
const COUNTERWEIGHT: Look = { weight: "standard", tone: "harm", ring: true };
export const counterweight: Fx<"counterweight"> = (ctx, e) => blow(ctx, e, COUNTERWEIGHT);
export const counterweightReduced: Fx<"counterweight"> = (ctx, e) => blowReduced(ctx, e, COUNTERWEIGHT);

// --- the Breaker's work on the rings ----------------------------------------------

/** A Breaker's action at a ring: what crosses, whether it strikes, how hard. */
interface RingWork {
  pose: "attack" | "cast";
  bolt: "bolt" | "spark";
  strikes: boolean;
  heavy: boolean;
}

async function ringWork(raw: EffectContext, e: { actorId: string }, w: RingWork): Promise<void> {
  const ctx = stage(raw);
  const pose = ctx.scene.frame(e.actorId, w.pose === "cast" ? castFor(roleOf(ctx, e.actorId)) : "attack");
  ctx.scene.guard(e.actorId, false);
  ctx.audio.play("strike");
  await bounded(ctx, ctx.scene.windUp(e.actorId), w.heavy ? 300 : 240);
  await bounded(ctx, ctx.scene.projectile(e.actorId, BOSS_ID, w.bolt), 520);
  if (w.strikes) {
    if (w.heavy) void ctx.scene.pushIn();
    ctx.audio.play("hit");
    await impact(ctx, BOSS_ID, w.heavy ? 220 : 160);
  }
  showRingMarks(ctx);
  await bounded(ctx, pose, 560);
  rest(ctx, e.actorId);
}

async function ringWorkReduced(raw: EffectContext, e: { actorId: string }, w: RingWork): Promise<void> {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, w.pose === "cast" ? castFor(roleOf(ctx, e.actorId)) : "attack");
  ctx.scene.guard(e.actorId, false);
  ctx.audio.play("strike");
  if (w.strikes) {
    ctx.scene.hit(BOSS_ID);
    ctx.audio.play("hit");
  }
  showRingMarks(ctx);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
}

/** Scan: the ring's weakness is revealed to the room (its "?" becomes the element). */
const SCAN: RingWork = { pose: "cast", bolt: "spark", strikes: false, heavy: false };
export const scan: Fx<"scan"> = (ctx, e) => ringWork(ctx, e, SCAN);
export const scanReduced: Fx<"scan"> = (ctx, e) => ringWorkReduced(ctx, e, SCAN);

/** Pry: shield pips knocked out (hollow), maybe down to a Break. */
const PRY: RingWork = { pose: "attack", bolt: "bolt", strikes: true, heavy: false };
export const pry: Fx<"pry"> = (ctx, e) => ringWork(ctx, e, PRY);
export const pryReduced: Fx<"pry"> = (ctx, e) => ringWorkReduced(ctx, e, PRY);

/** Mark: two Exposed stacks set on the ring, in the Breaker's shape and colour. */
const MARK: RingWork = { pose: "cast", bolt: "spark", strikes: false, heavy: false };
export const mark: Fx<"mark"> = (ctx, e) => ringWork(ctx, e, MARK);
export const markReduced: Fx<"mark"> = (ctx, e) => ringWorkReduced(ctx, e, MARK);

/** Shatter: a ring broken outright. */
const SHATTER: RingWork = { pose: "attack", bolt: "bolt", strikes: true, heavy: true };
export const shatter: Fx<"shatter"> = (ctx, e) => spends(ctx, e.actorId, ringWork(ctx, e, SHATTER));
export const shatterReduced: Fx<"shatter"> = (ctx, e) => spends(ctx, e.actorId, ringWorkReduced(ctx, e, SHATTER));

// --- brace and bastion ----------------------------------------------------------------

export const brace: Fx<"brace"> = async (raw, e) => {
  const ctx = stage(raw);
  const pose = ctx.scene.frame(e.actorId, "guard");
  await bounded(ctx, ctx.scene.windUp(e.actorId), 200);
  ctx.scene.guard(e.actorId, true);
  showMarks(ctx, e.actorId); // the Brace, and the Charge it banked
  await bounded(ctx, pose, 700);
  rest(ctx, e.actorId);
};

export const braceReduced: Fx<"brace"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, "guard");
  ctx.scene.guard(e.actorId, true);
  showMarks(ctx, e.actorId);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/**
 * Bastion: the Warden plants itself against the next blow that falls on
 * everyone. The strip marks the card it will meet from the state (bastion,
 * bastionCard); this is the moment it goes up. A shimmer passes over everyone
 * standing.
 */
export const bastion: Fx<"bastion"> = async (raw, e) => {
  const ctx = stage(raw);
  const pose = ctx.scene.frame(e.actorId, "guard");
  ctx.scene.guard(e.actorId, false);
  await bounded(ctx, ctx.scene.windUp(e.actorId), 300);
  void ctx.scene.pushIn();
  const party = (ctx.state?.queue ?? []).filter((t) => t.kind === "character").map((t) => t.id);
  await bounded(ctx, Promise.all(party.map((id) => ctx.scene.afterimage(id))), 520);
  showMarks(ctx, e.actorId);
  await bounded(ctx, pose, 500);
  rest(ctx, e.actorId);
};

export const bastionReduced: Fx<"bastion"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, "guard");
  ctx.scene.guard(e.actorId, false);
  showMarks(ctx, e.actorId);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

// --- the Mender: mend, ward, restore -----------------------------------------------------

/** A Mender's cast toward an ally: gather, and send a mote across unless it's for themselves. */
async function castAt(ctx: EffectContext, actorId: string, targetId: string): Promise<void> {
  await bounded(ctx, ctx.scene.windUp(actorId), 240);
  if (targetId !== actorId) await bounded(ctx, ctx.scene.projectile(actorId, targetId, "spark"), 520);
  else await ctx.wait(120);
}

export const mend: Fx<"mend"> = async (raw, e) => {
  const ctx = stage(raw);
  const cast = ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.guard(e.actorId, false);
  await castAt(ctx, e.actorId, e.targetId);
  ctx.scene.number(e.targetId, e.amount, "heal", e.seq);
  showHp(ctx, e.targetId);
  await bounded(ctx, cast, 500);
  rest(ctx, e.actorId);
};

export const mendReduced: Fx<"mend"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.guard(e.actorId, false);
  ctx.scene.number(e.targetId, e.amount, "heal", e.seq);
  showHp(ctx, e.targetId);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/** Ward: a pane stands up in front of the ally, and its mark goes on their plate. */
export const ward: Fx<"ward"> = async (raw, e) => {
  const ctx = stage(raw);
  const cast = ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.guard(e.actorId, false);
  await castAt(ctx, e.actorId, e.targetId);
  ctx.scene.ward(e.targetId, true);
  showMarks(ctx, e.targetId);
  void ctx.scene.afterimage(e.targetId);
  await bounded(ctx, cast, 500);
  rest(ctx, e.actorId);
};

export const wardReduced: Fx<"ward"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.guard(e.actorId, false);
  ctx.scene.ward(e.targetId, true);
  showMarks(ctx, e.targetId);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

/** Restore: a fallen ally stands again, with the bar the server gave them. */
export const restore: Fx<"restore"> = async (raw, e) => {
  const ctx = stage(raw);
  const cast = ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.guard(e.actorId, false);
  await castAt(ctx, e.actorId, e.targetId);
  ctx.scene.arrive(e.targetId);
  showHp(ctx, e.targetId);
  showSeat(ctx, e.targetId);
  const t = tokenOf(ctx, e.targetId);
  if (t) ctx.scene.number(e.targetId, t.hp, "heal", e.seq);
  void ctx.scene.afterimage(e.targetId);
  showMarks(ctx, e.actorId); // the Charge it spent (the gate's C1)
  await bounded(ctx, cast, 500);
  rest(ctx, e.actorId);
  if (isStanding(ctx, e.targetId)) void ctx.scene.frame(e.targetId, "idle");
};

export const restoreReduced: Fx<"restore"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.guard(e.actorId, false);
  ctx.scene.arrive(e.targetId);
  showHp(ctx, e.targetId);
  showSeat(ctx, e.targetId);
  const t = tokenOf(ctx, e.targetId);
  if (t) ctx.scene.number(e.targetId, t.hp, "heal", e.seq);
  showMarks(ctx, e.actorId); // the Charge it spent (the gate's C1)
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

// --- haste (the Chronist's own cast) ----------------------------------------------------

/** Haste: the Chronist's own cast, the bow raised in its clock-circle, and the ally's next two waits marked halved. */
export const haste: Fx<"haste"> = async (raw, e) => {
  const ctx = stage(raw);
  const cast = ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.guard(e.actorId, false);
  await ctx.wait(240);
  ctx.scene.haste(e.targetId, true);
  await bounded(ctx, Promise.all([cast, ctx.scene.afterimage(e.targetId), ctx.strip.afterimage(e.targetId)]), 600);
  rest(ctx, e.actorId);
};

export const hasteReduced: Fx<"haste"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.guard(e.actorId, false);
  ctx.scene.haste(e.targetId, true);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};
