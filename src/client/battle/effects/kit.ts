// What every effect leans on: reading the server's latest state without
// tripping over a missing token, fencing the scene so one bad call can't stop
// the rest of an effect, and the few role-to-picture choices. No DOM here, so
// the registry stays importable in Node (spec/effects.test.ts).
import type { BattleState, EventKind, EventOf, RoleId, Token } from "../../../shared/protocol.ts";
import type { Anim, EffectContext } from "../api.ts";
import { BOSS_ID } from "../../../shared/protocol.ts";
import { spriteFor } from "../../sprites.ts";

/** The event a renderer for kind K receives. */
export type Ev<K extends EventKind> = EventOf<K>;

/** One renderer variant. Assignable to api.ts's Effect<K>. */
export type Fx<K extends EventKind> = (ctx: EffectContext, event: Ev<K>) => Promise<void> | void;

/** How long a reduced variant holds its key frame before the next event. */
export const HOLD = 160;

// --- the fence ----------------------------------------------------------------

function report(ns: string, prop: PropertyKey, err: unknown): void {
  console.error(`${ns}.${String(prop)} failed inside an effect`, err);
}

/** The same API, but a call that throws or rejects is reported and the effect carries on. */
function fenced<T extends object>(api: T, ns: string): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      if (prop === "then") return undefined;
      return (...args: unknown[]): Promise<unknown> => {
        try {
          const fn: unknown = Reflect.get(api, prop);
          if (typeof fn !== "function") return Promise.resolve();
          return Promise.resolve(fn.apply(api, args)).catch((err: unknown) => report(ns, prop, err));
        } catch (err) {
          report(ns, prop, err);
          return Promise.resolve();
        }
      };
    },
  });
}

/** The context an effect actually draws through. */
export function stage(ctx: EffectContext): EffectContext {
  return {
    ...ctx,
    scene: fenced(ctx.scene, "scene"),
    strip: fenced(ctx.strip, "strip"),
    audio: fenced(ctx.audio, "audio"),
  };
}

/** Wait for `work`, but never longer than `ms` (shortened under reduced motion, like every ctx.wait). */
export function bounded(ctx: EffectContext, work: unknown, ms: number): Promise<unknown> {
  return Promise.race([Promise.resolve(work).catch(() => undefined), ctx.wait(ms)]);
}

// --- reading the state ----------------------------------------------------------

/** A combatant from the latest state, standing or fallen; undefined if it isn't there. */
export function tokenOf(ctx: EffectContext, id: string | undefined): Token | undefined {
  const state = ctx.state as BattleState | undefined;
  if (!state || !id) return undefined;
  return state.queue?.find((t) => t.id === id) ?? state.fallen?.find((t) => t.id === id);
}

export function isStanding(ctx: EffectContext, id: string | undefined): boolean {
  const state = ctx.state as BattleState | undefined;
  return !!id && !!state?.queue?.some((t) => t.id === id);
}

export function roleOf(ctx: EffectContext, id: string | undefined): RoleId | "orrery" | undefined {
  return tokenOf(ctx, id)?.role;
}

/** Set a combatant's bar to what the server says. */
export function showHp(ctx: EffectContext, id: string): void {
  const t = tokenOf(ctx, id);
  if (t) ctx.scene.hp(id, t.hp, t.maxHp);
}

/** The Orrery's rings (and bar, if the scene draws one) from its HP. */
export function showRings(ctx: EffectContext): void {
  const orrery = tokenOf(ctx, BOSS_ID);
  if (!orrery) return;
  ctx.scene.rings(orrery.hp, orrery.maxHp);
  ctx.scene.hp(BOSS_ID, orrery.hp, orrery.maxHp);
}

/** After a one-shot, back to idle, but only for someone still standing (a fallen sprite waits for its down). */
export function rest(ctx: EffectContext, id: string): void {
  if (isStanding(ctx, id)) void ctx.scene.frame(id, "idle");
}

// --- role to picture ----------------------------------------------------------

/** What crosses the field when this role strikes. By the sprite it borrows (src/client/sprites.ts, a phase-one shim). */
export function projectileFor(role: RoleId | "orrery" | undefined): "slash" | "thrust" | "bolt" | "spark" {
  switch (spriteFor(role)) {
    case "lancer":
      return "thrust";
    case "bulwark":
      return "slash";
    case "mender":
      return "spark";
    default:
      return "bolt";
  }
}

/** The casting pose: the Herald sprite's is its special; everyone else's is cast (the scene falls back to idle). */
export function castFor(role: RoleId | "orrery" | undefined): Anim {
  return spriteFor(role) === "herald" ? "special" : "cast";
}
