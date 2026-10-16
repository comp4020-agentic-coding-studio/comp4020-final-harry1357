# ADR-004: Model and parallelism

- **Status:** accepted. Amended 2026-10-17: the three-agent cap is lifted,
  because the review gate (CLAUDE.md, "How to work in here") now catches what
  the cap was guarding against. The meter is still read before any pass with
  more than three agents, and a big pass still starts on reset day.
- **Date:** 2026-10-05
- **Rule:** the budget rule in CLAUDE.md, under "What the app must never do".

## Context

The battle screen was built the way v1 was. A scaffold commit fixes the shared
files and the contract, then one subagent per area builds in parallel
(`8432016`, on the `battle-screen` branch). v1 took four agents. The battle
screen took seven, all on Opus, all on the course key.

The course key has a weekly budget. The seven agents exhausted it mid-file.
One area had landed (`52c8748`, the events). The other six stopped wherever
they were and were lost; what they left is frozen on the branch as `5f8b144`.

Nothing in the harness looked at the budget before the pass launched. The
course proxy reports it at `/api/me`: what's spent this week, what's left and
when it resets. `/comp4020:balance` reads the same endpoint. The number was
there, and the pass started without reading it.

## Options considered

1. **Ban Opus for subagents.** Subagents run on a cheaper model and the same
   budget goes further. But the budget wasn't lost to the model. It was lost
   to starting a pass without knowing what was left, and a large enough pass
   on any model does the same. A ban would also give up the quality that is
   the reason for using Opus on this kind of build.
2. **Cap parallelism.** No more than three agents at once. That bounds how
   many areas can be mid-file when the budget runs out. It doesn't bound what
   the pass costs: seven areas built three at a time spend the same budget as
   seven at once, only later. It also gives up the parallel build, which is
   the point of fixing the shared files in a scaffold first.
3. **Keep both and schedule around the weekly reset (chosen).** The model and
   the fan-out stay. What changes is that a big pass reads the meter before
   it starts, and when it is allowed to start.

## Decision

Option 3. Opus stays for subagents, and parallel passes stay. Two things are
added, and together they are the rule in CLAUDE.md:

- **Read the meter first.** Before any pass with more than three parallel
  agents, the weekly budget is read at `/api/me`.
- **Big passes start on reset day.** A pass expected to cost more than half of
  what remains starts on the day the allocation resets, not before.

The budget is a sensor like the others: a number read before the work starts,
not one found out when the work stops.

## Cost

- **A lost day when the estimate is wrong.** What a pass will cost is a guess
  made before it runs. Guess high, and a pass that would have fit waits for
  the reset. Guess low, and it runs dry anyway and then waits for the reset.
- **Nothing enforces it.** No test can see a launch, so the rule is judged,
  not checked. It holds only while it's read.
- **The battle screen waits.** It is week 10's build, on the fresh allocation.
  The six unfinished areas stay on the branch until then.
