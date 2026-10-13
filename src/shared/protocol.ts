// The wire contract between the one server and every browser at the table.
// Types and display catalogues only. Nothing in this file decides anything:
// turn order, counters, damage and the Orrery's script all live on the server.
// `rank` is here so the client can *label* an action ("a long wait"); the
// client never multiplies it into a counter.

export type RoleId = "bulwark" | "lancer" | "mender" | "herald";
export type ActionId = "strike" | "brace" | "lunge" | "mend" | "hasten";
export type BattleStatus = "waiting" | "fighting" | "won" | "lost" | "abandoned";

export interface ActionInfo {
  id: ActionId;
  label: string;
  /** The rank term in tickSpeed × rank × hasteMultiplier. Display only on the client. */
  rank: number;
  /** "boss" needs no target; "ally" needs a standing character's id (yourself included). */
  target: "boss" | "ally" | "self";
  blurb: string;
}

export interface RoleInfo {
  id: RoleId;
  label: string;
  blurb: string;
  actions: readonly ActionId[];
}

export const ACTIONS: Readonly<Record<ActionId, ActionInfo>> = {
  strike: { id: "strike", label: "Strike", rank: 3, target: "boss", blurb: "Hit the Orrery." },
  brace: {
    id: "brace",
    label: "Brace",
    rank: 2,
    target: "self",
    blurb: "Take half damage until your next turn. A short wait.",
  },
  lunge: {
    id: "lunge",
    label: "Lunge",
    rank: 5,
    target: "boss",
    blurb: "A heavy blow. A long wait before you act again.",
  },
  mend: { id: "mend", label: "Mend", rank: 3, target: "ally", blurb: "Restore an ally's strength." },
  hasten: {
    id: "hasten",
    label: "Hasten",
    rank: 2,
    target: "ally",
    blurb: "An ally's next three waits are halved. Their current wait is not.",
  },
};

export const ROLES: Readonly<Record<RoleId, RoleInfo>> = {
  bulwark: {
    id: "bulwark",
    label: "Bulwark",
    blurb: "Slow and hard to fell.",
    actions: ["strike", "brace"],
  },
  lancer: {
    id: "lancer",
    label: "Lancer",
    blurb: "Hits hardest, waits longest.",
    actions: ["strike", "lunge"],
  },
  mender: {
    id: "mender",
    label: "Mender",
    blurb: "Keeps the table standing.",
    actions: ["strike", "mend"],
  },
  herald: {
    id: "herald",
    label: "Herald",
    blurb: "Quickest to the plate; quickens others.",
    actions: ["strike", "hasten"],
  },
};

export const ROLE_IDS: readonly RoleId[] = ["bulwark", "lancer", "mender", "herald"];

export const BOSS_ID = "orrery";
export const NAME_MAX = 24;

/** One combatant, as the server placed it. */
export interface Token {
  id: string;
  kind: "character" | "boss";
  name: string;
  role: RoleId | "orrery";
  /** Ticks until this combatant reaches the strike plate. 0 = on the plate. */
  counter: number;
  hp: number;
  maxHp: number;
  /** Haste is pending on this combatant's next reset(s). */
  hasted: boolean;
  /** Bracing: takes half damage until its next turn. */
  braced: boolean;
  /** Order of arrival at the table; breaks ties on the same notch. */
  seat: number;
}

export interface LogEntry {
  seq: number;
  tick: number;
  kind: "join" | "action" | "boss" | "timeout" | "down" | "leave" | "end" | "system";
  actorId: string | null;
  text: string;
}

export interface BattleState {
  battleId: string;
  /** Bumped on every broadcast. Two clients holding the same version hold the same state. */
  version: number;
  tick: number;
  /** How long one tick is on this server, in ms: what "within one tick" means here. */
  tickMs: number;
  /** How long a character on the strike plate has before the server holds their turn, in ms. */
  turnMs: number;
  status: BattleStatus;
  /** Whose turn it is, or null while the clock is running. Only the server sets this. */
  activeId: string | null;
  /** Epoch ms when the active character's turn times out; null if nobody human is on the plate. */
  turnDeadline: number | null;
  /** Standing combatants in turn order, as the server decided it. Render in this order. */
  queue: Token[];
  /** Characters who have fallen or left, off the rail. */
  fallen: Token[];
  /** The most recent log lines, oldest first. */
  log: LogEntry[];
}

// --- events ---------------------------------------------------------------
// What happened, as well as what is. Every step the server broadcasts carries
// the events that produced it, in order. An event that wrote a log line
// carries that line's `seq`, and the client writes the line only after the
// event's renderer has shown it (CLAUDE.md rule 11). `plate` (someone reached
// the strike plate) writes no line. Every kind here must have a renderer in
// src/client/battle/registry.ts; spec/shown.test.ts holds both sides.

export const EVENT_KINDS = [
  "join",
  "strike",
  "lunge",
  "brace",
  "mend",
  "hasten",
  "hold",
  "leave",
  "down",
  "eclipse",
  "perihelion",
  "revolution",
  "plate",
  "end",
] as const;

export type EventKind = (typeof EVENT_KINDS)[number];

interface EventBase {
  /** The log line this event wrote; absent for `plate`. */
  seq?: number;
  tick: number;
}

export interface Hit {
  targetId: string;
  amount: number;
}

export type BattleEvent =
  | (EventBase & { kind: "join"; actorId: string; returning: boolean })
  | (EventBase & { kind: "strike"; actorId: string; targetId: typeof BOSS_ID; amount: number })
  | (EventBase & { kind: "lunge"; actorId: string; targetId: typeof BOSS_ID; amount: number })
  | (EventBase & { kind: "brace"; actorId: string })
  | (EventBase & { kind: "mend"; actorId: string; targetId: string; amount: number })
  | (EventBase & { kind: "hasten"; actorId: string; targetId: string })
  | (EventBase & { kind: "hold"; actorId: string })
  | (EventBase & { kind: "leave"; actorId: string })
  | (EventBase & { kind: "down"; actorId: string })
  | (EventBase & { kind: "eclipse"; actorId: typeof BOSS_ID; targetId: string; amount: number })
  | (EventBase & { kind: "perihelion"; actorId: typeof BOSS_ID; hits: Hit[] })
  | (EventBase & { kind: "revolution"; actorId: typeof BOSS_ID; hits: Hit[] })
  | (EventBase & { kind: "plate"; actorId: string })
  | (EventBase & { kind: "end"; outcome: "won" | "lost" | "abandoned" });

/** One member per kind, so this never collapses to `never` (a member whose kind was a pair did). */
export type EventOf<K extends EventKind> = Extract<BattleEvent, { kind: K }>;

/** Every broadcast: the state as it now is, and the events that made it so (empty for a plain tick). */
export type ServerMessage = { type: "state"; battle: BattleState; events: BattleEvent[] };

export interface CharacterInfo {
  id: string;
  name: string;
  role: RoleId;
  turns: number;
  damage: number;
  healing: number;
  wins: number;
  losses: number;
}

export interface BattleSummary {
  battleId: string;
  status: BattleStatus;
  createdAt: number;
  endedAt: number | null;
}

// --- HTTP shapes ------------------------------------------------------------

/** GET /api/raid — the open public raid, for anyone arriving without a link. */
export interface RaidResponse {
  battleId: string;
}

/** POST /api/battles → 201 */
export interface NewBattleResponse {
  battleId: string;
}

/** POST /api/battles/:id/join */
export interface JoinRequest {
  name: string;
  role: RoleId;
}
export interface JoinResponse {
  battleId: string;
  characterId: string;
  character: CharacterInfo;
}

/** POST /api/battles/:id/actions */
export interface ActionRequest {
  action: ActionId;
  targetId?: string;
}
export interface ActionResponse {
  ok: true;
  tick: number;
}

/** GET /api/me */
export interface MeResponse {
  character: CharacterInfo | null;
  /** Battles this character took part in, newest first. */
  battles: BattleSummary[];
}

/** GET /api/battles/:id/log */
export interface LogResponse {
  battleId: string;
  status: BattleStatus;
  entries: LogEntry[];
}

/** Every non-2xx JSON answer. */
export interface ErrorResponse {
  error: string;
}
