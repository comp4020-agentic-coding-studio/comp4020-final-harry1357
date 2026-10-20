import { beforeAll, describe, expect, inject, it } from "vitest";
import { colour, parseCss, type Rule, rootToken, servedCss } from "./served-css.ts";

// Contrast is checkable arithmetic, so check it.
//
// Carried from crit 7, where it existed because `--ink-faint` shipped at
// 3.01:1 in crit 5 and looked perfectly fine in a screenshot. Nothing else in
// this roster looks at colour at all: there is no axe pass with layout here,
// and a screenshot is an opinion.
//
// It reads the custom properties out of the CSS the app actually SERVES (the
// stylesheet `/` links), not the source, so a token that is renamed, dropped
// or overridden fails loudly instead of quietly passing. The pairs are the
// battle screen's (CLAUDE.md, "Design: the battle screen"), each one against
// the ground that ink is really painted on, not against the page. When the
// palette changes, these pairs change with it, deliberately.

const baseUrl = inject("baseUrl");

function channel(value: number): number {
  const ratio = value / 255;
  return ratio <= 0.04045 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16));
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio, 1 to 21. Takes `#rrggbb`. */
function contrast(foreground: string, background: string): number {
  const [lighter, darker] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (lighter + 0.05) / (darker + 0.05);
}

let served = "";
let sheet: Rule[] = [];

beforeAll(async () => {
  served = await servedCss(baseUrl, ["/"]);
  sheet = parseCss(served);
});

/** A palette token as `:root` sets it, followed through var() to an opaque
 *  hex. Missing is a failure with its name on it, never a skipped pair. */
function token(name: string): string {
  const value = rootToken(sheet, name);
  expect(value, `no --${name} declared at :root in the CSS that / serves: renamed, dropped, or never shipped?`).toBeTruthy();
  const hex = colour(value as string, sheet);
  expect(hex, `--${name} is \`${value}\`, which isn't an opaque colour this test can do the arithmetic on`).toMatch(
    /^#[0-9a-f]{6}$/,
  );
  return hex;
}

const ratio = (fg: string, bg: string): string => `${contrast(token(fg), token(bg)).toFixed(2)}:1`;

describe("the battle screen's palette, checked as arithmetic", () => {
  it("does the WCAG arithmetic correctly", () => {
    // The sensor checks itself on known values before it judges the palette.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("found CSS served by / to read", () => {
    expect(served.length, "no CSS served by /").toBeGreaterThan(100);
  });

  // Text pairs, 4.5:1: window text, quiet window text, names and numbers on
  // the field, and harm, which is sometimes a word as well as a flash.
  it.each([
    ["card", "ink", "window text"],
    ["card-quiet", "ink", "quiet text on a window"],
    ["card", "void", "names and damage numbers on the field"],
    ["ember", "ink", "harm on a window"],
    ["ember", "void", "harm on the field"],
    ["ink", "card", "the /readme/ page, outside #battle"],
  ])("carries --%s on --%s at 4.5:1 (%s)", (fg, bg) => {
    expect(contrast(token(fg), token(bg)), `--${fg} on --${bg} is ${ratio(fg, bg)}`).toBeGreaterThanOrEqual(4.5);
  });

  // Graphics, 3:1 (WCAG 1.4.11): window borders, the cursor, the rings.
  it.each([
    ["brass", "ink", "window borders and the cursor"],
    ["brass", "void", "the Orrery's rings on the field"],
  ])("makes --%s visible on --%s at 3:1 (%s)", (fg, bg) => {
    expect(contrast(token(fg), token(bg)), `--${fg} on --${bg} is ${ratio(fg, bg)}`).toBeGreaterThanOrEqual(3);
  });

  it("keeps the two text inks apart", () => {
    // On the same window the ratio between two inks IS the ratio between
    // their contrasts: 2:1 says window text carries at least twice the
    // contrast of quiet text. My line, not WCAG's; the palette sits near 2.2.
    expect(
      contrast(token("card"), token("card-quiet")),
      `--card against --card-quiet is ${ratio("card", "card-quiet")}: the two inks have collapsed into each other`,
    ).toBeGreaterThanOrEqual(2);
  });
});

// --card-quiet is text-safe on --ink and nowhere it hasn't been measured. Every
// rule that paints TEXT in it is listed here with the ground it sits on; a new
// rule fails until its ground is declared, and a stale entry fails too, so the
// map can't drift from the sheet in either direction. The grounds are measured,
// not assumed: headless Chrome walks every visible element whose computed
// colour is --card-quiet, in every stage state at 1920×1080 and 390×844, and
// finds the ground under each. Re-measure when a rule here moves.
// Measured 2026-10-14 in headless Chrome, join, join with the seat button
// disabled, and fight, at both viewports. "ink" is a window: base.css paints it
// as a gradient from 14% brass into --ink, and --card-quiet clears it at 5.55:1
// at its lightest. The cursor's option adds 15% brass, but only behind the
// blurb, mid-window. The lit strip card adds 16% at the window's top, which
// would be 4.37:1, so the lit card's name is --card instead (strip.css).
// "void" is the observatory itself: the bar above the stage, the join
// overlay, and the name field's well.
const QUIET = "card-quiet";
const QUIET_GROUNDS: Readonly<Record<string, string>> = {
  "#battle .window-title": "ink",
  "#battle .battle-link": "void",
  "#battle .strip-fallen::before": "ink",
  "#battle .strip-label": "ink",
  "#battle .strip-name": "ink",
  "#battle .strip-stamp[data-flag=held]": "ink",
  "#battle .command-blurb": "ink",
  "#battle .command-hint": "ink",
  "#battle .join-title-the": "void",
  "#battle .join-label": "ink",
  "#battle .join-greeting": "ink",
  "#battle .join-name::placeholder": "void",
  "#battle .join-blurb": "ink",
  "#battle .join-move": "ink",
  "#battle .join-submit:disabled": "ink",
  // Phase two: the doors are ink panels, and the table's seats sit in a window (ink).
  "#battle .join-door-line": "ink",
  "#battle .seats-room": "ink",
  "#battle .seats-seat[data-seated-echo=true] .seats-name": "ink",
  "#battle .seats-seat[data-echo=true] .seats-name": "ink",
  "#battle .seats-seat[data-out]": "ink",
  "#battle .seats-role": "ink",
  "#battle .seats-echo-title": "ink",
  "#battle .seats-none": "ink",
  "#battle .seats-said": "ink",
  "#battle .seats-add:disabled": "ink",
};

describe(`--${QUIET} on its grounds`, () => {
  const paintsQuietText = (rule: Rule): boolean =>
    rule.declarations.some((d) => d.property === "color" && new RegExp(`var\\(\\s*--${QUIET}\\s*\\)`).test(d.value));
  const quietSelectors = (): string[] => [...new Set(sheet.filter(paintsQuietText).flatMap((r) => r.selectors))];

  it("found the rules that paint text in it", () => {
    // A parser that silently matched nothing would pass everything below.
    expect(quietSelectors().length, `no rule in the served CSS uses --${QUIET} for text`).toBeGreaterThanOrEqual(3);
  });

  it("knows the ground of every one of them", () => {
    const unplaced = quietSelectors().filter((sel) => !(sel in QUIET_GROUNDS));
    expect(unplaced, `these paint text in --${QUIET} on a ground nobody has declared or measured`).toEqual([]);
  });

  it("lists no rule the stylesheet no longer has", () => {
    const live = new Set(quietSelectors());
    const stale = Object.keys(QUIET_GROUNDS).filter((sel) => !live.has(sel));
    expect(stale, `these no longer paint text in --${QUIET}; drop them from the map`).toEqual([]);
  });

  it("clears 4.5:1 on every ground it is painted on", () => {
    for (const ground of new Set(Object.values(QUIET_GROUNDS))) {
      expect(contrast(token(QUIET), token(ground)), `--${QUIET} on --${ground} is ${ratio(QUIET, ground)}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("never brings a ground of its own that isn't the one declared", () => {
    for (const rule of sheet.filter(paintsQuietText)) {
      const own = rule.declarations.find((d) => d.property === "background" || d.property === "background-color");
      if (!own) continue;
      for (const selector of rule.selectors) {
        expect(colour(own.value, sheet), `${selector} paints --${QUIET} text on its own background`).toBe(
          token(QUIET_GROUNDS[selector] ?? "ink"),
        );
      }
    }
  });
});

// Phase two's gate, the reviewer's U3: the inks phase two added are mixed with
// color-mix(), which the arithmetic above can't follow (one of them in oklch,
// the long way round the hue wheel). So headless Chrome resolves each where it
// is used, paints it on a canvas and reads the pixel back as sRGB, and the
// WCAG arithmetic is done on that. Text, 4.5:1: the shield and Resonance
// numbers on the field, and the room code on a window.
// The re-review's N6: a bare probe inherits --card when a token is undefined,
// so a missing token passed. Each ink is now read off the real element (an
// .fx-number of that tone in the scene, the seat list's .seats-code), each
// token must be defined where it's read, and the room code is measured on the
// window's lighter end (its 14% brass), not flat --ink.
describe("phase two's mixed inks, resolved by Chrome", () => {
  let seen: Record<string, string> = {};
  let defined: Record<string, boolean> = {};

  beforeAll(async () => {
    const { launchChrome } = await import("./browser.ts");
    const chrome = await launchChrome();
    try {
      const tab = await chrome.open(`${baseUrl}/`);
      await tab.until(`!!document.querySelector("#battle .scene") && !!document.querySelector("#battle [data-seats]")`, "the battle screen", 15_000);
      const got = await tab.evaluate<{ seen: Record<string, string>; defined: Record<string, boolean> }>(`(() => {
        const scene = document.querySelector("#battle .scene");
        const seats = document.querySelector("#battle [data-seats]");
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const g = canvas.getContext("2d", { willReadFrequently: true });
        const hex = (css) => {
          g.clearRect(0, 0, 1, 1);
          g.fillStyle = css;
          g.fillRect(0, 0, 1, 1);
          const [r, gr, b] = g.getImageData(0, 0, 1, 1).data;
          return "#" + [r, gr, b].map((n) => n.toString(16).padStart(2, "0")).join("");
        };
        const el = (parent, tag, cls, data) => {
          const node = document.createElement(tag);
          node.className = cls;
          Object.assign(node.dataset, data || {});
          node.textContent = "12";
          parent.append(node);
          return node;
        };
        const shield = el(scene, "span", "fx-number", { tone: "shield" });
        const gold = el(scene, "span", "fx-number", { tone: "resonance" });
        const code = el(seats, "span", "seats-code");
        const ground = el(scene, "span", "");
        const colour = (node) => hex(getComputedStyle(node).color);
        const of = (value) => { ground.style.color = value; return hex(getComputedStyle(ground).color); };
        const seen = {
          shield: colour(shield),
          gold: colour(gold),
          code: colour(code),
          void: of("var(--void)"),
          ink: of("var(--ink)"),
          window: of("color-mix(in srgb, var(--ink) 86%, var(--brass))"),
        };
        const at = (node, name) => getComputedStyle(node).getPropertyValue(name).trim() !== "";
        const defined = { "tone-shield": at(shield, "--tone-shield"), "tone-gold": at(gold, "--tone-gold"), "brass-lit": at(code, "--brass-lit") };
        for (const n of [shield, gold, code, ground]) n.remove();
        return { seen, defined };
      })()`);
      seen = got.seen;
      defined = got.defined;
    } finally {
      await chrome.close();
    }
  }, 30_000);

  it("finds each token defined where its ink is read", () => {
    expect(defined, "an undefined token inherits --card, which would pass").toEqual({ "tone-shield": true, "tone-gold": true, "brass-lit": true });
  });

  it.each([
    ["shield", "void", "a blow a Ward or Bastion took: a shield number on the field"],
    ["gold", "void", "a Resonance's number on the field"],
    ["code", "window", "the room code on the seat list, on the window's lighter end"],
    ["code", "ink", "the room code on the window's darker end"],
  ])("carries the %s ink on %s at 4.5:1 (%s)", (fg, bg) => {
    expect(seen[fg], `Chrome resolved the ${fg} ink`).toMatch(/^#[0-9a-f]{6}$/);
    const r = contrast(seen[fg], seen[bg]);
    expect(r, `${fg} (${seen[fg]}) on ${bg} (${seen[bg]}) is ${r.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});
