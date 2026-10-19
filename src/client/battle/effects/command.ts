// Phase two, area (b): the command window and the roles' surface. The events
// whose meaning is about your seat and your turn: hold (the server Braced for
// you), echo (a seat the server now plays, or no longer does). Each full
// variant is the choreography; each reduced variant shows the same state
// change with no movement, and declares that state in `expected` (review F25).
import type { AreaRenderers, EffectContext } from "../api.ts";
import { HOLD, bounded, rest, stage, type Fx } from "./kit.ts";

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


export const COMMAND: AreaRenderers = {
  renderers: {
    hold: { full: hold, reduced: holdReduced },
  },
  expected: {},
};
