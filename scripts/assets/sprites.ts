import { readFileSync, writeFileSync } from "node:fs";
import { contentBox, crop, decodePng } from "../png.ts";
import { REQUIRED, ROLE_ART } from "./roles.ts";

// Writes src/assets/sprites.json: for each role, its sheet, cell grid, the
// animations (which cells, how fast, whether they loop) and where its feet
// are, so the scene can stand every sprite on the floor whatever its cell
// size. Run after derive-down.ts.
//
//   node scripts/assets/sprites.ts

const ASSETS = new URL("../../src/assets/", import.meta.url);
const png = (path: string) => decodePng(readFileSync(new URL(path, ASSETS)));

const roles: Record<string, unknown> = {};
for (const [role, art] of Object.entries(ROLE_ART)) {
  const sheet = png(`${art.dir}/sheet.png`);
  const [w, h] = art.cell;
  if (sheet.width % w !== 0 || sheet.height % h !== 0) throw new Error(`${role}: ${sheet.width}×${sheet.height} isn't a grid of ${w}×${h}`);

  // The idle pose's footprint across every idle frame: the feet are its bottom middle.
  let left = Infinity;
  let top = Infinity;
  let right = -1;
  let bottom = -1;
  for (const i of art.animations.idle.frames) {
    const box = contentBox(crop(sheet, (i % art.columns) * w, Math.floor(i / art.columns) * h, w, h), 0);
    if (!box) throw new Error(`${role}: idle cell ${i} is empty`);
    left = Math.min(left, box.x);
    top = Math.min(top, box.y);
    right = Math.max(right, box.x + box.w);
    bottom = Math.max(bottom, box.y + box.h);
  }

  const down = png(`${art.dir}/down.png`);
  const animations: Record<string, unknown> = {};
  for (const [name, a] of Object.entries(art.animations)) animations[name] = { frames: a.frames, fps: a.fps, loop: a.loop };
  animations.down = {
    sheet: `${art.dir}/down.png`,
    cell: [down.width, down.height],
    columns: 1,
    anchor: [Math.round(down.width / 2), down.height],
    frames: [0],
    fps: 1,
    loop: false,
  };

  roles[role] = {
    sheet: `${art.dir}/sheet.png`,
    portrait: `${art.dir}/portrait.png`,
    cell: art.cell,
    columns: art.columns,
    box: [left, top, right - left, bottom - top],
    anchor: [Math.round((left + right) / 2), bottom],
    animations,
  };
}

const manifest = {
  // The art faces left; the party is mirrored on screen to face the Orrery.
  facing: "left",
  required: REQUIRED,
  roles,
};
writeFileSync(new URL("sprites.json", ASSETS), `${JSON.stringify(manifest, null, 2)}\n`);
for (const [role, r] of Object.entries(roles)) {
  const { box, anchor } = r as { box: number[]; anchor: number[] };
  console.log(`${role}: idle box ${box.join(",")}, feet at ${anchor.join(",")}`);
}
