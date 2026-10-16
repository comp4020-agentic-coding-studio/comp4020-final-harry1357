// The live table: every battle in progress, held in this one process, and the
// one clock that moves them. Every change goes the same way through apply():
// write its durable consequences to SQLite, then commit the new state to
// memory, bump the version, and broadcast through the hub (hub.ts), which
// holds the sockets. A failed write throws before anything is committed or
// seen. Area (a) owns this file in phase one-b: rooms (docs/adr/007).

import type { WSContext } from "hono/ws";
import type { ActionId, BattleState, RoleId, RoomInfo } from "../shared/protocol.ts";
import { newId, type CharacterWrite, type Store } from "./db.ts";
import { createHub } from "./hub.ts";
import { createRooms, hasPerson, PUBLIC_CODE } from "./rooms.ts";
import { act, advance, close, createBattle, isEnded, join, seatEcho, type Battle, type Clock, type Step } from "./rules.ts";
import { ROOM_EMPTY_MS } from "./tuning.ts";
import { archived, view } from "./view.ts";

/** How long an ended battle stays in memory before only the database has it. */
const DROP_AFTER_MS = 10 * 60 * 1000;

export type Table = ReturnType<typeof createTable>;

export function createTable(store: Store, turnMs: number, tickMs: number, beatMs?: number, roomEmptyMs: number = ROOM_EMPTY_MS) {
  const battles = new Map<string, Battle>();
  /** Hashed session → character, for everyone seated since boot. Only they can be standing. */
  const sessions = new Map<string, string>();
  const rooms = createRooms();
  /** Bare battle → since when it has had no person seated (breaker B1). Rooms keep their own. */
  const bareEmptySince = new Map<string, number>();

  const clock = (): Clock => ({ now: Date.now(), turnMs, beatMs });
  const timing = { tickMs, turnMs, beatMs };
  const hub = createHub({
    state: (id) => state(id),
    live: (id) => battles.has(id),
    view: (b) => view(b, timing),
    room: (code) => rooms.get(code),
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
      // A room's fight ends and its next one opens, for the same watchers (rule
      // 24). Not for a room that has just expired: its fight was closed because
      // the room is gone, and a successor would be a fight nobody can reach
      // (review R3, breaker Q8).
      if (next.room !== null && rooms.get(next.room)) {
        const room = rooms.move(next.room, open(next.room), Date.now());
        if (room) hub.moved(room);
      }
    }
    return next;
  }

  /** A fresh fight, in the room with this code if it has one (null: a bare battle). */
  function open(room: string | null): string {
    const id = newId();
    const now = Date.now();
    const isPublic = room === PUBLIC_CODE;
    store.createBattle(id, isPublic, now);
    const battle = createBattle(id, isPublic, now);
    battle.room = room;
    battles.set(id, battle);
    return id;
  }

  /** A room empty for its whole window is gone; its fight, if it isn't over, closes with a line saying why (rule 26). */
  function expire(now: number): void {
    for (const room of rooms.all()) {
      const b = battles.get(room.battleId);
      if (b) rooms.watch(room.code, hasPerson(b), now);
    }
    for (const room of rooms.expired(now, roomEmptyMs)) {
      // Out of the registry first, so the closing fight doesn't open a successor.
      rooms.remove(room.code);
      const b = battles.get(room.battleId);
      try {
        if (b && !isEnded(b)) apply(close(b, "The room closed: nobody had been seated at the table for too long.", clock()));
      } catch (err) {
        console.error(`room ${room.code}: closing its fight failed`, err);
      }
      hub.expired(room.code);
      console.log(`room ${room.code} closed after ${roomEmptyMs}ms empty`);
    }
    // A bare battle (POST /api/battles) is a fight with no code, and goes the
    // same way: one with no person seated for the room window is closed, or it
    // would be a private space nobody minted and nothing ever clears (rule 26;
    // breaker B1).
    for (const b of battles.values()) {
      if (b.room !== null || isEnded(b)) {
        bareEmptySince.delete(b.id);
        continue;
      }
      if (hasPerson(b)) {
        bareEmptySince.delete(b.id);
        continue;
      }
      const since = bareEmptySince.get(b.id) ?? now;
      bareEmptySince.set(b.id, since);
      if (now - since < roomEmptyMs) continue;
      bareEmptySince.delete(b.id);
      try {
        apply(close(b, "The fight closed: nobody had been seated at the table for too long.", clock()));
      } catch (err) {
        console.error(`battle ${b.id}: closing it failed`, err);
      }
    }
  }

  /** One iteration of the process's one clock, across every battle. */
  function tick(): void {
    const c = clock();
    expire(c.now);
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

  // The public raid is a room from boot, so its code answers before anyone asks the door.
  rooms.add(true, Date.now(), open);

  return {
    /** The live battle, if this process holds it. */
    get(id: string): Battle | undefined {
      return battles.get(id);
    },

    /** The public raid's room (rule 23): permanent, and always holding an open fight. */
    publicRaid(): RoomInfo {
      const room = rooms.get(PUBLIC_CODE) as RoomInfo;
      const current = battles.get(room.battleId);
      if (current && !isEnded(current)) return room;
      return rooms.move(PUBLIC_CODE, open(PUBLIC_CODE), Date.now()) as RoomInfo;
    },

    /** A bare battle, in no room. */
    create(): string {
      return open(null);
    },

    /** A seated player's new private room (rule 22). */
    createRoom(): RoomInfo {
      return rooms.add(false, Date.now(), open);
    },

    /** The room with this code (any case), or null. */
    room(code: string): RoomInfo | null {
      return rooms.get(code);
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
