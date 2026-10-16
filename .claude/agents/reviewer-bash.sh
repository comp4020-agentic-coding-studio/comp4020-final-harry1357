#!/bin/sh
# The reviewer's Bash allowlist (.claude/agents/reviewer.md). A PreToolUse hook:
# Claude Code passes the tool call as JSON on stdin, and exit 2 refuses it with
# stderr shown to the agent. Only two things are allowed: `git diff` (to read
# the change) and the test runner. Nothing else, and nothing chained onto them,
# so the reviewer can read and run the roster but can't edit, commit, push or
# reach out.
#
# Every argument is checked against an ALLOWLIST, not a list of bad ones: a
# blocklist of write flags leaked twice (--output, then --config, which makes
# Vite run any script, and --clearCache; review F10). What isn't named here is
# refused.

cmd=$(jq -r '.tool_input.command // ""')
refuse() { echo "reviewer: $1; refused: $cmd" >&2; exit 2; }

# One command, no chaining, piping, redirection, substitution or globbing
# metacharacters. (A newline is tested separately: "$(printf '\n')" is empty.)
nl='
'
case "$cmd" in
  *';'* | *'&'* | *'|'* | *'>'* | *'<'* | *'`'* | *'$'* | *'*'* | *'?'* | *"$nl"*)
    refuse "one command at a time; no chaining, pipes, redirects, substitution or globs" ;;
esac

# shellcheck disable=SC2086
set -- $cmd

# A ref, a range of refs, or a path: letters, digits and . _ / - ~ ^ @ :, never
# starting with a dash. (`git diff main...HEAD -- spec/economy.test.ts`.)
plain() {
  case "$1" in -* | '') return 1 ;; esac
  case "$1" in *[!A-Za-z0-9._/~^@:-]*) return 1 ;; esac
  return 0
}

if [ "$1" = git ] && [ "$2" = diff ]; then
  shift 2
  for a in "$@"; do
    case "$a" in
      --stat | --numstat | --shortstat | --name-only | --name-status | --no-color | --color | \
        --word-diff | -w | --ignore-all-space | -U0 | -U1 | -U3 | -U5 | -U10 | --find-renames | -M | --) ;;
      *) plain "$a" || refuse "git diff takes only refs, paths and read-only flags (--stat, --name-only, -U<n>, -w, --)" ;;
    esac
  done
  exit 0
fi

if [ "$1" = pnpm ]; then
  case "$2" in
    test | check) [ $# -eq 2 ] && exit 0; refuse "pnpm test and pnpm check take no arguments" ;;
    vitest) [ "$3" = run ] || refuse "only pnpm vitest run"; shift 3 ;;
    *) refuse "only pnpm vitest run, pnpm test and pnpm check" ;;
  esac
  # `pnpm vitest run [spec/<file>.test.ts …] [-t <word>]`: spec files and a
  # test-name filter, nothing else.
  while [ $# -gt 0 ]; do
    case "$1" in
      spec/*.test.ts) plain "$1" || refuse "a spec path with odd characters" ;;
      -t)
        [ $# -ge 2 ] || refuse "-t needs a pattern"
        shift
        case "$1" in -*) refuse "-t's pattern can't be a flag" ;; esac ;;
      *) refuse "pnpm vitest run takes only spec/<file>.test.ts paths and -t <pattern>" ;;
    esac
    shift
  done
  exit 0
fi

refuse "only \`git diff …\` and the test runner (pnpm vitest run …, pnpm test, pnpm check) are allowed"
