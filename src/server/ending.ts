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
//
// The answers are the table's as it stood when the card landed (the gate's
// 1b): who was standing, who among them was a person, and what had already
// been done (a Brace, a Ward, a swap, a Bastion, a Break). An answer already
// made, or one its holder couldn't make (Anchor on your own blow), is never
// offered. An Echo's blow or Break is the Echo's (rules 8 and 25; the gate's
// 1a): named as its own line named it, never as its person's.

import { ACTIONS, ROLES, type ActionId, type BattleEvent, type Ending, type Intent, type RingId, type RoleId } from "../shared/protocol.ts";
import type { Battle, Fighter } from "./rules.ts";
import { ENRAGE_AFTER } from "./tuning.ts";

/** A seat as it stood when a card landed: its role, whether a person sat in it, and whether its Reaction was ready. */
export interface Stood {
  id: string;
  role: RoleId;
  person: boolean;
  reactionReady: boolean;
}

/** A boss card as it landed: what it found on the seat it landed on, and the table as it stood. */
export interface Landed {
  cardId: string;
  intent: Intent;
  targetId: string | "party";
  /** ADR-011's conditions, as tags: gravity:N, unbraced, unwarded, swapped, no-bastion, outer-whole, all-braced, enraged. */
  found: string[];
  /** Everyone standing as it landed (the gate's 1b): only they could have answered it. */
  table: Stood[];
}

export interface Account {
  /** The card that downed each seat, by seat id: the last to land on it before it fell. */
  downedBy: Record<string, Landed>;
  /** Who Broke each ring, most recently. */
  brokenBy: Partial<Record<RingId, string>>;
  /** The longest Chain the table made. */
  chain: number;
  /** The blow that took the Orrery's last HP; `echo` when an Echo struck it (rules 8 and 25). */
  lastBlow: { by: string; action: ActionId; ringId: RingId | null; broken: boolean; echo: boolean } | null;
  /** Who Broke each ring was an Echo, by ring (rules 8 and 25). */
  brokenByEcho: Partial<Record<RingId, boolean>>;
}

export const newAccount = (): Account => ({ downedBy: {}, brokenBy: {}, brokenByEcho: {}, chain: 0, lastBlow: null });

/** The account, on the battle (rules.ts declares it), so it survives each step's clone. */
export function account(b: Battle): Account {
  b.account ??= newAccount();
  b.account.brokenByEcho ??= {};
  return b.account;
}

const isPerson = (f: Fighter): boolean => f.seatedBy === null && !f.echo;

/** The table as a card lands, taken before it resolves: who stood, who was a person, whose Reaction was ready. */
export function standingAt(b: Battle): Stood[] {
  return b.standing
    .filter((f) => f.kind === "character")
    .map((f) => ({ id: f.id, role: f.role as RoleId, person: isPerson(f), reactionReady: f.reactionReady }));
}

/** A card has landed: every seat it brought to 0 HP was downed by it. Called before downTheFallen. */
export function landed(b: Battle, card: Landed): void {
  const a = account(b);
  for (const f of b.standing) if (f.kind === "character" && f.hp <= 0) a.downedBy[f.id] = card;
}

/** Whether a seat is an Echo now: its blow and its Break are the Echo's, never its person's. */
const echoNow = (b: Battle, id: string): boolean => {
  const f = b.standing.find((x) => x.id === id) ?? b.fallen.find((x) => x.id === id);
  return f !== undefined && f.kind === "character" && f.echo;
};

/** What one step did that the ending reads: the Chain's length, each Break, and the blow on the Orrery. */
export function noted(b: Battle, events: readonly BattleEvent[]): void {
  const a = account(b);
  let reaction: ActionId | null = null;
  for (const e of events) {
    if (e.kind === "chain") a.chain = Math.max(a.chain, e.links);
    else if (e.kind === "break") {
      a.brokenBy[e.ringId] = e.by;
      a.brokenByEcho[e.ringId] = echoNow(b, e.by);
    } else if (e.kind === "reaction") reaction = e.action;
    else if (e.kind === "sting" && e.amount > 0) a.lastBlow = { by: e.actorId, action: reaction ?? "brace", ringId: null, broken: false, echo: echoNow(b, e.actorId) };
    else if ((BLOWS as readonly string[]).includes(e.kind) && "ringId" in e && "amount" in e && e.amount > 0) {
      const ring = b.rings.find((r) => r.id === e.ringId);
      a.lastBlow = { by: e.actorId, action: e.kind as ActionId, ringId: e.ringId, broken: ring?.broken === true, echo: echoNow(b, e.actorId) };
    }
  }
}

/** The events that take HP off the Orrery through a ring. */
const BLOWS = ["jab", "cleave", "finisher", "feint", "counterweight"] as const;

/** What a single-target card finds on its seat (ADR-011's first and fourth teeth), and whether a Warden took it on purpose. */
export function foundOn(f: Fighter, gravity: number | null, swapped = false): string[] {
  return [
    ...(gravity !== null && gravity > 0 ? [`gravity:${gravity}`] : []),
    ...(f.braced ? [] : ["unbraced"]),
    ...(f.warded ? [] : ["unwarded"]),
    ...(swapped ? ["swapped"] : []),
  ];
}

// --- the answers -------------------------------------------------------------

/**
 * ADR-011's answers to each tooth, and when each one counts as already made (the gate's 1b) or as one its
 * holder couldn't make. `self` is the card's own target; `any`, every seat's. A Reaction is an answer only for
 * a holder whose Reaction was ready as the card landed, and Riposte and Nudge (ADR-011: "a Reaction against a
 * blow aimed at you Wards you") only for the seat the card was aimed at (the gate's 1c).
 */
interface Answer {
  role: RoleId | "any" | "self";
  action: ActionId;
  /** Already made, by what the card found: then it's no answer the table lacked. */
  made?: (found: readonly string[]) => boolean;
  /** Only for the card's own target (Riposte, Nudge), or never for it (Anchor). */
  target?: "only" | "never";
}
const swappedOrWarded = (f: readonly string[]) => f.includes("swapped") || !f.includes("unwarded");
const ONE: readonly Answer[] = [
  { role: "warden", action: "anchor", made: swappedOrWarded, target: "never" },
  { role: "warden", action: "intercept", made: swappedOrWarded },
  { role: "mender", action: "ward", made: swappedOrWarded },
  { role: "mender", action: "veil", made: swappedOrWarded },
  { role: "striker", action: "riposte", made: swappedOrWarded, target: "only" },
  { role: "chronist", action: "nudge", made: swappedOrWarded, target: "only" },
  { role: "self", action: "brace", made: (f) => !f.includes("unbraced") || f.includes("swapped") },
];
const ANSWERS: Readonly<Partial<Record<Intent, readonly Answer[]>>> = {
  lunge: ONE,
  eclipse: ONE,
  perihelion: [
    { role: "warden", action: "bastion", made: (f) => !f.includes("no-bastion") },
    { role: "breaker", action: "shatter", made: (f) => !f.includes("outer-whole") },
    { role: "breaker", action: "fracture", made: (f) => !f.includes("outer-whole") },
    { role: "any", action: "brace", made: (f) => f.includes("all-braced") },
  ],
  revolution: [
    { role: "warden", action: "bastion", made: (f) => !f.includes("no-bastion") },
    { role: "any", action: "brace", made: (f) => f.includes("all-braced") },
  ],
};

/** The answers the table had and didn't make, as it stood when the card landed: each by its person, or by role when only an Echo held it. */
function answersFor(card: Landed): Ending["answers"] {
  const out: Ending["answers"] = [];
  const table = card.table ?? [];
  for (const ans of ANSWERS[card.intent] ?? []) {
    if (ans.made?.(card.found)) continue;
    const reaction = ACTIONS[ans.action].reaction === true;
    if (ans.role === "any") {
      out.push({ role: "any", action: ans.action, by: null });
      continue;
    }
    if (ans.role === "self") {
      const target = table.find((f) => f.id === card.targetId);
      if (target) out.push({ role: target.role, action: ans.action, by: target.person ? target.id : null });
      continue;
    }
    const holders = table.filter(
      (f) =>
        f.role === ans.role &&
        (ans.target !== "only" || f.id === card.targetId) &&
        (ans.target !== "never" || f.id !== card.targetId) &&
        (!reaction || f.reactionReady),
    );
    if (holders.length === 0) continue;
    const person = holders.find((f) => f.person);
    out.push({ role: ans.role, action: ans.action, by: person ? person.id : null });
  }
  return out;
}

// --- the words -----------------------------------------------------------------

const label = (intent: Intent): string => (intent === "alignment" ? "Alignment" : intent.charAt(0).toUpperCase() + intent.slice(1));
const nameOf = (b: Battle, id: string | null): string => (id ? (b.joined[id] ?? id) : "someone");
/** An Echo's act is said as the Echo's, as its own log line said it (rules 8 and 25; the gate's 1a). */
const actorName = (b: Battle, id: string, echo: boolean): string => {
  const f = b.standing.find((x) => x.id === id) ?? b.fallen.find((x) => x.id === id);
  // A seated Echo's name is already "Warden Echo"; a timed-out seat's Echo is "The Echo of <name>".
  return echo && f?.seatedBy === null ? `The Echo of ${nameOf(b, id)}` : nameOf(b, id);
};
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
  // A sentence's own first word is capitalised ("A Warden's", "Every seat's"); a person's name is said as they wrote it.
  return /^(an?|every) /.test(said) ? said.charAt(0).toUpperCase() + said.slice(1) : said;
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
    const brokeEcho = blow.ringId ? a.brokenByEcho[blow.ringId] === true : false;
    const line = [
      `${actorName(b, blow.by, blow.echo === true)}'s ${ACTIONS[blow.action].label}${into} ended it.`,
      brokenBy ? `${actorName(b, brokenBy, brokeEcho)} Broke the ring.` : null,
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
  const answers = answersFor(card);
  const where = card.targetId === "party" ? "everyone" : nameOf(b, card.targetId);
  let line: string;
  if (card.intent === "alignment") {
    const clock = card.found.includes("enraged") ? ` The clock began it: the Orrery had turned ${ENRAGE_AFTER} times.` : "";
    line = `The Grand Alignment completed. Nothing answers it but the Orrery falling first.${clock}`;
  } else {
    const unmet = answers.length ? ` ${sayAnswers(b, answers)} would have met it.` : " It was met, and still took the last of them.";
    line = `${label(card.intent)} landed on ${where}${sayFound(card)}.${unmet}`;
  }
  return { outcome, ...blank, cardId: card.cardId, intent: card.intent, targetId: card.targetId, found: [...card.found], answers, line };
}
