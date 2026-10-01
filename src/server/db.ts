// SQLite on the volume (CLAUDE.md rule 7): migrations on open, the boot-time
// close of any fight the last process left open (rule 6), the one-transaction
// write-through of a turn (rule 5), and the reads the routes need. Nothing in
// here is read to decide a move.

import Database from "better-sqlite3";
import { desc, eq, inArray, max, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { BattleStatus, BattleSummary, CharacterInfo, LogEntry, RoleId } from "../shared/protocol.ts";
import type { Effects } from "./rules.ts";
import { battleLog, battleMembers, battles, characters } from "./schema.ts";

/** Short, URL-safe and random: 12 characters of base64url. */
export const newId = (): string => randomBytes(9).toString("base64url");

const RESTART_LINE = "The server restarted; this fight was lost.";

/** A character row as join writes it, keyed by the hashed session. */
export interface CharacterWrite {
  id: string;
  sessionId: string;
  name: string;
  role: RoleId;
}

export type Store = ReturnType<typeof openStore>;

export function openStore(path: string, migrationsFolder: string) {
  mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder });
  sqlite.pragma("foreign_keys = ON");
  sqlite.pragma("journal_mode = WAL");

  const characterColumns = {
    id: characters.id,
    name: characters.name,
    role: characters.role,
    turns: characters.turns,
    damage: characters.damage,
    healing: characters.healing,
    wins: characters.wins,
    losses: characters.losses,
  };
  const logColumns = {
    seq: battleLog.seq,
    tick: battleLog.tick,
    kind: battleLog.kind,
    actorId: battleLog.actorId,
    text: battleLog.text,
  };

  return {
    close(): void {
      sqlite.close();
    },

    /** Rule 6: every fight the last process left open is over, and its log says why. */
    closeLiveBattles(now: number): number {
      return db.transaction((tx) => {
        const live = tx
          .select({ id: battles.id })
          .from(battles)
          .where(inArray(battles.status, ["waiting", "fighting"]))
          .all();
        for (const { id } of live) {
          const last = tx
            .select({ seq: max(battleLog.seq), tick: max(battleLog.tick) })
            .from(battleLog)
            .where(eq(battleLog.battleId, id))
            .get();
          tx.insert(battleLog)
            .values({
              battleId: id,
              seq: (last?.seq ?? 0) + 1,
              tick: last?.tick ?? 0,
              kind: "system",
              actorId: null,
              text: RESTART_LINE,
              createdAt: now,
            })
            .run();
          tx.update(battles).set({ status: "abandoned", endedAt: now }).where(eq(battles.id, id)).run();
        }
        return live.length;
      });
    },

    createBattle(id: string, isPublic: boolean, now: number): void {
      db.insert(battles).values({ id, status: "waiting", isPublic, createdAt: now, endedAt: null }).run();
    },

    /**
     * Rule 5: one turn's durable consequences in one transaction: the
     * character's row (on a join), their seat, the log lines, everyone's
     * running stats and the battle's status. Called before the state is
     * committed to memory or broadcast; if it throws, nothing moved.
     */
    writeStep(battleId: string, fx: Effects, now: number, character: CharacterWrite | null = null): void {
      db.transaction((tx) => {
        if (character) {
          tx.insert(characters)
            .values({ ...character, createdAt: now, updatedAt: now })
            .onConflictDoUpdate({
              target: characters.id,
              set: { name: character.name, role: character.role, updatedAt: now },
            })
            .run();
        }
        if (fx.member) {
          const { characterId, name, role } = fx.member;
          tx.insert(battleMembers)
            .values({ battleId, characterId, name, role, joinedAt: now })
            .onConflictDoUpdate({ target: [battleMembers.battleId, battleMembers.characterId], set: { name, role } })
            .run();
        }
        if (fx.log.length > 0) {
          tx.insert(battleLog)
            .values(fx.log.map((entry) => ({ battleId, ...entry, createdAt: now })))
            .run();
        }
        for (const [id, d] of Object.entries(fx.stats)) {
          tx.update(characters)
            .set({
              turns: sql`${characters.turns} + ${d.turns}`,
              damage: sql`${characters.damage} + ${d.damage}`,
              healing: sql`${characters.healing} + ${d.healing}`,
              wins: sql`${characters.wins} + ${d.wins}`,
              losses: sql`${characters.losses} + ${d.losses}`,
              updatedAt: now,
            })
            .where(eq(characters.id, id))
            .run();
        }
        if (fx.status) {
          const ended = fx.status === "won" || fx.status === "lost" || fx.status === "abandoned";
          tx.update(battles)
            .set({ status: fx.status, endedAt: ended ? now : null })
            .where(eq(battles.id, battleId))
            .run();
        }
      });
    },

    characterBySession(sessionId: string): CharacterInfo | null {
      return db.select(characterColumns).from(characters).where(eq(characters.sessionId, sessionId)).get() ?? null;
    },

    character(id: string): CharacterInfo | null {
      return db.select(characterColumns).from(characters).where(eq(characters.id, id)).get() ?? null;
    },

    battle(id: string): { status: BattleStatus; createdAt: number; endedAt: number | null } | null {
      return (
        db
          .select({ status: battles.status, createdAt: battles.createdAt, endedAt: battles.endedAt })
          .from(battles)
          .where(eq(battles.id, id))
          .get() ?? null
      );
    },

    log(battleId: string): LogEntry[] {
      return db.select(logColumns).from(battleLog).where(eq(battleLog.battleId, battleId)).orderBy(battleLog.seq).all();
    },

    /** The battles a character sat down in, most recently joined first. */
    battlesOf(characterId: string, limit: number): BattleSummary[] {
      return db
        .select({
          battleId: battles.id,
          status: battles.status,
          createdAt: battles.createdAt,
          endedAt: battles.endedAt,
        })
        .from(battleMembers)
        .innerJoin(battles, eq(battles.id, battleMembers.battleId))
        .where(eq(battleMembers.characterId, characterId))
        .orderBy(desc(battleMembers.joinedAt), desc(battles.createdAt))
        .limit(limit)
        .all();
    },
  };
}
