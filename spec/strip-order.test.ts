// @vitest-environment jsdom
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Rule 1, the client's half: no client decides turn order. The strip draws the
// queue in the order the server sent it, never sorted by counter or seat of its
// own accord. Review F14 (docs/review/phase-one.md): this was "judged"; jsdom
// lets it be held. The queue here is deliberately NOT in counter order, so a
// strip that sorted by counter would draw it differently.

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

const token = (id: string, counter: number, seat: number, kind = "character", role = "striker") => ({
  id, kind, name: id, role, counter, hp: 100, maxHp: 100, hasted: false, braced: false, seat,
  charge: 0, resource: 0, gravity: 0, drifting: false, echo: false, reactionReady: true,
});

it("the strip draws the queue in the order the server sent, never re-sorted", async () => {
  const { createStrip } = (await import(resolve("src/client/strip/strip.ts"))) as {
    createStrip: (root: HTMLElement, o: unknown) => { render(s: unknown, me: string | null): void };
  };
  const root = document.createElement("aside");
  document.body.append(root);
  // Counters 9, 2, 14, 5: sorting by counter would give c, a... not this.
  const sent = [token("first", 9, 3), token("second", 2, 1), token("orrery", 14, 0, "boss", "orrery"), token("fourth", 5, 2)];
  const state = {
    battleId: "b", version: 1, tick: 1, tickMs: 150, turnMs: 12_000, status: "fighting", activeId: null, turnDeadline: null,
    queue: sent, fallen: [], log: [], phase: 1, rings: [], cards: [], chain: { links: 0, potency: 1 }, pullSeats: 3, spentExposed: [],
  };
  createStrip(root, { manifest: { facing: "left", required: [], roles: {} }, orrerySvg: "<svg></svg>" }).render(state, null);
  const drawn = [...root.querySelectorAll<HTMLElement>("[data-token-id]")].map((el) => el.dataset.tokenId);
  expect(drawn, "the strip drew the server's order, not one of its own").toEqual(["first", "second", "orrery", "fourth"]);
});
