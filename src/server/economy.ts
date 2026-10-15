// The action economy (CLAUDE.md rules 8 and 13-18; docs/adr/006). Area (a)
// owns this file: ranks, Resonance, the Chain, Exposed stacks, Brace and
// Charge, Reactions, and the decision timer with its Echo. rules.ts calls the
// functions below at fixed points in every step and nothing else; roles.ts and
// orrery.ts call the helpers marked "for the other areas".
//
// SCAFFOLD: the bodies here are the minimum that keeps a fight running. The
// rules they owe are in spec/economy.test.ts and spec/pacing.test.ts, red.

import type { ActionId } from "../shared/protocol.ts";
import { ATTACK_RANK } from "./ctb.ts";
import { reset, type Battle, type Ctx, type Fighter, type Refusal } from "./rules.ts";
import { CHARGE_MAX, ECHO_SEAT } from "./tuning.ts";

/** The seats a room counts as at the pull: a person 1, an Echo ½ (rule 20). */
export function seatsOf(party: readonly Fighter[]): number {
  return party.reduce((n, f) => n + (f.echo ? ECHO_SEAT : 1), 0);
}

/** Before a character's turn: a person acting brightens their portrait and ends an Echo (rule 8). */
export function beforeTurn(ctx: Ctx, actor: Fighter, how: { byPerson: boolean }): void {
  actor.braced = false; // a Brace lasts until their next turn, which is now
  if (how.byPerson) {
    actor.timeouts = 0;
    actor.drifting = false;
    actor.echo = false;
  }
  ctx.stat(actor.id).turns += 1;
}

/**
 * After a character's action: the counter resets at `rank` (roles.ts may have
 * lowered it for a Resonance), and the Chain grows (rule 15).
 */
export function afterTurn(ctx: Ctx, actor: Fighter, action: ActionId, rank: number): void {
  void action;
  reset(ctx.b, actor, rank);
}

/** After the Orrery's turn: the Chain breaks and every Reaction comes back (rules 15, 18). */
export function afterBossTurn(ctx: Ctx): void {
  void ctx;
}

/** Brace (rule 17): rank 2, halve the next blow, bank a Charge to 3. For the other areas. */
export function brace(ctx: Ctx, actor: Fighter): void {
  actor.braced = true;
  actor.charge = Math.min(CHARGE_MAX, actor.charge + 1);
  ctx.say("action", actor.id, `${actor.name} braces for the next blow.`, { kind: "brace", actorId: actor.id, charge: actor.charge });
}

/** A turn past its deadline (rule 8). */
export function timeout(ctx: Ctx, f: Fighter): void {
  f.braced = false;
  f.timeouts += 1;
  reset(ctx.b, f, ATTACK_RANK);
  ctx.say("timeout", f.id, `${f.name} hesitates, and the turn passes.`, { kind: "hold", actorId: f.id, charge: f.charge, timeouts: f.timeouts });
}

/** An Echo's turn, played by the server at low output (rule 8). */
export function echoTurn(ctx: Ctx, f: Fighter): void {
  timeout(ctx, f);
}

/** Whether a Reaction may be taken now (rule 18); null to go ahead. */
export function checkReaction(b: Battle, actor: Fighter, action: ActionId, cardId: string | null): Refusal | null {
  void b;
  void actor;
  void action;
  void cardId;
  return { status: 409, error: "Reactions aren't built yet." };
}

/** Take a Reaction out of turn (rule 18). */
export function react(ctx: Ctx, actor: Fighter, action: ActionId, cardId: string | null): void {
  void ctx;
  void actor;
  void action;
  void cardId;
}
