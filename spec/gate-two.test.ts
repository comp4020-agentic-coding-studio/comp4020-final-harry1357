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

  it("T6: a command starts aimed at the target the server would take", async () => {
    const { mountCommandWindow } = (await import(resolve("src/client/command/window.ts"))) as { mountCommandWindow: Mount };
    const root = document.createElement("div");
    document.body.append(root);
    const chosen: [string, string | null][] = [];
    const win = mountCommandWindow(root, {
      actions: ["brace", "intercept", "anchor", "bastion", "counterweight"],
      allies: () => [{ id: "me", name: "Me (you)" }],
      cards: () => [
        { id: "rev", name: "Revolution on everyone, next" },
        { id: "ecl", name: "Eclipse on Mae, in 1" },
      ],
      onTarget: () => {},
      onChoose: (a: string, t: string | null) => chosen.push([a, t]),
    });
    win.setEnabled(true);
    const p = (target: string | null) => ({ counter: 6, slot: 1, resonance: false, refusal: null, target });
    win.setSeat({ token: null, preview: { anchor: p("ecl") } });
    root.querySelector<HTMLButtonElement>('button[data-action="anchor"]')?.click();
    expect(root.querySelector<HTMLElement>("[data-aim-name]")?.textContent, "Anchor starts on the card the server would take").toBe("Eclipse on Mae, in 1");
    root.querySelector<HTMLButtonElement>("[data-confirm]")?.click();
    expect(chosen.at(-1), "and sends it").toEqual(["anchor", "ecl"]);
    win.destroy();

    const root2 = document.createElement("div");
    document.body.append(root2);
    const win2 = mountCommandWindow(root2, {
      actions: ["brace", "mend", "ward", "quicken", "restore"],
      allies: () => [
        { id: "me", name: "Me (you)" },
        { id: "al", name: "Al" },
      ],
      onTarget: () => {},
      onChoose: (a: string, t: string | null) => chosen.push([a, t]),
    });
    win2.setEnabled(true);
    win2.setSeat({ token: null, preview: { quicken: p("al") } });
    root2.querySelector<HTMLButtonElement>('button[data-action="quicken"]')?.click();
    expect(root2.querySelector<HTMLElement>("[data-aim-name]")?.textContent, "Quicken starts on an ally, not on yourself").toBe("Al");
    win2.destroy();
  });

  it("U1 (rule 1): the ghost stands where the server's preview puts it, never where the counters would", async () => {
    const { createStrip } = (await import(resolve("src/client/strip/strip.ts"))) as {
      createStrip: (root: HTMLElement, o: unknown) => { render(s: unknown, me: string | null): void; preview(id: string | null, p: unknown): void };
    };
    const root = document.createElement("aside");
    document.body.append(root);
    const strip = createStrip(root, { manifest: { facing: "left", required: [], roles: {} }, orrerySvg: "<svg></svg>" });
    const tok = (id: string, counter: number, kind = "character", role = "striker") => ({
      id, kind, name: id, role, counter, hp: 100, maxHp: 100, hasted: false, braced: false, seat: 1,
      charge: 0, resource: 0, gravity: 0, drifting: false, echo: false, reactionReady: true,
    });
    const p = (counter: number, slot: number) => ({ counter, slot, resonance: false, refusal: null, target: null });
    const base = {
      battleId: "b", version: 1, tick: 1, tickMs: 150, turnMs: 12_000, plateMs: 12_000, status: "fighting", activeId: "me", turnDeadline: null,
      queue: [tok("me", 0), tok("al", 3), tok("orrery", 5, "boss", "orrery"), tok("bo", 8)],
      fallen: [], log: [], phase: 1, rings: [], cards: [], chain: { links: 0, potency: 1 }, pullSeats: 3, spentExposed: [],
      room: null, alignmentLeft: null, echoRoles: [], bastion: false, bastionCard: null,
    };
    // By the counters, a reset to 4 would land second (after Al's 3). The server says last: the ghost goes last.
    strip.render({ ...base, preview: { actorId: "me", actions: { jab: p(4, 3) } } }, "me");
    strip.preview("me", p(4, 3));
    const order = () => [...root.querySelectorAll<HTMLElement>("[data-token-id], [data-ghost-of]")].map((el) => el.dataset.tokenId ?? `ghost`);
    expect(order(), "the ghost in the slot the server named, not the counters' slot").toEqual(["me", "al", "orrery", "bo", "ghost"]);
    strip.preview("me", p(99, 0));
    expect(order(), "and a counter that would sort last, at the server's slot 0").toEqual(["me", "ghost", "al", "orrery", "bo"]);
    // The server stops previewing (the clock runs): the ghost goes, whatever the page hovered.
    strip.render({ ...base, activeId: null, preview: null }, "me");
    expect(order(), "no preview from the server: no ghost").toEqual(["me", "al", "orrery", "bo"]);
  });

  it("R5 (rule 11): a renderer that throws hands over to its reduced variant; nothing shown, nothing written", async () => {
    const { createConductor } = (await import(resolve("src/client/battle/conductor.ts"))) as {
      createConductor: (o: unknown) => { receive(m: unknown): void };
    };
    const written: string[] = [];
    const played: string[] = [];
    const noop = () => {};
    const quiet = new Proxy({}, { get: () => noop });
    const conductor = createConductor({
      scene: quiet,
      strip: quiet,
      audio: { play: noop },
      log: { append: (l: { text: string }) => written.push(l.text), history: noop },
      registry: {
        // full fails, reduced shows it
        jab: { full: () => { throw new Error("planted"); }, reduced: () => void played.push("jab reduced") },
        // both fail: nothing shows it
        cleave: { full: () => { throw new Error("planted"); }, reduced: () => { throw new Error("planted too"); } },
      },
      onState: noop,
    });
    const errors = console.error;
    console.error = () => {};
    try {
      const st = (log: { seq: number; text: string }[]) => ({ battleId: "b", version: 1, status: "fighting", queue: [], fallen: [], cards: [], log: log.map((l) => ({ ...l, tick: 1, kind: "action", actorId: "me" })) });
      conductor.receive({ type: "state", battle: st([]), events: [] });
      conductor.receive({ type: "state", battle: st([{ seq: 1, text: "Jab line." }, { seq: 2, text: "Cleave line." }]), events: [{ kind: "jab", seq: 1, actorId: "me" }, { kind: "cleave", seq: 2, actorId: "me" }] });
      await new Promise((r) => setTimeout(r, 50));
    } finally {
      console.error = errors;
    }
    expect(played, "the full variant threw: the reduced one showed it").toEqual(["jab reduced"]);
    expect(written, "shown, so written; the event nothing showed is never written down").toEqual(["Jab line."]);
  });

  it("B2 (rule 22): a code is folded in ASCII case only, so a look-alike is never made a real code", async () => {
    // Phase two's gate, the breaker's B2: JavaScript's full case mapping makes
    // a dotless ı an I and a long ſ an S, so "raıd" opened RAID and "Z7ZſC" a
    // real room the server refuses by those letters (404).
    const { door } = (await import(resolve("src/client/door.ts"))) as { door: (search: string, ask: (p: string) => Promise<unknown>) => Promise<string> };
    const ask = async () => ({ code: "QZ7MK" });
    expect(await door("?room=ra%C4%B1d", ask), "a dotless i stays what it is: the server will refuse it").toBe("RA\u0131D");
    expect(await door("?room=z7z%C5%BFc", ask), "a long s too").toBe("Z7Z\u017FC");
    expect(await door("?room=k3x9p", ask), "ASCII case, as the server folds it").toBe("K3X9P");

    const { mountJoin } = (await import(resolve("src/client/join/join.ts"))) as {
      mountJoin: (root: HTMLElement, o: unknown) => { show(me: unknown, here?: unknown): void };
    };
    const root = document.createElement("section");
    document.body.append(root);
    const sent: unknown[] = [];
    const join = mountJoin(root, { manifest: { facing: "left", required: [], roles: {} }, onJoin: async (d: unknown) => (sent.push(d), { ok: true }) });
    join.show(null, { code: "RAID", isPublic: true });
    const form = root.querySelector<HTMLFormElement>("form[data-join]")!;
    form.querySelector<HTMLInputElement>('input[name="door"][value="code"]')!.click();
    const field = form.querySelector<HTMLInputElement>('input[name="code"]')!;
    const name = form.querySelector<HTMLInputElement>('input[name="name"]')!;
    name.value = "Look Alike";
    form.querySelector<HTMLInputElement>('input[name="role"][value="mender"]')!.click();
    for (const typed of ["ra\u0131d", "Z7Z\u017FC"]) {
      field.value = typed;
      field.dispatchEvent(new Event("input", { bubbles: true }));
      expect(field.value, `the field doesn't turn ${typed} into ASCII`).not.toMatch(/^[A-Z0-9]+$/);
      form.requestSubmit();
      await new Promise((r) => setTimeout(r, 0));
    }
    expect(sent, "neither look-alike is sent as a real code").toEqual([]);
  });

  it("Q7 (rule 22): a padded code is the server's to refuse, not the client's to trim", async () => {
    const { door } = (await import(resolve("src/client/door.ts"))) as { door: (search: string, ask: (p: string) => Promise<unknown>) => Promise<string> };
    const asked: string[] = [];
    const ask = async (p: string) => (asked.push(p), { code: "QZ7MK" });
    expect(await door("?room=jkqp3%20", ask), "the padded code as given (ASCII case folded): the server refuses it").toBe("JKQP3 ");
    expect(await door("?room=%20%20", ask), "an address with no code in it: the default door").toBe("QZ7MK");
    expect(asked, "asked only for the empty one").toEqual(["/api/raid"]);
  });

  it("H20's note: a refusal for a returning session keeps focus on something it can see", async () => {
    // Phase two's gate, the breaker's note under H20: a returning session's
    // name is fixed and its field hidden, and a refusal focused that hidden
    // field, so focus fell to the page body.
    const { mountJoin } = (await import(resolve("src/client/join/join.ts"))) as {
      mountJoin: (root: HTMLElement, o: unknown) => { show(me: unknown, here?: unknown): void };
    };
    const root = document.createElement("section");
    document.body.append(root);
    const join = mountJoin(root, {
      manifest: { facing: "left", required: [], roles: {} },
      onJoin: async () => ({ ok: false, error: "You sat down as Ret, and a name stays with you: sit down as Ret." }),
    });
    const me = { character: { id: "c1", name: "Ret", role: "warden", turns: 3, damage: 0, healing: 0, wins: 0, losses: 0 }, battles: [] };
    join.show(me, { code: "RAID", isPublic: true });
    const form = root.querySelector<HTMLFormElement>("form[data-join]")!;
    const name = form.querySelector<HTMLInputElement>('input[name="name"]')!;
    expect(name.hidden, "a returning session's name field is hidden (rule 24)").toBe(true);
    form.querySelector<HTMLInputElement>('input[name="role"][value="warden"]')!.click();
    form.requestSubmit();
    await new Promise((r) => setTimeout(r, 0));
    const at = document.activeElement as HTMLElement | null;
    expect(at, "focus is somewhere").not.toBeNull();
    expect(at === name || !!at?.closest("[hidden]"), "focus isn't on the hidden name field").toBe(false);
    expect(form.contains(at), "it stays in the form, where the refusal is").toBe(true);
    expect(form.querySelector(".join-error")?.textContent, "and the refusal is said").toMatch(/name stays/);
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
