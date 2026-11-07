// @vitest-environment jsdom
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { bossTurn, engine, lobbyTable, turn, type Battle, type Engine, type Step } from "./engine.ts";

// The ending names its cause (ADR-012, piece 1; CLAUDE.md rule 34). ADR-011's
// teeth each name the mechanic and the seat "so the fight can later say what
// killed you": here it does. The server keeps an account of the fight as each
// card lands, and when the fight ends it composes the ending from that account
// alone: the card, its target, what it found there, and the answers the table
// had, from ADR-011's teeth, each with the person at this table who held it,
// or with its role when only an Echo did (an Echo never answers, rule 25). On
// a win: the blow, who Broke its ring, and the longest Chain. It rides on the
// `end` event and on the state, and the screen prints the server's line; the
// client composes none of it.

interface Ending {
  outcome: "won" | "lost" | "abandoned";
  cardId: string | null;
  intent: string | null;
  targetId: string | null;
  found: string[];
  answers: { action: string; by: string | null; role: string }[];
  by: string | null;
  ringId: string | null;
  brokenBy: string | null;
  chain: number;
  line: string;
}

const edit = (b: Battle, change: (x: Battle) => void): Battle => {
  const next = structuredClone(b);
  change(next);
  return next;
};
const endOf = (s: Step): Ending | undefined => s.effects.events.find((ev) => ev.kind === "end")?.ending as Ending | undefined;
const stateEnding = (e: Engine, b: Battle): unknown => e.view(b, { tickMs: 150, turnMs: 12_000 }).ending;
const said = (a: Ending["answers"]) => a.map((x) => `${x.role}:${x.action}:${x.by ?? "-"}`);

/** A private room's fight: these people (ids role-1, role-2…), then Echoes of these roles (ids role-echo-i), Started. */
async function room(people: string[], echoes: string[] = []) {
  const e = await engine();
  const b = lobbyTable(
    e,
    people,
    echoes.map((r, i) => ({ id: `${r}-echo-${i}`, role: r })),
  );
  return { e, b, echoIds: new Set(echoes.map((r, i) => `${r}-echo-${i}`)) };
}

/** Everyone but `keep` is already down, and the strip is clear: the next blow that downs `keep` ends the fight. */
function leaveOnly(b: Battle, keep: string): Battle {
  return edit(b, (x) => {
    for (const f of x.standing.filter((f) => f.kind === "character" && f.id !== keep)) {
      f.hp = 0;
      x.fallen.push(f);
    }
    x.standing = x.standing.filter((f) => f.kind !== "character" || f.id === keep);
    (x as Battle & { someoneFell: boolean }).someoneFell = true;
    x.cards = [];
  });
}

describe("a loss names the card, the seat, what it found there, and the answers the table had", () => {
  it("a lethal Lunge on an unbraced seat at Gravity 2: the swap, a Ward, and the seat's own Brace", async () => {
    const { e, b: started, echoIds } = await room(["striker"], ["warden", "mender"]);
    let b = leaveOnly(started, "striker-1");
    b = edit(b, (x) => (x.standing.find((f) => f.id === "striker-1")!.gravity = 2));
    b = e.announce(b, { intent: "lunge", targetId: "striker-1", amount: 20, countdown: 0 });
    const step = bossTurn(e, b);
    expect(step.battle.status, "the Lunge downs the last seat: the fight is lost").toBe("lost");

    const ending = endOf(step);
    expect(ending, "the end event carries the ending").toBeDefined();
    expect(ending, "the card, its intent and its target").toMatchObject({ outcome: "lost", intent: "lunge", targetId: "striker-1" });
    expect(ending!.cardId, "the card's own id, from the strip").toMatch(/^card-\d+$/);
    expect(ending!.found, "what it found: Gravity 2 carried in, unbraced, unwarded").toEqual(
      expect.arrayContaining(["gravity:2", "unbraced", "unwarded"]),
    );
    // The Warden and the Mender at this table are Echoes: their answers are named by role, never by the Echo.
    expect(said(ending!.answers)).toEqual(["warden:anchor:-", "warden:intercept:-", "mender:ward:-", "mender:veil:-", "striker:brace:striker-1"]);
    expect(ending!.answers.some((a) => a.by !== null && echoIds.has(a.by)), "an Echo is never named as an answer").toBe(false);
    expect(ending!.line, "in plain words, the server's").toBe(
      "Lunge landed on striker 1 at Gravity 2, unbraced. A Warden's Anchor or Intercept, a Mender's Ward or Veil, or striker 1's Brace would have met it.",
    );
    expect(stateEnding(e, step.battle), "the state carries the same ending, for a page that arrives after it").toEqual(ending);
    const endLine = step.battle.log.find((l) => l.kind === "end");
    expect(endLine?.text, "and the end's log line says it, so a finished fight's log keeps it").toContain(ending!.line);
  });

  it("a whole Eclipse on a seat that isn't Warded: only the answers of roles at this table", async () => {
    const { e, b: started } = await room(["breaker"], ["mender"]);
    let b = leaveOnly(started, "breaker-1");
    b = e.announce(b, { intent: "eclipse", targetId: "breaker-1", amount: 20, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending, "an Eclipse downs the last seat").toMatchObject({ outcome: "lost", intent: "eclipse", targetId: "breaker-1" });
    expect(ending!.found).toEqual(expect.arrayContaining(["unwarded", "unbraced"]));
    // No Warden sat at this table, so no swap is offered: the answers the table had, not every answer there is.
    expect(said(ending!.answers)).toEqual(["mender:ward:-", "mender:veil:-", "breaker:brace:breaker-1"]);
    expect(ending!.line).toBe("Eclipse landed on breaker 1, unwarded and unbraced. A Mender's Ward or Veil, or breaker 1's Brace would have met it.");
  });

  it("an unmet Perihelion on everyone: the Bastion, the Break and a Brace, with the person who held each", async () => {
    const { e, b: started } = await room(["warden"], ["breaker"]);
    const peri = started.cards.find((c) => c.intent === "perihelion")?.amount;
    expect(peri, "the Orrery announces a Perihelion at the pull").toBeTypeOf("number");
    let b = leaveOnly(started, "warden-1");
    b = e.announce(b, { intent: "perihelion", targetId: "party", amount: peri as number, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending, "an unmet Perihelion on everyone").toMatchObject({ outcome: "lost", intent: "perihelion", targetId: "party" });
    expect(ending!.found).toEqual(expect.arrayContaining(["no-bastion", "outer-whole"]));
    expect(said(ending!.answers)).toEqual(["warden:bastion:warden-1", "breaker:shatter:-", "breaker:fracture:-", "any:brace:-"]);
    expect(ending!.line).toBe(
      "Perihelion landed on everyone, no Bastion standing and the outer ring whole. warden 1's Bastion, a Breaker's Shatter or Fracture, or every seat's Brace would have met it.",
    );
  });

  it("the third Alignment: nothing answers it, and the line says so", async () => {
    const { e, b: started } = await room(["chronist"]);
    let b = edit(started, (x) => {
      x.cards = [];
      (x as Battle & { orreryScript: { aligned: number } }).orreryScript.aligned = 2;
    });
    b = e.announce(b, { intent: "alignment", targetId: "party", amount: null, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending, "the Grand Alignment wipes the table").toMatchObject({ outcome: "lost", intent: "alignment", targetId: "party", answers: [] });
    expect(ending!.line).toMatch(/^The Grand Alignment completed\. Nothing answers it but the Orrery falling first\./);
  });

  it("names the card that downed the last seat, not one that downed an earlier seat on the same turn", async () => {
    const { e, b: started } = await room(["striker"], ["mender"]);
    // The Mender Echo is nearly down; a Revolution takes it, then the Eclipse takes the person.
    let b = edit(started, (x) => {
      x.cards = [];
      x.standing.find((f) => f.id === "mender-echo-0")!.hp = 1;
    });
    b = e.announce(b, { intent: "revolution", targetId: "party", amount: 5, countdown: 0 });
    b = e.announce(b, { intent: "eclipse", targetId: "striker-1", amount: 20, countdown: 0 });
    const step = bossTurn(e, b);
    expect(step.battle.status, "both seats are down").toBe("lost");
    expect(endOf(step), "the Eclipse on the last seat, not the Revolution").toMatchObject({ intent: "eclipse", targetId: "striker-1" });
  });
});

describe("a win names the blow, the Break that opened it, and the longest Chain", () => {
  it("a Finisher into a Broken ring: who struck it, who Broke the ring, and the Chain", async () => {
    const { e, b: started } = await room(["striker", "breaker"]);
    let b = edit(started, (x) => {
      x.cards = [];
      x.standing.find((f) => f.id === "orrery")!.hp = 1;
      x.standing.find((f) => f.id === "striker-1")!.resource = 3;
      x.standing.find((f) => f.id === "breaker-2")!.resource = 3;
      const outer = x.rings.find((r) => r.id === "outer")!;
      outer.pips = 1;
      outer.weakness = outer.element;
    });
    b = turn(e, b, "breaker-2", "shatter", "outer").battle;
    expect(b.rings.find((r) => r.id === "outer")!.broken, "the Breaker Broke the outer ring").toBe(true);
    const won = turn(e, b, "striker-1", "finisher", "outer");
    expect(won.battle.status, "the Finisher ends it").toBe("won");
    const ending = endOf(won);
    expect(ending, "the blow, the ring, who Broke it").toMatchObject({
      outcome: "won",
      by: "striker-1",
      intent: "finisher",
      ringId: "outer",
      brokenBy: "breaker-2",
      chain: 2,
    });
    expect(ending!.line).toBe("striker 1's Finisher into the Broken outer ring ended it. breaker 2 Broke the ring. The longest Chain was 2.");
    expect(stateEnding(e, won.battle)).toEqual(ending);
  });

  it("a win with no Break still names the blow and the Chain", async () => {
    const { e, b: started } = await room(["striker"], ["mender"]);
    const b = edit(started, (x) => {
      x.cards = [];
      x.standing.find((f) => f.id === "orrery")!.hp = 1;
    });
    const ending = endOf(turn(e, b, "striker-1", "jab", "outer"));
    expect(ending).toMatchObject({ outcome: "won", by: "striker-1", intent: "jab", ringId: "outer", brokenBy: null });
    expect(ending!.line).toMatch(/^striker 1's Jab into the outer ring ended it\. The longest Chain was \d+\.$/);
  });
});

describe("the screen prints the server's line, and composes none of it", () => {
  // A line no client could compose: if the screen shows it, it showed the server's.
  const LINE = "Zq landed on Xy at Gravity 9, unbraced. Nothing at this table would have met it.";

  function recording(reduced: boolean) {
    const made: [string, ...unknown[]][] = [];
    const api = (ns: string) =>
      new Proxy({}, { get: (_t, prop) => (prop === "then" ? undefined : (...args: unknown[]) => (made.push([`${ns}.${String(prop)}`, ...args]), Promise.resolve())) });
    const state = { battleId: "b", status: "lost", queue: [], fallen: [], cards: [], rings: [] };
    return { made, ctx: { scene: api("scene"), strip: api("strip"), audio: api("audio"), reduced, wait: () => Promise.resolve(), state, me: "ally-1" } };
  }

  it("the end renderer draws the event's own line, in both variants, and declares it as its state", async () => {
    const mod = (await import(resolve("src/client/battle/registry.ts"))) as {
      RENDERERS: Record<string, { full: (c: unknown, e: unknown) => unknown; reduced: (c: unknown, e: unknown) => unknown }>;
      EXPECTED_STATE: Record<string, [string, ...unknown[]][]>;
    };
    const event = { kind: "end", seq: 9, tick: 1, outcome: "lost", ending: { outcome: "lost", line: LINE } };
    for (const variant of ["full", "reduced"] as const) {
      const { made, ctx } = recording(variant === "reduced");
      await mod.RENDERERS.end[variant](ctx, event);
      expect(made.find((c) => c[0] === "scene.cause")?.[1], `${variant}: the cause is drawn, as sent`).toBe(LINE);
    }
    expect(mod.EXPECTED_STATE.end.map((x) => x[0]), "the end's declared state names the cause").toContain("scene.cause");
  });

  it("the end panel prints the server's line under the outcome, before going on is offered", async () => {
    globalThis.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
    const { mountJoin } = (await import(resolve("src/client/join/join.ts"))) as {
      mountJoin: (root: HTMLElement, o: unknown) => { ended(outcome: string, next?: unknown, cause?: string | null): void };
    };
    const root = document.createElement("section");
    document.body.append(root);
    const join = mountJoin(root, { manifest: { facing: "left", required: [], roles: {} }, onJoin: async () => ({ ok: true }) });
    join.ended("lost", undefined, LINE);
    const panel = root.querySelector<HTMLElement>("[data-join-end]");
    const cause = panel?.querySelector<HTMLElement>("[data-cause]");
    expect(cause?.textContent, "the panel prints the line as sent").toBe(LINE);
    expect(cause?.hidden, "and shows it").toBe(false);
    const link = panel?.querySelector("a");
    expect(cause!.compareDocumentPosition(link!) & Node.DOCUMENT_POSITION_FOLLOWING, "the cause comes before the link that goes on").toBeTruthy();
    join.ended("won", undefined, null);
    expect(panel?.querySelector<HTMLElement>("[data-cause]")?.hidden, "no line sent: none shown, and never one of the client's").toBe(true);
  });

  it("the lobby's last-fight line carries the cause before its host's Start", async () => {
    const { createLobby } = (await import(resolve("src/client/lobby/lobby.ts"))) as {
      createLobby: (root: HTMLElement, o: unknown) => { show(s: unknown, me: string | null, code: string | null): void };
    };
    const root = document.createElement("section");
    document.body.append(root);
    const lobby = createLobby(root, {
      onStart: async () => null,
      onLeave: async () => null,
      onEcho: async () => null,
      lastOutcome: () => "lost",
      lastCause: () => LINE,
    });
    lobby.show(
      { battleId: "b2", status: "waiting", lobby: true, hostId: "me", echoRoles: [], queue: [{ id: "me", kind: "character", name: "Me", role: "warden", seatedBy: null }] },
      "me",
      "ABCDE",
    );
    const cause = root.querySelector<HTMLElement>("[data-lobby-cause]");
    expect(cause?.textContent, "the last fight's cause, as the server said it").toBe(LINE);
    expect(cause?.hidden).toBe(false);
    const start = root.querySelector("[data-start]");
    expect(cause!.compareDocumentPosition(start!) & Node.DOCUMENT_POSITION_FOLLOWING, "said before Start").toBeTruthy();
  });

  it("the screen hands the end panel the state's ending, whatever the page saw", async () => {
    const { createScreen } = (await import(resolve("src/client/screen.ts"))) as {
      createScreen: (o: unknown) => { state(s: unknown, me: string | null): void; lastCause(): string | null };
    };
    const endedWith: unknown[][] = [];
    const screen = createScreen({
      root: document.createElement("div"),
      banner: () => {},
      join: { show() {}, hide() {}, ended: (...args: unknown[]) => endedWith.push(args), clear() {} },
      lobby: { show() {}, hide() {} },
    });
    screen.state({ battleId: "A", status: "fighting", queue: [{ id: "me", kind: "character" }], fallen: [] }, "me");
    screen.state({ battleId: "A", status: "lost", queue: [], fallen: [], ending: { outcome: "lost", line: LINE } }, "me");
    expect(endedWith.at(-1), "the panel gets the outcome and the server's line").toEqual(["lost", LINE]);
    expect(screen.lastCause(), "and the lobby can ask for it").toBe(LINE);
  });

  it("no client module composes a cause: the words come only from the server", async () => {
    for (const file of ["src/client/battle/effects/table.ts", "src/client/join/join.ts", "src/client/lobby/lobby.ts", "src/client/screen.ts", "src/client/main.ts"]) {
      const src = await readFile(resolve(file), "utf8");
      expect(src, `${file} writes "would have met it" itself`).not.toMatch(/would have met it/);
      expect(src, `${file} writes "landed on" itself`).not.toMatch(/landed on/);
    }
  });
});
