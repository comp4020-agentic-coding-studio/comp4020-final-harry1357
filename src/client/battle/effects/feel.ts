// Phase two, area (c): the feel. The events whose meaning is on the field:
// blows and boss attacks, heals and shields, the rings, seats arriving and
// falling, the pull, the phases, the end. Every action as anticipation, impact
// and follow-through; each reduced variant shows the same state change with no
// movement, and declares that state in `expected` (review F25). The renderers
// live in ./party.ts, ./orrery.ts and ./table.ts; this is their map.
import type { AreaRenderers, Expected } from "../api.ts";
import * as orrery from "./orrery.ts";
import * as party from "./party.ts";
import * as table from "./table.ts";

/** What every turn action shows of its actor: acting ends a Brace (rules.ts). */
const ACTED = ["scene.guard", "me", false] as const;

/** A blow on the Orrery: the actor's attack frame, the flash on the rings, the number. */
const blow = (tone: string) =>
  [["scene.frame", "me", "attack"], ACTED, ["scene.hit", "orrery"], ["scene.number", "orrery", "*", tone]] as const;

/** A raid-wide blow: the Orrery's move, and on everyone it hit a flash, a number and a bar. */
const RAID_WIDE = [
  ["scene.frame", "orrery", "attack"],
  ["scene.hit", "*"],
  ["scene.number", "*", "*", "*"],
  ["scene.hp", "*", "*", "*"],
] as const;

/**
 * A one-target card. A card spent on someone fallen or gone passes over and
 * draws no flash and no number (phase-two R1 holds that), so what every Eclipse
 * and Lunge shows is the Orrery's move and its mark's bar and marks as the
 * server now holds them (a Lunge's Gravity, a Ward it cleared).
 */
const ONE_TARGET = [["scene.frame", "orrery", "attack"], ["scene.hp", "target", "*", "*"], ["scene.status", "target", "*"]] as const;

/** The server's rings drawn on the Orrery's rings. */
const RINGS = ["scene.ringMarks", "*", "*"] as const;

const expected: Expected = {
  // the table
  join: [["scene.arrive", "me"], ["scene.hp", "me", "*", "*"]],
  seat: [["scene.arrive", "me"], ["scene.echo", "me", true, true]],
  leave: [["scene.depart", "me"]],
  down: [["scene.down", "me"], ["scene.ward", "me", false], ["scene.status", "me", "*"]],
  end: [["scene.banner", "*"]],
  // the economy
  brace: [["scene.frame", "me", "guard"], ["scene.guard", "me", true], ["scene.status", "me", "*"]],
  exposed: [RINGS],
  // the Warden
  bastion: [["scene.frame", "me", "guard"], ACTED],
  counterweight: [...blow("harm"), RINGS],
  // the Mender
  mend: [ACTED, ["scene.number", "target", "*", "heal"], ["scene.hp", "target", "*", "*"]],
  ward: [ACTED, ["scene.ward", "target", true], ["scene.status", "target", "*"]],
  restore: [ACTED, ["scene.arrive", "target"], ["scene.hp", "target", "*", "*"], ["scene.number", "target", "*", "heal"]],
  // the Striker (a weakness or a Broken ring struck is drawn as a Resonance)
  cleave: [...blow("*"), RINGS],
  finisher: [...blow("*"), RINGS],
  feint: [...blow("resonance"), RINGS],
  // the Breaker
  scan: [["scene.frame", "me", "*"], ACTED, RINGS],
  pry: [["scene.frame", "me", "attack"], ACTED, ["scene.hit", "orrery"], RINGS],
  mark: [["scene.frame", "me", "*"], ACTED, RINGS],
  shatter: [["scene.frame", "me", "attack"], ACTED, ["scene.hit", "orrery"], RINGS],
  // the Orrery
  pull: [["scene.rings", "*", "*"], ["scene.hp", "orrery", "*", "*"], RINGS, ["scene.phase", "*"]],
  phase: [["scene.phase", "*"]],
  break: [RINGS, ["scene.hit", "orrery"]],
  // each blow's card leaves the strip as it lands (the sample's isn't spent)
  revolution: [...RAID_WIDE, ["strip.card", "card", "resolved"]],
  perihelion: [...RAID_WIDE, RINGS, ["strip.card", "card", "resolved"]],
  eclipse: [...ONE_TARGET, ["strip.card", "card", "resolved"]],
  lunge: [...ONE_TARGET, ["strip.card", "card", "resolved"]],
  gravity: [["scene.frame", "target", "*"], ["scene.status", "target", "*"]],

  // The phase-one shim's two (src/client/sprites.ts registers them; their
  // renderers are this area's, in ./party.ts, so their states are declared
  // here until the shim is gone and they're registered with the rest).
  jab: [...blow("harm")],
  haste: [ACTED, ["scene.haste", "target", true]],
};

export const FEEL: AreaRenderers = {
  renderers: {
    join: { full: table.join, reduced: table.joinReduced },
    seat: { full: table.seat, reduced: table.seatReduced },
    leave: { full: table.leave, reduced: table.leaveReduced },
    down: { full: table.down, reduced: table.downReduced },
    end: { full: table.end, reduced: table.endReduced },
    brace: { full: party.brace, reduced: party.braceReduced },
    exposed: { full: orrery.exposed, reduced: orrery.exposedReduced },
    bastion: { full: party.bastion, reduced: party.bastionReduced },
    counterweight: { full: party.counterweight, reduced: party.counterweightReduced },
    mend: { full: party.mend, reduced: party.mendReduced },
    ward: { full: party.ward, reduced: party.wardReduced },
    restore: { full: party.restore, reduced: party.restoreReduced },
    cleave: { full: party.cleave, reduced: party.cleaveReduced },
    finisher: { full: party.finisher, reduced: party.finisherReduced },
    feint: { full: party.feint, reduced: party.feintReduced },
    scan: { full: party.scan, reduced: party.scanReduced },
    pry: { full: party.pry, reduced: party.pryReduced },
    mark: { full: party.mark, reduced: party.markReduced },
    shatter: { full: party.shatter, reduced: party.shatterReduced },
    pull: { full: orrery.pull, reduced: orrery.pullReduced },
    phase: { full: orrery.phase, reduced: orrery.phaseReduced },
    break: { full: orrery.breakRing, reduced: orrery.breakRingReduced },
    revolution: { full: orrery.revolution, reduced: orrery.revolutionReduced },
    eclipse: { full: orrery.eclipse, reduced: orrery.eclipseReduced },
    lunge: { full: orrery.lunge, reduced: orrery.lungeReduced },
    gravity: { full: orrery.gravity, reduced: orrery.gravityReduced },
    perihelion: { full: orrery.perihelion, reduced: orrery.perihelionReduced },
  },
  expected,
};
