// Who is at the table and how the fight stands: join, seat, leave, down, end
// (hold and echo are the command area's, in ./command.ts; plate the strip's,
// in ./strip.ts). Mostly marks and entrances, so most full and reduced
// variants differ only in how long they let the moment sit.
import type { EffectContext } from "../api.ts";
import { BOSS_ID } from "../../../shared/protocol.ts";
import { HOLD, bounded, impact, showHp, showRings, showSeat, stage, tokenOf, type Fx } from "./kit.ts";

// --- join, seat and leave -----------------------------------------------------------

/** A seat taken: the sprite arrives with the bar it has and every mark the server holds on it. */
function arrive(ctx: EffectContext, id: string): void {
  ctx.scene.arrive(id);
  showHp(ctx, id);
  showSeat(ctx, id);
  showRings(ctx);
}

export const join: Fx<"join"> = async (raw, e) => {
  const ctx = stage(raw);
  arrive(ctx, e.actorId);
  await ctx.wait(400);
};

export const joinReduced: Fx<"join"> = async (raw, e) => {
  const ctx = stage(raw);
  arrive(ctx, e.actorId);
  await ctx.wait(HOLD);
};

/**
 * An Echo seated on purpose (rule 25): it arrives already marked as the
 * Echo's, the scan-lined ghost with ECHO on its plate, so there is no moment
 * it could be taken for a person.
 */
function seatEcho(ctx: EffectContext, id: string): void {
  arrive(ctx, id);
  ctx.scene.echo(id, true, true);
}

export const seat: Fx<"seat"> = async (raw, e) => {
  const ctx = stage(raw);
  seatEcho(ctx, e.actorId);
  await bounded(ctx, ctx.scene.afterimage(e.actorId), 480);
  await ctx.wait(200);
};

export const seatReduced: Fx<"seat"> = async (raw, e) => {
  const ctx = stage(raw);
  seatEcho(ctx, e.actorId);
  await ctx.wait(HOLD);
};

export const leave: Fx<"leave"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.scene.depart(e.actorId);
  await ctx.wait(400);
};

export const leaveReduced: Fx<"leave"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.scene.depart(e.actorId);
  await ctx.wait(HOLD);
};

// --- down -------------------------------------------------------------------------

/** Laid down and greyed, the bar empty, and nothing pending on them (rules.ts clears every mark). */
function fall(ctx: EffectContext, id: string): void {
  ctx.scene.down(id);
  showHp(ctx, id);
  ctx.scene.guard(id, false);
  ctx.scene.haste(id, false);
  ctx.scene.ward(id, false);
  ctx.scene.status(id, []);
}

export const down: Fx<"down"> = async (raw, e) => {
  const ctx = stage(raw);
  fall(ctx, e.actorId);
  await ctx.wait(450);
};

export const downReduced: Fx<"down"> = async (raw, e) => {
  const ctx = stage(raw);
  fall(ctx, e.actorId);
  await ctx.wait(HOLD);
};

// --- end --------------------------------------------------------------------------

const OUTCOME_LINES = {
  won: "Victory. The Orrery grinds to a halt.",
  lost: "Defeat. The Orrery keeps turning.",
  abandoned: "Abandoned. Nobody is left at the table.",
} as const;

function outcomeLine(outcome: string): string {
  return OUTCOME_LINES[outcome as keyof typeof OUTCOME_LINES] ?? "The fight is over.";
}

/** On a win the Orrery comes apart: every segment shed. */
function apart(ctx: EffectContext): void {
  ctx.scene.rings(0, tokenOf(ctx, BOSS_ID)?.maxHp ?? 1);
}

export const end: Fx<"end"> = async (raw, e) => {
  const ctx = stage(raw);
  if (e.outcome === "won") {
    // The last blow lands: a flash, a long hold, then it comes apart.
    ctx.audio.play("hit");
    await impact(ctx, BOSS_ID, 240);
    void ctx.scene.pushIn();
    await ctx.wait(240);
    apart(ctx);
  } else if (e.outcome === "lost") {
    void ctx.scene.frame(BOSS_ID, "attack");
    void ctx.scene.spinUp();
    await ctx.wait(300);
  }
  ctx.scene.banner(outcomeLine(e.outcome));
  await ctx.wait(600);
};

export const endReduced: Fx<"end"> = async (raw, e) => {
  const ctx = stage(raw);
  if (e.outcome === "won") apart(ctx);
  ctx.scene.banner(outcomeLine(e.outcome));
  await ctx.wait(HOLD);
};
