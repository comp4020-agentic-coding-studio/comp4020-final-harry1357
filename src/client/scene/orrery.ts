// The Orrery, the signature element: the original SVG inlined so each ring is
// its own group to turn and each segment its own group to shed.
//
// The rings turn by CSS animation (scene.css), alternating direction at
// different periods. Their pace comes from one custom property, --orrery-drag,
// which rises as HP falls. Changing a running animation's duration would jump
// every ring to a new angle, so when the drag changes each ring is re-seeked
// to the angle it was already at: the rings visibly slow, they never skip.
//
// Segments shed at fixed HP thresholds, outer ring first: every segment owns
// an equal share of the Orrery's HP, so each blow that lands takes about one
// off, and at 0 only the core is left. Shedding is state (a data attribute);
// the fling outward is CSS under no-preference only, so under reduced motion
// the segment is simply gone.
//
// Phase two draws the server's rings ON the rings (docs/design/overhaul.md:
// "shield pips and weaknesses sit on each ring, not in a menu"). The outer,
// middle and inner rings are the art's first three; each gets a faint track
// beneath its segments (so its marks still sit on something once its brass
// has shed) and a group of marks above them that turns with it: the weakness
// glyph (a "?" until Scanned), a stud per shield pip (hollow once lost), and a
// pip per Exposed stack in the shape and colour of the role that set it. A
// Broken ring dims and cracks. The phase is a look on the whole Orrery: the
// Conjunction's two pointers, the Grand Alignment's line of beads.
import type { Element as Weakness, Ring, RingId, RoleId } from "../../shared/protocol.ts";
import type { Anim } from "../battle/api.ts";
import { PIP_GLYPH, PIP_LOST_GLYPH, ROLE_GLYPHS, UNKNOWN_ROLE_GLYPH, WEAKNESS_GLYPHS, gridPath } from "./glyphs.ts";
import { createPlate, type Plate } from "./plate.ts";

/** How much slower the rings turn at 0 HP than at full. */
const MAX_DRAG = 2.5;
const TURN = "orrery-turn";
const SVG_NS = "http://www.w3.org/2000/svg";
/** The art's centre, in its 128-unit grid (scripts/assets/orrery.ts). */
const C = 64;
/** How long a fresh mark's moment (a pip knocked out, a weakness revealed) is flagged for CSS. */
const FRESH_MS = 900;
const WINDUP_MS = 260;

/** Where each of the server's rings sits in the art: its group, the middle of its band, the band's width. */
const GEOMETRY: Readonly<Record<RingId, { ring: number; r: number; band: number }>> = {
  outer: { ring: 1, r: 58, band: 6 },
  middle: { ring: 2, r: 48.5, band: 5 },
  inner: { ring: 3, r: 40, band: 4 },
};

const PHASE_NAMES = { 1: "the Outer Ring", 2: "Conjunction", 3: "the Grand Alignment" } as const;
const ROMAN = { 1: "I", 2: "II", 3: "III" } as const;
const ROLE_NAMES: Readonly<Record<RoleId, string>> = { warden: "Warden", mender: "Mender", striker: "Striker", breaker: "Breaker", chronist: "Chronist" };

export interface Orrery {
  readonly el: HTMLElement;
  /** The art, which effects aim at. */
  readonly art: HTMLElement;
  readonly plate: Plate;
  rings(hp: number, maxHp: number): void;
  hit(): void;
  spinUp(): Promise<void>;
  frame(anim: Anim): Promise<void>;
  enraged(on: boolean): void;
  /** The server's rings, drawn on the art's rings. */
  ringMarks(rings: readonly Ring[], appliers: Readonly<Record<string, RoleId>>): void;
  phase(phase: 1 | 2 | 3): void;
  /** The anticipation: the Orrery draws back before it strikes. */
  windUp(): Promise<void>;
}

/** What a ring was last drawn as, to tell what just changed. */
interface Drawn {
  key: string;
  pips: number;
  weakness: Weakness | null;
  broken: boolean;
  exposed: number;
}

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  return node;
}

const round = (n: number): number => Math.round(n * 100) / 100;

/** Shed order inside a ring: spread around it, so a ring thins before it gaps. */
function spread(n: number): number[] {
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  let step = Math.floor(n / 2) + 1;
  while (gcd(step, n) !== 1) step++;
  return Array.from({ length: n }, (_, i) => (i * step) % n);
}

export function createOrrery(svgSource: string, reduced: () => boolean): Orrery {
  const el = document.createElement("div");
  el.className = "boss";
  el.dataset.boss = "";
  el.dataset.sprite = "orrery";
  el.dataset.anim = "idle";

  const art = document.createElement("div");
  art.className = "boss-art";
  art.innerHTML = svgSource; // our own file, bundled at build time
  const svg = art.querySelector("svg");
  // The SVG carries role="img", its <title> and an aria-label already.
  svg?.setAttribute("focusable", "false");

  const cursor = document.createElement("span");
  cursor.className = "actor-cursor";
  cursor.setAttribute("aria-hidden", "true");

  const plate = createPlate("plate boss-plate");
  plate.el.dataset.plate = "orrery";
  plate.name("The Orrery");

  el.append(cursor, art, plate.el);

  const ringEls = [...art.querySelectorAll<SVGGElement>("g.orrery-ring")].sort(
    (a, b) => Number(a.dataset.ring) - Number(b.dataset.ring),
  );
  // Outer ring first, each ring's segments spread around it.
  const order: SVGGElement[] = ringEls.flatMap((ring) => {
    const segments = [...ring.querySelectorAll<SVGGElement>("g.orrery-segment")];
    return spread(segments.length).map((i) => segments[i]);
  });

  let shed = -1;
  let drag = 1;
  let hitTimer = 0;
  let frameTimer = 0;
  let resolveTimer = 0;
  let settleFrame: (() => void) | null = null;
  let spinGen = 0;
  let windTimer = 0;
  let settleWind: (() => void) | null = null;

  // --- phase two: each server ring's track and marks, and the phase overlay ---
  const ringOf = (id: RingId): SVGGElement | undefined => ringEls.find((g) => Number(g.dataset.ring) === GEOMETRY[id].ring);
  const markHosts = new Map<RingId, SVGGElement>();
  for (const id of Object.keys(GEOMETRY) as RingId[]) {
    const ring = ringOf(id);
    if (!ring) continue;
    // Beneath the brass, so it only shows where a segment has shed.
    ring.insertBefore(svgEl("circle", { class: "ring-track", cx: C, cy: C, r: GEOMETRY[id].r }), ring.firstChild);
    const host = svgEl("g", { class: "orrery-marks", "data-ring-id": id });
    ring.append(host);
    markHosts.set(id, host);
  }
  const drawn = new Map<RingId, Drawn>();
  const freshTimers = new Map<RingId, number>();
  const ringWords = new Map<RingId, string>();
  let shownPhase: 1 | 2 | 3 | 0 = 0;

  // The phase's look, which doesn't turn: the Conjunction's two pointers at
  // the party, and the Grand Alignment's rings brought into one line.
  const phaseLayer = svgEl("g", { class: "orrery-phase" });
  const polar = (deg: number, r: number): [number, number] => {
    const a = (deg * Math.PI) / 180;
    return [round(C + r * Math.cos(a)), round(C + r * Math.sin(a))];
  };
  const conjunction = svgEl("g", { class: "phase-part", "data-phase-part": 2 });
  for (const deg of [158, 202]) {
    const [x1, y1] = polar(deg, 28);
    const [x2, y2] = polar(deg, 63);
    conjunction.append(svgEl("line", { class: "phase-beam", x1, y1, x2, y2 }));
    conjunction.append(svgEl("rect", { class: "phase-bead", x: x2 - 2, y: y2 - 2, width: 4, height: 4 }));
  }
  const alignment = svgEl("g", { class: "phase-part", "data-phase-part": 3 });
  alignment.append(svgEl("rect", { class: "phase-bar", x: 1, y: C - 1, width: C - 28, height: 2 }));
  for (const id of Object.keys(GEOMETRY) as RingId[]) {
    const [x, y] = polar(180, GEOMETRY[id].r);
    alignment.append(svgEl("rect", { class: "phase-bead", x: x - 2.5, y: y - 2.5, width: 5, height: 5 }));
  }
  phaseLayer.append(conjunction, alignment);
  svg?.insertBefore(phaseLayer, svg.querySelector(".orrery-core"));

  /** What a screen reader hears after the Orrery's name: its phase and every ring. */
  function say(): void {
    const words: string[] = [];
    if (shownPhase) words.push(`phase ${shownPhase}, ${PHASE_NAMES[shownPhase]}`);
    for (const id of Object.keys(GEOMETRY) as RingId[]) {
      const w = ringWords.get(id);
      if (w) words.push(w);
    }
    plate.state(words);
  }

  function describe(ring: Ring, appliers: Readonly<Record<string, RoleId>>): string {
    const parts = [ring.broken ? `${ring.id} ring Broken` : `${ring.id} ring ${ring.pips} of ${ring.maxPips} shield pips`];
    parts.push(ring.weakness ? `weak to ${ring.weakness}` : "weakness hidden");
    if (ring.exposed.length) {
      const by = ring.exposed.map((s) => ROLE_NAMES[appliers[s.appliedBy] as RoleId] ?? "someone");
      parts.push(`${ring.exposed.length} Exposed (set by ${[...new Set(by)].join(", ")})`);
    }
    return parts.join(", ");
  }

  /** One ring's marks, rebuilt only when what the server holds for it has changed. */
  function drawRing(ring: Ring, appliers: Readonly<Record<string, RoleId>>): void {
    const geo = GEOMETRY[ring.id];
    const host = markHosts.get(ring.id);
    const group = ringOf(ring.id);
    if (!geo || !host || !group) return;
    const roles = ring.exposed.map((s) => appliers[s.appliedBy] ?? "");
    const key = [ring.pips, ring.maxPips, ring.weakness ?? "", ring.broken ? 1 : 0, roles.join(",")].join("|");
    const before = drawn.get(ring.id);
    if (before?.key === key) return;

    // Slots run clockwise from the top along the middle of the band: the
    // weakness, the shield pips, a gap, then the Exposed stacks.
    const size = geo.band - 1;
    const pitch = size + 1.6;
    const at = (slot: number): { x: number; y: number } => {
      const a = -Math.PI / 2 + (slot * pitch) / geo.r;
      return { x: C + geo.r * Math.cos(a), y: C + geo.r * Math.sin(a) };
    };
    const nodes: SVGElement[] = [];
    const socket = (p: { x: number; y: number }, s: number): void => {
      nodes.push(svgEl("rect", { class: "ring-socket", x: round(p.x - s / 2 - 0.6), y: round(p.y - s / 2 - 0.6), width: round(s + 1.2), height: round(s + 1.2) }));
    };

    let slot = 0;
    const wp = at(slot++);
    const ws = size + 1;
    socket(wp, ws);
    const weak = svgEl("path", { class: "ring-weak", "data-weak": ring.weakness ?? "hidden", d: gridPath(WEAKNESS_GLYPHS[ring.weakness ?? "hidden"], wp.x - ws / 2, wp.y - ws / 2, ws / 7) });
    if (before && before.weakness === null && ring.weakness) weak.dataset.fresh = "revealed";
    nodes.push(weak);

    for (let i = 0; i < ring.maxPips; i++) {
      const p = at(slot++);
      const up = !ring.broken && i < ring.pips;
      socket(p, size);
      const pip = svgEl("path", { class: "ring-pip", "data-pip": up ? "up" : "lost", d: gridPath(up ? PIP_GLYPH : PIP_LOST_GLYPH, p.x - size / 2, p.y - size / 2, size / 5) });
      if (!up && before && i < before.pips && !before.broken) pip.dataset.fresh = "lost";
      nodes.push(pip);
    }

    slot += 0.5;
    roles.forEach((role, i) => {
      const p = at(slot++);
      socket(p, size);
      const glyph = role ? ROLE_GLYPHS[role as RoleId] : UNKNOWN_ROLE_GLYPH;
      const chip = svgEl("path", { class: "ring-exposed", "data-role": role || "unknown", d: gridPath(glyph, p.x - size / 2, p.y - size / 2, size / 5) });
      if (before && i >= before.exposed) chip.dataset.fresh = "added";
      nodes.push(chip);
    });

    if (ring.broken) {
      // Cracks across the band, spread around the ring: a shape, not a tint.
      // Clear of the marks, which run clockwise from the top (270° to 360°).
      const inner = geo.r - geo.band / 2 - 0.5;
      const span = geo.band + 1;
      for (const deg of [35, 125, 215]) {
        const a = (deg * Math.PI) / 180;
        const [ux, uy] = [Math.cos(a), Math.sin(a)];
        const [tx, ty] = [-uy, ux];
        const pt = (along: number, side: number): string => `${round(C + ux * (inner + along) + tx * side)} ${round(C + uy * (inner + along) + ty * side)}`;
        nodes.push(svgEl("path", { class: "ring-crack", d: `M${pt(0, 0)}L${pt(span * 0.35, 1.1)}L${pt(span * 0.6, -1)}L${pt(span, 0.4)}` }));
      }
    }

    host.replaceChildren(...nodes);
    if (ring.broken) group.dataset.broken = "";
    else delete group.dataset.broken;
    if (before && ring.broken && !before.broken) group.dataset.fresh = "broken";
    else if (before && ring.exposed.length < before.exposed) group.dataset.fresh = "spent";
    else if (before && ring.pips < before.pips && !ring.broken) group.dataset.fresh = "struck";

    clearTimeout(freshTimers.get(ring.id));
    freshTimers.set(
      ring.id,
      window.setTimeout(() => {
        delete group.dataset.fresh;
        for (const n of host.querySelectorAll<SVGElement>("[data-fresh]")) delete n.dataset.fresh;
      }, FRESH_MS),
    );
    drawn.set(ring.id, { key, pips: ring.pips, weakness: ring.weakness, broken: ring.broken, exposed: ring.exposed.length });
    ringWords.set(ring.id, describe(ring, appliers));
  }

  function turning(): CSSAnimation[] {
    return ringEls.flatMap((ring) =>
      ring.getAnimations().filter((a): a is CSSAnimation => a instanceof CSSAnimation && a.animationName === TURN),
    );
  }

  function setDrag(next: number): void {
    if (next === drag) return;
    const angle = new Map<Animation, number>();
    for (const a of turning()) {
      const t = Number(a.currentTime);
      const d = Number(a.effect?.getComputedTiming().duration);
      if (Number.isFinite(t) && d > 0) angle.set(a, (t % d) / d);
    }
    drag = next;
    el.style.setProperty("--orrery-drag", next.toFixed(2));
    // getAnimations() flushes style, so the durations read below are the new ones.
    for (const a of turning()) {
      const f = angle.get(a);
      const d = Number(a.effect?.getComputedTiming().duration);
      if (f !== undefined && d > 0) a.currentTime = f * d;
    }
  }

  /** Where a segment flies when it sheds: straight out from the core. */
  function fling(seg: SVGGElement): void {
    if (seg.style.getPropertyValue("--dx")) return;
    let x = 0;
    let y = -1;
    try {
      const b = seg.getBBox();
      if (b.width || b.height) {
        x = b.x + b.width / 2 - 64;
        y = b.y + b.height / 2 - 64;
      }
    } catch {
      // not rendered yet: straight up will do
    }
    const len = Math.hypot(x, y) || 1;
    seg.style.setProperty("--dx", ((x / len) * 14).toFixed(1));
    seg.style.setProperty("--dy", ((y / len) * 14).toFixed(1));
  }

  function clearFrame(): void {
    clearTimeout(frameTimer);
    clearTimeout(resolveTimer);
    const done = settleFrame;
    settleFrame = null;
    done?.();
  }

  const api: Orrery = {
    el,
    art,
    plate,

    rings(hp, maxHp) {
      const frac = maxHp > 0 ? Math.max(0, Math.min(1, hp / maxHp)) : 0;
      const total = order.length;
      const gone = hp <= 0 ? total : Math.min(total, Math.floor((1 - frac) * total + 1e-9));
      if (gone !== shed) {
        shed = gone;
        order.forEach((seg, i) => {
          const off = i < gone;
          if (off === seg.hasAttribute("data-shed")) return;
          if (off) {
            fling(seg);
            seg.setAttribute("data-shed", "");
          } else {
            seg.removeAttribute("data-shed");
          }
        });
      }
      el.style.setProperty("--orrery-health", frac.toFixed(2));
      if (hp <= 0) el.dataset.halted = "";
      else delete el.dataset.halted;
      // Quantised, so a re-seek happens a few dozen times a fight, not every tick.
      setDrag(Math.round((1 + (MAX_DRAG - 1) * (1 - frac)) * 20) / 20);
    },

    hit() {
      // A one-frame flash on the rings. Under reduced motion it is a single
      // static frame (no fade), held just long enough to be seen.
      clearTimeout(hitTimer);
      delete el.dataset.hit;
      void el.offsetWidth; // restart the CSS flash
      el.dataset.hit = "";
      hitTimer = window.setTimeout(() => delete el.dataset.hit, reduced() ? 160 : 320);
    },

    async spinUp() {
      if (reduced()) return;
      const anims = turning();
      if (anims.length === 0) return;
      const gen = ++spinGen;
      for (const rate of [2, 4, 7, 9, 9, 9, 7, 5, 3.5, 2.4, 1.6, 1.2, 1]) {
        if (gen !== spinGen) return;
        for (const a of anims) a.updatePlaybackRate(rate);
        await new Promise((resolve) => setTimeout(resolve, 75));
      }
    },

    frame(anim) {
      clearFrame();
      if (anim === "hurt") api.hit();
      if (anim === "down") {
        el.dataset.anim = "down";
        return Promise.resolve();
      }
      // The Orrery has one move: its core flares and it leans in.
      const name = anim === "attack" || anim === "cast" || anim === "special" ? "attack" : anim === "hurt" ? "hurt" : "idle";
      el.dataset.anim = name;
      if (name === "idle") return Promise.resolve();
      const ms = name === "attack" ? 720 : 320;
      return new Promise<void>((resolve) => {
        settleFrame = resolve;
        resolveTimer = window.setTimeout(
          () => {
            if (settleFrame === resolve) settleFrame = null;
            resolve();
          },
          reduced() ? 90 : ms,
        );
        frameTimer = window.setTimeout(
          () => {
            if (el.dataset.anim === name) el.dataset.anim = "idle";
          },
          reduced() ? 450 : ms,
        );
      });
    },

    enraged(on) {
      if (on === el.hasAttribute("data-haste")) return;
      if (on) el.dataset.haste = "";
      else delete el.dataset.haste;
    },

    ringMarks(rings, appliers) {
      let changed = false;
      for (const id of Object.keys(GEOMETRY) as RingId[]) {
        const ring = rings.find((r) => r.id === id);
        if (ring) {
          const was = drawn.get(id)?.key;
          drawRing(ring, appliers);
          changed ||= drawn.get(id)?.key !== was;
        } else if (drawn.has(id)) {
          // No such ring in this state (a fresh fight before its pull): nothing on it.
          markHosts.get(id)?.replaceChildren();
          const group = ringOf(id);
          if (group) delete group.dataset.broken;
          drawn.delete(id);
          ringWords.delete(id);
          changed = true;
        }
      }
      if (changed) say();
    },

    phase(phase) {
      if (phase === shownPhase) return;
      shownPhase = phase;
      el.dataset.orreryPhase = String(phase);
      plate.tags([`PHASE ${ROMAN[phase]}`]);
      say();
    },

    windUp() {
      if (reduced()) return Promise.resolve();
      clearTimeout(windTimer);
      settleWind?.();
      delete el.dataset.windup;
      void el.offsetWidth; // restart the CSS
      el.dataset.windup = "";
      return new Promise<void>((resolve) => {
        settleWind = resolve;
        windTimer = window.setTimeout(() => {
          delete el.dataset.windup;
          if (settleWind === resolve) settleWind = null;
          resolve();
        }, WINDUP_MS);
      });
    },
  };
  return api;
}
