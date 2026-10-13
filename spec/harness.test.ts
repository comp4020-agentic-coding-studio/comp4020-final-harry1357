import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// The harness guards itself.
//
// The design gates in CLAUDE.md are marked "never trimmed", and that didn't
// save them: the final-project template arrived with an empty CLAUDE.md and
// the whole section was gone before a line of the app existed (restored in
// 11119c8). A rule that says "don't remove this" is text, and it leaves with
// the section it was written in. So the two sections everything else in here
// leans on are held by the build instead: delete or rename either heading and
// `pnpm check` goes red.
//
// This is the only spec whose subject is the harness rather than the app. It
// needs nothing from the running server. It checks that the sections are
// there, not that they're any good; that part is still judged.

/** ATX headings (`## Like this`) outside fenced code, so a heading quoted in
 *  an example can't stand in for the real one. */
function headings(md: string): string[] {
  const found: string[] = [];
  let fenced = false;
  for (const line of md.split(/\r?\n/)) {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    const heading = !fenced && line.match(/^ {0,3}#{1,6}\s+(.*?)(\s+#+)?\s*$/);
    if (heading) found.push(heading[1]);
  }
  return found;
}

const harness = headings(readFileSync(new URL("../CLAUDE.md", import.meta.url), "utf8"));

describe("the harness guards itself", () => {
  it("still has its design gates", () => {
    expect(
      harness.some((heading) => heading.startsWith("Design gates")),
      'CLAUDE.md has no "Design gates" heading: the section is carried forward whole, never trimmed',
    ).toBe(true);
  });

  it("still says what the app must never do", () => {
    expect(
      harness.some((heading) => heading.startsWith("What the app must never do")),
      'CLAUDE.md has no "What the app must never do" heading: the specs hold claims that are written there',
    ).toBe(true);
  });
});
