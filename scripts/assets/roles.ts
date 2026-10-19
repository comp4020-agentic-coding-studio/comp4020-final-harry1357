// Which cells of each pack sheet are which animation. Read off numbered
// contact sheets of the real cells (not guessed from the GIFs, whose delta
// frames don't line up), and the one source both asset scripts work from.
// The art faces left; the party is mirrored on screen to face the Orrery.

export interface Animation {
  frames: number[];
  fps: number;
  loop: boolean;
}

export interface RoleArt {
  /** Where the pack art lives, relative to src/assets/. */
  dir: string;
  cell: [number, number];
  columns: number;
  /** The cell laid flat for the derived down frame (scripts/assets/derive-down.ts). */
  downFrom: number;
  animations: Record<"idle" | "attack" | "hurt", Animation> & Record<string, Animation>;
}

const anim = (from: number, to: number, fps: number, loop = false): Animation => ({
  frames: Array.from({ length: to - from + 1 }, (_, i) => from + i),
  fps,
  loop,
});

/** Keyed by role (docs/design/overhaul.md): each of the five draws its own sheet. */
export const ROLE_ART: Record<"warden" | "striker" | "mender" | "breaker" | "chronist", RoleArt> = {
  // "warrior2": the shield knight, the Warden
  warden: {
    dir: "party/warden",
    cell: [182, 123],
    columns: 6,
    // the knight is as wide as he is tall, so his recoil stands on end when
    // turned; his idle pose, turned, lies back with shield and boots up
    downFrom: 0,
    animations: { idle: anim(0, 5, 8, true), attack: anim(6, 11, 12), hurt: anim(22, 24, 10), guard: anim(12, 20, 14) },
  },
  // "warrior": the horned spearman, the Striker
  striker: {
    dir: "party/striker",
    cell: [240, 104],
    columns: 5,
    downFrom: 17,
    // jab: the quick blow, ready to lunge to recover, without the attack's
    // shield-forward wind-up (frames 6-8) that a Cleave's full swing has
    animations: {
      idle: anim(0, 4, 8, true),
      attack: anim(5, 11, 12),
      hurt: anim(16, 17, 8),
      guard: anim(12, 15, 10),
      jab: { frames: [5, 9, 10, 11], fps: 14, loop: false },
    },
  },
  // "Wizard": robe, hat and staff, the Mender; the cast is the glow before the fireball, not the fireball
  mender: {
    dir: "party/mender",
    cell: [161, 106],
    columns: 6,
    downFrom: 35,
    animations: { idle: anim(0, 5, 8, true), attack: anim(6, 12, 12), hurt: anim(32, 35, 10), cast: anim(15, 21, 12) },
  },
  // "mage": the spiky-haired brawler, the Breaker; the flying kick is his special
  breaker: {
    dir: "party/breaker",
    cell: [151, 100],
    columns: 5,
    downFrom: 15,
    animations: { idle: anim(0, 4, 8, true), attack: anim(5, 6, 8), hurt: anim(14, 15, 8), special: anim(7, 13, 14) },
  },
  // "bowman": the Chronist. Its draw and release is the attack; the bow raised
  // inside a cyan clock-circle is its cast (Haste, Delay, Stillpoint: time
  // bent), and the circle loosed as an arrow its special. Read off the sheet:
  // idle row 0, attack row 1, cast rows 2-3, special row 4, hurt row 5.
  chronist: {
    dir: "party/chronist",
    cell: [158, 173],
    columns: 8,
    // like the knight: the crouched flinch, turned, stands on end; the idle
    // pose, turned, lies back with the bow up
    downFrom: 0,
    animations: {
      idle: anim(0, 7, 8, true),
      attack: anim(8, 15, 12),
      hurt: anim(43, 45, 10),
      cast: anim(20, 31, 14),
      special: anim(32, 39, 14),
    },
  },
};

export const REQUIRED = ["idle", "attack", "hurt", "down"] as const;
