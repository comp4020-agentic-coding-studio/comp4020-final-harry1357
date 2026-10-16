// The action economy (CLAUDE.md rules 8 and 13-18; docs/adr/006). Area (a)
// owns this file: ranks, Resonance, the Chain, Exposed stacks, Brace and
// Charge, Reactions, and the decision timer with its Echo. rules.ts calls the
// step hooks below at fixed points in every step and nothing else; roles.ts
// and orrery.ts call the helpers marked "for the other areas".
//
// Nothing here decides turn order. A counter only ever moves through rules.ts
// `reset()` (rule 13), at the rank an action earned; nothing is buffered or
// kept for later (rule 2); and a timeout only decides that a turn passes, at
// Brace's rank, never who goes next (rule 8).
//
// Judgement calls, so the integrator can see them in one place:
//
// - The Chain counts turns a player's seat actually takes: a person's action
//   and an Echo's turn each add a link. A timeout's auto-Brace adds none
//   (nobody chose it) and breaks none either: rule 15 says only a boss action
//   resets the Chain, so one absent player can't cost the room its Chain.
//   A Reaction takes no turn, so it adds no link.
// - Chain potency is what the NEXT player turn deals at (protocol.ts `Chain`):
//   1 + min(CHAIN_CAP, CHAIN_STEP × (links − 1)). The first turn makes one link
//   at 1.0; once two turns have resolved the link lights at 1.1, and the third
//   turn deals at 1.1. `potency()` reads it as it stands, before this turn's
//   own link is added in afterTurn.
// - An Echo plays a plain blow on the Orrery: the role's STATS power ×
//   potency() (which carries ECHO_POTENCY), dealt through rules.ts `wound()`.
//   It is emitted as a "jab", the protocol's plain blow (ringId, amount and
//   nothing else), which the client already draws per role. A role-specific
//   event (counterweight, cleave) would claim that action's side effects
//   (Exposed, Momentum, a weakness check), which an Echo doesn't do. Its turn
//   and damage are credited to the character: it is their seat taking a turn.
//   It resets at rank 3 and adds a Chain link. It is never a "hold".
// - A Reaction is a person acting, so it counts as them being back: it ends an
//   Echo and clears drifting and the timeout count, exactly as a turn does.
// - A timeout isn't counted in the character's turn stats (nobody chose it).
// - Log lines follow protocol.ts: only "plate", "card" and "chain" are drawn
//   without one, so "chain" is emitted bare and every other event here writes
//   a line. Only a turn's own action writes an "action" line, because rules.ts
//   reads the last "action" line as "who just took this turn" (ADR-005).
//   Resonance, Exposed, Echo on/off, a Reaction and its Intercept write
//   "system" lines; a timeout writes its "timeout" line (spec/pacing.test.ts
//   counts those).

import { ACTIONS, type ActionId, type ExposedStack, type RingId, type RoleId } from "../shared/protocol.ts";
import { ATTACK_RANK } from "./ctb.ts";
import { STATS } from "./roles.ts";
import { reset, wound, type Battle, type Ctx, type Fighter, type Refusal } from "./rules.ts";
import {
  CHAIN_CAP,
  CHAIN_STEP,
  CHARGE_MAX,
  ECHO_POTENCY,
  ECHO_SEAT,
  RANK_MIN,
  RESOLVE_MAX,
  TIMEOUTS_TO_ECHO,
} from "./tuning.ts";

/** Rule 13's names for the ranks, for the log. */
const RANK_NAME: Readonly<Record<number, string>> = { 1: "Quick", 2: "Light", 3: "Standard", 4: "Heavy", 5: "Ultimate" };
const rankName = (rank: number): string => RANK_NAME[rank] ?? `rank ${rank}`;

// --- seats ------------------------------------------------------------------

/** The seats a room counts as at the pull: a person 1, an Echo ½ (rule 20). */
export function seatsOf(party: readonly Fighter[]): number {
  return party.reduce((n, f) => n + (f.echo ? ECHO_SEAT : 1), 0);
}

// --- the step hooks rules.ts calls ------------------------------------------

/**
 * Before a character's turn. A Brace lasts until their next turn, which is now.
 * A person acting brightens their portrait and ends an Echo at once (rule 8);
 * an Echo's own turn (byPerson false) leaves both as they are.
 */
export function beforeTurn(ctx: Ctx, actor: Fighter, how: { byPerson: boolean }): void {
  actor.braced = false;
  if (how.byPerson) present(ctx, actor);
  ctx.stat(actor.id).turns += 1;
}

/**
 * After a character's action: the counter resets at `rank`, which roles.ts
 * may have lowered for a Resonance (rules 13-14), and the Chain grows (rule 15).
 */
export function afterTurn(ctx: Ctx, actor: Fighter, action: ActionId, rank: number): void {
  void action;
  reset(ctx.b, actor, rank);
  link(ctx);
}

/** After the Orrery's turn: the Chain breaks and every Reaction comes back (rules 15, 18). */
export function afterBossTurn(ctx: Ctx): void {
  const { b } = ctx;
  if (b.chain.links > 0) {
    b.chain = { links: 0, potency: 1 };
    ctx.emit({ kind: "chain", links: 0, potency: 1, broken: true });
  }
  for (const f of ctx.party()) f.reactionReady = true;
}

/**
 * A turn past its deadline (rule 8). The server Braces for them: the one safe
 * action, at Brace's rank (2), halving what they take and banking a Charge.
 * Their portrait dims. Three in a row and they become an Echo. Nobody is ever
 * removed for timing out, and the timeout decides only that this turn passes.
 */
export function timeout(ctx: Ctx, f: Fighter): void {
  bank(f);
  f.drifting = true;
  f.timeouts += 1;
  reset(ctx.b, f, ACTIONS.brace.rank);
  ctx.say(
    "timeout",
    f.id,
    `${f.name}'s time runs out, and the table braces for them${f.charge >= CHARGE_MAX ? ` (Charge full at ${CHARGE_MAX})` : ` (Charge ${f.charge})`}.`,
    { kind: "hold", actorId: f.id, charge: f.charge, timeouts: f.timeouts },
  );
  if (f.timeouts >= TIMEOUTS_TO_ECHO && !f.echo) {
    f.echo = true;
    ctx.say(
      "system",
      f.id,
      `${f.name} has missed ${f.timeouts} turns running. An Echo plays their seat at ${Math.round(ECHO_POTENCY * 100)}% until they act again.`,
      { kind: "echo", actorId: f.id, on: true },
    );
  }
}

/**
 * An Echo's turn, played by the server at once (rule 8): a plain blow on the
 * Orrery at ECHO_POTENCY, then a rank-3 reset and a Chain link. Never a hold,
 * and never `beforeTurn(byPerson)`, which would end the Echo.
 */
export function echoTurn(ctx: Ctx, f: Fighter): void {
  // An Echo's turn is the Echo's (ADR-006, "The Echo"): it never counts in the
  // person's record, so neither the turn nor the damage is credited to them.
  f.braced = false;
  const dealt = wound(ctx, STATS[f.role as RoleId].power * potency(ctx, f));
  const ring = ctx.b.rings.find((r) => !r.broken) ?? ctx.b.rings.at(-1);
  ctx.say("action", f.id, `The Echo of ${f.name} strikes the Orrery for ${dealt}.`, {
    kind: "jab",
    actorId: f.id,
    ringId: ring?.id ?? "outer",
    amount: dealt,
  });
  reset(ctx.b, f, ATTACK_RANK);
  link(ctx);
}

/**
 * Whether a Reaction may be taken now (rule 18); null to go ahead. Out of
 * turn, once between two boss turns, and only against a card already on the
 * strip. There is nothing to keep for later: no card, no Reaction (rule 2).
 */
export function checkReaction(b: Battle, actor: Fighter, action: ActionId, cardId: string | null): Refusal | null {
  if (!ACTIONS[action].reaction) return { status: 400, error: `${ACTIONS[action].label} isn't a Reaction.` };
  if (!actor.reactionReady) return { status: 409, error: "You've used your Reaction; it comes back after the Orrery's next turn." };
  const card = cardId === null ? undefined : b.cards.find((c) => c.id === cardId);
  if (!card) return { status: 409, error: "There's no announced card on the strip to react to." };
  switch (action) {
    case "intercept": {
      // A single-target card: aimed at one character, not the room or the strip.
      if (card.targetId === null || card.targetId === "party") {
        return { status: 409, error: "Intercept answers a blow aimed at one ally; that card isn't one." };
      }
      if (card.targetId === actor.id) return { status: 409, error: "That blow is already meant for you." };
      if (!b.standing.some((f) => f.id === card.targetId && f.kind === "character")) {
        return { status: 409, error: "Nobody standing is under that card." };
      }
      return null;
    }
    default:
      return { status: 400, error: `${ACTIONS[action].label} isn't a Reaction.` };
  }
}

/**
 * Take a Reaction out of turn (rule 18). It spends the Reaction and takes no
 * turn: no reset, no Chain link, no turn in the stats.
 */
export function react(ctx: Ctx, actor: Fighter, action: ActionId, cardId: string | null): void {
  const card = ctx.b.cards.find((c) => c.id === cardId);
  if (!card) throw new Error(`a Reaction against card ${cardId}, which checkReaction should have refused`);
  present(ctx, actor);
  actor.reactionReady = false;
  ctx.say("system", actor.id, `${actor.name} reacts out of turn with ${ACTIONS[action].label}, against the Orrery's ${card.intent}.`, {
    kind: "reaction",
    actorId: actor.id,
    action,
    cardId: card.id,
  });
  switch (action) {
    case "intercept": {
      // Warden: the blow is retargeted onto them, and absorbing it for an ally banks Resolve.
      const protectedId = card.targetId as string;
      const ward = ctx.b.standing.find((f) => f.id === protectedId);
      card.targetId = actor.id;
      actor.resource = Math.min(RESOLVE_MAX, actor.resource + 1);
      ctx.say(
        "system",
        actor.id,
        `${actor.name} steps in front of the blow meant for ${ward?.name ?? "an ally"} (Resolve ${actor.resource}).`,
        { kind: "intercept", actorId: actor.id, cardId: card.id, protectedId },
      );
      return;
    }
    default:
      throw new Error(`${action} isn't a Reaction`);
  }
}

// --- for the other areas ----------------------------------------------------

/** Brace (rule 17): halve the next blow and bank a Charge, to CHARGE_MAX. roles.ts returns its rank (2). */
export function brace(ctx: Ctx, actor: Fighter): void {
  const full = actor.charge >= CHARGE_MAX;
  bank(actor);
  ctx.say(
    "action",
    actor.id,
    full
      ? `${actor.name} braces for the next blow; their Charge is already full (${CHARGE_MAX}).`
      : `${actor.name} braces for the next blow and banks a Charge (${actor.charge}).`,
    { kind: "brace", actorId: actor.id, charge: actor.charge },
  );
}

/**
 * The multiplier the actor's action deals at: Chain potency × (1 + relayBonus)
 * × ECHO_POTENCY for an Echo. Reading it spends the Relay bonus.
 */
export function potency(ctx: Ctx, actor: Fighter): number {
  const p = ctx.b.chain.potency * (1 + actor.relayBonus) * (actor.echo ? ECHO_POTENCY : 1);
  actor.relayBonus = 0;
  return p;
}

/**
 * Resonance (rule 14): a hit (a ring weakness, a Broken ring, or Feint; roles.ts
 * decides) refunds one rank, never below 1. Only an actual refund is a jump the
 * strip draws. Returns the rank to reset at.
 */
export function resonance(ctx: Ctx, actor: Fighter, rank: number, hit: boolean): number {
  if (!hit) return rank;
  const to = Math.max(RANK_MIN, rank - 1);
  if (to < rank) {
    ctx.say(
      "system",
      actor.id,
      `It resonates: ${actor.name}'s wait falls a rank, ${rankName(rank)} to ${rankName(to)}.`,
      { kind: "resonance", actorId: actor.id, from: rank, to },
    );
  }
  return to;
}

/** Put `stacks` Exposed stacks on a ring, each naming who set it (rule 16). The event's `stacks` is how many were applied. */
export function applyExposed(ctx: Ctx, ringId: RingId, by: Fighter, stacks: number): void {
  const ring = ctx.ring(ringId);
  for (let i = 0; i < stacks; i++) ring.exposed.push({ appliedBy: by.id });
  ctx.say(
    "system",
    by.id,
    `${by.name} leaves ${stacks} Exposed ${stacks === 1 ? "stack" : "stacks"} on the ${ringId} ring (${ring.exposed.length} there now).`,
    { kind: "exposed", ringId, appliedBy: by.id, spentBy: null, stacks },
  );
}

/**
 * Spend the oldest Exposed stack on a ring (rule 16), recording who set it and
 * who spent it. The event's `stacks` is how many remain. Null if there were none.
 */
export function spendExposed(ctx: Ctx, ringId: RingId, by: Fighter): ExposedStack | null {
  const ring = ctx.ring(ringId);
  const stack = ring.exposed.shift();
  if (!stack) return null;
  ctx.b.spentExposed.push({ ringId, appliedBy: stack.appliedBy, spentBy: by.id });
  const setter = stack.appliedBy === by.id ? "their own" : `${ctx.b.joined[stack.appliedBy] ?? "an ally"}'s`;
  ctx.say(
    "system",
    by.id,
    `${by.name} spends ${setter} Exposed stack on the ${ringId} ring (${ring.exposed.length} left).`,
    { kind: "exposed", ringId, appliedBy: stack.appliedBy, spentBy: by.id, stacks: ring.exposed.length },
  );
  return stack;
}

// --- internals --------------------------------------------------------------

/** Brace's effect, without its narration: braced until their next turn, one more Charge to the cap. */
function bank(f: Fighter): void {
  f.braced = true;
  f.charge = Math.min(CHARGE_MAX, f.charge + 1);
}

/** The person is here: their portrait brightens, the count resets, and an Echo ends at once (rule 8). */
function present(ctx: Ctx, f: Fighter): void {
  f.timeouts = 0;
  f.drifting = false;
  if (f.echo) {
    f.echo = false;
    ctx.say("system", f.id, `${f.name} is back at the table, and the Echo fades.`, { kind: "echo", actorId: f.id, on: false });
  }
}

/** A player turn resolved: one more link, and the potency the next player turn deals at (rule 15). */
function link(ctx: Ctx): void {
  const links = ctx.b.chain.links + 1;
  const bonus = Math.min(CHAIN_CAP, CHAIN_STEP * Math.max(0, links - 1));
  const potency = Math.round((1 + bonus) * 1000) / 1000;
  ctx.b.chain = { links, potency };
  ctx.emit({ kind: "chain", links, potency, broken: false });
}
