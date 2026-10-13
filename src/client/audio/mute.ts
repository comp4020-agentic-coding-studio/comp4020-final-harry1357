// The mute control in the battle bar. It is a toggle: its name is "Mute",
// which is what pressing it does, and aria-pressed says whether it is on. The
// name doesn't change with the state, because a toggle that renames itself
// reads as "Unmute, pressed" and contradicts itself. The speaker is an
// original pixel drawing, 11×9 on whole pixels, shown at 2× (audio.css). The
// choice lasts the tab's session.
const KEY = "orrery:muted";

export function readMuted(): boolean {
  try {
    return sessionStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function writeMuted(muted: boolean): void {
  try {
    sessionStorage.setItem(KEY, muted ? "1" : "0");
  } catch {
    // storage refused (a private window, a policy): the choice lasts this page instead
  }
}

// `#` is a lit pixel. The cone is always drawn; then either its sound or a cross.
const CONE = ["....#", "...##", "..###", "#####", "#####", "#####", "..###", "...##", "....#"];
const WAVES = ["", "........#", ".........#", "......#..#", "......#..#", "......#..#", ".........#", "........#", ""];
const CROSS = ["", "", "......#...#", ".......#.#", "........#", ".......#.#", "......#...#", "", ""];

const SVG = "http://www.w3.org/2000/svg";

/** One path for a pixel layer: a rectangle per run of lit pixels in a row. */
function pixels(rows: readonly string[], className: string): SVGPathElement {
  let d = "";
  rows.forEach((row, y) => {
    for (const run of row.matchAll(/#+/g)) d += `M${run.index} ${y}h${run[0].length}v1h-${run[0].length}z`;
  });
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("class", className);
  path.setAttribute("d", d);
  return path;
}

/** Draw the button's face once; returns the function that shows a state on it. */
export function drawMute(button: HTMLButtonElement): (muted: boolean) => void {
  const icon = document.createElementNS(SVG, "svg");
  icon.setAttribute("class", "mute-icon");
  icon.setAttribute("viewBox", "0 0 11 9");
  icon.setAttribute("width", "22");
  icon.setAttribute("height", "18");
  icon.setAttribute("fill", "currentColor");
  icon.setAttribute("shape-rendering", "crispEdges");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");
  icon.append(pixels(CONE, "mute-cone"), pixels(WAVES, "mute-waves"), pixels(CROSS, "mute-cross"));

  const label = document.createElement("span");
  label.className = "mute-label";
  label.textContent = "Mute";

  button.replaceChildren(icon, label);
  return (muted) => button.setAttribute("aria-pressed", String(muted));
}
