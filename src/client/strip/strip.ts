// The turn strip: the server's queue drawn as portraits, in the order sent.
//
// CLAUDE.md rule 1 is the whole of this file's logic. Nothing here sorts the
// queue, counts a counter down, or works out who goes next: `state.queue` is
// laid out top to bottom exactly as it arrived, `state.fallen` after it,
// `data-active` is whatever `state.activeId` says, and every number is the
// server's. Animating a portrait from where it was to where the server put it
// is drawing, not deciding.
//
// render() runs on every message (about seven a second while the clock runs),
// so each portrait is built once, keyed by id, and only what changed is
// written. Layout is read only when the order or the active portrait changes,
// and only then under prefers-reduced-motion: no-preference, to animate the
// move (FLIP). Under reduce, everything lands at once.
//
// Hooks other code reads, and must stay exact: [data-rail] carries
// data-version; each portrait is [data-token-id] with data-counter,
// data-active, data-kind and data-mine; DOM order is queue order, then fallen.
import { ROLES, type BattleState, type RoleId, type Token } from "../../shared/protocol.ts";
import type { PartsOptions, Strip } from "../battle/api.ts";
import { orreryPortrait } from "./orrery.ts";
import { BRACE, DOWN, HASTE, pixelIcon } from "./pixels.ts";
import { spriteFor } from "../sprites.ts";

/** How long a flag (a held turn, a turn reached) stays on a portrait. */
const FLAG_MS = 1_100;
const FLIP_MS = 300;
const FLIP_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const GHOSTS = 3;
const GHOST_MS = 460;
/** At or under this share of max HP the mini-bar turns ember. A colour, not a rule. */
const LOW_HP = 1 / 3;

type Out = "down" | "away";

interface Entry {
  li: HTMLLIElement;
  say: HTMLElement;
  plate: HTMLElement;
  face: HTMLElement;
  count: HTMLElement;
  name: HTMLElement;
  hp: HTMLElement;
  role: string;
  flip: Animation | null;
  stamp: HTMLElement | null;
  stampTimer: ReturnType<typeof setTimeout> | null;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Write an attribute only when it changes: cheap, and quiet for observers. */
function put(node: HTMLElement, key: string, value: string): void {
  if (node.dataset[key] !== value) node.dataset[key] = value;
}

function text(node: Node, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

function roleLabel(token: Token): string {
  return token.role in ROLES ? ROLES[token.role as RoleId].label : token.role;
}

/** The portrait's words, for a screen reader: who, whether it's you, the wait, the marks, HP. */
function spoken(token: Token, mine: boolean, active: boolean, out: Out | null): string {
  const parts = [token.kind === "boss" ? `${token.name}, the enemy` : `${token.name}, ${roleLabel(token)}`];
  if (out) {
    if (mine) parts.push("you");
    parts.push(out === "down" ? "down" : "away from the table");
  } else if (active) {
    parts.push(mine ? "your turn" : "acting now");
  } else {
    if (mine) parts.push("you");
    parts.push(`waits ${token.counter}`);
  }
  if (!out && token.hasted) parts.push("hasted");
  if (!out && token.braced) parts.push("braced");
  if (out !== "down") parts.push(`HP ${token.hp} of ${token.maxHp}`);
  return parts.join(", ");
}

export function createStrip(root: HTMLElement, opts: PartsOptions): Strip {
  const motionOk = matchMedia("(prefers-reduced-motion: no-preference)");
  const entries = new Map<string, Entry>();
  const icons = {
    haste: pixelIcon(HASTE, "strip-icon strip-haste"),
    brace: pixelIcon(BRACE, "strip-icon strip-brace"),
    down: pixelIcon(DOWN, "strip-icon strip-down"),
  };
  let orrery: (() => SVGSVGElement) | null | undefined;

  // The window: a title, then the standing queue and the fallen beneath it.
  root.classList.add("window");
  const title = el("p", "window-title strip-title", "Turn order");
  title.setAttribute("aria-hidden", "true");
  const lanes = el("div", "strip-lanes");
  const queueList = el("ol", "strip-queue");
  queueList.setAttribute("aria-label", "Standing, first to act at the top");
  const fallenList = el("ol", "strip-fallen");
  fallenList.setAttribute("aria-label", "Out of the fight");
  fallenList.hidden = true;
  lanes.append(queueList, fallenList);
  root.replaceChildren(title, lanes);

  let shownIds: string[] = [];
  let shownQueueLength = -1;
  let shownActive: string | null = null;
  let drawn = false;

  function art(token: Token): Element | null {
    if (token.kind === "boss" || token.role === "orrery") {
      if (orrery === undefined) orrery = orreryPortrait(opts.orrerySvg);
      return orrery ? orrery() : null;
    }
    const role = opts.manifest.roles[spriteFor(token.role as RoleId) ?? ""];
    if (!role) return null;
    const img = document.createElement("img");
    img.src = `/assets/${role.portrait}`;
    img.width = 93;
    img.height = 94;
    img.alt = "";
    img.decoding = "async";
    img.draggable = false;
    return img;
  }

  function build(token: Token): Entry {
    const li = el("li", "strip-token");
    li.dataset.tokenId = token.id;
    const say = el("span", "visually-hidden");
    const card = el("span", "strip-card");
    card.setAttribute("aria-hidden", "true");

    const plate = el("span", "strip-plate");
    const face = el("span", "strip-face");
    const hp = el("span", "strip-hp-fill");
    const hpBar = el("span", "strip-hp");
    hpBar.append(hp);
    plate.append(
      face,
      hpBar,
      el("span", "strip-you", "You"),
      icons.haste.cloneNode(true),
      icons.brace.cloneNode(true),
      icons.down.cloneNode(true),
    );

    const wait = el("span", "strip-wait");
    const count = el("span", "strip-count");
    wait.append(el("span", "strip-label"), count);
    const name = el("span", "strip-name");

    card.append(plate, wait, name);
    li.append(say, card);
    const entry: Entry = { li, say, plate, face, count, name, hp, role: "", flip: null, stamp: null, stampTimer: null };
    entries.set(token.id, entry);
    return entry;
  }

  function update(entry: Entry, token: Token, myId: string | null, activeId: string | null, out: Out | null): void {
    const { li } = entry;
    const mine = token.id === myId;
    const active = !out && token.id === activeId;
    put(li, "counter", String(token.counter));
    put(li, "active", String(active));
    put(li, "kind", token.kind);
    put(li, "mine", String(mine));
    put(li, "role", token.role);
    put(li, "hasted", String(!out && token.hasted));
    put(li, "braced", String(!out && token.braced));
    if (out) put(li, "out", out);
    else if (li.dataset.out !== undefined) delete li.dataset.out;

    if (entry.role !== token.role) {
      entry.role = token.role;
      const picture = art(token);
      entry.face.replaceChildren(...(picture ? [picture] : []));
    }

    const ratio = token.maxHp > 0 ? Math.min(1, Math.max(0, token.hp / token.maxHp)) : 0;
    const hp = ratio.toFixed(3);
    if (entry.hp.style.getPropertyValue("--hp") !== hp) entry.hp.style.setProperty("--hp", hp);
    put(li, "low", String(token.hp > 0 && ratio <= LOW_HP));

    text(entry.count, out ? "" : String(token.counter));
    text(entry.name, token.name);
    if (entry.name.title !== token.name) entry.name.title = token.name;
    text(entry.say, spoken(token, mine, active, out));
  }

  /** Put `tokens`' portraits into `list` in exactly that order, moving only what's out of place. */
  function place(list: HTMLOListElement, tokens: readonly Token[]): void {
    let cursor = list.firstElementChild;
    for (const token of tokens) {
      const li = (entries.get(token.id) as Entry).li;
      if (li === cursor) cursor = cursor.nextElementSibling;
      else list.insertBefore(li, cursor);
    }
  }

  function render(state: BattleState, myId: string | null): void {
    const ids = [...state.queue.map((t) => t.id), ...state.fallen.map((t) => t.id)];
    const reordered =
      state.queue.length !== shownQueueLength || ids.length !== shownIds.length || ids.some((id, i) => id !== shownIds[i]);
    const moved = reordered || state.activeId !== shownActive;

    // FLIP, first: where every portrait is now, before anything moves.
    let first: Map<string, DOMRect> | null = null;
    if (moved && drawn && motionOk.matches) {
      first = new Map();
      for (const [id, entry] of entries) {
        const box = entry.li.getBoundingClientRect();
        if (box.width > 0 || box.height > 0) first.set(id, box);
      }
      for (const entry of entries.values()) {
        entry.flip?.cancel();
        entry.flip = null;
      }
    }

    const fresh = new Set<string>();
    for (const token of [...state.queue, ...state.fallen]) {
      if (!entries.has(token.id)) {
        build(token);
        fresh.add(token.id);
      }
    }

    if (reordered) {
      place(queueList, state.queue);
      place(fallenList, state.fallen);
      const keep = new Set(ids);
      for (const [id, entry] of entries) {
        if (keep.has(id)) continue;
        if (entry.stampTimer) clearTimeout(entry.stampTimer);
        entry.li.remove();
        entries.delete(id);
      }
      fallenList.hidden = state.fallen.length === 0;
    }

    for (const token of state.queue) update(entries.get(token.id) as Entry, token, myId, state.activeId, null);
    for (const token of state.fallen) update(entries.get(token.id) as Entry, token, myId, null, token.hp > 0 ? "away" : "down");
    put(root, "version", String(state.version));
    put(root, "status", state.status);

    // FLIP, last and invert: from where each was to where the server put it.
    if (first) {
      for (const [id, entry] of entries) {
        const was = first.get(id);
        if (!was) {
          if (fresh.has(id)) {
            entry.flip = entry.li.animate([{ opacity: 0, transform: "scale(0.85)" }, { opacity: 1, transform: "none" }], {
              duration: FLIP_MS,
              easing: FLIP_EASE,
            });
          }
          continue;
        }
        const now = entry.li.getBoundingClientRect();
        const dx = was.left - now.left;
        const dy = was.top - now.top;
        if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
        entry.flip = entry.li.animate([{ transform: `translate(${dx}px, ${dy}px)` }, { transform: "none" }], {
          duration: FLIP_MS,
          easing: FLIP_EASE,
        });
      }
    }

    shownIds = ids;
    shownQueueLength = state.queue.length;
    shownActive = state.activeId;
    drawn = true;
  }

  function flag(id: string, kind: "held" | "plate"): void {
    const entry = entries.get(id);
    if (!entry) return;
    if (entry.stampTimer) clearTimeout(entry.stampTimer);
    entry.stamp?.remove();
    // A new node each time, so a fade (CSS, no-preference only) starts over.
    const stamp = el("span", "strip-stamp", kind === "held" ? "Held" : "Up!");
    stamp.dataset.flag = kind;
    entry.plate.append(stamp);
    entry.stamp = stamp;
    entry.li.dataset.flag = kind;
    entry.stampTimer = setTimeout(() => {
      stamp.remove();
      if (entry.stamp === stamp) {
        entry.stamp = null;
        delete entry.li.dataset.flag;
      }
      entry.stampTimer = null;
    }, FLAG_MS);
  }

  async function afterimage(id: string): Promise<void> {
    const entry = entries.get(id);
    if (!entry || !motionOk.matches || !entry.li.isConnected) return;
    const picture = entry.face.firstElementChild;
    if (!picture) return;
    // Ghosts trail behind the portrait: down the strip in a column, along it in a row.
    const across = getComputedStyle(entry.li.parentElement as Element).flexDirection.startsWith("row");
    const ghosts: HTMLElement[] = [];
    const runs: Promise<unknown>[] = [];
    for (let i = 1; i <= GHOSTS; i++) {
      const ghost = el("span", "strip-face strip-ghost");
      ghost.setAttribute("aria-hidden", "true");
      ghost.append(picture.cloneNode(true));
      entry.plate.append(ghost);
      ghosts.push(ghost);
      const offset = i * 9;
      const run = ghost.animate(
        [
          { transform: across ? `translateX(${offset}px)` : `translateY(${offset}px)`, opacity: 0.6 - i * 0.14 },
          { transform: "none", opacity: 0 },
        ],
        { duration: GHOST_MS, delay: (i - 1) * 40, easing: "ease-out", fill: "both" },
      );
      runs.push(run.finished.catch(() => undefined));
    }
    await Promise.all(runs);
    for (const ghost of ghosts) ghost.remove();
  }

  return { render, flag, afterimage };
}
