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

import type { ActionId, BattleState, BossCard, Ring, Token } from "../shared/protocol.ts";
import { GRAVITY_LETHAL, SHATTER_AT, SHATTER_COST } from "./tuning.ts";

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

/** The Echo's move on its own turn, by its role's policy (first match wins). */
export function onTurn(state: BattleState, echoId: string): Move {
  const me = state.queue.find((t) => t.id === echoId);
  if (!me) return BRACE;
  const rings = state.rings;
  switch (me.role) {
    case "warden": {
      const doomed = soonest(
        state.cards,
        (c) =>
          single(c) && c.targetId !== me.id && (state.queue.find((t) => t.id === c.targetId)?.gravity ?? 0) >= GRAVITY_LETHAL - 1,
      );
      return doomed ? go("anchor", doomed.id) : go("counterweight");
    }
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
    case "striker": {
      const broken = rings.find((r) => r.broken);
      return me.resource > 0 && broken ? go("finisher", broken.id) : go("jab");
    }
    case "breaker": {
      const unknown = outermost(rings, (r) => r.weakness === null);
      if (unknown) return go("scan", unknown.id);
      const thin = outermost(rings, (r) => r.pips <= SHATTER_AT);
      if (thin && me.resource >= SHATTER_COST) return go("shatter", thin.id);
      const bare = outermost(rings, (r) => r.exposed.length === 0);
      if (bare) return go("mark", bare.id);
      const thick = outermost(rings, (r) => r.weakness !== null && r.pips > SHATTER_AT);
      return thick ? go("pry", thick.id) : go("mark");
    }
    case "chronist": {
      const close = soonest(state.cards, (c) => c.countdown <= 1);
      return close ? go("delay", close.id) : go("relay");
    }
    default:
      return BRACE;
  }
}

/** A Reaction the Echo takes off its turn, if its policy has one now (the Warden's Intercept); else null. */
export function offTurn(state: BattleState, echoId: string): Move | null {
  const me = state.queue.find((t) => t.id === echoId);
  if (!me || me.role !== "warden" || !me.reactionReady) return null;
  // The card the server names (its reactionCard), and only once it lands on the Orrery's next turn.
  const blow = state.cards.find((c) => c.id === me.reactionCard);
  return blow && single(blow) && blow.countdown === 0 && !blow.frozen ? go("intercept", blow.id) : null;
}
