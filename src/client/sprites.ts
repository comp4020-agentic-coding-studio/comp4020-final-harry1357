// PHASE-ONE SHIM. REMOVE IN PHASE TWO.
//
// Two stand-ins live in this one file, and nothing else in the client knows
// either of them.
//
// 1. Sprites. The overhaul's phase one (docs/adr/006) replaced the four roles
//    with five, and the art hasn't followed: src/assets/sprites.json still
//    holds sprites for the old four (bulwark, lancer, mender, herald). Until
//    each new role has art of its own, it borrows the nearest old sprite
//    through SPRITE_FOR.
//
// 2. Renderers. Jab and Haste are new events that already draw something,
//    but only because they borrow the old Strike and Hasten animations, which
//    were written for other actions. SHIM_RENDERERS registers them; registry.ts
//    spreads it in. They're stand-ins for phase one only: Jab deserves its
//    own quick blow, not Strike's, and Haste its own two-wait mark.
//
// spec/sprites.test.ts is red while any role here borrows another's sprite,
// and while SHIM_RENDERERS holds anything. That is on purpose: it is how phase
// two can't forget this file. Phase two gives every role its own sprite and
// every event its own renderer, then deletes this file.
import type { RoleId } from "../shared/protocol.ts";
import type { Registry } from "./battle/api.ts";
import * as party from "./battle/effects/party.ts";

/** The sprite in src/assets/sprites.json each role is drawn with, for now. */
export const SPRITE_FOR: Readonly<Record<RoleId, string>> = {
  warden: "bulwark", // a shield and a plate: the old tank
  mender: "mender", // the only role whose art carried over
  striker: "lancer", // the old heavy hitter
  breaker: "herald", // the quick one, for now
  chronist: "herald", // shares the Herald with the Breaker until it has its own
};

/** The sprite name for a role (or the Orrery, which is drawn separately). */
export function spriteFor(role: RoleId | "orrery" | undefined): string | undefined {
  return role && role !== "orrery" ? SPRITE_FOR[role] : role;
}

/**
 * Renderers that borrow another event's animation, for phase one only. Jab
 * plays the old Strike's blow and Haste the old Hasten's mark. registry.ts
 * spreads this into RENDERERS; spec/sprites.test.ts is red while it isn't empty.
 */
export const SHIM_RENDERERS: Registry = {
  jab: { full: party.jab, reduced: party.jabReduced }, // the old Strike's blow
  haste: { full: party.haste, reduced: party.hasteReduced }, // the old Hasten's mark
};
