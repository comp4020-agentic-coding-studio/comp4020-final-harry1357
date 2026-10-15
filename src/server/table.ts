// The live table: every battle in progress, held in this one process, the one
// clock that moves them, and the sockets watching them. Every change goes the
// same way through apply(): write its durable consequences to SQLite, then
// commit the new state to memory, bump the version, and broadcast. A failed
// write throws before anything is committed or seen.

import type { WSContext } from "hono/ws";
import type { ActionId, BattleEvent, BattleState, ServerMessage } from "../shared/protocol.ts";
import { newId, type CharacterWrite, type Store } from "./db.ts";
import { act, advance, createBattle, isEnded, join, view, type Battle, type Clock, type Step } from "./rules.ts";

/** How long an ended battle stays in memory before only the database has it. */
const DROP_AFTER_MS = 10 * 60 * 1000;

export type Table = ReturnType<typeof createTable>;

export function createTable(store: Store, turnMs: number, tickMs: number) {
  const battles = new Map<string, Battle>();
  const watchers = new Map<string, Set<WSContext>>();
  /** Hashed session → character, for everyone seated since boot. Only they can be standing. */
  const sessions = new Map<string, string>();
  let publicId: string | null = null;

  const clock = (): Clock => ({ now: Date.now(), turnMs });
  const timing = { tickMs, turnMs };

  function apply(step: Step, character: CharacterWrite | null = null): Battle {
    const next = step.battle;
    if (step.durable || character) store.writeStep(next.id, step.effects, Date.now(), character);
    next.version += 1;
    battles.set(next.id, next);
    broadcast(next, step.effects.events);
    if (step.effects.status && isEnded(next)) {
      const seated = Object.keys(next.joined).length;
      console.log(`battle ${next.id} ended ${next.status} at tick ${next.tick} (${seated} seated)`);
      if (next.id === publicId) open(true);
    }
    return next;
  }

  function broadcast(b: Battle, events: BattleEvent[]): void {
    const set = watchers.get(b.id);
    if (!set || set.size === 0) return;
    const message = JSON.stringify({ type: "state", battle: view(b, timing), events } satisfies ServerMessage);
    for (const ws of set) send(ws, message);
  }

  function send(ws: WSContext, message: string): void {
    if (ws.readyState !== 1) return;
    try {
      ws.send(message);
    } catch {
      // a socket closing mid-send; its close event will tidy it away
    }
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
            watchers.delete(b.id);
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
    if (!row) return null;
    const log = store.log(id);
    return {
      battleId: id,
      version: 0,
      tick: log.at(-1)?.tick ?? 0,
      tickMs,
      turnMs,
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
    };
  }

  return {
    /** The live battle, if this process holds it. */
    get(id: string): Battle | undefined {
      return battles.get(id);
    },

    /** The open public raid, opening a fresh one if there's none or it has ended. */
    publicRaid(): string {
      const current = publicId ? battles.get(publicId) : undefined;
      return current && !isEnded(current) ? current.id : open(true);
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

    /** A character's turn (already checked); the tick it landed on. */
    act(battleId: string, actorId: string, action: ActionId, targetId: string | null): number {
      const b = battles.get(battleId);
      if (!b) throw new Error(`no live battle ${battleId}`);
      return apply(act(b, actorId, action, targetId, clock())).tick;
    },

    state,

    /** Send the current state and subscribe; false if there's no such battle. */
    watch(id: string, ws: WSContext): boolean {
      const current = state(id);
      if (!current) return false;
      if (battles.has(id)) {
        let set = watchers.get(id);
        if (!set) watchers.set(id, (set = new Set()));
        set.add(ws);
      }
      send(ws, JSON.stringify({ type: "state", battle: current, events: [] } satisfies ServerMessage));
      return true;
    },

    unwatch(id: string, ws: WSContext): void {
      watchers.get(id)?.delete(ws);
    },

    start(): NodeJS.Timeout {
      return setInterval(tick, tickMs);
    },
  };
}
