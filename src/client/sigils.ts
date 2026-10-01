// The sigils stamped on the tokens. Drawn for this app from basic shapes
// (squares, circles, straight strokes), in a 24-unit box centred on 0,0.
// Constant markup only: nothing a player typed ever goes through innerHTML.
import type { RoleId } from "../shared/protocol.ts";

export type SigilId = RoleId | "orrery";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Each sigil inherits its colour from `currentColor`, set by the stylesheet. */
const SIGILS: Readonly<Record<SigilId, string>> = {
  // A keep: a heavy square holding a smaller solid one.
  bulwark:
    '<rect x="-8" y="-8" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.6"/>' +
    '<rect x="-3.5" y="-3.5" width="7" height="7" fill="currentColor"/>',
  // A long narrow wedge crossed low by a short bar.
  lancer:
    '<path d="M0 -10.5 L3.6 9 L-3.6 9 Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="miter"/>' +
    '<path d="M-7.5 3.5 H7.5" stroke="currentColor" stroke-width="2.2"/>',
  // A ringed circle: a solid core inside an open ring. Never a cross.
  mender:
    '<circle r="8.5" fill="none" stroke="currentColor" stroke-width="2.4"/>' +
    '<circle r="3.6" fill="currentColor"/>',
  // A lozenge on a level staff, with a pip at its heart.
  herald:
    '<path d="M0 -9 L7 0 L0 9 L-7 0 Z" fill="none" stroke="currentColor" stroke-width="2.2"/>' +
    '<path d="M-11 0 H-7 M7 0 H11" stroke="currentColor" stroke-width="2.2"/>' +
    '<circle r="2" fill="currentColor"/>',
  // The Orrery: a sun, two orbits, a body on each.
  orrery:
    '<circle r="2.8" fill="currentColor"/>' +
    '<circle r="6" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<circle r="10.5" fill="none" stroke="currentColor" stroke-width="1.4"/>' +
    '<circle cx="4.24" cy="-4.24" r="1.9" fill="currentColor"/>' +
    '<circle cx="-7.42" cy="7.42" r="2.4" fill="currentColor"/>',
};

/** The two marks a token can carry, drawn small on its disc's shoulder. */
const MARKS = {
  // Hasted: two forward strokes, the next waits run short.
  hasted: '<path d="M-4 -4 L0 0 L-4 4 M1 -4 L5 0 L1 4" fill="none" stroke="currentColor" stroke-width="1.8"/>',
  // Braced: a level bar on a block, standing firm.
  braced: '<path d="M-5 -3 H5" stroke="currentColor" stroke-width="2"/><rect x="-3" y="0" width="6" height="4" fill="currentColor"/>',
} as const;

export type MarkId = keyof typeof MARKS;

function svg(viewBox: string, className: string): SVGSVGElement {
  const el = document.createElementNS(SVG_NS, "svg");
  el.setAttribute("viewBox", viewBox);
  el.setAttribute("class", className);
  el.setAttribute("aria-hidden", "true");
  el.setAttribute("focusable", "false");
  return el;
}

/** A bare sigil, for the role picker and the seat panel. */
export function sigil(id: SigilId, className = "sigil"): SVGSVGElement {
  const el = svg("-12 -12 24 24", className);
  el.innerHTML = SIGILS[id];
  return el;
}

/** A mark glyph, for the disc and the legend. */
export function mark(id: MarkId, className = "mark"): SVGSVGElement {
  const el = svg("-6 -6 12 12", className);
  el.innerHTML = MARKS[id];
  return el;
}

export interface Disc {
  root: SVGSVGElement;
  /** The strength ring: its dash length is the token's hp, as a share of 100. */
  ring: SVGCircleElement;
}

/**
 * A token's disc: the face, a strength ring around the rim, and the sigil.
 * The ring is drawn with pathLength=100 so hp/maxHp maps straight onto a dash.
 */
export function disc(id: SigilId): Disc {
  const root = svg("-20 -20 40 40", "disc");
  root.innerHTML =
    '<circle class="disc-face" r="19"/>' +
    '<circle class="disc-ring-track" r="16.5" pathLength="100"/>' +
    '<circle class="disc-ring" r="16.5" pathLength="100" transform="rotate(-90)"/>' +
    `<g class="disc-sigil" transform="scale(0.95)">${SIGILS[id]}</g>`;
  const ring = root.querySelector<SVGCircleElement>(".disc-ring");
  if (!ring) throw new Error("disc markup lost its ring");
  return { root, ring };
}
