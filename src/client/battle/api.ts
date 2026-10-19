// The contract between the battle screen's parts. Effects (src/client/battle/
// registry.ts) only ever talk to the scene, the turn strip and the audio
// through these methods, never through DOM handles. That is what lets the
// conductor run any of them and lets spec/effects.test.ts check every effect's
// reduced-motion variant against a recording stand-in.
//
// STATE methods show what is: a frame, a bar, a number, a mark. They are
// allowed under reduced motion. Each draws a static result, and any movement
// in it (a number rising, a flash fading) is CSS that runs only under
// `prefers-reduced-motion: no-preference`.
//
// MOTION methods only move things, and change no state anyone needs. A
// reduced-motion effect never calls them. The names are fixed, because the
// spec knows them: shake, pushIn, projectile, slash, pulse, spinUp,
// afterimage, and phase two's windUp (anticipation) and hitStop.
//
// Phase two (the overhaul's client): every method below marked "phase two"
// is part of the contract the three areas build against. The scene's and the
// strip's are stubbed until their area fills them in; an effect may call any
// of them now.
import type { ActionId, ActionPreview, BattleState, EventKind, EventOf, Ring, RoleId, Token } from "../../shared/protocol.ts";

/** Which animation a sprite plays. Roles have idle, attack, hurt, down; some have more (sprites.json). */
export type Anim = "idle" | "attack" | "hurt" | "down" | "guard" | "cast" | "special" | "jab";

/**
 * A number by a target. "harm": damage (red on a player, card-white on the
 * Orrery: the scene knows which); "heal": green, with a +; "shield": cyan, a
 * blow a Ward or Bastion took; "resonance": gold, a refunded rank. The scene
 * sizes it by the share of the target's max HP. Never colour alone: each tone
 * has its own glyph or prefix.
 */
export type Tone = "harm" | "heal" | "shield" | "resonance";

/** A status mark on a sprite (phase two). At most four are drawn, each with a ring for how much of it is left. */
export interface StatusMark {
  kind: "braced" | "hasted" | "warded" | "gravity" | "charge" | "relay" | "exposed";
  /** How much of its duration is left, 1 → 0, for the ring; null when it lasts until something happens. */
  left: number | null;
  /** A count drawn on it (Charge 2, Gravity 3), when it has one. */
  count?: number;
}

/** A boss card's moment on the strip (phase two). The card itself is drawn from state; this marks what just happened to it. */
export type CardMoment = "announced" | "resolved" | "spent" | "delayed" | "frozen" | "retargeted" | "cancelled";

export interface SceneApi {
  // --- state ---
  /** Play `anim` on a party sprite (or "orrery"); resolves when a one-shot animation ends. Reduced: its key frame, at once. */
  frame(id: string, anim: Anim): Promise<void>;
  /** Set a combatant's HP bar. */
  hp(id: string, hp: number, maxHp: number): void;
  /** Pop a number by `id`: `[data-number]` with `data-seq` when given, gone after a beat. */
  number(id: string, amount: number, tone: Tone, seq?: number): void;
  /** A hit: a one-frame flash on a sprite, or on the Orrery's rings. */
  hit(id: string): void;
  /** Show or clear a guard on a sprite (Brace). */
  guard(id: string, on: boolean): void;
  /** Show or clear the hasted mark on a sprite. */
  haste(id: string, on: boolean): void;
  /** Lay a sprite down (its down frame, greyed). */
  down(id: string): void;
  /** Someone takes a seat: their sprite is on the field (an entrance under no-preference). */
  arrive(id: string): void;
  /** Someone steps away: their sprite leaves the field (an exit under no-preference). */
  depart(id: string): void;
  /** The Orrery's state from its HP: which ring segments remain, how fast the rings turn. */
  rings(hp: number, maxHp: number): void;
  /** Highlight a target while a command is being aimed (null clears it). */
  target(id: string | null): void;
  /** A line across the field, such as the battle's outcome; null clears it. */
  banner(text: string | null): void;
  /** Phase two: status marks on a sprite, at most four drawn, each with a duration ring. reconcile() sets them from state too. */
  status(id: string, marks: readonly StatusMark[]): void;
  /** Phase two: the Orrery's rings as the server holds them: shield pips, the weakness once Scanned, Broken, and Exposed stacks in the applier's role colour. */
  ringMarks(rings: readonly Ring[], appliers: Readonly<Record<string, RoleId>>): void;
  /** Phase two: a seat the server plays (an Echo; `seated` when seated on purpose), marked so it can never be taken for a person. From state, persistently. */
  echo(id: string, on: boolean, seated: boolean): void;
  /** Phase two: a drifting seat, dimmed. From state, persistently. */
  drifting(id: string, on: boolean): void;
  /** Phase two: a Ward on a sprite (a shield), shown or cleared. */
  ward(id: string, on: boolean): void;
  /** Phase two: the Orrery's look for its phase. */
  phase(phase: 1 | 2 | 3): void;

  // --- motion ---
  shake(strength: "light" | "heavy"): Promise<void>;
  pushIn(): Promise<void>;
  /** Something crosses from one combatant to another: a spear thrust, a fist, a mote of light. */
  projectile(fromId: string, toId: string, kind: "slash" | "thrust" | "bolt" | "spark"): Promise<void>;
  slash(id: string): Promise<void>;
  /** A pulse sweeps the field from the Orrery outward. */
  pulse(): Promise<void>;
  /** The rings spin up for a moment. */
  spinUp(): Promise<void>;
  afterimage(id: string): Promise<void>;
  /** Phase two: the anticipation, a 200-300 ms wind-up on a sprite before its action lands. */
  windUp(id: string): Promise<void>;
  /** Phase two: the hit-stop, a few frames' freeze on impact. */
  hitStop(): Promise<void>;
}

export interface StripApi {
  // --- state ---
  /** A transient mark on a portrait: "held" when a turn was held, "plate" when it reached the plate, and phase two's moments. */
  flag(id: string, flag: "held" | "plate" | "jump" | "quickened" | "reacted" | "relayed" | "restored"): void;
  /** Phase two: a boss card's moment (announced, landed, passed over, pushed back, frozen, retargeted, cancelled). */
  card(cardId: string, moment: CardMoment): void;
  /** Phase two: the Chain as it now stands: links lit between consecutive player portraits, or broken by a boss turn. */
  chain(links: number, broken: boolean): void;
  /** Phase two: a Resonance, a portrait jumping forward from one rank to another. */
  jump(id: string, from: number, to: number): void;
  /** Phase two: a Retrograde, the slots it turned about (the event's, in the order they stood) visibly flipping, or a Chronist cancelling it. */
  retrograde(flipped: boolean, cancelledBy: string | null, slots?: readonly string[]): void;
  /** Phase two: the Grand Alignment's clock, a card that grows as it nears the wipe. */
  alignment(countdown: number, wipe: boolean): void;
  // --- motion ---
  afterimage(id: string): Promise<void>;
}

export type Cue = "strike" | "hit" | "revolution" | "plate" | "hold";

export interface AudioApi {
  play(cue: Cue): void;
}

export interface EffectContext {
  scene: SceneApi;
  strip: StripApi;
  audio: AudioApi;
  /** prefers-reduced-motion: reduce. The conductor already picked the reduced variant; this is for timing. */
  reduced: boolean;
  /** A pause inside an effect (shortened under reduced motion). */
  wait(ms: number): Promise<void>;
  /** The latest state the server sent: names, HP, who is standing. Read it; never change it. */
  state: BattleState;
  /** Who this page is, if seated: harm to them is drawn as harm to you. */
  me?: string | null;
}

export type Effect<K extends EventKind> = (ctx: EffectContext, event: EventOf<K>) => Promise<void> | void;

/** Every event kind, with how it's shown with motion and without. spec/shown.test.ts and spec/effects.test.ts hold it. */
export type Registry = { readonly [K in EventKind]?: { full: Effect<K>; reduced: Effect<K> } };

/**
 * The state each event's reduced renderer must produce (review F25): entries
 * of [method, ...args], every one of which it must call. Arguments are matched
 * against the event: "me" is its actorId, "target" its targetId, "card" its
 * card's id (or cardId), "ring" its ringId, "*" anything, and every other value
 * is itself. A motion is never a state. spec/effects.test.ts holds it.
 */
export type Expected = { readonly [K in EventKind]?: readonly (readonly [string, ...unknown[]])[] };

/** One area's share of the registry (phase two): its renderers and their declared states. */
export interface AreaRenderers {
  renderers: Registry;
  expected: Expected;
}

// --- the parts main.ts assembles; each area implements one ------------------

/** The sprite manifest, src/assets/sprites.json (scripts/assets/sprites.ts writes it). */
export interface SpriteAnimation {
  frames: number[];
  fps: number;
  loop: boolean;
  /** Only when this animation lives on its own sheet (the derived down frames). */
  sheet?: string;
  cell?: [number, number];
  columns?: number;
  anchor?: [number, number];
}
export interface SpriteRole {
  sheet: string;
  portrait: string;
  cell: [number, number];
  columns: number;
  /** The idle footprint inside a cell, [x, y, w, h]. */
  box: [number, number, number, number];
  /** Where the feet are inside a cell. */
  anchor: [number, number];
  animations: Record<string, SpriteAnimation>;
}
export interface SpriteManifest {
  /** The art faces this way; the party is mirrored on screen to face the Orrery. */
  facing: "left";
  required: string[];
  /** Keyed by sprite name, not role: a role finds its sprite through src/client/sprites.ts (a phase-one shim). */
  roles: Record<string, SpriteRole>;
}

export interface PartsOptions {
  manifest: SpriteManifest;
  /** The Orrery's SVG source, to be inlined so its rings can be turned and its segments shed. */
  orrerySvg: string;
}

/** src/client/scene/scene.ts: the field. */
export interface Scene extends SceneApi {
  /** Make the field match the state: who is there, HP, frames back to idle or down, the rings. Cheap and idempotent: called every tick while nothing is playing. */
  reconcile(state: BattleState, myId: string | null): void;
}

/** src/client/strip/strip.ts: the turn strip. */
export interface Strip extends StripApi {
  /** Draw the queue in the order sent, active first; called on every message, at once. Phase two: and the boss cards, the Chain, the Echo and drifting marks, "YOU in N", all from state. */
  render(state: BattleState, myId: string | null): void;
  /**
   * Phase two: the ghost of a portrait in the slot the server's preview says
   * an action would leave it (state.preview; rule 1: drawn, never computed),
   * or null to clear. Called while a command is hovered or focused.
   */
  preview(actorId: string | null, preview: ActionPreview | null): void;
}

/** src/client/audio/audio.ts. */
export interface Audio extends AudioApi {
  /** Stop everything (the page is going). */
  dispose(): void;
}

/** What the command window is told about your seat (phase two): your token (resource, Charge, Echo), and the server's preview of each action (wait, refusal), or null off-turn. */
export interface SeatInfo {
  token: Token | null;
  preview: Partial<Record<ActionId, ActionPreview>> | null;
}

/** src/client/join/join.ts: the character select. */
export type JoinResult = { ok: true } | { ok: false; error: string };
/**
 * Which door (phase two; rules 22-23): the public raid, a room of your own
 * made as you sit down in it, or a room by its code; or, on a bare battle
 * opened by id (the sensors'), the fight you're looking at. The server's answer
 * decides where each leads; the client never assumes the public raid's code.
 */
export type Door = { kind: "here" } | { kind: "raid" } | { kind: "create" } | { kind: "code"; code: string };
export interface JoinOptions {
  manifest: SpriteManifest;
  onJoin(door: Door, name: string, role: RoleId): Promise<JoinResult>;
}
/** Where the page is now, for the doors: the room it opened, and whether that's the public raid. */
export interface Here {
  code: string | null;
  isPublic: boolean;
}
export interface Join {
  /** Show the select, prefilled from a returning visitor's character and record (their name fixed: rule 24). */
  show(me: import("../../shared/protocol.ts").MeResponse | null, here?: Here): void;
  hide(): void;
  /** The battle is over: say how, and offer the next raid. */
  ended(outcome: "won" | "lost" | "abandoned"): void;
}
