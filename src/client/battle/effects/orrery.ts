// The Orrery's turns: Eclipse (one bolt at the weakest), Revolution (everyone
// standing), and Perihelion (Revolution, and from then on it quickens). The
// bars come from ctx.state, which is already the state after the hit: a
// character the move downs is in `fallen` with 0 hp, and their down event
// follows this one.
import type { EffectContext } from "../api.ts";
import type { Hit } from "../../../shared/protocol.ts";
import { BOSS_ID } from "../../../shared/protocol.ts";
import { HOLD, bounded, rest, showHp, stage, type Fx } from "./kit.ts";

// --- eclipse --------------------------------------------------------------------

export const eclipse: Fx<"eclipse"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(BOSS_ID, "attack");
  await ctx.wait(160);
  await bounded(ctx, ctx.scene.projectile(BOSS_ID, e.targetId, "bolt"), 520);
  const hurt = ctx.scene.frame(e.targetId, "hurt");
  ctx.scene.hit(e.targetId);
  ctx.audio.play("hit");
  ctx.scene.number(e.targetId, e.amount, "harm", e.seq);
  showHp(ctx, e.targetId);
  await bounded(ctx, Promise.all([hurt, ctx.scene.shake("heavy")]), 600);
  rest(ctx, e.targetId);
};

export const eclipseReduced: Fx<"eclipse"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(BOSS_ID, "attack");
  void ctx.scene.frame(e.targetId, "hurt");
  ctx.scene.hit(e.targetId);
  ctx.audio.play("hit");
  ctx.scene.number(e.targetId, e.amount, "harm", e.seq);
  showHp(ctx, e.targetId);
  await ctx.wait(HOLD);
  rest(ctx, e.targetId);
};

// --- revolution and perihelion ----------------------------------------------------

/** The rings spin up, a pulse sweeps the field, then each hit lands in the order sent. */
async function sweep(ctx: EffectContext, hits: readonly Hit[], seq: number | undefined): Promise<void> {
  ctx.audio.play("revolution");
  void ctx.scene.frame(BOSS_ID, "attack");
  void ctx.scene.spinUp();
  await ctx.wait(260);
  void ctx.scene.pulse();
  await ctx.wait(260);

  // However many are standing, the sequence fits in about 0.6s.
  const step = Math.min(200, Math.floor(600 / Math.max(1, hits.length)));
  const hurts: unknown[] = [];
  for (const hit of hits) {
    hurts.push(ctx.scene.frame(hit.targetId, "hurt"));
    ctx.scene.hit(hit.targetId);
    showHp(ctx, hit.targetId);
    ctx.scene.number(hit.targetId, hit.amount, "harm", seq);
    await ctx.wait(step);
  }
  await bounded(ctx, Promise.all(hurts), 400);
  for (const hit of hits) rest(ctx, hit.targetId);
}

async function sweepReduced(ctx: EffectContext, hits: readonly Hit[], seq: number | undefined): Promise<void> {
  ctx.audio.play("revolution");
  void ctx.scene.frame(BOSS_ID, "attack");
  for (const hit of hits) {
    void ctx.scene.frame(hit.targetId, "hurt");
    ctx.scene.hit(hit.targetId);
    showHp(ctx, hit.targetId);
    ctx.scene.number(hit.targetId, hit.amount, "harm", seq);
  }
  await ctx.wait(HOLD);
  for (const hit of hits) rest(ctx, hit.targetId);
}

export const revolution: Fx<"revolution"> = (raw, e) => sweep(stage(raw), e.hits ?? [], e.seq);
export const revolutionReduced: Fx<"revolution"> = (raw, e) => sweepReduced(stage(raw), e.hits ?? [], e.seq);

/** Perihelion: it quickens (the hasted mark on the Orrery), then sweeps. */
export const perihelion: Fx<"perihelion"> = (raw, e) => {
  const ctx = stage(raw);
  ctx.scene.haste(BOSS_ID, true);
  return sweep(ctx, e.hits ?? [], e.seq);
};

export const perihelionReduced: Fx<"perihelion"> = (raw, e) => {
  const ctx = stage(raw);
  ctx.scene.haste(BOSS_ID, true);
  return sweepReduced(ctx, e.hits ?? [], e.seq);
};
