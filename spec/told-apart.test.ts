import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, inject, it } from "vitest";
import { boot, cleanScratch, scratchDatabase, type Booted } from "./boot.ts";
import { battle, battleLog, boss, join, newBattle, sleep, suffix, token, watch, type BattleState, type Watcher } from "./raid.ts";

// Told apart, in the logs (docs/adr/008, CLAUDE.md rules 29-32). Two people at
// one table are two sessions, and the server keeps them apart in two places:
// in what each may change, and in what it writes down. A session acts only for
// the seat it created and only within its role. A session with no seat
// watches and never acts. Every applied action and every refusal is one line on
// stdout, which names the session by a short id that is never its cookie.
//
// The first three claims hold the running app, like the rest of spec/. The
// log claims need a server whose stdout this file can read, so they boot their
// own from source (spec/boot.ts), as restart and pacing do.
//
// Written against main's first build (Heralds, Lancers and Bulwarks; Strike
// and Hasten) and carried onto the overhaul's roles and actions by the merge
// that brought it (the owner's ruling): the claims are ADR-008's, unchanged;
// the names are this build's. A Striker's Jab and Cleave are aimed at the
// Orrery, a Mender's Mend and Quicken at an ally, a Chronist's Delay at a boss
// card; a Striker trying a Mend is outside its catalogue. A bare battle pulls
// READY_MS (eight seconds) after its first seat (ADR-009).
const base = inject("baseUrl");

const open: Watcher[] = [];
afterEach(() => {
  for (const w of open.splice(0)) w.close();
});
afterAll(cleanScratch);

/** An action request with whatever body and cookie the test chooses; the status it was answered with. */
async function send(at: string, battleId: string, cookie: string, body: unknown): Promise<number> {
  const res = await fetch(new URL(`/api/battles/${encodeURIComponent(battleId)}/actions`, at), {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
  await res.arrayBuffer();
  return res.status;
}

/** A GET with whatever cookie the test chooses, or none. */
const read = (at: string, path: string, cookie: string): Promise<Response> =>
  fetch(new URL(path, at), { headers: cookie ? { cookie } : {} });

/** Poll the battle until `test` holds. The plate holds while its character thinks, so a poll can't miss a turn. */
async function until(
  at: string,
  battleId: string,
  test: (st: BattleState) => boolean,
  what: string,
  ms = 25_000,
): Promise<BattleState> {
  for (const deadline = Date.now() + ms; ; await sleep(25)) {
    const st = await battle(at, battleId);
    if (test(st)) return st;
    if (Date.now() > deadline) {
      throw new Error(`waited ${ms}ms for ${what}; the battle is ${st.status}, ${st.activeId ?? "nobody"} on the plate`);
    }
  }
}

async function actions(at: string, battleId: string): Promise<(string | null)[]> {
  const { entries } = await battleLog(at, battleId);
  return (entries as { kind: string; actorId: string | null }[]).filter((e) => e.kind === "action").map((e) => e.actorId);
}

/** The values in a `name=value; name=value` cookie header: what must never reach a log. */
const values = (cookie: string): string[] =>
  cookie
    .split("; ")
    .filter(Boolean)
    .map((pair) => pair.slice(pair.indexOf("=") + 1));

/** The same cookie name, with a value the server never minted. */
const forge = (cookie: string): string => `${cookie.slice(0, cookie.indexOf("="))}=${randomBytes(32).toString("base64url")}`;

describe("who may change what (docs/adr/008)", () => {
  it("a session can't act for a seat it didn't create, on its own turn or on that seat's", async () => {
    const battleId = await newBattle(base);
    const s = suffix();
    const a = await join(base, battleId, `ada-${s}`, "striker");
    const b = await join(base, battleId, `bo-${s}`, "mender");
    expect([a.status, b.status], "both seated").toEqual([200, 200]);
    const A = a.characterId as string;
    const B = b.characterId as string;

    // On A's own turn: a body naming B's seat, under each name a seat goes by.
    const up = await until(base, battleId, (st) => st.activeId === A, "A's turn");
    for (const field of ["seatId", "characterId", "actorId"]) {
      expect(
        await send(base, battleId, a.cookie, { action: "jab", [field]: B }),
        `A's cookie with ${field} naming B's seat, on A's turn`,
      ).toBe(403);
    }
    const still = await battle(base, battleId);
    expect(still.activeId, "A's turn isn't spent by a request made for someone else").toBe(A);
    expect(boss(still)?.hp, "and nothing landed").toBe(boss(up)?.hp);
    expect(await actions(base, battleId), "no action in the log").toEqual([]);

    // Naming your own seat changes nothing.
    expect(await send(base, battleId, a.cookie, { action: "jab", seatId: A }), "A naming A's own seat").toBe(200);

    // On B's turn, A's cookie naming B is refused as not A's seat, not as not A's turn.
    await until(base, battleId, (st) => st.activeId === B, "B's turn");
    expect(
      await send(base, battleId, a.cookie, { action: "jab", characterId: B }),
      "A's cookie naming B's seat, on B's turn",
    ).toBe(403);
    expect((await battle(base, battleId)).activeId, "B's turn is still B's").toBe(B);
    expect(await actions(base, battleId), "one action in the log, and it's A's own").toEqual([A]);
  }, 45_000);

  it("a cookie naming another seat's action is refused with 403 and one log line, whatever the action aims at", async () => {
    // The owner's ruling on the merge: ADR-008's property, proven on this build for an action aimed at an ally
    // (a Mender's Mend), one aimed at the Orrery (a Striker's Jab) and one aimed at a boss card (a Chronist's
    // Delay). Each refused before the turn is looked at, and each exactly one refusal line naming both seats.
    const server = await boot(scratchDatabase(), { TICK_MS: "20" });
    try {
      const at = server.base;
      const battleId = await newBattle(at);
      const s = suffix();
      const seats = {
        striker: await join(at, battleId, `sta-${s}`, "striker"),
        mender: await join(at, battleId, `men-${s}`, "mender"),
        chronist: await join(at, battleId, `chr-${s}`, "chronist"),
      };
      for (const [role, j] of Object.entries(seats)) expect(j.status, `the ${role} seated`).toBe(200);
      const id = (r: keyof typeof seats) => seats[r].characterId as string;
      const st = await until(at, battleId, (x) => x.status === "fighting" && (x as BattleState & { cards?: unknown[] }).cards!.length > 0, "the pull and a card on the strip");
      const card = ((st as BattleState & { cards: { id: string }[] }).cards)[0].id;

      // Each seat's cookie, naming another seat as the actor of its own role's action.
      const cases = [
        { what: "an ally-aimed Mend", cookie: seats.mender.cookie, own: id("mender"), other: id("striker"), body: { action: "mend", targetId: id("striker"), actorId: id("striker") } },
        { what: "an Orrery-aimed Jab", cookie: seats.striker.cookie, own: id("striker"), other: id("chronist"), body: { action: "jab", seatId: id("chronist") } },
        { what: "a card-aimed Delay", cookie: seats.chronist.cookie, own: id("chronist"), other: id("mender"), body: { action: "delay", targetId: card, characterId: id("mender") } },
      ];
      for (const c of cases) expect(await send(at, battleId, c.cookie, c.body), `${c.what}, for another seat`).toBe(403);
      expect(await actions(at, battleId), "nothing was applied").toEqual([]);

      const refused = await lines(server, (ls) => ls.filter((l) => l.outcome === "refused").length >= cases.length, "three refusal lines");
      await sleep(250);
      const all = linesOf(server).filter((l) => l.outcome === "refused");
      expect(all.length, "exactly one refusal line per request").toBe(cases.length);
      for (const c of cases) {
        const mine = refused.filter((l) => l.outcome === "refused" && l.seat === c.own);
        expect(mine.length, `${c.what}: one line, under the seat that sent it`).toBe(1);
        expect(Object.values(mine[0]), `${c.what}: and it names the seat it asked to act for`).toContain(c.other);
        expect(mine[0].status, `${c.what}: refused with 403`).toBe("403");
      }
    } finally {
      await server.kill();
    }
  }, 45_000);

  it("a session with no seat can read the fight and can't act in it", async () => {
    const battleId = await newBattle(base);
    const s = suffix();
    const a = await join(base, battleId, `ada-${s}`, "striker");
    const elsewhere = await join(base, await newBattle(base), `cy-${s}`, "warden");
    expect([a.status, elsewhere.status], "one seat here, one at another table").toEqual([200, 200]);
    const A = a.characterId as string;
    const forged = forge(a.cookie);
    const up = await until(base, battleId, (st) => st.activeId === A, "A's turn");

    // Reading needs no seat: the state, the log and the socket are open to anyone.
    for (const [who, cookie] of [
      ["no cookie", ""],
      ["a cookie the server never minted", forged],
      ["a seat at another table", elsewhere.cookie],
    ]) {
      const state = await read(base, `/api/battles/${battleId}`, cookie);
      expect(state.status, `${who} reading the fight`).toBe(200);
      expect(((await state.json()) as BattleState).queue.map((t) => t.id), `${who} sees the strip`).toContain(A);
      const log = await read(base, `/api/battles/${battleId}/log`, cookie);
      expect(log.status, `${who} reading the log`).toBe(200);
      await log.arrayBuffer();
    }
    const w = watch(base, battleId);
    open.push(w);
    await w.opened;
    await w.waitFor((st) => token(st, A) !== undefined, "the strip over the socket, with no cookie", 5_000);

    // Acting needs a seat in this fight, whatever the request says.
    for (const [who, cookie, body] of [
      ["no cookie", "", { action: "jab" }],
      ["a cookie the server never minted", forged, { action: "jab" }],
      ["a seat at another table", elsewhere.cookie, { action: "jab" }],
      ["no cookie, naming A's seat", "", { action: "jab", seatId: A }],
      ["a forged cookie, naming A's seat", forged, { action: "jab", characterId: A }],
    ] as const) {
      expect(await send(base, battleId, cookie, body), `${who}, acting on A's turn`).toBe(403);
    }
    const after = await battle(base, battleId);
    expect(after.activeId, "A's turn is still A's").toBe(A);
    expect(boss(after)?.hp, "and nothing landed").toBe(boss(up)?.hp);
    expect(await actions(base, battleId), "no action in the log").toEqual([]);
  }, 45_000);

  it("an action outside the actor's role is refused, a target must be in the same fight, and a blow reaches only the Orrery", async () => {
    const battleId = await newBattle(base);
    const s = suffix();
    const k = await join(base, battleId, `kit-${s}`, "striker");
    const m = await join(base, battleId, `mo-${s}`, "mender");
    const x = await join(base, await newBattle(base), `xi-${s}`, "warden");
    expect([k.status, m.status, x.status], "three seated, one of them elsewhere").toEqual([200, 200, 200]);
    const K = k.characterId as string;
    const M = m.characterId as string;

    const up = await until(base, battleId, (st) => st.activeId === K, "the Striker's turn");
    for (const [what, body] of [
      ["a Mender's Mend", { action: "mend", targetId: M }],
      ["a Warden's Counterweight", { action: "counterweight" }],
      ["an action no role has", { action: "fireball" }],
      ["a Jab aimed at someone at another table", { action: "jab", targetId: x.characterId }],
      ["a Jab aimed at an ally", { action: "jab", targetId: M }],
    ] as const) {
      expect(await send(base, battleId, k.cookie, body), `the Striker trying ${what}`).toBe(400);
    }
    const still = await battle(base, battleId);
    expect(still.activeId, "the Striker is still on the plate").toBe(K);
    expect(boss(still)?.hp, "and nothing landed").toBe(boss(up)?.hp);
    expect(token(still, M)?.hp, "on the Mender either").toBe(token(up, M)?.hp);
    expect(await actions(base, battleId), "no action in the log").toEqual([]);

    // A Jab lands on the Orrery, and only there: a blow aimed at an ally is refused above, never redirected.
    const w = watch(base, battleId);
    open.push(w);
    await w.opened;
    const from = w.events.length;
    expect(await send(base, battleId, k.cookie, { action: "jab" }), "the Striker's Jab").toBe(200);
    await w.waitFor(() => w.events.slice(from).some((e) => e.kind === "jab"), "the Jab over the socket", 5_000);
    const after = await battle(base, battleId);
    expect(boss(after)?.hp, "the Orrery took it").toBeLessThan(boss(up)?.hp as number);
    expect(token(after, M)?.hp, "the Mender didn't").toBe(token(up, M)?.hp);
  }, 45_000);
});

// --- the log --------------------------------------------------------------

/** A line of key=value pairs, or null if any part of it isn't. A value is bare, or a JSON string in double quotes. */
function parse(line: string): Record<string, string> | null {
  const pair = /([A-Za-z_][A-Za-z0-9_]*)=("(?:[^"\\]|\\.)*"|[^\s"=\\]+)(?: +|$)/y;
  const fields = new Map<string, string>();
  for (let at = 0; at < line.length; at = pair.lastIndex) {
    pair.lastIndex = at;
    const m = pair.exec(line);
    if (!m) return null;
    const [, key, raw] = m;
    if (fields.has(key)) return null;
    try {
      fields.set(key, raw.startsWith('"') ? (JSON.parse(raw) as string) : raw);
    } catch {
      return null;
    }
  }
  return fields.size > 0 ? Object.fromEntries(fields) : null;
}

type Line = Record<string, string>;

/** The server's stdout so far, parsed. A line that doesn't parse is left out here; the format test catches it. */
const linesOf = (server: Booted): Line[] => server.stdout().map(parse).filter((l): l is Line => l !== null);

async function lines(server: Booted, test: (ls: Line[]) => boolean, what: string, ms = 5_000): Promise<Line[]> {
  for (const deadline = Date.now() + ms; ; await sleep(25)) {
    const ls = linesOf(server);
    if (test(ls)) return ls;
    if (Date.now() > deadline) {
      throw new Error(`waited ${ms}ms for ${what} in the server's stdout; its last lines:\n${server.stdout().slice(-12).join("\n")}`);
    }
  }
}

const SID = /^[0-9a-f]{6}$/;
const seatLines = (ls: Line[], name: string): Line[] =>
  ls.filter((l) => l.action === "join" && l.outcome === "applied" && l.name === name);

/** A server of this file's own, with A (a Striker) and B (a Mender) seated in one fight. */
async function seatTwo(server: Booted) {
  const battleId = await newBattle(server.base);
  const s = suffix();
  const names = { A: `ada-${s}`, B: `bo-${s}` };
  const a = await join(server.base, battleId, names.A, "striker");
  const b = await join(server.base, battleId, names.B, "mender");
  expect([a.status, b.status], "both seated").toEqual([200, 200]);
  return { battleId, names, a, b, A: a.characterId as string, B: b.characterId as string };
}

describe("who did what, in the logs (docs/adr/008)", () => {
  it("every applied action and every refusal is exactly one line, under the sid that sent it", async () => {
    const server = await boot(scratchDatabase(), { TICK_MS: "20" });
    try {
      const at = server.base;
      const { battleId, names, a, b, A, B } = await seatTwo(server);
      const forged = forge(a.cookie);

      // Who sent what, and whether it was applied. The statuses are the
      // authorisation tests' business; here, each answer is one line.
      type Who = "A" | "B" | "none" | "forged";
      const sent: { who: Who; ok: boolean }[] = [];
      const record = (who: Who, status: number): void => void sent.push({ who, ok: status >= 200 && status < 300 });

      record("none", (await join(at, battleId, names.B.toUpperCase(), "warden")).status); // a name that's taken
      await until(at, battleId, (st) => st.activeId === A, "A's turn");
      record("A", await send(at, battleId, a.cookie, { action: "jab", seatId: B }));
      record("none", await send(at, battleId, "", { action: "jab" }));
      record("forged", await send(at, battleId, forged, { action: "jab" }));
      record("A", await send(at, battleId, a.cookie, { action: "mend" }));
      record("A", await send(at, `no-such-${suffix()}`, a.cookie, { action: "jab" }));
      record("A", await send(at, battleId, a.cookie, { action: "jab" }));
      record("A", await send(at, battleId, a.cookie, { action: "jab" })); // the turn already spent
      await until(at, battleId, (st) => st.activeId === B, "B's turn");
      record("B", await send(at, battleId, b.cookie, { action: "mend", targetId: A, characterId: B }));

      const refusals = sent.filter((r) => !r.ok).length;
      const applied = sent.filter((r) => r.ok);
      expect(applied.length, "something was applied, so there is something to count").toBeGreaterThan(0);
      await lines(
        server,
        (ls) =>
          ls.filter((l) => l.outcome === "refused").length >= refusals &&
          ls.filter((l) => ["jab", "mend"].includes(l.action) && l.outcome === "applied").length >= applied.length,
        `${refusals} refusal line(s) and ${applied.length} applied action line(s)`,
      );
      await sleep(250); // time for any line too many to arrive
      const all = linesOf(server);

      expect(seatLines(all, names.A), "one line for A taking a seat").toHaveLength(1);
      expect(seatLines(all, names.B), "one line for B taking a seat").toHaveLength(1);
      const sid: Record<"A" | "B", string> = { A: seatLines(all, names.A)[0].sid, B: seatLines(all, names.B)[0].sid };

      const refused = all.filter((l) => l.outcome === "refused");
      expect(refused.length, "every refusal is one line, and nothing else is refused").toBe(refusals);
      const by: Record<"A" | "B" | "none", string> = { A: sid.A, B: sid.B, none: "-" };
      for (const who of ["A", "B", "none"] as const) {
        expect(
          refused.filter((l) => l.sid === by[who]).length,
          `the refusals ${who === "none" ? "sent with no cookie" : `${who} sent`}, under ${by[who]}`,
        ).toBe(sent.filter((r) => r.who === who && !r.ok).length);
      }
      // A's request for B's seat is refused as that, and its line names them
      // both: A by sid, B by seat. Refused for some other reason (not A's turn,
      // say), it would name no seat but A's.
      const forB = refused.filter((l) => l.sid === sid.A && Object.values(l).includes(B));
      expect(forB, "one refusal line under A's sid names B's seat: A's request to act for B").toHaveLength(1);
      expect(Object.values(forB[0] ?? {}), "and it names A's own seat too").toContain(A);
      const strangers = refused.filter((l) => l.sid !== sid.A && l.sid !== sid.B && l.sid !== "-");
      expect(strangers, "the forged cookie's refusal, under a sid of its own").toHaveLength(1);
      expect(strangers[0]?.sid, "a forged cookie still gets a short id").toMatch(SID);

      const struck = all.filter((l) => ["jab", "mend"].includes(l.action) && l.outcome === "applied");
      for (const who of ["A", "B"] as const) {
        expect(struck.filter((l) => l.sid === sid[who]).length, `${who}'s applied actions`).toBe(
          applied.filter((r) => r.who === who).length,
        );
      }
      expect(struck.length, "every applied action is one line, and there are no others").toBe(applied.length);
    } finally {
      await server.kill();
    }
  }, 45_000);

  it("two sessions are two short ids: each the same on every line, and the same after a restart", async () => {
    const db = scratchDatabase();
    let cookie = "";
    let name = "";
    let sid = "";

    const first = await boot(db, { TICK_MS: "20" });
    try {
      const at = first.base;
      const { battleId, names, a, b, A, B } = await seatTwo(first);
      await until(at, battleId, (st) => st.activeId === A, "A's turn");
      expect(await send(at, battleId, a.cookie, { action: "mend" }), "a refusal, from the refusal path").toBe(400);
      expect(await send(at, battleId, a.cookie, { action: "jab" }), "an action, from the event emitter").toBe(200);
      await until(at, battleId, (st) => st.activeId === B, "B's turn");
      expect(await send(at, battleId, b.cookie, { action: "mend", targetId: A })).toBe(200);

      const all = await lines(
        first,
        (ls) =>
          [names.A, names.B].every(
            (n) => seatLines(ls, n).length === 1 && ls.some((l) => l.name === n && ["jab", "mend"].includes(l.action) && l.outcome === "applied"),
          ) && ls.some((l) => l.name === names.A && l.outcome === "refused"),
        "A's and B's seats and actions, and A's refusal",
      );
      const sids = { A: seatLines(all, names.A)[0].sid, B: seatLines(all, names.B)[0].sid };
      expect(sids.A, "A's sid is six characters of hash").toMatch(SID);
      expect(sids.B, "B's sid is six characters of hash").toMatch(SID);
      expect(sids.A, "two sessions, two sids").not.toBe(sids.B);
      for (const who of ["A", "B"] as const) {
        const n = names[who];
        expect(new Set(all.filter((l) => l.name === n).map((l) => l.sid)), `every line naming ${who} carries ${who}'s sid`).toEqual(
          new Set([sids[who]]),
        );
        expect(new Set(all.filter((l) => l.sid === sids[who]).map((l) => l.name)), `every line under ${who}'s sid names ${who}`).toEqual(
          new Set([n]),
        );
      }
      cookie = a.cookie;
      name = names.A;
      sid = sids.A;
    } finally {
      await first.kill();
    }

    const second = await boot(db, { TICK_MS: "20" });
    try {
      const again = await join(second.base, await newBattle(second.base), name, "striker", cookie);
      expect(again.status, "the same cookie takes a seat after the restart").toBe(200);
      const all = await lines(second, (ls) => seatLines(ls, name).length === 1, "A's seat after the restart");
      expect(seatLines(all, name)[0].sid, "the same session is the same sid after a restart").toBe(sid);
    } finally {
      await second.kill();
    }
  }, 60_000);

  it("every log line is key=value pairs with ts, room, sid, name, action and outcome, across a whole fight", async () => {
    // A fast clock, a short turn and a short Echo beat (rule 8: a seat that times out becomes an Echo, which
    // waits a beat on the plate for its person), so one fight runs from the first seat to its end.
    const server = await boot(scratchDatabase(), { TICK_MS: "5", TURN_TIMEOUT_MS: "400", ECHO_BEAT_MS: "50" });
    try {
      const at = server.base;
      const battleId = await newBattle(at);
      const me = await join(at, battleId, `whole-${suffix()}`, "striker");
      expect(me.status).toBe(200);
      await until(at, battleId, (st) => st.activeId === me.characterId, "my turn", 15_000);
      expect(await send(at, battleId, me.cookie, { action: "mend" }), "a refusal").toBe(400);
      expect(await send(at, battleId, me.cookie, { action: "jab" }), "an action").toBe(200);
      // then nobody acts: the table Braces for them, three holds make them an Echo (rule 8), and the fight runs
      // to its end
      await until(at, battleId, (st) => st.status !== "fighting", "the fight to end", 60_000);

      const ended = await lines(server, (ls) => ls.some((l) => l.action === "end"), "the end of the fight");
      for (const [what, test] of [
        ["a seat taken", (l: Line) => l.action === "join"],
        ["an applied action", (l: Line) => l.action === "jab" && l.outcome === "applied"],
        ["a refusal", (l: Line) => l.outcome === "refused"],
        ["the Orrery's turn", (l: Line) => l.actor === "orrery"],
        ["a held turn", (l: Line) => l.action === "hold"],
        ["a seat that became an Echo", (l: Line) => l.action === "echo"],
      ] as const) {
        expect(ended.some(test), `a whole fight logged no line for ${what}`).toBe(true);
      }

      const raw = server.stdout();
      expect(raw.length, "the server wrote to stdout").toBeGreaterThan(0);
      for (const [i, text] of raw.entries()) {
        const l = parse(text);
        expect(l, `stdout line ${i + 1} isn't key=value pairs: ${text}`).not.toBeNull();
        const f = l as Line;
        for (const key of ["ts", "room", "sid", "name", "action", "outcome"]) {
          expect(Object.hasOwn(f, key), `stdout line ${i + 1} has no ${key}: ${text}`).toBe(true);
        }
        expect(Number.isNaN(Date.parse(f.ts)), `stdout line ${i + 1}'s ts isn't a time: ${text}`).toBe(false);
        expect(["applied", "refused"], `stdout line ${i + 1}'s outcome: ${text}`).toContain(f.outcome);
        if (f.outcome === "refused") expect(f.reason, `stdout line ${i + 1} is refused with no reason: ${text}`).toBeTruthy();
      }
    } finally {
      await server.kill();
    }
  }, 90_000);

  it("no log line ever carries a raw cookie value, wherever a request puts one", async () => {
    const server = await boot(scratchDatabase(), { TICK_MS: "20" });
    try {
      const at = server.base;
      const { battleId, a, b, A, B } = await seatTwo(server);
      const forged = forge(a.cookie);
      const secrets = [...values(a.cookie), ...values(b.cookie), ...values(forged)];
      const [secret] = values(a.cookie);

      // ordinary play, so there are applied lines to look in
      await until(at, battleId, (st) => st.activeId === A, "A's turn");
      expect(await send(at, battleId, a.cookie, { action: "jab" }), "A's own Jab").toBe(200);
      await until(at, battleId, (st) => st.activeId === B, "B's turn");
      expect(await send(at, battleId, b.cookie, { action: "mend", targetId: A }), "B's own Mend").toBe(200);

      // then A's own cookie value, smuggled into every field a request can
      // carry and into the path: eight requests, each refused whoever's turn it is
      const smuggled = [
        send(at, battleId, a.cookie, { action: secret }),
        send(at, battleId, a.cookie, { action: "jab", targetId: secret }),
        send(at, battleId, a.cookie, { action: "jab", seatId: secret }),
        send(at, battleId, a.cookie, { action: "jab", characterId: secret, actorId: secret }),
        send(at, secret, a.cookie, { action: "jab" }),
        join(at, battleId, secret, "striker", a.cookie).then((r) => r.status),
        join(at, secret, `zed-${suffix()}`, "striker").then((r) => r.status),
        send(at, battleId, forged, { action: "jab" }),
      ];
      for (const status of await Promise.all(smuggled)) expect(status, "a smuggled request is refused").toBeGreaterThanOrEqual(400);

      // A guard is only worth having over lines that exist: wait until every
      // request above has its line, then look for the cookie in all of them.
      const all = await lines(
        server,
        (ls) =>
          ls.filter((l) => l.outcome === "refused").length >= smuggled.length &&
          ls.filter((l) => ["jab", "mend"].includes(l.action) && l.outcome === "applied").length >= 2,
        `${smuggled.length} refusal lines and two applied actions`,
      );
      await sleep(250);
      const output = server.output();
      for (const value of secrets) {
        expect(output.includes(value), `a raw cookie value (${value.slice(0, 4)}…) reached the server's output`).toBe(false);
      }
      // and the short id isn't a slice of the cookie either
      for (const l of all.filter((x) => x.sid && x.sid !== "-")) {
        for (const value of secrets) expect(value.includes(l.sid), `sid ${l.sid} is cut from a cookie`).toBe(false);
      }
    } finally {
      await server.kill();
    }
  }, 45_000);
});
