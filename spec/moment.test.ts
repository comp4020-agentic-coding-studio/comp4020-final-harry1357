// @vitest-environment jsdom
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// A phase change is a moment, and a new fight is a clean screen (docs/adr/009,
// docs/adr/010; CLAUDE.md rules 27 and 28).
//
// 1. Every phase change emits a card, and its renderer produces the declared
//    state: the strip draws the phase card, the scene a title in the pixel
//    face and the rings' new look, with a flash, in both variants; under
//    reduced motion nothing moves and all of it still shows.
// 2. The lobby's events (start, host, grow) are drawn too.
// 3. Entering a room or a new fight clears the previous fight's end panel and
//    banner, and the join screen never covers a live fight: the second
//    finding ("creating a room dropped the creator straight into a fight …
//    with the previous fight's victory text still on screen").

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

type Effect = (ctx: unknown, event: unknown) => unknown;
const MOTION = new Set(["shake", "pushIn", "projectile", "slash", "pulse", "spinUp", "afterimage", "windUp", "hitStop"]);

function recording(reduced: boolean) {
  const made: [string, ...unknown[]][] = [];
  const api = (ns: string) =>
    new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : (...args: unknown[]) => (made.push([`${ns}.${String(prop)}`, ...args]), Promise.resolve())) });
  const state = {
    battleId: "b", version: 3, tick: 40, tickMs: 150, turnMs: 12_000, plateMs: null, status: "fighting", activeId: null,
    turnDeadline: null, queue: [{ id: "orrery", kind: "boss", name: "The Orrery", role: "orrery", counter: 4, hp: 100, maxHp: 300 }],
    fallen: [], log: [], phase: 3, rings: [], cards: [], chain: { links: 0, potency: 1 }, pullSeats: 1, spentExposed: [],
    room: { code: "QZ7MK", isPublic: false }, preview: null, alignmentLeft: 3, echoRoles: [], bastion: false, bastionCard: null,
    hostId: "ally-1", lobby: false,
  };
  return { made, ctx: { scene: api("scene"), strip: api("strip"), audio: api("audio"), reduced, wait: () => Promise.resolve(), state, me: "ally-1" } };
}

async function registry() {
  return (await import(resolve("src/client/battle/registry.ts"))) as {
    RENDERERS: Record<string, { full: Effect; reduced: Effect }>;
    EXPECTED_STATE: Record<string, [string, ...unknown[]][]>;
  };
}

describe("a phase change is a moment", () => {
  for (const [phase, name] of [
    [2, "Conjunction"],
    [3, "the Grand Alignment"],
  ] as const) {
    it(`phase ${phase} lands as a card, a title, the rings' change and a flash, full and reduced`, async () => {
      const { RENDERERS, EXPECTED_STATE } = await registry();
      const event = { kind: "phase", seq: 5, tick: 40, actorId: "orrery", phase, name };
      for (const reduced of [false, true]) {
        const { made, ctx } = recording(reduced);
        await RENDERERS.phase[reduced ? "reduced" : "full"](ctx, event);
        const did = (method: string, ...args: unknown[]) => made.some((c) => c[0] === method && args.every((a, i) => Object.is(c[i + 1], a)));
        const v = reduced ? "reduced" : "full";
        expect(did("strip.phaseCard", phase, name), `${v}: the phase card on the strip, with its number and name`).toBe(true);
        expect(did("scene.phase", phase), `${v}: the rings reconfigure to the new phase`).toBe(true);
        expect(did("scene.hit", "orrery"), `${v}: a flash on the rings`).toBe(true);
        const title = made.find((c) => c[0] === "scene.title");
        expect(typeof title?.[1], `${v}: a title across the field`).toBe("string");
        expect(String(title?.[1]), `${v}: the title names the phase`).toContain(name);
        expect(did("audio.play", "phase"), `${v}: its own sound`).toBe(true);
        if (reduced) expect(made.filter((c) => MOTION.has(c[0].split(".")[1])), "reduced: nothing moves").toEqual([]);
        else expect(made.some((c) => c[0] === "scene.hitStop"), "full: the table stops for a beat (hit-stop)").toBe(true);
      }
      const declared = EXPECTED_STATE.phase.map((x) => x[0]);
      for (const method of ["strip.phaseCard", "scene.title", "scene.phase", "scene.hit"]) {
        expect(declared, `the phase's declared state names ${method}`).toContain(method);
      }
    });
  }

  it("the server's phase event carries the phase's name, for the card and the title", async () => {
    const { engine, table } = await import("./engine.ts");
    const e = await engine();
    let b = table(e, ["striker"]);
    b = structuredClone(b);
    const boss = b.standing.find((f) => f.id === "orrery")!;
    boss.hp = Math.ceil(boss.maxHp * 0.71);
    const ready = e.plate(b, "striker-1", { now: 1_000_000, turnMs: 12_000 });
    const step = e.act(ready, "striker-1", "cleave", "outer", { now: 1_000_000, turnMs: 12_000 });
    const crossed = step.effects.events.find((ev) => ev.kind === "phase");
    expect(crossed, "a blow past 70% crosses into phase II").toBeDefined();
    expect(crossed, "and names it").toMatchObject({ phase: 2, name: "Conjunction" });
  });
});

describe("the lobby's events are drawn", () => {
  it("start, host and grow each have a renderer that draws their state, and moves nothing reduced", async () => {
    const { RENDERERS, EXPECTED_STATE } = await registry();
    const samples: Record<string, Record<string, unknown>> = {
      start: { kind: "start", seq: 2, tick: 0, actorId: "ally-1", seats: 3, maxHp: 365 },
      host: { kind: "host", seq: 3, tick: 0, actorId: "ally-1", from: "ally-0" },
      grow: { kind: "grow", seq: 4, tick: 9, actorId: "orrery", seats: 2, maxHp: 269, hp: 161 },
    };
    for (const [kind, event] of Object.entries(samples)) {
      expect(typeof RENDERERS[kind]?.full, `"${kind}" has a renderer`).toBe("function");
      expect(EXPECTED_STATE[kind]?.length, `"${kind}" declares its state`).toBeGreaterThan(0);
      const { made, ctx } = recording(true);
      await RENDERERS[kind].reduced(ctx, event);
      expect(made.filter((c) => MOTION.has(c[0].split(".")[1])), `"${kind}" reduced: nothing moves`).toEqual([]);
      for (const [method] of EXPECTED_STATE[kind]) expect(made.map((c) => c[0]), `"${kind}" reduced draws ${method}`).toContain(method);
    }
    const { made, ctx } = recording(true);
    await RENDERERS.grow.reduced(ctx, samples.grow);
    expect(made.some((c) => c[0] === "scene.hp" && c[1] === "orrery" && c[2] === 161 && c[3] === 269), "the Orrery's bar is drawn at its new size").toBe(true);
  });
});

// --- a clean screen for a new fight ------------------------------------------------

interface Screen {
  /** Every state, as the page has it: decides which of join, lobby, fight or ended is up. */
  state(state: unknown, myId: string | null): void;
  /** The page is now watching another room, or the room's next fight. */
  entered(): void;
  /** What is up now. */
  phase(): string;
}

async function screen() {
  const mod = (await import(resolve("src/client/screen.ts"))) as {
    createScreen?: (o: { root: HTMLElement; banner(text: string | null): void; join: { show(): void; hide(): void; ended(o: string): void; clear(): void }; lobby: { show(s: unknown): void; hide(): void } }) => Screen;
  };
  expect(typeof mod.createScreen, "src/client/screen.ts exports createScreen: what the page shows, decided in one place").toBe("function");
  return mod.createScreen!;
}

function state(battleId: string, status: string, extra: Record<string, unknown> = {}) {
  return {
    battleId, status, room: { code: "QZ7MK", isPublic: false }, hostId: "me", lobby: status === "waiting",
    queue: [{ id: "me", kind: "character" }, { id: "orrery", kind: "boss" }], fallen: [], ...extra,
  };
}

function rig(create: Awaited<ReturnType<typeof screen>>) {
  const root = document.createElement("main");
  const calls: string[] = [];
  let bannerText: string | null = null;
  const s = create({
    root,
    banner: (t) => ((bannerText = t), calls.push(`banner:${t}`)),
    join: { show: () => calls.push("join.show"), hide: () => calls.push("join.hide"), ended: (o) => calls.push(`join.ended:${o}`), clear: () => calls.push("join.clear") },
    lobby: { show: () => calls.push("lobby.show"), hide: () => calls.push("lobby.hide") },
  });
  return { s, calls, root, banner: () => bannerText };
}

describe("a new fight is a clean screen", () => {
  it("entering a room clears the last fight's end panel and its banner, and shows the lobby", async () => {
    const { s, calls, banner } = rig(await screen());
    s.state(state("A", "won"), "me");
    expect(s.phase(), "the last fight ended: its end panel").toBe("ended");
    expect(calls, "with its outcome").toContain("join.ended:won");

    calls.length = 0;
    s.entered();
    s.state(state("B", "waiting"), "me");
    expect(calls, "the end panel is cleared on entering").toContain("join.clear");
    expect(banner(), "and the victory banner with it").toBeNull();
    expect(s.phase(), "a private room's waiting fight is its lobby").toBe("lobby");
    expect(calls, "the lobby is shown").toContain("lobby.show");
  });

  it("a room's next fight clears the end panel once the person goes on, and the join screen never covers a live fight", async () => {
    const { s, calls } = rig(await screen());
    s.state(state("A", "fighting"), "me");
    expect(s.phase(), "seated in a running fight: the fight").toBe("fight");
    s.state(state("A", "won"), "me");
    s.entered();
    s.state(state("B", "fighting"), "me");
    expect(s.phase(), "seated in the room's next fight, already running: the fight, not a stale panel").toBe("fight");
    expect(calls, "the end panel cleared").toContain("join.clear");
    expect(calls.slice(calls.lastIndexOf("join.clear")), "and nothing reopened the join screen over it").not.toContain("join.show");

    // Someone not seated in a live fight sees the join screen; once seated, never again over that fight.
    const other = rig(await screen());
    other.s.state(state("C", "fighting", { queue: [{ id: "orrery", kind: "boss" }] }), "me");
    expect(other.s.phase(), "not seated: the join screen").toBe("join");
    other.s.state(state("C", "fighting"), "me");
    expect(other.s.phase(), "seated: the fight").toBe("fight");
    expect(other.calls.at(-1), "the join screen hid").toBe("join.hide");
    other.s.state(state("C", "fighting"), "me");
    expect(other.calls.filter((c) => c === "join.show").length, "and was shown once, before the seat").toBe(1);
  });
});
