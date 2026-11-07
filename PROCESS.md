# Process overview

## What I built

The Rail is a multiplayer JRPG raid in a browser. People sit down at a table, pick one of five roles, and fight the Orrery, a clockwork boss whose every attack is announced on a shared turn strip before it lands. Turns run on a counter, not a clock; the server holds every rule and the client decides nothing. A private room has a lobby, a code and a host's Start; the public raid never closes; a solo visitor can seat Echoes, server-played bots marked as such everywhere. Live at `comp4020-final-harry1357.fly.dev`, with the README at `/readme/`.

## The stack, and why

One Node process, Hono for HTTP and the WebSocket, the game loop and every counter in memory on a 150 ms tick, SQLite on the one Fly volume. The case is in ADR-001 ([`556051b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/556051b)): turn order needs exactly one authority and one clock, and one process gives both with no locking and no consensus. The cost is that a restart ends live fights, and the app says so (a fight marked live at boot is closed as abandoned, with a line saying why). The alternatives were a database-backed queue, which would have made the strip's order a race, and a framework with its own build step between the server and the image Fly runs. Node runs the server's TypeScript directly; only the client is bundled. Every decision since, with its cost, is in `docs/adr/`.

## The workflow

Every behaviour starts as a test committed red, before the code that turns it green ([`3be90be`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/3be90be) is the first: six tests red against no server). Agents build in parallel with one file each; I integrate. Before a phase merges it passes a review gate ([`0e5c564`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/0e5c564)): a reviewer reads the diff against every rule and ADR, a breaker attacks a scratch instance through the API, the socket and Chrome, and neither can approve. Each finding is fixed red-first in a commit that names it, carried as a red test, or closed by a written ruling, and the reports are kept in `docs/review/`.

## The moments that mattered

### Seven agents and no budget

I launched seven parallel agents on the battle screen on the day the weekly budget was lowest, and the key ran dry mid-pass with five areas half-edited ([`5f8b144`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/5f8b144) is the WIP I saved). The fix wasn't a retry on a fresh week but a rule: the budget is a sensor, read before any pass of more than three agents, and big passes start on reset day ([`a397d83`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/a397d83), ADR-004). The screen shipped a week later ([`ae746c7`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ae746c7)).

### What a green roster hid

The first gate found a Lunge killing one stack earlier than the design record said ([`fccab70`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/fccab70) red, [`1e884ee`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/1e884ee)), a fight anyone could mint with one unauthenticated request ([`810650b`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/810650b)), a finished private fight handing out its room's code ([`361dc82`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/361dc82)), and the reviewer itself able to write files through a `--config` flag ([`58a134e`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/58a134e)). About twenty tests passed with the feature broken. Each was strengthened and then proven by breaking the code on purpose and watching it go red; one of my own fixes passed its mutation and was rewritten. The roster had been green on all of it.

### The harness catching me

Three times the record held me to the same standard it held the agent. I set a pacing target of "a solo player sees all three phases before an ending" and got a long, easy boss, because nothing measured whether a table that ignored the mechanics lost. I wrote into a rule that the enrage clock sits "past the target so no fight that ends on its own meets it", and the reviewer found a measured room that contradicted it and no test that could go red; the clause was reworded to what the test holds ([`803c478`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/803c478), [`9882a97`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/9882a97)). And a red-spec commit had quietly dropped a wipe-timing bound so a count would pass ([`f15b4fe`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/f15b4fe)); the second confirm pass caught it by reading the diff, and the bound went back tighter ([`bd6a2f9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/bd6a2f9)).

### Knowing when to stop

The phase-two gate started hunting Unicode look-alikes for the reserved Echo names, each pass finding a subtler case. The property that mattered was elsewhere: every log line carries `echo=true` or `false`, so no look-alike can write an Echo's line. I ruled the name check a courtesy, recorded the remaining cases as risks, and wrote a stopping rule into CLAUDE.md: a gate closes when every finding is fixed, carried red, or closed by ruling, and the last pass finds no rule or ADR violation ([`b53ddcf`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b53ddcf) closes that gate under it). A harness that can't stop isn't verification.

### What is tested is what ships, except when it wasn't

The first push of the merged overhaul went red in CI on page specs that boot their own server ([`1254f5c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/1254f5c)). They had been passing locally against a stale `dist/` left by earlier builds; CI had no leftovers. The build moved inside `pnpm check` so local and CI can't disagree about what a green roster requires ([`5a5a57c`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/5a5a57c)). In the same week the agent refused my instruction to rebase, because a literal rebase would have rewritten every SHA the review documents cite; it merged instead ([`f5611a9`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/f5611a9)), and it was right.

### Difficulty as a measured property

A whole-repository read by a fresh agent found four mechanics the rules promised and the code lacked, and a headless playtest found a player pressing only Brace still won ([`d0c6db3`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/d0c6db3)). ADR-011 made difficulty a number: naive, competent and expert policies over thirty scripted rooms, with targets a deterministic engine test holds (naive wipes before phase III in at least 25 of 30, expert wins at least 25, a solo Brace-only player with four Echoes wipes, a solo expert wins). Charge now spends, every role has a Reaction, rings can be chosen, and Echoes answer no mechanic that needs reading the strip. It merged after its gate closed ([`d094258`](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/d094258)), with the gate in `docs/review/difficulty.md`.

## The definition of good

The README argues that good here is co-presence you can read: the strip is the play surface, everyone sees the same fight, nothing happens unannounced. What could be enforced is in `spec/` (the queue is the truth, a seat acts only for itself, every card announced before it lands, the pace band, the difficulty targets). What can only be judged is named as judged: whether the strip reads at a glance, whether a phase change feels like a moment. Rule 3 is what I left out on purpose: no accounts, profiles or feeds, because a name and a cookie are all the game needs.

## Where to look

`CLAUDE.md` holds the rules, the never-do ones marked, and the gate's stopping rule. `docs/adr/` holds eleven decisions and their costs. `docs/review/` holds every gate as the agents reported it. `docs/narration.md` reads a fight off the log.
