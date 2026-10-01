// What outlives the process: characters (a session cookie, a name, a role and
// running stats), battles, who sat at which table, and every battle's log.
// Counters, hp and the queue are deliberately absent: a fight lives in memory
// and is never resumed (CLAUDE.md rules 5 and 6). Times are epoch ms.

import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type { BattleStatus, LogEntry, RoleId } from "../shared/protocol.ts";

export const characters = sqliteTable("characters", {
  id: text("id").primaryKey(),
  /** sha256 of the raid_sid cookie, so the database never holds a usable session. */
  sessionId: text("session_id").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").$type<RoleId>().notNull(),
  turns: integer("turns").notNull().default(0),
  damage: integer("damage").notNull().default(0),
  healing: integer("healing").notNull().default(0),
  wins: integer("wins").notNull().default(0),
  losses: integer("losses").notNull().default(0),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const battles = sqliteTable(
  "battles",
  {
    id: text("id").primaryKey(),
    status: text("status").$type<BattleStatus>().notNull(),
    isPublic: integer("is_public", { mode: "boolean" }).notNull(),
    createdAt: integer("created_at").notNull(),
    endedAt: integer("ended_at"),
  },
  (t) => [index("battles_status").on(t.status)],
);

export const battleMembers = sqliteTable(
  "battle_members",
  {
    battleId: text("battle_id")
      .notNull()
      .references(() => battles.id),
    characterId: text("character_id")
      .notNull()
      .references(() => characters.id),
    /** The name and role this character sat down with, here. */
    name: text("name").notNull(),
    role: text("role").$type<RoleId>().notNull(),
    joinedAt: integer("joined_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.characterId] }), index("battle_members_character").on(t.characterId)],
);

export const battleLog = sqliteTable(
  "battle_log",
  {
    battleId: text("battle_id")
      .notNull()
      .references(() => battles.id),
    seq: integer("seq").notNull(),
    tick: integer("tick").notNull(),
    kind: text("kind").$type<LogEntry["kind"]>().notNull(),
    /** A character id, "orrery", or null for the table itself. Not a foreign key. */
    actorId: text("actor_id"),
    text: text("text").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.battleId, t.seq] })],
);
