// The party's actions: jab, brace, mend, haste (the rest arrive in phase two). Each full variant is
// the choreography; each reduced variant shows the same state change with no
// movement (the key frame, the number in place, the bar set, the mark).
//
// Acting ends a Brace (rules.ts clears `braced` at the start of every turn), so
// every action but brace drops the actor's guard as it begins.
import type { EffectContext } from "../api.ts";
import { BOSS_ID } from "../../../shared/protocol.ts";
import { HOLD, bounded, castFor, projectileFor, rest, roleOf, showHp, showRings, stage, type Ev, type Fx } from "./kit.ts";

// --- strike and lunge -----------------------------------------------------------

/**
 * A blow on the Orrery. The attack frame is the very first call, before any
 * await: another browser must show it within one tick (spec/shown.test.ts).
 */
/** A blow by a party member on the Orrery. The overhaul's actions reuse this in phase two. */
interface Blow {
  actorId: string;
  amount: number;
  seq?: number;
}

async function blow(raw: EffectContext, e: Blow, heavy: boolean): Promise<void> {
  const ctx = stage(raw);
  const attack = ctx.scene.frame(e.actorId, "attack");
  ctx.scene.guard(e.actorId, false);
  ctx.audio.play("strike");
  if (heavy) void ctx.scene.pushIn();
  await ctx.wait(heavy ? 220 : 160);

  const kind = projectileFor(roleOf(ctx, e.actorId));
  await bounded(ctx, ctx.scene.projectile(e.actorId, BOSS_ID, kind), 520);

  ctx.scene.hit(BOSS_ID);
  if (kind === "slash" || kind === "thrust") void ctx.scene.slash(BOSS_ID);
  ctx.audio.play("hit");
  ctx.scene.number(BOSS_ID, e.amount, "harm", e.seq);
  showRings(ctx);
  await bounded(ctx, Promise.all([attack, ctx.scene.shake(heavy ? "heavy" : "light")]), heavy ? 700 : 600);
  rest(ctx, e.actorId);
}

async function blowReduced(raw: EffectContext, e: Blow): Promise<void> {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, "attack");
  ctx.scene.guard(e.actorId, false);
  ctx.audio.play("strike");
  ctx.scene.hit(BOSS_ID);
  ctx.audio.play("hit");
  ctx.scene.number(BOSS_ID, e.amount, "harm", e.seq);
  showRings(ctx);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
}

// The old strike and lunge events are gone (the overhaul's phase one). Jab is
// the nearest blow that still exists; the rest of the new actions get their
// renderers in phase two.
export const jab: Fx<"jab"> = (ctx, e) => blow(ctx, e, false);
export const jabReduced: Fx<"jab"> = blowReduced;

// --- brace ----------------------------------------------------------------------

export const brace: Fx<"brace"> = async (raw, e) => {
  const ctx = stage(raw);
  const pose = ctx.scene.frame(e.actorId, "guard");
  await ctx.wait(200);
  ctx.scene.guard(e.actorId, true);
  await bounded(ctx, pose, 700);
  rest(ctx, e.actorId);
};

export const braceReduced: Fx<"brace"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, "guard");
  ctx.scene.guard(e.actorId, true);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

// --- mend -----------------------------------------------------------------------

export const mend: Fx<"mend"> = async (raw, e) => {
  const ctx = stage(raw);
  const cast = ctx.scene.frame(e.actorId, castFor(roleOf(ctx, e.actorId)));
  ctx.scene.guard(e.actorId, false);
  await ctx.wait(200);
  // Mending yourself sends nothing across the field.
  if (e.targetId !== e.actorId) await bounded(ctx, ctx.scene.projectile(e.actorId, e.targetId, "spark"), 520);
  else await ctx.wait(160);
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

// --- haste (the Chronist's; was the Herald's hasten) ------------------------------

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
