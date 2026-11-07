// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The difficulty gate's carried findings (docs/review/difficulty.md, C1-C6): each was carried here red, as a
// finding that named a rule or an ADR, and each is green now that the owner's rulings closed it. They stay as
// the specs that hold those rulings.

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

describe("C4 (rule 32): a refused ring name never reaches the log (the third confirm pass)", () => {
  it("the name sent is in no stdout line, the refusal line's reason included", async () => {
    const { boot, scratchDatabase } = await import("./boot.ts");
    const { newBattle, join, act, battle } = await import("./raid.ts");
    const server = await boot(scratchDatabase(), { TICK_MS: "20" });
    try {
      const id = await newBattle(server.base);
      const me = await join(server.base, id, `Probe ${Date.now() % 1000}`, "striker");
      const other = await join(server.base, id, `Other ${Date.now() % 1000}`, "warden");
      for (let i = 0; i < 400; i++) {
        const st = await battle(server.base, id);
        if (st.activeId === me.characterId) break;
        if (st.activeId === other.characterId) await act(server.base, id, other.cookie, "brace");
        await new Promise((r) => setTimeout(r, 20));
      }
      const secret = "ZQXJ-a-ring-nobody-offers";
      const res = await act(server.base, id, me.cookie, "jab", secret);
      expect(res.status, "refused").toBe(400);
      await new Promise((r) => setTimeout(r, 200));
      expect(server.stdout().filter((l) => l.includes("ZQXJ")), "lines carrying the name sent").toEqual([]);
    } finally {
      await server.kill();
    }
  }, 60_000);
});

describe("C5 (ADR-011, tooth 3; the owner's ruling): a Breaker's charged Shatter cancels a Retrograde", () => {
  // The ruling: the code stands and the ADR moves; ADR-011 names two cancels, a Chronist's and a Breaker's
  // Shatter that spends Charge, because its push touches the card. A promise now, so pinned.
  const landsAfter = async (charge: number) => {
    const { engine, table, turn, bossTurn, events } = await import("./engine.ts");
    const e = await engine();
    let b = structuredClone(table(e, ["breaker", "striker", "warden"]));
    b.cards = [];
    const me = b.standing.find((f) => f.id === "breaker-1")!;
    me.resource = 3;
    me.charge = charge;
    b.rings.find((r) => r.id === "outer")!.pips = 2;
    b = e.announce(b, { intent: "retrograde", targetId: null, amount: null, countdown: 0 });
    let cur = turn(e, b, "breaker-1", "shatter", "outer").battle;
    const seen: { flipped: unknown; cancelledBy: unknown }[] = [];
    for (let i = 0; i < 4 && cur.cards.some((c) => c.intent === "retrograde"); i++) {
      const step = bossTurn(e, cur);
      seen.push(...events(step, "retrograde").map((x) => ({ flipped: x.flipped, cancelledBy: x.cancelledBy })));
      cur = step.battle;
    }
    return seen;
  };

  it("with full Charge, the Retrograde comes apart, cancelled by the Breaker, and never flips", async () => {
    const seen = await landsAfter(3);
    expect(seen, "it comes apart, the Breaker named").toEqual([{ flipped: false, cancelledBy: "breaker-1" }]);
  });

  it("one pip is enough: the push touches the card", async () => {
    const seen = await landsAfter(1);
    expect(seen, "it comes apart, the Breaker named").toEqual([{ flipped: false, cancelledBy: "breaker-1" }]);
  });

  it("a Shatter with no Charge pushes nothing, and the Retrograde flips the strip", async () => {
    const seen = await landsAfter(0);
    expect(seen.some((x) => x.flipped === true), "it flips").toBe(true);
    expect(seen.filter((x) => x.cancelledBy === "breaker-1"), "no Breaker cancels it").toEqual([]);
  });
});

describe("C6 (rule 32; log.ts: `code` is the room it is in): a refusal line names its room by code (the fourth confirm pass)", () => {
  // C4's fix gave every refusal a reason code, and its parameter `code` shadowed the room's: every refusal line's
  // `code=` became the reason. A narrator filtering on code=<ROOM> loses every refusal in the room.
  it("a refused Start in the public raid says code=RAID, and the reason stays in reason=", async () => {
    const { boot, scratchDatabase } = await import("./boot.ts");
    const server = await boot(scratchDatabase(), { TICK_MS: "20" });
    try {
      const res = await fetch(new URL("/api/rooms/RAID/start", server.base), { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
      expect(res.status, "refused").toBeGreaterThanOrEqual(400);
      await new Promise((r) => setTimeout(r, 200));
      const line = server.stdout().find((l) => /\baction=start\b/.test(l) && /\boutcome=refused\b/.test(l)) ?? "";
      expect(/\bcode=(\S+)/.exec(line)?.[1], `the room's code: ${line}`).toBe("RAID");
      expect(/\breason=(\S+)/.exec(line)?.[1], "and why, as a code").toMatch(/^[a-z][a-z0-9-]*$/);
    } finally {
      await server.kill();
    }
  }, 60_000);
});
