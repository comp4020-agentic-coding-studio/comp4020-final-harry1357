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
import { ACTIONS, BOSS_ID, type ActionId, type ActionInfo, type BattleState } from "../../shared/protocol.ts";
import type { SeatInfo } from "../battle/api.ts";

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

let mounts = 0;

export function mountCommandWindow(root: HTMLElement, opts: CommandOptions): CommandWindow {
  const uid = `command-${++mounts}`;
  const infos: ActionInfo[] = opts.actions.map(
    (id) => ACTIONS[id] ?? { id, label: id, rank: 3, target: "boss", blurb: "" },
  );

  let enabled = false;
  let cursor = 0;
  let aim: Aim | null = null;

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

  // --- the list ------------------------------------------------------------
  const menu = el("div", "command-menu");
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-labelledby", title.id);
  menu.tabIndex = 0;
  menu.dataset.actions = "";

  const options = infos.map((info, i) => {
    const option = el("button", "command-option");
    option.type = "button";
    option.id = `${uid}-${info.id}`;
    option.tabIndex = -1;
    option.setAttribute("role", "menuitem");
    option.dataset.action = info.id;
    option.dataset.target = info.target;
    const rank = rankWord(info.rank);
    option.setAttribute("aria-label", `${info.label}, ${rank}`);
    const blurb = el("span", "command-blurb", info.blurb);
    blurb.id = `${option.id}-blurb`;
    option.setAttribute("aria-describedby", blurb.id);
    option.append(
      pixelArt("hand", "command-pointer"),
      el("span", "command-label", info.label),
      el("span", "command-rank", rank),
      blurb,
    );
    option.addEventListener("click", () => {
      focusMenu();
      pick(i);
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

  root.replaceChildren(clock, title, menu, foot, voice);

  // --- state → screen -------------------------------------------------------
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
    const several = infos[aim.option].target === "ally" && aim.targets.length > 1;
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
    root.dataset.enabled = String(enabled);
    menu.setAttribute("aria-disabled", String(!enabled));
    for (const option of options) option.disabled = !enabled;
    // Live: the cursor's option is the one tab stop. Dark: the list itself is, so the window stays findable.
    menu.tabIndex = enabled ? -1 : 0;
    options[cursor].tabIndex = enabled ? 0 : -1;
    for (const button of [prev, next, confirmKey, backKey]) button.disabled = !enabled;
    hint.textContent = enabled ? "Your turn. Choose a command." : "Wait for your turn.";
  }

  /** Focus to the list, wherever in the window it was (a clicked option, the Confirm key). */
  function focusMenu(): void {
    const to = enabled ? options[cursor] : menu;
    if (document.activeElement !== to) to.focus({ preventScroll: true });
  }

  /** Only if focus is already inside the window: never pull it in from elsewhere. */
  function keepFocus(): void {
    const active = document.activeElement;
    if (active && root.contains(active)) focusMenu();
  }

  // --- the two steps --------------------------------------------------------
  function choose(action: ActionId, targetId: string | null): void {
    keepFocus();
    // Handed over once and forgotten: the window keeps no copy to retry.
    opts.onChoose(action, targetId);
  }

  function cancel(): void {
    if (!aim) return;
    keepFocus();
    clearAim();
    voice.textContent = "";
    opts.onTarget(null);
  }

  /** Select option i: a self command acts at once; anything aimed starts the target step. */
  function pick(i: number): void {
    if (!enabled) return;
    if (aim) {
      if (aim.option === i) return confirm(); // a second click on the same option confirms
      cancel();
    }
    moveCursor(i);
    const info = infos[i];
    if (info.target === "self") return choose(info.id, null);
    const targets: Target[] = info.target === "boss" ? [{ id: BOSS_ID, name: BOSS_NAME }] : opts.allies();
    if (targets.length === 0) {
      voice.textContent = "There's no one to aim that at.";
      return;
    }
    aim = { option: i, targets, at: 0 };
    showAim(true);
    opts.onTarget(targets[0].id);
  }

  function confirm(): void {
    if (!aim || !enabled) return;
    const action = infos[aim.option].id;
    const target = aim.targets[aim.at];
    keepFocus();
    clearAim();
    voice.textContent = "";
    opts.onTarget(null);
    choose(action, target.id);
  }

  /** Step the target among the allies standing now (the list is re-read, so someone who left isn't offered). */
  function cycle(delta: number): void {
    if (!aim || infos[aim.option].target !== "ally") return;
    const fresh = opts.allies();
    if (fresh.length === 0) return cancel();
    const was = fresh.findIndex((t) => t.id === aim?.targets[aim.at]?.id);
    const at = was === -1 ? 0 : (was + delta + fresh.length) % fresh.length;
    if (fresh[at].id === aim.targets[aim.at]?.id && fresh.length === aim.targets.length) return;
    aim.targets = fresh;
    aim.at = at;
    showAim(false);
    opts.onTarget(fresh[at].id);
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
        else if (e.key === "ArrowDown" || e.key === "ArrowUp") moveCursor(cursor + (forward ? 1 : -1));
        else return;
        e.preventDefault();
        return;
      }
      case "Home":
      case "End":
        if (aim || !onMenu) return;
        moveCursor(e.key === "Home" ? 0 : options.length - 1);
        e.preventDefault();
        return;
      case "Enter":
      case " ":
      case "Spacebar":
        // Only on the list: on the Confirm or Back key, the button's own click does it.
        if (!onMenu) return;
        e.preventDefault();
        if (e.repeat || !enabled) return; // a held key doesn't aim and then fire
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
      const inside = !!document.activeElement && root.contains(document.activeElement);
      if (!on) cancel();
      const hadFocus = document.activeElement === menu;
      enabled = on;
      paintEnabled();
      if (on ? hadFocus : inside) focusMenu();
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

    // Phase two (area b fills these in).
    setReactionReady(_cardId: string | null) {},
    setSeat(_info: SeatInfo) {},

    destroy() {
      root.removeEventListener("keydown", onKey);
      root.removeEventListener("keyup", onKeyUp);
      root.removeEventListener("focusout", onFocusOut);
      document.removeEventListener("pointerdown", onOutside, true);
      if (aim) {
        clearAim();
        opts.onTarget(null);
      }
      root.replaceChildren();
      delete root.dataset.enabled;
    },
  };
}
