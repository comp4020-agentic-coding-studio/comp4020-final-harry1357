// Every event kind the server can broadcast, and how the battle screen shows it:
// `full` with motion, `reduced` with the same state change and none (CLAUDE.md
// rule 11 and "Design: the battle screen"), and the state each reduced variant
// must produce (EXPECTED_STATE; review F25). The effects only ever draw
// through ctx.scene, ctx.strip and ctx.audio, so this module imports cleanly in
// Node. spec/shown.test.ts holds that every kind is here; spec/effects.test.ts
// holds that no reduced variant moves anything and that each makes its
// declared state.
//
// Phase two assembles it from three areas, each owning a disjoint set of
// kinds (OWNERS below), so no kind is drawn twice and none is forgotten.
import type { Expected, Registry } from "./api.ts";
import type { EventKind } from "../../shared/protocol.ts";
import { COMMAND } from "./effects/command.ts";
import { FEEL } from "./effects/feel.ts";
import { STRIP } from "./effects/strip.ts";
import { SHIM_RENDERERS } from "../sprites.ts";

/** Which area draws each event kind (phase two). Every kind in EVENT_KINDS appears exactly once. */
export const OWNERS: Readonly<Record<"strip" | "command" | "feel" | "shim", readonly EventKind[]>> = {
  // (a) the strip as the play surface: ./effects/strip.ts
  strip: ["plate", "card", "chain", "resonance", "reaction", "intercept", "anchor", "quicken", "delay", "relay", "stillpoint", "retrograde", "alignment"],
  // (b) the command window and the roles' surface: ./effects/command.ts
  command: ["hold", "echo"],
  // (c) the feel: ./effects/feel.ts (party.ts, orrery.ts, table.ts)
  feel: [
    "join", "seat", "leave", "down", "end", "brace", "exposed", "bastion", "counterweight", "mend", "ward", "restore",
    "cleave", "finisher", "feint", "scan", "pry", "mark", "shatter", "pull", "phase", "break", "revolution", "eclipse",
    "lunge", "gravity", "perihelion",
  ],
  // the phase-one shim, until Jab and Haste have animations of their own (src/client/sprites.ts)
  shim: ["jab", "haste"],
};

export const RENDERERS: Registry = {
  // Phase-one stand-ins that borrow another event's animation (src/client/sprites.ts).
  ...SHIM_RENDERERS,
  ...FEEL.renderers,
  ...STRIP.renderers,
  ...COMMAND.renderers,
};

export const EXPECTED_STATE: Expected = {
  ...FEEL.expected,
  ...STRIP.expected,
  ...COMMAND.expected,
};
