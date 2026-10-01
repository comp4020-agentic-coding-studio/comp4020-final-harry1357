import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { act, battle, join as joinBattle, newBattle, type Joined } from "../spec/raid.ts";
import { APP_URL, PHONE, joinByForm, launch, sleep, type Page } from "./check-viewports.ts";

// Do name tags on the rail ever collide at 390×844?
//
//   APP_URL=http://localhost:8080 pnpm check:tags
//
// Off the `check` roster, like the other Chrome sensors (CLAUDE.md). A table
// of four with 24-character names (three seated over HTTP, one joined through
// the form) plays a sequence of strikes. After every state the page renders,
// it measures the bounding box of every name tag on the rail, and fails if
// two tags intersect, or if a token's disc lands on someone else's tag. A name
// you can't read is the same failure whichever of the two hides it.
//
// Motion is reduced (prefers-reduced-motion), which turns the token slide off.
// The claim is about where tokens LAND (CLAUDE.md: "always lands exactly where
// the latest state says"), and a frame caught mid-slide isn't a landing.
//
// It proves it's looking before it measures: the emulation took (clientWidth),
// the page fits (innerWidth), and the same collision test, run on planted
// boxes, sees an overlap and ignores two boxes that only touch.

const STRIKES = Number(process.env.TAG_STRIKES ?? 16);
const TOLERANCE = 0.5; // px: touching edges and sub-pixel rounding aren't collisions

interface Box {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Snapshot {
  version: number;
  tokens: number;
  tags: Box[];
  discs: Box[];
}

const longName = (n: number): string => "W".repeat(22) + String(n).padStart(2, "0");

/** Runs in the page: every tag and disc under `root`, by token. */
const COLLECT = (root: string): string => `(() => {
  const root = document.querySelector(${JSON.stringify(root)});
  if (!root) return null;
  const box = (el) => {
    const host = el.closest("[data-token-id]");
    const r = el.getBoundingClientRect();
    return { id: host ? host.dataset.tokenId : "?", name: (host?.querySelector(".tag-name")?.textContent ?? "").trim(),
             x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const visible = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  return {
    version: Number(root.dataset.version ?? -1),
    tokens: root.querySelectorAll("[data-token-id]").length,
    tags: [...root.querySelectorAll("[data-token-id] .tag")].filter(visible).map(box),
    discs: [...root.querySelectorAll("[data-token-id] .token-disc")].filter(visible).map(box),
  };
})()`;

function overlap(a: Box, b: Box): number {
  const across = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const down = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return across > TOLERANCE && down > TOLERANCE ? across * down : 0;
}

const describeBox = (b: Box): string =>
  `${b.name || b.id} [${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.w.toFixed(1)}×${b.h.toFixed(1)}]`;

export function collisions(s: Snapshot): string[] {
  const found: string[] = [];
  for (let i = 0; i < s.tags.length; i++) {
    for (let j = i + 1; j < s.tags.length; j++) {
      const area = overlap(s.tags[i], s.tags[j]);
      if (area > 0) found.push(`tag ${describeBox(s.tags[i])} and tag ${describeBox(s.tags[j])} overlap by ${area.toFixed(0)}px²`);
    }
  }
  for (const disc of s.discs) {
    for (const tag of s.tags) {
      if (tag.id === disc.id) continue;
      const area = overlap(disc, tag);
      if (area > 0) found.push(`the disc of ${disc.name || disc.id} covers tag ${describeBox(tag)} by ${area.toFixed(0)}px²`);
    }
  }
  return found;
}

async function snapshot(page: Page, root = "[data-rail]"): Promise<Snapshot> {
  const s = await page.evaluate<Snapshot | null>(COLLECT(root));
  if (!s) throw new Error(`no ${root} on the page`);
  return s;
}

/** The sensor sees an overlap it was shown, and doesn't see one that isn't there. */
async function selfTest(page: Page): Promise<void> {
  const plant = (boxes: [number, number][]): string => `(() => {
    const host = document.createElement("div");
    host.dataset.tagFixture = "";
    host.dataset.version = "0";
    host.style.cssText = "position:fixed;inset:0;pointer-events:none";
    ${JSON.stringify(boxes)}.forEach(([x, y], i) => {
      const token = document.createElement("div");
      token.dataset.tokenId = "fixture-" + i;
      const tag = document.createElement("span");
      tag.className = "tag";
      tag.style.cssText = "position:absolute;display:block;width:100px;height:30px;left:" + x + "px;top:" + y + "px";
      token.append(tag);
      host.append(token);
    });
    document.body.append(host);
  })()`;
  const clear = `document.querySelectorAll("[data-tag-fixture]").forEach((el) => el.remove())`;

  await page.evaluate(plant([[10, 10], [60, 20]]));
  const overlapping = collisions(await snapshot(page, "[data-tag-fixture]"));
  await page.evaluate(clear);
  await page.evaluate(plant([[10, 10], [110, 10]]));
  const touching = collisions(await snapshot(page, "[data-tag-fixture]"));
  await page.evaluate(clear);

  if (overlapping.length !== 1) throw new Error(`self-test: two planted overlapping tags gave ${overlapping.length} collision(s), expected 1`);
  if (touching.length !== 0) throw new Error(`self-test: two planted tags that only touch were reported as colliding`);
  console.log("✓ self-test: a planted overlap is seen; two tags that only touch are not");
}

async function main(): Promise<void> {
  const browser = await launch();
  let failed = false;
  try {
    const page = await browser.open(PHONE);
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

    // Three seated over HTTP, with their cookies kept so they can take their turns.
    const battleId = await newBattle(APP_URL);
    const seated: Joined[] = [];
    for (const [i, role] of (["herald", "lancer", "mender"] as const).entries()) {
      const seat = await joinBattle(APP_URL, battleId, longName(i + 1), role);
      if (seat.status !== 200 || !seat.characterId) throw new Error(`could not seat ${role} (join answered ${seat.status})`);
      seated.push(seat);
    }

    await page.goto(`${APP_URL}/?battle=${battleId}`);
    const width = await page.evaluate<{ cw: number; iw: number }>(`({ cw: document.documentElement.clientWidth, iw: innerWidth })`);
    if (width.cw !== PHONE.width) throw new Error(`clientWidth is ${width.cw}, not ${PHONE.width}: the emulation didn't take`);
    if (width.iw !== PHONE.width) throw new Error(`innerWidth is ${width.iw}, not ${PHONE.width}: the page overflows, fix that first (pnpm check:viewports)`);
    await selfTest(page);

    const me = await joinByForm(page);
    const party = [me, ...seated.map((s) => s.characterId as string)];

    let strikes = 0;
    let lastVersion = -1;
    let snapshots = 0;
    let mostTags = 0;
    const problems: string[] = [];
    for (const deadline = Date.now() + 120_000; strikes < STRIKES; ) {
      if (Date.now() > deadline) throw new Error(`only ${strikes} of ${STRIKES} strikes in 120s`);

      const s = await snapshot(page);
      if (s.version !== lastVersion) {
        lastVersion = s.version;
        snapshots++;
        mostTags = Math.max(mostTags, s.tags.length);
        if (s.tags.length !== s.tokens) problems.push(`v${s.version}: ${s.tokens} tokens on the rail but ${s.tags.length} visible tags`);
        for (const c of collisions(s)) problems.push(`v${s.version} after ${strikes} strike(s): ${c}`);
      }

      const st = await battle(APP_URL, battleId);
      if (st.status !== "fighting") {
        console.log(`  the battle ended (${st.status}) after ${strikes} strike(s)`);
        break;
      }
      const seat = seated.find((x) => x.characterId === st.activeId);
      if (seat) {
        if ((await act(APP_URL, battleId, seat.cookie, "strike")).status === 200) strikes++;
      } else if (st.activeId === me) {
        await page.until(`!document.querySelector('button[data-action="strike"]').disabled`, "my strike button", 5_000);
        await page.activate(`button[data-action="strike"]`);
        await page.until(`document.querySelector('[data-token-id="${me}"]')?.dataset.active !== "true"`, "my strike to land", 5_000);
        strikes++;
      } else {
        await sleep(40);
      }
    }

    if (mostTags < party.length) problems.push(`never saw more than ${mostTags} tags at once for a table of ${party.length}`);
    console.log(`  ${strikes} strikes, ${snapshots} rendered states measured, up to ${mostTags} tags at once`);

    if (problems.length > 0) {
      failed = true;
      const dir = mkdtempSync(join(tmpdir(), "raid-tags-"));
      const shot = join(dir, "phone-collision.png");
      await page.screenshot(shot);
      const unique = [...new Set(problems)];
      console.error(`\n✗ ${unique.length} collision(s) at ${PHONE.width}×${PHONE.height}:`);
      for (const p of unique.slice(0, 25)) console.error(`  ${p}`);
      if (unique.length > 25) console.error(`  …and ${unique.length - 25} more`);
      console.error(`  screenshot: ${shot}`);
    } else {
      console.log(`\n✓ no name tag collided at ${PHONE.width}×${PHONE.height}, across every state measured`);
    }
  } finally {
    await browser.close();
  }
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
