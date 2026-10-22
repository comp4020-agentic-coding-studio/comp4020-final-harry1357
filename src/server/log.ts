// Who did what, on stdout (docs/adr/008, CLAUDE.md rule 32). One line per
// thing that happened, as key=value pairs a terminal tail reads left to right
// and a parser splits on spaces: ts room tick sid name role seat echo action
// target [actor] outcome, then whatever the line is about. `room` is the
// fight's battle id and `code` the room it is in (rule 22), so a line reads by
// either; `echo` is whether an Echo did it (rule 25), true or false, never
// absent on a line about a seat. A value with a space, a
// quote or an equals sign in it is a JSON string, and nothing a terminal would
// act on (a control or bidi character) reaches it unescaped. "-" is no value.
//
// The only writer to stdout. Two places call it, so a change to the rules or
// the events touches this file and no other: the table's emitter (every step
// that changed a fight, a line per event) and the routes' refusal path (a line
// per refused request, on every route: spec/refusals.test.ts). The boot line
// comes from main.ts. A crash's trace goes to stderr.
//
// A person is a session (rule 3), and a line names one by `sid`: the first six
// hex characters of the session's hash, the hash the database keys characters
// by. It is the same for a cookie every time, and this file never sees the
// cookie itself. A value a request sent is written only once the server
// recognises it (a room, a seat, an action, a clean name), so nothing smuggled
// into a request reaches the log.
//
// `actor` says who did it when the person behind `sid` didn't: the Orrery (its
// turn, and everything its turn does), the clock (a turn coming up, a hold, a
// leave), or the server (the process starting, a fight ending).

import { ACTIONS, BOSS_ID, type BattleEvent, type Hit } from "../shared/protocol.ts";
import type { CharacterWrite } from "./db.ts";
import { cleanName, type Battle, type Effects, type Fighter } from "./rules.ts";

type Value = string | number | boolean | null;
type Field = readonly [key: string, value: Value];

interface Line {
  room: string | null;
  /** The room's code, when the fight is a room's (rule 22). */
  code?: string | null;
  tick: number | null;
  /** sid, name, role and seat. */
  who: Field[];
  action: string;
  target: Field[];
  actor?: "orrery" | "clock" | "server" | null;
  outcome: "applied" | "refused";
  extra?: Field[];
}

/** Who each seat is, for everyone seated since boot: only they can act, so only they can be named. */
const seats = new Map<string, { sid: string; name: string; role: string }>();

const sidOf = (session: string): string => Buffer.from(session, "base64url").toString("hex").slice(0, 6);

const BARE = /^[^\s"=\\\p{C}\p{Z}]+$/u;
/** Anything but a plain space that a terminal could act on or hide: controls, bidi marks, line separators. */
const HIDDEN = /(?! )[\p{C}\p{Z}]/gu;

function encode(v: Value): string {
  if (v === null) return "-";
  if (typeof v !== "string") return String(v);
  if (v !== "-" && BARE.test(v)) return v;
  return JSON.stringify(v).replace(HIDDEN, (m) => {
    let out = "";
    for (let i = 0; i < m.length; i++) out += `\\u${m.charCodeAt(i).toString(16).padStart(4, "0")}`;
    return out;
  });
}

function write(l: Line): void {
  const fields: Field[] = [
    ["ts", new Date().toISOString()],
    ["room", l.room],
    ...(l.code !== undefined ? [["code", l.code] as const] : []),
    ["tick", l.tick],
    ...l.who,
    ["action", l.action],
    ...l.target,
    ...(l.actor ? [["actor", l.actor] as const] : []),
    ["outcome", l.outcome],
    ...(l.extra ?? []),
  ];
  // A key twice would parse as one; the later is renamed so neither is lost.
  const used = new Set<string>();
  const parts = fields.map(([k, v]) => {
    const key = used.has(k) ? `${l.action}_${k}` : k;
    used.add(key);
    return `${key}=${encode(v)}`;
  });
  console.log(parts.join(" "));
}

const fighterIn = (b: Battle | undefined, id: unknown): Fighter | undefined =>
  b && typeof id === "string" ? (b.standing.find((f) => f.id === id) ?? b.fallen.find((f) => f.id === id)) : undefined;

/**
 * The seat a line is about: "-" for each field when it's about nobody. `echo`
 * says whether an Echo is that seat now (rule 25: seated on purpose, or a seat
 * left to one, rule 8), so a line is told apart by what did it, not by name.
 */
function who(b: Battle | undefined, id: string | null, sid: string | null = id === null ? null : (seats.get(id)?.sid ?? null)): Field[] {
  const f = fighterIn(b, id);
  const known = id === null ? undefined : seats.get(id);
  return [
    ["sid", sid],
    ["name", f?.name ?? known?.name ?? null],
    ["role", f?.role ?? known?.role ?? null],
    ["seat", id],
    ["echo", f && f.kind === "character" ? f.echo : id === null || id === BOSS_ID ? null : false],
  ];
}

/** A seat a line points at, by id and name; "unknown" for anything the server doesn't recognise. */
function aimed(b: Battle | undefined, id: unknown, key: string, nameKey: string): Field[] {
  if (id === undefined || id === null) return [[key, null]];
  if (id === BOSS_ID) return [[key, BOSS_ID]];
  const name = fighterIn(b, id)?.name ?? (typeof id === "string" ? seats.get(id)?.name : undefined);
  return name === undefined ? [[key, "unknown"]] : [[key, id as string], [nameKey, name]];
}

const snake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);

const scalar = (v: unknown): v is string | number | boolean =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

function event(b: Battle, e: BattleEvent, by: string | null, bossTurn: boolean): void {
  const subject = "actorId" in e ? e.actorId : null;
  const actor =
    subject === null ? "server" : subject === BOSS_ID ? "orrery" : subject === by ? null : bossTurn ? "orrery" : "clock";
  const extra: Field[] = e.seq === undefined ? [] : [["seq", e.seq]];
  // Whatever else the event carries is written as it is, one level deep, so
  // an event added to protocol.ts is logged before this file knows its name.
  for (const [key, v] of Object.entries(e)) {
    if (["kind", "seq", "tick", "actorId", "targetId"].includes(key)) continue;
    if (key === "hits") {
      const hits = (v as Hit[]).map((h) => `${fighterIn(b, h.targetId)?.name ?? h.targetId}:${h.amount}`);
      extra.push(["hits", hits.join(", ")]);
    } else if (key === "outcome") extra.push(["result", v as string]);
    else if (scalar(v)) extra.push([snake(key), v]);
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [sub, w] of Object.entries(v)) if (scalar(w)) extra.push([`${snake(key)}_${snake(sub)}`, w]);
    }
  }
  if (e.kind === "end") extra.push(["seated", Object.keys(b.joined).length]);
  write({
    room: b.id,
    code: b.room,
    tick: e.tick,
    who: who(b, subject),
    action: e.kind,
    target: "hits" in e ? [["target", "party"]] : aimed(b, "targetId" in e ? e.targetId : null, "target", "target_name"),
    actor,
    outcome: "applied",
    extra,
  });
}

/**
 * The emitter's half: a line for every event in a step that changed a fight.
 * `by` is the seat whose request made the step, or null when the clock did.
 */
export function emitted(b: Battle, fx: Effects, by: string | null, seated: CharacterWrite | null): void {
  if (seated) seats.set(seated.id, { sid: sidOf(seated.sessionId), name: seated.name, role: seated.role });
  // A step the clock took with a move of the Orrery's in it is the Orrery's turn, everything in it included.
  const bossTurn = by === null && fx.events.some((e) => e.kind !== "plate" && "actorId" in e && e.actorId === BOSS_ID);
  // On this build a fight begins at its first seat and raises no event of its
  // own for it, so that moment is logged as the pull, after the seat. A build
  // whose rules raise a "pull" event is logged from the event instead.
  const pull = fx.status === "fighting" && !fx.events.some((e) => (e.kind as string) === "pull");
  for (const e of fx.events) {
    event(b, e, by, bossTurn);
    if (pull && e.kind === "join") {
      write({
        room: b.id,
        tick: b.tick,
        who: who(b, BOSS_ID),
        action: "pull",
        target: [["target", null]],
        actor: "orrery",
        outcome: "applied",
        extra: [
          ["seats", b.standing.filter((f) => f.kind === "character").length],
          ["max_hp", fighterIn(b, BOSS_ID)?.maxHp ?? null],
        ],
      });
    }
  }
}

/** The routes a request can be refused on (spec/refusals.test.ts walks them all). */
export type Route = "join" | "action" | "room" | "start" | "leave" | "echo" | "read";

export interface Refused {
  route: Route;
  /** The fight, if this process holds it live. */
  battle: Battle | undefined;
  /** The fight's id if the server knows it, live or over; null otherwise, so an unknown id is never echoed. */
  room: string | null;
  /** The room's code, if the server knows the room; null otherwise, so an unknown code is never echoed. */
  code?: string | null;
  /** The hashed session, if the request carried a cookie. Never the cookie. */
  session: string | null;
  /** The session's own seat, if it has one. */
  seat: string | null;
  /** Who that seat is, when neither this fight nor this process has seated them (a join from an earlier boot). */
  person?: { name: string; role: string };
  /** What the request asked for, as it sent it: written only once recognised. */
  action?: unknown;
  target?: unknown;
  /** A seat the body named that wasn't the session's own (ADR-008). */
  as?: unknown;
  name?: unknown;
  status: number;
  /** What the person was told. */
  reason: string;
}

/** The refusal path's half: one line for a request the server refused, and why. */
export function refused(r: Refused): void {
  const extra: Field[] = [
    ["reason", r.reason],
    ["status", r.status],
  ];
  if (r.as !== undefined) extra.push(...aimed(r.battle, r.as, "as_seat", "as_name"));
  const asked = r.route === "join" ? cleanName(r.name) : null;
  if (asked) extra.push(["asked_name", asked]);
  // The line's action: what was asked, once recognised. A turn action by its name; every other route by its own.
  const action =
    r.route === "action" ? (typeof r.action === "string" && Object.hasOwn(ACTIONS, r.action) ? r.action : "unknown") : r.route;
  const person = who(r.battle, r.seat, r.session === null ? null : sidOf(r.session)).map(([k, v]): Field =>
    v === null && r.person && (k === "name" || k === "role") ? [k, r.person[k]] : [k, v],
  );
  write({
    room: r.room,
    code: r.code ?? null,
    tick: r.battle?.tick ?? null,
    who: person,
    action,
    target: aimed(r.battle, r.target, "target", "target_name"),
    outcome: "refused",
    extra,
  });
}

/** The process starting, and the fights the last one left open, closed (rule 6). */
export function started(boot: {
  sha: string;
  listen: string;
  database: string;
  tickMs: number;
  turnMs: number;
  closed: string[];
}): void {
  const nobody = who(undefined, null);
  write({
    room: null,
    tick: null,
    who: nobody,
    action: "start",
    target: [["target", null]],
    actor: "server",
    outcome: "applied",
    extra: [
      ["sha", boot.sha],
      ["listen", boot.listen],
      ["db", boot.database],
      ["tick_ms", boot.tickMs],
      ["turn_ms", boot.turnMs],
      ["closed", boot.closed.length],
    ],
  });
  for (const id of boot.closed) {
    write({
      room: id,
      tick: null,
      who: nobody,
      action: "end",
      target: [["target", null]],
      actor: "server",
      outcome: "applied",
      extra: [
        ["result", "abandoned"],
        ["cause", "restart"],
      ],
    });
  }
}
