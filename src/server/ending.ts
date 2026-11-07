// The fight tells you what happened (docs/adr/012; CLAUDE.md rule 34). The
// account of a fight, kept as it runs, and the ending composed from it when it
// ends: the card that ended it, its target, what it found there, and the
// answers the table had (ADR-011's teeth, each with the person who held it,
// never an Echo, rule 25); on a win, the blow, who Broke its ring, and the
// longest Chain. The words are composed here and nowhere else: the client
// prints Ending.line as sent.
//
// The account is memory, written as cards land and read once, at the end.
// Nothing decides a turn from it (rule 5), and it is never persisted beyond
// the end's log line (rule 6).

import { ACTIONS, ROLES, type ActionId, type BattleEvent, type Ending, type Intent, type RingId, type RoleId } from "../shared/protocol.ts";
import type { Battle, Fighter } from "./rules.ts";

/** A boss card as it landed: what it found on the seat it landed on. */
export interface Landed {
  cardId: string;
  intent: Intent;
  targetId: string | "party";
  /** ADR-011's conditions, as tags: gravity:N, unbraced, unwarded, no-bastion, outer-whole, enraged. */
  found: string[];
}

export interface Account {
  /** The card that downed each seat, by seat id: the last to land on it before it fell. */
  downedBy: Record<string, Landed>;
  /** Who Broke each ring, most recently. */
  brokenBy: Partial<Record<RingId, string>>;
  /** The longest Chain the table made. */
  chain: number;
  /** The blow that took the Orrery's last HP. */
  lastBlow: { by: string; action: ActionId; ringId: RingId | null; broken: boolean } | null;
}

export const newAccount = (): Account => ({ downedBy: {}, brokenBy: {}, chain: 0, lastBlow: null });

/** The account, on the battle (rules.ts declares it), so it survives each step's clone. */
export function account(b: Battle): Account {
  b.account ??= newAccount();
  return b.account;
}

/** A card has landed: every seat it brought to 0 HP was downed by it. Called before downTheFallen. */
export function landed(b: Battle, card: Landed): void {
  const a = account(b);
  for (const f of b.standing) if (f.kind === "character" && f.hp <= 0) a.downedBy[f.id] = card;
}

/** What one step did that the ending reads: the Chain's length, each Break, and the blow on the Orrery. */
export function noted(b: Battle, events: readonly BattleEvent[]): void {
  const a = account(b);
  let reaction: ActionId | null = null;
  for (const e of events) {
    if (e.kind === "chain") a.chain = Math.max(a.chain, e.links);
    else if (e.kind === "break") a.brokenBy[e.ringId] = e.by;
    else if (e.kind === "reaction") reaction = e.action;
    else if (e.kind === "sting" && e.amount > 0) a.lastBlow = { by: e.actorId, action: reaction ?? "brace", ringId: null, broken: false };
    else if ((BLOWS as readonly string[]).includes(e.kind) && "ringId" in e && "amount" in e && e.amount > 0) {
      const ring = b.rings.find((r) => r.id === e.ringId);
      a.lastBlow = { by: e.actorId, action: e.kind as ActionId, ringId: e.ringId, broken: ring?.broken === true };
    }
  }
}

/** The events that take HP off the Orrery through a ring. */
const BLOWS = ["jab", "cleave", "finisher", "feint", "counterweight"] as const;

/** What a single-target card finds on its seat (ADR-011's first and fourth teeth). */
export function foundOn(f: Fighter, gravity: number | null): string[] {
  return [...(gravity !== null && gravity > 0 ? [`gravity:${gravity}`] : []), ...(f.braced ? [] : ["unbraced"]), ...(f.warded ? [] : ["unwarded"])];
}

// --- the answers -------------------------------------------------------------

/** ADR-011's answers to each tooth, in the order they're said: role, then the actions it answers with. */
const ANSWERS: Readonly<Partial<Record<Intent, readonly { role: RoleId | "any" | "self"; actions: readonly ActionId[] }[]>>> = {
  lunge: [
    { role: "warden", actions: ["anchor", "intercept"] },
    { role: "mender", actions: ["ward", "veil"] },
    { role: "self", actions: ["brace"] },
  ],
  eclipse: [
    { role: "warden", actions: ["anchor", "intercept"] },
    { role: "mender", actions: ["ward", "veil"] },
    { role: "self", actions: ["brace"] },
  ],
  perihelion: [
    { role: "warden", actions: ["bastion"] },
    { role: "breaker", actions: ["shatter", "fracture"] },
    { role: "any", actions: ["brace"] },
  ],
  revolution: [
    { role: "warden", actions: ["bastion"] },
    { role: "any", actions: ["brace"] },
  ],
};

/** Everyone who sat at the table this fight: standing, downed, or Echoes. */
const seated = (b: Battle): Fighter[] => [...b.standing, ...b.fallen].filter((f) => f.kind === "character");
const isPerson = (f: Fighter): boolean => f.seatedBy === null && !f.echo;

/** The answers the table had: only roles that sat at it, each by its person, or by role when only an Echo held it. */
function answersFor(b: Battle, card: Landed): Ending["answers"] {
  const seats = seated(b);
  const out: Ending["answers"] = [];
  for (const { role, actions } of ANSWERS[card.intent] ?? []) {
    if (role === "any") {
      for (const action of actions) out.push({ role: "any", action, by: null });
      continue;
    }
    if (role === "self") {
      const target = seats.find((f) => f.id === card.targetId);
      if (!target) continue;
      for (const action of actions) out.push({ role: target.role as RoleId, action, by: isPerson(target) ? target.id : null });
      continue;
    }
    const holders = seats.filter((f) => f.role === role);
    if (holders.length === 0) continue;
    const person = holders.find(isPerson);
    for (const action of actions) out.push({ role, action, by: person ? person.id : null });
  }
  return out;
}

// --- the words -----------------------------------------------------------------

const label = (intent: Intent): string => (intent === "alignment" ? "Alignment" : intent.charAt(0).toUpperCase() + intent.slice(1));
const nameOf = (b: Battle, id: string | null): string => (id ? (b.joined[id] ?? id) : "someone");
const article = (role: string): string => (/^[AEIOU]/.test(role) ? "an" : "a");
/** Phrases that hold their own "or" ("Anchor or Intercept"), so the last is set off by a comma even when there are two. */
const or = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")}, or ${xs.at(-1)}`);
const and = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}`);

/** "A Warden's Anchor or Intercept", "Ada's Brace", "every seat's Brace": one phrase per role. */
function sayAnswers(b: Battle, answers: Ending["answers"]): string {
  const groups: { who: string; actions: string[] }[] = [];
  for (const a of answers) {
    const who =
      a.role === "any" ? "every seat's" : a.by !== null ? `${nameOf(b, a.by)}'s` : `${article(ROLES[a.role as RoleId].label)} ${ROLES[a.role as RoleId].label}'s`;
    const g = groups.find((x) => x.who === who);
    if (g) g.actions.push(ACTIONS[a.action].label);
    else groups.push({ who, actions: [ACTIONS[a.action].label] });
  }
  const phrases = groups.map((g) => `${g.who} ${g.actions.join(" or ")}`);
  const said = or(phrases);
  // Only a sentence's own article is capitalised: a person's name is said as they wrote it.
  return /^an? /.test(said) ? said.charAt(0).toUpperCase() + said.slice(1) : said;
}

/** What the card found, in words: "at Gravity 2, unbraced", ", unwarded and unbraced". */
function sayFound(card: Landed): string {
  if (card.intent === "lunge") {
    const g = card.found.find((x) => x.startsWith("gravity:"));
    const bits = [g ? `at Gravity ${g.slice(8)}` : null, card.found.includes("unbraced") ? "unbraced" : null].filter((x): x is string => x !== null);
    return bits.length ? ` ${bits.join(", ")}` : "";
  }
  if (card.intent === "eclipse") {
    const bits = [card.found.includes("unwarded") ? "unwarded" : null, card.found.includes("unbraced") ? "unbraced" : null].filter((x): x is string => x !== null);
    return bits.length ? `, ${and(bits)}` : "";
  }
  if (card.intent === "perihelion" || card.intent === "revolution") {
    const bits = [
      card.found.includes("no-bastion") ? "no Bastion standing" : null,
      card.intent === "perihelion" && card.found.includes("outer-whole") ? "the outer ring whole" : null,
    ].filter((x): x is string => x !== null);
    return bits.length ? `, ${and(bits)}` : "";
  }
  return "";
}

/** The ending of a fight that has just ended, from its account and nothing else. */
export function compose(b: Battle, outcome: Ending["outcome"], abandoned: string): Ending {
  const a = account(b);
  const blank = { cardId: null, intent: null, targetId: null, found: [], answers: [], by: null, ringId: null, brokenBy: null, chain: a.chain };
  if (outcome === "abandoned") return { outcome, ...blank, line: abandoned };

  if (outcome === "won") {
    const blow = a.lastBlow;
    if (!blow) return { outcome, ...blank, line: `The Orrery ground to a halt. The longest Chain was ${a.chain}.` };
    const brokenBy = blow.ringId && blow.broken ? (a.brokenBy[blow.ringId] ?? null) : null;
    const into = blow.ringId ? ` into the ${blow.broken ? "Broken " : ""}${blow.ringId} ring` : "";
    const line = [
      `${nameOf(b, blow.by)}'s ${ACTIONS[blow.action].label}${into} ended it.`,
      brokenBy ? `${nameOf(b, brokenBy)} Broke the ring.` : null,
      `The longest Chain was ${a.chain}.`,
    ]
      .filter((x): x is string => x !== null)
      .join(" ");
    return { outcome, ...blank, intent: blow.action, by: blow.by, ringId: blow.ringId, brokenBy, line };
  }

  // Lost: the card that downed the last seat to fall.
  const last = b.fallen.filter((f) => f.kind === "character" && f.out === "downed").at(-1);
  const card = last ? a.downedBy[last.id] : undefined;
  if (!card) return { outcome, ...blank, line: "The last of the table has fallen." };
  const answers = answersFor(b, card);
  const where = card.targetId === "party" ? "everyone" : nameOf(b, card.targetId);
  let line: string;
  if (card.intent === "alignment") {
    const clock = card.found.includes("enraged") ? " The clock began it: the Orrery had turned forty times." : "";
    line = `The Grand Alignment completed. Nothing answers it but the Orrery falling first.${clock}`;
  } else {
    line = `${label(card.intent)} landed on ${where}${sayFound(card)}.${answers.length ? ` ${sayAnswers(b, answers)} would have met it.` : ""}`;
  }
  return { outcome, ...blank, cardId: card.cardId, intent: card.intent, targetId: card.targetId, found: [...card.found], answers, line };
}
