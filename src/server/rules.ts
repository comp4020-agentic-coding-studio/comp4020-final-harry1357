// The battle rules, and nothing else: no database, no sockets, no timers, no
// randomness. Every function takes a Battle and hands back a new one (the input
// is never mutated) plus the durable consequences of the step, so the caller
// can write those through to SQLite before it lets anyone see the new state.
// The caller supplies the time; ids are minted outside.
//
// This file is the shared core of the overhaul (docs/adr/006): the state, the
// steps, the pull, and the seams. The rules themselves live in three modules,
// each owned by one area and none touching another's:
//
//   economy.ts  ranks, Resonance, Chain, Exposed, Charge, Reactions, timer, Echo
//   roles.ts    the five roles' actions
//   orrery.ts   HP at the pull, phases, rings, and the card script
//
// They meet only through the Battle and Fighter shapes below and the Ctx this
// file hands them. spec/engine.ts names the exports the specs drive.

import {
  ACTIONS,
  BOSS_ID,
  NAME_MAX,
  ROLE_IDS,
  ROLES,
  type ActionId,
  type BattleEvent,
  type BattleState,
  type BattleStatus,
  type BossCard,
  type Chain,
  type LogEntry,
  type Ring,
  type RingId,
  type RoleId,
  type Token,
} from "../shared/protocol.ts";
import { ATTACK_RANK, counterReset } from "./ctb.ts";
import { ECHO_BEAT_MS } from "./tuning.ts";
import * as economy from "./economy.ts";
import * as orrery from "./orrery.ts";
import * as roles from "./roles.ts";

/** How many log lines the live state carries; the full log is in SQLite. */
const LOG_TAIL = 50;
// The pull (docs/adr/006): the Orrery's HP is set once, from the seats present,
// so a room gets a moment to sit down first. The countdown is wall-clock time,
// not ticks (a tick is 150 ms live and 5 ms in a fast spec). It starts at the
// first seat, restarts to PULL_RESTART_MS whenever a new seat joins, and never
// runs past PULL_CAP_MS from the first seat.
export const PULL_RESTART_MS = 10_000;
export const PULL_CAP_MS = 30_000;

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
  /** Consecutive turns that timed out (rule 8). */
  timeouts: number;
  /** Timed out on their last turn: drawn dimmed. */
  drifting: boolean;
  /** Three timeouts in a row: the server plays them until they act (rule 8). */
  echo: boolean;
  /** Banked by Brace, max 3 (rule 17). */
  charge: number;
  /** The role's own resource (resolve, grace, momentum, insight, flux). */
  resource: number;
  /** Gravity stacks from the Orrery's Lunge. */
  gravity: number;
  /** The one Reaction since the last boss turn is unspent (rule 18). */
  reactionReady: boolean;
  /** A Mender's Ward: absorbs the next blow. */
  warded: boolean;
  /** Potency handed on by a Relay, spent on this fighter's next action. */
  relayBonus: number;
  /** Why a fighter is off the rail; null while standing. */
  out: "downed" | "left" | null;
}

/** A ring as the server holds it: the Ring the client sees, plus the weakness it hasn't been shown. */
export interface RingState extends Ring {
  element: NonNullable<Ring["weakness"]>;
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
  /** Someone has been downed by damage, which turns an empty table into a loss. */
  someoneFell: boolean;
  /** Everyone who has ever joined: character id → name, for the name check. */
  joined: Record<string, string>;
  createdAt: number;
  endedAt: number | null;

  // --- the overhaul's state (docs/adr/006) ---
  /** When the pull will happen if nobody else sits down (epoch ms); null before the first seat and once pulled. */
  pullAt: number | null;
  /** The latest the pull can happen: thirty seconds from the first seat (epoch ms). */
  pullCap: number | null;
  /** Seats counted at the pull (an Echo ½); 0 before it (rule 20). */
  pullSeats: number;
  phase: 1 | 2 | 3;
  rings: RingState[];
  /** Boss cards announced and waiting, soonest first (rule 19). */
  cards: BossCard[];
  nextCard: number;
  /** How many boss cards the Orrery has played, for the Grand Alignment's every-4th. */
  bossTurns: number;
  chain: Chain;
  /** Exposed stacks once spent: who set each and who spent it (rule 16). */
  spentExposed: { ringId: RingId; appliedBy: string; spentBy: string }[];
  /** A Bastion stands against the next raid-wide card. */
  bastion: boolean;
  /** The Orrery's script's memory between turns (its rotation, who touched which
   *  card). Opaque here; orrery.ts alone reads and writes it. Never sent. */
  orreryScript: unknown;
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
  /** What happened, in order, for the battle screen; each carries its log line's seq. */
  events: BattleEvent[];
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

/** An event as the rules raise it; say() stamps it with its log line's seq and the tick. */
export type Raised = BattleEvent extends infer E ? (E extends BattleEvent ? Omit<E, "seq" | "tick"> : never) : never;

/**
 * What a rule module gets to work with in one step: the battle it may change
 * (a clone, already), the effects it adds to, and the means to narrate,
 * reset and hurt. Every module changes the battle only through this.
 */
export interface Ctx {
  b: Battle;
  fx: Effects;
  clock: Clock;
  /** One log line and the event it narrates. */
  say(kind: LogEntry["kind"], actorId: string | null, text: string, event: Raised): void;
  /** An event with no log line (card, chain, plate): drawn, not written. */
  emit(event: Raised): void;
  stat(id: string): StatDelta;
  fighter(id: string): Fighter;
  orrery(): Fighter;
  ring(id: RingId): RingState;
  party(): Fighter[];
}

// --- validation -------------------------------------------------------------

export const nameKey = (name: string): string => name.trim().toLowerCase();

/**
 * A trimmed name of 1–NAME_MAX characters with no control characters, or null.
 * Format characters (zero-width spaces and joiners, the soft hyphen, bidi
 * overrides, the byte-order mark: Unicode \p{Cf}) are stripped first: they draw
 * nothing, so a name can't be made unique, or empty, with ones nobody sees
 * (rule 4; review breaker Q1). What's stored is what's compared and shown.
 */
export function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const name = raw.replace(/\p{Cf}/gu, "").trim();
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
  const target = typeof targetId === "string" ? targetId : null;

  // A Reaction is out of turn, against a telegraphed card, once per boss turn (rule 18).
  if (info.reaction) {
    const refused = economy.checkReaction(b, actor, info.id, target);
    return refused ?? { action: info.id, targetId: target };
  }
  if (b.activeId !== actorId || actor.counter !== 0) return { status: 409, error: whoseTurn(b, actorId) };
  const refused = roles.checkAction(b, actor, info.id, target);
  return refused ?? { action: info.id, targetId: roles.resolveTarget(b, actor, info.id, target) };
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
  const boss: Fighter = {
    ...blankFighter(),
    id: BOSS_ID,
    kind: "boss",
    name: orrery.NAME,
    role: "orrery",
    agility: orrery.AGILITY,
    counter: counterReset(orrery.AGILITY, "normal"),
    hp: orrery.orreryHp(1),
    maxHp: orrery.orreryHp(1),
    seat: 0,
    reactionReady: false,
  };
  return {
    id,
    isPublic,
    status: "waiting",
    version: 0,
    tick: 0,
    activeId: null,
    turnDeadline: null,
    standing: [boss],
    fallen: [],
    log: [],
    nextSeq: 1,
    nextSeat: 1,
    someoneFell: false,
    joined: {},
    createdAt: now,
    endedAt: null,
    pullAt: null,
    pullCap: null,
    pullSeats: 0,
    phase: 1,
    rings: orrery.rings(),
    cards: [],
    nextCard: 1,
    bossTurns: 0,
    chain: { links: 0, potency: 1 },
    spentExposed: [],
    bastion: false,
    orreryScript: null,
  };
}

/** Seat a character (already checked with checkJoin). The first seat starts the pull's countdown. */
export function join(b: Battle, who: { id: string; name: string; role: RoleId }, clock: Clock): Step {
  const ctx = context(structuredClone(b), clock);
  const { b: next, fx } = ctx;
  const first = !(who.id in next.joined);
  const stats = roles.STATS[who.role];
  const before = next.fallen.find((f) => f.id === who.id);
  next.fallen = next.fallen.filter((f) => f.id !== who.id);
  next.standing.push({
    ...blankFighter(),
    id: who.id,
    kind: "character",
    name: who.name,
    role: who.role,
    agility: stats.agility,
    // A late joiner enters at the back of the strip, at a rank-3 delay.
    counter: counterReset(stats.agility, "normal", ATTACK_RANK),
    // Someone who stepped away comes back as hurt as they left.
    hp: before ? Math.min(before.hp, stats.hp) : stats.hp,
    maxHp: stats.hp,
    seat: next.nextSeat++,
  });
  next.joined[who.id] = who.name;
  // The pull's countdown starts on the first seat and restarts on each new one,
  // never past the cap; the HP is set when it ends (rule 20).
  if (next.status === "waiting") {
    next.pullCap ??= clock.now + PULL_CAP_MS;
    next.pullAt = Math.min(clock.now + PULL_RESTART_MS, next.pullCap);
  }
  fx.member = { characterId: who.id, name: who.name, role: who.role };
  ctx.say(
    "join",
    who.id,
    first
      ? `${who.name} the ${ROLES[who.role].label} takes a seat at the table.`
      : `${who.name} returns to the table.`,
    { kind: "join", actorId: who.id, returning: !first },
  );
  return finish(ctx);
}

/** A character's action (already checked with checkAction): a turn, or a Reaction out of turn. */
export function act(b: Battle, actorId: string, action: ActionId, targetId: string | null, clock: Clock): Step {
  const ctx = context(structuredClone(b), clock);
  const actor = ctx.fighter(actorId);
  const info = ACTIONS[action];

  if (info.reaction) {
    economy.react(ctx, actor, action, targetId);
    return finish(ctx);
  }

  economy.beforeTurn(ctx, actor, { byPerson: true });
  const { rank } = roles.perform(ctx, actor, action, targetId);
  economy.afterTurn(ctx, actor, action, rank);
  return finish(ctx);
}

/**
 * One iteration of the clock. Before the pull it counts down to it. Once the
 * fight is on: if someone is on the plate the clock is stopped, and the
 * Orrery takes its turn, an Echo is played, a character whose time is up is
 * Braced for, or nothing happens (null). Otherwise every standing counter
 * drops by exactly 1.
 */
export function advance(b: Battle, clock: Clock): Step | null {
  if (b.status === "waiting") {
    if (b.pullAt === null || clock.now < b.pullAt) return null;
    const ctx = context(structuredClone(b), clock);
    pull(ctx);
    return finish(ctx);
  }
  if (b.status !== "fighting") return null;
  const up = b.standing.find((f) => f.counter === 0);
  if (up) {
    const ctx = context(structuredClone(b), clock);
    const f = ctx.fighter(up.id);
    if (f.kind === "boss") {
      orrery.takeTurn(ctx);
      economy.afterBossTurn(ctx);
      reset(ctx.b, ctx.orrery(), ATTACK_RANK);
      return finish(ctx);
    }
    // An Echo waits out its beat for its person (rule 8); then the server plays it.
    if (f.echo) {
      if (b.turnDeadline !== null && clock.now <= b.turnDeadline) return null;
      economy.echoTurn(ctx, f);
      return finish(ctx);
    }
    if (b.turnDeadline !== null && clock.now > b.turnDeadline) {
      economy.timeout(ctx, f);
      return finish(ctx);
    }
    return null;
  }
  const next = structuredClone(b);
  for (const f of next.standing) f.counter -= 1;
  next.tick += 1;
  return finish(context(next, clock));
}

/** The pull: the fight begins, and the Orrery's HP is set from the seats present (rule 20). */
function pull(ctx: Ctx): void {
  const { b } = ctx;
  b.pullAt = null;
  b.pullCap = null;
  b.pullSeats = seatsOf(b);
  const boss = ctx.orrery();
  boss.maxHp = orrery.orreryHp(b.pullSeats);
  boss.hp = boss.maxHp;
  b.status = "fighting";
  ctx.fx.status = "fighting";
  orrery.onPull(ctx);
  ctx.say("system", BOSS_ID, `The Orrery wakes for ${b.pullSeats} at the table.`, {
    kind: "pull",
    actorId: BOSS_ID,
    seats: b.pullSeats,
    maxHp: boss.maxHp,
  });
}

/** What every client is sent. */
export function view(b: Battle, timing: { tickMs: number; turnMs: number }): BattleState {
  const token = (f: Fighter): Token => ({
    id: f.id,
    kind: f.kind,
    name: f.name,
    role: f.role,
    counter: f.counter,
    hp: f.hp,
    maxHp: f.maxHp,
    hasted: f.hasteLeft > 0,
    braced: f.braced,
    seat: f.seat,
    charge: f.charge,
    resource: f.resource,
    gravity: f.gravity,
    drifting: f.drifting,
    echo: f.echo,
    reactionReady: f.reactionReady,
  });
  return {
    battleId: b.id,
    version: b.version,
    tick: b.tick,
    tickMs: timing.tickMs,
    turnMs: timing.turnMs,
    status: b.status,
    activeId: b.activeId,
    turnDeadline: b.turnDeadline,
    queue: b.standing.map(token),
    fallen: b.fallen.map(token),
    log: b.log.map((entry) => ({ ...entry })),
    phase: b.phase,
    // The weakness the room hasn't Scanned stays on the server.
    rings: b.rings.map(({ element: _hidden, ...ring }) => ({ ...ring, exposed: ring.exposed.map((x) => ({ ...x })) })),
    cards: b.cards.map((c) => ({ ...c })),
    chain: { ...b.chain },
    pullSeats: b.pullSeats,
    spentExposed: b.spentExposed.map((x) => ({ ...x })),
  };
}

// --- the engine contract (spec/engine.ts) -----------------------------------

/** Base × seats^0.75 (rule 20). */
export const orreryHp = (seats: number): number => orrery.orreryHp(seats);

/** The seats a room counts as: a person 1, an Echo ½ (rule 20). */
export function seatsOf(b: Battle): number {
  return economy.seatsOf(b.standing.filter((f) => f.kind === "character"));
}

/** Announce a boss card on the strip, as the Orrery's script would (rule 19). */
export function announce(b: Battle, card: Omit<BossCard, "id" | "frozen">): Battle {
  const ctx = context(structuredClone(b), { now: 0, turnMs: 0 });
  orrery.announce(ctx, card);
  return ctx.b;
}

/**
 * Put a fighter on the plate, without running anything there: a test's way to
 * reach "it's X's turn" without playing the fight up to it (spec/engine.ts).
 * The target goes to 0 and everyone else keeps their place: the queue's order,
 * as it stood, is never changed by putting someone on the plate. Subtracting
 * the target's lead and clamping at 1 used to flatten everyone who was ahead of
 * it onto the same notch, where seat order broke the tie and silently
 * reordered them (it swapped a Breaker on 15 behind a Mender on 18).
 */
export function plate(b: Battle, id: string, clock: Clock): Battle {
  const next = structuredClone(b);
  const target = next.standing.find((f) => f.id === id);
  if (!target) throw new Error(`no standing fighter ${id} in battle ${b.id}`);
  const lead = target.counter;
  // Everyone else, in queue order, gets a counter of at least 1 that keeps that order.
  const others = next.standing.filter((f) => f !== target);
  let floor = 0;
  for (const f of others) {
    f.counter = Math.max(f.counter - lead, floor + 1);
    floor = f.counter;
  }
  target.counter = 0;
  next.tick += Math.max(0, lead);
  next.standing.sort((x, y) => x.counter - y.counter || x.seat - y.seat);
  next.activeId = id;
  next.turnDeadline = target.kind !== "character" ? null : clock.now + (target.echo ? ECHO_BEAT_MS : clock.turnMs);
  return next;
}

// --- shared machinery the modules use ---------------------------------------

/** A counter resets to tickSpeed × rank × haste (rule 13). The only place haste is read. */
export function reset(b: Battle, f: Fighter, rank: number): void {
  const r = Math.max(1, Math.min(5, rank));
  f.counter = counterReset(f.agility, f.hasteLeft > 0 ? "haste" : "normal", r);
  if (f.kind === "character" && f.hasteLeft > 0) f.hasteLeft -= 1;
  void b;
}

/** Damage to the Orrery; what actually came off. Crossing a phase line is the Orrery's to say. */
export function wound(ctx: Ctx, amount: number): number {
  const boss = ctx.orrery();
  const dealt = Math.max(0, Math.min(Math.round(amount), boss.hp));
  boss.hp -= dealt;
  orrery.onWound(ctx);
  return dealt;
}

/** Damage to a character: a Ward absorbs it, a Brace halves it (floor). What they took. */
export function harm(f: Fighter, amount: number): number {
  if (f.warded) {
    f.warded = false;
    return 0;
  }
  const taken = f.braced ? Math.floor(amount / 2) : amount;
  f.hp = Math.max(0, f.hp - taken);
  return taken;
}

/** Anyone at 0 HP leaves the rail, downed. */
export function downTheFallen(ctx: Ctx): void {
  for (const f of ctx.party()) {
    if (f.hp > 0) continue;
    ctx.b.standing = ctx.b.standing.filter((s) => s !== f);
    f.out = "downed";
    f.braced = false;
    f.hasteLeft = 0;
    ctx.b.fallen.push(f);
    ctx.b.someoneFell = true;
    ctx.say("down", f.id, `${f.name} falls.`, { kind: "down", actorId: f.id });
  }
}

export function listNames(fs: Fighter[]): string {
  const names = fs.map((f) => f.name);
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

// --- internals --------------------------------------------------------------

function blankFighter(): Omit<Fighter, "id" | "kind" | "name" | "role" | "agility" | "counter" | "hp" | "maxHp" | "seat"> {
  return {
    hasteLeft: 0,
    braced: false,
    timeouts: 0,
    drifting: false,
    echo: false,
    charge: 0,
    resource: 0,
    gravity: 0,
    reactionReady: true,
    warded: false,
    relayBonus: 0,
    out: null,
  };
}

function context(b: Battle, clock: Clock): Ctx {
  const fx = noEffects();
  const fighter = (id: string): Fighter => {
    const f = b.standing.find((s) => s.id === id);
    if (!f) throw new Error(`no standing fighter ${id} in battle ${b.id}`);
    return f;
  };
  const ctx: Ctx = {
    b,
    fx,
    clock,
    say: (kind, actorId, text, event) => say(ctx.b, fx, kind, actorId, text, event),
    emit: (event) => fx.events.push({ ...event, tick: ctx.b.tick } as BattleEvent),
    stat: (id) => stat(fx, id),
    fighter: (id) => {
      const f = ctx.b.standing.find((s) => s.id === id);
      if (!f) throw new Error(`no standing fighter ${id} in battle ${ctx.b.id}`);
      return f;
    },
    orrery: () => ctx.fighter(BOSS_ID),
    ring: (id) => {
      const r = ctx.b.rings.find((x) => x.id === id);
      if (!r) throw new Error(`no ${id} ring`);
      return r;
    },
    party: () => ctx.b.standing.filter((f) => f.kind === "character"),
  };
  void fighter;
  return ctx;
}

/** Order the rail, end the fight if it's over, and put whoever is on 0 on the plate. */
function finish(ctx: Ctx): Step {
  const { b, fx, clock } = ctx;
  b.standing.sort((x, y) => x.counter - y.counter || x.seat - y.seat);
  if (b.status === "fighting") {
    const party = b.standing.filter((f) => f.kind === "character");
    const outcome: BattleStatus | null =
      ctx.orrery().hp <= 0 ? "won" : party.length === 0 ? (b.someoneFell ? "lost" : "abandoned") : null;
    if (outcome) end(b, fx, outcome, clock.now);
    else settle(b, fx, clock);
  }
  return { battle: b, effects: fx, durable: fx.log.length > 0 || fx.status !== null || fx.member !== null };
}

function settle(b: Battle, fx: Effects, clock: Clock): void {
  const up = b.standing.find((f) => f.counter === 0);
  if (!up) {
    b.activeId = null;
    b.turnDeadline = null;
  } else if (b.activeId !== up.id) {
    b.activeId = up.id;
    // A person gets the turn's full time; an Echo gets a short beat for its
    // person to reclaim the seat before the server plays it (rule 8).
    b.turnDeadline = up.kind !== "character" ? null : clock.now + (up.echo ? ECHO_BEAT_MS : clock.turnMs);
    fx.events.push({ kind: "plate", actorId: up.id, tick: b.tick });
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
  say(b, fx, "end", null, text, { kind: "end", outcome: outcome as "won" | "lost" | "abandoned" });
}

/** One log line, and the event it narrates: the screen shows the event, the log reads the line. */
function say(b: Battle, fx: Effects, kind: LogEntry["kind"], actorId: string | null, text: string, event: Raised): void {
  const entry: LogEntry = { seq: b.nextSeq++, tick: b.tick, kind, actorId, text };
  b.log.push(entry);
  if (b.log.length > LOG_TAIL) b.log.splice(0, b.log.length - LOG_TAIL);
  fx.log.push(entry);
  fx.events.push({ ...event, seq: entry.seq, tick: b.tick } as BattleEvent);
}

function noEffects(): Effects {
  return { log: [], events: [], stats: {}, status: null, member: null };
}

function stat(fx: Effects, id: string): StatDelta {
  fx.stats[id] ??= { turns: 0, damage: 0, healing: 0, wins: 0, losses: 0 };
  return fx.stats[id];
}
