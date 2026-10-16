import { resolve } from "node:path";
import { afterAll, describe, expect, inject, it } from "vitest";
import { boot, cleanScratch, scratchDatabase } from "./boot.ts";
import { launchChrome } from "./browser.ts";
import { act, battle, join, newBattle, sleep, suffix, watch, type Event, type Watcher } from "./raid.ts";

// The fight is shown, not read (CLAUDE.md rule 11). Every event the server can
// broadcast has a battle-screen renderer, and on another person's screen a
// strike is drawn first and written down second.
const base = inject("baseUrl");

afterAll(cleanScratch);

interface Renderer {
  full?: unknown;
  reduced?: unknown;
}

/** A module the battle screen must provide; missing is a failure with its name on it. */
async function provided<T>(path: string, what: string): Promise<T> {
  try {
    return (await import(resolve(path))) as T;
  } catch (err) {
    throw new Error(`${what} (${path}) couldn't be loaded: ${(err as Error).message}`);
  }
}

async function nextEvent(w: Watcher, from: number, test: (e: Event) => boolean, what: string): Promise<Event> {
  for (const deadline = Date.now() + 10_000; ; await sleep(10)) {
    const found = w.events.slice(from).find(test);
    if (found) return found;
    if (Date.now() > deadline) throw new Error(`waited 10s for ${what}`);
  }
}

describe("the fight is shown", () => {
  it("every broadcast event type has a battle-screen renderer registered", async () => {
    const { EVENT_KINDS } = await provided<{ EVENT_KINDS?: readonly string[] }>("src/shared/protocol.ts", "the protocol");
    expect(Array.isArray(EVENT_KINDS) && EVENT_KINDS.length > 0, "src/shared/protocol.ts exports no EVENT_KINDS").toBe(true);
    const kinds = EVENT_KINDS as readonly string[];
    const { RENDERERS } = await provided<{ RENDERERS?: Record<string, Renderer> }>(
      "src/client/battle/registry.ts",
      "the battle screen's renderer registry",
    );
    expect(RENDERERS, "src/client/battle/registry.ts exports no RENDERERS").toBeTruthy();
    const registry = RENDERERS as Record<string, Renderer>;
    for (const kind of kinds) {
      expect(typeof registry[kind]?.full, `no renderer for "${kind}"`).toBe("function");
      expect(typeof registry[kind]?.reduced, `no reduced-motion renderer for "${kind}"`).toBe("function");
    }

    // And the other side: what the server actually broadcasts in a whole fight,
    // with every role acting and one person who never does, is all declared.
    // A short Echo beat too: the idle seat becomes an Echo, and a whole fight
    // of 3 s beats would overrun the budget (review R7).
    const server = await boot(scratchDatabase(), { TICK_MS: "5", TURN_TIMEOUT_MS: "250", ECHO_BEAT_MS: "100" });
    try {
      const battleId = await newBattle(server.base);
      const w = watch(server.base, battleId);
      await w.opened;
      const s = suffix();
      const plan = { warden: ["counterweight", "brace"], striker: ["jab", "cleave"], mender: ["mend", "brace"], breaker: ["scan", "mark"], chronist: ["relay", "brace"] };
      const seats = [];
      for (const [role, actions] of Object.entries(plan)) {
        const seat = await join(server.base, battleId, `${role}-${s}`, role);
        expect(seat.status).toBe(200);
        seats.push({ ...seat, actions, turn: 0 });
      }
      expect((await join(server.base, battleId, `idler-${s}`, "chronist")).status).toBe(200);

      for (const deadline = Date.now() + 60_000; ; ) {
        const st = await battle(server.base, battleId);
        if (st.status !== "fighting") break;
        if (Date.now() > deadline) throw new Error("the fight didn't finish in 60s");
        const seat = seats.find((x) => x.characterId === st.activeId);
        if (seat) {
          const action = seat.actions[seat.turn++ % seat.actions.length];
          expect((await act(server.base, battleId, seat.cookie, action)).status, `${action} on my turn`).toBe(200);
        } else {
          await sleep(5);
        }
      }
      await sleep(100);
      w.close();

      const seen = [...new Set(w.events.map((e) => e.kind))];
      expect(seen.filter((k) => !kinds.includes(k)), "the server broadcast event kinds the protocol doesn't declare").toEqual([]);
      // Nobody leaves on a timeout any more (rule 8: an idler is Braced for, then an Echo).
      for (const kind of ["join", "jab", "hold", "end"]) {
        expect(seen, `a whole fight never broadcast a "${kind}" event`).toContain(kind);
      }
      expect(
        seen.some((k) => ["revolution", "eclipse", "perihelion"].includes(k)),
        "a whole fight never broadcast a move by the Orrery",
      ).toBe(true);
    } finally {
      await server.kill();
    }
  }, 90_000);

  it("after A strikes, B's screen mutates within one tick, and B's log line arrives after the screen mutation", async () => {
    const battleId = await newBattle(base);
    const a = await join(base, battleId, `striker-${suffix()}`, "striker");
    expect(a.status).toBe(200);
    const A = a.characterId as string;

    const w = watch(base, battleId);
    await w.opened;
    const first = await w.waitFor(() => true, "a state", 5_000);
    const tickMs = (first as unknown as { tickMs?: number }).tickMs;
    expect(typeof tickMs, "BattleState carries no tickMs, so one tick can't be measured").toBe("number");

    const chrome = await launchChrome();
    try {
      // B: another screen at the same table.
      const b = await chrome.open(`${base}/?battle=${battleId}`);
      await b.until(`!!document.querySelector('[data-scene] [data-sprite="${A}"]')`, "A's sprite on B's screen", 20_000);
      await b.until(`!!document.querySelector('[data-log]')`, "B's log", 5_000);
      // B records, on its own clock, when it first shows the strike (A's sprite
      // plays attack, a damage number appears) and when each log line lands.
      await b.evaluate(`(() => {
        const now = () => performance.timeOrigin + performance.now();
        const scene = document.querySelector("[data-scene]");
        const log = document.querySelector("[data-log]");
        const seen = (window.__seen = { attack: 0, number: 0, log: {} });
        for (const el of log.querySelectorAll("[data-seq]")) seen.log[el.dataset.seq] = -1;
        new MutationObserver(() => {
          const sprite = scene.querySelector('[data-sprite="${A}"]');
          if (!seen.attack && sprite && sprite.dataset.anim === "attack") seen.attack = now();
          if (!seen.number && scene.querySelector("[data-number]")) seen.number = now();
        }).observe(scene, { subtree: true, childList: true, attributes: true });
        new MutationObserver(() => {
          for (const el of log.querySelectorAll("[data-seq]")) if (!(el.dataset.seq in seen.log)) seen.log[el.dataset.seq] = now();
        }).observe(log, { subtree: true, childList: true });
        return true;
      })()`);

      await w.waitFor((st) => st.activeId === A, "A's turn", 20_000);
      const from = w.events.length;
      const struck = Date.now();
      expect((await act(base, battleId, a.cookie, "jab")).status).toBe(200);
      const strike = await nextEvent(w, from, (e) => e.kind === "jab" && e.actorId === A, "A's strike event");
      expect(typeof strike.seq, "the strike event carries no seq to find its log line by").toBe("number");

      const seen = await b.until<{ attack: number; number: number; log: Record<string, number> }>(
        `(() => { const s = window.__seen; return s.attack && s.number && s.log["${strike.seq}"] > 0 ? s : null; })()`,
        "B to show the strike, pop the number and then log it",
        10_000,
      );
      expect(seen.attack - struck, `B's screen moved ${(seen.attack - struck).toFixed(0)}ms after the strike; one tick is ${tickMs}ms`).toBeLessThanOrEqual(
        tickMs as number,
      );
      expect(seen.log[String(strike.seq)], "B's log line landed before its screen showed the strike").toBeGreaterThan(seen.attack);
      expect(seen.log[String(strike.seq)], "B's log line landed before the damage number popped").toBeGreaterThanOrEqual(seen.number);
    } finally {
      w.close();
      await chrome.close();
    }
  }, 60_000);
});
