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
// rail design's (CLAUDE.md, "Design: final project --- the rail"), each one
// against the ground that ink is really painted on, not against the page.
// When the palette changes, these pairs change with it, deliberately.

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

describe("the rail's palette, checked as arithmetic", () => {
  it("does the WCAG arithmetic correctly", () => {
    // The probe that proves this can fail. Known answers: black on white is
    // 21:1 either way round, #767676 is the canonical "just passes AA" grey on
    // white, and #777777 just doesn't. A rounding slip here would quietly pass
    // every pair below.
    expect(contrast("#000000", "#ffffff")).toBeCloseTo(21, 2);
    expect(contrast("#ffffff", "#000000")).toBeCloseTo(21, 2);
    expect(contrast("#767676", "#ffffff")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#777777", "#ffffff")).toBeLessThan(4.5);
    expect(contrast("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("found CSS served by / to read", () => {
    // A green run over zero bytes of CSS looks exactly like a clean one.
    expect(served.length, "/ serves no CSS (no <style>, no linked stylesheet)").toBeGreaterThan(100);
    expect(sheet.length, "the served CSS parsed to no rules at all").toBeGreaterThan(0);
  });

  it("carries body text (--ink) at 4.5:1 on --card", () => {
    // Every paragraph, the log and the form labels: the design puts all body
    // text on a card panel, so the card is this ink's ground.
    expect(contrast(token("ink"), token("card")), `--ink on --card is ${ratio("ink", "card")}`).toBeGreaterThanOrEqual(4.5);
  });

  it("carries quiet text (--ink-quiet) at 4.5:1 on --card", () => {
    // Quiet is not decoration: the labels and the log's tick column are
    // written in it, so it answers to the body-text floor, not a looser one.
    expect(
      contrast(token("ink-quiet"), token("card")),
      `--ink-quiet on --card is ${ratio("ink-quiet", "card")}`,
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("carries harm (--ember) at 4.5:1 on --card", () => {
    // Damage lines and the Orrery's turn are text, and they sit on cards.
    expect(contrast(token("ember"), token("card")), `--ember on --card is ${ratio("ember", "card")}`).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it("carries the token tags (--card) at 4.5:1 on --felt", () => {
    // The one place text sits on the table rather than on a panel: the names
    // under the tokens on the rail. The felt is their ground.
    expect(contrast(token("card"), token("felt")), `--card on --felt is ${ratio("card", "felt")}`).toBeGreaterThanOrEqual(4.5);
  });

  it("makes the rail (--brass) visible at 3:1 on --felt", () => {
    // The rail, its notches and the strike plate are a graphic, not text, so
    // WCAG 1.4.11's 3:1 is the floor. It is the signature element: if it
    // fades into the table, the queue does too.
    expect(contrast(token("brass"), token("felt")), `--brass on --felt is ${ratio("brass", "felt")}`).toBeGreaterThanOrEqual(3);
  });

  it("keeps the two inks apart", () => {
    // Assert the gap, not only each floor: --ink and --ink-quiet can both
    // clear 4.5:1 on the card and still have collapsed into one colour,
    // losing the text/label distinction the design depends on. The 4.5:1
    // floor above stops --ink-quiet drifting toward the card; this stops it
    // drifting toward --ink.
    //
    // There is no WCAG figure for "two tiers of text" (3:1 is for telling a
    // link from its paragraph by colour alone, which isn't the claim: quiet
    // text also differs in size and place). 2:1 is my line, and it reads
    // plainly: on the same card, the ratio between two inks IS the ratio
    // between their contrasts, so this says body text carries at least twice
    // the contrast of quiet text. The palette as designed sits at about 2.4.
    expect(
      contrast(token("ink"), token("ink-quiet")),
      `--ink against --ink-quiet is ${ratio("ink", "ink-quiet")}: the two inks have collapsed into each other`,
    ).toBeGreaterThanOrEqual(2);
  });
});

// --ink-quiet is text-safe on --card (about 6.25:1) and nowhere else: on --felt
// it is about 2:1, and on the --ink of your own tag it barely registers. So
// every rule that paints TEXT in it is listed here with the ground it sits on.
// A new rule that uses it for text fails until someone decides its ground,
// and an entry whose rule is gone fails too, so the map can't drift from the
// sheet in either direction. The grounds were measured, not assumed: on
// 2026-10-01, headless Chrome walked every visible element whose computed
// colour is --ink-quiet (readme, an empty battle, spectating, joined, your
// turn; 1920×1080 and 390×844) and found each one on --card. Re-measure when
// a rule here moves to a new part of the page.
const QUIET_GROUNDS: Readonly<Record<string, string>> = {
  ".brand-line": "card", // the header band
  ".link-state": "card", // the header band
  ".tag-unit": "card", // inside a name tag; your own tag overrides it to --card on --ink
  ".record dt": "card", // the seat panel
  ".field-label": "card", // the seat panel
  ".seat-who": "card", // the seat panel
  ".button:disabled": "card", // the join button while a join is in flight
  ".action-button:disabled": "card", // your actions while it isn't your turn
  ".log-empty": "card", // the log panel
  ".log-tick": "card", // the log panel
};

describe("--ink-quiet on its grounds", () => {
  const paintsQuietText = (rule: Rule): boolean =>
    rule.declarations.some((d) => d.property === "color" && /var\(\s*--ink-quiet\s*\)/.test(d.value));
  const quietSelectors = (): string[] => [...new Set(sheet.filter(paintsQuietText).flatMap((r) => r.selectors))];

  it("found the rules that paint text in --ink-quiet", () => {
    // A parser that silently matched nothing would pass everything below.
    expect(quietSelectors().length, "no rule in the served CSS uses --ink-quiet for text").toBeGreaterThanOrEqual(5);
  });

  it("knows the ground of every one of them", () => {
    const unplaced = quietSelectors().filter((s) => !(s in QUIET_GROUNDS));
    expect(unplaced, "these paint text in --ink-quiet on a ground nobody has declared or measured").toEqual([]);
  });

  it("lists no rule the stylesheet no longer has", () => {
    const live = new Set(quietSelectors());
    const stale = Object.keys(QUIET_GROUNDS).filter((s) => !live.has(s));
    expect(stale, "these no longer paint text in --ink-quiet; drop them from the map").toEqual([]);
  });

  it("clears 4.5:1 on every ground it is painted on", () => {
    for (const ground of new Set(Object.values(QUIET_GROUNDS))) {
      expect(
        contrast(token("ink-quiet"), token(ground)),
        `--ink-quiet on --${ground} is ${ratio("ink-quiet", ground)}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("never brings a ground of its own that isn't the one declared", () => {
    for (const rule of sheet.filter(paintsQuietText)) {
      const own = rule.declarations.find((d) => d.property === "background" || d.property === "background-color");
      if (!own) continue;
      for (const selector of rule.selectors) {
        expect(colour(own.value, sheet), `${selector} paints --ink-quiet text on its own background`).toBe(
          token(QUIET_GROUNDS[selector] ?? "card"),
        );
      }
    }
  });
});
