// The Echo policies (docs/adr/007, "The policies"; CLAUDE.md rule 25): one
// fixed, deterministic policy per role, using only that role's own actions.
// Every Echo plays them: one seated on purpose and a seat that timed out into
// an Echo (rule 8) alike.
//
// A policy reads ONLY the BattleState every client is sent (view.ts), never
// the server's Battle: that is how "no policy reads anything a player can't
// see" is held by construction. It only proposes a move. rules.ts submits the
// move through checkAction, exactly as a person's action is, so an Echo is
// refused exactly as a person is (rules 1, 2, 10) and decides nothing about
// turn order. Each policy is a list read top to bottom: the first that
// matches wins.
//
// ADR-011: an Echo plays its job, not the fight. It heals, tanks, strikes,
// scans and delays, but never takes a Reaction, never swaps on Gravity
// (Anchor), never cancels a Retrograde (no Delay or Stillpoint at one), never
// chooses a ring (every blow goes at the server's default, null), and never
// spends Charge (a signature move waits until it has none). Those answers are
// a person's (rule 25), and they are the ones that keep a table alive.

import type { ActionId, BattleState, BossCard, Ring, Token } from "../shared/protocol.ts";
import { SHATTER_AT, SHATTER_COST } from "./tuning.ts";

/** A move an Echo proposes: an action from its role's catalogue, and what it's aimed at (null for the action's default). */
export interface Move {
  action: ActionId;
  targetId: string | null;
}

const BRACE: Move = { action: "brace", targetId: null };
const go = (action: ActionId, targetId: string | null = null): Move => ({ action, targetId });

/** Aimed at one character: not the room, and not the strip. */
const single = (c: BossCard): boolean => c.targetId !== null && c.targetId !== "party";

/** The soonest card that passes: lowest countdown, first announced on a tie. */
function soonest(cards: readonly BossCard[], ok: (c: BossCard) => boolean): BossCard | undefined {
  let best: BossCard | undefined;
  for (const c of cards) if (ok(c) && (!best || c.countdown < best.countdown)) best = c;
  return best;
}

/** The characters standing, in queue order. */
const party = (state: BattleState): Token[] => state.queue.filter((t) => t.kind === "character");

/** The outermost unbroken ring (rings are listed outer first) that passes. */
const outermost = (rings: readonly Ring[], ok: (r: Ring) => boolean): Ring | undefined => rings.find((r) => !r.broken && ok(r));

/** The Echo's move on its own turn, by its role's policy (first match wins). Never a Charge spend, never a ring (ADR-011). */
export function onTurn(state: BattleState, echoId: string): Move {
  const me = state.queue.find((t) => t.id === echoId);
  if (!me) return BRACE;
  const rings = state.rings;
  // A signature move spends Charge (rule 17); an Echo never does, so it waits for none (ADR-011).
  const charged = me.charge > 0;
  // Everyone's job: Brace before a blow on everyone lands next, a Perihelion always, or a Revolution while hurt.
  // A Brace is no Reaction, swap, cancel, ring or Charge spend, so it is an Echo's to make (ADR-011).
  const raid = soonest(state.cards, (c) => c.targetId === "party" && c.countdown === 0 && !c.frozen);
  if (raid && (raid.intent === "perihelion" || (raid.intent === "revolution" && me.hp <= (raid.amount ?? 0) * 1.5))) return BRACE;
  switch (me.role) {
    case "warden":
      // Tanks by striking: no Anchor (the swap is a person's), no Bastion while Charged.
      return me.resource >= 3 && !charged && !state.bastion ? go("bastion") : go("counterweight");
    case "mender": {
      const standing = (id: string | null) => party(state).some((t) => t.id === id);
      const warded = (id: string | null) => state.queue.find((t) => t.id === id)?.warded ?? true;
      const threatened = soonest(state.cards, (c) => single(c) && standing(c.targetId) && !warded(c.targetId));
      if (threatened) return go("ward", threatened.targetId);
      const hurt = party(state)
        .filter((t) => t.hp < t.maxHp)
        .sort((x, y) => x.hp / x.maxHp - y.hp / y.maxHp)[0];
      if (hurt) return go("mend", hurt.id);
      const next = party(state).find((t) => t.id !== me.id);
      return next ? go("quicken", next.id) : BRACE;
    }
    case "striker":
      // Strikes at the default ring; Finishes only with Momentum and no Charge, where the server aims it.
      return me.resource >= 3 && !charged ? go("finisher") : go("jab");
    case "breaker": {
      // Scans, Pries and Marks where the server aims each (its default ring is where the action does something);
      // Shatters only with no Charge to spend.
      if (outermost(rings, (r) => r.weakness === null)) return go("scan");
      if (!charged && me.resource >= SHATTER_COST && outermost(rings, (r) => r.pips <= SHATTER_AT)) return go("shatter");
      if (outermost(rings, (r) => r.exposed.length === 0)) return go("mark");
      return outermost(rings, (r) => r.weakness !== null && r.pips > SHATTER_AT) ? go("pry") : go("mark");
    }
    case "chronist": {
      // Delays a blow that's close, never a Retrograde (cancelling it is a person's answer).
      const close = soonest(state.cards, (c) => c.countdown <= 1 && c.intent !== "retrograde");
      return close ? go("delay", close.id) : go("relay");
    }
    default:
      return BRACE;
  }
}

/** An Echo takes no Reaction (ADR-011): a Reaction is a person's answer to a card. Always null. */
export function offTurn(state: BattleState, echoId: string): Move | null {
  void state;
  void echoId;
  return null;
}
