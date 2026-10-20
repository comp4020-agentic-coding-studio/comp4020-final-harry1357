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

  const manifest = JSON.parse(readFileSync("src/assets/sprites.json", "utf8")) as { roles?: Record<string, { sheet: string }> };
  const missing = ROLES.filter((r) => !manifest.roles?.[r]);
  expect(missing, "these roles have no sprite of their own in src/assets/sprites.json").toEqual([]);

  // With the shim file gone, a borrowed sprite would be another role's sheet
  // under this role's name, or a copy of it (phase two's gate, T9): every
  // role's sheet is its own file, with its own pixels.
  const { createHash } = await import("node:crypto");
  const sheets = ROLES.map((r) => {
    const path = manifest.roles?.[r]?.sheet ?? "";
    return { role: r, path, hash: createHash("sha256").update(readFileSync(`src/assets/${path}`)).digest("hex") };
  });
  for (let i = 0; i < sheets.length; i++) {
    for (let j = i + 1; j < sheets.length; j++) {
      expect(sheets[i].path, `${sheets[i].role} and ${sheets[j].role} are drawn from the same sheet`).not.toBe(sheets[j].path);
      expect(sheets[i].hash, `${sheets[i].role} and ${sheets[j].role} are drawn from the same pixels`).not.toBe(sheets[j].hash);
    }
  }
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

  // With the shim file gone, a borrowed animation would be another event's
  // renderer registered under this one (phase two's gate, T9): every kind's
  // full and reduced renderers are its own.
  globalThis.matchMedia ??= ((query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} })) as unknown as typeof matchMedia;
  const { RENDERERS } = (await import(resolve("src/client/battle/registry.ts"))) as {
    RENDERERS: Record<string, { full: unknown; reduced: unknown }>;
  };
  // (One renderer for both of a kind's variants is that kind's own: it has no motion to reduce.)
  const owner = new Map<unknown, string>();
  const borrowed: string[] = [];
  for (const [kind, r] of Object.entries(RENDERERS)) {
    for (const variant of ["full", "reduced"] as const) {
      const was = owner.get(r[variant]);
      if (was && was !== kind) borrowed.push(`${kind}.${variant} is ${was}'s`);
      else owner.set(r[variant], kind);
    }
  }
  expect(borrowed, "these events are drawn by another event's renderer").toEqual([]);

  // Identity alone passes a wrapper that calls another kind's renderer (re-review N10). The shim borrowed
  // two animations: Jab played the old Strike's "attack" and Haste the old Hasten. Each now plays its role's
  // own, held here in both variants, and each animation is on that role's own sheet. (Comparing whole call
  // traces can't tell borrowing from the blows' shared vocabulary: seven pairs of kinds draw alike by design.)
  const manifest = JSON.parse(readFileSync("src/assets/sprites.json", "utf8")) as { roles: Record<string, { animations: Record<string, unknown> }> };
  for (const [kind, role, own] of [["jab", "striker", "jab"], ["haste", "chronist", "cast"]] as const) {
    expect(manifest.roles[role].animations[own], `the ${role}'s sheet has its own ${own}`).toBeDefined();
    for (const variant of ["full", "reduced"] as const) {
      const frames: [unknown, unknown][] = [];
      const quiet = () => Promise.resolve();
      const scene = new Proxy({}, { get: (_t, p) => (p === "frame" ? (id: unknown, anim: unknown) => (frames.push([id, anim]), Promise.resolve()) : quiet) });
      const strip = new Proxy({}, { get: () => quiet });
      const state = { queue: [{ id: "me", kind: "character", role, hp: 50, maxHp: 90 }, { id: "ally", kind: "character", role: "warden", hp: 50, maxHp: 90 }], fallen: [], cards: [], rings: [], phase: 1 };
      const ctx = { scene, strip, audio: { play() {} }, reduced: variant === "reduced", wait: quiet, state, me: "me" };
      await (RENDERERS[kind][variant] as (c: unknown, e: unknown) => unknown)(ctx, { kind, actorId: "me", targetId: "ally", ringId: "outer", amount: 4, seq: 1 });
      const mine = frames.filter(([id]) => id === "me").map(([, anim]) => anim);
      expect(mine, `${kind} (${variant}) plays the ${role}'s own ${own}`).toContain(own);
      expect(mine, `${kind} (${variant}) plays no borrowed attack`).not.toContain("attack");
    }
  }
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
