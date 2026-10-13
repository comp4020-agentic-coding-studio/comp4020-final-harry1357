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

export const ROLE_ART: Record<"bulwark" | "lancer" | "mender" | "herald", RoleArt> = {
  // "warrior2": the shield knight
  bulwark: {
    dir: "party/bulwark",
    cell: [182, 123],
    columns: 6,
    // the knight is as wide as he is tall, so his recoil stands on end when
    // turned; his idle pose, turned, lies back with shield and boots up
    downFrom: 0,
    animations: { idle: anim(0, 5, 8, true), attack: anim(6, 11, 12), hurt: anim(22, 24, 10), guard: anim(12, 20, 14) },
  },
  // "warrior": the horned spearman
  lancer: {
    dir: "party/lancer",
    cell: [240, 104],
    columns: 5,
    downFrom: 17,
    animations: { idle: anim(0, 4, 8, true), attack: anim(5, 11, 12), hurt: anim(16, 17, 8), guard: anim(12, 15, 10) },
  },
  // "Wizard": robe, hat and staff; the cast is the glow before the fireball, not the fireball
  mender: {
    dir: "party/mender",
    cell: [161, 106],
    columns: 6,
    downFrom: 35,
    animations: { idle: anim(0, 5, 8, true), attack: anim(6, 12, 12), hurt: anim(32, 35, 10), cast: anim(15, 21, 12) },
  },
  // "mage": the spiky-haired brawler; the flying kick is his special
  herald: {
    dir: "party/herald",
    cell: [151, 100],
    columns: 5,
    downFrom: 15,
    animations: { idle: anim(0, 4, 8, true), attack: anim(5, 6, 8), hurt: anim(14, 15, 8), special: anim(7, 13, 14) },
  },
};

export const REQUIRED = ["idle", "attack", "hurt", "down"] as const;
