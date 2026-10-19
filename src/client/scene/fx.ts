// The overlay over the field ([data-fx]): damage numbers, projectiles, slashes
// and the Orrery's pulse. Every position is measured at the moment it's needed,
// from getBoundingClientRect relative to the overlay itself, so an effect lands
// on its target wherever the phone layout has put the party and the Orrery.
//
// Numbers are state: one is drawn under any motion preference, and only its
// pop-and-rise is CSS gated on no-preference. Everything else here is motion,
// and the scene never calls it under reduced motion.
//
// A number's size is its share of the target's max HP, so a blow that takes a
// fifth of someone is drawn larger than one that grazes the Orrery. Its tone
// is never colour alone: harm is the bare figure, a heal carries "+", a blow a
// Ward took is a shield glyph and the word WARD, and a Resonance (a weakness
// or Broken ring struck) a star glyph. Harm on the Orrery is card-white and on
// a person ember, so the side is drawn too.
import type { Tone } from "../battle/api.ts";

/** How long a number stays up. */
const NUMBER_MS = 1_100;
/** A blow that takes this much of the target or more is drawn at full size, with the heavy outline. */
const HEAVY_SHARE = 0.2;

export type ProjectileKind = "slash" | "thrust" | "bolt" | "spark";

export interface NumberLook {
  /** amount ÷ the target's max HP, when known. */
  share: number | null;
  side: "boss" | "party";
}

export interface Fx {
  readonly layer: HTMLElement;
  number(target: Element | null, id: string, amount: number, tone: Tone, seq: number | undefined, look: NumberLook): void;
  projectile(from: Element, to: Element, kind: ProjectileKind): Promise<void>;
  slash(target: Element): Promise<void>;
  pulse(from: Element): Promise<void>;
}

interface Point {
  x: number;
  y: number;
}

export function createFx(layer: HTMLElement): Fx {
  /** Numbers up per target, so a second one stacks above the first. */
  const up = new Map<string, number>();

  /** A point on `el` (fractions of its box), in the overlay's coordinates. */
  function at(el: Element, fx = 0.5, fy = 0.5): Point {
    const frame = layer.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return { x: r.left - frame.left + r.width * fx, y: r.top - frame.top + r.height * fy };
  }

  function piece(className: string, p: Point): HTMLElement {
    const node = document.createElement("span");
    node.className = className;
    node.style.left = `${Math.round(p.x)}px`;
    node.style.top = `${Math.round(p.y)}px`;
    layer.append(node);
    return node;
  }

  async function run(node: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions): Promise<void> {
    try {
      await node.animate(frames, { fill: "forwards", ...options }).finished;
    } catch {
      // cancelled: the node is going anyway
    } finally {
      node.remove();
    }
  }

  return {
    layer,

    number(target, id, amount, tone, seq, look) {
      const p = target ? at(target, 0.5, 0.28) : { x: layer.clientWidth * 0.5, y: layer.clientHeight * 0.4 };
      const stack = up.get(id) ?? 0;
      up.set(id, stack + 1);
      const node = piece("fx-number", p);
      node.dataset.number = "";
      node.dataset.target = id;
      node.dataset.tone = tone;
      node.dataset.side = look.side;
      if (seq !== undefined) node.dataset.seq = String(seq);
      node.setAttribute("aria-hidden", "true"); // the log narrates it
      node.style.setProperty("--stack", String(stack));
      // 0 → the smallest size, HEAVY_SHARE or more → the largest.
      const share = look.share ?? 0.08;
      node.style.setProperty("--size", Math.max(0, Math.min(1, share / HEAVY_SHARE)).toFixed(3));
      if (share >= HEAVY_SHARE && tone !== "shield") node.dataset.heavy = "";
      const n = Math.abs(Math.round(amount));
      const text = tone === "heal" ? `+${n}` : tone === "shield" && n === 0 ? "WARD" : String(n);
      if (tone === "shield" || tone === "resonance") {
        const glyph = document.createElement("span");
        glyph.className = "fx-number-glyph";
        node.append(glyph, text);
      } else {
        node.textContent = text;
      }
      setTimeout(() => {
        node.remove();
        const left = (up.get(id) ?? 1) - 1;
        if (left > 0) up.set(id, left);
        else up.delete(id);
      }, NUMBER_MS);
    },

    async projectile(from, to, kind) {
      const a = at(from, 0.5, 0.45);
      const b = at(to, 0.5, 0.5);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
      const distance = Math.hypot(dx, dy);
      const node = piece("fx-projectile", a);
      node.dataset.kind = kind;
      const spin = kind === "slash" ? 540 : 0;
      await run(
        node,
        [
          { transform: `translate(-50%, -50%) rotate(${angle}deg)`, opacity: 0.4 },
          { opacity: 1, offset: 0.15 },
          { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) rotate(${angle + spin}deg)`, opacity: 1 },
        ],
        { duration: Math.round(Math.max(220, Math.min(520, distance / 2.4))), easing: kind === "bolt" ? "ease-in" : "linear" },
      );
    },

    async slash(target) {
      const node = piece("fx-slash", at(target, 0.5, 0.45));
      await run(
        node,
        [
          { transform: "translate(-50%, -50%) rotate(-32deg) scaleX(0)", opacity: 1 },
          { transform: "translate(-50%, -50%) rotate(-32deg) scaleX(1)", opacity: 1, offset: 0.45 },
          { transform: "translate(-50%, -50%) rotate(-32deg) scaleX(1.08)", opacity: 0 },
        ],
        { duration: 300, easing: "steps(6, end)" },
      );
    },

    async pulse(from) {
      const origin = at(from, 0.5, 0.5);
      const frame = layer.getBoundingClientRect();
      // Far enough to sweep past the far corner of the field.
      const reach = Math.hypot(Math.max(origin.x, frame.width - origin.x), Math.max(origin.y, frame.height - origin.y));
      const node = piece("fx-pulse", origin);
      // Grown by size, not scale, so the ring's line stays one weight as it sweeps.
      await run(
        node,
        [
          { width: "2rem", height: "2rem", opacity: 0.95 },
          { opacity: 0.8, offset: 0.4 },
          { width: `${Math.round(reach * 2)}px`, height: `${Math.round(reach * 2)}px`, opacity: 0 },
        ],
        { duration: 760, easing: "cubic-bezier(0.2, 0.6, 0.4, 1)" },
      );
    },
  };
}
