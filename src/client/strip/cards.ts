// The Orrery's boss cards on the turn strip (rule 19; ADR-006): every attack
// is announced here before it resolves, with an intent icon, a target marker,
// the number it deals and its countdown.
//
// Rule 1 holds here as it does for the portraits. `state.cards` is drawn in
// the order sent (the server keeps it soonest first); nothing here sorts it,
// counts a countdown down, or works out when a card lands. The countdown is
// the server's: 0 is "next" (the Orrery's next turn), anything else "in N".
// The Grand Alignment's clock is the state's (alignmentLeft), so a client that
// joins in phase III draws it at once; the alignment event marks its moment.
//
// Hooks other code reads: each card is [data-card-id] with data-intent,
// data-target (a character id, "party", or "strip" for a card that touches
// the strip itself), data-countdown and data-frozen; data-at-me when it is
// aimed at this page's seat; data-react names your Reaction when the server
// names this card for it (the token's reactionCard).
// A card the server has taken off the strip is never [data-card-id]: if a
// renderer marks its moment (it landed, passed over, was cancelled), a copy is
// drawn leaving, as [data-left-card], and then it's gone.
import { ACTIONS, ROLES, type BattleState, type BossCard, type Intent, type RoleId, type Token } from "../../shared/protocol.ts";
import type { CardMoment } from "../battle/api.ts";
import { AIM, ALIGNMENT, ECLIPSE, FROST, LUNGE, PERIHELION, RETROGRADE, REVOLUTION, pixelIcon } from "./pixels.ts";

/** How long a card's moment stays marked; the same beat as a portrait's flag. */
const MOMENT_MS = 1_100;
/** How long a card taken off the strip can still be drawn leaving. */
const DEPARTED_MS = 4_000;

export const INTENT_ART: Readonly<Record<Intent, readonly string[]>> = {
  revolution: REVOLUTION,
  eclipse: ECLIPSE,
  lunge: LUNGE,
  perihelion: PERIHELION,
  retrograde: RETROGRADE,
  alignment: ALIGNMENT,
};

export const INTENT_LABEL: Readonly<Record<Intent, string>> = {
  revolution: "Revolution",
  eclipse: "Eclipse",
  lunge: "Lunge",
  perihelion: "Perihelion",
  retrograde: "Retrograde",
  alignment: "Alignment",
};

/** What each intent does, for a screen reader: the card's picture in words. */
const INTENT_SAYS: Readonly<Record<Intent, string>> = {
  revolution: "raid-wide damage",
  eclipse: "a blow on one",
  lunge: "a blow on one, and a Gravity stack",
  perihelion: "raid-wide damage, a Break check",
  retrograde: "flips the next five on the strip",
  alignment: "the Grand Alignment's clock",
};

/** The word stamped on a card for its moment. */
const MOMENT_WORD: Readonly<Record<CardMoment, string>> = {
  announced: "New",
  resolved: "Lands",
  spent: "Passes",
  delayed: "Pushed",
  frozen: "Frozen",
  retargeted: "Retarget",
  cancelled: "Undone",
};

interface CardEntry {
  li: HTMLLIElement;
  say: HTMLElement;
  at: HTMLElement;
  amount: HTMLElement;
  label: HTMLElement;
  count: HTMLElement;
  react: HTMLElement;
  key: string;
  card: BossCard;
  stamp: HTMLElement | null;
  timer: ReturnType<typeof setTimeout> | null;
}

interface Departed {
  li: HTMLLIElement;
  index: number;
  at: number;
  card: BossCard;
}

export interface CardLane {
  /** The cards, soonest first as sent. */
  list: HTMLOListElement;
  /** The Grand Alignment's clock, once an Alignment has resolved this fight. */
  clock: HTMLElement;
  render(state: BattleState, myId: string | null): void;
  moment(cardId: string, moment: CardMoment): void;
  /** The most recent card of this intent the server took off the strip, if it can still be drawn leaving. */
  departedOf(intent: Intent): string | null;
  alignment(countdown: number, wipe: boolean): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function put(node: HTMLElement, key: string, value: string): void {
  if (node.dataset[key] !== value) node.dataset[key] = value;
}

function text(node: Node, value: string): void {
  if (node.textContent !== value) node.textContent = value;
}

/** Who a card lands on, as the card says it: "You", a name, "All", or "Strip". */
export function targetName(state: BattleState, targetId: string | null, myId: string | null): string {
  if (targetId === null) return "Strip";
  if (targetId === "party") return "All";
  if (targetId === myId) return "You";
  const token: Token | undefined = state.queue.find((t) => t.id === targetId) ?? state.fallen?.find((t) => t.id === targetId);
  return token?.name ?? "Someone";
}

/** The Reaction your role answers a card with, by label, if it has one. */
function reactionLabel(token: Token | undefined): { id: string; label: string } | null {
  if (!token || !(token.role in ROLES)) return null;
  const id = ROLES[token.role as RoleId].actions.find((a) => ACTIONS[a].reaction);
  return id ? { id, label: ACTIONS[id].label } : null;
}

export function createCardLane(): CardLane {
  const list = el("ol", "strip-cards");
  list.setAttribute("aria-label", "The Orrery's cards, soonest first");
  list.hidden = true;
  const clock = el("p", "strip-align");
  clock.hidden = true;
  const clockSay = el("span", "visually-hidden");
  const clockArt = el("span", "strip-align-art");
  clockArt.setAttribute("aria-hidden", "true");
  const clockWord = el("span", "strip-align-word");
  clockWord.setAttribute("aria-hidden", "true");
  clock.append(clockSay, clockArt, clockWord);

  const icons = new Map<Intent, SVGSVGElement>();
  const aim = pixelIcon(AIM, "strip-bc-aim", 2);
  const frost = pixelIcon(FROST, "strip-bc-frost", 2);
  const entries = new Map<string, CardEntry>();
  const departed = new Map<string, Departed>();
  let battleId: string | null = null;
  let alignClock: number | null = null;
  let alignWipe = false;
  let clockStamp: ReturnType<typeof setTimeout> | null = null;

  function icon(intent: Intent): SVGSVGElement {
    let svg = icons.get(intent);
    if (!svg) {
      // 2x: the same size as the intent mirrored on the target's portrait, so the two read as one mark
      svg = pixelIcon(INTENT_ART[intent] ?? REVOLUTION, `strip-intent strip-intent-${intent}`, 2);
      icons.set(intent, svg);
    }
    return svg.cloneNode(true) as SVGSVGElement;
  }

  clockArt.append(icon("alignment"));

  function build(card: BossCard): CardEntry {
    const li = el("li", "strip-boss-card");
    li.dataset.cardId = card.id;
    const say = el("span", "visually-hidden");
    const body = el("span", "strip-bc-body");
    body.setAttribute("aria-hidden", "true");
    const art = el("span", "strip-bc-art");
    art.append(icon(card.intent));
    const what = el("span", "strip-bc-what");
    const word = el("span", "strip-bc-word", INTENT_LABEL[card.intent] ?? card.intent);
    const amount = el("span", "strip-bc-amount");
    what.append(word);
    const at = el("span", "strip-bc-name");
    const target = el("span", "strip-bc-at");
    target.append(aim.cloneNode(true), at);
    const when = el("span", "strip-bc-when");
    const label = el("span", "strip-bc-label");
    const count = el("span", "strip-bc-count");
    when.append(label, count);
    const frozen = el("span", "strip-bc-frozen");
    frozen.append(frost.cloneNode(true), el("span", "", "Frozen"));
    const react = el("span", "strip-bc-react");
    body.append(art, what, target, when, amount, frozen, react);
    li.append(say, body);
    const entry: CardEntry = { li, say, at, amount, label, count, react, key: "", card, stamp: null, timer: null };
    entries.set(card.id, entry);
    return entry;
  }

  function update(entry: CardEntry, card: BossCard, state: BattleState, myId: string | null, mine: Token | undefined): void {
    const name = targetName(state, card.targetId, myId);
    const reaction = mine && mine.reactionCard === card.id ? reactionLabel(mine) : null;
    const clockKey = card.intent === "alignment" && alignClock !== null ? String(alignClock) : "";
    const key = [card.intent, card.targetId ?? "", name, card.amount ?? "", card.countdown, card.frozen, reaction?.id ?? "", clockKey].join("|");
    entry.card = card;
    if (entry.key === key) return;
    entry.key = key;
    const { li } = entry;
    put(li, "intent", card.intent);
    put(li, "target", card.targetId === null ? "strip" : card.targetId);
    put(li, "countdown", String(card.countdown));
    put(li, "frozen", String(card.frozen));
    put(li, "atMe", String(card.targetId !== null && card.targetId === myId));
    if (reaction) put(li, "react", reaction.id);
    else if (li.dataset.react !== undefined) delete li.dataset.react;
    if (clockKey) put(li, "clock", clockKey);
    else if (li.dataset.clock !== undefined) delete li.dataset.clock;

    text(entry.at, name);
    entry.at.title = name;
    text(entry.amount, card.amount === null ? "" : String(card.amount));
    text(entry.label, card.countdown <= 0 ? "Next" : "In");
    text(entry.count, card.countdown <= 0 ? "" : String(card.countdown));
    text(entry.react, reaction ? `React: ${reaction.label}` : "");

    const when = card.countdown <= 0 ? "on the Orrery's next turn" : `in ${card.countdown} of the Orrery's turns`;
    const on = card.targetId === null ? "on the strip" : card.targetId === "party" ? "on everyone" : `on ${name === "You" ? "you" : name}`;
    const parts = [`${INTENT_LABEL[card.intent] ?? card.intent} ${on}`, INTENT_SAYS[card.intent] ?? ""];
    if (card.amount !== null) parts.push(`${card.amount} before mitigation`);
    parts.push(card.frozen ? `frozen, ${when} once it thaws` : when);
    if (clockKey) parts.push(alignWipe ? "the Grand Alignment is complete" : `${alignClock} more and the Grand Alignment is complete`);
    if (reaction) parts.push(`your ${reaction.label} can answer it now`);
    text(entry.say, parts.filter(Boolean).join(", "));
  }

  function place(cards: readonly BossCard[]): void {
    let cursor = list.firstElementChild as HTMLElement | null;
    for (const card of cards) {
      while (cursor && cursor.dataset.leaving !== undefined) cursor = cursor.nextElementSibling as HTMLElement | null;
      const li = (entries.get(card.id) as CardEntry).li;
      if (li === cursor) cursor = cursor.nextElementSibling as HTMLElement | null;
      else list.insertBefore(li, cursor);
    }
  }

  function drawClock(): void {
    clock.hidden = alignClock === null;
    if (alignClock === null) return;
    put(clock, "clock", String(alignClock));
    put(clock, "wipe", String(alignWipe));
    text(clockWord, alignWipe ? "Wipe" : `${alignClock} left`);
    text(
      clockSay,
      alignWipe
        ? "The Grand Alignment is complete."
        : `The Grand Alignment: ${alignClock} more ${alignClock === 1 ? "Alignment" : "Alignments"} and it is complete.`,
    );
  }

  function render(state: BattleState, myId: string | null): void {
    if (state.battleId !== battleId) {
      // A new fight: the old fight's clock and leavers are nobody's now.
      battleId = state.battleId;
      alignClock = null;
      alignWipe = false;
      departed.clear();
      for (const node of [...list.querySelectorAll<HTMLElement>("[data-leaving]")]) node.remove();
    }
    // The clock, from the state: how many Alignments are left, or none before phase III.
    const left = state.alignmentLeft ?? null;
    if (left !== alignClock && !(alignWipe && left === 0)) {
      alignClock = left;
      if (left !== 0) alignWipe = false;
      drawClock();
    }
    const cards = state.cards ?? [];
    const mine = myId ? state.queue.find((t) => t.id === myId) : undefined;
    for (const card of cards) {
      const entry = entries.get(card.id) ?? build(card);
      update(entry, card, state, myId, mine);
    }
    place(cards);

    const now = Date.now();
    const keep = new Set(cards.map((c) => c.id));
    for (const [id, entry] of entries) {
      if (keep.has(id)) continue;
      // Taken off the strip by the server: gone from the lane at once, but
      // remembered for a moment in case a renderer says how it went.
      const index = [...list.children].indexOf(entry.li);
      if (entry.timer) clearTimeout(entry.timer);
      entry.stamp?.remove();
      entry.stamp = null;
      delete entry.li.dataset.moment;
      entry.li.remove();
      entries.delete(id);
      departed.set(id, { li: entry.li, index: Math.max(0, index), at: now, card: entry.card });
    }
    for (const [id, gone] of departed) if (now - gone.at > DEPARTED_MS) departed.delete(id);

    list.hidden = cards.length === 0 && !list.querySelector("[data-leaving]");
    drawClock();
  }

  function stampOn(li: HTMLElement, moment: CardMoment): HTMLElement {
    li.querySelector(":scope > .strip-bc-stamp")?.remove();
    // A new node each time, so its fade (no-preference only) starts over.
    const stamp = el("span", "strip-bc-stamp", MOMENT_WORD[moment] ?? moment);
    stamp.setAttribute("aria-hidden", "true");
    stamp.dataset.moment = moment;
    li.append(stamp);
    li.dataset.moment = moment;
    return stamp;
  }

  function moment(cardId: string, what: CardMoment): void {
    const live = entries.get(cardId);
    if (live) {
      if (live.timer) clearTimeout(live.timer);
      const stamp = stampOn(live.li, what);
      live.stamp = stamp;
      live.timer = setTimeout(() => {
        stamp.remove();
        if (live.stamp === stamp) {
          live.stamp = null;
          delete live.li.dataset.moment;
        }
        live.timer = null;
      }, MOMENT_MS);
      return;
    }
    const gone = departed.get(cardId);
    if (!gone) return;
    departed.delete(cardId);
    // The server has taken it off the strip: a copy is drawn leaving, never
    // as a card that's still there.
    const leaver = gone.li;
    delete leaver.dataset.cardId;
    leaver.dataset.leftCard = cardId;
    leaver.dataset.leaving = what;
    leaver.setAttribute("aria-hidden", "true");
    stampOn(leaver, what);
    list.insertBefore(leaver, list.children[gone.index] ?? null);
    list.hidden = false;
    setTimeout(() => {
      leaver.remove();
      list.hidden = entries.size === 0 && !list.querySelector("[data-leaving]");
    }, MOMENT_MS);
  }

  function departedOf(intent: Intent): string | null {
    let best: [string, Departed] | null = null;
    for (const entry of departed) if (entry[1].card.intent === intent && (!best || entry[1].at >= best[1].at)) best = entry;
    return best ? best[0] : null;
  }

  function alignment(countdown: number, wipe: boolean): void {
    alignClock = countdown;
    alignWipe = wipe;
    for (const entry of entries.values()) {
      if (entry.card.intent !== "alignment") continue;
      entry.key = "";
      put(entry.li, "clock", String(countdown));
    }
    drawClock();
    // The clock's moment: it just moved (a frame, held; the pulse is no-preference only).
    if (clockStamp) clearTimeout(clockStamp);
    put(clock, "moment", wipe ? "wipe" : "tick");
    clockStamp = setTimeout(() => {
      delete clock.dataset.moment;
      clockStamp = null;
    }, MOMENT_MS);
  }

  return { list, clock, render, moment, departedOf, alignment };
}
