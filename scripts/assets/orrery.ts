import { mkdirSync, writeFileSync } from "node:fs";

// Writes src/assets/orrery/orrery.svg: the Orrery, original to this repo.
//
//   node scripts/assets/orrery.ts
//
// Four brass rings around a dark core, drawn on a 128-unit pixel grid so that at
// a whole-number scale it reads as 16-bit art rather than smooth vector. Each
// ring is its own <g data-ring> (1 = outermost) so the scene can turn them
// independently, and each ring is made of <g data-segment> arcs so it can shed
// them as HP falls (CLAUDE.md, "Design: the battle screen"). Colours are palette
// tokens with palette fallbacks, scoped under .orrery-art so that inlining the
// SVG into the page can't restyle anything else.

const SIZE = 128;
const C = SIZE / 2;

interface Ring {
  outer: number;
  inner: number;
  segments: number;
  /** Degrees of gap between neighbouring segments. */
  gap: number;
  /** Teeth on the outside edge, per segment. */
  teeth: number;
  /** Where the first segment starts, so the rings' gaps don't line up into spokes. */
  phase: number;
}

const RINGS: Ring[] = [
  { outer: 61, inner: 55, segments: 12, gap: 4, teeth: 2, phase: 0 },
  { outer: 51, inner: 46, segments: 9, gap: 6, teeth: 0, phase: 17 },
  { outer: 42, inner: 38, segments: 6, gap: 9, teeth: 1, phase: 31 },
  { outer: 34, inner: 31, segments: 4, gap: 12, teeth: 0, phase: 52 },
];
const CORE = 27;

type Shade = "orr-l" | "orr-f" | "orr-s" | "orr-k";

/** Pixel centres, so the grid is sampled the same way everywhere. */
function polar(x: number, y: number): { r: number; deg: number } {
  const dx = x + 0.5 - C;
  const dy = y + 0.5 - C;
  return { r: Math.hypot(dx, dy), deg: ((Math.atan2(dy, dx) * 180) / Math.PI + 450) % 360 };
}

/** Runs of pixels as one path: "M x y h n v1 h-n z" per run. */
function path(pixels: [number, number][]): string {
  const rows = new Map<number, number[]>();
  for (const [x, y] of pixels) rows.set(y, [...(rows.get(y) ?? []), x]);
  let d = "";
  for (const [y, xs] of [...rows.entries()].sort((a, b) => a[0] - b[0])) {
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

function ring(index: number, spec: Ring): string {
  const span = 360 / spec.segments;
  const segments: string[] = [];
  for (let s = 0; s < spec.segments; s++) {
    const start = s * span + spec.gap / 2;
    const end = (s + 1) * span - spec.gap / 2;
    const mid = (start + end) / 2;
    const shades: Record<Shade, [number, number][]> = { "orr-l": [], "orr-f": [], "orr-s": [], "orr-k": [] };
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const { r, deg: raw } = polar(x, y);
        const deg = (raw - spec.phase + 360) % 360;
        if (deg < start || deg >= end) continue;
        const inBand = r >= spec.inner && r < spec.outer;
        const tooth =
          spec.teeth > 0 &&
          r >= spec.outer &&
          r < spec.outer + 2 &&
          Array.from({ length: spec.teeth }, (_, t) => start + ((t + 1) * (end - start)) / (spec.teeth + 1)).some(
            (at) => Math.abs(deg - at) < 2.2,
          );
        if (!inBand && !tooth) continue;
        // engraving: a notch across the middle of the band every 10 degrees
        const notch = inBand && Math.abs(r - (spec.inner + spec.outer) / 2) < 0.8 && Math.abs(((deg - mid + 365) % 10) - 5) < 0.7;
        const shade: Shade = tooth || r >= spec.outer - 1 ? "orr-l" : notch ? "orr-k" : r < spec.inner + 1 ? "orr-s" : "orr-f";
        shades[shade].push([x, y]);
      }
    }
    const body = (Object.entries(shades) as [Shade, [number, number][]][])
      .filter(([, px]) => px.length > 0)
      .map(([cls, px]) => `<path class="${cls}" d="${path(px)}"/>`)
      .join("");
    segments.push(`<g class="orrery-segment" data-segment="${s}">${body}</g>`);
  }
  return `<g class="orrery-ring" data-ring="${index + 1}">${segments.join("")}</g>`;
}

function core(): string {
  const parts: Record<string, [number, number][]> = {
    "orr-rim": [],
    "orr-core": [],
    "orr-grill": [],
    "orr-eye": [],
    "orr-pupil": [],
    "orr-glint": [],
  };
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const { r } = polar(x, y);
      if (r >= CORE) continue;
      const glint = Math.hypot(x + 0.5 - (C - 3), y + 0.5 - (C - 3)) < 1.6;
      const part =
        r >= CORE - 2
          ? "orr-rim"
          : glint
            ? "orr-glint"
            : r < 5
              ? "orr-pupil"
              : r < 9
                ? "orr-eye"
                : Math.round(r) % 4 === 0 && r > 11
                  ? "orr-grill"
                  : "orr-core";
      parts[part].push([x, y]);
    }
  }
  const body = Object.entries(parts)
    .map(([cls, px]) => `<path class="${cls}" d="${path(px)}"/>`)
    .join("");
  return `<g class="orrery-core">${body}</g>`;
}

const style = `
.orrery-art .orr-l{fill:color-mix(in srgb,var(--brass,#b58a3a) 55%,var(--card,#f1ead9))}
.orrery-art .orr-f{fill:var(--brass,#b58a3a)}
.orrery-art .orr-s{fill:color-mix(in srgb,var(--brass,#b58a3a) 55%,var(--ink,#1a1814))}
.orrery-art .orr-k{fill:color-mix(in srgb,var(--brass,#b58a3a) 25%,var(--ink,#1a1814))}
.orrery-art .orr-rim{fill:color-mix(in srgb,var(--brass,#b58a3a) 40%,var(--ink,#1a1814))}
.orrery-art .orr-core{fill:var(--ink,#1a1814)}
.orrery-art .orr-grill{fill:var(--void,#0a0e1a)}
.orrery-art .orr-eye{fill:var(--ember,#e0563a)}
.orrery-art .orr-pupil{fill:var(--void,#0a0e1a)}
.orrery-art .orr-glint{fill:var(--card,#f1ead9)}
`.trim();

const svg = `<svg xmlns="http://www.w3.org/2000/svg" class="orrery-art" viewBox="0 0 ${SIZE} ${SIZE}" shape-rendering="crispEdges" role="img" aria-label="The Orrery">
<title>The Orrery</title>
<style>${style}</style>
${RINGS.map((spec, i) => ring(i, spec)).join("\n")}
${core()}
</svg>
`;

const out = new URL("../../src/assets/orrery/", import.meta.url);
mkdirSync(out, { recursive: true });
writeFileSync(new URL("orrery.svg", out), svg);
console.log(`orrery.svg: ${RINGS.length} rings (${RINGS.map((r) => r.segments).join("/")} segments), ${(svg.length / 1024).toFixed(1)} kB`);
