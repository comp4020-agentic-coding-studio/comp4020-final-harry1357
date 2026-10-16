// The Echo policies (docs/adr/007, "The policies"; CLAUDE.md rule 25): one
// fixed, deterministic policy per role, using only that role's own actions.
// Every Echo plays them: one seated on purpose and a seat that timed out into
// an Echo (rule 8) alike. Area (b) owns this file in phase one-b.
//
// A policy reads ONLY the BattleState every client is sent (view.ts), never
// the server's Battle: that is how "no policy reads anything a player can't
// see" is held by construction. It only proposes a move. rules.ts submits the
// move through checkAction, exactly as a person's action is, so an Echo is
// refused exactly as a person is (rules 1, 2, 10) and decides nothing about
// turn order.

import type { ActionId, BattleState } from "../shared/protocol.ts";

/** A move an Echo proposes: an action from its role's catalogue, and what it's aimed at (null for the action's default). */
export interface Move {
  action: ActionId;
  targetId: string | null;
}

/** The Echo's move on its own turn, by its role's policy. Area (b). */
export function onTurn(state: BattleState, echoId: string): Move {
  void state;
  void echoId;
  return { action: "brace", targetId: null };
}

/** A Reaction the Echo takes off its turn, if its policy has one now (the Warden's Intercept); else null. Area (b). */
export function offTurn(state: BattleState, echoId: string): Move | null {
  void state;
  void echoId;
  return null;
}
