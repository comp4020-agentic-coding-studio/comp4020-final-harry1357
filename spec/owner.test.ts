import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// Review findings only the owner can close (docs/review/phase-one-b.md). The
// README is the owner's (CLAUDE.md, "How to work in here": never written,
// drafted or tidied by an agent), so a finding about it is carried here as a
// red test instead of being fixed, and the branch doesn't merge while it is
// red (the review gate). It checks that the README speaks to the decision, not
// how well; the words are the owner's.

const readme = readFileSync(new URL("../README.md", import.meta.url), "utf8");

describe("open findings the owner holds", () => {
  it("R7 (ADR-007 §Cost): the README says what rooms are, and that Echoes are a floor for co-presence, not the point", () => {
    // Re-review N6: "rooms" alone already matched the README's "Rooms and
    // lobbies: there's one fight, and you're in it", the opposite of ADR-007,
    // and "Echo" passed on any single use. Still a check that the README
    // speaks to the decision, not of how; the words stay the owner's.
    expect(readme, 'the README still says "there\'s one fight", which ADR-007 replaced with rooms').not.toMatch(/there's one fight/i);
    expect(readme, "the README doesn't say a room is joined by a code").toMatch(/\broom\b[^.]*\bcode\b|\bcode\b[^.]*\broom\b/i);
    expect(readme, "the README says nothing about Echoes").toMatch(/\bEcho(es)?\b/);
    expect(readme, "the README doesn't speak to the visitor on their own, whom Echoes are for").toMatch(/\b(solo|alone|on (their|your) own|by (themselves|yourself))\b/i);
  });
});
