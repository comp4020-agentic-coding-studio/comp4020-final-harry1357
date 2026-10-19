// The scene's little pixel glyphs, original to this repo: the status marks on a
// sprite, the weaknesses and pips on the Orrery's rings, and the shape each
// role's Exposed stack is drawn in. Each is a grid of "#" pixels turned into
// one SVG path, so it stays crisp at any whole or fractional scale and is
// filled with currentColor. Colour is never the only signal (CLAUDE.md, the
// battle screen): every one of these is a distinct shape first.
import type { Element as Weakness, RoleId } from "../../shared/protocol.ts";
import type { StatusMark } from "../battle/api.ts";

type Grid = readonly string[];

/** Status marks, 7×7. */
export const MARK_GLYPHS: Readonly<Record<StatusMark["kind"], Grid>> = {
  // a shield held up: the Brace
  braced: [".#####.", "#######", "#######", "#######", ".#####.", "..###..", "...#..."],
  // a Ward's facet, open in the middle
  warded: ["...#...", "..#.#..", ".#...#.", "#..#..#", ".#...#.", "..#.#..", "...#..."],
  // two chevrons: haste
  hasted: ["#..#...", ".#..#..", "..#..#.", "...#..#", "..#..#.", ".#..#..", "#..#..."],
  // a weight dropping onto a floor: Gravity
  gravity: ["..###..", "..###..", "#######", ".#####.", "..###..", "...#...", "#######"],
  // a bolt: Charge
  charge: ["....##.", "...##..", "..##...", ".#####.", "...##..", "..##...", ".##...."],
  // a baton passed on: Relay
  relay: ["....#..", "....##.", "#######", "#######", "....##.", "....#..", "......."],
  // a crack: Exposed
  exposed: ["#.....#", ".#...#.", "..#.#..", "...#...", "..#.#..", ".#...#.", "#.....#"],
};

/** What a ring is weak to, 7×7, and the hidden one before a Scan. */
export const WEAKNESS_GLYPHS: Readonly<Record<Weakness | "hidden", Grid>> = {
  ember: ["...#...", "..##...", "..###..", ".#####.", ".##.##.", ".#...#.", "..###.."],
  frost: ["...#...", ".#.#.#.", "..###..", "#######", "..###..", ".#.#.#.", "...#..."],
  aether: ["...#...", "...#...", "..###..", "#######", "..###..", "...#...", "...#..."],
  hidden: [".####..", "#....#.", "....#..", "...#...", "...#...", ".......", "...#..."],
};

/** The shape of an Exposed stack, by the role that set it, 5×5. */
export const ROLE_GLYPHS: Readonly<Record<RoleId, Grid>> = {
  warden: ["#####", "#####", "#####", ".###.", "..#.."], // a shield
  mender: ["..#..", "..#..", "#####", "..#..", "..#.."], // a cross
  striker: ["..#..", ".###.", "#####", ".###.", "..#.."], // a blade's diamond
  breaker: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"], // a crack
  chronist: ["#####", ".#.#.", "..#..", ".#.#.", "#####"], // an hourglass
};

/** An Exposed stack whose setter the state no longer names: a plain chip. */
export const UNKNOWN_ROLE_GLYPH: Grid = [".....", ".###.", ".###.", ".###.", "....."];

/** A shield pip, 5×5: a stud, and the hollow socket it leaves when it's knocked out. */
export const PIP_GLYPH: Grid = [".###.", "#####", "#####", "#####", ".###."];
export const PIP_LOST_GLYPH: Grid = [".###.", "#...#", "#...#", "#...#", ".###."];

/** One path for a grid: a run of "#" per row is one rectangle. `x`/`y` offset it, `unit` scales a pixel. */
export function gridPath(grid: Grid, x = 0, y = 0, unit = 1): string {
  let d = "";
  const f = (n: number): string => String(Math.round(n * 1000) / 1000);
  grid.forEach((row, r) => {
    for (let c = 0; c < row.length; ) {
      if (row[c] !== "#") {
        c++;
        continue;
      }
      let end = c;
      while (row[end + 1] === "#") end++;
      d += `M${f(x + c * unit)} ${f(y + r * unit)}h${f((end - c + 1) * unit)}v${f(unit)}h${f(-(end - c + 1) * unit)}z`;
      c = end + 1;
    }
  });
  return d;
}

/** A glyph as a standalone inline SVG, for HTML (the status marks). */
export function glyphSvg(grid: Grid, className: string): string {
  const w = grid[0]?.length ?? 0;
  return `<svg class="${className}" viewBox="0 0 ${w} ${grid.length}" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><path d="${gridPath(grid)}"/></svg>`;
}
