// PHASE-ONE SHIM. REMOVE IN PHASE TWO.
//
// The overhaul's phase one (docs/adr/006) replaced the four roles with five,
// and the art hasn't followed: src/assets/sprites.json still holds sprites for
// the old four (bulwark, lancer, mender, herald). Until each new role has art
// of its own, it borrows the nearest old sprite through this one table, and
// nothing else in the client knows the borrowed names.
//
// spec/sprites.test.ts is red while any role here maps to anything but
// itself. That is on purpose: it is how phase two can't forget this file.
// Phase two gives every role its own sprite, deletes this table, and reads
// manifest.roles[role] directly.
import type { RoleId } from "../shared/protocol.ts";

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
