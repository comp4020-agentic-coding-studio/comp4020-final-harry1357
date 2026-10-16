// @vitest-environment jsdom
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The review gate's open findings outside phase one's surface (docs/review/
// phase-one.md). Phase one was server-only, so these are client work carried
// into phase two. Each is a red test now, so phase two can't skip it, and the
// branch doesn't merge to main while any of them is open (CLAUDE.md, the
// review gate). Every one is red on purpose until the client does the work.

// jsdom has no matchMedia; the client asks it about reduced motion. A stub that
// always says "no preference", so these fail on their findings, not on that.
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

/** A client module, or a failure naming it. */
async function client<T>(path: string): Promise<T> {
  try {
    return (await import(resolve(path))) as T;
  } catch (err) {
    throw new Error(`${path} couldn't be loaded: ${(err as Error).message}`);
  }
}

/** A state with one boss card on the strip and one character standing. */
function stateWithCard(over: Record<string, unknown> = {}) {
  return {
    battleId: "b",
    version: 1,
    tick: 10,
    tickMs: 150,
    turnMs: 12_000,
    status: "fighting",
    activeId: "me",
    turnDeadline: null,
    queue: [
      { id: "me", kind: "character", name: "Me", role: "chronist", counter: 0, hp: 90, maxHp: 90, hasted: false, braced: false, seat: 1, charge: 0, resource: 0, gravity: 0, drifting: false, echo: false, reactionReady: true },
      { id: "orrery", kind: "boss", name: "The Orrery", role: "orrery", counter: 9, hp: 240, maxHp: 240, hasted: false, braced: false, seat: 0, charge: 0, resource: 0, gravity: 0, drifting: false, echo: false, reactionReady: false },
    ],
    fallen: [],
    log: [],
    phase: 1,
    rings: [],
    cards: [{ id: "card-7", intent: "eclipse", targetId: "me", amount: 30, countdown: 1, frozen: false }],
    chain: { links: 0, potency: 1 },
    pullSeats: 1,
    spentExposed: [],
    ...over,
  };
}

describe("open findings carried into phase two", () => {
  it("F1 (rule 11): an event with no renderer never has its log line written", async () => {
    const { createConductor } = await client<{ createConductor: (o: unknown) => { receive(m: unknown): void } }>(
      "src/client/battle/conductor.ts",
    );
    const appended: number[] = [];
    const noop = () => Promise.resolve();
    const stand = new Proxy({}, { get: () => noop });
    const conductor = createConductor({
      scene: Object.assign(Object.create(stand), { reconcile: () => {} }),
      strip: Object.assign(Object.create(stand), { render: () => {} }),
      audio: { play: () => {} },
      log: { history: () => {}, append: (e: { seq: number }) => appended.push(e.seq) },
      registry: {}, // nothing can be shown
      onState: () => {},
    });
    const line = { seq: 5, tick: 10, kind: "system", actorId: "orrery", text: "The Orrery wakes." };
    conductor.receive({ type: "state", battle: stateWithCard({ log: [] }), events: [] }); // the first message is the whole truth
    conductor.receive({ type: "state", battle: stateWithCard({ log: [line] }), events: [{ kind: "pull", seq: 5, tick: 10, actorId: "orrery", seats: 1, maxHp: 240 }] });
    await new Promise((r) => setTimeout(r, 50));
    expect(appended, "a line for an event nothing showed was written to the log").not.toContain(5);
  });

  it("F2 (rule 19): the strip draws the boss cards the server announced", async () => {
    const { createStrip } = await client<{ createStrip: (root: HTMLElement, o: unknown) => { render(s: unknown, me: string | null): void } }>(
      "src/client/strip/strip.ts",
    );
    const root = document.createElement("aside");
    document.body.append(root);
    const manifest = { facing: "left", required: [], roles: {} };
    createStrip(root, { manifest, orrerySvg: "<svg></svg>" }).render(stateWithCard(), "me");
    const card = root.querySelector('[data-card-id="card-7"]');
    expect(card, "no boss card drawn on the strip for card-7").not.toBeNull();
    // Rule 19 and ADR-006: an intent icon, a target and a countdown (review R9).
    expect(card?.getAttribute("data-intent"), "the card shows its intent").toBe("eclipse");
    expect(card?.getAttribute("data-target"), "the card names its target").toBe("me");
    expect(card?.getAttribute("data-countdown"), "the card shows its countdown").toBe("1");
  });

  it("F6 (rules 8, 11): a timeout shows the server's Brace, and a drifting portrait is drawn dim", async () => {
    const { RENDERERS } = await client<{ RENDERERS: Record<string, { reduced?: (c: unknown, e: unknown) => unknown }> }>(
      "src/client/battle/registry.ts",
    );
    const calls: [string, unknown[]][] = [];
    const api = (ns: string) =>
      new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : (...a: unknown[]) => (calls.push([`${ns}.${String(p)}`, a]), Promise.resolve())) });
    const ctx = { scene: api("scene"), strip: api("strip"), audio: api("audio"), reduced: true, wait: () => Promise.resolve(), state: stateWithCard() };
    await RENDERERS.hold?.reduced?.(ctx, { kind: "hold", actorId: "me", charge: 1, timeouts: 1, tick: 10, seq: 3 });
    const guards = calls.filter(([m]) => m === "scene.guard").map(([, a]) => a[1]);
    expect(guards, "the hold renderer drops the guard, but the server just Braced for them").not.toContain(false);
    expect(guards, "it should show the Brace the server took").toContain(true);
  });

  it("R5 (rule 8, ADR-006): drifting and Echo seats are drawn from the state, and stay drawn", async () => {
    // A mark the strip reads from each token, not a one-off stamp from an event
    // a late-joining client never saw (review R5).
    const { createStrip } = await client<{ createStrip: (root: HTMLElement, o: unknown) => { render(s: unknown, me: string | null): void } }>(
      "src/client/strip/strip.ts",
    );
    const root = document.createElement("aside");
    document.body.append(root);
    const st = stateWithCard();
    st.queue[0] = { ...st.queue[0], drifting: true };
    st.queue.push({ ...st.queue[0], id: "echo-seat", name: "Gone", drifting: false, echo: true, seat: 2 });
    const strip = createStrip(root, { manifest: { facing: "left", required: [], roles: {} }, orrerySvg: "<svg></svg>" });
    strip.render(st, null);
    await new Promise((r) => setTimeout(r, 1500)); // longer than any flag's stamp
    const me = root.querySelector('[data-token-id="me"]');
    const echo = root.querySelector('[data-token-id="echo-seat"]');
    expect(me?.getAttribute("data-drifting"), "a drifting seat is drawn dimmed, and still is after a beat").toBe("true");
    expect(echo?.getAttribute("data-echo"), "an Echo seat is drawn as the Echo's").toBe("true");
  });

  it("R8 (ADR-006): the countdown is drawn against the plate's real window", async () => {
    // An Echo's beat is plateMs, not the person's turnMs (review R8). Phase two
    // provides the arithmetic as countdownFraction(state, now) in the command module.
    const mod = await client<{ countdownFraction?: (state: unknown, now: number) => number | null }>("src/client/command/window.ts");
    expect(typeof mod.countdownFraction, "src/client/command/window.ts exports no countdownFraction").toBe("function");
    const now = 5_000_000;
    const beat = stateWithCard({ turnMs: 12_000, plateMs: 3_000, turnDeadline: now + 1_500 });
    expect(mod.countdownFraction?.(beat, now), "half the Echo's 3 s beat is left, not an eighth of 12 s").toBeCloseTo(0.5, 2);
  });

  it("R1 (rule 11): a spent card is drawn passing over, not as a hit on the fallen", async () => {
    const { RENDERERS } = await client<{ RENDERERS: Record<string, { reduced?: (c: unknown, e: unknown) => unknown }> }>(
      "src/client/battle/registry.ts",
    );
    for (const kind of ["eclipse", "lunge"]) {
      const calls: string[] = [];
      const api = (ns: string) =>
        new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : (..._a: unknown[]) => (calls.push(`${ns}.${String(p)}`), Promise.resolve())) });
      const ctx = { scene: api("scene"), strip: api("strip"), audio: api("audio"), reduced: true, wait: () => Promise.resolve(), state: stateWithCard() };
      await RENDERERS[kind]?.reduced?.(ctx, { kind, actorId: "orrery", targetId: "me", amount: 0, gravity: 0, spent: true, tick: 10, seq: 4 });
      expect(calls.filter((c) => c === "scene.hit" || c === "scene.number"), `a spent ${kind} draws a hit or a number on its fallen target`).toEqual([]);
    }
  });

  it("F7 (ADR-006): a card-target action offers the strip's boss cards, and sends a card id", async () => {
    const { mountCommandWindow } = await client<{
      mountCommandWindow: (root: HTMLElement, o: Record<string, unknown>) => { setEnabled(on: boolean): void; destroy(): void };
    }>("src/client/command/window.ts");
    const root = document.createElement("div");
    document.body.append(root);
    const chosen: [string, string | null][] = [];
    const win = mountCommandWindow(root, {
      actions: ["delay"],
      allies: () => [{ id: "me", name: "Me" }],
      cards: () => [{ id: "card-7", name: "Eclipse on Me" }],
      onTarget: () => {},
      onChoose: (a: string, t: string | null) => chosen.push([a, t]),
    });
    win.setEnabled(true);
    const key = (k: string) => (document.activeElement ?? root).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    root.querySelector<HTMLElement>('button[data-action="delay"]')?.focus();
    key("Enter");
    key("Enter");
    expect(chosen.at(-1), "Delay aimed at an ally id; it must aim at a boss card").toEqual(["delay", "card-7"]);
    win.destroy();
  });

  it("F7 (ADR-006): Anchor and Stillpoint aim at boss cards too", async () => {
    const { mountCommandWindow } = await client<{
      mountCommandWindow: (root: HTMLElement, o: Record<string, unknown>) => { setEnabled(on: boolean): void; destroy(): void };
    }>("src/client/command/window.ts");
    for (const action of ["anchor", "stillpoint"]) {
      const root = document.createElement("div");
      document.body.append(root);
      const chosen: [string, string | null][] = [];
      const win = mountCommandWindow(root, {
        actions: [action],
        allies: () => [{ id: "me", name: "Me" }],
        cards: () => [{ id: "card-7", name: "Eclipse on Me" }],
        onTarget: () => {},
        onChoose: (a: string, t: string | null) => chosen.push([a, t]),
      });
      win.setEnabled(true);
      root.querySelector<HTMLElement>(`button[data-action="${action}"]`)?.focus();
      const key = (k: string) => (document.activeElement ?? root).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
      key("Enter");
      key("Enter");
      expect(chosen.at(-1), `${action} must aim at a boss card`).toEqual([action, "card-7"]);
      win.destroy();
    }
  });

  it("F7 (rule 18): a Reaction can be sent off-turn while the server says one is ready", async () => {
    // The turn's commands stay dark off-turn (rule 2), but Intercept answers a
    // card already on the strip, out of turn (rule 18). The server says when:
    // reactionReady and a card. The window exposes setReactionReady for it.
    const { mountCommandWindow } = await client<{
      mountCommandWindow: (root: HTMLElement, o: Record<string, unknown>) => { setEnabled(on: boolean): void; setReactionReady?: (on: boolean) => void; destroy(): void };
    }>("src/client/command/window.ts");
    const root = document.createElement("div");
    document.body.append(root);
    const chosen: [string, string | null][] = [];
    const win = mountCommandWindow(root, {
      actions: ["intercept", "anchor"],
      allies: () => [{ id: "me", name: "Me" }],
      cards: () => [{ id: "card-7", name: "Eclipse on an ally" }],
      onTarget: () => {},
      onChoose: (a: string, t: string | null) => chosen.push([a, t]),
    });
    win.setEnabled(false); // not my turn
    expect(typeof win.setReactionReady, "the window takes the server's word that a Reaction is ready").toBe("function");
    win.setReactionReady?.(true);
    const intercept = root.querySelector<HTMLButtonElement>('button[data-action="intercept"]');
    const anchor = root.querySelector<HTMLButtonElement>('button[data-action="anchor"]');
    expect(intercept?.disabled, "Intercept is live off-turn while a Reaction is ready").toBe(false);
    expect(anchor?.disabled, "a turn's action stays dark off-turn (rule 2)").toBe(true);
    win.destroy();
  });

  it("F25 (rule 11): each reduced renderer is held to the state change its event means, not any call", async () => {
    // spec/effects accepts any non-motion call as "shows the state change", so
    // a renderer drawing the wrong state passes (review F25: the hold renderer
    // dropping the guard the server just Braced). Phase two declares, per event,
    // the state its reduced renderer must show: EXPECTED_STATE in the registry,
    // [method, ...required args] the reduced variant must call. Then this holds
    // every renderer to it.
    const mod = await client<{
      RENDERERS: Record<string, { reduced?: (c: unknown, e: unknown) => unknown }>;
      EXPECTED_STATE?: Record<string, [string, ...unknown[]][]>;
    }>("src/client/battle/registry.ts");
    expect(mod.EXPECTED_STATE, "the registry declares no EXPECTED_STATE per event").toBeDefined();
    const { EVENT_KINDS } = await client<{ EVENT_KINDS: readonly string[] }>("src/shared/protocol.ts");
    for (const kind of EVENT_KINDS) {
      expect(mod.EXPECTED_STATE?.[kind], `no expected state declared for "${kind}"`).toBeDefined();
    }
    // The known wrong one: a hold must show the guard up (the server Braced).
    expect(mod.EXPECTED_STATE?.hold, "a hold's expected state includes the guard going up").toContainEqual(["scene.guard", "me", true]);
  });
});
