import { resolve } from "node:path";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

// Inside #battle the game's rules apply and two web gates are lifted by name,
// radius and glow (CLAUDE.md, "Design: the battle screen"); outside it they
// stand. A lift is a scope, and a scope nobody checks will grow, so these run
// the project's real stylelint config against small sheets that sit just
// inside and just outside it.
const configFile = resolve(".stylelintrc.json");
const plugin = resolve("stylelint-plugins/design-gates.js");
const RADIUS = "design-gates/no-soft-corners";
const GLOW = "design-gates/no-blurred-shadow";

async function complaints(code: string, config?: stylelint.Config) {
  const { results } = await stylelint.lint(config ? { code, config } : { code, configFile });
  const [result] = results;
  return {
    radius: result.warnings.filter((w) => w.rule === RADIUS).length,
    glow: result.warnings.filter((w) => w.rule === GLOW).length,
    invalid: result.invalidOptionWarnings.length,
  };
}

describe("radius and glow: lifted inside #battle, standing outside it", () => {
  it("lets the battle stage be soft and glowing", async () => {
    expect((await complaints("#battle .window { border-radius: 6px; }\n")).radius).toBe(0);
    expect((await complaints("#battle { border-radius: 8px; }\n")).radius).toBe(0);
    expect((await complaints("#battle .core { box-shadow: 0 0 16px #b58a3a; }\n")).glow).toBe(0);
  });

  it("follows CSS nesting up to #battle", async () => {
    const nested = "#battle {\n  .window {\n    border-radius: 6px;\n    box-shadow: 0 0 8px #000;\n\n    &:focus-visible {\n      border-radius: 6px;\n    }\n  }\n}\n";
    const outcome = await complaints(nested);
    expect(outcome.radius, "a nested rule inside #battle is inside #battle").toBe(0);
    expect(outcome.glow).toBe(0);
  });

  it("keeps every gate standing outside #battle", async () => {
    expect((await complaints(".readme pre { border-radius: 4px; }\n")).radius, "the readme page").toBe(1);
    expect((await complaints(".site-header a { box-shadow: 0 0 6px #000; }\n")).glow, "the site header").toBe(1);
    expect((await complaints("button { border-radius: 3px; }\n")).radius).toBe(1);
  });

  it("matches #battle itself, not a name that starts with it", async () => {
    expect((await complaints("#battlefield .window { border-radius: 6px; }\n")).radius).toBe(1);
    expect((await complaints("#battle-log { box-shadow: 0 0 6px #000; }\n")).glow).toBe(1);
  });

  it("doesn't let a lifted selector carry an unlifted one in with it", async () => {
    expect((await complaints("#battle .window, .readme pre { border-radius: 6px; }\n")).radius).toBe(1);
  });

  it("refuses a lift that doesn't say why, and keeps the gate while it does", async () => {
    const unexplained: stylelint.Config = {
      plugins: [plugin],
      rules: {
        [RADIUS]: [true, { allowSelectors: ["^#battle(?![\\w-])"] }],
        [GLOW]: [true, { allowSelectors: ["^#battle(?![\\w-])"] }],
      },
    };
    const outcome = await complaints("#battle .w { border-radius: 6px; box-shadow: 0 0 6px #000; }\n", unexplained);
    expect(outcome.invalid, "an allow-list with no `lifted` reason is a config error").toBeGreaterThan(0);
    expect(outcome.radius, "and nothing is lifted").toBe(1);
    expect(outcome.glow).toBe(1);
  });
});
