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
// afterimage.
import type { BattleState, EventKind, EventOf, RoleId } from "../../shared/protocol.ts";

/** Which animation a sprite plays. Roles have idle, attack, hurt, down; some have more (sprites.json). */
export type Anim = "idle" | "attack" | "hurt" | "down" | "guard" | "cast" | "special";

/** A number by a target: damage taken, or healing. */
export type Tone = "harm" | "heal";

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
}

export interface StripApi {
  // --- state ---
  /** A transient mark on a portrait: "held" when a turn was held, "plate" when it reached the plate. */
  flag(id: string, flag: "held" | "plate"): void;
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
}

export type Effect<K extends EventKind> = (ctx: EffectContext, event: EventOf<K>) => Promise<void> | void;

/** Every event kind, with how it's shown with motion and without. spec/shown.test.ts and spec/effects.test.ts hold it.
 *  Partial for the overhaul's phase one: the server's new events have no renderers yet, and those two specs say which. */
export type Registry = { readonly [K in EventKind]?: { full: Effect<K>; reduced: Effect<K> } };

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
  /** Draw the queue in the order sent, active first; called on every message, at once. */
  render(state: BattleState, myId: string | null): void;
}

/** src/client/audio/audio.ts. */
export interface Audio extends AudioApi {
  /** Stop everything (the page is going). */
  dispose(): void;
}

/** src/client/join/join.ts: the character select. */
export type JoinResult = { ok: true } | { ok: false; error: string };
export interface JoinOptions {
  manifest: SpriteManifest;
  onJoin(name: string, role: RoleId): Promise<JoinResult>;
}
export interface Join {
  /** Show the select, prefilled from a returning visitor's character and record. */
  show(me: import("../../shared/protocol.ts").MeResponse | null): void;
  hide(): void;
  /** The battle is over: say how, and offer the next raid. */
  ended(outcome: "won" | "lost" | "abandoned"): void;
}
