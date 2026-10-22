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
import {
  act,
  advance,
  close,
  createBattle,
  isEnded,
  isLobby,
  join,
  leave,
  nextFight,
  seatEcho,
  start as startFight,
  type Battle,
  type Clock,
  type Step,
} from "./rules.ts";
import { LOBBY_GRACE_MS, ROOM_EMPTY_MS } from "./tuning.ts";
import { archived, view } from "./view.ts";

/** How long an ended battle stays in memory before only the database has it. DROP_AFTER_MS overrides it. */
export const DROP_AFTER_MS = 10 * 60 * 1000;

export type Table = ReturnType<typeof createTable>;

export function createTable(
  store: Store,
  turnMs: number,
  tickMs: number,
  beatMs?: number,
  roomEmptyMs: number = ROOM_EMPTY_MS,
  dropAfterMs: number = DROP_AFTER_MS,
  lobbyGraceMs: number = LOBBY_GRACE_MS,
) {
  const battles = new Map<string, Battle>();
  /** A private room's ended fights that have left memory, and the room each is behind, while the room is open (breaker B3). */
  const droppedBehind = new Map<string, string>();
  /** Hashed session → character, for everyone seated since boot. Only they can be standing. */
  const sessions = new Map<string, string>();
  const rooms = createRooms();
  /** Bare battle → since when it has had no person seated (breaker B1). Rooms keep their own. */
  const bareEmptySince = new Map<string, number>();
  /**
   * A lobby's presence (ADR-009): room code → character → since when they have
   * had no socket open on the room. A person seated in a lobby who has been
   * away for lobbyGraceMs has left it, and the host passes on (rule 27).
   */
  const away = new Map<string, Map<string, number>>();

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
      // 24), with everyone still standing seated in it again: a private room's
      // lobby, its host the same, or the public raid's next pull (rule 27). Not
      // for a room that has just expired: its fight was closed because the room
      // is gone, and a successor would be a fight nobody can reach (review R3,
      // breaker Q8).
      if (next.room !== null && rooms.get(next.room)) {
        const fresh = battles.get(open(next.room)) as Battle;
        const seated = nextFight(next, fresh, clock());
        store.writeStep(fresh.id, seated.effects, Date.now());
        seated.battle.version += 1;
        battles.set(fresh.id, seated.battle);
        const room = rooms.move(next.room, fresh.id, Date.now());
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
      // The room's gone, so its fights already out of memory are readable by id now (rule 26).
      for (const [id, code] of droppedBehind) if (code === room.code) droppedBehind.delete(id);
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

  /**
   * A lobby seat whose person has had no socket on the room for the grace
   * window has left (rule 27): unseated, and the host passes on. Only lobbies:
   * a running fight keeps its seats (rule 8 covers an absent player there).
   */
  function sweepLobbies(now: number): void {
    for (const room of rooms.all()) {
      const b = battles.get(room.battleId);
      if (!b || !isLobby(b)) {
        away.delete(room.code);
        continue;
      }
      const marks = away.get(room.code) ?? new Map<string, number>();
      away.set(room.code, marks);
      for (const f of b.standing) {
        if (f.kind !== "character" || f.seatedBy !== null) continue;
        const session = [...sessions].find(([, id]) => id === f.id)?.[0];
        if (session !== undefined && hub.watching(room.code, session)) {
          marks.delete(f.id);
          continue;
        }
        const since = marks.get(f.id) ?? now;
        marks.set(f.id, since);
        if (now - since < lobbyGraceMs) continue;
        marks.delete(f.id);
        const current = battles.get(room.battleId);
        const step = current ? leave(current, f.id, clock()) : null;
        if (step) apply(step);
      }
    }
  }

  /** One iteration of the process's one clock, across every battle. */
  function tick(): void {
    const c = clock();
    expire(c.now);
    sweepLobbies(c.now);
    for (const b of [...battles.values()]) {
      try {
        if (isEnded(b)) {
          if (b.endedAt !== null && c.now - b.endedAt > dropAfterMs) {
            // Out of memory, still behind its code while its private room is open.
            if (b.room !== null && !b.isPublic && rooms.get(b.room) !== null) droppedBehind.set(b.id, b.room);
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

  /**
   * A fight of a private room that is still open: reachable only through the
   * room's code (rule 22, "the code is the only key"; review R4), never by its
   * battle id. That holds for the room's finished fights too, whose state
   * carries the open room's code (re-review N1). The public raid isn't a
   * secret, and once a room is gone its fights are readable by id (rule 26).
   * A finished fight that has left memory is still behind its room's code
   * while the room is open (breaker B3).
   */
  function behindCode(battleId: string): boolean {
    const b = battles.get(battleId);
    if (b) return b.room !== null && !b.isPublic && rooms.get(b.room) !== null;
    const code = droppedBehind.get(battleId);
    return code !== undefined && rooms.get(code) !== null;
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

    /** The host's Start (already checked with checkStart): the pull, from the seats present (rule 27). */
    startFight(battleId: string, by: string): void {
      const b = battles.get(battleId);
      if (!b) throw new Error(`no live battle ${battleId}`);
      apply(startFight(b, by, clock()));
    },

    /** A person leaves a lobby (rule 27); false if they weren't seated in one there. */
    leave(battleId: string, id: string): boolean {
      const b = battles.get(battleId);
      const step = b ? leave(b, id, clock()) : null;
      if (!step) return false;
      apply(step);
      return true;
    },

    /** Whether this character holds a seat (standing or fallen) in a live fight other than this one (rule 24). */
    seatedElsewhere(characterId: string, battleId: string): boolean {
      for (const b of battles.values()) {
        if (b.id === battleId || isEnded(b)) continue;
        if ([...b.standing, ...b.fallen].some((f) => f.id === characterId)) return true;
      }
      return false;
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

    /** A socket on /ws?battle=<id> or /ws?room=<code>: send the current state and subscribe; false if there's no such thing. `session` is the cookie's hashed session, for a lobby's presence. */
    watch(query: { battle?: string; room?: string }, ws: WSContext, session: string | null = null): boolean {
      if (query.room === undefined && query.battle !== undefined && behindCode(query.battle)) return false;
      return hub.open(query, ws, session);
    },

    behindCode,

    unwatch(ws: WSContext): void {
      hub.close(ws);
    },

    start(): NodeJS.Timeout {
      return setInterval(tick, tickMs);
    },
  };
}
