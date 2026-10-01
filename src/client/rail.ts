// The signature element: the turn queue drawn as a notched brass rail.
//
// The rail renders the queue; it never computes it. Every token is placed from
// two numbers the server sent and nothing else: its `counter` (which notch) and
// whether it is `activeId` (the strike plate). Tokens appear in the DOM in the
// order of `state.queue`, and tokens sharing a notch stack in that same order.
// Nothing here sorts, decrements, predicts or infers whose turn comes next.
//
// Two things are display, not ordering, and are stated as such:
//   - the rail's length in notches is the largest counter in the queue, rounded
//     up to a whole labelled section, never shorter than MIN_NOTCHES;
//   - when two tokens would overprint each other, the later one in queue order
//     drops to the next lane (further from the bar). Its notch never changes.
import { ROLES, type BattleState, type Token } from "../shared/protocol.ts";
import { disc, mark, type Disc } from "./sigils.ts";

const MIN_NOTCHES = 15;

interface TokenView {
  el: HTMLLIElement;
  disc: Disc;
  name: HTMLElement;
  counter: HTMLElement;
  hp: HTMLElement;
  said: HTMLElement;
}

export interface Rail {
  render(state: BattleState, myId: string | null): void;
}

/** The rail's length in notches: display scaling only. */
export function railLength(queue: readonly Token[]): number {
  let largest = 0;
  for (const t of queue) if (t.counter > largest) largest = t.counter;
  const section = largest > 60 ? 10 : 5;
  return Math.max(MIN_NOTCHES, Math.ceil(largest / section) * section);
}

/** Which notch the server has put a token on. 0 is the strike plate. */
function notchOf(token: Token, activeId: string | null): number {
  if (token.id === activeId) return 0;
  return Math.max(0, token.counter);
}

function roleLabel(token: Token): string {
  return token.role === "orrery" ? "the enemy" : ROLES[token.role].label;
}

function ticks(n: number): string {
  return `${n} ${n === 1 ? "tick" : "ticks"}`;
}

/** The sentence a screen reader hears for a token: name, counter, strength. */
export function tokenSentence(token: Token, activeId: string | null, myId: string | null): string {
  const who = `${token.name}${token.id === myId ? " (you)" : ""}, ${roleLabel(token)}.`;
  let where: string;
  if (token.id === activeId) where = "On the strike plate, acting now.";
  else if (token.counter <= 0) where = "At the plate, waiting.";
  else where = `${ticks(token.counter)} from the plate.`;
  const marks = `${token.hasted ? " Hasted." : ""}${token.braced ? " Braced." : ""}`;
  return `${who} ${where} Strength ${token.hp} of ${token.maxHp}.${marks}`;
}

function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}

function setAttr(el: Element, name: string, value: string): void {
  if (el.getAttribute(name) !== value) el.setAttribute(name, value);
}

function setVar(el: HTMLElement, name: string, value: string): void {
  if (el.style.getPropertyValue(name) !== value) el.style.setProperty(name, value);
}

function span(className: string): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = className;
  return el;
}

function makeToken(token: Token): TokenView {
  const el = document.createElement("li");
  el.className = "token";
  el.dataset.tokenId = token.id;
  el.dataset.kind = token.kind;
  el.dataset.role = token.role;

  const face = span("token-disc");
  const d = disc(token.role);
  face.append(d.root, mark("hasted", "mark mark-hasted"), mark("braced", "mark mark-braced"));

  const tag = span("tag");
  tag.setAttribute("aria-hidden", "true");
  const name = span("tag-name");
  const numbers = span("tag-numbers");
  const wait = span("tag-wait");
  const waitWord = span("tag-unit");
  waitWord.textContent = "wait ";
  const counter = span("num tag-counter");
  wait.append(waitWord, counter);
  const strength = span("tag-strength");
  const hp = span("num tag-hp");
  const hpWord = span("tag-unit");
  hpWord.textContent = " hp";
  strength.append(hp, hpWord);
  numbers.append(wait, strength);
  tag.append(name, numbers);

  const said = span("visually-hidden");
  el.append(face, tag, said);
  return { el, disc: d, name, counter, hp, said };
}

/** Move the fewest nodes needed for `parent`'s children to read as `wanted`.
 *  Tokens that keep their relative order are left in place, so a slide in
 *  progress is not cut short by a DOM move. */
function reorder(parent: HTMLElement, wanted: readonly HTMLElement[]): void {
  const current = Array.from(parent.children) as HTMLElement[];
  const index = new Map(current.map((el, i) => [el, i]));
  const positions = wanted.map((el) => index.get(el) ?? -1);

  // Longest increasing run of existing positions: those nodes stay put.
  const n = positions.length;
  const best = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let end = -1;
  for (let i = 0; i < n; i++) {
    if (positions[i] < 0) continue;
    for (let j = 0; j < i; j++) {
      if (positions[j] >= 0 && positions[j] < positions[i] && best[j] + 1 > best[i]) {
        best[i] = best[j] + 1;
        prev[i] = j;
      }
    }
    if (end < 0 || best[i] > best[end]) end = i;
  }
  const keep = new Set<HTMLElement>();
  for (let i = end; i >= 0; i = prev[i]) keep.add(wanted[i]);

  let anchor: Node | null = null;
  for (let i = n - 1; i >= 0; i--) {
    const el = wanted[i];
    if (!keep.has(el)) parent.insertBefore(el, anchor);
    anchor = el;
  }
}

/** A CSS length the stylesheet hands over (rem or px), in px. */
function toPx(value: string, rootPx: number): number {
  const v = value.trim();
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n)) return 0;
  return v.endsWith("rem") ? n * rootPx : n;
}

function need<T extends Element>(root: ParentNode, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`the rail's markup is missing ${selector}`);
  return el;
}

export function mountRail(rail: HTMLElement): Rail {
  const track = need<HTMLElement>(rail, "[data-rail-track]");
  const notches = need<HTMLElement>(rail, "[data-rail-notches]");
  const list = need<HTMLOListElement>(rail, "[data-rail-tokens]");
  const plate = need<HTMLElement>(rail, "[data-rail-plate]");

  const views = new Map<string, TokenView>();
  let drawnLength = -1;
  let last: { state: BattleState; myId: string | null } | null = null;

  function drawNotches(length: number): void {
    if (length === drawnLength) return;
    drawnLength = length;
    const label = length <= 60 ? 5 : length <= 150 ? 10 : 25;
    const minor = length <= 120;
    const frag = document.createDocumentFragment();
    for (let n = 1; n <= length; n++) {
      const major = n % label === 0;
      if (!major && !minor) continue;
      const notch = span(major ? "notch notch-major" : "notch");
      notch.style.setProperty("--n", String(n));
      frag.append(notch);
      if (major) {
        const numeral = span("num notch-numeral");
        numeral.style.setProperty("--n", String(n));
        numeral.textContent = String(n);
        frag.append(numeral);
      }
    }
    notches.replaceChildren(frag);
  }

  /** Lanes: purely so tokens on nearby notches don't overprint. Queue order in,
   *  queue order out; a token's notch is never moved to make room. */
  function layLanes(queue: readonly Token[], activeId: string | null, length: number): void {
    const css = getComputedStyle(rail);
    const rootPx = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const vertical = css.getPropertyValue("--axis").trim() === "y";
    const along = toPx(css.getPropertyValue("--along"), rootPx);
    const plateHalf = toPx(css.getPropertyValue("--plate"), rootPx) / 2;
    const span_ = vertical ? track.clientHeight : track.clientWidth;

    const placed: { lane: number; at: number }[] = [];
    let lanes = 1;
    for (const token of queue) {
      const view = views.get(token.id);
      if (!view) continue;
      const notch = notchOf(token, activeId);
      const at = notch === 0 ? -plateHalf : (notch / length) * span_;
      let lane = 0;
      while (placed.some((p) => p.lane === lane && Math.abs(p.at - at) < along)) lane++;
      placed.push({ lane, at });
      lanes = Math.max(lanes, lane + 1);
      setVar(view.el, "--lane", String(lane));
    }
    setVar(rail, "--lanes", String(lanes));
  }

  function render(state: BattleState, myId: string | null): void {
    last = { state, myId };
    const { queue, activeId } = state;
    const length = railLength(queue);
    setVar(rail, "--length", String(length));
    drawNotches(length);

    const seen = new Set<string>();
    const ordered: HTMLElement[] = [];
    for (const token of queue) {
      seen.add(token.id);
      let view = views.get(token.id);
      if (!view) {
        view = makeToken(token);
        views.set(token.id, view);
      }
      const notch = notchOf(token, activeId);
      const el = view.el;
      setAttr(el, "data-counter", String(token.counter));
      setAttr(el, "data-active", String(token.id === activeId));
      setAttr(el, "data-kind", token.kind);
      setAttr(el, "data-mine", String(token.id === myId));
      setAttr(el, "data-hasted", String(token.hasted));
      setAttr(el, "data-braced", String(token.braced));
      setVar(el, "--pos", notch === 0 ? "0" : String(notch / length));
      setVar(el, "--on-plate", notch === 0 ? "1" : "0");

      const share = token.maxHp > 0 ? Math.min(100, Math.max(0, (token.hp / token.maxHp) * 100)) : 0;
      setAttr(view.disc.ring, "stroke-dasharray", `${share.toFixed(1)} 100`);
      setAttr(el, "data-low", String(share <= 30));

      setText(view.name, token.name);
      setText(view.counter, String(token.counter));
      setText(view.hp, String(token.hp));
      setText(view.said, tokenSentence(token, activeId, myId));
      ordered.push(el);
    }

    for (const [id, view] of views) {
      if (!seen.has(id)) {
        view.el.remove();
        views.delete(id);
      }
    }
    // Lanes before insertion, so a token that has just sat down appears where
    // it belongs instead of sliding in from the rail's corner.
    layLanes(queue, activeId, length);
    reorder(list, ordered);

    const holder = queue.find((t) => t.id === activeId);
    setAttr(plate, "data-holder", holder ? holder.kind : "none");
    setAttr(rail, "data-version", String(state.version));
  }

  // The rail changes shape at the narrow breakpoint and with the window; lanes
  // are re-laid for the same state, which moves no token off its notch.
  new ResizeObserver(() => {
    if (last) layLanes(last.state.queue, last.state.activeId, railLength(last.state.queue));
  }).observe(track);

  return { render };
}

/** Characters who fell or left: off the rail, never back on it by our hand. */
export function renderFallen(host: HTMLElement, list: HTMLElement, fallen: readonly Token[], myId: string | null): void {
  host.hidden = fallen.length === 0;
  const key = fallen.map((t) => `${t.id}:${t.name}:${t.id === myId}`).join("|");
  if (list.dataset.key === key) return;
  list.dataset.key = key;
  const frag = document.createDocumentFragment();
  for (const token of fallen) {
    const li = document.createElement("li");
    li.className = "fallen-token";
    li.dataset.fallenId = token.id;
    li.dataset.mine = String(token.id === myId);
    const face = span("fallen-disc");
    const d = disc(token.role);
    // Off the rail, strength no longer reads as a ring.
    d.ring.remove();
    face.append(d.root);
    const name = span("tag-name");
    name.textContent = `${token.name}${token.id === myId ? " (you)" : ""}`;
    const role = span("fallen-role");
    // hp tells a fall from a departure; the server's log says which, too.
    role.textContent = `${roleLabel(token)}, ${token.hp <= 0 ? "down" : "left the table"}`;
    li.append(face, name, role);
    frag.append(li);
  }
  list.replaceChildren(frag);
}
