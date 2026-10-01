import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Every effect has a reduced-motion equivalent that still shows the state change
// (CLAUDE.md, "Design: the battle screen"). Effects only ever talk to the scene,
// the turn strip and the audio through methods, so each renderer's reduced
// variant can be run against a recording stand-in: it must change some state
// (an HP bar, a frame, a number, a mark on a portrait) and must not call a
// method that exists only to move things.
const MOTION = new Set(["shake", "pushIn", "projectile", "slash", "pulse", "spinUp", "afterimage"]);

type Effect = (ctx: unknown, event: unknown) => unknown;

function recordingContext(reduced: boolean) {
  const calls: string[] = [];
  const api = (ns: string) =>
    new Proxy(
      {},
      {
        get: (_target, prop) =>
          prop === "then"
            ? undefined
            : (..._args: unknown[]) => {
                calls.push(`${ns}.${String(prop)}`);
                return Promise.resolve();
              },
      },
    );
  return { calls, ctx: { scene: api("scene"), strip: api("strip"), audio: api("audio"), reduced, wait: () => Promise.resolve() } };
}

/** One event of each kind, carrying every field any kind might need. */
const sample = (kind: string) => ({
  kind,
  seq: 7,
  tick: 40,
  actorId: "ally-1",
  targetId: kind === "strike" || kind === "lunge" ? "orrery" : "ally-2",
  amount: 12,
  hits: [
    { targetId: "ally-1", amount: 12 },
    { targetId: "ally-2", amount: 12 },
  ],
  outcome: "won",
});

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
});
