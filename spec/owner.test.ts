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
    expect(readme, "the README says nothing about rooms").toMatch(/\brooms?\b/i);
    expect(readme, "the README says nothing about Echoes").toMatch(/\bEcho(es)?\b/);
  });
});
