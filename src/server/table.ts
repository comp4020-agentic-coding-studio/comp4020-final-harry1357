// The live table: every battle in progress, held in this one process, and the
// one clock that moves them. Every change goes the same way through apply():
// write its durable consequences to SQLite, then commit the new state to
// memory, bump the version, and broadcast through the hub (hub.ts), which
// holds the sockets. A failed write throws before anything is committed or
// seen. Area (a) owns this file in phase one-b: rooms (docs/adr/007).

import type { WSContext } from "hono/ws";
import type { ActionId, BattleState, RoleId } from "../shared/protocol.ts";
import { newId, type CharacterWrite, type Store } from "./db.ts";
import { createHub } from "./hub.ts";
import { act, advance, createBattle, isEnded, join, seatEcho, type Battle, type Clock, type Step } from "./rules.ts";
import { archived, view } from "./view.ts";

/** The public raid's permanent room code (rule 23). */
const PUBLIC_CODE = "RAID";

/** How long an ended battle stays in memory before only the database has it. */
const DROP_AFTER_MS = 10 * 60 * 1000;

export type Table = ReturnType<typeof createTable>;

export function createTable(store: Store, turnMs: number, tickMs: number, beatMs?: number) {
  const battles = new Map<string, Battle>();
  /** Hashed session → character, for everyone seated since boot. Only they can be standing. */
  const sessions = new Map<string, string>();
  let publicId: string | null = null;

  const clock = (): Clock => ({ now: Date.now(), turnMs, beatMs });
  const timing = { tickMs, turnMs, beatMs };
  const hub = createHub({
    state: (id) => state(id),
    live: (id) => battles.has(id),
    view: (b) => view(b, timing),
    // Area (a): rooms. Until they're built there are none.
    room: () => null,
  });

  function apply(step: Step, character: CharacterWrite | null = null): Battle {
    const next = step.battle;
    if (step.durable || character) store.writeStep(next.id, step.effects, Date.now(), character);
    next.version += 1;
    battles.set(next.id, next);
    hub.broadcast(next, step.effects.events);
    if (step.effects.status && isEnded(next)) {
      const seated = Object.keys(next.joined).length;
      console.log(`battle ${next.id} ended ${next.status} at tick ${next.tick} (${seated} seated)`);
      if (next.id === publicId) open(true);
    }
    return next;
  }

  function open(isPublic: boolean): string {
    const id = newId();
    const now = Date.now();
    store.createBattle(id, isPublic, now);
    battles.set(id, createBattle(id, isPublic, now));
    if (isPublic) publicId = id;
    return id;
  }

  /** One iteration of the process's one clock, across every battle. */
  function tick(): void {
    const c = clock();
    for (const b of [...battles.values()]) {
      try {
        if (isEnded(b)) {
          if (b.endedAt !== null && c.now - b.endedAt > DROP_AFTER_MS) {
            battles.delete(b.id);
            hub.dropped(b.id);
          }
          continue;
        }
        const step = advance(b, c);
        if (step) apply(step);
      } catch (err) {
        console.error(`battle ${b.id}: the clock failed to move it`, err);
      }
    }
  }

  /** The state of a battle: live from memory, or what the database keeps of one that's over. */
  function state(id: string): BattleState | null {
    const live = battles.get(id);
    if (live) return view(live, timing);
    const row = store.battle(id);
    return row ? archived(id, row, store.log(id), timing) : null;
  }

  return {
    /** The live battle, if this process holds it. */
    get(id: string): Battle | undefined {
      return battles.get(id);
    },

    /** The open public raid and its room code, opening a fresh fight if there's none or it has ended. Area (a): the public raid becomes a permanent room (rule 23). */
    publicRaid(): { battleId: string; code: string } {
      const current = publicId ? battles.get(publicId) : undefined;
      return { battleId: current && !isEnded(current) ? current.id : open(true), code: PUBLIC_CODE };
    },

    create(): string {
      return open(false);
    },

    /** Seat a character (already checked) and write their row in the same transaction. */
    seat(battleId: string, who: CharacterWrite): void {
      const b = battles.get(battleId);
      if (!b) throw new Error(`no live battle ${battleId}`);
      apply(join(b, { id: who.id, name: who.name, role: who.role }, clock()), who);
      sessions.set(who.sessionId, who.id);
    },

    /** The character behind a hashed session, if they've been seated since boot. */
    characterFor(sessionId: string): string | undefined {
      return sessions.get(sessionId);
    },

    /** Seat an Echo (already checked with checkSeatEcho) for `seatedBy`; the Echo's id (rule 25). */
    seatEcho(battleId: string, role: RoleId, seatedBy: string): string {
      const b = battles.get(battleId);
      if (!b) throw new Error(`no live battle ${battleId}`);
      const id = newId();
      apply(seatEcho(b, { id, role, seatedBy }, clock()));
      return id;
    },

    /** A character's turn (already checked); the tick it landed on. */
    act(battleId: string, actorId: string, action: ActionId, targetId: string | null): number {
      const b = battles.get(battleId);
      if (!b) throw new Error(`no live battle ${battleId}`);
      return apply(act(b, actorId, action, targetId, clock())).tick;
    },

    state,

    /** A socket on /ws?battle=<id> or /ws?room=<code>: send the current state and subscribe; false if there's no such thing. */
    watch(query: { battle?: string; room?: string }, ws: WSContext): boolean {
      return hub.open(query, ws);
    },

    unwatch(ws: WSContext): void {
      hub.close(ws);
    },

    start(): NodeJS.Timeout {
      return setInterval(tick, tickMs);
    },
  };
}
