import { battle, boss, newBattle, suffix } from "../spec/raid.ts";
import { APP_URL, DESKTOP, launch, type Page, ProbeError, type Rect, SHIFT, settleScroll } from "./check-viewports.ts";

// Can the raid be played with a keyboard alone?
//
//   APP_URL=http://localhost:8094 pnpm check:keyboard
//
// At 1920×1080, on a fresh battle, with trusted key events
// (Input.dispatchKeyEvent; a page's own dispatchEvent is not a person):
//
//   1. From page load, Tab through the page. Every stop must show a focus
//      indicator and be on screen once scrolling settles.
//   2. Join by keyboard only: Tab into the role radios and choose with the
//      arrow keys, Tab to the name, type it, Tab to submit, press Enter.
//   3. Wait for the server to put you on the plate, Tab to Strike, check Tab
//      can carry focus back OUT of the action panel (no trap), come back, and
//      press Enter to aim (the Orrery lights) and Enter to confirm. The strike has to land: your token's data-counter leaves 0
//      and the Orrery's HP drops, read from the server rather than the page.
//   4. Tab through the joined page too, so the rail and log are held to the
//      same indicator and on-screen rules as the form.
//
// An indicator is an outline or a box-shadow that is visible WHILE focused
// and differs from the same element at rest, so the 2px 2px 0 token shadow
// the design puts on things at rest can't pass for a focus ring. A visually
// hidden radio may carry its ring on its label (or its parent), so those are
// checked too. axe can't see any of this: a ring killed by `all: unset` is
// invisible to it. Crit 7 found exactly that by tabbing with CDP and reading
// the computed outline, which is what this does.
//
// Not in `pnpm check`, for the same reason as check:viewports: it needs
// Chrome. It also needs the turn clock, so it takes up to ~40s.

const TURN_WAIT_MS = 20_000;

interface Indicator {
  on: "self" | "label" | "parent";
  text: string;
  /** Never seen unfocused, so "differs from rest" couldn't be checked. */
  unverified: boolean;
}

interface Focus {
  id: number;
  tag: string;
  name: string;
  rect: Rect | null;
  onScreen: boolean;
  indicator: Indicator | null;
  inActions: boolean;
  isName: boolean;
  isRole: boolean;
  isSubmit: boolean;
  isStrike: boolean;
  checked: boolean | null;
  value: string;
}

interface Stop extends Focus {
  phase: string;
  key: string;
}

// Installed lazily into each document: stable ids for elements (so a cycle
// can be seen), resting styles (so a ring can be told from a shadow that was
// always there), and the reading of whatever has focus.
const KB = `(window.__kb ??= (() => {
  const ids = new WeakMap();
  let next = 1;
  const rest = new WeakMap();
  const id = (el) => (ids.has(el) || ids.set(el, next++), ids.get(el));
  const look = (el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth) || 0, color: s.outlineColor, offset: s.outlineOffset, shadow: s.boxShadow };
  };
  const clear = (c) => c === "transparent" || /rgba\\([^)]*,\\s*0(\\.0+)?\\)$/.test(c);
  // Only what can be SEEN: an outline-offset that changes under
  // outline:none is a difference nobody can see, and must not count.
  const ring = (l) => {
    const parts = [];
    if (l.style !== "none" && l.width >= 1 && !clear(l.color)) parts.push("outline " + l.style + " " + l.width + "px " + l.color + (l.offset !== "0px" ? " offset " + l.offset : ""));
    if (l.shadow && l.shadow !== "none") parts.push("box-shadow " + l.shadow);
    return parts.length ? parts.join(" + ") : null;
  };
  const related = (el) => [["self", el], ...[...(el.labels || [])].map((l) => ["label", l]), ...(el.parentElement ? [["parent", el.parentElement]] : [])];
  const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex], [contenteditable]';
  const snapshot = () => {
    const active = document.activeElement;
    for (const el of document.querySelectorAll(FOCUSABLE)) {
      for (const [, r] of related(el)) if (!(active && r.contains(active))) rest.set(r, look(r));
    }
  };
  const indicator = (el) => {
    for (const [on, r] of related(el)) {
      const now = look(r);
      const text = ring(now);
      if (!text) continue;
      const before = rest.get(r);
      if (before && ring(before) === text) continue; // looks the same at rest: not a focus indicator
      return { on, text, unverified: !before };
    }
    return null;
  };
  const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
  const name = (el) => {
    const label = el.getAttribute("aria-label");
    if (label) return clean(label);
    const by = el.getAttribute("aria-labelledby");
    if (by) return clean(by.split(/\\s+/).map((i) => document.getElementById(i)?.textContent).join(" "));
    if (el.labels && el.labels.length) return clean([...el.labels].map((l) => l.textContent).join(" "));
    return clean(el.textContent) || clean(el.getAttribute("title")) || clean(el.getAttribute("placeholder")) || clean(el.value);
  };
  const tag = (el) => {
    let s = el.tagName.toLowerCase();
    if (el instanceof HTMLInputElement) s += "[" + el.type + "]";
    if (el.getAttribute("name")) s += "[name=" + el.getAttribute("name") + "]";
    if (el instanceof HTMLInputElement && el.type === "radio") s += "[value=" + el.value + "]";
    for (const a of ["data-action", "data-token-id", "data-rail", "data-log"]) if (el.hasAttribute(a)) s += "[" + a + (el.getAttribute(a) ? "=" + el.getAttribute(a) : "") + "]";
    return s;
  };
  const state = () => {
    const el = document.activeElement;
    const base = { inActions: false, isName: false, isRole: false, isSubmit: false, isStrike: false, checked: null, value: "" };
    if (!el || el === document.body || el === document.documentElement) {
      return { ...base, id: 0, tag: el ? "<" + el.tagName.toLowerCase() + ">" : "<none>", name: "", rect: null, onScreen: false, indicator: null };
    }
    const r = el.getBoundingClientRect();
    const within = (lo, hi, size, limit) => (size > limit ? hi > 0 && lo < limit : lo >= -1 && hi <= limit + 1);
    return {
      ...base,
      id: id(el),
      tag: tag(el),
      name: name(el).slice(0, 34),
      rect: { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) },
      onScreen: within(r.left, r.right, r.width, innerWidth) && within(r.top, r.bottom, r.height, innerHeight),
      indicator: indicator(el),
      inActions: !!el.closest("[data-actions]"),
      isName: el.matches('form[data-join] input[name="name"]'),
      isRole: el.matches('input[type="radio"][name="role"]'),
      isSubmit: el.matches('form[data-join] button[type="submit"], form[data-join] input[type="submit"]'),
      isStrike: el.matches('button[data-action="strike"]'),
      checked: el instanceof HTMLInputElement ? el.checked : null,
      value: el instanceof HTMLInputElement ? el.value : "",
    };
  };
  return { snapshot, state };
})())`;

const STRIKE_LIVE = `(() => {
  const b = document.querySelector('button[data-action="strike"]');
  return !!b && !b.disabled && b.getAttribute("aria-disabled") !== "true";
})()`;

const stops: Stop[] = [];
const failures: string[] = [];
const notes: string[] = [];

const keyLabel = (key: string, modifiers: number): string =>
  (modifiers & SHIFT ? "⇧" : "") + ({ ArrowDown: "↓", ArrowUp: "↑", ArrowLeft: "←", ArrowRight: "→" }[key] ?? key);

async function current(page: Page): Promise<Focus> {
  return page.evaluate<Focus>(`${KB}.state()`);
}

/** One trusted key press, recorded as a stop once scrolling has settled. */
async function step(page: Page, phase: string, key: "Tab" | "Enter" | "ArrowDown" = "Tab", modifiers = 0): Promise<Focus> {
  await page.evaluate(`${KB}.snapshot()`);
  await page.press(key, modifiers);
  await settleScroll(page.evaluate);
  const focus = await current(page);
  stops.push({ ...focus, phase, key: keyLabel(key, modifiers) });
  return focus;
}

/** Tab (or Shift+Tab) until `done`, failing loudly if it never comes. */
async function tabUntil(page: Page, phase: string, done: (f: Focus) => boolean, what: string, max: number, modifiers = 0): Promise<Focus> {
  let focus = await current(page);
  if (done(focus)) return focus;
  for (let i = 0; i < max; i++) {
    focus = await step(page, phase, "Tab", modifiers);
    if (done(focus)) return focus;
  }
  throw new Error(`${max} presses of ${keyLabel("Tab", modifiers)} never reached ${what}`);
}

/** One full lap of Tab from wherever focus is: past the last control (where
 *  focus leaves the document), round to the top, and on until a control
 *  comes up a second time. Also catches a key trap that holds focus still. */
async function sweep(page: Page, phase: string, max = 80): Promise<void> {
  const seen = new Set<number>();
  let previous = -1;
  for (let i = 0; i < max; i++) {
    const focus = await step(page, phase);
    if (focus.id === 0) {
      if (previous === 0) return; // twice in a row: nothing on the page takes focus
      previous = 0;
      continue;
    }
    if (focus.id === previous) {
      failures.push(`${phase}: Tab doesn't move focus off ${focus.tag} "${focus.name}" (a key trap)`);
      return;
    }
    if (seen.has(focus.id)) return; // a full lap
    seen.add(focus.id);
    previous = focus.id;
  }
  failures.push(`${phase}: ${max} Tab presses without completing a lap`);
}

/**
 * Prove the probe can fail before trusting a green one, on the real page with
 * its real stylesheet: plant four controls at the top of <body> and check
 * each gets the verdict it deserves. A ringless button and a button whose
 * only "ring" is a shadow it also wears at rest must both read as NO
 * indicator; one parked above the viewport must read as off screen; one
 * with an honest :focus-visible outline must pass. A sensor that has stopped
 * looking reports exactly what a clean page reports.
 */
async function selfTest(page: Page): Promise<void> {
  await page.evaluate(`(() => {
    const style = document.createElement("style");
    style.textContent = "#kb-ringed:focus-visible { outline: 3px solid #000 !important; outline-offset: 2px !important; }";
    const box = document.createElement("div");
    box.id = "kb-canaries";
    // A focusable start point ahead of the canaries: blur() alone leaves the
    // browser's focus starting point wherever the page last put focus (the
    // join screen focuses its name field), and Tab would go on from there.
    box.innerHTML =
      '<span id="kb-start" tabindex="-1"></span>' +
      '<button id="kb-ringless" style="outline:none !important;box-shadow:none !important">ringless</button>' +
      '<button id="kb-shadowed" style="outline:none !important;box-shadow:2px 2px 0 #000 !important">shadowed</button>' +
      '<button id="kb-above" style="position:fixed !important;top:-200px !important;left:0 !important">above</button>' +
      '<button id="kb-ringed" style="outline:none">ringed</button>';
    box.prepend(style);
    document.body.prepend(box);
    document.getElementById("kb-start").focus();
  })()`);
  const verdicts: string[] = [];
  const expect = async (id: string, ok: (f: Focus) => boolean, what: string): Promise<void> => {
    await page.evaluate(`${KB}.snapshot()`);
    await page.press("Tab");
    await settleScroll(page.evaluate);
    const f = await page.evaluate<Focus & { domId: string }>(`({ ...${KB}.state(), domId: document.activeElement?.id ?? "" })`);
    if (f.domId !== id) verdicts.push(`expected Tab to reach #${id}, got ${f.tag}#${f.domId}`);
    else if (!ok(f)) verdicts.push(`#${id}: ${what} (read indicator ${JSON.stringify(f.indicator)}, onScreen ${f.onScreen})`);
  };
  await expect("kb-ringless", (f) => f.indicator === null, "a button with outline:none read as ringed");
  await expect("kb-shadowed", (f) => f.indicator === null, "a shadow worn at rest read as a focus ring");
  await expect("kb-above", (f) => !f.onScreen, "a button 200px above the viewport read as on screen");
  await expect("kb-ringed", (f) => f.indicator !== null && f.onScreen, "an honest :focus-visible outline read as no ring");
  if (verdicts.length) throw new ProbeError(`self-test: the probe is blind --- ${verdicts.join("; ")}`);
  console.log("✓ self-test: planted ringless, shadow-at-rest and off-screen controls are caught; a ringed one passes");
}

async function run(page: Page): Promise<void> {
  const battleId = await newBattle(APP_URL);
  console.log(`battle ${battleId}`);
  const url = new URL(`/?battle=${encodeURIComponent(battleId)}`, APP_URL).href;
  await page.goto(url);
  await page.until(`!!document.querySelector("form[data-join]")`, "form[data-join]", 10_000);
  await selfTest(page);
  // A fresh load for the real thing, canaries gone.
  await page.goto(url);
  await page.until(`!!document.querySelector("form[data-join]")`, "form[data-join]", 10_000);

  // 1. From page load.
  await sweep(page, "load");
  if (!stops.some((s) => s.phase === "load" && s.id !== 0)) {
    throw new Error("the first Tab from page load focused nothing: no control on the page takes focus");
  }

  // 2. Join by keyboard only: the role first, then the name (the form's order).
  let focus = await tabUntil(page, "join", (f) => f.isRole, 'a role radio, input[type="radio"][name="role"]', 30);
  const checkedRole = (): Promise<string | null> =>
    page.evaluate<string | null>(`document.querySelector('input[type="radio"][name="role"]:checked')?.value ?? null`);
  let picked = await checkedRole();
  let moved = 0;
  for (let i = 0; i < 8 && !(picked === "herald" && moved > 0); i++) {
    focus = await step(page, "join", "ArrowDown");
    const now = await checkedRole();
    if (now === picked || !focus.isRole || !focus.checked) {
      throw new Error(
        `ArrowDown in the role group left the choice at ${picked ?? "nothing"} (focus on ${focus.tag}): the radios don't answer arrow keys`,
      );
    }
    picked = now;
    moved += 1;
  }
  if (picked !== "herald") throw new Error(`the arrow keys cycled the roles without reaching herald (stuck on ${picked})`);
  console.log(`✓ the arrow keys move through the role radios (${moved} press(es) to reach herald)`);

  await tabUntil(page, "join", (f) => f.isName, 'form[data-join] input[name="name"]', 10);
  const name = `Keys ${suffix()}`;
  await page.type(name);
  const typed = (await current(page)).value;
  if (typed !== name) throw new Error(`typed "${name}" into the name field and it holds "${typed}"`);

  await tabUntil(page, "join", (f) => f.isSubmit, "the join form's submit button", 10);
  await step(page, "join", "Enter");
  const me = await page.until<string>(`document.body.dataset.me`, "document.body.dataset.me after pressing Enter on join", 10_000);
  console.log(`✓ joined by keyboard alone as "${name}" (herald), body.dataset.me = ${me}`);

  // 3. My turn, by keyboard.
  const myToken = `document.querySelector('[data-token-id="${me}"]')`;
  await page.until(`!!${myToken}`, `my token [data-token-id="${me}"] on the rail`, 5_000);
  const waitStart = Date.now();
  await page.until(STRIKE_LIVE, 'button[data-action="strike"] to be enabled (my turn)', TURN_WAIT_MS);
  const turnStart = Date.now();
  console.log(`✓ my turn after ${((turnStart - waitStart) / 1000).toFixed(1)}s`);
  const counterAtTurn = await page.evaluate<string | null>(`${myToken}?.dataset.counter ?? null`);
  if (counterAtTurn !== "0") {
    failures.push(`the action panel is live while my token's data-counter is ${counterAtTurn}, not 0: the rail and the panel disagree`);
  }
  if ((await current(page)).isStrike) notes.push("focus was moved to Strike when the turn arrived");

  await tabUntil(page, "turn", (f) => f.isStrike, 'button[data-action="strike"]', 40);
  // No trap: Tab must be able to carry focus out of the live panel...
  try {
    await tabUntil(page, "turn", (f) => !f.inActions, "anything outside [data-actions]", 15);
    console.log("✓ Tab carries focus out of the action panel (no trap)");
  } catch {
    failures.push("focus trap: 15 Tab presses from Strike never left [data-actions]");
  }
  // ...and back again, the long way round if need be.
  await tabUntil(page, "turn", (f) => f.isStrike, 'button[data-action="strike"] again (Shift+Tab)', 40, SHIFT);
  if (!(await page.evaluate<boolean>(STRIKE_LIVE))) {
    throw new Error(`my turn ended (${((Date.now() - turnStart) / 1000).toFixed(1)}s in) before Enter was pressed on Strike`);
  }
  const before = boss(await battle(APP_URL, battleId));
  // Strike is two presses (CLAUDE.md, "Design: the battle screen"): the first
  // aims it and lights the Orrery, the second confirms. Aiming alone must not
  // fire: the server's Orrery is unhurt until the confirm.
  await step(page, "turn", "Enter");
  try {
    await page.until(`!!document.querySelector("[data-boss][data-targeted]")`, "the Orrery to be highlighted as Strike's target", 2_000);
    console.log("✓ Enter on Strike aims it: the Orrery is highlighted before anything fires");
  } catch (error) {
    failures.push(`Enter on Strike didn't highlight the Orrery: ${(error as Error).message}`);
  }
  const aimed = boss(await battle(APP_URL, battleId));
  if (before && aimed && aimed.hp < before.hp) failures.push("aiming Strike already hurt the Orrery: it fired without a confirm");
  await step(page, "turn", "Enter");
  const pressed = Date.now();

  // The strike landed: my token leaves the plate (the server reset its
  // counter), and the Orrery is hurt. The second is read from the server, so
  // a 20s timeout resetting my counter can't pass for a strike.
  try {
    const after = await page.until<string>(
      `(() => { const c = ${myToken}?.dataset.counter; return c !== undefined && Number(c) > 0 ? c : null; })()`,
      `my token's data-counter to go above 0 after Strike`,
      5_000,
    );
    console.log(`✓ Strike landed: my data-counter went 0 → ${after} in ${((Date.now() - pressed) / 1000).toFixed(1)}s`);
  } catch (error) {
    failures.push(`Enter on Strike didn't land in the page: ${(error as Error).message}`);
  }
  const hurt = boss(await battle(APP_URL, battleId));
  if (!before || !hurt) failures.push("the server's state has no Orrery to check the strike against");
  else if (hurt.hp >= before.hp) failures.push(`the server says the Orrery is still at ${hurt.hp}/${hurt.maxHp} HP: the strike never reached it`);
  else console.log(`✓ the server agrees: the Orrery went ${before.hp} → ${hurt.hp} HP`);

  // 4. The joined page, the same rules.
  await sweep(page, "joined");
}

function table(): void {
  const rows = stops.map((s, i) => [
    String(i + 1),
    s.phase,
    s.key,
    s.tag,
    s.name ? `"${s.name}"` : "",
    s.rect ? `${s.rect.x},${s.rect.y} ${s.rect.width}×${s.rect.height}` : "",
    s.id === 0 ? "(left the page)" : s.indicator ? `${s.indicator.on === "self" ? "" : `on ${s.indicator.on}: `}${s.indicator.text}${s.indicator.unverified ? " (never seen at rest)" : ""}` : "NONE",
    s.id === 0 ? "" : !s.indicator ? "✗ no ring" : !s.onScreen ? "✗ off screen" : "✓",
  ]);
  const head = ["#", "phase", "key", "focused", "name", "rect", "indicator", ""];
  const widths = head.map((h, c) => Math.min(c === 6 ? 64 : 48, Math.max(h.length, ...rows.map((r) => r[c].length))));
  const line = (cells: string[]): string =>
    cells.map((cell, c) => (cell.length > widths[c] ? `${cell.slice(0, widths[c] - 1)}…` : cell.padEnd(widths[c]))).join("  ");
  console.log(`\n${line(head)}\n${widths.map((w) => "-".repeat(w)).join("  ")}`);
  for (const row of rows) console.log(line(row));
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
  try {
    const page = await browser.open(DESKTOP);
    const size = await page.evaluate<string>(`document.documentElement.clientWidth + "×" + innerHeight`);
    if (size !== "1920×1080") throw new ProbeError(`asked for 1920×1080 and the page is ${size}`);
    try {
      await run(page);
    } catch (error) {
      if (error instanceof ProbeError) throw error;
      failures.push((error as Error).message);
    } finally {
      await page.close();
    }
  } catch (error) {
    failures.push(`the probe itself failed: ${(error as Error).message}`);
  } finally {
    await browser.close();
  }

  // Every stop, held to the two rules.
  for (const [i, s] of stops.entries()) {
    if (s.id === 0) continue;
    if (!s.indicator) failures.push(`stop ${i + 1} (${s.phase}): ${s.tag} "${s.name}" has no visible focus indicator`);
    else if (!s.onScreen) failures.push(`stop ${i + 1} (${s.phase}): ${s.tag} "${s.name}" is off screen at ${JSON.stringify(s.rect)}`);
    // Not a failure (the ring is drawn), but a Tab stop on a box with no
    // height is a ring around nothing, and worth a person's look.
    if (s.rect && (s.rect.width < 2 || s.rect.height < 2) && s.indicator?.on === "self") {
      const note = `${s.tag} "${s.name}" takes focus with a ${s.rect.width}×${s.rect.height} box (${s.phase}): a ring around nothing`;
      if (!notes.includes(note)) notes.push(note);
    }
  }
  // A sweep that saw nothing is not a clean sweep.
  if (stops.filter((s) => s.id !== 0).length < 3) failures.push(`only ${stops.length} focus stop(s) recorded: the probe saw too little to vouch for`);

  table();
  for (const note of notes) console.log(`note: ${note}`);
  if (failures.length) {
    console.error(`\n✗ ${failures.length} keyboard failure(s):`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`\n✓ ${stops.length} focus stops, every one ringed and on screen; joined and struck by keyboard alone`);
}

await main();
