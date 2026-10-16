#!/bin/sh
# The reviewer's Bash allowlist (.claude/agents/reviewer.md). A PreToolUse hook:
# Claude Code passes the tool call as JSON on stdin, and exit 2 refuses it with
# stderr shown to the agent. Only two things are allowed: `git diff` (to read
# the change) and the test runner (`pnpm vitest run …`, `pnpm test`,
# `pnpm check`). Nothing else, and nothing chained onto them, so the reviewer
# can read and run the roster but can't edit, commit, push or reach out.

cmd=$(jq -r '.tool_input.command // ""')

# One command, no chaining, piping, redirection or substitution. (A newline is
# tested separately: "$(printf '\n')" would be empty, and *""* matches all.)
nl='
'
case "$cmd" in
  *';'* | *'&'* | *'|'* | *'>'* | *'<'* | *'`'* | *'$('* | *"$nl"*)
    echo "reviewer: one command at a time; no chaining, pipes, redirects or substitution." >&2
    exit 2 ;;
esac

# Both allowed commands can be told to write a file: `git diff --output=<f>`
# and the runner's `--outputFile`, `--reporter=… --outputFile`, `-u`/
# `--update` (snapshots). Refuse any argument that writes.
case "$cmd" in
  *--output* | *-o\ * | *--update* | *" -u"* | *--outputFile* | *--coverage* | *--ext-diff*)
    echo "reviewer: no argument that writes a file (--output, --outputFile, --update, --coverage, --ext-diff)." >&2
    exit 2 ;;
esac

case "$cmd" in
  "git diff" | "git diff "*) exit 0 ;;
  "pnpm test" | "pnpm check" | "pnpm vitest run" | "pnpm vitest run "*) exit 0 ;;
esac

echo "reviewer: only \`git diff …\` and the test runner (pnpm vitest run …, pnpm test, pnpm check) are allowed; refused: $cmd" >&2
exit 2
