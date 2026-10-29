import { writeFileSync } from "node:fs";

// Writes src/assets/favicon.svg: the tab's icon, original to this repo.
//
//   node scripts/assets/favicon.ts
//
// The Orrery reduced to what reads at 16px: one segmented brass ring around
// the ember core, on the observatory dark, drawn on a 16-unit pixel grid so
// it stays crisp at the size a tab draws it. An icon is drawn outside the
// page, so it can't read the palette's custom properties: it names the
// palette's own hexes (CLAUDE.md, "Design: the battle screen"), and no
// seventh.

const SIZE = 16;
const C = SIZE / 2;
const VOID = "#0a0e1a";
const BRASS = "#b58a3a";
const EMBER = "#e0563a";
const CARD = "#f1ead9";

/** The ring: radius band, and four gaps so it reads as segments, not a disc. */
const OUTER = 7.4;
const INNER = 5.2;
const GAPS = [45, 135, 225, 315];
const GAP = 14;
const CORE = 2.2;

function polar(x: number, y: number): { r: number; deg: number } {
  const dx = x + 0.5 - C;
  const dy = y + 0.5 - C;
  return { r: Math.hypot(dx, dy), deg: ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360 };
}

const near = (deg: number, at: number): boolean => Math.min(Math.abs(deg - at), 360 - Math.abs(deg - at)) <= GAP / 2;

/** Runs of pixels as one path: "M x y h n v1 h-n z" per run. */
function path(pixels: [number, number][]): string {
  const rows = new Map<number, number[]>();
  for (const [x, y] of pixels) rows.set(y, [...(rows.get(y) ?? []), x]);
  let d = "";
  for (const [y, xs] of [...rows].sort((a, b) => a[0] - b[0])) {
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length; ) {
      let j = i;
      while (j + 1 < xs.length && xs[j + 1] === xs[j] + 1) j++;
      d += `M${xs[i]} ${y}h${j - i + 1}v1h-${j - i + 1}z`;
      i = j + 1;
    }
  }
  return d;
}

const ring: [number, number][] = [];
const core: [number, number][] = [];
const glint: [number, number][] = [];
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    const { r, deg } = polar(x, y);
    if (r <= OUTER && r >= INNER && !GAPS.some((g) => near(deg, g))) ring.push([x, y]);
    else if (r <= CORE) core.push([x, y]);
  }
}
// One lit pixel on the core, its eye catching the light.
glint.push([C - 1, C - 1]);

const svg =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges">` +
  `<rect width="${SIZE}" height="${SIZE}" fill="${VOID}"/>` +
  `<path fill="${BRASS}" d="${path(ring)}"/>` +
  `<path fill="${EMBER}" d="${path(core)}"/>` +
  `<path fill="${CARD}" d="${path(glint)}"/>` +
  `</svg>\n`;

writeFileSync("src/assets/favicon.svg", svg);
console.log(`src/assets/favicon.svg: ${ring.length} ring pixels, ${core.length} core`);
