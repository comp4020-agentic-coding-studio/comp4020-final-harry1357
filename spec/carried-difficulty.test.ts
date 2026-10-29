// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Carried red from the difficulty gate's confirm pass (docs/review/difficulty.md, C1-C3): findings that name a
// rule or an ADR, found after the one fix round the stopping rule allows. CLAUDE.md: carried as red tests and
// listed open; the branch does not merge to main while they are.

describe("C1 (rule 11): a signature move's Charge spend is drawn before its log line", () => {
  // The conductor writes an event's line once its renderer has run, and redraws a seat's marks from state only
  // after the queue drains. So each signature renderer must redraw the spender's marks itself, or "…3 Charge
  // behind it…" is written while the sprite still shows Charge 3. Only Bastion does.
  for (const kind of ["bastion", "restore", "finisher", "shatter", "stillpoint"]) {
    it(`"${kind}" redraws its actor's status marks, full and reduced`, async () => {
      const { RENDERERS } = (await import(resolve("src/client/battle/registry.ts"))) as {
        RENDERERS: Record<string, { full: (c: unknown, e: unknown) => unknown; reduced: (c: unknown, e: unknown) => unknown }>;
      };
      const token = { id: "me-1", kind: "character", name: "Me", role: "striker", hp: 50, maxHp: 100, charge: 0, gravity: 0, warded: false, braced: false, hasted: false, relayBonus: 0, reactionReady: true, echo: false, seatedBy: null, drifting: false, resource: 0, counter: 5, seat: 1 };
      const state = { queue: [token, { ...token, id: "ally-2", name: "Ally" }, { id: "orrery", kind: "boss", role: "orrery", hp: 100, maxHp: 200 }], fallen: [], rings: [], cards: [], status: "fighting" };
      const event = { kind, actorId: "me-1", targetId: "ally-2", ringId: "outer", cardId: "card-1", amount: 10, spent: 2, broken: false, charge: 3, seq: 9, tick: 1 };
      for (const variant of ["full", "reduced"] as const) {
        const made: [string, ...unknown[]][] = [];
        const api = (ns: string) =>
          new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : (...a: unknown[]) => (made.push([`${ns}.${String(p)}`, ...a]), Promise.resolve())) });
        const ctx = { scene: api("scene"), strip: api("strip"), audio: api("audio"), reduced: variant === "reduced", wait: () => Promise.resolve(), state, me: "me-1" };
        await RENDERERS[kind][variant](ctx, event);
        expect(made.some((c) => c[0] === "scene.status" && c[1] === "me-1"), `${kind} (${variant}) redraws the spender's marks`).toBe(true);
      }
    });
  }
});

describe("C2 (ADR-011, tooth 3): after an uncancelled Retrograde the Orrery comes round before the table", () => {
  it("holds in a room of one seat as in a room of three", async () => {
    const { engine, table, bossTurn } = await import("./engine.ts");
    const e = await engine();
    for (const role of ["warden", "mender", "striker", "breaker", "chronist"]) {
      let b = structuredClone(table(e, [role]));
      b.cards = [];
      b = e.announce(b, { intent: "retrograde", targetId: null, amount: null, countdown: 0 });
      const after = bossTurn(e, b).battle;
      const seat = after.standing.find((f) => f.kind === "character")!;
      const orrery = after.standing.find((f) => f.id === "orrery")!;
      expect(orrery.counter, `a lone ${role}: the Orrery's next turn (${orrery.counter}) before the seat's (${seat.counter})`).toBeLessThan(seat.counter);
    }
  });
});

describe("C3 (ADR-011, tooth 1; ADR-006: a rule read off the screen): Gravity is marked lethal at the server's count", () => {
  // The owner's ruling: the screen reads the threshold from state, never a literal. ADR-011 names it,
  // GRAVITY_LETHAL, 2; so the mark moves to two and the kill stays where it is.
  it("the state carries the lethal count, and a seat at it is marked lethal; one short isn't", async () => {
    const { engine, table, sent } = await import("./engine.ts");
    const { GRAVITY_LETHAL } = await import("../src/server/tuning.ts");
    const e = await engine();
    const state = sent(e, table(e, ["striker", "warden"])) as { gravityLethal?: number };
    expect(state.gravityLethal, "the state names the lethal count").toBe(GRAVITY_LETHAL);
    const { marksOf } = (await import(resolve("src/client/scene/marks.ts"))) as {
      marksOf: (t: unknown, bracedLeft?: number | null, lethalAt?: number) => { kind: string; lethal?: boolean }[];
    };
    const at = (gravity: number) => marksOf({ kind: "character", gravity, charge: 0, warded: false, braced: false, hasted: false }, null, state.gravityLethal).find((m) => m.kind === "gravity");
    expect(at(GRAVITY_LETHAL)?.lethal, `at ${GRAVITY_LETHAL} stacks: marked lethal`).toBe(true);
    expect(at(GRAVITY_LETHAL - 1)?.lethal ?? false, "one short: not").toBe(false);
    expect(readFileSync(resolve("src/client/scene/party.ts"), "utf8"), "no literal threshold on the screen").not.toMatch(/m\.kind === "gravity" && \(m\.count/);
  });
});

describe("the breaker's R-A and R-B: a ring the server doesn't offer (the owner's ruling)", () => {
  it("a target that isn't text is refused with a 400, like every other bad ring, never defaulted", async () => {
    const { engine, table, clock } = await import("./engine.ts");
    const e = await engine();
    const b = e.plate(table(e, ["striker", "warden"]), "striker-1", clock());
    for (const bad of [{}, ["outer"], 7, true]) {
      expect(e.checkAction(b, "striker-1", "jab", bad), `jab at ${JSON.stringify(bad)}`).toHaveProperty("status", 400);
    }
    expect(e.checkAction(b, "striker-1", "jab", null), "no target at all still takes the default").not.toHaveProperty("status");
  });

  it("a refused ring name is said back capped at forty characters", async () => {
    const { engine, table, clock } = await import("./engine.ts");
    const e = await engine();
    const b = e.plate(table(e, ["striker", "warden"]), "striker-1", clock());
    const refused = e.checkAction(b, "striker-1", "jab", "A".repeat(5000)) as { status: number; error: string };
    expect(refused.status).toBe(400);
    const said = /"([^"]*)"/.exec(refused.error)?.[1] ?? "";
    expect([...said].length, `the name said back: ${said.length} characters`).toBeLessThanOrEqual(40);
  });
});
