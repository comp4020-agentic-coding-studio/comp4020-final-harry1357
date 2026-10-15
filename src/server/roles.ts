// The five roles (docs/design/overhaul.md, Priority 2): Warden, Mender,
// Striker, Breaker, Chronist, each with its own resource and the actions the
// design record tables. Area (b) owns this file. rules.ts asks it whether an
// action may be taken, which target it resolves to, and to perform it; it
// leans on economy.ts for Brace, Exposed and Resonance, and on orrery.ts for
// rings and cards.
//
// SCAFFOLD: every action is a plain blow at its rank until it's built. The
// rules owed are in spec/economy.test.ts ("the five roles") and
// spec/orrery.test.ts (Anchor, Delay, Stillpoint), red.

import { ACTIONS, type ActionId, type RoleId } from "../shared/protocol.ts";
import * as economy from "./economy.ts";
import { isStanding, wound, type Battle, type Ctx, type Fighter, type Refusal } from "./rules.ts";

/** Each role's body. Server-only numbers; the client sees ranks and nothing else. */
export const STATS: Readonly<Record<RoleId, { agility: number; hp: number; power: number }>> = {
  warden: { agility: 30, hp: 170, power: 12 },
  mender: { agility: 50, hp: 100, power: 9 },
  striker: { agility: 70, hp: 110, power: 18 },
  breaker: { agility: 62, hp: 105, power: 12 },
  chronist: { agility: 110, hp: 90, power: 9 },
};

/** Whether `actor` may take `action` now, beyond it being their turn and their role's; null to go ahead. */
export function checkAction(b: Battle, actor: Fighter, action: ActionId, target: string | null): Refusal | null {
  if (ACTIONS[action].target === "ally" && target !== null && !isStanding(b, target)) {
    return { status: 400, error: "That ally isn't standing at this table." };
  }
  return null;
}

/** The target an action resolves to: an ally defaults to yourself; a ring or card passes through. */
export function resolveTarget(b: Battle, actor: Fighter, action: ActionId, target: string | null): string | null {
  void b;
  return ACTIONS[action].target === "ally" ? (target ?? actor.id) : target;
}

/**
 * Perform `action`. Returns the rank the counter resets at: the action's own,
 * or one lower for a Resonance (rule 14), which economy.afterTurn applies.
 */
export function perform(ctx: Ctx, actor: Fighter, action: ActionId, target: string | null): { rank: number } {
  void target;
  const info = ACTIONS[action];
  if (action === "brace") {
    economy.brace(ctx, actor);
    return { rank: info.rank };
  }
  const dealt = wound(ctx, STATS[actor.role as RoleId].power);
  ctx.stat(actor.id).damage += dealt;
  ctx.say("action", actor.id, `${actor.name} uses ${info.label} on the Orrery for ${dealt}.`, {
    kind: "jab",
    actorId: actor.id,
    ringId: "outer",
    amount: dealt,
  });
  return { rank: info.rank };
}
