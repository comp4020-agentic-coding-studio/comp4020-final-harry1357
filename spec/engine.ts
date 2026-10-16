import { resolve } from "node:path";

// The battle engine, from the outside. src/server/rules.ts is pure on purpose
// (no database, no sockets, no timers, no randomness: every step takes a
// battle and hands back a new one), so the overhaul's rules can be held
// exactly: a test builds the situation it means (three Gravity stacks, a
// Retrograde card on the strip) and takes one step, instead of playing a live
// fight until the situation happens to come up.
//
// This file is the contract the specs drive, written in their own shapes like
// spec/raid.ts. Each export the engine must provide is named here, and a
// missing one is a failure with its name on it, not a crash, so a red spec
// says what isn't built yet.

export interface Fighter {
  id: string;
  kind: "character" | "boss";
  role: string;
  counter: number;
  hp: number;
  maxHp: number;
  agility: number;
  charge: number;
  resource: number;
  gravity: number;
  timeouts: number;
  echo: boolean;
  braced: boolean;
  reactionReady: boolean;
  /** A Mender's Ward: absorbs the next blow. */
  warded: boolean;
}

export interface Ring {
  id: "outer" | "middle" | "inner";
  pips: number;
  maxPips: number;
  weakness: string | null;
  /** The real weakness, known to the server whether or not it has been Scanned. */
  element: string;
  broken: boolean;
  exposed: { appliedBy: string; spentBy?: string | null }[];
}

export interface Card {
  id: string;
  intent: string;
  targetId: string | null;
  amount: number | null;
  countdown: number;
  frozen: boolean;
}

export interface Battle {
  id: string;
  status: string;
  tick: number;
  activeId: string | null;
  standing: Fighter[];
  fallen: Fighter[];
  phase: number;
  rings: Ring[];
  cards: Card[];
  chain: { links: number; potency: number };
  pullSeats: number;
  log: { kind: string; actorId: string | null; text: string }[];
  /** Exposed stacks once spent, with who set and who spent each (rule 16). */
  spentExposed?: { ringId: string; appliedBy: string; spentBy: string }[];
}

export interface Step {
  battle: Battle;
  effects: {
    events: { kind: string; [field: string]: unknown }[];
    /** What this step adds to each character's record: turns, damage, healing, wins, losses. */
    stats: Record<string, { turns: number; damage: number; healing: number; wins: number; losses: number }>;
  };
}

export interface Clock {
  now: number;
  turnMs: number;
}

export interface Engine {
  createBattle(id: string, isPublic: boolean, now: number): Battle;
  join(b: Battle, who: { id: string; name: string; role: string }, clock: Clock): Step;
  act(b: Battle, actorId: string, action: string, targetId: string | null, clock: Clock): Step;
  advance(b: Battle, clock: Clock): Step | null;
  checkAction(b: Battle, actorId: string, action: unknown, targetId: unknown): { status: number; error: string } | { action: string };
  /** Base × seats^0.75 (rule 20): the Orrery's max HP for a room of this many seats. */
  orreryHp(seats: number): number;
  /** The seats a room counts as at the pull: a person 1, an Echo ½ (rule 20). */
  seatsOf(b: Battle): number;
  /** Announce a boss card on the strip, as the Orrery's script would (rule 19). */
  announce(b: Battle, card: Omit<Card, "id" | "frozen">): Battle;
  /** Put the active fighter on the plate, the way the clock does, without running it there. */
  plate(b: Battle, id: string, clock: Clock): Battle;
  /** What every client is sent: the state on the wire, not the engine's own. */
  view(b: Battle, timing: { tickMs: number; turnMs: number }): Sent;
}

/** The state a client is sent, as far as the specs read it. */
export interface Sent {
  queue: { id: string; [field: string]: unknown }[];
  rings: { id: string; exposed: { appliedBy: string }[] }[];
  /** Exposed stacks once spent, with who set and who spent each (rule 16). */
  spentExposed?: { ringId: string; appliedBy: string; spentBy: string }[];
  [field: string]: unknown;
}

export const sent = (e: Engine, b: Battle): Sent => e.view(b, { tickMs: 150, turnMs: 12_000 });

const REQUIRED = [
  "createBattle",
  "join",
  "act",
  "advance",
  "checkAction",
  "orreryHp",
  "seatsOf",
  "announce",
  "plate",
  "view",
] as const;

/** The engine, or a failure naming what it doesn't export yet. */
export async function engine(): Promise<Engine> {
  let mod: Record<string, unknown>;
  try {
    mod = (await import(resolve("src/server/rules.ts"))) as Record<string, unknown>;
  } catch (err) {
    throw new Error(`the battle engine (src/server/rules.ts) couldn't be loaded: ${(err as Error).message}`);
  }
  const missing = REQUIRED.filter((name) => typeof mod[name] !== "function");
  if (missing.length) {
    throw new Error(`the battle engine doesn't export ${missing.join(", ")} yet (src/server/rules.ts)`);
  }
  return mod as unknown as Engine;
}

export const clock = (now = 1_000_000, turnMs = 12_000): Clock => ({ now, turnMs });

/** A battle with these roles seated, in order, as people, and pulled: the
 *  fight under way and the Orrery's HP set from the seats. Ids are the role
 *  names, numbered. */
export function table(e: Engine, roles: string[], now = 1_000_000): Battle {
  let b = e.createBattle("spec", false, now);
  roles.forEach((role, i) => {
    b = e.join(b, { id: `${role}-${i + 1}`, name: `${role} ${i + 1}`, role }, clock(now)).battle;
  });
  // The pull: a countdown in wall-clock time after the seats (docs/adr/006),
  // then the Orrery's HP is set from whoever is there (rule 20). Run the clock
  // past it, as a real room's would; thirty seconds is the cap.
  for (let at = now; at <= now + 31_000 && b.status !== "fighting"; at += 500) b = e.advance(b, clock(at))?.battle ?? b;
  if (b.status !== "fighting") throw new Error(`the battle never pulled (still ${b.status})`);
  return b;
}

export const fighter = (b: Battle, id: string): Fighter => {
  const f = b.standing.find((s) => s.id === id) ?? b.fallen.find((s) => s.id === id);
  if (!f) throw new Error(`no fighter ${id} in the battle`);
  return f;
};

export const orrery = (b: Battle): Fighter => fighter(b, "orrery");

export const ring = (b: Battle, id: Ring["id"]): Ring => {
  const r = b.rings?.find((x) => x.id === id);
  if (!r) throw new Error(`the battle has no ${id} ring`);
  return r;
};

/** Put `id` on the plate and take one action; the step that follows. */
export function turn(e: Engine, b: Battle, id: string, action: string, target: string | null = null): Step {
  const ready = e.plate(b, id, clock());
  const ok = e.checkAction(ready, id, action, target);
  if ("status" in ok) throw new Error(`${id} couldn't ${action}: ${ok.status} ${ok.error}`);
  return e.act(ready, id, action, target, clock());
}

/** Run the Orrery's next turn: put it on the plate and let the clock take it. */
export function bossTurn(e: Engine, b: Battle): Step {
  const ready = e.plate(b, "orrery", clock());
  const step = e.advance(ready, clock());
  if (!step) throw new Error("the Orrery was on the plate and the clock did nothing");
  return step;
}

export const events = (s: Step, kind: string) => s.effects.events.filter((ev) => ev.kind === kind);

/** The card most recently announced: the one a test just put on the strip.
 *  The Orrery keeps cards of its own there too, sorted by countdown, so a
 *  test can't assume its card is first, or the only one of its intent. */
export function announced(b: Battle): Card {
  const newest = [...b.cards].sort((x, y) => Number(y.id.replace(/\D/g, "")) - Number(x.id.replace(/\D/g, "")))[0];
  if (!newest) throw new Error("no card on the strip");
  return newest;
}
