import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";
import { crop, decodePng } from "../scripts/png.ts";

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

it("every role is told apart from every other by its silhouette at 24 px", () => {
  // Phase two: the fifth role's own sprite has to be distinguishable from the
  // other four in silhouette at the size a portrait-strip glance sees, 24 px
  // tall. Each role's first idle frame, its alpha alone, scaled to 24 px and
  // stood on the same feet; any two that overlap this much are the same shape
  // (a recolour overlaps 1.0). The closest pair the pack's art gives today is
  // 0.68 (Mender and Breaker), so the line sits above that, well below a copy.
  const MAX_OVERLAP = 0.8;
  const H = 24;
  const W = 48;
  const manifest = JSON.parse(readFileSync("src/assets/sprites.json", "utf8")) as {
    roles: Record<string, { sheet: string; cell: [number, number]; columns: number; box: [number, number, number, number]; animations: { idle: { frames: number[] } } }>;
  };
  const silhouette = (role: string): boolean[] => {
    const r = manifest.roles[role];
    const sheet = decodePng(readFileSync(`src/assets/${r.sheet}`));
    const frame = r.animations.idle.frames[0] ?? 0;
    const [x, y, w, h] = r.box;
    const img = crop(sheet, (frame % r.columns) * r.cell[0] + x, Math.floor(frame / r.columns) * r.cell[1] + y, w, h);
    const scale = H / h;
    const width = Math.max(1, Math.round(w * scale));
    const left = Math.floor((W - width) / 2);
    const out = new Array<boolean>(W * H).fill(false);
    for (let row = 0; row < H; row++) {
      for (let col = 0; col < width; col++) {
        const sx = Math.min(w - 1, Math.floor(col / scale));
        const sy = Math.min(h - 1, Math.floor(row / scale));
        if (left + col >= 0 && left + col < W) out[row * W + left + col] = img.data[(sy * img.width + sx) * 4 + 3] > 0;
      }
    }
    return out;
  };
  const shapes = Object.fromEntries(ROLES.map((r) => [r, silhouette(r)]));
  const alike: string[] = [];
  for (let i = 0; i < ROLES.length; i++) {
    for (let j = i + 1; j < ROLES.length; j++) {
      let both = 0;
      let either = 0;
      for (let k = 0; k < W * H; k++) {
        const a = shapes[ROLES[i]][k];
        const b = shapes[ROLES[j]][k];
        if (a && b) both++;
        if (a || b) either++;
      }
      const overlap = both / Math.max(1, either);
      if (overlap >= MAX_OVERLAP) alike.push(`${ROLES[i]} and ${ROLES[j]} overlap ${overlap.toFixed(2)}`);
    }
  }
  expect(alike, "these roles share a silhouette at 24 px").toEqual([]);
});
