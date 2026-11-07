// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { engine, table, type Battle } from "./engine.ts";

// The phase moment says what changed (ADR-012, piece 2; CLAUDE.md rule 34;
// docs/features-rice.md item 17). ADR-010 made a phase change a moment: the
// screen stops, flashes and names itself. It didn't say what the new phase
// does. The server's `phase` event carries `change`, one line in the game's
// words, and the title draws it under the phase's name, in both variants. The
// client composes none of it.

const clockAt = { now: 1_000_000, turnMs: 12_000 };

/** The phase event a blow crossing `share` of the Orrery's HP raises. */
async function crossing(share: number, start?: (b: Battle) => Battle) {
  const e = await engine();
  let b = structuredClone(table(e, ["striker"]));
  if (start) b = start(b);
  const boss = b.standing.find((f) => f.id === "orrery")!;
  boss.hp = Math.ceil(boss.maxHp * share);
  b = e.plate(b, "striker-1", clockAt);
  const step = e.act(b, "striker-1", "cleave", "outer", clockAt);
  return { step, event: step.effects.events.find((ev) => ev.kind === "phase") as Record<string, unknown> | undefined };
}

describe("the server says what each phase changes", () => {
  it("Conjunction: the strip flips, a Chronist cancels it, and every weakness hides", async () => {
    const { event, step } = await crossing(0.71);
    expect(event, "a blow past 70% crosses into phase II").toMatchObject({ phase: 2, name: "Conjunction" });
    expect(event!.change, "in the game's words").toBe(
      "Conjunction: the Orrery flips the strip; a Chronist cancels it. Every weakness hides again.",
    );
    const line = step.battle.log.find((l) => l.text.includes("Conjunction"));
    expect(line?.text, "the phase's log line says it too").toContain(event!.change as string);
  });

  it("the Grand Alignment: every fourth card is an Alignment, and the third wipes", async () => {
    const { event } = await crossing(0.36, (b) => ({ ...b, phase: 2 }));
    expect(event, "past 35%, phase III").toMatchObject({ phase: 3, name: "the Grand Alignment" });
    expect(event!.change).toBe(
      "The Grand Alignment: every fourth card is an Alignment, and the third wipes the table. Every weakness hides again.",
    );
  });

  it("the Grand Alignment already begun by the clock says the clock began it", async () => {
    const { event } = await crossing(0.36, (b) => {
      const x = structuredClone(b);
      x.phase = 2;
      (x as Battle & { orreryScript: { enraged: boolean } }).orreryScript.enraged = true;
      return x;
    });
    expect(event!.change).toBe(
      "The Grand Alignment, already begun by the clock: the third Alignment wipes the table. Every weakness hides again.",
    );
  });
});

describe("the title draws the server's line under the phase's name", () => {
  function recording(reduced: boolean) {
    const made: [string, ...unknown[]][] = [];
    const api = (ns: string) =>
      new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : (...args: unknown[]) => (made.push([`${ns}.${String(prop)}`, ...args]), Promise.resolve())) });
    const state = { battleId: "b", status: "fighting", queue: [], fallen: [], cards: [], rings: [], phase: 2 };
    return { made, ctx: { scene: api("scene"), strip: api("strip"), audio: api("audio"), reduced, wait: () => Promise.resolve(), state, me: null } };
  }

  it("both variants pass the event's own line to the title, and declare it", async () => {
    const mod = (await import(resolve("src/client/battle/registry.ts"))) as {
      RENDERERS: Record<string, { full: (c: unknown, e: unknown) => unknown; reduced: (c: unknown, e: unknown) => unknown }>;
      EXPECTED_STATE: Record<string, [string, ...unknown[]][]>;
    };
    // A line no client could compose: if the title shows it, it showed the server's.
    const change = "Qz: the Orrery does a thing no client knows of.";
    const event = { kind: "phase", seq: 5, tick: 40, actorId: "orrery", phase: 2, name: "Conjunction", reshuffled: true, change };
    for (const variant of ["full", "reduced"] as const) {
      const { made, ctx } = recording(variant === "reduced");
      await mod.RENDERERS.phase[variant](ctx, event);
      const title = made.find((c) => c[0] === "scene.title");
      expect(title?.[1], `${variant}: the title still names the phase`).toBe("Phase II: Conjunction");
      expect(title?.[2], `${variant}: and carries the server's line beneath it`).toBe(change);
    }
    expect(
      mod.EXPECTED_STATE.phase.some((x) => x[0] === "scene.title" && x.length >= 3),
      "the phase's declared state names the title with its line",
    ).toBe(true);
  });

  it("the scene draws the line under the title, held longer when there is one to read", async () => {
    globalThis.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
    const { createScene } = (await import(resolve("src/client/scene/scene.ts"))) as {
      createScene: (root: HTMLElement, o: unknown) => { title(text: string | null, line?: string | null): void };
    };
    const root = document.createElement("div");
    document.body.append(root);
    const scene = createScene(root, { manifest: { facing: "left", required: [], roles: {} }, orrerySvg: "<svg></svg>" });
    const change = "Qz: the Orrery does a thing no client knows of.";
    scene.title("Phase II: Conjunction", change);
    const title = root.querySelector<HTMLElement>("[data-title]");
    expect(title?.hidden).toBe(false);
    expect(title?.querySelector("[data-title-name]")?.textContent, "the phase's name").toBe("Phase II: Conjunction");
    expect(title?.querySelector("[data-title-line]")?.textContent, "the server's line beneath it").toBe(change);
    scene.title("Phase II: Conjunction");
    expect(title?.querySelector<HTMLElement>("[data-title-line]")?.hidden, "no line sent: none shown").toBe(true);
  });

  it("no client module composes what a phase changes", async () => {
    for (const file of ["src/client/battle/effects/orrery.ts", "src/client/scene/scene.ts", "src/client/strip/strip.ts"]) {
      const src = await readFile(resolve(file), "utf8");
      expect(src, `${file} says "flips the strip" itself`).not.toMatch(/flips the strip/);
      expect(src, `${file} says "wipes the table" itself`).not.toMatch(/wipes the table/);
    }
  });
});
