// Who is at the table and how the fight stands: join, leave, hold, down, plate,
// end. Mostly marks and entrances, so most full and reduced variants differ only
// in how long they let the moment sit.
import type { EffectContext } from "../api.ts";
import { BOSS_ID } from "../../../shared/protocol.ts";
import { HOLD, bounded, rest, showHp, showRings, stage, tokenOf, type Fx } from "./kit.ts";

// --- join and leave ---------------------------------------------------------------

/** A seat taken: the sprite arrives with the bar it has, and a first join grows the Orrery. */
function seat(ctx: EffectContext, id: string): void {
  ctx.scene.arrive(id);
  showHp(ctx, id);
  showRings(ctx);
}

export const join: Fx<"join"> = async (raw, e) => {
  const ctx = stage(raw);
  seat(ctx, e.actorId);
  await ctx.wait(400);
};

export const joinReduced: Fx<"join"> = async (raw, e) => {
  const ctx = stage(raw);
  seat(ctx, e.actorId);
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

// --- hold -------------------------------------------------------------------------

/**
 * The server held their turn. The idle breaks for a beat (a flinch: no flash,
 * no number, so it can't read as a hit), the strip marks the portrait it has
 * moved past, and the hold cue sounds. A hold also ends a Brace.
 */
export const hold: Fx<"hold"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.flag(e.actorId, "held");
  ctx.scene.guard(e.actorId, false);
  ctx.audio.play("hold");
  await ctx.wait(120);
  await bounded(ctx, ctx.scene.frame(e.actorId, "hurt"), 380);
  rest(ctx, e.actorId);
};

export const holdReduced: Fx<"hold"> = async (raw, e) => {
  const ctx = stage(raw);
  ctx.strip.flag(e.actorId, "held");
  ctx.scene.guard(e.actorId, false);
  ctx.audio.play("hold");
  await ctx.wait(HOLD);
};

// --- down -------------------------------------------------------------------------

/** Laid down and greyed, the bar empty, and nothing pending on them (rules.ts clears both marks). */
function fall(ctx: EffectContext, id: string): void {
  ctx.scene.down(id);
  showHp(ctx, id);
  ctx.scene.guard(id, false);
  ctx.scene.haste(id, false);
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

// --- plate ------------------------------------------------------------------------

/** Someone reached the strike plate. Instant: it must never hold up the strike that follows. */
export const plate: Fx<"plate"> = (raw, e) => {
  const ctx = stage(raw);
  ctx.audio.play("plate");
  ctx.strip.flag(e.actorId, "plate");
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
    ctx.scene.hit(BOSS_ID);
    ctx.audio.play("hit");
    await ctx.wait(300);
    apart(ctx);
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
