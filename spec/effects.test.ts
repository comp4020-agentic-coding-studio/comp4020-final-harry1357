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

// Phase two's gate, the reviewer's T1: EXPECTED_STATE is declared by the code
// it holds, and its matcher can't name an event's own fields, so the field
// that carries an event's meaning was a wildcard: an Alignment drawn as a wipe
// every time, a Chain always broken, a Retrograde always flipped, an Echo mark
// that never comes off, an empty end banner, a raid-wide blow flashing one
// target, all passed; and full variants weren't run at all. These pins are the
// spec's own, read off each event's fields, for both variants and both of an
// event's branches. "=x" is the event's field x; a function reads the event;
// "hit" stands for every target in the event's hits; ANY_BUT_NULL is anything
// but null or undefined.
const ANY_BUT_NULL = Symbol("any but null");
type Pin = [string, ...unknown[]];
const PINNED: Record<string, { branches: Record<string, unknown>[]; want: Pin[] }> = {
  alignment: { branches: [{}, { countdown: 0, wipe: true }], want: [["strip.alignment", "=countdown", "=wipe"]] },
  chain: { branches: [{}, { links: 0, broken: true }], want: [["strip.chain", "=links", "=broken"]] },
  retrograde: {
    branches: [{ slots: ["ally-1", "ally-2"] }, { flipped: false, cancelledBy: "ally-1", slots: [] }],
    want: [["strip.retrograde", "=flipped", "=cancelledBy", "=slots"]],
  },
  echo: {
    branches: [{}, { on: false }],
    want: [
      ["scene.echo", "me", "=on", "*"],
      ["scene.drifting", "me", "=on"],
      ["strip.flag", "me", (e: Record<string, unknown>) => (e.on ? "held" : "reclaimed")],
    ],
  },
  end: { branches: [{}, { outcome: "lost" }, { outcome: "abandoned" }], want: [["scene.banner", ANY_BUT_NULL]] },
  revolution: { branches: [{}], want: [["scene.hit", "hit"], ["scene.number", "hit", "*", "*"], ["scene.hp", "hit", "*", "*"]] },
  perihelion: { branches: [{}], want: [["scene.hit", "hit"], ["scene.number", "hit", "*", "*"], ["scene.hp", "hit", "*", "*"]] },
};

function pinArg(arg: unknown, e: Record<string, unknown>): unknown {
  if (typeof arg === "function") return (arg as (e: Record<string, unknown>) => unknown)(e);
  if (typeof arg === "string" && arg.startsWith("=")) return e[arg.slice(1)];
  return resolveArg(arg, e);
}
const pinned = (call: [string, ...unknown[]], want: Pin, e: Record<string, unknown>): boolean =>
  call[0] === want[0] &&
  want.slice(1).every((arg, i) => {
    if (arg === "*") return true;
    if (arg === ANY_BUT_NULL) return call[i + 1] !== null && call[i + 1] !== undefined;
    const value = pinArg(arg, e);
    return Array.isArray(value) ? JSON.stringify(call[i + 1]) === JSON.stringify(value) : Object.is(call[i + 1], value);
  });
/** A pin with "hit" in it stands for one pin per target the event hit. */
const expand = (want: Pin, e: Record<string, unknown>): Pin[] =>
  want.includes("hit") ? ((e.hits as { targetId: string }[]) ?? []).map((h) => want.map((a) => (a === "hit" ? h.targetId : a)) as Pin) : [want];

describe("every full renderer draws its event's declared state too (N8)", () => {
  // Phase two's re-review, N8: the 37 kinds without a pin were held only in
  // their reduced variant. The full variant moves, but it lands on the same
  // state, so it is held to the same declaration.
  it("every kind's full renderer makes every call its expected state declares", async () => {
    const mod = (await import(resolve("src/client/battle/registry.ts"))) as {
      RENDERERS: Record<string, { full: Effect }>;
      EXPECTED_STATE: Record<string, [string, ...unknown[]][]>;
    };
    const { EVENT_KINDS } = (await import(resolve("src/shared/protocol.ts"))) as { EVENT_KINDS: readonly string[] };
    const missed: string[] = [];
    for (const kind of EVENT_KINDS) {
      const { made, ctx } = recordingContext(false);
      const e = sample(kind);
      await mod.RENDERERS[kind].full(ctx, e);
      for (const want of mod.EXPECTED_STATE[kind] ?? []) if (!made.some((call) => matches(call, want, e))) missed.push(`${kind}: ${JSON.stringify(want)}`);
    }
    expect(missed, "full renderers that never make their declared state").toEqual([]);
  });

  it("the end's banner says which ending, the same in both variants", async () => {
    // N8 too: the end pin took any banner, so the won line shown for every outcome passed.
    const mod = (await import(resolve("src/client/battle/registry.ts"))) as { RENDERERS: Record<string, { full: Effect; reduced: Effect }> };
    const banner: Record<string, unknown[]> = {};
    for (const outcome of ["won", "lost", "abandoned"]) {
      for (const variant of ["full", "reduced"] as const) {
        const { made, ctx } = recordingContext(variant === "reduced");
        await mod.RENDERERS.end[variant](ctx, { ...sample("end"), outcome });
        (banner[outcome] ??= []).push(made.find((c) => c[0] === "scene.banner")?.[1]);
      }
    }
    for (const [outcome, [full, reduced]] of Object.entries(banner)) {
      expect(typeof full, `${outcome}: a banner, in words`).toBe("string");
      expect(reduced, `${outcome}: the same banner in both variants`).toBe(full);
    }
    expect(new Set(Object.values(banner).map(([full]) => full)).size, "three endings, three banners").toBe(3);
    // And each says its own (the third review's M8: the won and lost lines swapped passed "three distinct").
    expect(banner.won[0], "a win is drawn as a victory").toMatch(/victory/i);
    expect(banner.lost[0], "a loss as a defeat").toMatch(/defeat/i);
    expect(banner.abandoned[0], "an abandoned fight as neither").not.toMatch(/victory|defeat/i);
  });
});

describe("what each event means, drawn in both variants (T1)", () => {
  for (const [kind, { branches, want }] of Object.entries(PINNED)) {
    it(`"${kind}" draws what its fields say, full and reduced, on every branch`, async () => {
      const mod = (await import(resolve("src/client/battle/registry.ts"))) as { RENDERERS: Record<string, { full: Effect; reduced: Effect }> };
      for (const branch of branches) {
        const e = { ...sample(kind), ...branch };
        for (const variant of ["full", "reduced"] as const) {
          const { made, ctx } = recordingContext(variant === "reduced");
          await mod.RENDERERS[kind][variant](ctx, e);
          for (const pin of want.flatMap((w) => expand(w, e))) {
            const shown = pin.map((a) => (typeof a === "function" ? `=> ${String(pinArg(a, e))}` : a === ANY_BUT_NULL ? "(not null)" : a));
            expect(made.some((call) => pinned(call, pin, e)), `"${kind}" (${variant}, ${JSON.stringify(branch)}) never made ${JSON.stringify(shown)}`).toBe(true);
          }
        }
      }
    });
  }
});
