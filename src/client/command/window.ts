// The command window: the genre's bordered box with a cursor, drawn new. It is
// operable by arrow keys and Enter alone (spec/command.test.ts), and by mouse
// and touch through the same two steps: pick a command, then confirm a target.
//
// It decides nothing about turns (CLAUDE.md rules 1 and 2). It is live only
// while main.ts says the server put you on the plate (setEnabled), it hands a
// choice over once (onChoose) and keeps no copy of it, and going dark cancels
// any aim in progress. Nothing is pending while the window is off, so nothing
// can fire when it comes back on. The rank word on each option is a label from
// the display catalogue, never a predicted counter.
//
// Focus model: roving tabindex. While live, the option under the cursor is the
// one tab stop and focus follows the cursor; while dark, the list itself is the
// stop, so a keyboard user can still find the window and its state. A click on
// an option keeps focus there; going dark hands focus back to the list.
//
// Phase two (area b): what each option costs and whether the server would take
// it, and your seat's meters, all as the server sent them (seat.ts). On your
// turn the wait badge is the server's preview (the counter, the gold Resonance
// mark); an action the preview says it would refuse stays focusable so its
// reason can be read, and is never sent. Off-turn the one thing that can be
// live is a Reaction, only while setReactionReady names a card, aimed only at
// that card; handing it over darkens it until the server's next word. Card
// actions (Anchor, Delay, Stillpoint) aim at the strip's boss cards, never at
// an ally. Hover or focus on an option asks for the strip's ghost (onPreview).
import { ACTIONS, BOSS_ID, type ActionId, type ActionInfo, type BattleState } from "../../shared/protocol.ts";
import type { SeatInfo } from "../battle/api.ts";
import { RANK_PIPS, costOf, mountMeters } from "./seat.ts";

export interface CommandWindow {
  setEnabled(on: boolean): void;
  /** Time left on your turn as a fraction 1 → 0, or null when it isn't your turn. */
  setCountdown(fraction: number | null): void;
  /**
   * Phase two (rule 2): the card the server names for your Reaction, or null
   * when none is ready. While it names one, the Reaction is the one thing live
   * off-turn, aimed only at that card.
   */
  setReactionReady(cardId: string | null): void;
  /** Phase two: your seat as the server has it: resource meters, Charge, Echo, and each action's previewed wait and refusal. */
  setSeat(info: SeatInfo): void;
  destroy(): void;
}

export interface CommandOptions {
  actions: readonly ActionId[];
  allies: () => { id: string; name: string }[];
  /** Phase two: the boss cards on the strip, for card-target actions (Anchor, Delay, Stillpoint, a Reaction). Never ally ids. */
  cards?: () => { id: string; name: string }[];
  /** Phase two's gate (P2): the allies who have fallen, for Restore. */
  fallen?: () => { id: string; name: string }[];
  onTarget: (targetId: string | null) => void;
  onChoose: (action: ActionId, targetId: string | null) => void;
  /** Phase two: a command hovered or focused (null when none): the strip ghosts your portrait where the server's preview puts it. */
  onPreview?: (action: ActionId | null) => void;
}

/**
 * How much of the plate's real window is left, 1 → 0: an Echo's beat or a
 * person's turn, as the server says (plateMs; review R8), and nothing at all
 * for a seated Echo (plateMs 0; re-review N8), never NaN. Null when nobody's
 * window is running.
 */
export function countdownFraction(state: Pick<BattleState, "turnDeadline" | "plateMs">, now: number): number | null {
  if (state.turnDeadline === null || state.plateMs === null || state.plateMs === undefined) return null;
  if (!(state.plateMs > 0)) return 0;
  return Math.max(0, Math.min(1, (state.turnDeadline - now) / state.plateMs));
}

interface Target {
  id: string;
  name: string;
}

/** A command being aimed: which option, at whom. Cleared on confirm, Escape, disable, or a click elsewhere. */
interface Aim {
  option: number;
  targets: Target[];
  at: number;
}

const BOSS_NAME = "The Orrery";

/**
 * Ally actions aimed at the fallen, not the standing: Restore brings back
 * someone who has fallen, chosen from CommandOptions.fallen (phase two's gate,
 * P2). The server still refuses one who isn't down (server/roles.ts resolve).
 */
const AT_THE_FALLEN: ReadonlySet<ActionId> = new Set(["restore"]);

/** The rank as a word: how long you'll wait after this, never how many ticks. */
function rankWord(rank: number): string {
  if (rank <= 2) return "short wait";
  if (rank >= 5) return "long wait";
  return "steady wait";
}

// --- the pointer: a brass clock hand on a jewelled pivot, pixel by pixel -----
// b is brass, l is the card-coloured light. Drawn at 3× with crisp edges.
const HAND = [
  "........b...",
  ".bb.....bb..",
  "bllb.....bb.",
  "bllbbbbbbbbb",
  "bllb.....bb.",
  ".bb.....bb..",
  "........b...",
];
// The step arrows in the target row: a solid head with one glint.
const HEAD = ["b...", "bb..", "bbb.", "blbb", "bbb.", "bb..", "b..."];
// Resonance (rule 14): a cut gem, the gold of the scene's refunded-rank numbers.
const GEM = ["..b..", ".bbb.", "bblbb", ".bbb.", "..b.."];
// The server would refuse it: a struck cross, drawn in harm's colour.
const CROSS = ["bb...bb", "bbb.bbb", ".bbbbb.", "..bbb..", ".bbbbb.", "bbb.bbb", "bb...bb"];

function runs(rows: readonly string[], ch: string): string {
  let d = "";
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; ) {
      if (row[x] !== ch) {
        x++;
        continue;
      }
      let end = x;
      while (row[end] === ch) end++;
      d += `M${x} ${y}h${end - x}v1h${x - end}z`;
      x = end;
    }
  });
  return d;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const ART = {
  hand: { rows: HAND, body: runs(HAND, "b"), light: runs(HAND, "l") },
  head: { rows: HEAD, body: runs(HEAD, "b"), light: runs(HEAD, "l") },
  gem: { rows: GEM, body: runs(GEM, "b"), light: runs(GEM, "l") },
  cross: { rows: CROSS, body: runs(CROSS, "b"), light: runs(CROSS, "l") },
};

function pixelArt(kind: keyof typeof ART, className: string): SVGSVGElement {
  const art = ART[kind];
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("class", className);
  svg.setAttribute("viewBox", `0 0 ${art.rows[0].length} ${art.rows.length}`);
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("shape-rendering", "crispEdges");
  for (const part of ["body", "light"] as const) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("class", `pixel-${part}`);
    path.setAttribute("d", art[part]);
    svg.append(path);
  }
  return svg;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function key(className: string, text: string): HTMLButtonElement {
  const button = el("button", `command-key ${className}`, text);
  button.type = "button";
  return button;
}

/** The rank as a row of pips (rule 13: 1 Quick … 5 Ultimate), beside the word: a picture of the label, not a count of ticks. */
function gauge(rank: number): HTMLSpanElement {
  const row = el("span", "command-gauge");
  row.setAttribute("aria-hidden", "true");
  for (let i = 0; i < RANK_PIPS; i++) {
    const pip = el("span", "command-gauge-pip");
    pip.toggleAttribute("data-on", i < rank);
    row.append(pip);
  }
  return row;
}

/** What an option shows, so a state every tick writes only what changed. */
interface OptionParts {
  word: HTMLSpanElement;
  note: HTMLSpanElement;
  noteText: HTMLSpanElement;
  blurb: HTMLSpanElement;
  drawn: string;
}

let mounts = 0;

export function mountCommandWindow(root: HTMLElement, opts: CommandOptions): CommandWindow {
  const uid = `command-${++mounts}`;
  const infos: ActionInfo[] = opts.actions.map(
    (id) => ACTIONS[id] ?? { id, label: id, rank: 3, target: "boss", blurb: "" },
  );

  let enabled = false;
  let cursor = 0;
  let aim: Aim | null = null;
  // Phase two: the server's word on your Reaction and your seat, as last told.
  const hasReaction = infos.some((info) => info.reaction);
  /** The card the server names for your Reaction (rule 2), or null: not ready, or already handed over. */
  let reaction: string | null = null;
  /** The card last spoken, so a Reaction coming ready is said once. */
  let announced: string | null = null;
  let seat: SeatInfo = { token: null, preview: null };
  // The option under the pointer, the one with focus, and the action last handed to onPreview.
  let hovered: number | null = null;
  let focused: number | null = null;
  let previewing: ActionId | null = null;

  // --- the turn clock: a bar along the top edge, not a sentence ------------
  const clock = el("div", "command-clock");
  clock.setAttribute("role", "progressbar");
  clock.setAttribute("aria-label", "Time left on your turn");
  clock.setAttribute("aria-valuemin", "0");
  clock.setAttribute("aria-valuemax", "100");
  clock.hidden = true;
  const fill = el("div", "command-clock-fill");
  clock.append(fill);

  const title = el("h2", "window-title command-title", "Command");
  title.id = `${uid}-title`;

  // --- the head: the title, then your meters and the Echo mark (seat.ts) ----
  const meters = mountMeters(uid);
  const head = el("div", "command-head");
  head.append(title, meters.el);

  // --- the list ------------------------------------------------------------
  const menu = el("div", "command-menu");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-labelledby", title.id);
  menu.tabIndex = 0;
  menu.dataset.actions = "";

  const parts: OptionParts[] = [];
  const options = infos.map((info, i) => {
    const option = el("button", "command-option");
    option.type = "button";
    option.id = `${uid}-${info.id}`;
    option.tabIndex = -1;
    option.setAttribute("role", "menuitem");
    option.dataset.action = info.id;
    option.dataset.target = info.target;
    if (info.reaction) option.dataset.reaction = "";
    const rank = rankWord(info.rank);
    option.setAttribute("aria-label", `${info.label}, ${rank}`);
    const blurb = el("span", "command-blurb", info.blurb);
    blurb.id = `${option.id}-blurb`;
    option.setAttribute("aria-describedby", blurb.id);
    // The wait badge: the rank's pips and word, or the server's wait and its Resonance mark.
    const badge = el("span", "command-rank");
    const word = el("span", "command-wait", rank);
    if (!info.reaction) badge.append(gauge(info.rank));
    const resWord = el("span", "command-res-word", "Resonance");
    badge.append(word, pixelArt("gem", "command-res"), resWord);
    // In the blurb's place when it matters: why the server would refuse, or the card a Reaction answers.
    const note = el("span", "command-note");
    note.id = `${option.id}-note`;
    note.hidden = true;
    const noteText = el("span", "command-note-text");
    note.append(pixelArt("cross", "command-note-art"), noteText);
    parts.push({ word, note, noteText, blurb, drawn: "" });
    option.append(pixelArt("hand", "command-pointer"), el("span", "command-label", info.label), badge, blurb, note);
    option.addEventListener("click", () => {
      focusMenu();
      pick(i);
    });
    // The ghost on the strip follows whatever option is under the pointer, or else focused.
    option.addEventListener("pointerenter", () => {
      hovered = i;
      syncPreview();
    });
    option.addEventListener("pointerleave", () => {
      if (hovered === i) hovered = null;
      syncPreview();
    });
    option.addEventListener("focus", () => {
      focused = i;
      syncPreview();
    });
    option.addEventListener("blur", () => {
      if (focused === i) focused = null;
      syncPreview();
    });
    return option;
  });
  menu.append(...options);

  // --- the foot: a hint line, or the target step ----------------------------
  const hint = el("p", "command-hint");

  const aimBox = el("div", "command-aim");
  aimBox.hidden = true;
  const prev = key("command-step", "");
  prev.dataset.step = "-1";
  prev.setAttribute("aria-label", "Previous target");
  prev.append(pixelArt("head", "command-step-art"));
  const next = key("command-step", "");
  next.dataset.step = "1";
  next.setAttribute("aria-label", "Next target");
  next.append(pixelArt("head", "command-step-art"));
  const aimName = el("span", "command-aim-name");
  aimName.dataset.aimName = "";

  const confirmKey = key("command-confirm", "Confirm");
  confirmKey.dataset.confirm = "";
  const backKey = key("command-back", "Back");
  backKey.dataset.cancel = "";
  aimBox.append(
    el("span", "command-aim-label", "Target"),
    prev,
    pixelArt("hand", "command-aim-pointer"),
    aimName,
    next,
    confirmKey,
    backKey,
  );

  const foot = el("div", "command-foot");
  foot.dataset.mode = "menu";
  foot.append(hint, aimBox);

  // Focus stays on the list while aiming, so the target is spoken from here.
  const voice = el("p", "visually-hidden");
  voice.setAttribute("aria-live", "polite");

  root.replaceChildren(clock, head, menu, foot, voice);

  // --- what is live, as the server last said ----------------------------------
  /** Live: the turn's actions while it's your turn; a Reaction while the server names a card (rule 2). */
  function live(i: number): boolean {
    const info = infos[i];
    if (!info) return false;
    return info.reaction ? reaction !== null : enabled;
  }

  function anyLive(): boolean {
    return enabled || (hasReaction && reaction !== null);
  }

  /** The server's reason it would refuse option i now (its preview), or null. Read on your turn only. */
  function refusalAt(i: number): string | null {
    const info = infos[i];
    if (!enabled || !info || info.reaction) return null;
    return seat.preview?.[info.id]?.refusal ?? null;
  }

  /** A boss card as main.ts names it (what, at whom, how soon), or a plain word when the strip has moved on. */
  function cardName(id: string): string {
    return opts.cards?.().find((c) => c.id === id)?.name ?? "the announced card";
  }

  // --- state → screen -------------------------------------------------------
  /** One option's badge, note and words, from the server's latest word; writes only on a change. */
  function paintOption(i: number): void {
    const info = infos[i];
    const option = options[i];
    const part = parts[i];
    const isLive = live(i);
    const preview = enabled && !info.reaction ? (seat.preview?.[info.id] ?? null) : null;
    const refusal = isLive ? refusalAt(i) : null;
    const answers = info.reaction && reaction !== null ? cardName(reaction) : null;
    const prompt = seat.prompts?.[info.id] ?? null;
    const cost = costOf(info, preview, rankWord(info.rank));
    const drawn = JSON.stringify([isLive, refusal, cost.text, cost.aria, cost.resonance, answers, prompt]);
    if (drawn === part.drawn) return;
    part.drawn = drawn;

    option.disabled = !isLive;
    // Refused: still focusable, so the reason can be read; never sent.
    if (refusal !== null) option.setAttribute("aria-disabled", "true");
    else option.removeAttribute("aria-disabled");
    option.toggleAttribute("data-refused", refusal !== null);
    option.toggleAttribute("data-resonance", cost.resonance && refusal === null);
    option.toggleAttribute("data-preview", preview !== null);
    option.toggleAttribute("data-prompt", prompt !== null && refusal === null);
    part.word.textContent = refusal !== null ? "not now" : cost.text;

    const note = refusal ?? (answers !== null ? `Ready against ${answers}` : prompt);
    part.note.hidden = note === null;
    part.blurb.hidden = note !== null;
    part.note.dataset.note = refusal !== null ? "refused" : answers !== null ? "reaction" : "prompt";
    part.noteText.textContent = note ?? "";
    option.setAttribute("aria-describedby", note === null ? part.blurb.id : `${part.note.id} ${part.blurb.id}`);
    const spoken =
      refusal !== null
        ? `${info.label}, unavailable`
        : answers !== null
          ? `${info.label}, ${cost.aria}, ready`
          : prompt !== null
            ? `${info.label}, ${cost.aria}, asked for`
            : `${info.label}, ${cost.aria}`;
    option.setAttribute("aria-label", spoken);
  }

  /** The hint line: whose move it is, the Reaction the server offers, or the Echo playing your seat. */
  function hintText(): string {
    const echo = seat.token?.echo === true;
    if (enabled) return echo ? "Your Echo is on the plate: act now to take your seat back." : "Your turn. Choose a command.";
    if (hasReaction && reaction !== null) {
      const label = infos.find((info) => info.reaction)?.label ?? "Reaction";
      return `A Reaction is ready: ${label} against ${cardName(reaction)}.`;
    }
    return echo ? "An Echo is playing your seat. Act on your turn to take it back." : "Wait for your turn.";
  }

  /** The ghost: the option under the pointer, else the focused one, if it's live; null when none. */
  function syncPreview(force = false): void {
    const at = [hovered, focused].find((i) => i !== null && options[i] && !options[i].disabled) ?? null;
    const next = at === null ? null : infos[at].id;
    if (next === previewing && !force) return;
    previewing = next;
    opts.onPreview?.(next);
  }

  /** Step the cursor to the next live option (only live ones take focus), or through all while nothing is. */
  function stepCursor(delta: number): void {
    const n = options.length;
    if (!anyLive()) return moveCursor(cursor + delta);
    for (let k = 1; k <= n; k++) {
      const j = (((cursor + delta * k) % n) + n) % n;
      if (live(j)) return moveCursor(j);
    }
  }

  function edgeCursor(last: boolean): void {
    const order = options.map((_, i) => i);
    if (last) order.reverse();
    const to = anyLive() ? order.find((i) => live(i)) : order[0];
    if (to !== undefined) moveCursor(to);
  }

  function moveCursor(to: number): void {
    if (options.length === 0) return;
    const i = ((to % options.length) + options.length) % options.length;
    const hadFocus = options.includes(document.activeElement as HTMLButtonElement);
    options[cursor]?.removeAttribute("data-cursor");
    options[cursor].tabIndex = -1;
    cursor = i;
    options[cursor].setAttribute("data-cursor", "");
    options[cursor].tabIndex = 0;
    if (hadFocus) options[cursor].focus({ preventScroll: true });
  }

  function showAim(first: boolean): void {
    if (!aim) return;
    const target = aim.targets[aim.at];
    aimName.textContent = target.name;
    const several = choosable(aim.option) && aim.targets.length > 1;
    prev.hidden = !several;
    next.hidden = !several;
    options[aim.option].setAttribute("data-aiming", "");
    foot.dataset.mode = "aim";
    hint.hidden = true;
    aimBox.hidden = false;
    voice.textContent = first
      ? `${infos[aim.option].label}: target ${target.name}. Enter to confirm, Escape to go back.`
      : `Target ${target.name}.`;
  }

  function clearAim(): void {
    if (!aim) return;
    options[aim.option]?.removeAttribute("data-aiming");
    aim = null;
    foot.dataset.mode = "menu";
    aimBox.hidden = true;
    hint.hidden = false;
  }

  function paintEnabled(): void {
    const on = anyLive();
    root.dataset.enabled = String(enabled);
    root.toggleAttribute("data-reaction", hasReaction && reaction !== null);
    menu.setAttribute("aria-disabled", String(!on));
    options.forEach((_, i) => paintOption(i));
    // Live: the cursor's option is the one tab stop. Dark: the list itself is, so the window stays findable.
    menu.tabIndex = on ? -1 : 0;
    options.forEach((option, i) => (option.tabIndex = on && i === cursor ? 0 : -1));
    for (const button of [prev, next, confirmKey, backKey]) button.disabled = !on;
    const words = hintText();
    if (hint.textContent !== words) hint.textContent = words;
  }

  /**
   * After any word from the server: drop an aim whose option went dark (or
   * whose Reaction now names another card), put the cursor on something live,
   * repaint, and keep focus in the window if it was there and its stop went dark.
   */
  function refresh(): void {
    const active = document.activeElement;
    const inside = !!active && root.contains(active);
    if (aim && (!live(aim.option) || (infos[aim.option].reaction && aim.targets[0]?.id !== reaction))) {
      clearAim();
      voice.textContent = "";
      opts.onTarget(null);
    }
    if (anyLive() && !live(cursor)) edgeCursor(false);
    paintEnabled();
    if (inside) {
      const now = document.activeElement;
      const lost = !now || !root.contains(now) || (now instanceof HTMLButtonElement && now.disabled);
      if (lost || (now === menu && anyLive())) focusMenu();
    }
    syncPreview();
  }

  /** Focus to the list, wherever in the window it was (a clicked option, the Confirm key). */
  function focusMenu(): void {
    const to = anyLive() ? options[cursor] : menu;
    if (document.activeElement !== to) to.focus({ preventScroll: true });
  }

  /** Only if focus is already inside the window: never pull it in from elsewhere. */
  function keepFocus(): void {
    const active = document.activeElement;
    if (active && root.contains(active)) focusMenu();
  }

  // --- the two steps --------------------------------------------------------
  function choose(action: ActionId, targetId: string | null): void {
    // A Reaction handed over goes dark at once, until the server's next word
    // (setReactionReady), as main.ts darkens the turn's actions (rule 2).
    if (ACTIONS[action]?.reaction && reaction !== null) {
      reaction = null;
      refresh();
    }
    keepFocus();
    // Handed over once and forgotten: the window keeps no copy to retry.
    opts.onChoose(action, targetId);
  }

  /** An option whose target the player steps through: allies, or the strip's cards. Not a Reaction (one card), not a server's pick. */
  function choosable(i: number): boolean {
    const info = infos[i];
    return !info.reaction && (info.target === "ally" || info.target === "card");
  }

  /** Who option i can be aimed at, as the window is told now. */
  function targetsFor(i: number): Target[] {
    const info = infos[i];
    // The Reaction answers the one card the server names, and no other (rule 2).
    if (info.reaction) return reaction === null ? [] : [{ id: reaction, name: cardName(reaction) }];
    if (info.target === "boss") return [{ id: BOSS_ID, name: BOSS_NAME }];
    // Anchor, Delay, Stillpoint: the strip's boss cards, never an ally id (review F7).
    if (info.target === "card") return opts.cards?.() ?? [];
    return fresh(i);
  }

  function fresh(i: number): Target[] {
    const info = infos[i];
    if (info.target === "card") return opts.cards?.() ?? [];
    return AT_THE_FALLEN.has(info.id) ? (opts.fallen?.() ?? []) : opts.allies();
  }

  function cancel(): void {
    if (!aim) return;
    keepFocus();
    clearAim();
    voice.textContent = "";
    opts.onTarget(null);
  }

  /** Select option i: a self command acts at once; anything aimed starts the target step. A dark or refused option sends nothing. */
  function pick(i: number): void {
    if (!live(i)) return;
    if (aim) {
      if (aim.option === i) return confirm(); // a second click on the same option confirms
      cancel();
    }
    moveCursor(i);
    const info = infos[i];
    const refusal = refusalAt(i);
    if (refusal !== null) {
      voice.textContent = `${info.label} isn't available now. ${refusal}`;
      return;
    }
    if (info.target === "self") return choose(info.id, null);
    const targets = targetsFor(i);
    if (targets.length === 0) {
      voice.textContent =
        info.target === "card"
          ? "There's no boss card on the strip to aim that at."
          : AT_THE_FALLEN.has(info.id)
            ? "Nobody has fallen, so there's no one to bring back."
            : "There's no one to aim that at.";
      return;
    }
    aim = { option: i, targets, at: 0 };
    showAim(true);
    opts.onTarget(targets[0].id);
  }

  function confirm(): void {
    if (!aim || !live(aim.option) || refusalAt(aim.option) !== null) return;
    const action = infos[aim.option].id;
    const target = aim.targets[aim.at];
    keepFocus();
    clearAim();
    voice.textContent = "";
    opts.onTarget(null);
    choose(action, target.id);
  }

  /** Step the target among the allies standing now, or the cards on the strip now (re-read, so nothing gone is offered). */
  function cycle(delta: number): void {
    if (!aim || !choosable(aim.option)) return;
    const list = fresh(aim.option);
    if (list.length === 0) return cancel();
    const was = list.findIndex((t) => t.id === aim?.targets[aim.at]?.id);
    const at = was === -1 ? 0 : (was + delta + list.length) % list.length;
    if (list[at].id === aim.targets[aim.at]?.id && list.length === aim.targets.length) return;
    aim.targets = list;
    aim.at = at;
    showAim(false);
    opts.onTarget(list[at].id);
  }

  // --- input ---------------------------------------------------------------
  function onKey(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const onMenu = e.target === menu || options.includes(e.target as HTMLButtonElement);
    switch (e.key) {
      case "ArrowDown":
      case "ArrowUp":
      case "ArrowLeft":
      case "ArrowRight": {
        const forward = e.key === "ArrowDown" || e.key === "ArrowRight";
        if (aim) cycle(forward ? 1 : -1);
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") stepCursor(forward ? 1 : -1);
        else return;
        e.preventDefault();
        return;
      }
      case "Home":
      case "End":
        if (aim || !onMenu) return;
        edgeCursor(e.key === "End");
        e.preventDefault();
        return;
      case "Enter":
      case " ":
      case "Spacebar":
        // Only on the list: on the Confirm or Back key, the button's own click does it.
        if (!onMenu) return;
        e.preventDefault();
        if (e.repeat || !anyLive()) return; // a held key doesn't aim and then fire
        if (aim) confirm();
        else pick(cursor);
        return;
      case "Escape":
      case "Esc":
        if (!aim) return;
        e.preventDefault();
        cancel();
        return;
    }
  }

  /** Space clicks on key-up; the key-down already did the work. */
  function onKeyUp(e: KeyboardEvent): void {
    if ((e.key === " " || e.key === "Spacebar") && options.includes(e.target as HTMLButtonElement)) e.preventDefault();
  }

  /** A press anywhere outside the window backs out of the target step. */
  function onOutside(e: PointerEvent): void {
    if (aim && e.target instanceof Node && !root.contains(e.target)) cancel();
  }

  /** So does tabbing away from it. */
  function onFocusOut(e: FocusEvent): void {
    if (aim && e.relatedTarget instanceof Node && !root.contains(e.relatedTarget)) cancel();
  }

  root.addEventListener("keydown", onKey);
  root.addEventListener("keyup", onKeyUp);
  root.addEventListener("focusout", onFocusOut);
  document.addEventListener("pointerdown", onOutside, true);
  prev.addEventListener("click", () => cycle(-1));
  next.addEventListener("click", () => cycle(1));
  confirmKey.addEventListener("click", () => confirm());
  backKey.addEventListener("click", () => cancel());

  moveCursor(0);
  paintEnabled();

  // --- the clock's last drawn values, so a 5 Hz update writes only what changed
  let drawn: number | null = null;
  let low = false;
  let spoken = -1;

  return {
    setEnabled(on) {
      if (on === enabled) return;
      enabled = on;
      // Going dark drops any aim at a turn action; a Reaction the server still names stays live.
      refresh();
    },

    setCountdown(fraction) {
      if (fraction === null || !Number.isFinite(fraction)) {
        if (drawn !== null) {
          clock.hidden = true;
          drawn = null;
        }
        return;
      }
      const left = Math.round(Math.max(0, Math.min(1, fraction)) * 1000) / 1000;
      if (drawn === null) clock.hidden = false;
      if (left !== drawn) {
        fill.style.transform = `scaleX(${left})`;
        drawn = left;
      }
      if (left < 0.25 !== low) {
        low = left < 0.25;
        clock.toggleAttribute("data-low", low);
      }
      const step = Math.round(left * 20) * 5;
      if (step !== spoken) {
        spoken = step;
        clock.setAttribute("aria-valuenow", String(step));
      }
    },

    setReactionReady(cardId) {
      // A role with no Reaction has nothing to light, whatever is named.
      const next = hasReaction ? cardId : null;
      if (next === reaction) return;
      reaction = next;
      if (next !== null && next !== announced && !enabled) {
        voice.textContent = `${hintText()} It's the one thing you can do now.`;
      }
      announced = next;
      refresh();
    },

    setSeat(info) {
      const moved = info.preview !== seat.preview;
      seat = info;
      meters.show(info.token);
      refresh();
      // The server's numbers changed under a hovered or focused option: the ghost follows them.
      if (moved && previewing !== null) syncPreview(true);
    },

    destroy() {
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("keyup", onKeyUp);
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onOutside, true);
      if (aim) {
        clearAim();
        opts.onTarget(null);
      }
      if (previewing !== null) opts.onPreview?.(null);
      root.replaceChildren();
      delete root.dataset.enabled;
      delete root.dataset.reaction;
    },
  };
}
