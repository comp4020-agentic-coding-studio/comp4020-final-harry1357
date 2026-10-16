// The sockets: who is watching what, and what they're sent. State flows one
// way, server to browser; anything a client sends is ignored. A socket
// watches one battle (/ws?battle=<id>) or one room (/ws?room=<code>), and a
// room's watchers follow it from fight to fight (rule 24; docs/adr/007).
// Area (c) owns this file in phase one-b. The table (table.ts) tells it what
// changed; it never decides anything about a fight.

import type { WSContext } from "hono/ws";
import type { BattleEvent, BattleState, RoomInfo, ServerMessage } from "../shared/protocol.ts";
import type { Battle } from "./rules.ts";

/** What the hub asks the table. */
export interface HubSource {
  /** A battle's state: live from memory, or what the database keeps of one that's over; null if there's none. */
  state(battleId: string): BattleState | null;
  /** Whether this process holds the battle live (only a live one can be subscribed to). */
  live(battleId: string): boolean;
  /** What a live battle's watchers are sent. */
  view(b: Battle): BattleState;
  /** The room with this code now, or null. */
  room(code: string): RoomInfo | null;
}

export type Hub = ReturnType<typeof createHub>;

export function createHub(source: HubSource) {
  const battleWatchers = new Map<string, Set<WSContext>>();

  function send(ws: WSContext, message: string): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(message);
    } catch {
      // a socket closing mid-send; its close event will tidy it away
    }
  }

  const stateMessage = (battle: BattleState, events: BattleEvent[]): string =>
    JSON.stringify({ type: "state", battle, events } satisfies ServerMessage);

  return {
    /**
     * A socket opened on /ws?battle=<id> or /ws?room=<code>: send what is there
     * now and subscribe. False if there's no such battle or room, and the
     * caller closes the socket.
     */
    open(query: { battle?: string; room?: string }, ws: WSContext): boolean {
      if (query.room !== undefined) {
        // Area (c): a room's socket. Until it's built, no room can be watched.
        return false;
      }
      const id = query.battle ?? "";
      const current = source.state(id);
      if (!current) return false;
      if (source.live(id)) {
        let set = battleWatchers.get(id);
        if (!set) battleWatchers.set(id, (set = new Set()));
        set.add(ws);
      }
      send(ws, stateMessage(current, []));
      return true;
    },

    /** A socket closed: let it go, wherever it was watching. */
    close(ws: WSContext): void {
      for (const set of battleWatchers.values()) set.delete(ws);
    },

    /** A battle changed: its new state and the events that made it, to everyone watching it (and, area c, its room). */
    broadcast(b: Battle, events: BattleEvent[]): void {
      const set = battleWatchers.get(b.id);
      if (!set || set.size === 0) return;
      const message = stateMessage(source.view(b), events);
      for (const ws of set) send(ws, message);
    },

    /** A room's fight changed: area (c) tells its watchers, then sends them the new fight. */
    moved(room: RoomInfo): void {
      void room;
    },

    /** A room is gone: area (c) lets its watchers go. */
    expired(code: string): void {
      void code;
    },

    /** A battle left memory: nobody can watch it live any more. */
    dropped(battleId: string): void {
      battleWatchers.delete(battleId);
    },
  };
}
