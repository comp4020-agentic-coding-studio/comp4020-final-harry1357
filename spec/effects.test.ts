import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every effect has a reduced-motion equivalent that still shows the state change
// (CLAUDE.md, "Design: the battle screen"). Effects only ever talk to the scene,
// the turn strip and the audio through methods, so each renderer's reduced
// variant can be run against a recording stand-in: it must change some state
// (an HP bar, a frame, a number, a mark on a portrait) and must not call a
// method that exists only to move things.
// Phase two adds the anticipation and the hit-stop (windUp, hitStop): motion
// too, so never under reduced motion.
const MOTION = new Set(["shake", "pushIn", "projectile", "slash", "pulse", "spinUp", "afterimage", "windUp", "hitStop"]);

type Effect = (ctx: unknown, event: unknown) => unknown;

function recordingContext(reduced: boolean) {
  const calls: string[] = [];
  const made: [string, ...unknown[]][] = [];
  const api = (ns: string) =>
    new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === "then"
            ? undefined
            : (...args: unknown[]) => {
                calls.push(`${ns}.${String(prop)}`);
                made.push([`${ns}.${String(prop)}`, ...args]);
                return Promise.resolve();
              },
      },
    );
  return {
    calls,
    made,
    ctx: { scene: api("scene"), strip: api("strip"), audio: api("audio"), reduced, wait: () => Promise.resolve(), state: STATE, me: "ally-1" },
  };
}

const token = (id: string, kind: string, role: string, hp: number, maxHp: number, seat: number) => ({
  id, kind, name: id, role, counter: seat * 7, hp, maxHp, hasted: false, braced: false, seat, charge: 0, resource: 0,
  gravity: 0, drifting: false, echo: false, reactionReady: true, warded: false, seatedBy: null, reactionCard: null,
});
/** The state the renderers read: two allies, the Orrery, a card on the strip. */
const STATE = {
  battleId: "b", version: 9, tick: 40, tickMs: 150, turnMs: 12_000, plateMs: null, status: "fighting",
  activeId: null, turnDeadline: null,
  queue: [token("ally-1", "character", "warden", 120, 170, 1), token("orrery", "boss", "orrery", 200, 300, 0), token("ally-2", "character", "mender", 80, 100, 2)],
  fallen: [], log: [], phase: 2,
  rings: [
    { id: "outer", pips: 2, maxPips: 4, weakness: "ember", broken: false, exposed: [{ appliedBy: "ally-1" }] },
    { id: "middle", pips: 5, maxPips: 5, weakness: null, broken: false, exposed: [] },
    { id: "inner", pips: 6, maxPips: 6, weakness: null, broken: false, exposed: [] },
  ],
  cards: [{ id: "card-3", intent: "eclipse", targetId: "ally-2", amount: 20, countdown: 1, frozen: false }],
  chain: { links: 2, potency: 1.1 }, pullSeats: 2, spentExposed: [], room: { code: "QZ7MK", isPublic: false },
  echoRoles: ["striker", "breaker", "chronist"], preview: null,
};

/** One event of each kind, carrying every field any kind might need, and the
 *  fields a kind reads differently set for that kind. */
const sample = (kind: string): Record<string, unknown> => ({
  kind,
  seq: 7,
  tick: 40,
  actorId: ["card", "pull", "phase", "break", "revolution", "eclipse", "lunge", "gravity", "perihelion", "retrograde", "alignment"].includes(kind) ? "orrery" : "ally-1",
  targetId: "ally-2",
  amount: 12,
  hits: [
    { targetId: "ally-1", amount: 12 },
    { targetId: "ally-2", amount: 12 },
  ],
  outcome: "won",
  returning: false,
  role: "breaker",
  seatedBy: "ally-1",
  charge: 1,
  timeouts: 1,
  on: true,
  from: 3,
  to: 2,
  links: 3,
  potency: 1.2,
  broken: false,
  ringId: "outer",
  appliedBy: "ally-1",
  spentBy: null,
  stacks: 2,
  action: "intercept",
  cardId: "card-3",
  protectedId: "ally-2",
  exposed: 1,
  weakness: kind === "cleave" ? true : "ember",
  pips: 2,
  countdown: 2,
  toId: "ally-2",
  card: { id: "card-3", intent: "eclipse", targetId: "ally-2", amount: 20, countdown: 1, frozen: false },
  seats: 2,
  maxHp: 300,
  phase: 2,
  by: "ally-1",
  gravity: 2,
  anchoredBy: null,
  lethal: false,
  flipped: true,
  cancelledBy: null,
  wipe: false,
  ...(kind === "finisher" ? { spent: 3 } : kind === "bastion" ? { spent: 2 } : {}),
});

/**
 * An EXPECTED_STATE entry's arguments, resolved against the event: "me" is the
 * event's actor, "target" its targetId, "card" its card's id, "ring" its ring,
 * "*" anything; every other value is itself.
 */
function resolveArg(arg: unknown, e: Record<string, unknown>): unknown {
  if (arg === "me") return e.actorId;
  if (arg === "target") return e.targetId;
  if (arg === "card") return (e.card as { id?: string } | undefined)?.id ?? e.cardId;
  if (arg === "ring") return e.ringId;
  return arg;
}
const matches = (call: [string, ...unknown[]], want: [string, ...unknown[]], e: Record<string, unknown>): boolean =>
  call[0] === want[0] && want.slice(1).every((arg, i) => arg === "*" || Object.is(call[i + 1], resolveArg(arg, e)));

describe("reduced motion", () => {
  it("every effect has a reduced-motion equivalent that still shows the state change", async () => {
    let mod: { RENDERERS?: Record<string, { full?: Effect; reduced?: Effect }> };
    let protocol: { EVENT_KINDS?: readonly string[] };
    try {
      protocol = await import(resolve("src/shared/protocol.ts"));
      mod = await import(resolve("src/client/battle/registry.ts"));
    } catch (err) {
      throw new Error(`the renderer registry (src/client/battle/registry.ts) couldn't be loaded: ${(err as Error).message}`);
    }
    const kinds = protocol.EVENT_KINDS ?? [];
    expect(kinds.length, "src/shared/protocol.ts exports no EVENT_KINDS").toBeGreaterThan(0);
    for (const kind of kinds) {
      const reduced = mod.RENDERERS?.[kind]?.reduced;
      expect(typeof reduced, `"${kind}" has no reduced-motion renderer`).toBe("function");
      const { calls, ctx } = recordingContext(true);
      await Promise.race([
        Promise.resolve((reduced as Effect)(ctx, sample(kind))),
        new Promise((_, reject) => setTimeout(() => reject(new Error(`"${kind}"'s reduced renderer never finished`)), 3_000)),
      ]);
      const moved = calls.filter((c) => MOTION.has(c.split(".")[1]));
      expect(moved, `"${kind}" moves things under reduced motion`).toEqual([]);
      const shown = calls.filter((c) => (c.startsWith("scene.") || c.startsWith("strip.")) && !MOTION.has(c.split(".")[1]));
      expect(shown.length, `"${kind}"'s reduced renderer shows no state change at all`).toBeGreaterThan(0);
    }
  });

  it("every reduced renderer shows the state its event declares, not just any state", async () => {
    // Review F25: "shows some state change" passed a renderer drawing the wrong
    // one (the hold renderer dropped the guard the server had just Braced).
    // Each event declares the state its reduced renderer must produce
    // (EXPECTED_STATE in the registry: [method, ...args], args resolved against
    // the event), and the renderer is held to every entry.
    const mod = (await import(resolve("src/client/battle/registry.ts"))) as {
      RENDERERS?: Record<string, { reduced?: Effect }>;
      EXPECTED_STATE?: Record<string, [string, ...unknown[]][]>;
    };
    const { EVENT_KINDS } = (await import(resolve("src/shared/protocol.ts"))) as { EVENT_KINDS: readonly string[] };
    expect(mod.EXPECTED_STATE, "the registry declares no EXPECTED_STATE").toBeDefined();
    for (const kind of EVENT_KINDS) {
      const expected = mod.EXPECTED_STATE?.[kind];
      expect(expected?.length, `"${kind}" declares no expected state`).toBeGreaterThan(0);
      for (const [method] of expected ?? []) {
        expect(MOTION.has(method.split(".")[1] ?? ""), `"${kind}" declares a motion (${method}) as its state`).toBe(false);
      }
      const reduced = mod.RENDERERS?.[kind]?.reduced;
      expect(typeof reduced, `"${kind}" has no reduced-motion renderer`).toBe("function");
      const { made, ctx } = recordingContext(true);
      const e = sample(kind);
      await (reduced as Effect)(ctx, e);
      for (const want of expected ?? []) {
        expect(made.some((call) => matches(call, want, e)), `"${kind}"'s reduced renderer never made ${JSON.stringify(want)}`).toBe(true);
      }
    }
  });
});
