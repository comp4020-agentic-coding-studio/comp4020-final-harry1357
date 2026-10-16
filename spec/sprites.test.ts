import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Nothing in phase one's shim survives phase two. Phase one of the overhaul
// (docs/adr/006) brought in five roles and new events while the client still
// has the old art and animations, so src/client/sprites.ts carries two
// stand-ins: each role borrows another role's sprite, and the Jab and Haste
// renderers borrow the old Strike and Hasten animations. Both are marked for
// removal in phase two, and these tests are what stop phase two forgetting
// them. They are red on purpose until it's done (CLAUDE.md, "How to work in
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

it("no renderer is a shim borrowing another event's animation", async () => {
  // The shim may be gone by phase two; then nothing is borrowed.
  let shims: Record<string, unknown> = {};
  try {
    const shim = (await import(resolve("src/client/sprites.ts"))) as { SHIM_RENDERERS?: Record<string, unknown> };
    if (shim.SHIM_RENDERERS) shims = shim.SHIM_RENDERERS;
  } catch {
    // no shim: nothing is borrowed
  }
  expect(
    Object.keys(shims).sort(),
    "these events are still drawn by a phase-one shim that borrows another event's animation (src/client/sprites.ts)",
  ).toEqual([]);
});
