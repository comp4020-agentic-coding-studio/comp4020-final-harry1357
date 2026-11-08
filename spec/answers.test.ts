import { describe, expect, it } from "vitest";
import { bossTurn, engine, lobbyTable, type Battle, type Step } from "./engine.ts";

// The next phase's first finding (docs/review/feedback.md, "For the next
// phase"; ADR-012, rule 34). Played live on 64d44b8 (room 3EHT5, fight
// Lat28mo_f5HL): a solo naive Breaker, "Ada", with four Echoes. An unmet
// Perihelion downed Ada (seq 36) with no Bastion standing and the outer ring
// whole; the fight ran on with Echoes until a later Perihelion downed the last
// standing seat, a Braced Striker Echo (seq 92). The ending named only that
// last card, whose only standing seat had done all it could:
//
//   "Perihelion landed on everyone, no Bastion standing, the outer ring whole
//    and every seat Braced. It was met, and still took the last of them."
//
// The person at the table learns nothing from it: the card that downed them,
// and the Bastion and the Break that would have met it, are never named.
// ADR-012 names the property: the ending names its cause and the answers the
// table had. At a table of people and Echoes the cause a person can act on is
// the card that downed the last person; this spec holds the ending to that.

interface Ending {
  intent: string | null;
  targetId: string | null;
  answers: { role: string; action: string; by: string | null }[];
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
const standingIds = (b: Battle) => b.standing.filter((f) => f.kind === "character").map((f) => f.id);

describe("the ending names the card that downed the last person, not only the last seat", () => {
  it("the live shape: Ada downed by an unmet Perihelion, the fight ended later on a Braced Echo", async () => {
    const e = await engine();
    // Ada the Breaker, a person; a Warden Echo and a Striker Echo.
    let b = lobbyTable(e, ["breaker"], [
      { id: "warden-echo-0", role: "warden" },
      { id: "striker-echo-1", role: "striker" },
    ]);
    // The first Perihelion: no Bastion, the outer ring whole, Ada unbraced at low HP; the Echoes survive it.
    b = edit(b, (x) => {
      x.cards = [];
      for (const f of x.standing.filter((f) => f.kind === "character")) f.hp = f.id === "breaker-1" ? 5 : 500;
    });
    b = e.announce(b, { intent: "perihelion", targetId: "party", amount: 40, countdown: 0 });
    let step = bossTurn(e, b);
    expect(standingIds(step.battle).sort(), "the Perihelion downed Ada, and the Echoes stand").toEqual(["striker-echo-1", "warden-echo-0"]);
    expect(step.battle.status, "the fight runs on").toBe("fighting");

    // Later, a second Perihelion lands on the Echoes, every one Braced, and downs them: the fight ends.
    b = edit(step.battle, (x) => {
      x.cards = [];
      for (const f of x.standing.filter((f) => f.kind === "character")) {
        f.braced = true;
        f.hp = 3;
      }
    });
    b = e.announce(b, { intent: "perihelion", targetId: "party", amount: 40, countdown: 0 });
    step = bossTurn(e, b);
    expect(step.battle.status, "the last seats are down: lost").toBe("lost");

    const ending = endOf(step);
    // The cause a person can act on: the Perihelion that downed Ada, unmet, and what would have met it.
    expect(ending.answers.map((a) => `${a.role}:${a.action}:${a.by ?? "-"}`), "the answers the table had when Ada fell").toEqual([
      "warden:bastion:-",
      "breaker:shatter:breaker-1",
      "breaker:fracture:breaker-1",
      "any:brace:-",
    ]);
    expect(ending.line, "named for the person it downed").toMatch(/Ada|breaker 1/);
    expect(ending.line, "and never a line that names no answer while the person's loss had some").not.toMatch(/It was met, and still took the last of them\.$/);
  });

  it("a table of one person and no Echoes is unchanged: the last seat is the last person", async () => {
    const e = await engine();
    let b = lobbyTable(e, ["striker"]);
    b = edit(b, (x) => {
      x.cards = [];
      x.standing.find((f) => f.id === "striker-1")!.gravity = 2;
    });
    b = e.announce(b, { intent: "lunge", targetId: "striker-1", amount: 20, countdown: 0 });
    const ending = endOf(bossTurn(e, b));
    expect(ending).toMatchObject({ intent: "lunge", targetId: "striker-1" });
    expect(ending.line).toBe("Lunge landed on striker 1 at Gravity 2, unwarded and unbraced. striker 1's Riposte or Brace would have met it.");
  });
});
