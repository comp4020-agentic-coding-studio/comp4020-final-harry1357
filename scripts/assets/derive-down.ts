import { readFileSync, writeFileSync } from "node:fs";
import { blank, contentBox, crop, decodePng, encodePng, paste, rotateClockwise } from "../png.ts";
import { ROLE_ART } from "./roles.ts";

// The pack has no down frame, so each role's is derived: one of its cells
// (the last hurt frame, or the knight's idle; roles.ts says which), trimmed
// and laid flat. The art faces left, so falling back from the enemy
// puts the head on the right: a quarter turn clockwise. Mirrored on screen,
// the head ends up away from the Orrery. CC0 permits the derivation; CREDITS.md
// says it was done.
//
//   node scripts/assets/derive-down.ts

const ASSETS = new URL("../../src/assets/", import.meta.url);
const MARGIN = 2;

for (const [role, art] of Object.entries(ROLE_ART)) {
  const sheet = decodePng(readFileSync(new URL(`${art.dir}/sheet.png`, ASSETS)));
  const index = art.downFrom;
  const [w, h] = art.cell;
  const cell = crop(sheet, (index % art.columns) * w, Math.floor(index / art.columns) * h, w, h);
  const box = contentBox(cell, 0);
  if (!box) throw new Error(`${role}: cell ${index} is empty`);
  const lying = rotateClockwise(crop(cell, box.x, box.y, box.w, box.h));
  const out = blank(lying.width + MARGIN * 2, lying.height + MARGIN);
  paste(out, lying, MARGIN, 0);
  writeFileSync(new URL(`${art.dir}/down.png`, ASSETS), encodePng(out));
  console.log(`${role}: down.png ${out.width}×${out.height}, from cell ${index}`);
}
