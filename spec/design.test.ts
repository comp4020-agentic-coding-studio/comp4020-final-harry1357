import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, inject, it } from "vitest";
import { colour, declarationsOf, parseCss, type Rule, rootToken, servedCss, splitList, unconditional } from "./served-css.ts";

// The mechanical half of "the look is a decision, not a default".
//
// It can't tell whether the look is any good; that is the crit's call, and
// the design gates in CLAUDE.md are written for a person to hold me to. What
// it CAN tell is whether what the app serves is the design CLAUDE.md
// declares, and whether the browser's defaults are still showing through.
//
// Crit 7's version read the starter's theme out of git and failed if the
// served face or accent still matched it. This template's starter shipped no
// stylesheet at all: the placeholder rendered in browser defaults. So the
// "starter" here is the user agent (Times, #0000ee links), and instead of
// comparing against git history the palette is compared against CLAUDE.md
// itself, parsed at test time. Change a hex in one place and not the other
// and this goes red, so the harness and the stylesheet can't drift apart
// silently.

const baseUrl = inject("baseUrl");

interface PaletteRow {
  token: string;
  hex: string;
  role: string;
}

/** The palette table in CLAUDE.md's `## Design: …` block. Only that block:
 *  the carry-forward gates above it talk about palettes in prose, and a
 *  table anywhere else isn't the design. */
function paletteFromHarness(): PaletteRow[] {
  const md = readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8");
  const start = md.search(/^## Design: /m);
  if (start === -1) return [];
  const rest = md.slice(start);
  const end = rest.slice(1).search(/^## /m);
  const block = end === -1 ? rest : rest.slice(0, end + 1);
  return [...block.matchAll(/^\|\s*`(--[\w-]+)`\s*\|\s*`(#[0-9a-fA-F]{3,8})`\s*\|\s*([^|\n]*)\|/gm)].map((m) => ({
    token: m[1],
    hex: m[2],
    role: m[3].trim(),
  }));
}

const palette = paletteFromHarness();

const GENERIC = new Set([
  "serif",
  "sans-serif",
  "monospace",
  "cursive",
  "fantasy",
  "system-ui",
  "ui-serif",
  "ui-sans-serif",
  "ui-monospace",
  "ui-rounded",
  "math",
  "emoji",
  "fangsong",
]);
const SYSTEM_UI = new Set(["system-ui", "-apple-system", "blinkmacsystemfont"]);
const TIMES = new Set(["times", "times new roman", "tinos", "liberation serif"]);

const families = (value: string): string[] =>
  splitList(value).map((face) => face.replace(/^["']|["']$/g, "").trim().toLowerCase());

/** The link colours the browser paints when nothing else does: unvisited
 *  blue and visited purple, plus the keywords that mean the same thing. */
const UA_LINK = new Set(["#0000ee", "#551a8b", "linktext", "visitedtext", "-webkit-link"]);

/** Does this selector's subject (its last compound) match links? `a`,
 *  `.readme a:visited`, `nav > a.x`, `:any-link`, `:link`. */
function targetsLinks(selector: string): boolean {
  const subject = selector.split(/\s*[\s>+~]\s*(?![^(]*\))/).at(-1) ?? "";
  return /^a(?![\w-])/i.test(subject) || /^:(any-link|link|visited)\b/i.test(subject);
}

/** The resting state, not a hover or focus restyle: an `a:hover` colour
 *  leaves every link that isn't under the pointer in the UA's blue. */
const atRest = (selector: string): boolean => !/:(hover|focus|focus-visible|focus-within|active)\b/i.test(selector);

let served = "";
let sheet: Rule[] = [];

beforeAll(async () => {
  served = await servedCss(baseUrl, ["/"]);
  sheet = parseCss(served);
});

describe("the look is a decision, not the browser's default", () => {
  it("(a) found real CSS served by / to read", () => {
    // A green run over zero bytes of CSS looks exactly like a clean one, and
    // every check below would pass vacuously against an empty sheet.
    expect(served.length, "/ serves no CSS (no <style>, no linked stylesheet)").toBeGreaterThan(100);
    expect(sheet.length, "the served CSS parsed to no style rules").toBeGreaterThan(0);
  });

  it("(b) parsed the palette table out of CLAUDE.md", () => {
    // If the table moved or its format changed, the per-token checks below
    // would quietly become zero checks.
    expect(palette.length, "found fewer than 4 `| `--token` | `#hex` | role |` rows in CLAUDE.md's Design block").toBeGreaterThanOrEqual(4);
  });

  it.each(palette)("(b) serves $token as $hex ($role)", ({ token, hex }) => {
    const want = colour(hex, []);
    const atRoot = rootToken(sheet, token);
    expect(atRoot, `CLAUDE.md declares ${token} but :root in the served CSS never sets it`).toBeTruthy();
    expect(colour(atRoot as string, sheet), `${token} at :root`).toBe(want);
    // And nowhere else says otherwise: an override in a media query or a
    // component is the stylesheet drifting from the design one rule at a time.
    for (const { value, rule } of declarationsOf(sheet, token)) {
      expect(colour(value, sheet), `${token} is redeclared in \`${rule.context} ${rule.selector}\``.trim()).toBe(want);
    }
  });

  it("(c) declares a display face that is a choice, not a fallback", () => {
    const value = rootToken(sheet, "font-display");
    expect(value, "no --font-display at :root in the served CSS").toBeTruthy();
    const faces = families(value as string);
    expect(faces.length, "--font-display is empty").toBeGreaterThan(0);
    expect(
      faces.filter((face) => SYSTEM_UI.has(face)),
      `--font-display (${value}) uses the system UI face; the design gates say never system-ui`,
    ).toEqual([]);
    expect(
      GENERIC.has(faces[0]),
      `--font-display (${value}) leads with the generic \`${faces[0]}\`, so it is whatever the browser picks`,
    ).toBe(false);
    expect(
      faces.filter((face) => TIMES.has(face)),
      `--font-display (${value}) names Times, the browser default the design replaces`,
    ).toEqual([]);
    // A face nothing uses is a face nobody sees: the display text would
    // still be in Times.
    const uses = sheet.filter((rule) =>
      rule.declarations.some((d) => (d.property === "font-family" || d.property === "font") && /var\(\s*--font-display\b/.test(d.value)),
    );
    expect(uses.length, "nothing in the served CSS sets font-family to var(--font-display)").toBeGreaterThan(0);
  });

  // (d) runs on both pages people read: the raid and the README, which is
  // nearly all links and the easiest place for the UA blue to survive.
  describe.each(["/", "/readme/"])("(d) links on %s", (route) => {
    let rules: Rule[] = [];
    beforeAll(async () => {
      rules = parseCss(await servedCss(baseUrl, [route]));
    });

    it("are coloured by the stylesheet, at rest and unconditionally", () => {
      // No author colour on `a` means the browser's #0000ee. A hover colour,
      // or one inside a media query, leaves the resting link blue.
      const resting = rules.filter(
        (rule) =>
          unconditional(rule) &&
          rule.selectors.some((s) => targetsLinks(s) && atRest(s)) &&
          rule.declarations.some((d) => d.property === "color"),
      );
      expect(resting.length, `nothing ${route} serves sets a colour on links, so they render in the UA's #0000ee`).toBeGreaterThan(0);
    });

    it("are never the UA's default blue or visited purple", () => {
      for (const rule of rules.filter((r) => r.selectors.some(targetsLinks))) {
        for (const d of rule.declarations.filter((x) => x.property === "color")) {
          const painted = colour(d.value, rules);
          expect(UA_LINK.has(painted), `\`${rule.selector} { color: ${d.value} }\` paints ${painted}, the browser default`).toBe(false);
        }
      }
    });
  });
});
