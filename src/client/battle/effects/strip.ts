// Phase two, area (a): the strip as the play surface. The events whose
// meaning is on the turn strip: a portrait reaching the plate, boss cards, the
// Chain, Resonance, Retrograde, the Alignment, and the actions that move
// someone or something on it. Each reduced variant shows the same state change
// with no movement, and declares that state in `expected` (review F25).
import type { AreaRenderers } from "../api.ts";
import { stage, type Fx } from "./kit.ts";

// --- plate ------------------------------------------------------------------------

/** Someone reached the strike plate. Instant: it must never hold up the strike that follows. */
export const plate: Fx<"plate"> = (raw, e) => {
  const ctx = stage(raw);
  ctx.audio.play("plate");
  ctx.strip.flag(e.actorId, "plate");
};


export const STRIP: AreaRenderers = {
  renderers: {
    plate: { full: plate, reduced: plate },
  },
  expected: {},
};
