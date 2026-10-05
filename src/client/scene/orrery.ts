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
import type { Anim } from "../battle/api.ts";
import { createPlate, type Plate } from "./plate.ts";

/** How much slower the rings turn at 0 HP than at full. */
const MAX_DRAG = 2.5;
const TURN = "orrery-turn";

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
}

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
  };
  return api;
}
