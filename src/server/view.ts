// What every client is sent, and nothing else: the BattleState on the wire,
// built field by field from the server's Battle so nothing the room hasn't
// earned leaks (an unscanned weakness, the Orrery's script). Area (c) owns
// this file in phase one-b (docs/adr/007).
//
// This is also everything an Echo's policy may read (echoes.ts; rule 25: a
// policy never reads anything a player can't see). So whatever a policy
// needs to decide has to be here, in the open, for every client too.

import { ACTIONS, ROLES, type ActionId, type ActionPreview, type BattleState, type BattleStatus, type LogEntry, type RoleId, type Token } from "../shared/protocol.ts";
import { counterReset } from "./ctb.ts";
import { reactionCardOf } from "./economy.ts";
import { alignmentLeft, bastionCard } from "./orrery.ts";
import { previewRank } from "./roles.ts";
import { act, checkAction, echoRolesOpen, plateMs, type Battle, type Fighter } from "./rules.ts";

export interface Timing {
  tickMs: number;
  turnMs: number;
  beatMs?: number;
}

/**
 * Where each turn action would leave whoever is on the plate: the counter it
 * resets to and the slot it lands in, and the refusal the server would give.
 * An action the server would take is played on a copy (act() never touches
 * its input) at the target it would take, so whatever the action does to its
 * actor first (Haste on yourself halves your own next wait: review T3), or to
 * the strip, is in the preview. One it would refuse is shown at its rank, with
 * everyone else where they are. The server's, so the client's ghost is drawn,
 * never predicted (rule 1).
 */
function preview(b: Battle, turnMs: number): BattleState["preview"] {
  const up = b.standing.find((f) => f.id === b.activeId && f.kind === "character");
  if (!up || b.status !== "fighting") return null;
  const actions: Partial<Record<ActionId, ActionPreview>> = {};
  for (const action of ROLES[up.role as RoleId].actions) {
    if (ACTIONS[action].reaction) continue;
    const { rank, resonance } = previewRank(b, up, action);
    const target = previewTarget(b, up, action);
    const after = target === undefined ? null : played(b, up.id, action, target, turnMs);
    const me = after?.standing.find((f) => f.id === up.id);
    const counter = me ? me.counter : counterReset(up.agility, up.hasteLeft > 0 ? "haste" : "normal", rank);
    const around = after && me ? after.standing : b.standing;
    const slot = around.filter((f) => f.id !== up.id && (f.counter < counter || (f.counter === counter && f.seat < up.seat))).length;
    actions[action] = { counter, slot, resonance, refusal: refusalOf(b, up, action), target: target ?? null };
  }
  return { actorId: up.id, actions };
}

/** The battle after this action, played on a copy; null if playing it threw, so a preview never breaks a broadcast. */
function played(b: Battle, id: string, action: ActionId, target: string | null, turnMs: number): Battle | null {
  try {
    return act(b, id, action, target, { now: Date.now(), turnMs }).battle;
  } catch (err) {
    console.error(`previewing ${action} for ${id} failed`, err);
    return null;
  }
}

/**
 * The target the server would take for this action with none chosen (as it
 * resolves it: yourself, the soonest card it accepts, a ring), or, for an ally
 * action it won't take on yourself (Quicken), the first ally it would;
 * undefined when it would take none.
 */
function previewTarget(b: Battle, up: Fighter, action: ActionId): string | null | undefined {
  const bare = checkAction(b, up.id, action, null);
  if (!("status" in bare)) return bare.targetId;
  if (ACTIONS[action].target !== "ally" || action === "restore") return undefined;
  return b.standing.find((f) => f.kind === "character" && f.id !== up.id && !("status" in checkAction(b, up.id, action, f.id)))?.id;
}

/**
 * Why the server would refuse this action now, or null. An ally action is
 * judged against every ally standing (the server's default target for one is
 * the actor, and Quicken never takes yourself), so it is refused only when no
 * ally could take it; Restore against the fallen, through its own default.
 */
function refusalOf(b: Battle, up: Fighter, action: ActionId): string | null {
  const first = checkAction(b, up.id, action, null);
  if (!("status" in first)) return null;
  if (ACTIONS[action].target === "ally" && action !== "restore") {
    for (const f of b.standing) {
      if (f.kind !== "character" || f.id === up.id) continue;
      if (!("status" in checkAction(b, up.id, action, f.id))) return null;
    }
  }
  return first.error;
}

/** A combatant as every client sees it. */
function token(f: Fighter, b: Battle): Token {
  return {
    id: f.id,
    kind: f.kind,
    name: f.name,
    role: f.role,
    counter: f.counter,
    hp: f.hp,
    maxHp: f.maxHp,
    hasted: f.hasteLeft > 0,
    braced: f.braced,
    seat: f.seat,
    charge: f.charge,
    resource: f.resource,
    gravity: f.gravity,
    drifting: f.drifting,
    echo: f.echo,
    reactionReady: f.reactionReady,
    warded: f.warded,
    seatedBy: f.seatedBy,
    reactionCard: reactionCardOf(b, f),
  };
}

/** What every client is sent about a live battle. */
export function view(b: Battle, timing: Timing): BattleState {
  return {
    battleId: b.id,
    version: b.version,
    tick: b.tick,
    tickMs: timing.tickMs,
    turnMs: timing.turnMs,
    // The plate's real window: an Echo's beat, not the person's turn (review R8).
    plateMs: (() => {
      const up = b.standing.find((f) => f.id === b.activeId);
      return up && up.kind === "character" ? plateMs(up, { now: 0, ...timing }) : null;
    })(),
    status: b.status,
    activeId: b.activeId,
    turnDeadline: b.turnDeadline,
    queue: b.standing.map((f) => token(f, b)),
    fallen: b.fallen.map((f) => token(f, b)),
    log: b.log.map((entry) => ({ ...entry })),
    phase: b.phase,
    // The weakness the room hasn't Scanned stays on the server.
    rings: b.rings.map(({ element: _hidden, ...ring }) => ({ ...ring, exposed: ring.exposed.map((x) => ({ ...x })) })),
    cards: b.cards.map((c) => ({ ...c })),
    chain: { ...b.chain },
    pullSeats: b.pullSeats,
    spentExposed: b.spentExposed.map((x) => ({ ...x })),
    room: b.room ? { code: b.room, isPublic: b.isPublic } : null,
    echoRoles: echoRolesOpen(b),
    preview: preview(b, timing.turnMs),
    alignmentLeft: alignmentLeft(b),
    bastion: b.bastion,
    bastionCard: bastionCard(b),
  };
}

/** What a client is sent about a battle only the database still has: its status and its log, and nothing live. */
export function archived(id: string, row: { status: BattleStatus }, log: LogEntry[], timing: Timing): BattleState {
  return {
    battleId: id,
    version: 0,
    tick: log.at(-1)?.tick ?? 0,
    tickMs: timing.tickMs,
    turnMs: timing.turnMs,
    plateMs: null,
    status: row.status,
    activeId: null,
    turnDeadline: null,
    queue: [],
    fallen: [],
    log,
    phase: 1,
    rings: [],
    cards: [],
    chain: { links: 0, potency: 1 },
    pullSeats: 0,
    spentExposed: [],
    room: null,
    echoRoles: [],
    preview: null,
    alignmentLeft: null,
    bastion: false,
    bastionCard: null,
  };
}
