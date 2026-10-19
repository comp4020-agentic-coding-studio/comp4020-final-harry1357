import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { act, battle, join as joinBattle, newBattle, type Joined } from "../spec/raid.ts";
import { APP_URL, FORM_ROLE, PHONE, ProbeError, SEEDED, joinByForm, launch, sleep, tableDrawn, type Page } from "./check-viewports.ts";

// Do the party's name plates ever collide at 390×844?
//
//   APP_URL=http://localhost:8080 pnpm check:tags
//
// Off the `check` roster, like the other Chrome sensors (CLAUDE.md). Carried
// from the rail's name tags; the claim moved with the names, which now live on
// the party's plates on the field. A table of four with 24-character names
// (three seated over HTTP, one joined through the form) plays a run of turns,
// each seat its own role's blow, on a phone. In every state the page lands in, it measures every name plate
// `[data-plate]` on the field (the party's, and the Orrery's) and every sprite
// `[data-sprite]`, and fails if:
//   - two plates intersect,
//   - a sprite's box covers someone else's plate (its own plate it may), or
//   - a plate clips its own name (an ellipsis, or overflow hidden).
// A name you can't read is the same failure whichever of the three hides it.
//
// A plate belongs to the sprite named by its `data-plate` value, or else to
// the one sprite it sits inside or beside (its nearest ancestor holding
// exactly one `[data-sprite]`). A plate the sensor can't pin to a sprite is
// reported, never guessed: "someone else's" can't be judged without an owner.
// A sprite is measured by what it draws: where `[data-sprite]` is the whole
// member, plate included (as the scene builds it), its box would always cover
// its own name, so the sprite's box is its other children (the footprint the
// art stands in), never the member.
//
// Motion is reduced (prefers-reduced-motion), and the run proves that took.
// The claim is about where things LAND (CLAUDE.md: the field ends up exactly
// where the latest state says), and a frame caught mid-entrance isn't a
// landing. Each distinct layout is measured once.
//
// It proves it's looking before it measures. The emulation took
// (clientWidth), and the page fits (innerWidth); innerWidth is read on every
// state, not just the first, because a party of four long names can push a
// page out that fit when it was empty, and boxes measured in a viewport that
// grew describe a different page. And the same tests, run on planted boxes,
// see an overlap, a covered plate and a clipped name, and ignore two plates
// that only touch and a sprite over its own plate.
//
// The page's own character strikes over HTTP with the page's own session
// cookie (read over CDP), not through the command window: this claim is about
// the field, and the command window's flow is check:keyboard's to drive.

const STRIKES = Number(process.env.TAG_STRIKES ?? 16);
/** Each role's turn here: an action that needs no target and changes the field (a blow, a heal, a scan). */
const TURN: Readonly<Record<string, string>> = { warden: "counterweight", striker: "jab", mender: "mend", breaker: "scan", chronist: "relay" };
const TOLERANCE = 0.5; // px: touching edges and sub-pixel rounding aren't collisions
const SEATS = 4;

interface Box {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Snapshot {
  cw: number;
  iw: number;
  phase: string;
  version: number;
  plates: Box[];
  sprites: Box[];
  /** Plates whose name is cut off inside them. */
  clipped: string[];
  /** Plates that couldn't be pinned to a sprite. */
  orphans: string[];
}

const longName = (n: number): string => "W".repeat(22) + String(n).padStart(2, "0");

/** Runs in the page: every plate under `root`, every sprite under `field`. */
const COLLECT = (root: string, field: string): string => `(() => {
  const root = document.querySelector(${JSON.stringify(root)});
  const field = document.querySelector(${JSON.stringify(field)}) ?? root;
  if (!root) return null;
  const shown = (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const label = (el) => (el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 32);
  const owner = (plate) => {
    if (plate.dataset.plate) return plate.dataset.plate;
    const holder = plate.closest("[data-sprite]");
    if (holder) return holder.dataset.sprite;
    for (let p = plate.parentElement; p && p !== document.body; p = p.parentElement) {
      const inside = p.querySelectorAll("[data-sprite]");
      if (inside.length === 1) return inside[0].dataset.sprite || null;
      if (inside.length > 1) return null;
    }
    return null;
  };
  const box = (el, id, name) => {
    const r = el.getBoundingClientRect();
    return { id, name, x: r.left, y: r.top, w: r.width, h: r.height };
  };
  const plates = [];
  const clipped = [];
  const orphans = [];
  for (const plate of root.querySelectorAll("[data-plate]")) {
    if (!shown(plate)) continue;
    const id = owner(plate);
    if (!id) {
      orphans.push(label(plate));
      continue;
    }
    plates.push(box(plate, id, label(plate)));
    // A name cut off inside its plate: anything in it (the plate included)
    // whose content is wider or taller than its box while it hides overflow.
    for (const el of [plate, ...plate.querySelectorAll("*")]) {
      if (!shown(el) || !(el.textContent || "").trim()) continue;
      // Screen-reader words are clipped to 1px on purpose; a name nobody sees isn't cut off (as for sprites, below).
      const r = el.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1) continue;
      const s = getComputedStyle(el);
      // (an ellipsis only ever shows where overflow is hidden, so this covers it)
      const hidesX = s.overflowX !== "visible";
      const hidesY = s.overflowY !== "visible";
      if ((hidesX && el.scrollWidth > el.clientWidth + 1) || (hidesY && el.scrollHeight > el.clientHeight + 1)) {
        clipped.push(label(plate) + " (" + el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\\s+/)[0] : "") +
          " shows " + el.clientWidth + "×" + el.clientHeight + " of " + el.scrollWidth + "×" + el.scrollHeight + ")");
        break;
      }
    }
  }
  // A sprite is measured by what it draws. Where [data-sprite] is the whole
  // member (its art AND its own plate), the box that matters is its art: the
  // children that hold no plate, less any 1px screen-reader text.
  const drawn = (el) => {
    if (!el.querySelector("[data-plate]")) return [el.getBoundingClientRect()];
    return [...el.children]
      .filter((c) => !c.matches("[data-plate]") && !c.querySelector("[data-plate]") && shown(c))
      .map((c) => c.getBoundingClientRect())
      .filter((r) => r.width > 1 && r.height > 1);
  };
  const sprites = [];
  for (const el of field.querySelectorAll("[data-sprite]")) {
    if (!shown(el)) continue;
    const id = el.dataset.sprite || "?";
    const rects = drawn(el);
    if (!rects.length) continue;
    const left = Math.min(...rects.map((r) => r.left)), top = Math.min(...rects.map((r) => r.top));
    const right = Math.max(...rects.map((r) => r.right)), bottom = Math.max(...rects.map((r) => r.bottom));
    sprites.push({ id, name: id, x: left, y: top, w: right - left, h: bottom - top });
  }
  const rail = document.querySelector("[data-rail]");
  const battle = document.getElementById("battle");
  return {
    cw: document.documentElement.clientWidth,
    iw: innerWidth,
    phase: battle ? battle.dataset.phase || "" : "",
    version: Number(rail?.dataset.version ?? -1),
    plates, sprites, clipped, orphans,
  };
})()`;

function overlap(a: Box, b: Box): number {
  const across = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const down = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return across > TOLERANCE && down > TOLERANCE ? across * down : 0;
}

const describeBox = (b: Box): string =>
  `${b.name || b.id} [${b.x.toFixed(1)},${b.y.toFixed(1)} ${b.w.toFixed(1)}×${b.h.toFixed(1)}]`;

/** Every way a name in this snapshot can't be read. */
export function collisions(s: Pick<Snapshot, "plates" | "sprites" | "clipped" | "orphans">): string[] {
  const found: string[] = [];
  for (let i = 0; i < s.plates.length; i++) {
    for (let j = i + 1; j < s.plates.length; j++) {
      const area = overlap(s.plates[i], s.plates[j]);
      if (area > 0) found.push(`plate ${describeBox(s.plates[i])} and plate ${describeBox(s.plates[j])} overlap by ${area.toFixed(0)}px²`);
    }
  }
  for (const sprite of s.sprites) {
    for (const plate of s.plates) {
      if (plate.id === sprite.id) continue;
      const area = overlap(sprite, plate);
      if (area > 0) found.push(`the sprite of ${sprite.id} ${describeBox(sprite)} covers the plate ${describeBox(plate)} by ${area.toFixed(0)}px²`);
    }
  }
  for (const c of s.clipped) found.push(`a plate clips its name: ${c}`);
  for (const o of s.orphans) found.push(`a plate belongs to no sprite (no data-plate value, and no single [data-sprite] beside it): "${o}"`);
  return found;
}

async function snapshot(page: Page, root = "[data-scene]", field = "[data-scene]"): Promise<Snapshot> {
  const s = await page.evaluate<Snapshot | null>(COLLECT(root, field));
  if (!s) throw new Error(`no ${root} on the page`);
  return s;
}

/** The sensor sees each failure it was shown, and none that isn't there. */
async function selfTest(page: Page): Promise<void> {
  // Each member: [x, y] of its plate (100×30), optionally its sprite's box,
  // and whether the plate names its owner by value or by sitting beside it.
  // `whole`: the scene's shape, where [data-sprite] is the member itself and
  // holds its art and its own plate; otherwise sprite and plate are siblings.
  type Member = { plate: [number, number]; sprite?: [number, number, number, number]; byValue?: boolean; name?: string; clip?: boolean; whole?: boolean; said?: string };
  const plant = (members: Member[]): string => `(() => {
    const host = document.createElement("div");
    host.dataset.plateFixture = "";
    host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
    ${JSON.stringify(members)}.forEach((m, i) => {
      const member = document.createElement("div");
      const sprite = document.createElement("div");
      if (m.whole) member.dataset.sprite = "fixture-" + i;
      else sprite.dataset.sprite = "fixture-" + i;
      const s = m.sprite || [0, 0, 1, 1];
      sprite.style.cssText = "position:absolute;left:" + s[0] + "px;top:" + s[1] + "px;width:" + s[2] + "px;height:" + s[3] + "px";
      const plate = document.createElement("div");
      plate.dataset.plate = m.byValue ? "fixture-" + i : "";
      plate.style.cssText = "position:absolute;width:100px;height:30px;left:" + m.plate[0] + "px;top:" + m.plate[1] + "px";
      const name = document.createElement("span");
      name.textContent = m.name || ("P" + i);
      name.style.cssText = m.clip ? "display:block;width:40px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis" : "display:block";
      plate.append(name);
      if (m.said) {
        // the plate's words for a screen reader: the page's own 1px clip, on purpose
        const said = document.createElement("span");
        said.className = "visually-hidden";
        said.textContent = m.said;
        plate.append(said);
      }
      member.append(sprite, plate);
      host.append(member);
    });
    document.body.append(host);
  })()`;
  const clear = `document.querySelectorAll("[data-plate-fixture]").forEach((el) => el.remove())`;
  const run = async (members: Member[]): Promise<string[]> => {
    await page.evaluate(plant(members));
    try {
      return collisions(await snapshot(page, "[data-plate-fixture]", "[data-plate-fixture]"));
    } finally {
      await page.evaluate(clear);
    }
  };

  const cases: { what: string; members: Member[]; expect: number }[] = [
    { what: "two overlapping plates", members: [{ plate: [10, 10] }, { plate: [60, 20], byValue: true }], expect: 1 },
    { what: "two plates that only touch", members: [{ plate: [10, 10] }, { plate: [110, 10] }], expect: 0 },
    {
      what: "a sprite over someone else's plate",
      members: [{ plate: [10, 100], sprite: [200, 10, 60, 60] }, { plate: [220, 40], sprite: [400, 10, 60, 60] }],
      expect: 1,
    },
    { what: "a sprite over its own plate", members: [{ plate: [10, 100], sprite: [0, 60, 120, 60], byValue: true }], expect: 0 },
    {
      what: "a whole member whose art covers someone else's plate",
      members: [{ plate: [10, 100], sprite: [200, 10, 60, 60], whole: true }, { plate: [220, 40], sprite: [400, 10, 60, 60], whole: true }],
      expect: 1,
    },
    {
      what: "whole members whose art clears every other plate",
      members: [{ plate: [10, 100], sprite: [10, 10, 100, 85], whole: true }, { plate: [220, 100], sprite: [220, 10, 100, 85], whole: true }],
      expect: 0,
    },
    { what: "a plate that clips its name", members: [{ plate: [10, 10], name: longName(7), clip: true }], expect: 1 },
    { what: "a plate that shows its whole name", members: [{ plate: [10, 10], name: "Ada" }], expect: 0 },
    { what: "a plate whose screen-reader words are clipped to 1px on purpose", members: [{ plate: [10, 10], name: "Ada", said: longName(7) }], expect: 0 },
    { what: "a plate that clips its name beside its screen-reader words", members: [{ plate: [10, 10], name: longName(7), clip: true, said: longName(6) }], expect: 1 },
  ];
  for (const c of cases) {
    const found = await run(c.members);
    if (found.length !== c.expect) {
      throw new ProbeError(`self-test: ${c.what} gave ${found.length} finding(s), expected ${c.expect}${found.length ? `: ${found.join("; ")}` : ""}`);
    }
  }
  console.log(
    "✓ self-test: a planted overlap, covered plate and clipped name are seen; touching plates, a sprite over its own plate and 1px screen-reader words are not",
  );
}

/** The page's own session cookie, HttpOnly and all, as a Cookie header. */
async function pageCookie(page: Page): Promise<string> {
  const { cookies } = (await page.send("Network.getCookies", { urls: [APP_URL] })) as { cookies: { name: string; value: string }[] };
  if (!cookies.length) throw new Error("the page holds no session cookie after joining");
  return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function main(): Promise<void> {
  try {
    const res = await fetch(APP_URL);
    if (!res.ok) throw new Error(`answered ${res.status}`);
  } catch (error) {
    console.error(`✗ nothing healthy at APP_URL=${APP_URL} (${(error as Error).message}). Start the app first.`);
    process.exit(2);
  }

  const browser = await launch();
  let failed = false;
  try {
    const page = await browser.open(PHONE);
    await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

    // Three seated over HTTP, with their cookies kept so they can take their
    // turns: three roles, so the form's Breaker makes four different sprites.
    const battleId = await newBattle(APP_URL);
    const seated: (Joined & { role: string })[] = [];
    for (const [i, role] of SEEDED.entries()) {
      const seat = await joinBattle(APP_URL, battleId, longName(i + 1), role);
      if (seat.status !== 200 || !seat.characterId) throw new Error(`could not seat ${role} (join answered ${seat.status})`);
      seated.push({ ...seat, role });
    }

    await page.goto(`${APP_URL}/?battle=${encodeURIComponent(battleId)}`);
    if (!(await page.evaluate<boolean>(`matchMedia("(prefers-reduced-motion: reduce)").matches`))) {
      throw new ProbeError("prefers-reduced-motion: reduce didn't take, so frames would be caught mid-motion rather than landed");
    }
    // clientWidth, then innerWidth, before anything on the page is believed.
    const width = await page.evaluate<{ cw: number; iw: number }>(`({ cw: document.documentElement.clientWidth, iw: innerWidth })`);
    if (width.cw !== PHONE.width) throw new ProbeError(`clientWidth is ${width.cw}, not ${PHONE.width}: the emulation didn't take`);
    if (width.iw !== PHONE.width) throw new Error(`innerWidth is ${width.iw}, not ${PHONE.width}: the page overflows, fix that first (pnpm check:viewports)`);
    await selfTest(page);

    const me = await joinByForm(page);
    await tableDrawn(page, SEATS);
    const cookie = await pageCookie(page);
    const everyone = [me, ...seated.map((s) => s.characterId as string)];

    let strikes = 0;
    let measured = 0;
    let mostPlates = 0;
    let lastKey = "";
    const problems: string[] = [];
    for (const deadline = Date.now() + 120_000; strikes < STRIKES; ) {
      if (Date.now() > deadline) throw new Error(`only ${strikes} of ${STRIKES} strikes in 120s`);

      const s = await snapshot(page);
      const key = [s.phase, s.iw, ...[...s.plates, ...s.sprites].map((b) => `${b.id}:${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`), ...s.clipped].join("|");
      if (key !== lastKey && s.phase === "fight") {
        lastKey = key;
        measured++;
        if (s.cw !== PHONE.width) throw new ProbeError(`v${s.version}: clientWidth is ${s.cw}, not ${PHONE.width}: the emulation came undone`);
        if (s.iw !== PHONE.width) {
          // Not measured: boxes in a viewport that grew describe a different page.
          problems.push(`v${s.version} after ${strikes} strike(s): innerWidth is ${s.iw}, not ${PHONE.width}; the page overflowed, so this state's boxes weren't believed`);
        } else {
          const partyPlates = s.plates.filter((b) => everyone.includes(b.id)).length;
          const partySprites = s.sprites.filter((b) => everyone.includes(b.id)).length;
          mostPlates = Math.max(mostPlates, partyPlates);
          if (partyPlates < partySprites) {
            problems.push(`v${s.version}: ${partySprites} party sprite(s) on the field but ${partyPlates} visible party plate(s)`);
          }
          for (const c of collisions(s)) problems.push(`v${s.version} after ${strikes} strike(s): ${c}`);
        }
      }

      const st = await battle(APP_URL, battleId);
      if (st.status !== "fighting" && st.status !== "waiting") {
        console.log(`  the battle ended (${st.status}) after ${strikes} strike(s)`);
        break;
      }
      const up = st.activeId === me ? { cookie, role: FORM_ROLE } : seated.find((x) => x.characterId === st.activeId);
      if (up && st.status === "fighting") {
        if ((await act(APP_URL, battleId, up.cookie, TURN[up.role] ?? "brace")).status === 200) strikes++;
      } else {
        await sleep(40);
      }
    }

    if (mostPlates < SEATS) problems.push(`never saw more than ${mostPlates} plates at once for a table of ${SEATS}`);
    if (measured === 0) problems.push("no rendered state was measured");
    console.log(`  ${strikes} strikes, ${measured} landed states measured, up to ${mostPlates} plates at once`);

    if (problems.length > 0) {
      failed = true;
      const dir = mkdtempSync(join(tmpdir(), "raid-tags-"));
      const shot = join(dir, "phone-collision.png");
      await page.screenshot(shot);
      const unique = [...new Set(problems)];
      console.error(`\n✗ ${unique.length} problem(s) at ${PHONE.width}×${PHONE.height}:`);
      for (const p of unique.slice(0, 25)) console.error(`  ${p}`);
      if (unique.length > 25) console.error(`  …and ${unique.length - 25} more`);
      console.error(`  screenshot (of the last state, for the post-mortem): ${shot}`);
    } else {
      console.log(`\n✓ no name plate was covered or clipped at ${PHONE.width}×${PHONE.height}, across every landed state measured`);
    }
  } catch (error) {
    failed = true;
    console.error(`✗ ${error instanceof ProbeError ? "the probe itself failed" : "couldn't finish"}: ${(error as Error).message}`);
  } finally {
    await browser.close();
  }
  if (failed) process.exit(1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
