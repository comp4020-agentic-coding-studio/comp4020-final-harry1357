// A whole fight played out on the pure engine (ADR-011), deterministic and
// with no wall clock: the clock is a number this file moves. Each person
// plays a scripted policy (./policies.ts) on their turn, and off it takes the
// Reaction their policy proposes against the card the server names; every
// Echo is played by the engine itself, as it is live (rule 25). Every move a
// person makes goes through checkAction, exactly as a person's does over
// HTTP; a refused one becomes a Brace, as a greyed-out button sends nothing.

import { resolve } from "node:path";
import type { BattleState } from "../../src/shared/protocol.ts";
import type { Policy } from "./policies.ts";

type Any = Record<string, unknown>;
interface Fighter {
  id: string;
  kind: string;
  role: string;
  hp: number;
  maxHp: number;
  echo: boolean;
  counter: number;
  gravity: number;
  braced: boolean;
  warded: boolean;
}
export interface Battle {
  status: string;
  activeId: string | null;
  standing: Fighter[];
  fallen: Fighter[];
  phase: number;
  bossTurns: number;
  log: { seq: number; kind: string; actorId: string | null; text: string }[];
  [k: string]: unknown;
}
interface Event {
  kind: string;
  [k: string]: unknown;
}
interface Step {
  battle: Battle;
  effects: { events: Event[] };
}
interface Clock {
  now: number;
  turnMs: number;
  beatMs?: number;
}
interface Engine {
  createBattle(id: string, isPublic: boolean, now: number): Battle;
  join(b: Battle, who: { id: string; name: string; role: string }, c: Clock): Step;
  seatEcho(b: Battle, who: { id: string; role: string; seatedBy: string }, c: Clock): Step;
  start(b: Battle, by: string, c: Clock): Step;
  act(b: Battle, id: string, action: string, target: string | null, c: Clock): Step;
  advance(b: Battle, c: Clock): Step | null;
  checkAction(b: Battle, id: string, action: unknown, target: unknown): { status: number; error: string } | { action: string; targetId: string | null };
  view(b: Battle, t: { tickMs: number; turnMs: number }): BattleState;
}

export async function engine(): Promise<Engine> {
  return (await import(resolve("src/server/rules.ts"))) as unknown as Engine;
}

export interface Seat {
  role: string;
  /** A person playing this policy; or "echo", an Echo seated by the host. */
  policy: Policy | "echo";
}

export interface Fight {
  outcome: "won" | "lost" | "running";
  bossTurns: number;
  playerTurns: number;
  /** The Orrery turn each phase line was crossed on, by phase number. */
  phases: Record<number, number>;
  /** The highest phase reached. */
  phase: number;
  /** Every seat downed, with the card that downed them, in order (ADR-011: the fight can say what killed you). */
  downs: { id: string; role: string; by: string; turn: number }[];
  /** Every event, for a spec that wants to read one. */
  events: Event[];
  /** How the Orrery ended, as a share of its max HP. */
  orreryShare: number;
  battle: Battle;
}

const VIEW = { tickMs: 0, turnMs: 12_000 };

/** A private room with these seats, the first the host, and its Start. Ids: p0, p1… for people, e0, e1… for Echoes. */
export function seat(e: Engine, seats: Seat[], now: number): Battle {
  const c = { now, turnMs: 12_000, beatMs: 3_000 };
  let b = e.createBattle("difficulty", false, now);
  (b as Any).room = "DIFF1";
  const people = seats.map((s, i) => ({ s, i })).filter(({ s }) => s.policy !== "echo");
  const echoes = seats.map((s, i) => ({ s, i })).filter(({ s }) => s.policy === "echo");
  if (people.length === 0) throw new Error("a table needs a person to host it");
  for (const { s, i } of people) b = e.join(b, { id: `p${i}`, name: `Person ${i}`, role: s.role }, c).battle;
  const host = `p${people[0].i}`;
  for (const { s, i } of echoes) b = e.seatEcho(b, { id: `e${i}`, role: s.role, seatedBy: host }, c).battle;
  return e.start(b, host, c).battle;
}

/** Play a table from its Start to an ending, or `maxBossTurns`. */
export function play(e: Engine, seats: Seat[], maxBossTurns = 120): Fight {
  let now = 50_000_000;
  const c = (): Clock => ({ now, turnMs: 12_000, beatMs: 3_000 });
  let b = seat(e, seats, now);
  const policyOf = new Map<string, Policy>();
  seats.forEach((s, i) => {
    if (s.policy !== "echo") policyOf.set(`p${i}`, s.policy);
  });
  const fight: Fight = { outcome: "running", bossTurns: 0, playerTurns: 0, phases: {}, phase: 1, downs: [], events: [], orreryShare: 1, battle: b };
  let lastCard = "";
  const note = (step: Step) => {
    for (const ev of step.effects.events) {
      fight.events.push(ev);
      if (ev.kind === "phase") fight.phases[Number(ev.phase)] = step.battle.bossTurns;
      if (["revolution", "perihelion", "eclipse", "lunge", "alignment", "retrograde", "gravity"].includes(ev.kind)) lastCard = ev.kind;
      if (ev.kind === "down") {
        const f = step.battle.fallen.find((x) => x.id === ev.actorId);
        fight.downs.push({ id: String(ev.actorId), role: f?.role ?? "?", by: lastCard, turn: step.battle.bossTurns });
      }
      if (ev.kind === "card" || ev.kind === "chain" || ev.kind === "plate") continue;
      const line = step.battle.log.find((l) => l.seq === ev.seq);
      if (line?.kind === "action" && typeof ev.actorId === "string" && ev.actorId !== "orrery") fight.playerTurns++;
    }
    b = step.battle;
  };

  for (let guard = 0; guard < 400_000 && b.status === "fighting" && b.bossTurns < maxBossTurns; guard++) {
    // Off-turn: every person whose policy has a Reaction now takes it, before the clock moves (rule 18).
    let reacted = false;
    for (const [id, policy] of policyOf) {
      if (b.activeId === id) continue;
      if (!b.standing.some((f) => f.id === id)) continue;
      const move = policy.offTurn(e.view(b, VIEW), id);
      if (!move) continue;
      if ("status" in e.checkAction(b, id, move.action, move.targetId)) continue;
      note(e.act(b, id, move.action, move.targetId, c()));
      reacted = true;
      break;
    }
    if (reacted) continue;

    now += 150;
    const up = b.standing.find((f) => f.id === b.activeId);
    const policy = up ? policyOf.get(up.id) : undefined;
    if (up && policy && up.kind === "character" && !up.echo && up.counter === 0) {
      const move = policy.onTurn(e.view(b, VIEW), up.id);
      const ok = "status" in e.checkAction(b, up.id, move.action, move.targetId) ? { action: "brace", targetId: null } : move;
      note(e.act(b, up.id, ok.action, ok.targetId, c()));
      continue;
    }
    const step = e.advance(b, c());
    if (step) note(step);
  }
  fight.outcome = b.status === "won" ? "won" : b.status === "lost" ? "lost" : "running";
  fight.bossTurns = b.bossTurns;
  fight.phase = b.phase;
  const boss = b.standing.find((f) => f.kind === "boss");
  fight.orreryShare = boss ? boss.hp / boss.maxHp : 0;
  fight.battle = b;
  return fight;
}

export const ROLES = ["warden", "mender", "striker", "breaker", "chronist"] as const;

/** ADR-011's thirty-one rooms: every set of distinct roles, one to five seats, in the catalogue's order. */
export function rooms(): string[][] {
  const out: string[][] = [];
  for (let mask = 1; mask < 1 << ROLES.length; mask++) out.push(ROLES.filter((_, i) => mask & (1 << i)));
  return out.sort((x, y) => x.length - y.length);
}
