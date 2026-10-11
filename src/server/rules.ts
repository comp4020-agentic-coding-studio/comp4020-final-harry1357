// The battle rules, and nothing else: no database, no sockets, no timers, no
// randomness. Every function takes a Battle and hands back a new one (the input
// is never mutated) plus the durable consequences of the step, so the caller
// can write those through to SQLite before it lets anyone see the new state.
// The caller supplies the time; ids are minted outside.

import {
  ACTIONS,
  BOSS_ID,
  NAME_MAX,
  ROLE_IDS,
  ROLES,
  type ActionId,
  type BattleState,
  type BattleStatus,
  type LogEntry,
  type RoleId,
  type Token,
} from "../shared/protocol.ts";
import { ATTACK_RANK, counterReset } from "./ctb.ts";

// Server-only numbers. The client sees ranks (protocol.ts) and nothing else.
const ROLE_STATS: Readonly<Record<RoleId, { agility: number; hp: number; strike: number }>> = {
  bulwark: { agility: 30, hp: 160, strike: 14 },
  lancer: { agility: 70, hp: 110, strike: 20 },
  mender: { agility: 50, hp: 100, strike: 10 },
  herald: { agility: 120, hp: 90, strike: 10 },
};
const LUNGE_DAMAGE = 44;
const MEND_AMOUNT = 36;
const HASTED_RESETS = 3;
const ORRERY = {
  name: "The Orrery",
  agility: 40,
  baseHp: 100,
  hpPerCharacter: 140,
  eclipse: 34,
  eclipseBelow: 35, // percent of max hp
  perihelion: 8,
  revolution: 12,
};
/** Consecutive timed-out turns before a character is taken to have left. */
const TIMEOUTS_TO_LEAVE = 2;
/** How many log lines the live state carries; the full log is in SQLite. */
const LOG_TAIL = 50;

export interface Fighter {
  id: string;
  kind: "character" | "boss";
  name: string;
  role: RoleId | "orrery";
  agility: number;
  counter: number;
  hp: number;
  maxHp: number;
  seat: number;
  /** Characters: how many of the next resets are hasted. */
  hasteLeft: number;
  braced: boolean;
  /** Consecutive turns that timed out. */
  timeouts: number;
  /** Why a fighter is off the rail; null while standing. */
  out: "downed" | "left" | null;
}

export interface Battle {
  id: string;
  isPublic: boolean;
  status: BattleStatus;
  /** Bumped by the caller on every broadcast; the rules never touch it. */
  version: number;
  tick: number;
  activeId: string | null;
  turnDeadline: number | null;
  /** Standing combatants, the Orrery included, kept in queue order. */
  standing: Fighter[];
  fallen: Fighter[];
  log: LogEntry[];
  nextSeq: number;
  nextSeat: number;
  /** The Orrery's Perihelion: haste on every reset from then on. */
  enraged: boolean;
  /** Someone has been downed by damage, which turns an empty table into a loss. */
  someoneFell: boolean;
  /** Everyone who has ever joined: character id → name, for the name check. */
  joined: Record<string, string>;
  createdAt: number;
  endedAt: number | null;
}

export interface StatDelta {
  turns: number;
  damage: number;
  healing: number;
  wins: number;
  losses: number;
}

/** What a step changed that has to outlive the process. */
export interface Effects {
  log: LogEntry[];
  stats: Record<string, StatDelta>;
  /** The battle's new status, when this step changed it. */
  status: BattleStatus | null;
  /** A character took (or retook) a seat. */
  member: { characterId: string; name: string; role: RoleId } | null;
}

export interface Step {
  battle: Battle;
  effects: Effects;
  /** False for a plain tick: broadcast it, but there is nothing to write. */
  durable: boolean;
}

export interface Clock {
  now: number;
  turnMs: number;
}

export interface Refusal {
  status: 400 | 403 | 409;
  error: string;
}

// --- validation -------------------------------------------------------------

export const nameKey = (name: string): string => name.trim().toLowerCase();

/** A trimmed name of 1–NAME_MAX characters with no control characters, or null. */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.trim();
  const length = [...name].length;
  if (length < 1 || length > NAME_MAX || /\p{Cc}/u.test(name)) return null;
  return name;
}

export const isRole = (raw: unknown): raw is RoleId => typeof raw === "string" && ROLE_IDS.includes(raw as RoleId);

export const isEnded = (b: Battle): boolean => b.status === "won" || b.status === "lost" || b.status === "abandoned";

export function isStanding(b: Battle, id: string): boolean {
  return b.standing.some((f) => f.id === id && f.kind === "character");
}

/** Why this character can't take a seat, "already" if they're seated, or null to go ahead. */
export function checkJoin(b: Battle, characterId: string | null, name: string): Refusal | "already" | null {
  if (isEnded(b)) return { status: 409, error: "This fight is already over." };
  if (characterId && isStanding(b, characterId)) return "already";
  if (characterId && b.fallen.some((f) => f.id === characterId && f.out === "downed")) {
    return { status: 409, error: "You fell in this fight; you can't take your seat again." };
  }
  const key = nameKey(name);
  for (const [id, taken] of Object.entries(b.joined)) {
    if (id !== characterId && nameKey(taken) === key) {
      return { status: 409, error: "Someone at this table already goes by that name." };
    }
  }
  return null;
}

/** Whether this action may be taken now; the resolved action and target if so. */
export function checkAction(
  b: Battle,
  actorId: string,
  action: unknown,
  targetId: unknown,
): Refusal | { action: ActionId; targetId: string | null } {
  const actor = b.standing.find((f) => f.id === actorId && f.kind === "character");
  if (!actor) return { status: 403, error: "You aren't standing in this fight." };
  if (b.status !== "fighting") return { status: 409, error: "This fight isn't under way." };
  const role = actor.role as RoleId;
  if (typeof action !== "string" || !(ROLES[role].actions as readonly string[]).includes(action)) {
    return { status: 400, error: `A ${ROLES[role].label} can't do that.` };
  }
  const info = ACTIONS[action as ActionId];
  let target: string | null = null;
  if (info.target === "ally") {
    target = targetId === undefined || targetId === null ? actorId : typeof targetId === "string" ? targetId : "";
    if (!isStanding(b, target)) return { status: 400, error: "That ally isn't standing at this table." };
  }
  if (b.activeId !== actorId || actor.counter !== 0) return { status: 409, error: whoseTurn(b, actorId) };
  return { action: info.id, targetId: target };
}

/** Ticks after an action during which a refused one is told who just took the turn. */
const JUST_ACTED_TICKS = 2;

/**
 * What a refused action is told (ADR-005). Two actions for one turn are ordered
 * by the server: whoever it processes first is applied, and the second gets
 * this. The plate may already be empty by then, because the first action reset
 * its actor, so a character who acted in the last couple of ticks is named too.
 */
function whoseTurn(b: Battle, actorId: string): string {
  const up = b.standing.find((f) => f.id === b.activeId);
  if (up && up.id !== actorId) return `It's ${up.name}'s turn.`;
  const last = b.log.findLast((e) => e.kind === "action");
  if (last?.actorId && b.tick - last.tick <= JUST_ACTED_TICKS) {
    return `${b.joined[last.actorId] ?? "Someone"} has just taken this turn.`;
  }
  return "It isn't your turn.";
}

// --- steps ------------------------------------------------------------------

export function createBattle(id: string, isPublic: boolean, now: number): Battle {
  const orrery: Fighter = {
    id: BOSS_ID,
    kind: "boss",
    name: ORRERY.name,
    role: "orrery",
    agility: ORRERY.agility,
    counter: counterReset(ORRERY.agility, "normal"),
    hp: ORRERY.baseHp,
    maxHp: ORRERY.baseHp,
    seat: 0,
    hasteLeft: 0,
    braced: false,
    timeouts: 0,
    out: null,
  };
  return {
    id,
    isPublic,
    status: "waiting",
    version: 0,
    tick: 0,
    activeId: null,
    turnDeadline: null,
    standing: [orrery],
    fallen: [],
    log: [],
    nextSeq: 1,
    nextSeat: 1,
    enraged: false,
    someoneFell: false,
    joined: {},
    createdAt: now,
    endedAt: null,
  };
}

/** Seat a character (already checked with checkJoin). A first join grows the Orrery. */
export function join(b: Battle, who: { id: string; name: string; role: RoleId }, clock: Clock): Step {
  const next = structuredClone(b);
  const fx = noEffects();
  const first = !(who.id in next.joined);
  const stats = ROLE_STATS[who.role];
  const before = next.fallen.find((f) => f.id === who.id);
  next.fallen = next.fallen.filter((f) => f.id !== who.id);
  next.standing.push({
    id: who.id,
    kind: "character",
    name: who.name,
    role: who.role,
    agility: stats.agility,
    counter: counterReset(stats.agility, "normal"),
    // Someone who stepped away comes back as hurt as they left.
    hp: before ? Math.min(before.hp, stats.hp) : stats.hp,
    maxHp: stats.hp,
    seat: next.nextSeat++,
    hasteLeft: 0,
    braced: false,
    timeouts: 0,
    out: null,
  });
  next.joined[who.id] = who.name;
  if (first) {
    const orrery = orreryOf(next);
    orrery.hp += ORRERY.hpPerCharacter;
    orrery.maxHp += ORRERY.hpPerCharacter;
  }
  if (next.status === "waiting") {
    next.status = "fighting";
    fx.status = "fighting";
  }
  fx.member = { characterId: who.id, name: who.name, role: who.role };
  say(
    next,
    fx,
    "join",
    who.id,
    first
      ? `${who.name} the ${ROLES[who.role].label} takes a seat at the table.`
      : `${who.name} returns to the table.`,
  );
  return finish(next, fx, clock);
}

/** A character's turn (already checked with checkAction). */
export function act(b: Battle, actorId: string, action: ActionId, targetId: string | null, clock: Clock): Step {
  const next = structuredClone(b);
  const fx = noEffects();
  const actor = fighter(next, actorId);
  const orrery = orreryOf(next);
  const stats = stat(fx, actorId);
  actor.braced = false; // brace lasts until their next turn, which is now
  actor.timeouts = 0;
  stats.turns += 1;

  switch (action) {
    case "strike": {
      const dealt = wound(orrery, ROLE_STATS[actor.role as RoleId].strike);
      stats.damage += dealt;
      say(next, fx, "action", actorId, `${actor.name} strikes the Orrery for ${dealt}.`);
      break;
    }
    case "lunge": {
      const dealt = wound(orrery, LUNGE_DAMAGE);
      stats.damage += dealt;
      say(next, fx, "action", actorId, `${actor.name} lunges at the Orrery for ${dealt}.`);
      break;
    }
    case "brace":
      actor.braced = true;
      say(next, fx, "action", actorId, `${actor.name} braces for the next blow.`);
      break;
    case "mend": {
      const target = fighter(next, targetId ?? actorId);
      const healed = Math.min(MEND_AMOUNT, target.maxHp - target.hp);
      target.hp += healed;
      stats.healing += healed;
      const whom = target === actor ? "their own wounds" : target.name;
      say(
        next,
        fx,
        "action",
        actorId,
        healed > 0
          ? `${actor.name} mends ${whom} for ${healed}.`
          : `${actor.name} tends to ${whom}, but there is nothing to mend.`,
      );
      break;
    }
    case "hasten": {
      const target = fighter(next, targetId ?? actorId);
      target.hasteLeft = HASTED_RESETS;
      say(
        next,
        fx,
        "action",
        actorId,
        target === actor
          ? `${actor.name} quickens their own step: their next three waits are halved.`
          : `${actor.name} hastens ${target.name}: ${target.name}'s next three waits are halved.`,
      );
      break;
    }
  }

  reset(next, actor, ACTIONS[action].rank);
  return finish(next, fx, clock);
}

/**
 * One iteration of the clock. If someone is on the plate the clock is stopped:
 * the Orrery takes its turn, a character whose time is up has their turn held
 * for them, or nothing happens (null). Otherwise every standing counter drops
 * by exactly 1.
 */
export function advance(b: Battle, clock: Clock): Step | null {
  if (b.status !== "fighting") return null;
  const up = b.standing.find((f) => f.counter === 0);
  if (up) {
    if (up.kind === "boss") return orreryTurn(b, clock);
    if (b.turnDeadline !== null && clock.now > b.turnDeadline) return heldTurn(b, up.id, clock);
    return null;
  }
  const next = structuredClone(b);
  for (const f of next.standing) f.counter -= 1;
  next.tick += 1;
  return finish(next, noEffects(), clock);
}

/** What every client is sent. */
export function view(b: Battle): BattleState {
  const token = (f: Fighter): Token => ({
    id: f.id,
    kind: f.kind,
    name: f.name,
    role: f.role,
    counter: f.counter,
    hp: f.hp,
    maxHp: f.maxHp,
    hasted: f.kind === "boss" ? b.enraged : f.hasteLeft > 0,
    braced: f.braced,
    seat: f.seat,
  });
  return {
    battleId: b.id,
    version: b.version,
    tick: b.tick,
    status: b.status,
    activeId: b.activeId,
    turnDeadline: b.turnDeadline,
    queue: b.standing.map(token),
    fallen: b.fallen.map(token),
    log: b.log.map((entry) => ({ ...entry })),
  };
}

// --- internals --------------------------------------------------------------

function orreryTurn(b: Battle, clock: Clock): Step {
  const next = structuredClone(b);
  const fx = noEffects();
  const orrery = orreryOf(next);
  const party = next.standing.filter((f) => f.kind === "character");

  const low = party
    .filter((f) => f.hp * 100 <= f.maxHp * ORRERY.eclipseBelow)
    .sort((x, y) => x.seat - y.seat)
    .reduce<Fighter | null>((lowest, f) => (!lowest || f.hp * lowest.maxHp < lowest.hp * f.maxHp ? f : lowest), null);

  if (low) {
    const braced = low.braced;
    const taken = harm(low, ORRERY.eclipse);
    say(next, fx, "boss", BOSS_ID, `The Orrery turns: Eclipse — ${taken} to ${low.name}${braced ? ", braced" : ""}.`);
  } else if (orrery.hp * 2 <= orrery.maxHp && !next.enraged) {
    next.enraged = true;
    say(next, fx, "boss", BOSS_ID, `The Orrery turns: Perihelion — it quickens, and ${sweep(party, ORRERY.perihelion)}`);
  } else {
    say(next, fx, "boss", BOSS_ID, `The Orrery turns: Revolution — ${sweep(party, ORRERY.revolution)}`);
  }

  for (const f of party) {
    if (f.hp > 0) continue;
    next.standing = next.standing.filter((s) => s !== f);
    f.out = "downed";
    f.braced = false;
    f.hasteLeft = 0;
    next.fallen.push(f);
    next.someoneFell = true;
    say(next, fx, "down", f.id, `${f.name} falls.`);
  }

  reset(next, orrery, ATTACK_RANK);
  return finish(next, fx, clock);
}

/** Hit everyone standing; the narration of it. */
function sweep(party: Fighter[], amount: number): string {
  const braced = party.filter((f) => f.braced);
  for (const f of party) harm(f, amount);
  const note = braced.length
    ? ` ${listNames(braced)} ${braced.length === 1 ? "was" : "were"} braced and took ${Math.floor(amount / 2)}.`
    : "";
  return `${amount} to everyone standing.${note}`;
}

function heldTurn(b: Battle, id: string, clock: Clock): Step {
  const next = structuredClone(b);
  const fx = noEffects();
  const f = fighter(next, id);
  f.braced = false;
  f.timeouts += 1;
  reset(next, f, ATTACK_RANK);
  say(next, fx, "timeout", id, `${f.name} hesitates, and the turn passes.`);
  if (f.timeouts >= TIMEOUTS_TO_LEAVE) {
    next.standing = next.standing.filter((s) => s !== f);
    f.out = "left";
    f.hasteLeft = 0;
    next.fallen.push(f);
    say(next, fx, "leave", id, `${f.name} has stepped away from the table.`);
  }
  return finish(next, fx, clock);
}

/** Order the rail, end the fight if it's over, and put whoever is on 0 on the plate. */
function finish(b: Battle, fx: Effects, clock: Clock): Step {
  b.standing.sort((x, y) => x.counter - y.counter || x.seat - y.seat);
  if (b.status === "fighting") {
    const party = b.standing.filter((f) => f.kind === "character");
    const outcome: BattleStatus | null =
      orreryOf(b).hp <= 0 ? "won" : party.length === 0 ? (b.someoneFell ? "lost" : "abandoned") : null;
    if (outcome) end(b, fx, outcome, clock.now);
    else settle(b, clock);
  }
  return { battle: b, effects: fx, durable: fx.log.length > 0 || fx.status !== null || fx.member !== null };
}

function settle(b: Battle, clock: Clock): void {
  const up = b.standing.find((f) => f.counter === 0);
  if (!up) {
    b.activeId = null;
    b.turnDeadline = null;
  } else if (b.activeId !== up.id) {
    b.activeId = up.id;
    b.turnDeadline = up.kind === "character" ? clock.now + clock.turnMs : null;
  }
}

function end(b: Battle, fx: Effects, outcome: BattleStatus, now: number): void {
  b.status = outcome;
  fx.status = outcome;
  b.endedAt = now;
  b.activeId = null;
  b.turnDeadline = null;
  // The outcome is credited to everyone who saw it through: standing at the
  // end, or downed on the way. Someone who stepped away gets neither.
  if (outcome === "won" || outcome === "lost") {
    for (const f of [...b.standing, ...b.fallen]) {
      if (f.kind !== "character" || f.out === "left") continue;
      stat(fx, f.id)[outcome === "won" ? "wins" : "losses"] += 1;
    }
  }
  const text =
    outcome === "won"
      ? "The Orrery grinds to a halt. The table wins."
      : outcome === "lost"
        ? "The last of the table has fallen. The Orrery keeps turning."
        : "Nobody is left at the table. The fight is abandoned.";
  say(b, fx, "end", null, text);
}

/** A counter resets to tickSpeed × rank × haste. The only place haste is read. */
function reset(b: Battle, f: Fighter, rank: number): void {
  const hasted = f.kind === "boss" ? b.enraged : f.hasteLeft > 0;
  f.counter = counterReset(f.agility, hasted ? "haste" : "normal", rank);
  if (f.kind === "character" && f.hasteLeft > 0) f.hasteLeft -= 1;
}

/** Damage to the Orrery; what actually came off. */
function wound(orrery: Fighter, amount: number): number {
  const dealt = Math.min(amount, orrery.hp);
  orrery.hp -= dealt;
  return dealt;
}

/** Damage to a character, halved (floor) if braced; what they took. */
function harm(f: Fighter, amount: number): number {
  const taken = f.braced ? Math.floor(amount / 2) : amount;
  f.hp = Math.max(0, f.hp - taken);
  return taken;
}

function say(b: Battle, fx: Effects, kind: LogEntry["kind"], actorId: string | null, text: string): void {
  const entry: LogEntry = { seq: b.nextSeq++, tick: b.tick, kind, actorId, text };
  b.log.push(entry);
  if (b.log.length > LOG_TAIL) b.log.splice(0, b.log.length - LOG_TAIL);
  fx.log.push(entry);
}

function listNames(fs: Fighter[]): string {
  const names = fs.map((f) => f.name);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function noEffects(): Effects {
  return { log: [], stats: {}, status: null, member: null };
}

function stat(fx: Effects, id: string): StatDelta {
  fx.stats[id] ??= { turns: 0, damage: 0, healing: 0, wins: 0, losses: 0 };
  return fx.stats[id];
}

function fighter(b: Battle, id: string): Fighter {
  const f = b.standing.find((s) => s.id === id);
  if (!f) throw new Error(`no standing fighter ${id} in battle ${b.id}`);
  return f;
}

function orreryOf(b: Battle): Fighter {
  return fighter(b, BOSS_ID);
}
