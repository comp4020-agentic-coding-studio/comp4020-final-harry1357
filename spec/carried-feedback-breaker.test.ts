import { describe, expect, it } from "vitest";
import { boot, cleanScratch, scratchDatabase } from "./boot.ts";
import { bossTurn, engine, lobbyTable, type Battle, type Step } from "./engine.ts";

// The feedback gate's breaker findings still open at the fix round's HEAD
// (docs/review/feedback.md): V1 (a Brace offered to a table that had Braced,
// on a blow on everyone), V6 (a server sentence that begins in lower case) and
// Q6 (a line on stdout that isn't log.ts's: rule 32, "Nothing else writes to
// stdout"). Q6 is older than this phase, and is fixed in this gate.

interface Ending {
  answers: { role: string; action: string; by: string | null }[];
  found: string[];
  line: string;
}
const edit = (b: Battle, change: (x: Battle) => void): Battle => {
  const next = structuredClone(b);
  change(next);
  return next;
};
const endOf = (s: Step): Ending => {
  const e = s.effects.events.find((ev) => ev.kind === "end")?.ending as Ending | undefined;
  if (!e) throw new Error(`no ending (status ${s.battle.status})`);
  return e;
};

describe("V1: a blow on everyone, met by every seat's Brace, offers no Brace", () => {
  for (const intent of ["perihelion", "revolution"] as const) {
    it(`a ${intent} on a table that had all Braced, still downing it`, async () => {
      const e = await engine();
      let b = lobbyTable(e, ["striker"], [{ id: "mender-echo-0", role: "mender" }]);
      b = edit(b, (x) => {
        x.cards = [];
        for (const f of x.standing.filter((f) => f.kind === "character")) {
          f.braced = true;
          f.hp = 3;
        }
      });
      b = e.announce(b, { intent, targetId: "party", amount: 200, countdown: 0 });
      const ending = endOf(bossTurn(e, b));
      expect(ending.found, "every seat was Braced").toContain("all-braced");
      expect(ending.answers.map((a) => a.action), "the Brace was made: it's no answer the table lacked").not.toContain("brace");
    });
  }

  it("one seat unbraced: every seat's Brace is still an answer", async () => {
    const e = await engine();
    let b = lobbyTable(e, ["striker"], [{ id: "mender-echo-0", role: "mender" }]);
    b = edit(b, (x) => {
      x.cards = [];
      for (const f of x.standing.filter((f) => f.kind === "character")) f.hp = 3;
      x.standing.find((f) => f.id === "striker-1")!.braced = true;
    });
    b = e.announce(b, { intent: "revolution", targetId: "party", amount: 200, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending.answers.map((a) => a.action)).toContain("brace");
  });
});

describe("V6: the server's sentence begins with a capital", () => {
  it("a Revolution with no Warden at the table: \"Every seat's Brace…\"", async () => {
    const e = await engine();
    let b = lobbyTable(e, ["striker"], [{ id: "mender-echo-0", role: "mender" }]);
    b = edit(b, (x) => {
      x.cards = [];
      for (const f of x.standing.filter((f) => f.kind === "character")) f.hp = 3;
    });
    b = e.announce(b, { intent: "revolution", targetId: "party", amount: 200, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending.line).toMatch(/\. Every seat's Brace would have met it\.$/);
  });
});

describe("Q6: nothing but log.ts writes to stdout (rule 32)", () => {
  it("a room that expires is said in a key=value line, not a sentence", async () => {
    const db = scratchDatabase();
    const server = await boot(db, { ROOM_EMPTY_MS: "1500", TICK_MS: "20" });
    try {
      const made = await fetch(new URL("/api/rooms", server.base), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Quinn", role: "warden" }),
      });
      expect(made.status).toBe(201);
      const { code } = (await made.json()) as { code: string };
      const cookie = made.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
      await fetch(new URL(`/api/rooms/${code}/leave`, server.base), { method: "POST", headers: { cookie } });
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline && (await fetch(new URL(`/api/rooms/${code}`, server.base))).status !== 404) await new Promise((r) => setTimeout(r, 200));
      expect((await fetch(new URL(`/api/rooms/${code}`, server.base))).status, "the room expired").toBe(404);
      await new Promise((r) => setTimeout(r, 300));
      const lines = server.stdout();
      const prose = lines.filter((l) => !/^ts=\S+ /.test(l));
      expect(prose, "every stdout line is log.ts's key=value line").toEqual([]);
      expect(lines.some((l) => / action=expire /.test(l) && l.includes(`code=${code}`)), "and the expiry is one of them").toBe(true);
    } finally {
      await server.kill();
      cleanScratch();
    }
  }, 30_000);
});

// The confirm pass's C1: a regression the fix round introduced. Rule 34 says the ending names "what it found
// there"; the fix round recorded a swap and every seat's Brace as tags, and a met card's line then said only
// "It was met", never by what. Each tag the server records is said in words.
describe("C1: a met card says what met it", () => {
  it("a blow on everyone, every seat Braced, a Bastion standing and the outer ring Broken: all three, in words", async () => {
    const e = await engine();
    let b = lobbyTable(e, ["warden"], [{ id: "mender-echo-0", role: "mender" }]);
    b = edit(b, (x) => (x.cards = []));
    // Announcing a Perihelion raises the outer ring's shield; it is Broken after.
    b = e.announce(b, { intent: "perihelion", targetId: "party", amount: 200, countdown: 0 });
    b = edit(b, (x) => {
      (x as Battle & { bastion: boolean }).bastion = true;
      const outer = x.rings.find((r) => r.id === "outer")!;
      outer.pips = 0;
      outer.broken = true;
      for (const f of x.standing.filter((f) => f.kind === "character")) {
        f.braced = true;
        f.hp = 1;
      }
    });
    const ending = endOf(bossTurn(e, b));
    expect(ending.answers, "every answer was made").toEqual([]);
    expect(ending.line).toBe(
      "Perihelion landed on everyone, a Bastion standing, the outer ring Broken and every seat Braced. It was met, and still took the last of them.",
    );
  });

  it("a swapped Eclipse on a Warden who stood into it: \"taken on purpose\"", async () => {
    const e = await engine();
    let b = lobbyTable(e, ["warden"]);
    b = edit(b, (x) => {
      x.cards = [];
      x.standing.find((f) => f.id === "warden-1")!.hp = 1;
    });
    b = e.announce(b, { intent: "eclipse", targetId: "warden-1", amount: 40, countdown: 1 });
    const card = b.cards.find((c) => c.intent === "eclipse")!;
    // The Warden Intercepts the card aimed at themself: a swap, and a Ward.
    b = e.act(b, "warden-1", "intercept", card.id, { now: 1_000_000, turnMs: 12_000 }).battle;
    b = edit(b, (x) => {
      x.standing.find((f) => f.id === "warden-1")!.warded = false;
      x.cards.find((c) => c.id === card.id)!.countdown = 0;
    });
    const ending = endOf(bossTurn(e, b));
    expect(ending.found, "a Warden took it on purpose").toContain("swapped");
    expect(ending.line).toBe("Eclipse landed on warden 1, taken on purpose, unwarded and unbraced. warden 1's Brace would have met it.");
  });
});
