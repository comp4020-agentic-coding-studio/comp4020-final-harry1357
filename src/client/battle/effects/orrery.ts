// The Orrery's turns and what happens to it: Eclipse and Lunge (one target),
// Revolution and Perihelion (everyone standing), Gravity, the pull, its
// phases, and a ring breaking. The bars come from ctx.state, which is already
// the state after the blow: a character it downs is in `fallen` with 0 hp, and
// their down event follows this one.
//
// The screen shakes only for the raid-wide blows (Revolution, Perihelion) and
// a lethal Gravity, never for one target, and never under reduced motion. A
// card spent on someone who has fallen or left passes over (rule 19, review
// R1): the Orrery moves, and nothing lands on anyone: no flash, no number.
import type { EffectContext } from "../api.ts";
import type { Hit } from "../../../shared/protocol.ts";
import { BOSS_ID } from "../../../shared/protocol.ts";
import { HOLD, bounded, harmTone, impact, rest, showHp, showMarks, showRingMarks, showRings, showWard, stage, type Fx } from "./kit.ts";

// --- one target: eclipse and lunge ---------------------------------------------------

interface Single {
  targetId: string;
  amount: number;
  seq?: number;
  spent?: true;
}

/** The Orrery gathers, leans in, sends its blow, and it lands: flash, hold, number, bar, marks. */
async function strike(raw: EffectContext, e: Single, bolt: "bolt" | "thrust"): Promise<void> {
  const ctx = stage(raw);
  // anticipation
  await bounded(ctx, ctx.scene.windUp(BOSS_ID), 300);
  void ctx.scene.frame(BOSS_ID, "attack");
  if (e.spent) {
    // Nobody stands where the card was aimed: it passes over the table.
    await bounded(ctx, ctx.scene.afterimage(BOSS_ID), 480);
    showHp(ctx, e.targetId);
    return;
  }
  await ctx.wait(120);
  await bounded(ctx, ctx.scene.projectile(BOSS_ID, e.targetId, bolt), 520);
  // impact
  if (bolt === "thrust") void ctx.scene.pushIn();
  const hurt = ctx.scene.frame(e.targetId, "hurt");
  ctx.audio.play("hit");
  await impact(ctx, e.targetId);
  // follow-through
  ctx.scene.number(e.targetId, e.amount, harmTone(e.amount), e.seq);
  showHp(ctx, e.targetId);
  showWard(ctx, e.targetId);
  showMarks(ctx, e.targetId);
  await bounded(ctx, hurt, 500);
  rest(ctx, e.targetId);
}

async function strikeReduced(raw: EffectContext, e: Single): Promise<void> {
  const ctx = stage(raw);
  void ctx.scene.frame(BOSS_ID, "attack");
  showHp(ctx, e.targetId);
  if (!e.spent) {
    void ctx.scene.frame(e.targetId, "hurt");
    ctx.scene.hit(e.targetId);
    ctx.audio.play("hit");
    ctx.scene.number(e.targetId, e.amount, harmTone(e.amount), e.seq);
    showWard(ctx, e.targetId);
  }
  showMarks(ctx, e.targetId);
  await ctx.wait(HOLD);
  rest(ctx, e.targetId);
}

export const eclipse: Fx<"eclipse"> = (ctx, e) => strike(ctx, e, "bolt");
export const eclipseReduced: Fx<"eclipse"> = (ctx, e) => strikeReduced(ctx, e);

/** Lunge: Eclipse's shape with a spear's thrust, and a Gravity stack on its mark. */
export const lunge: Fx<"lunge"> = (ctx, e) => strike(ctx, e, "thrust");
export const lungeReduced: Fx<"lunge"> = (ctx, e) => strikeReduced(ctx, e);

// --- gravity: the well's third stack ---------------------------------------------------

/** Lethal: the well crushes its mark (their down follows), and the field shakes. Anchored: the Warden holds it. */
export const gravity: Fx<"gravity"> = async (raw, e) => {
  const ctx = stage(raw);
  if (e.lethal) {
    await bounded(ctx, ctx.scene.windUp(BOSS_ID), 300);
    void ctx.scene.frame(BOSS_ID, "attack");
    const hurt = ctx.scene.frame(e.targetId, "hurt");
    ctx.audio.play("revolution");
    void ctx.scene.shake("heavy");
    await impact(ctx, e.targetId, 220);
    showHp(ctx, e.targetId);
    showMarks(ctx, e.targetId);
    await bounded(ctx, hurt, 500);
  } else {
    const pose = ctx.scene.frame(e.targetId, "guard");
    await bounded(ctx, ctx.scene.windUp(e.targetId), 240);
    showMarks(ctx, e.targetId);
    await bounded(ctx, pose, 500);
  }
  rest(ctx, e.targetId);
};

export const gravityReduced: Fx<"gravity"> = async (raw, e) => {
  const ctx = stage(raw);
  if (e.lethal) {
    void ctx.scene.frame(BOSS_ID, "attack");
    void ctx.scene.frame(e.targetId, "hurt");
    ctx.scene.hit(e.targetId);
    ctx.audio.play("revolution");
    showHp(ctx, e.targetId);
  } else {
    void ctx.scene.frame(e.targetId, "guard");
  }
  showMarks(ctx, e.targetId);
  await ctx.wait(HOLD);
  rest(ctx, e.targetId);
};

// --- revolution and perihelion ----------------------------------------------------------

/**
 * Raid-wide: the Orrery gathers and spins up, a pulse sweeps the field, the
 * field shakes and holds on the first impact, then each hit lands in the
 * order sent (a blow a Ward took is drawn as the Ward's).
 */
async function sweep(ctx: EffectContext, hits: readonly Hit[], seq: number | undefined): Promise<void> {
  ctx.audio.play("revolution");
  void ctx.scene.windUp(BOSS_ID);
  void ctx.scene.spinUp();
  await ctx.wait(260);
  void ctx.scene.frame(BOSS_ID, "attack");
  void ctx.scene.pulse();
  await ctx.wait(240);

  void ctx.scene.shake("heavy");
  const hurts: unknown[] = hits.map((hit) => ctx.scene.frame(hit.targetId, "hurt"));
  for (const hit of hits) ctx.scene.hit(hit.targetId);
  await bounded(ctx, ctx.scene.hitStop(), 180);

  // However many are standing, the numbers land in about 0.5 s.
  const step = Math.min(160, Math.floor(500 / Math.max(1, hits.length)));
  for (const hit of hits) {
    ctx.scene.number(hit.targetId, hit.amount, harmTone(hit.amount), seq);
    showHp(ctx, hit.targetId);
    showWard(ctx, hit.targetId);
    showMarks(ctx, hit.targetId);
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
    ctx.scene.number(hit.targetId, hit.amount, harmTone(hit.amount), seq);
    showWard(ctx, hit.targetId);
    showMarks(ctx, hit.targetId);
  }
  await ctx.wait(HOLD);
  for (const hit of hits) rest(ctx, hit.targetId);
}

export const revolution: Fx<"revolution"> = (raw, e) => sweep(stage(raw), e.hits ?? [], e.seq);
export const revolutionReduced: Fx<"revolution"> = (raw, e) => sweepReduced(stage(raw), e.hits ?? [], e.seq);

/** Perihelion: the Orrery swings in close (a push-in) and burns everyone; its outer ring's shield is the Break check. */
export const perihelion: Fx<"perihelion"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.pushIn();
  await sweep(ctx, e.hits ?? [], e.seq);
  showRingMarks(ctx);
};

export const perihelionReduced: Fx<"perihelion"> = async (raw, e) => {
  const ctx = stage(raw);
  showRingMarks(ctx);
  await sweepReduced(ctx, e.hits ?? [], e.seq);
};

// --- the pull, the phases, a Break -------------------------------------------------------

/** The fight begins: the Orrery's HP is set from the seats present, its rings shielded, phase one. */
export const pull: Fx<"pull"> = async (raw) => {
  const ctx = stage(raw);
  showRings(ctx);
  showRingMarks(ctx);
  ctx.scene.phase(ctx.state?.phase ?? 1);
  await bounded(ctx, ctx.scene.windUp(BOSS_ID), 300);
  void ctx.scene.spinUp();
  void ctx.scene.pulse();
  await ctx.wait(500);
};

export const pullReduced: Fx<"pull"> = async (raw) => {
  const ctx = stage(raw);
  showRings(ctx);
  showRingMarks(ctx);
  ctx.scene.phase(ctx.state?.phase ?? 1);
  await ctx.wait(HOLD);
};

/** A phase line crossed: the Orrery's look changes (the Conjunction's pointers, the Alignment's line). */
export const phase: Fx<"phase"> = async (raw, e) => {
  const ctx = stage(raw);
  await bounded(ctx, ctx.scene.windUp(BOSS_ID), 300);
  void ctx.scene.spinUp();
  void ctx.scene.pushIn();
  ctx.scene.phase(e.phase);
  void ctx.scene.pulse();
  await ctx.wait(600);
};

export const phaseReduced: Fx<"phase"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.scene.phase(e.phase);
  await ctx.wait(HOLD);
};

/** A ring's shield gone: it cracks and dims on the Orrery, with a flash and a hold. */
export const breakRing: Fx<"break"> = async (raw) => {
  const ctx = stage(raw);
  void ctx.scene.pushIn();
  showRingMarks(ctx);
  ctx.audio.play("hit");
  await impact(ctx, BOSS_ID, 220);
  void ctx.scene.spinUp();
  await ctx.wait(360);
};

export const breakRingReduced: Fx<"break"> = async (raw) => {
  const ctx = stage(raw);
  showRingMarks(ctx);
  ctx.scene.hit(BOSS_ID);
  ctx.audio.play("hit");
  await ctx.wait(HOLD);
};

/** An Exposed stack set or spent: the ring's pips in the setter's shape and colour, drawn as the state now holds them. */
export const exposed: Fx<"exposed"> = async (raw) => {
  const ctx = stage(raw);
  showRingMarks(ctx);
  await ctx.wait(260);
};

export const exposedReduced: Fx<"exposed"> = async (raw) => {
  const ctx = stage(raw);
  showRingMarks(ctx);
  await ctx.wait(HOLD);
};
