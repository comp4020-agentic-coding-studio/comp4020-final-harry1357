// Three scripted players per role (ADR-011), as test fixtures: what a person
// who doesn't know the mechanics does, what the Echo does, and what a person
// who reads the strip does. Each reads only the state every client is sent
// (src/server/view.ts), as an Echo's policy does (rule 25), so nothing here
// knows anything a player at the table couldn't. Each proposes; the engine
// checks every move exactly as it checks a person's, and a refused move
// becomes a Brace in the runner (./table.ts), as a button the server greys out
// sends nothing.
//
// - naive: plays its role's highest-damage card at the Orrery's default ring
//   every turn. Never braces, swaps, cancels, reacts or chooses a ring. A
//   role with no card that deals damage plays the one that looks like it
//   does most: its first non-Brace action that the server takes.
// - competent: the Echo's own policy (src/server/echoes.ts), on its turn and
//   off it. Exactly what an Echo would do in the seat, at a person's output.
// - expert: reads the strip. Answers the card that will hurt it (Gravity by
//   swap, Retrograde by cancel, Eclipse by Ward, Perihelion by Bastion and
//   Break), takes its Reaction against every card it can, chains, hits the
//   revealed weakness (it names the ring), and spends Charge on its
//   signature move.

import type { ActionId, BattleState, BossCard, Ring, RoleId, Token } from "../../src/shared/protocol.ts";

export type Level = "naive" | "competent" | "expert";

export interface Move {
  action: ActionId;
  targetId: string | null;
}

export interface Policy {
  /** The move on its own turn. */
  onTurn(state: BattleState, id: string): Move;
  /** A Reaction off its turn, or null. Only ever against the card the server names (the token's reactionCard). */
  offTurn(state: BattleState, id: string): Move | null;
}

const go = (action: ActionId, targetId: string | null = null): Move => ({ action, targetId });
const BRACE = go("brace");

const me = (s: BattleState, id: string): Token | undefined => s.queue.find((t) => t.id === id);
const party = (s: BattleState): Token[] => s.queue.filter((t) => t.kind === "character");
const single = (c: BossCard): boolean => c.targetId !== null && c.targetId !== "party";
/** Orrery turns until a card lands: a frozen card skips one first. */
const lands = (c: BossCard): number => c.countdown + (c.frozen ? 1 : 0);
const soonest = (cards: readonly BossCard[], ok: (c: BossCard) => boolean): BossCard | undefined =>
  [...cards].filter(ok).sort((x, y) => lands(x) - lands(y))[0];
const known = (r: Ring): boolean => !r.broken && r.weakness !== null;
const tokenOf = (s: BattleState, id: string | null): Token | undefined => (id ? s.queue.find((t) => t.id === id) : undefined);

// --- naive -------------------------------------------------------------------------------------------------

/**
 * Each role's highest-damage card, as the command window shows it to someone who reads only its label: the
 * blow with the biggest number. A role with no blow plays the action that sounds like it does most.
 */
const NAIVE: Readonly<Record<RoleId, readonly ActionId[]>> = {
  warden: ["counterweight"],
  striker: ["finisher", "cleave"],
  mender: ["mend"],
  breaker: ["pry", "mark"],
  chronist: ["haste", "relay"],
};

export const naive: Policy = {
  onTurn(state, id) {
    const t = me(state, id);
    if (!t || t.role === "orrery") return BRACE;
    // The first of its "biggest" cards the server takes now (the preview's refusal is the greyed-out button);
    // never a ring of its own choosing, never a target but the default.
    for (const action of NAIVE[t.role]) {
      const preview = state.preview?.actorId === id ? state.preview.actions[action] : undefined;
      if (preview && preview.refusal === null) return go(action, null);
    }
    return go(NAIVE[t.role].at(-1) as ActionId, null);
  },
  offTurn: () => null,
};

// --- competent: the Echo's own policy ----------------------------------------------------------------------

/** Loaded from the server's own module, so "competent" is always the Echo's policy as it stands. */
export async function competent(): Promise<Policy> {
  const echoes = (await import("../../src/server/echoes.ts")) as unknown as Policy;
  return { onTurn: (s, id) => echoes.onTurn(s, id), offTurn: (s, id) => echoes.offTurn(s, id) };
}

// --- expert ------------------------------------------------------------------------------------------------

/** The card this seat's Reaction may answer now, as the server names it, or null. */
const reactionCard = (s: BattleState, id: string): string | null => me(s, id)?.reactionCard ?? null;

/** The card the expert must answer on its turn, if any: what will kill or cost the table if left. */
function threat(s: BattleState, id: string): { card: BossCard; why: "gravity" | "retrograde" | "eclipse" | "perihelion" | "lunge" } | null {
  const order = s.cards.slice().sort((x, y) => lands(x) - lands(y));
  for (const c of order) {
    if (c.intent === "retrograde" && !c.frozen) return { card: c, why: "retrograde" };
    if (c.intent === "lunge" && single(c)) {
      const target = tokenOf(s, c.targetId);
      if (target && !target.warded) return { card: c, why: target.gravity >= 2 ? "gravity" : "lunge" };
    }
    if (c.intent === "eclipse" && single(c)) {
      const target = tokenOf(s, c.targetId);
      if (target && !target.warded) return { card: c, why: "eclipse" };
    }
    if (c.intent === "perihelion" && lands(c) <= 1) return { card: c, why: "perihelion" };
  }
  void id;
  return null;
}

/**
 * The ring a blow should land on. With a Perihelion on the strip and the outer ring still shielded, the outer
 * ring (a blow on its revealed weakness cracks a pip, and a Break meets the Perihelion); else a Broken ring (it
 * resonates and Finisher doubles); else a revealed weakness; else the server's default.
 */
function blowRing(s: BattleState): string | null {
  const outer = s.rings.find((r) => r.id === "outer");
  if (outer && !outer.broken && s.cards.some((c) => c.intent === "perihelion")) return "outer";
  return s.rings.find((r) => r.broken)?.id ?? s.rings.find(known)?.id ?? null;
}

export const expert: Policy = {
  onTurn(state, id) {
    const t = me(state, id);
    if (!t || t.role === "orrery") return BRACE;
    const ok = (action: ActionId, target: string | null = null): boolean => {
      const p = state.preview?.actorId === id ? state.preview.actions[action] : undefined;
      return !!p && p.refusal === null && (target === null || ACTIONS_THAT_AIM.has(action));
    };
    const danger = threat(state, id);
    const others = party(state).filter((x) => x.id !== id);
    // Everyone's own answer: a lethal blow aimed at me lands next and nothing else meets it (a Lunge on Gravity,
    // or an Eclipse): Brace. A Reaction against it would Ward me before it lands, so only when that won't come.
    const atMe = soonest(state.cards, (c) => c.targetId === id && !c.frozen);
    const lethalAtMe = !!atMe && !t.warded && lands(atMe) === 0 && ((atMe.intent === "lunge" && t.gravity >= 2) || atMe.intent === "eclipse");
    if (lethalAtMe && t.reactionCard !== atMe?.id) return go("brace");
    // A blow on everyone lands next and there's Charge to bank: Brace (rule 17), halving it and banking the Charge
    // the signature move below spends.
    const raidNext = soonest(state.cards, (c) => c.targetId === "party" && lands(c) === 0);
    if (raidNext && raidNext.intent !== "alignment" && t.charge < 2 && t.role !== "warden") return go("brace");
    switch (t.role) {
      case "warden": {
        // The swap: a Lunge on someone else with Gravity on them comes to the Warden.
        if (danger && (danger.why === "gravity" || danger.why === "lunge") && danger.card.targetId !== id && ok("anchor")) {
          return go("anchor", danger.card.id);
        }
        if (danger && danger.why === "eclipse" && danger.card.targetId !== id && ok("anchor")) return go("anchor", danger.card.id);
        // Perihelion coming with Resolve banked: Bastion it, Charge deepening the cut.
        const raid = soonest(state.cards, (c) => (c.intent === "perihelion" || c.intent === "revolution") && lands(c) <= 1);
        if (raid && !state.bastion && t.resource > 0 && ok("bastion") && (raid.intent === "perihelion" || t.charge >= 2)) return go("bastion");
        if (raid && raid.intent !== "perihelion" && t.charge < 2) return go("brace");
        return go("counterweight", blowRing(state));
      }
      case "mender": {
        if (danger && (danger.why === "eclipse" || danger.why === "gravity" || danger.why === "lunge")) {
          const target = tokenOf(state, danger.card.targetId);
          if (target && !target.warded && ok("ward")) return go("ward", target.id);
        }
        const down = state.fallen.find((f) => f.kind === "character" && f.hp <= 0);
        if (down && t.resource >= 3 && ok("restore")) return go("restore", down.id);
        const hurt = party(state)
          .filter((x) => x.hp < x.maxHp * 0.6)
          .sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
        if (hurt && ok("mend")) return go("mend", hurt.id);
        // Nothing to answer: ward whoever a card names, else keep a body on the field mended.
        const named = soonest(state.cards, (c) => single(c) && !tokenOf(state, c.targetId)?.warded);
        if (named && ok("ward")) return go("ward", named.targetId);
        const next = others[0];
        return next && ok("quicken") ? go("quicken", next.id) : go("mend", t.id);
      }
      case "striker": {
        const broken = state.rings.find((r) => r.broken);
        if (broken && t.resource >= 2 && ok("finisher")) return go("finisher", broken.id);
        if (t.resource >= 4 && t.charge >= 1 && ok("finisher")) return go("finisher", blowRing(state));
        const aimAt = blowRing(state);
        const stacked = state.rings.find((r) => r.exposed.length > 0 && (aimAt === null || r.id === aimAt));
        if (stacked && ok("feint")) return go("feint", stacked.id);
        const weak = aimAt ? state.rings.find((r) => r.id === aimAt && known(r)) : state.rings.find(known);
        if (weak && ok("cleave")) return go("cleave", weak.id);
        return go("jab", aimAt);
      }
      case "breaker": {
        // Perihelion coming: break the outer ring to halve it.
        const peri = soonest(state.cards, (c) => c.intent === "perihelion");
        const outer = state.rings.find((r) => r.id === "outer");
        if (peri && outer && !outer.broken) {
          if (outer.weakness === null && ok("scan")) return go("scan", "outer");
          if (outer.pips <= 2 && t.resource >= 3 && ok("shatter")) return go("shatter", "outer");
          if (ok("pry")) return go("pry", "outer");
        }
        const hidden = state.rings.find((r) => !r.broken && r.weakness === null);
        if (hidden && ok("scan")) return go("scan", hidden.id);
        const thin = state.rings.find((r) => !r.broken && r.pips <= 2);
        if (thin && t.resource >= 3 && ok("shatter")) return go("shatter", thin.id);
        const pryable = state.rings.find((r) => known(r) && r.pips > 0);
        if (pryable && ok("pry")) return go("pry", pryable.id);
        return go("mark", blowRing(state));
      }
      case "chronist": {
        if (danger && danger.why === "retrograde") {
          if (t.resource >= 5 && ok("stillpoint")) return go("stillpoint", danger.card.id);
          if (ok("delay")) return go("delay", danger.card.id);
        }
        if (danger && (danger.why === "gravity" || danger.why === "perihelion") && lands(danger.card) <= 1 && ok("delay")) return go("delay", danger.card.id);
        // Haste the hardest hitter in the room, else hand the baton on.
        const striker = others.find((x) => x.role === "striker" && !x.hasted);
        if (striker && ok("haste")) return go("haste", striker.id);
        return go("relay");
      }
    }
    return BRACE;
  },
  offTurn(state, id) {
    const t = me(state, id);
    if (!t || t.role === "orrery") return null;
    const card = reactionCard(state, id);
    if (!card) return null;
    const action = REACTION_OF[t.role as RoleId];
    return action ? go(action, card) : null;
  },
};

/** Actions whose explicit target a policy names (a ring, a card, an ally). */
const ACTIONS_THAT_AIM: ReadonlySet<ActionId> = new Set<ActionId>([
  "anchor", "counterweight", "mend", "ward", "quicken", "restore", "jab", "cleave", "finisher", "feint", "scan", "pry", "mark", "shatter",
  "delay", "haste", "stillpoint",
]);

/** Each role's Reaction, read from the catalogue at load, so a role given one is played by the expert at once. */
let REACTION_OF: Partial<Record<RoleId, ActionId>> = {};
export async function loadReactions(): Promise<void> {
  const { ACTIONS, ROLES } = await import("../../src/shared/protocol.ts");
  REACTION_OF = Object.fromEntries(
    Object.values(ROLES).flatMap((r) => {
      const a = r.actions.find((x) => ACTIONS[x].reaction);
      return a ? [[r.id, a]] : [];
    }),
  );
}
