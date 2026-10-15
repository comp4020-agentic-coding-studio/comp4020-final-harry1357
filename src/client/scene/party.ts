// The party on the field: one element per character, drawn from the licensed
// sheets by background-position at a whole-number scale (CSS's --px), anchored
// at the feet, and mirrored to face the Orrery (the art faces left).
//
// Frames are driven by one requestAnimationFrame clock at each animation's
// fps, because the manifest's frame lists aren't contiguous rows that CSS
// steps() could walk. A one-shot's end is a timer, not the clock, so frame()
// still resolves in a background tab where rAF sleeps.
//
// Placement on the floor follows `seat` (arrival), never the queue: the field
// doesn't reshuffle every turn, and nothing about where someone stands says
// anything about when they act (CLAUDE.md rule 1).
import type { RoleId, Token } from "../../shared/protocol.ts";
import type { Anim, SpriteAnimation, SpriteManifest, SpriteRole } from "../battle/api.ts";
import { createPlate, type Plate } from "./plate.ts";
import { spriteFor } from "../sprites.ts";

const ASSET_ROOT = "/assets/";
/** Reduced motion: frame() resolves this soon, showing the key frame... */
const KEY_RESOLVE_MS = 90;
/** ...and the key frame stays this long before the sprite idles again. */
const KEY_HOLD_MS = 450;

export interface Actor {
  readonly id: string;
  /** [data-sprite]: the whole member, sprite and plate. */
  readonly el: HTMLElement;
  /** The sprite's footprint, which effects aim at. */
  readonly body: HTMLElement;
  readonly plate: Plate;
  readonly said: HTMLElement;
  role: RoleId | null;
  seat: number;
  name: string;
  guard: boolean;
  haste: boolean;
  mine: boolean;
  down: boolean;
  leaving: boolean;
  /** The animation playing (always one the role has). */
  anim: string;
  started: number;
  /** Idle phase, so the party doesn't breathe in step. */
  phase: number;
  sheet: string;
  cell: number;
  endTimer: number;
  resolveTimer: number;
  settle: (() => void) | null;
}

export interface Party {
  readonly host: HTMLElement;
  get(id: string): Actor | undefined;
  all(): IterableIterator<Actor>;
  /** Make sure a member exists for `id` (a summoning, until its role is known). */
  ensure(id: string): Actor;
  /** Fill a member in from the server's token: role, seat, name. */
  configure(actor: Actor, token: Token): void;
  play(actor: Actor, anim: Anim): Promise<void>;
  lay(actor: Actor): void;
  revive(actor: Actor): void;
  setGuard(actor: Actor, on: boolean): void;
  setHaste(actor: Actor, on: boolean): void;
  setMine(actor: Actor, on: boolean): void;
  remove(actor: Actor): void;
  /** Motion preference changed: stop or restart the idle clock. */
  motionChanged(): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

/** The frame a reduced-motion player sees: the pose that says what happened. */
function keyFrame(anim: SpriteAnimation): number {
  return Math.min(anim.frames.length - 1, Math.floor(anim.frames.length * 0.6));
}

export function createParty(host: HTMLElement, manifest: SpriteManifest, reduced: () => boolean): Party {
  const actors = new Map<string, Actor>();
  let raf = 0;

  // Warm the cache so a first frame (or a first fall) never draws blank.
  for (const role of Object.values(manifest.roles)) {
    const sheets = new Set([role.sheet, ...Object.values(role.animations).flatMap((a) => (a.sheet ? [a.sheet] : []))]);
    for (const sheet of sheets) new Image().src = ASSET_ROOT + sheet;
  }

  const roleOf = (a: Actor): SpriteRole | null => (a.role ? (manifest.roles[spriteFor(a.role) ?? ""] ?? null) : null);
  const animOf = (a: Actor, name: string): SpriteAnimation | null => roleOf(a)?.animations[name] ?? null;

  /** Show cell `index` of `name`: only what changed is written. */
  function paint(a: Actor, name: string, index: number): void {
    const role = roleOf(a);
    const anim = role?.animations[name];
    if (!role || !anim) return;
    const sheet = anim.sheet ?? role.sheet;
    const columns = anim.columns ?? role.columns;
    if (sheet !== a.sheet) {
      const cell = anim.cell ?? role.cell;
      const anchor = anim.anchor ?? role.anchor;
      const s = a.el.style;
      s.setProperty("--sheet", `url("${ASSET_ROOT}${sheet}")`);
      s.setProperty("--cell-w", String(cell[0]));
      s.setProperty("--cell-h", String(cell[1]));
      s.setProperty("--ax", String(anchor[0]));
      s.setProperty("--ay", String(anchor[1]));
      s.setProperty("--cols", String(columns));
      a.sheet = sheet;
      a.cell = -1;
    }
    const cell = anim.frames[Math.max(0, Math.min(anim.frames.length - 1, index))] ?? 0;
    if (cell === a.cell) return;
    a.cell = cell;
    a.el.style.setProperty("--col", String(cell % columns));
    a.el.style.setProperty("--row", String(Math.floor(cell / columns)));
  }

  function idleIndex(a: Actor, now: number): number {
    const idle = animOf(a, "idle");
    if (!idle || reduced()) return 0;
    return Math.floor(((now + a.phase) * idle.fps) / 1000) % idle.frames.length;
  }

  function tick(now: number): void {
    raf = 0;
    if (reduced()) return;
    let live = false;
    for (const a of actors.values()) {
      if (!a.role || a.down) continue;
      live = true;
      const anim = animOf(a, a.anim);
      if (!anim) continue;
      if (a.anim === "idle" || anim.loop) {
        const i = Math.floor(((now + (a.anim === "idle" ? a.phase : -a.started)) * anim.fps) / 1000);
        paint(a, a.anim, i % anim.frames.length);
      } else {
        paint(a, a.anim, Math.floor(((now - a.started) * anim.fps) / 1000));
      }
    }
    if (live) raf = requestAnimationFrame(tick);
  }

  function clock(): void {
    if (!raf && !reduced()) raf = requestAnimationFrame(tick);
  }

  /** End whatever one-shot is running: its promise resolves, its timers stop. */
  function settle(a: Actor): void {
    clearTimeout(a.endTimer);
    clearTimeout(a.resolveTimer);
    const done = a.settle;
    a.settle = null;
    done?.();
  }

  function toIdle(a: Actor): void {
    settle(a);
    if (a.down) return;
    a.anim = "idle";
    a.el.dataset.anim = "idle";
    paint(a, "idle", idleIndex(a, performance.now()));
    clock();
  }

  function words(a: Actor): void {
    const w: string[] = [];
    if (a.mine) w.push("you");
    if (a.down) w.push("down");
    if (a.guard) w.push("braced");
    if (a.haste) w.push("hasted");
    const text = w.length ? `${a.name}: ${w.join(", ")}` : "";
    if (a.said.textContent !== text) a.said.textContent = text;
  }

  function lay(a: Actor): void {
    settle(a);
    if (a.down) return;
    a.down = true;
    a.anim = "down";
    a.el.dataset.anim = "down";
    a.el.dataset.down = "";
    paint(a, "down", 0);
    words(a);
  }

  function place(a: Actor): void {
    // Insert by seat; a summoning (seat unknown) goes on the end.
    let before: Element | null = null;
    for (const child of host.children) {
      const other = actors.get((child as HTMLElement).dataset.sprite ?? "");
      if (other && other !== a && other.seat > a.seat) {
        before = child;
        break;
      }
    }
    if (a.el.parentElement !== host || a.el.nextElementSibling !== before) host.insertBefore(a.el, before);
  }

  function count(): void {
    const n = String(actors.size);
    if (host.dataset.count !== n) host.dataset.count = n;
  }

  return {
    host,
    get: (id) => actors.get(id),
    all: () => actors.values(),

    ensure(id) {
      const found = actors.get(id);
      if (found) return found;
      const root = el("div", "actor");
      root.dataset.sprite = id;
      root.dataset.anim = "idle";
      root.dataset.summoning = "";
      const body = el("div", "actor-body");
      body.setAttribute("aria-hidden", "true");
      body.append(el("span", "actor-ring"), el("span", "actor-cel actor-art"), el("span", "actor-cel actor-flash"));
      body.append(el("span", "actor-ward"), el("span", "actor-haste"), el("span", "actor-cursor"));
      const plate = createPlate();
      plate.el.dataset.plate = id;
      const said = el("span", "visually-hidden");
      root.append(body, plate.el, said);
      const a: Actor = {
        id,
        el: root,
        body,
        plate,
        said,
        role: null,
        seat: Number.POSITIVE_INFINITY,
        name: "",
        guard: false,
        haste: false,
        mine: false,
        down: false,
        leaving: false,
        anim: "idle",
        started: 0,
        phase: Math.floor(Math.random() * 1000),
        sheet: "",
        cell: -1,
        endTimer: 0,
        resolveTimer: 0,
        settle: null,
      };
      actors.set(id, a);
      place(a);
      count();
      return a;
    },

    configure(a, token) {
      if (token.role !== "orrery" && token.role !== a.role) {
        a.role = token.role;
        a.el.dataset.role = token.role;
        const role = manifest.roles[spriteFor(token.role) ?? ""];
        const s = a.el.style;
        s.setProperty("--foot-x", String(role.anchor[0] - role.box[0]));
        s.setProperty("--foot-y", String(role.anchor[1] - role.box[1]));
        s.setProperty("--foot-w", String(role.box[2]));
        a.sheet = "";
        delete a.el.dataset.summoning;
        if (a.down) paint(a, "down", 0);
        else toIdle(a);
      }
      if (token.seat !== a.seat) {
        a.seat = token.seat;
        // Odd seats stand in front, even seats a step behind: a staggered
        // row that holds still as people come and go.
        a.el.dataset.rank = token.seat % 2 === 1 ? "front" : "back";
        place(a);
      }
      if (token.name !== a.name) {
        a.name = token.name;
        a.plate.name(token.name);
        words(a);
      }
    },

    play(a, requested) {
      settle(a);
      // Set at once and synchronously: the spec times this attribute.
      if (requested === "down") {
        lay(a);
        return Promise.resolve();
      }
      if (!a.role || a.down) return Promise.resolve();
      const name = animOf(a, requested) ? requested : "idle";
      const anim = animOf(a, name) as SpriteAnimation;
      a.el.dataset.anim = name;
      if (name === "idle" || anim.loop) {
        toIdle(a);
        return Promise.resolve();
      }
      a.anim = name;
      a.started = performance.now();
      if (reduced()) {
        paint(a, name, keyFrame(anim));
        return new Promise<void>((resolve) => {
          a.settle = resolve;
          a.resolveTimer = window.setTimeout(() => {
            if (a.settle === resolve) a.settle = null;
            resolve();
          }, KEY_RESOLVE_MS);
          a.endTimer = window.setTimeout(() => toIdle(a), KEY_HOLD_MS);
        });
      }
      paint(a, name, 0);
      clock();
      return new Promise<void>((resolve) => {
        a.settle = resolve;
        a.endTimer = window.setTimeout(() => toIdle(a), (anim.frames.length / anim.fps) * 1000);
      });
    },

    lay,

    revive(a) {
      if (!a.down) return;
      a.down = false;
      delete a.el.dataset.down;
      words(a);
      toIdle(a);
    },

    setGuard(a, on) {
      if (a.guard === on) return;
      a.guard = on;
      if (on) a.el.dataset.guard = "";
      else delete a.el.dataset.guard;
      words(a);
    },

    setHaste(a, on) {
      if (a.haste === on) return;
      a.haste = on;
      if (on) a.el.dataset.haste = "";
      else delete a.el.dataset.haste;
      words(a);
    },

    setMine(a, on) {
      if (a.mine === on) return;
      a.mine = on;
      if (on) a.el.dataset.mine = "";
      else delete a.el.dataset.mine;
      words(a);
    },

    remove(a) {
      settle(a);
      actors.delete(a.id);
      a.el.remove();
      count();
    },

    motionChanged() {
      if (reduced()) {
        cancelAnimationFrame(raf);
        raf = 0;
        for (const a of actors.values()) if (a.anim === "idle" && !a.down) paint(a, "idle", 0);
      } else {
        clock();
      }
    },
  };
}
