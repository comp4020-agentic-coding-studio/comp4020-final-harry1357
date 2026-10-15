import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Every role is drawn with its own sprite. Phase one of the overhaul
// (docs/adr/006) brought in five roles while the art still has the old four,
// so the client borrows: src/client/sprites.ts maps each role onto a sprite
// that belongs to someone else. That table is a shim, marked for removal in
// phase two, and this test is what stops phase two forgetting it. It is red
// on purpose until every role has art of its own (CLAUDE.md, "How to work in
// here": a spec red because the feature isn't built is a target).
//
// The roles are the design record's (docs/design/overhaul.md, Priority 2),
// written here rather than read from the protocol, so the test can't go green
// by the roles being renamed back to the sprites.
const ROLES = ["warden", "mender", "striker", "breaker", "chronist"] as const;

it("every role is drawn with its own sprite, not another role's", async () => {
  // The shim may be gone by phase two; then every role draws its own sprite by name.
  let spriteFor: Partial<Record<string, string>> = Object.fromEntries(ROLES.map((r) => [r, r]));
  try {
    const shim = (await import(resolve("src/client/sprites.ts"))) as { SPRITE_FOR?: Record<string, string> };
    if (shim.SPRITE_FOR) spriteFor = shim.SPRITE_FOR;
  } catch {
    // no shim: nothing is borrowed
  }

  const borrowed = ROLES.filter((r) => spriteFor[r] !== r).map((r) => `${r} → ${spriteFor[r] ?? "nothing"}`);
  expect(
    borrowed,
    "these roles are still drawn with another role's sprite: the phase-one shim in src/client/sprites.ts is still in use",
  ).toEqual([]);

  const manifest = JSON.parse(readFileSync("src/assets/sprites.json", "utf8")) as { roles?: Record<string, unknown> };
  const missing = ROLES.filter((r) => !manifest.roles?.[r]);
  expect(missing, "these roles have no sprite of their own in src/assets/sprites.json").toEqual([]);
});
