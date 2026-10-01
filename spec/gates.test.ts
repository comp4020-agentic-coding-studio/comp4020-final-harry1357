import { resolve } from "node:path";
import stylelint from "stylelint";
import { describe, expect, it } from "vitest";

// The radius ban is lifted for token discs by name (CLAUDE.md, "Design: final
// project") and stays in force everywhere else. A lift is a scope, and a scope
// nobody checks will grow, so these run the project's real stylelint config
// against small sheets that sit just inside and just outside it.
const configFile = resolve(".stylelintrc.json");
const plugin = resolve("stylelint-plugins/design-gates.js");
const RULE = "design-gates/no-soft-corners";

async function radiusComplaints(code: string, config?: stylelint.Config) {
  const { results } = await stylelint.lint(config ? { code, config } : { code, configFile });
  const [result] = results;
  return {
    rejected: result.warnings.filter((w) => w.rule === RULE).length,
    invalid: result.invalidOptionWarnings.length,
  };
}

describe("the radius ban, lifted for tokens and nowhere else", () => {
  it("lets a token disc be round", async () => {
    expect((await radiusComplaints(".token-disc { border-radius: 50%; }\n")).rejected).toBe(0);
    expect(
      (await radiusComplaints('.token[data-active="true"] .token-disc::after { border-radius: 50%; }\n')).rejected,
    ).toBe(0);
  });

  it("keeps every other corner square", async () => {
    expect((await radiusComplaints(".tag { border-radius: 4px; }\n")).rejected, "a name tag is a card").toBe(1);
    expect((await radiusComplaints(".token { border-radius: 50%; }\n")).rejected, "the token box holds the tag").toBe(
      1,
    );
    expect((await radiusComplaints("button { border-radius: 3px; }\n")).rejected).toBe(1);
  });

  it("doesn't let a lifted selector carry an unlifted one in with it", async () => {
    expect((await radiusComplaints(".token-disc, .seat button { border-radius: 50%; }\n")).rejected).toBe(1);
  });

  it("refuses a lift that doesn't say why, and keeps the ban while it does", async () => {
    const unexplained: stylelint.Config = {
      plugins: [plugin],
      rules: { [RULE]: [true, { allowSelectors: ["^\\.token-disc$"] }] },
    };
    const outcome = await radiusComplaints(".token-disc { border-radius: 50%; }\n", unexplained);
    expect(outcome.invalid, "an allow-list with no `lifted` reason is a config error").toBeGreaterThan(0);
    expect(outcome.rejected, "and nothing is lifted").toBe(1);
  });
});
