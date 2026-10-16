// The room registry (docs/adr/007; CLAUDE.md rules 22-24 and 26): a room is a
// short code the server mints, holding one fight at a time. Nothing here
// decides anything about a fight; the table opens fights and moves them. The
// registry only knows which code points at which battle, and since when a
// room has had nobody in it. In memory only: a restart forgets every code.

import { randomInt } from "node:crypto";
import type { RoomInfo } from "../shared/protocol.ts";
import type { Battle } from "./rules.ts";

/** The public raid's permanent room code (rule 23): always open, never expires. */
export const PUBLIC_CODE = "RAID";

/** No 0/O, 1/I: a code is read out loud and typed by hand. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;

interface Room {
  code: string;
  isPublic: boolean;
  battleId: string;
  /** When its current fight last had no person seated in it, or null while one does. */
  emptySince: number | null;
}

/**
 * A code as it is looked up: ASCII letters and digits in any case, and
 * nothing else. Padding isn't trimmed and Unicode isn't case-mapped, so "raıd"
 * (a dotless i) never upper-cases onto RAID (breaker Q1): a code is never
 * guessed at (rule 22). Null for anything that can't be a code.
 */
const normal = (code: string): string | null => (/^[A-Za-z0-9]{1,16}$/.test(code) ? code.toUpperCase() : null);

/** A person's seat: a character that isn't an Echo someone else seated (standing or fallen). */
export const hasPerson = (b: Battle): boolean =>
  [...b.standing, ...b.fallen].some((f) => f.kind === "character" && f.seatedBy === null);

export type Rooms = ReturnType<typeof createRooms>;

export function createRooms() {
  const rooms = new Map<string, Room>();

  function mint(): string {
    for (;;) {
      let code = "";
      for (let i = 0; i < CODE_LENGTH; i++) code += ALPHABET[randomInt(ALPHABET.length)];
      if (code !== PUBLIC_CODE && !rooms.has(code)) return code;
    }
  }

  const info = (r: Room): RoomInfo => ({ code: r.code, isPublic: r.isPublic, battleId: r.battleId });

  return {
    /** Register a room, opening its first fight with `open(code)`. A private room gets a fresh code; the public raid gets its own. */
    add(isPublic: boolean, now: number, open: (code: string) => string): RoomInfo {
      const code = isPublic ? PUBLIC_CODE : mint();
      const room = { code, isPublic, battleId: open(code), emptySince: now };
      rooms.set(code, room);
      return info(room);
    },

    /** The room with this code (any case), or null. */
    get(code: string): RoomInfo | null {
      const key = normal(code);
      const room = key === null ? undefined : rooms.get(key);
      return room ? info(room) : null;
    },

    /** The room's fight is now this one, and it is empty from `now`. */
    move(code: string, battleId: string, now: number): RoomInfo | null {
      const room = rooms.get(code);
      if (!room) return null;
      room.battleId = battleId;
      room.emptySince = now;
      return info(room);
    },

    /** Note whether the room's current fight has a person in it, and when it last didn't. */
    watch(code: string, occupied: boolean, now: number): void {
      const room = rooms.get(code);
      if (!room) return;
      if (occupied) room.emptySince = null;
      else room.emptySince ??= now;
    },

    /** Private rooms that have been empty for at least `emptyMs`. */
    expired(now: number, emptyMs: number): RoomInfo[] {
      return [...rooms.values()]
        .filter((r) => !r.isPublic && r.emptySince !== null && now - r.emptySince >= emptyMs)
        .map(info);
    },

    remove(code: string): void {
      rooms.delete(code);
    },

    /** Every live room. */
    all(): RoomInfo[] {
      return [...rooms.values()].map(info);
    },
  };
}
