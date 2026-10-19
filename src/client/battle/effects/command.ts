// Phase two, area (b): the command window and the roles' surface. The events
// whose meaning is about your seat and your turn: hold (the server Braced for
// you), echo (a seat the server now plays, or no longer does). Each full
// variant is the choreography; each reduced variant shows the same state
// change with no movement, and declares that state in `expected` (review F25).
import type { AreaRenderers, EffectContext } from "../api.ts";
import { HOLD, bounded, rest, stage, tokenOf, type Fx } from "./kit.ts";

// --- hold -------------------------------------------------------------------------

/**
 * A turn ran out, and the server Braced for them (rule 8): the one safe action,
 * at Brace's rank, halving the next blow and banking a Charge. So the guard
 * goes UP, never down (review F6, F25): this is a Brace someone else took for
 * them. The portrait is stamped Held and the seat dims (drifting) until they
 * act again, and the hold cue sounds. Nothing flashes and no number pops, so it
 * can't read as a hit.
 */
function held(ctx: EffectContext, id: string): void {
  ctx.strip.flag(id, "held");
  ctx.scene.guard(id, true);
  ctx.scene.drifting(id, true);
  ctx.audio.play("hold");
}

export const hold: Fx<"hold"> = async (raw, e) => {
  const ctx = stage(raw);
  // The table's Brace, posed: the guard frame, slower than a Brace chosen.
  const pose = ctx.scene.frame(e.actorId, "guard");
  ctx.strip.flag(e.actorId, "held");
  ctx.audio.play("hold");
  await ctx.wait(240);
  ctx.scene.guard(e.actorId, true);
  ctx.scene.drifting(e.actorId, true);
  await bounded(ctx, pose, 700);
  rest(ctx, e.actorId);
};

export const holdReduced: Fx<"hold"> = async (raw, e) => {
  const ctx = stage(raw);
  void ctx.scene.frame(e.actorId, "guard");
  held(ctx, e.actorId);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

// --- echo -------------------------------------------------------------------------

/**
 * A seat becomes an Echo (three timeouts running: the server plays it, rule 8)
 * or stops being one (its person acted, and is back at the table). The sprite
 * is marked as the server's, so it can never be taken for a person, and the
 * portrait is stamped: Held as the server takes the seat, back as its person
 * reclaims it. A timed-out seat is drifting while it's an Echo and bright once
 * its person is back (economy.ts present()). The strip draws the Echo mark
 * itself from state (review R5); this is the moment it changes.
 */
function marked(ctx: EffectContext, id: string, on: boolean): void {
  // An Echo seated on purpose has no person to come back (rule 25); the state says which this is.
  const seated = (tokenOf(ctx, id)?.seatedBy ?? null) !== null;
  ctx.scene.echo(id, on, seated);
  ctx.scene.drifting(id, on);
  ctx.strip.flag(id, on ? "held" : "reclaimed");
}

export const echo: Fx<"echo"> = async (raw, e) => {
  const ctx = stage(raw);
  marked(ctx, e.actorId, e.on);
  // An afterimage peels off the sprite and its portrait: the person fading as
  // the Echo stands in, or the Echo dissolving as its person steps back. Kept
  // short when it ends, because their own action follows at once.
  await bounded(ctx, Promise.all([ctx.scene.afterimage(e.actorId), ctx.strip.afterimage(e.actorId)]), e.on ? 600 : 300);
  rest(ctx, e.actorId);
};

export const echoReduced: Fx<"echo"> = async (raw, e) => {
  const ctx = stage(raw);
  marked(ctx, e.actorId, e.on);
  await ctx.wait(HOLD);
  rest(ctx, e.actorId);
};

export const COMMAND: AreaRenderers = {
  renderers: {
    hold: { full: hold, reduced: holdReduced },
    echo: { full: echo, reduced: echoReduced },
  },
  expected: {
    // The server's Brace (guard up, never down), the Held stamp, the dimmed seat.
    hold: [
      ["scene.guard", "me", true],
      ["strip.flag", "me", "held"],
      ["scene.drifting", "me", true],
    ],
    // On or off, as the event says: the sprite's Echo mark, the seat's dimming, the portrait's stamp.
    echo: [
      ["scene.echo", "me", "*", "*"],
      ["scene.drifting", "me", "*"],
      ["strip.flag", "me", "*"],
    ],
  },
};
