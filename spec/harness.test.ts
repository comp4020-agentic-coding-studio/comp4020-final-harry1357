import { spawnSync } from "node:child_process";
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

describe("the reviewer can run the roster on HEAD, and nothing else", () => {
  // The lobby gate (the owner's ruling): a gate whose reviewer can't run the roster on HEAD hasn't reviewed
  // HEAD. Its Bash hook refused "APP_URL=http://localhost:8090 pnpm check", so the run fell back to :8080, which
  // ran other code. The hook is held here as Claude Code calls it: the tool call as JSON on stdin, exit 0 to
  // allow and 2 to refuse.
  const hook = (command: string): number =>
    spawnSync("sh", [".claude/agents/reviewer-bash.sh"], { input: JSON.stringify({ tool_input: { command } }) }).status ?? -1;

  it("lets the reviewer point the roster at a local instance on the port it was told", () => {
    for (const command of [
      "APP_URL=http://localhost:8090 pnpm check",
      "APP_URL=http://127.0.0.1:8091 pnpm test",
      "APP_URL=http://localhost:8090 pnpm vitest run spec/lobby.test.ts -t B4",
      "pnpm check",
      "git diff b53ddcf...HEAD --stat",
    ]) {
      expect(hook(command), `allowed: ${command}`).toBe(0);
    }
  });

  it("refuses any other host, anything but the test runner after it, and anything chained", () => {
    for (const command of [
      "APP_URL=https://comp4020-final-harry1357.fly.dev pnpm check",
      "APP_URL=http://evil.example:8090 pnpm check",
      "APP_URL=http://localhost:8090@evil.example:1 pnpm check",
      "APP_URL=http://localhost.evil.example:80 pnpm check",
      "APP_URL=http://localhost:8090/x pnpm check",
      "APP_URL=http://localhost:80a pnpm check",
      "APP_URL=http://localhost:8090 git diff main",
      "APP_URL=http://localhost:8090 node -e 1",
      "APP_URL=http://localhost:8090 APP_URL=http://localhost:1 pnpm check",
      "APP_URL=http://localhost:8090 pnpm check; rm -rf .",
      "FOO=1 pnpm check",
      "pnpm check --config x",
    ]) {
      expect(hook(command), `refused: ${command}`).toBe(2);
    }
  });
});
