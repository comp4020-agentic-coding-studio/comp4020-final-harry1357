// @vitest-environment jsdom
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The your-turn nudge (RICE item 2): when the server puts your seat on the
// plate, the tab's title says so and a phone vibrates, once per turn, so
// someone with the sound off or in another tab isn't timed out into an Echo
// (rule 8). It is driven by the server's activeId and nothing else (rule 1): a
// counter at 0 that the server hasn't put on the plate nudges nobody.

type Nudge = { update(state: unknown, myId: string | null): void };
type Make = (o: { doc: Document; vibrate: (ms: number | number[]) => unknown }) => Nudge;

const load = async (): Promise<Make> => {
  const mod = (await import(resolve("src/client/nudge.ts"))) as { createNudge?: Make };
  if (typeof mod.createNudge !== "function") throw new Error("src/client/nudge.ts exports no createNudge");
  return mod.createNudge;
};
const st = (activeId: string | null, deadline: number | null, status = "fighting", myCounter = 5) => ({
  status,
  activeId,
  turnDeadline: deadline,
  queue: [
    { id: "me", kind: "character", name: "Me", counter: myCounter },
    { id: "ally", kind: "character", name: "Ally", counter: 3 },
  ],
});

describe("the your-turn nudge follows the server's activeId", () => {
  it("names your turn in the title and vibrates once per turn, then puts the title back", async () => {
    const createNudge = await load();
    document.title = "The Orrery: a raid for whoever is at the table";
    const buzzes: unknown[] = [];
    const nudge = createNudge({ doc: document, vibrate: (p) => buzzes.push(p) });

    nudge.update(st("ally", 1000), "me");
    expect(document.title, "someone else's turn: the page's own title").toBe("The Orrery: a raid for whoever is at the table");
    expect(buzzes.length, "and no buzz").toBe(0);

    nudge.update(st("me", 2000), "me");
    expect(document.title, "your turn: the title says so").toMatch(/^▶ Your turn/);
    expect(buzzes.length, "and the phone buzzes").toBe(1);

    nudge.update(st("me", 2000), "me");
    expect(buzzes.length, "the same turn, broadcast again: no second buzz").toBe(1);

    nudge.update(st(null, null), "me");
    expect(document.title, "the turn passed: the title goes back").toBe("The Orrery: a raid for whoever is at the table");

    nudge.update(st("me", 9000), "me");
    expect(buzzes.length, "your next turn buzzes again").toBe(2);
  });

  it("decides nothing: a counter at 0 the server hasn't put on the plate nudges nobody, and nor does a fight that isn't on", async () => {
    const createNudge = await load();
    document.title = "The Orrery";
    const buzzes: unknown[] = [];
    const nudge = createNudge({ doc: document, vibrate: (p) => buzzes.push(p) });
    nudge.update(st(null, null, "fighting", 0), "me");
    nudge.update(st("ally", 1000, "fighting", 0), "me");
    nudge.update(st("me", 1000, "won"), "me");
    nudge.update(st("me", 1000), null);
    expect(document.title).toBe("The Orrery");
    expect(buzzes).toEqual([]);
  });
});
