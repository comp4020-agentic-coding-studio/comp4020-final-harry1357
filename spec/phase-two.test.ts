// @vitest-environment jsdom
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The review gate's findings outside phase one's surface (docs/review/
// phase-one.md, phase-one-b.md): client work carried into phase two, each
// committed red so phase two couldn't skip it (CLAUDE.md, the review gate).
// Phase two did the work and they're green; they stay as the record that it
// holds. Phase two's own gate (docs/review/phase-two.md) strengthened several.

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
    // On its face, not only in its attributes (phase two's gate, T10): what a sighted player reads.
    const face = card?.querySelector('[aria-hidden="true"]')?.textContent ?? "";
    expect(face, "the card's face names its target").toContain("You");
    expect(face, "and counts down").toMatch(/In\s*1/);
    // Its own intent's icon (re-review N9: any svg passed, and every card carries the aim and frost icons).
    expect(card?.querySelector(".strip-bc-art .strip-intent-eclipse"), "with its intent's icon").not.toBeNull();
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
    // Phase one-b (re-review N8): a seated Echo's window is nothing (plateMs 0,
    // ADR-007), and its deadline is the moment it reached the plate. Nothing is
    // left to count down, and it is never NaN or Infinity from dividing by 0.
    const none = stateWithCard({ turnMs: 12_000, plateMs: 0, turnDeadline: now });
    expect(mod.countdownFraction?.(none, now), "a seated Echo's window is drawn empty, not divided by zero").toBe(0);
  });

  it("R1 (rule 11): a spent card is drawn passing over, not as a hit on the fallen", async () => {
    // Both variants (phase two's gate, T5: the full one, where the fault first was, went unchecked).
    const { RENDERERS } = await client<{
      RENDERERS: Record<string, { full?: (c: unknown, e: unknown) => unknown; reduced?: (c: unknown, e: unknown) => unknown }>;
    }>("src/client/battle/registry.ts");
    for (const kind of ["eclipse", "lunge"]) {
      for (const variant of ["full", "reduced"] as const) {
        const calls: [string, unknown[]][] = [];
        const api = (ns: string) =>
          new Proxy({}, { get: (_t, p) => (p === "then" ? undefined : (...a: unknown[]) => (calls.push([`${ns}.${String(p)}`, a]), Promise.resolve())) });
        const ctx = { scene: api("scene"), strip: api("strip"), audio: api("audio"), reduced: variant === "reduced", wait: () => Promise.resolve(), state: stateWithCard() };
        await RENDERERS[kind]?.[variant]?.(ctx, { kind, actorId: "orrery", targetId: "me", amount: 0, gravity: 0, spent: true, tick: 10, seq: 4 });
        const landed = calls.filter(
          ([name, a]) => name === "scene.hit" || name === "scene.number" || name === "scene.projectile" || (name === "scene.frame" && a[0] === "me" && a[1] === "hurt"),
        );
        expect(landed.map(([name]) => name), `a spent ${kind} (${variant}) draws a blow landing on its fallen target`).toEqual([]);
      }
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

  it("F7 (rules 2, 18): a Reaction is the one thing live off-turn, only while the server says so, only at its card", async () => {
    // Rule 2, as reworded: the turn's actions stay disabled until it's your
    // turn. A Reaction is live only while the server says one is ready for you
    // (reactionReady) and only against the card the server names, and it is the
    // one thing the command window offers off-turn. The client decides nothing
    // about when either is available. The window is told by
    // setReactionReady(cardId | null): the card the server names, or null for
    // not ready.
    const { mountCommandWindow } = await client<{
      mountCommandWindow: (
        root: HTMLElement,
        o: Record<string, unknown>,
      ) => { setEnabled(on: boolean): void; setReactionReady?: (cardId: string | null) => void; destroy(): void };
    }>("src/client/command/window.ts");
    const root = document.createElement("div");
    document.body.append(root);
    const chosen: [string, string | null][] = [];
    const win = mountCommandWindow(root, {
      actions: ["brace", "intercept", "anchor"],
      allies: () => [{ id: "me", name: "Me" }],
      // Two cards on the strip: the server names only one for the Reaction.
      cards: () => [
        { id: "card-7", name: "Eclipse on an ally" },
        { id: "card-9", name: "Revolution on the party" },
      ],
      onTarget: () => {},
      onChoose: (a: string, t: string | null) => chosen.push([a, t]),
    });
    expect(typeof win.setReactionReady, "the window takes the server's word on the Reaction: setReactionReady(cardId | null)").toBe("function");
    const button = (a: string) => root.querySelector<HTMLButtonElement>(`button[data-action="${a}"]`);
    const live = () => [...root.querySelectorAll<HTMLButtonElement>("button[data-action]")].filter((b) => !b.disabled).map((b) => b.dataset.action);

    // Off-turn, nothing ready: nothing at all is live.
    win.setEnabled(false);
    win.setReactionReady?.(null);
    expect(live(), "off-turn with no Reaction ready, the window offers nothing").toEqual([]);

    // The server says a Reaction is ready, against card-7: Intercept is the one thing live.
    win.setReactionReady?.("card-7");
    expect(live(), "off-turn, the Reaction is the one thing offered").toEqual(["intercept"]);

    // It aims only at the card the server named, and sends that card.
    button("intercept")?.focus();
    const key = (k: string) => (document.activeElement ?? root).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
    key("Enter");
    key("ArrowDown"); // no other card to move to: the Reaction has one target
    key("Enter");
    expect(chosen.at(-1), "Intercept is sent against the card the server named, and no other").toEqual(["intercept", "card-7"]);

    // The server withdraws it: the client doesn't keep it live on its own.
    win.setReactionReady?.(null);
    expect(button("intercept")?.disabled, "when the server says no Reaction is ready, Intercept goes dark").toBe(true);
    const before = chosen.length;
    button("intercept")?.focus();
    key("Enter");
    key("Enter");
    expect(chosen.length, "and a dark Reaction sends nothing").toBe(before);

    // On your turn the turn's actions are live; that's the server's word too.
    win.setEnabled(true);
    expect(button("anchor")?.disabled, "on your turn, the turn's actions are live").toBe(false);
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

  it("R9 (rule 23; phase one-b): arriving with no code, the client goes through the default door to the public raid's room", async () => {
    // Review R9 (docs/review/phase-one-b.md): rule 23's "anyone arriving
    // without a code is sent there" is the client's to keep, and today's
    // client knows no rooms: it opens a battle by id. Phase two gives it a
    // door. The module and its shape are this test's proposal, to be changed
    // deliberately in its own commit if phase two shapes the door otherwise:
    // door(search, ask) answers the room code to open, asking the server's
    // default door (GET /api/raid) only when the address carries no code.
    const { door } = await client<{ door?: (search: string, ask: (path: string) => Promise<unknown>) => Promise<string> }>(
      "src/client/door.ts",
    );
    expect(typeof door, "src/client/door.ts exports no door()").toBe("function");
    // The server's answer is a code the client couldn't guess (re-review N7: a
    // stub answering the real "RAID" passed a door that hard-coded it).
    const asked: string[] = [];
    const ask = async (path: string) => {
      asked.push(path);
      return { code: "QZ7MK", battleId: "b-public" };
    };
    expect(await door!("", ask), "no code in the address: whatever room the server's default door names").toBe("QZ7MK");
    expect(asked, "found by asking the server's default door, not chosen by the client").toEqual(["/api/raid"]);
    asked.length = 0;
    expect(await door!("?room=k3x9p", ask), "a code in the address: that room").toBe("K3X9P");
    expect(asked, "with a code, the default door isn't asked").toEqual([]);
    // That the client's boot goes through it, and opens no battle of its own, is
    // held in Chrome (spec/gate-two-page.test.ts, T7): an import line was no proof.
  });
});
