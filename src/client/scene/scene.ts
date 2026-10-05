// The field: the observatory, the party on its floor, the Orrery, and the
// overlay where numbers and projectiles fly. createScene() implements the
// Scene in ../battle/api.ts and nothing else talks to this DOM.
//
// STATE methods draw a result under any motion preference; whatever moves in
// them is CSS gated on `prefers-reduced-motion: no-preference`. MOTION methods
// do nothing visible under reduced motion and resolve at once. reconcile() is
// the truth: it makes the field match the server's latest state, it is called
// every tick while nothing plays, and it only writes what changed.
//
// It renders, it never decides (CLAUDE.md rule 1): who stands where follows
// arrival, and every HP, mark and fall comes from the server's tokens.
import { BOSS_ID, type BattleState } from "../../shared/protocol.ts";
import type { Anim, PartsOptions, Scene, Tone } from "../battle/api.ts";
import { createFx } from "./fx.ts";
import { createOrrery } from "./orrery.ts";
import { createParty, type Actor } from "./party.ts";

/** How long an entrance or an exit takes under no-preference (scene.css matches). */
const ENTER_MS = 700;
const LEAVE_MS = 650;

function div(className: string, hook?: string): HTMLDivElement {
  const node = document.createElement("div");
  node.className = className;
  if (hook) node.setAttribute(`data-${hook}`, "");
  return node;
}

export function createScene(root: HTMLElement, { manifest, orrerySvg }: PartsOptions): Scene {
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const reduced = (): boolean => reducedQuery.matches;

  // --- the field -----------------------------------------------------------
  const field = div("field", "field");
  field.setAttribute("aria-hidden", "true");
  const floor = div("field-floor");
  floor.append(div("field-grid"));
  field.append(div("field-sky"), div("field-stars"), floor, div("field-horizon"));

  const partyHost = div("party", "party");
  partyHost.setAttribute("role", "group");
  partyHost.setAttribute("aria-label", "The party");
  const party = createParty(partyHost, manifest, reduced);
  const orrery = createOrrery(orrerySvg, reduced);

  const layer = div("fx", "fx");
  layer.setAttribute("aria-hidden", "true");
  const fx = createFx(layer);

  const bannerEl = document.createElement("p");
  bannerEl.className = "banner";
  bannerEl.dataset.banner = "";
  bannerEl.hidden = true;

  root.replaceChildren(field, orrery.el, partyHost, layer, bannerEl);
  delete root.dataset.stub;

  reducedQuery.addEventListener("change", () => party.motionChanged());

  // --- helpers -------------------------------------------------------------
  /** Someone arriving before the server's state has named their role. */
  const summoned = new Set<string>();
  const leaving = new Map<string, number>();
  let targeted: HTMLElement | null = null;

  /** What an effect aims at: the Orrery's art or a sprite's footprint. */
  function anchor(id: string): Element | null {
    return id === BOSS_ID ? orrery.art : (party.get(id)?.body ?? null);
  }

  const flags = new WeakMap<HTMLElement, Map<string, { timer: number; done: () => void }>>();
  /** Set a data attribute for `ms`, restarting its CSS if it's already set. */
  function flag(node: HTMLElement, attr: string, value: string, ms: number): Promise<void> {
    const mine = flags.get(node) ?? new Map<string, { timer: number; done: () => void }>();
    flags.set(node, mine);
    const prev = mine.get(attr);
    if (prev) {
      clearTimeout(prev.timer);
      prev.done();
    }
    node.removeAttribute(attr);
    void node.offsetWidth; // restart any animation the attribute drives
    node.setAttribute(attr, value);
    return new Promise<void>((resolve) => {
      const entry = {
        done: resolve,
        timer: window.setTimeout(() => {
          if (mine.get(attr) === entry) mine.delete(attr);
          node.removeAttribute(attr);
          resolve();
        }, ms),
      };
      mine.set(attr, entry);
    });
  }

  function entrance(a: Actor): void {
    if (!reduced()) void flag(a.el, "data-entering", "", ENTER_MS);
  }

  function stay(a: Actor): void {
    const timer = leaving.get(a.id);
    if (timer === undefined) return;
    clearTimeout(timer);
    leaving.delete(a.id);
    a.leaving = false;
    delete a.el.dataset.leaving;
  }

  function drop(a: Actor): void {
    stay(a);
    if (targeted === a.el) targeted = null;
    summoned.delete(a.id);
    party.remove(a);
  }

  const still = async (): Promise<void> => {};

  // --- the Scene -----------------------------------------------------------
  return {
    frame(id: string, anim: Anim): Promise<void> {
      if (id === BOSS_ID) return orrery.frame(anim);
      const a = party.get(id);
      return a ? party.play(a, anim) : Promise.resolve();
    },

    hp(id: string, hp: number, maxHp: number): void {
      if (id === BOSS_ID) {
        orrery.plate.hp(hp, maxHp);
        // The rings are the Orrery's HP bar too: they shed with it.
        orrery.rings(hp, maxHp);
        return;
      }
      const a = party.get(id);
      if (a && !a.down) a.plate.hp(hp, maxHp);
    },

    number(id: string, amount: number, tone: Tone, seq?: number): void {
      fx.number(anchor(id), id, amount, tone, seq);
    },

    hit(id: string): void {
      if (id === BOSS_ID) {
        orrery.hit();
        return;
      }
      const a = party.get(id);
      if (a && !a.down) void flag(a.el, "data-hit", "", reduced() ? 160 : 320);
    },

    guard(id: string, on: boolean): void {
      const a = party.get(id);
      if (a) party.setGuard(a, on && !a.down);
    },

    haste(id: string, on: boolean): void {
      if (id === BOSS_ID) {
        orrery.enraged(on);
        return;
      }
      const a = party.get(id);
      if (a) party.setHaste(a, on && !a.down);
    },

    down(id: string): void {
      if (id === BOSS_ID) {
        void orrery.frame("down");
        return;
      }
      const a = party.get(id);
      if (!a) return;
      party.lay(a);
      party.setGuard(a, false);
      party.setHaste(a, false);
    },

    arrive(id: string): void {
      if (id === BOSS_ID) return;
      const known = party.get(id);
      if (known) {
        stay(known);
        if (known.role) {
          entrance(known);
          return;
        }
      }
      // Not on the field yet, and arrive() carries no role: a summoning ring
      // marks the spot now, and the sprite steps in when reconcile names it.
      party.ensure(id);
      summoned.add(id);
    },

    depart(id: string): void {
      const a = party.get(id);
      if (!a || a.leaving) return;
      if (reduced()) {
        drop(a);
        return;
      }
      a.leaving = true;
      a.el.dataset.leaving = "";
      leaving.set(
        id,
        window.setTimeout(() => {
          leaving.delete(id);
          if (a.leaving) drop(a);
        }, LEAVE_MS),
      );
    },

    rings(hp: number, maxHp: number): void {
      orrery.rings(hp, maxHp);
    },

    target(id: string | null): void {
      const next = id === null ? null : id === BOSS_ID ? orrery.el : (party.get(id)?.el ?? null);
      if (next === targeted) return;
      if (targeted) delete targeted.dataset.targeted;
      targeted = next;
      if (next) next.dataset.targeted = "";
    },

    banner(text: string | null): void {
      if (text === null || text === "") {
        bannerEl.hidden = true;
        bannerEl.textContent = "";
        return;
      }
      if (!bannerEl.hidden && bannerEl.textContent === text) return;
      bannerEl.textContent = text;
      bannerEl.hidden = false;
    },

    // --- motion: nothing visible under reduced motion ---------------------
    async shake(strength: "light" | "heavy"): Promise<void> {
      if (reduced()) return;
      await flag(root, "data-shake", strength, strength === "heavy" ? 460 : 260);
    },

    async pushIn(): Promise<void> {
      if (reduced()) return;
      // One focal point for every layer, so the field, the party and the
      // Orrery push in together like a camera, not each about its own centre.
      const focus = orrery.art.getBoundingClientRect();
      const fx0 = focus.left + focus.width / 2;
      const fy0 = focus.top + focus.height / 2;
      for (const layerEl of [field, partyHost, orrery.el]) {
        const r = layerEl.getBoundingClientRect();
        layerEl.style.setProperty("--push-x", `${Math.round(fx0 - r.left)}px`);
        layerEl.style.setProperty("--push-y", `${Math.round(fy0 - r.top)}px`);
      }
      await flag(root, "data-push", "", 420);
    },

    async projectile(fromId: string, toId: string, kind: "slash" | "thrust" | "bolt" | "spark"): Promise<void> {
      if (reduced()) return;
      const from = anchor(fromId);
      const to = anchor(toId);
      if (from && to) await fx.projectile(from, to, kind);
    },

    async slash(id: string): Promise<void> {
      if (reduced()) return;
      const at = anchor(id);
      if (at) await fx.slash(at);
    },

    async pulse(): Promise<void> {
      if (reduced()) return;
      await fx.pulse(orrery.art);
    },

    spinUp(): Promise<void> {
      return reduced() ? still() : orrery.spinUp();
    },

    async afterimage(id: string): Promise<void> {
      if (reduced()) return;
      const node = id === BOSS_ID ? orrery.el : party.get(id)?.el;
      if (node) await flag(node, "data-afterimage", "", 480);
    },

    // --- the truth ---------------------------------------------------------
    reconcile(state: BattleState, myId: string | null): void {
      const seen = new Set<string>();

      for (const t of state.queue) {
        if (t.kind === "boss") {
          orrery.plate.hp(t.hp, t.maxHp);
          orrery.rings(t.hp, t.maxHp);
          orrery.enraged(t.hasted);
          if (t.hp > 0 && orrery.el.dataset.anim === "down") orrery.el.dataset.anim = "idle";
          continue;
        }
        seen.add(t.id);
        const a = party.ensure(t.id);
        stay(a);
        party.configure(a, t);
        if (summoned.delete(t.id)) entrance(a);
        if (a.down && t.hp > 0) party.revive(a);
        a.plate.hp(t.hp, t.maxHp);
        party.setGuard(a, t.braced);
        party.setHaste(a, t.hasted);
        party.setMine(a, t.id === myId);
      }

      for (const t of state.fallen) {
        // Someone who stepped away is gone from the field; someone who fell
        // lies where they stood.
        if (seen.has(t.id) || t.hp > 0) continue;
        seen.add(t.id);
        const a = party.ensure(t.id);
        stay(a);
        party.configure(a, t);
        summoned.delete(t.id);
        party.lay(a);
        a.plate.hp(0, t.maxHp);
        party.setGuard(a, false);
        party.setHaste(a, false);
        party.setMine(a, t.id === myId);
      }

      for (const a of [...party.all()]) {
        if (!seen.has(a.id) && !a.leaving) drop(a);
      }
    },
  };
}
