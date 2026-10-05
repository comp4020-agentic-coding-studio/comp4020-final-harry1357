// The strip's pixel icons, drawn here as text and built as crisp SVG. Each
// grid is original: one character per pixel, and a one-pixel dark outline is
// added around every lit pixel, the way a 16-bit status icon sits on any
// ground. Shown at 2× (a whole number), never smoothed.
//
//   .  nothing        # brass        = lit brass
//   +  card           * ember        (o, the outline, is added, not drawn)

const SVG_NS = "http://www.w3.org/2000/svg";
const SCALE = 2;
const INK: Readonly<Record<string, string>> = { o: "o", "#": "f", "=": "l", "+": "h", "*": "e" };

/** Haste: a double chevron pointing up the strip, toward the plate. */
export const HASTE: readonly string[] = [
  "....+....",
  "...+=+...",
  "..==.==..",
  ".==...==.",
  "....+....",
  "...+=+...",
  "..==.==..",
  ".==...==.",
];

/** Brace: a brass shield with a card cross. */
export const BRACE: readonly string[] = [
  "####+####",
  "####+####",
  "+++++++++",
  "####+####",
  ".###+###.",
  ".###+###.",
  "..##+##..",
  "...#+#...",
  "....#....",
];

/** Down: an ember cross, laid over a greyed face. */
export const DOWN: readonly string[] = [
  "**.....**",
  "***...***",
  ".***.***.",
  "..*****..",
  "...***...",
  "..*****..",
  ".***.***.",
  "***...***",
  "**.....**",
];

/** An SVG of `rows`, one cell per pixel, with the outline added. Build once and clone. */
export function pixelIcon(rows: readonly string[], className: string): SVGSVGElement {
  const w = Math.max(...rows.map((row) => row.length)) + 2;
  const h = rows.length + 2;
  const grid: string[][] = Array.from({ length: h }, () => Array<string>(w).fill("."));
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] !== ".") grid[y + 1][x + 1] = row[x];
  });
  const lit = (x: number, y: number): boolean => {
    const c = grid[y]?.[x];
    return c !== undefined && c !== "." && c !== "o";
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (grid[y][x] === "." && (lit(x - 1, y) || lit(x + 1, y) || lit(x, y - 1) || lit(x, y + 1))) grid[y][x] = "o";
    }
  }

  const paths = new Map<string, string>();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = grid[y][x];
      if (c === ".") continue;
      paths.set(c, (paths.get(c) ?? "") + `M${x} ${y}h1v1h-1z`);
    }
  }

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("width", String(w * SCALE));
  svg.setAttribute("height", String(h * SCALE));
  svg.setAttribute("shape-rendering", "crispEdges");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  for (const [c, d] of paths) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", `px-${INK[c] ?? "f"}`);
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
