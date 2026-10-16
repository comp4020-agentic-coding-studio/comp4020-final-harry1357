// What every client is sent, and nothing else: the BattleState on the wire,
// built field by field from the server's Battle so nothing the room hasn't
// earned leaks (an unscanned weakness, the Orrery's script). Area (c) owns
// this file in phase one-b (docs/adr/007).
//
// This is also everything an Echo's policy may read (echoes.ts; rule 25: a
// policy never reads anything a player can't see). So whatever a policy
// needs to decide has to be here, in the open, for every client too.

import type { BattleState, BattleStatus, LogEntry, Token } from "../shared/protocol.ts";
import { echoRolesOpen, plateMs, type Battle, type Fighter } from "./rules.ts";

export interface Timing {
  tickMs: number;
  turnMs: number;
  beatMs?: number;
}

/** A combatant as every client sees it. */
function token(f: Fighter): Token {
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
    queue: b.standing.map(token),
    fallen: b.fallen.map(token),
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
  };
}
