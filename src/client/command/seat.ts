// Your seat, as the command window shows it (phase two): the role's resource
// and Charge as meters, the Echo mark, and each option's wait cost. Display
// only. The counter, the slot, the Resonance and the refusal are the server's
// preview (state.preview, rule 1: drawn, never computed); the rank is the
// display catalogue's label (rule 13), never multiplied into a counter; the
// caps below are the design's, for drawing pips, and decide nothing.
import type { ActionInfo, ActionPreview, Resource, RoleId, Token } from "../../shared/protocol.ts";
import { ROLES } from "../../shared/protocol.ts";

/** Each resource by name, as the design record names it. */
export const RESOURCE_LABEL: Readonly<Record<Resource, string>> = {
  charge: "Charge",
  resolve: "Resolve",
  grace: "Grace",
  momentum: "Momentum",
  insight: "Insight",
  flux: "Flux",
};

/**
 * How many pips each meter draws: Charge's 3 is rule 17's; the roles' 5 are
 * the design's caps (Resolve, Grace, Insight, Momentum 0-5; Stillpoint needs
 * full Flux, 5). The server holds the real numbers; a count above the cap is
 * still printed as the server sent it.
 */
export const RESOURCE_MAX: Readonly<Record<Resource, number>> = {
  charge: 3,
  resolve: 5,
  grace: 5,
  momentum: 5,
  insight: 5,
  flux: 5,
};

/** The highest rank (rule 13: 1 Quick … 5 Ultimate), for the wait gauge's pips. */
export const RANK_PIPS = 5;

/** What an option's wait badge says, and what it says to a screen reader. */
export interface Cost {
  /** The badge's words: the rank word off-turn, the server's wait on your turn. */
  text: string;
  /** The same, spoken. */
  aria: string;
  /** The server previews a Resonance (rule 14): the gold mark. */
  resonance: boolean;
}

const ORDINALS = ["first", "second", "third", "fourth", "fifth", "sixth", "seventh", "eighth", "ninth", "tenth"];

function ordinal(n: number): string {
  return ORDINALS[n - 1] ?? `number ${n}`;
}

/**
 * An option's wait cost. Off-turn (no preview) the rank word; on your turn
 * the counter the server says this action would leave you at, and where in
 * line that lands you; a Reaction takes no turn and has no wait.
 */
export function costOf(info: ActionInfo, preview: ActionPreview | null | undefined, rankWord: string): Cost {
  if (info.reaction) return { text: "Reaction", aria: "a Reaction, out of turn, no wait", resonance: false };
  if (!preview) return { text: rankWord, aria: `${rankWord}, rank ${info.rank} of ${RANK_PIPS}`, resonance: false };
  const lands = `wait ${preview.counter}, lands ${ordinal(preview.slot + 1)} in line`;
  return {
    text: `wait ${preview.counter}`,
    aria: preview.resonance ? `${lands}, Resonance: a rank refunded` : lands,
    resonance: preview.resonance,
  };
}

// --- the meters ------------------------------------------------------------------

export interface Meters {
  el: HTMLElement;
  /** Your token as the server sent it, or null when you have none. */
  show(token: Token | null): void;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

interface Meter {
  root: HTMLElement;
  bar: HTMLElement;
  pips: HTMLElement[];
  count: HTMLElement;
  drawn: number | null;
}

/** One meter: its name, a row of pips (hollow empty, solid full), and the count in figures. */
function meter(uid: string, resource: Resource): Meter {
  const max = RESOURCE_MAX[resource];
  const root = el("div", "command-meter");
  root.dataset.meter = resource;
  const label = el("span", "command-meter-label", RESOURCE_LABEL[resource]);
  label.id = `${uid}-meter-${resource}`;
  const bar = el("span", "command-pips");
  bar.setAttribute("role", "meter");
  bar.setAttribute("aria-labelledby", label.id);
  bar.setAttribute("aria-valuemin", "0");
  bar.setAttribute("aria-valuemax", String(max));
  const pips = Array.from({ length: max }, () => el("span", "command-pip"));
  bar.append(...pips);
  const count = el("span", "command-meter-count");
  count.setAttribute("aria-hidden", "true");
  root.append(label, bar, count);
  return { root, bar, pips, count, drawn: null };
}

function paintMeter(m: Meter, resource: Resource, value: number): void {
  if (m.drawn === value) return;
  m.drawn = value;
  const max = RESOURCE_MAX[resource];
  m.pips.forEach((pip, i) => pip.toggleAttribute("data-on", i < value));
  m.bar.setAttribute("aria-valuenow", String(Math.min(value, max)));
  m.bar.setAttribute("aria-valuetext", `${value} of ${max}`);
  m.count.textContent = `${value}/${max}`;
}

/**
 * The meters row in the window's head: the role's own resource by name, then
 * Charge, and the Echo mark while the server plays your seat (rule 8). Built
 * on the first token, rebuilt only if the token's role ever differs.
 */
export function mountMeters(uid: string): Meters {
  const root = el("div", "command-meters");
  root.hidden = true;
  const echo = el("p", "command-echo", "Echo");
  echo.dataset.echo = "";
  echo.hidden = true;
  const says = el("span", "visually-hidden", " is playing your seat until you act");
  echo.append(says);

  let role: RoleId | null = null;
  let own: Meter | null = null;
  let charge: Meter | null = null;

  return {
    el: root,
    show(token) {
      if (!token || token.kind !== "character" || token.role === "orrery") {
        root.hidden = true;
        return;
      }
      if (role !== token.role || !own || !charge) {
        role = token.role;
        own = meter(uid, ROLES[role].resource);
        charge = meter(uid, "charge");
        root.replaceChildren(own.root, charge.root, echo);
      }
      paintMeter(own, ROLES[role].resource, token.resource);
      paintMeter(charge, "charge", token.charge);
      echo.hidden = !token.echo;
      root.hidden = false;
    },
  };
}
