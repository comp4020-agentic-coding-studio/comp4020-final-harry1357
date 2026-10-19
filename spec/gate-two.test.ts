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

type Win = { setEnabled(on: boolean): void; setSeat(info: unknown): void; destroy(): void };
type Mount = (root: HTMLElement, o: Record<string, unknown>) => Win;

describe("phase two's gate", () => {
  it("P2: Restore offers the fallen to choose from, and sends the one chosen", async () => {
    const { mountCommandWindow } = (await import(resolve("src/client/command/window.ts"))) as { mountCommandWindow: Mount };
    const root = document.createElement("div");
    document.body.append(root);
    const chosen: [string, string | null][] = [];
    let fallen = [
      { id: "bo", name: "Bo" },
      { id: "cy", name: "Cy" },
    ];
    const win = mountCommandWindow(root, {
      actions: ["brace", "mend", "ward", "quicken", "restore"],
      allies: () => [
        { id: "me", name: "Me (you)" },
        { id: "al", name: "Al" },
      ],
      fallen: () => fallen,
      onTarget: () => {},
      onChoose: (a: string, t: string | null) => chosen.push([a, t]),
    });
    win.setEnabled(true);
    const restore = () => root.querySelector<HTMLButtonElement>('button[data-action="restore"]') as HTMLButtonElement;
    const aimed = () => root.querySelector<HTMLElement>("[data-aim-name]")?.textContent;

    restore().click();
    expect(aimed(), "Restore aims at the first of the fallen, not at a standing ally or the server's pick").toBe("Bo");
    root.querySelector<HTMLButtonElement>('.command-step[data-step="1"]')?.click();
    expect(aimed(), "and steps through the fallen").toBe("Cy");
    root.querySelector<HTMLButtonElement>("[data-confirm]")?.click();
    expect(chosen.at(-1), "the fallen ally chosen is the one sent").toEqual(["restore", "cy"]);

    fallen = [];
    restore().click();
    expect(root.querySelector<HTMLElement>(".command-aim")?.hidden, "nobody fallen: nothing to aim at").toBe(true);
    expect(chosen.length, "and nothing sent").toBe(1);
    win.destroy();
  });

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
