// @vitest-environment jsdom
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Phase two's gate (docs/review/phase-two.md): findings in the client that a
// page-less test can hold. P2 and P3 came from play.

globalThis.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
  dispatchEvent: () => false,
})) as unknown as typeof matchMedia;

describe("phase two's gate", () => {
  it("P3: a person back from their Echo has a strip flag of their own, not Restore's", async () => {
    const { RENDERERS } = (await import(resolve("src/client/battle/registry.ts"))) as {
      RENDERERS: Record<string, { reduced: (ctx: unknown, e: unknown) => Promise<void> | void }>;
    };
    const flags: [string, string][] = [];
    const quiet = () => Promise.resolve();
    const scene = new Proxy({}, { get: () => quiet });
    const strip = new Proxy({}, { get: (_t, k) => (k === "flag" ? (id: string, f: string) => flags.push([id, f]) : quiet) });
    const token = (id: string, role: string) => ({ id, kind: "character", name: id, role, hp: 50, maxHp: 100, echo: false, seatedBy: null, counter: 3 });
    const state = { queue: [token("me", "striker"), token("mae", "mender"), token("bo", "warden")], fallen: [], cards: [], rings: [], phase: 1 };
    const ctx = { scene, strip, audio: { play() {} }, reduced: true, wait: quiet, state, me: "me" };
    await RENDERERS.echo.reduced(ctx, { kind: "echo", actorId: "me", on: false });
    const back = flags.find(([id]) => id === "me")?.[1];
    expect(back, "the person's portrait is stamped as they take their seat back").toBeDefined();
    expect(back, "with a flag of its own: \"restored\" is the Mender's Restore").not.toBe("restored");
    expect(back).toBe("reclaimed");
  });
});
