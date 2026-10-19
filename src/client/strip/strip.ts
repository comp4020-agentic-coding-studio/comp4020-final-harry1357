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
//
// Phase two (the strip as the play surface, ADR-006) adds, all from state so
// a client joining mid-fight sees the same strip: the boss cards above the
// queue (./cards.ts), the Chain (data-chained on a portrait whose neighbour
// above it in the order sent is also a player, data-chain-live while the
// server's chain is running through it), data-drifting, data-echo and
// data-seated-echo on every portrait, your own pinned with "You in N"
// (data-ahead: how many portraits are ahead of yours in the order sent), the
// card aimed at a portrait mirrored on it (data-aimed), and the plate's clock
// (data-beat) drawn against the server's plateMs. The ghost (preview()) is
// never [data-token-id]: it is [data-ghost-of], in the slot the server's
// preview names, in the server's order.
import { ROLES, type ActionPreview, type BattleState, type BossCard, type RoleId, type Token } from "../../shared/protocol.ts";
import type { CardMoment, PartsOptions, Strip } from "../battle/api.ts";
import { countdownFraction } from "../command/window.ts";
import { INTENT_ART, INTENT_LABEL, createCardLane } from "./cards.ts";
import { orreryPortrait } from "./orrery.ts";
import { BRACE, DOWN, DRIFT, ECHO, HASTE, LINK, LINK_ACROSS, STAR, pixelIcon } from "./pixels.ts";

/** How long a flag (a held turn, a turn reached) stays on a portrait. */
const FLAG_MS = 1_100;
const FLIP_MS = 300;
const FLIP_EASE = "cubic-bezier(0.2, 0.8, 0.2, 1)";
const GHOSTS = 3;
const GHOST_MS = 460;
/** At or under this share of max HP the mini-bar turns ember. A colour, not a rule. */
const LOW_HP = 1 / 3;
/** How often the plate's clock is redrawn between messages (the server sends none while someone's on the plate). */
const BEAT_MS = 100;
/** Retrograde flips "the next five slots" (the server's RETROGRADE_SLOTS): the portraits its event is about. */
/** The Chain's potency is capped at +50% (rule 15): five pips, one per +10% the server reports. */
const CHAIN_PIPS = 5;

type Out = "down" | "away";
type Flag = "held" | "plate" | "jump" | "quickened" | "reacted" | "relayed" | "restored";

/** The word a flag stamps across a portrait's face. */
const FLAG_WORD: Readonly<Record<Flag, string>> = {
  held: "Held",
  plate: "Up!",
  jump: "Jump!",
  quickened: "Quick!",
  reacted: "React!",
  relayed: "Relay",
  restored: "Back!",
};

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
  /** Phase two: the YOU tab, which reads "You in N". */
  you: HTMLElement;
  /** Phase two: the intent of the card aimed at this portrait, mirrored on it. */
  aim: HTMLElement;
  aimKey: string;
  /** Phase two: the plate's clock, drained against plateMs. */
  beat: HTMLElement;
}

/** What a portrait shows of the strip around it (phase two), all read from the state as sent. */
interface Around {
  /** Portraits ahead of yours in the order sent, for your own; null for anyone else's. */
  ahead: number | null;
  /** The portrait above it in the order sent is a player too: a Chain link between them. */
  chained: boolean;
  /** ...and the server's Chain is running through it: every portrait from the top to here is a player. */
  live: boolean;
  /** The boss cards aimed at it, in the order sent. */
  aimed: readonly BossCard[];
  /** A name for whoever seated it, if it's an Echo seated on purpose. */
  seatedBy: string | null;
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
function spoken(token: Token, mine: boolean, active: boolean, out: Out | null, around?: Around): string {
  const parts = [token.kind === "boss" ? `${token.name}, the enemy` : `${token.name}, ${roleLabel(token)}`];
  if (token.echo) {
    parts.push(token.seatedBy != null ? `an Echo the server plays, seated by ${around?.seatedBy ?? "someone at the table"}` : "an Echo: the server plays this seat until they act");
  }
  if (out) {
    if (mine) parts.push("you");
    parts.push(out === "down" ? "down" : "away from the table");
  } else if (active) {
    parts.push(mine ? "your turn" : "acting now");
  } else {
    if (mine) parts.push(around?.ahead ? `you, ${around.ahead} ahead of you` : "you, next");
    parts.push(`waits ${token.counter}`);
  }
  if (!out && token.drifting) parts.push("drifting: the table braced for them");
  if (!out && token.hasted) parts.push("hasted");
  if (!out && token.braced) parts.push("braced");
  if (!out && around?.live) parts.push("in the Chain");
  for (const card of around?.aimed ?? []) {
    parts.push(`${INTENT_LABEL[card.intent] ?? card.intent} aimed at them, ${card.countdown <= 0 ? "next" : `in ${card.countdown}`}`);
  }
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
    // phase two
    echo: pixelIcon(ECHO, "strip-echo", 2),
    drift: pixelIcon(DRIFT, "strip-icon strip-drift", 2),
    link: pixelIcon(LINK, "strip-link", 2),
    star: pixelIcon(STAR, "strip-icon strip-res", 2),
  };
  const aimIcons = new Map<string, SVGSVGElement>();
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

  // Phase two: the head, above the portraits. The Orrery's cards, its
  // Alignment clock, and the Chain. It runs the way the strip does
  // (--strip-flow): down the column, or along the phone's row.
  const cards = createCardLane();
  const chainEl = el("p", "strip-chain");
  chainEl.hidden = true;
  const chainSay = el("span", "visually-hidden");
  const chainLink = pixelIcon(LINK_ACROSS, "strip-chain-link", 2);
  const chainWord = el("span", "strip-chain-word", "Chain");
  const chainCount = el("span", "strip-chain-count");
  const chainPips = el("span", "strip-chain-pips");
  const pips: HTMLElement[] = [];
  for (let i = 0; i < CHAIN_PIPS; i++) pips.push(chainPips.appendChild(el("span", "strip-chain-pip")));
  const chainBonus = el("span", "strip-chain-bonus");
  for (const part of [chainLink, chainWord, chainCount, chainPips, chainBonus]) part.setAttribute("aria-hidden", "true");
  chainEl.append(chainSay, chainLink, chainWord, chainCount, chainPips, chainBonus);
  const head = el("div", "strip-head");
  head.append(cards.list, cards.clock, chainEl);
  root.replaceChildren(title, head, lanes);

  let shownIds: string[] = [];
  let shownQueueLength = -1;
  let shownActive: string | null = null;
  let drawn = false;
  /** The state last drawn, for the moments and the ghost to read. Never changed here. */
  let latest: BattleState | null = null;
  let ghost: { actorId: string; preview: ActionPreview; li: HTMLLIElement } | null = null;
  /** Where the lanes were scrolled before a ghost scrolled them to show itself. */
  let scrolledFrom: { left: number; top: number } | null = null;
  let beatId: string | null = null;
  let beatTimer: ReturnType<typeof setInterval> | null = null;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  /** Mark something for a beat, then let it go: a frame, held (any fade is CSS, no-preference only). */
  function momentOn(node: HTMLElement, key: string, value: string, name = "moment"): void {
    const was = timers.get(key);
    if (was) clearTimeout(was);
    node.dataset[name] = value;
    timers.set(
      key,
      setTimeout(() => {
        delete node.dataset[name];
        timers.delete(key);
      }, FLAG_MS),
    );
  }

  /** The strip runs down a column or along a row (mobile.css says which); the CSS for links and the ghost reads it. */
  function across(): boolean {
    return getComputedStyle(queueList).flexDirection.startsWith("row");
  }
  function readFlow(): void {
    put(root, "flow", across() ? "row" : "column");
  }
  if (typeof ResizeObserver === "function") new ResizeObserver(readFlow).observe(root);

  function aimIcon(intent: BossCard["intent"]): SVGSVGElement {
    let svg = aimIcons.get(intent);
    if (!svg) {
      svg = pixelIcon(INTENT_ART[intent] ?? INTENT_ART.revolution, `strip-intent strip-intent-${intent}`, 2);
      aimIcons.set(intent, svg);
    }
    return svg.cloneNode(true) as SVGSVGElement;
  }

  function art(token: Token): Element | null {
    if (token.kind === "boss" || token.role === "orrery") {
      if (orrery === undefined) orrery = orreryPortrait(opts.orrerySvg);
      return orrery ? orrery() : null;
    }
    const role = opts.manifest.roles[token.role];
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
    const you = el("span", "strip-you", "You");
    // phase two: the card aimed here, the plate's clock, the Echo's and the drift's marks, the Chain link above
    const aim = el("span", "strip-aim");
    const beat = el("span", "strip-beat-fill");
    const beatBar = el("span", "strip-beat");
    beatBar.append(beat);
    // An Echo is never taken for a person: its glyph and its word, on a tab over the foot of the face.
    const echoTab = el("span", "strip-echo-tab");
    echoTab.append(icons.echo.cloneNode(true), el("span", "strip-echo-word", "Echo"));
    plate.append(
      face,
      hpBar,
      you,
      icons.haste.cloneNode(true),
      icons.brace.cloneNode(true),
      icons.down.cloneNode(true),
      echoTab,
      icons.drift.cloneNode(true),
      aim,
      beatBar,
      icons.link.cloneNode(true),
    );

    const wait = el("span", "strip-wait");
    const count = el("span", "strip-count");
    wait.append(el("span", "strip-label"), count);
    const name = el("span", "strip-name");

    card.append(plate, wait, name);
    li.append(say, card);
    const entry: Entry = { li, say, plate, face, count, name, hp, role: "", flip: null, stamp: null, stampTimer: null, you, aim, aimKey: "", beat };
    entries.set(token.id, entry);
    return entry;
  }

  /** Phase two: what a portrait shows of the strip around it, all from the state as sent. */
  function mark(entry: Entry, token: Token, mine: boolean, active: boolean, out: Out | null, around: Around): void {
    const { li } = entry;
    put(li, "drifting", String(token.drifting === true));
    put(li, "echo", String(token.echo === true));
    if (token.echo && token.seatedBy != null) put(li, "seatedEcho", "true");
    else if (li.dataset.seatedEcho !== undefined) delete li.dataset.seatedEcho;
    put(li, "chained", String(!out && around.chained));
    put(li, "chainLive", String(!out && around.live));

    // You in N: the portraits ahead of yours, counted in the order sent.
    if (mine && !out && around.ahead !== null) {
      put(li, "ahead", String(around.ahead));
      text(entry.you, active ? "You" : around.ahead === 0 ? "You next" : `You in ${around.ahead}`);
    } else {
      if (li.dataset.ahead !== undefined) delete li.dataset.ahead;
      text(entry.you, "You");
    }

    // The card aimed here, mirrored: the soonest one's intent, and how many more.
    const aimed = out ? [] : around.aimed;
    const key = aimed.map((c) => `${c.id}:${c.intent}`).join(",");
    if (entry.aimKey !== key) {
      entry.aimKey = key;
      const first = aimed[0];
      entry.aim.replaceChildren(...(first ? [aimIcon(first.intent)] : []));
      if (aimed.length > 1) entry.aim.append(el("span", "strip-aim-more", `+${aimed.length - 1}`));
      if (first) put(li, "aimed", first.intent);
      else if (li.dataset.aimed !== undefined) delete li.dataset.aimed;
    }
  }

  function update(entry: Entry, token: Token, myId: string | null, activeId: string | null, out: Out | null, around?: Around): void {
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
    if (around) mark(entry, token, mine, active, out, around);
    text(entry.say, spoken(token, mine, active, out, around));
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
      // The ghost isn't a portrait: out of the way while the portraits are placed, back after (keepGhost).
      ghost?.li.remove();
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

    // Phase two: what each portrait shows of the strip around it, read in the order sent.
    const cardsSent = state.cards ?? [];
    const links = state.chain?.links ?? 0;
    const nameOf = (id: string | null): string | null =>
      id === null ? null : ([...state.queue, ...state.fallen].find((t) => t.id === id)?.name ?? null);
    const mineAt = myId ? state.queue.findIndex((t) => t.id === myId) : -1;
    let run = true;
    state.queue.forEach((token, i) => {
      const player = token.kind === "character";
      run = run && player;
      const chained = i > 0 && player && state.queue[i - 1].kind === "character";
      const around: Around = {
        ahead: token.id === myId && mineAt >= 0 ? mineAt : null,
        chained,
        live: chained && run && links > 0,
        aimed: cardsSent.filter((c) => c.targetId === token.id),
        seatedBy: nameOf(token.seatedBy ?? null),
      };
      update(entries.get(token.id) as Entry, token, myId, state.activeId, null, around);
    });
    for (const token of state.fallen) {
      const around: Around = { ahead: null, chained: false, live: false, aimed: [], seatedBy: nameOf(token.seatedBy ?? null) };
      update(entries.get(token.id) as Entry, token, myId, null, token.hp > 0 ? "away" : "down", around);
    }
    put(root, "version", String(state.version));
    put(root, "status", state.status);
    latest = state;
    if (!drawn) readFlow();
    drawHead(state, myId);
    drawBeat(state);
    keepGhost(state);

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

  function flag(id: string, kind: Flag): void {
    const entry = entries.get(id);
    if (entry) stampOn(entry, kind, FLAG_WORD[kind] ?? kind);
  }

  /** A stamp across a portrait's face for about a second: a flag, or one of phase two's moments. */
  function stampOn(entry: Entry, kind: string, word: string): void {
    if (entry.stampTimer) clearTimeout(entry.stampTimer);
    entry.stamp?.remove();
    // A new node each time, so a fade (CSS, no-preference only) starts over.
    const stamp = el("span", "strip-stamp", word);
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

  // --- phase two: the head (cards, the Alignment clock, the Chain) ------------

  function drawHead(state: BattleState, myId: string | null): void {
    cards.render(state, myId);
    const links = state.chain?.links ?? 0;
    const potency = state.chain?.potency ?? 1;
    // The server's potency, as words and pips: +10% a pip, five at the cap.
    const bonus = Math.round((potency - 1) * 100);
    const lit = Math.max(0, Math.min(CHAIN_PIPS, Math.round((potency - 1) * 10)));
    chainEl.hidden = state.status !== "fighting";
    put(root, "chain", String(links));
    put(chainEl, "links", String(links));
    put(chainEl, "live", String(links > 0));
    text(chainCount, String(links));
    text(chainBonus, bonus > 0 ? `+${bonus}%` : "");
    pips.forEach((pip, i) => put(pip, "lit", String(i < lit)));
    text(
      chainSay,
      links > 0
        ? `Chain: ${links} player ${links === 1 ? "turn" : "turns"} with no boss turn between${bonus > 0 ? `; the next player turn deals +${bonus}%` : ""}.`
        : "No Chain: the next player turn starts one.",
    );
  }

  // --- phase two: the plate's clock ---------------------------------------------
  // Drawn against plateMs (a person's turn, or an Echo's beat; review R8), from
  // the server's deadline. It counts nothing down that decides anything: the
  // server plays the Echo when its beat is out, whatever this bar shows.

  function drawBeat(state: BattleState): void {
    const up = state.queue.find((t) => t.id === state.activeId && t.kind === "character");
    const running = !!up && state.status === "fighting" && state.turnDeadline != null && (state.plateMs ?? 0) > 0;
    const id = running && up ? up.id : null;
    if (beatId && beatId !== id) {
      const was = entries.get(beatId);
      if (was) delete was.li.dataset.beat;
    }
    beatId = id;
    if (id && up) {
      put((entries.get(id) as Entry).li, "beat", up.echo ? "echo" : "turn");
      tickBeat();
      beatTimer ??= setInterval(tickBeat, BEAT_MS);
    } else if (beatTimer) {
      clearInterval(beatTimer);
      beatTimer = null;
    }
  }

  function tickBeat(): void {
    const entry = beatId ? entries.get(beatId) : undefined;
    if (!entry || !latest) return;
    const left = (countdownFraction(latest, Date.now()) ?? 0).toFixed(3);
    if (entry.beat.style.getPropertyValue("--beat") !== left) entry.beat.style.setProperty("--beat", left);
  }

  // --- phase two: the ghost -------------------------------------------------------
  // The server's preview, drawn: the actor's face, dashed, in preview.slot of
  // the queue as sent (that many of everyone else ahead of it), with the wait
  // it would reset to and a gold star if it would resonate. Nothing here works
  // out a slot or a wait (rule 1).

  function buildGhost(actor: Entry, token: Token): HTMLLIElement {
    const li = el("li", "strip-token strip-preview");
    li.setAttribute("aria-hidden", "true");
    li.dataset.ghostOf = token.id;
    li.dataset.kind = token.kind;
    li.dataset.role = token.role;
    const card = el("span", "strip-card");
    const plate = el("span", "strip-plate");
    const face = el("span", "strip-face");
    const picture = actor.face.firstElementChild;
    if (picture) face.append(picture.cloneNode(true));
    plate.append(face, el("span", "strip-here", "Here"), icons.star.cloneNode(true));
    const wait = el("span", "strip-wait");
    wait.append(el("span", "strip-label"), el("span", "strip-count"));
    card.append(plate, wait, el("span", "strip-name", token.name));
    li.append(card);
    return li;
  }

  function placeGhost(): void {
    if (!ghost || !latest) return;
    const actorId = ghost.actorId;
    const others = latest.queue.filter((t) => t.id !== actorId);
    const there = others[ghost.preview.slot];
    const before = there ? (entries.get(there.id)?.li ?? null) : null;
    if (ghost.li.parentElement !== queueList || ghost.li.nextElementSibling !== before) queueList.insertBefore(ghost.li, before);
    put(ghost.li, "across", String(across()));
    put(ghost.li, "last", String(!there));
  }

  function clearGhost(): void {
    ghost?.li.remove();
    ghost = null;
    // Hand back whatever the ghost scrolled to show itself.
    if (scrolledFrom) {
      lanes.scrollLeft = scrolledFrom.left;
      lanes.scrollTop = scrolledFrom.top;
      scrolledFrom = null;
    }
  }

  /** Scroll the strip's own lanes, never the page, until `node` is in view: a ghost below the fold can't be read. */
  function reveal(node: HTMLElement): void {
    const box = node.getBoundingClientRect();
    const port = lanes.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) return;
    scrolledFrom ??= { left: lanes.scrollLeft, top: lanes.scrollTop };
    const margin = 8;
    if (box.bottom > port.bottom) lanes.scrollTop += box.bottom - port.bottom + margin;
    else if (box.top < port.top) lanes.scrollTop -= port.top - box.top + margin;
    if (box.right > port.right) lanes.scrollLeft += box.right - port.right + margin;
    else if (box.left < port.left) lanes.scrollLeft -= port.left - box.left + margin;
  }

  /** A new state: the ghost stays only while its actor is still the one on the plate the server previews. */
  function keepGhost(state: BattleState): void {
    if (!ghost) return;
    const p = state.preview;
    const still =
      state.status === "fighting" &&
      state.activeId === ghost.actorId &&
      entries.has(ghost.actorId) &&
      (p === undefined || (p !== null && p.actorId === ghost.actorId));
    if (still) placeGhost();
    else clearGhost();
  }

  function preview(actorId: string | null, p: ActionPreview | null): void {
    const actor = actorId ? entries.get(actorId) : undefined;
    const token = actorId ? latest?.queue.find((t) => t.id === actorId) : undefined;
    if (!actorId || !p || !actor || !token) {
      clearGhost();
      return;
    }
    const li = ghost?.actorId === actorId ? ghost.li : (clearGhost(), buildGhost(actor, token));
    put(li, "slot", String(p.slot));
    put(li, "counter", String(p.counter));
    put(li, "resonance", String(p.resonance));
    put(li, "refused", String(p.refusal !== null));
    text(li.querySelector(".strip-count") as HTMLElement, String(p.counter));
    ghost = { actorId, preview: p, li };
    placeGhost();
    reveal((li.firstElementChild as HTMLElement | null) ?? li);
  }

  // --- phase two: the moments -----------------------------------------------------

  function card(cardId: string, moment: CardMoment): void {
    cards.moment(cardId, moment);
  }

  function chain(_links: number, broken: boolean): void {
    // The links are drawn from state already; this marks the moment they grew or broke.
    momentOn(chainEl, "chain", broken ? "broken" : "grow");
    momentOn(root, "chain-moment", broken ? "broken" : "grow", "chainMoment");
  }

  function jump(id: string, _from: number, _to: number): void {
    // The portrait is already where the server put it (render, FLIP under no-preference); this is the gold mark on it.
    const entry = entries.get(id);
    if (entry) stampOn(entry, "jump", FLAG_WORD.jump);
  }

  function retrograde(flipped: boolean, cancelledBy: string | null, slots: readonly string[] = []): void {
    if (flipped) {
      // Exactly the portraits the server turned about (the event's slots), already drawn in their new order, marked flipped.
      for (const id of slots) {
        const entry = entries.get(id);
        if (entry) stampOn(entry, "flip", "Flip");
      }
    }
    const gone = cards.departedOf("retrograde");
    if (gone) cards.moment(gone, cancelledBy ? "cancelled" : "resolved");
    const by = cancelledBy ? entries.get(cancelledBy) : undefined;
    if (by) stampOn(by, "holds", "Holds");
  }

  function alignment(countdown: number, wipe: boolean): void {
    cards.alignment(countdown, wipe);
    const gone = cards.departedOf("alignment");
    if (gone) cards.moment(gone, "resolved");
  }

  return { render, flag, afterimage, preview, card, chain, jump, retrograde, alignment };
}
