# Process overview

## What I built

The Rail: a raid for a room. Every open session is one character in the
same fight against the Orrery, the turn order is a single rail everyone
watches, and the server is the only thing that decides whose turn it
is. Characters and finished fights persist; a live fight does not
survive a restart, by design. It is real-time by the brief's definition
on polling alone, and this week the question stopped being how a change
travels and became what the app does when two people act at once.

## Why this stack

One Node process on Fly, Hono serving the client, the game loop and
every counter running server-side in memory with write-through to
SQLite on the one volume ([556051b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/556051b01699ae3a689a470a9bb675d82de5bf59)). The options I weighed were the crit
7 stack, Phoenix LiveView, and a managed real-time service. Astro with a
backend has nowhere for a server-side tick to live. LiveView is the
right shape and a language I'd be learning under a deadline. A managed
service moves the one claim the app rests on, that the server is the
sole authority on turn order, off a machine I control. The cost is that
in-memory state dies with the process, which the README accepts up
front. One correction landed on day one: the WebSocket package I named
only works with the old node-server ([aa3776d](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/aa3776dd472a5b5cee4857193ff17a58fbe83b32)). The transport shipped as
500ms polling, and because the probe measured it at 17 milliseconds,
the WebSocket switch is a recorded deferral rather than a gap ([a09f3a7](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/a09f3a7c66da846ab1b9ac2891294f20edbadb8c)).

## The harness went first, and it was the first thing to break

Crit 7's CLAUDE.md had a design-gates section marked never to be
trimmed. The course start skill's carry-forward dropped it, and this
repo's CLAUDE.md arrived as the empty template. Restoring it was the
first commit of the project ([11119c8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/11119c83252df24670544b8447126a5778c621ac)). A rule that says "never remove
this" is text, and text can't protect itself; what holds is a check
that fails the build when the section is gone ([d6fdd10](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/d6fdd10c999c0f6db4411489033e6cd22fde37b3)). The app's own
rules followed: what the server must never do, derived from the
README's claims ([cce4938](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/cce4938b8a9e753db1444d622fdb6ae617dd3999)), and six spec tests committed red before any
code existed ([3be90be](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/3be90bebfd6897e5acf6a64d9590b58f5087a03d)).

## The queue is the truth

Every README claim that can be checked is a test, and the tests came
before the server ([918f6ed](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/918f6ed60ada5bb54999963f451d611e9064dce3)). The one that matters most is the probe:
two separate headless browsers join as two characters, one strikes, and
the probe measures how long the other takes to see the queue change
([b54fe16](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b54fe1636e9e6d00e7940ba5a59acc4b44d137c6)). It runs before every ship, and its figure is what let this
week be about behaviour rather than plumbing.

## Nothing accepted on trust

Four subagents built v1 in parallel after a scaffold commit fixed the
shared files ([ba74f17](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ba74f17cea1e222f22167d4b8447d2a7d66602b1)). One stalled and was resumed. I didn't take any
agent's report as evidence: the image was rebuilt and every check re-run
([99be6a2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/99be6a2936a5d3d48126a5ac0f906646114302d6)), the code was read against the never-do rules, and a container
was killed and restarted on a real volume. The sensors caught two
things the agents had passed as done ([7b6eab4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/7b6eab4fbb0e552c2082e6da1eebc2a4cce5ab8b), [ebfbf6a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ebfbf6ac86aca170e22dcd847bb8cdbddce95cdc)). The live
restart test was the crit 7 test again: two characters seated, one
strike, a machine restart, both back identical, the fight closed as
lost.

## This week's decision: two people act at once

The plate holds one character, but two clients can press Strike inside
the same few hundred milliseconds. Three options: queue the later action
for that character's next turn, apply both and let the fight absorb it,
or refuse the later one with a message naming whose turn it is. I chose
refusal, and the README made the choice: the server is the only
authority on turn order. Queueing would make a client's stale intent
authoritative in a later tick, and applying both would make the queue a
lie. The cost is real and I've written it down: on a slow connection
you can press Strike and be told it isn't your turn, which feels like
being ignored. The rail showing the plate and the countdown, and the
action panel enabling only when the server says you're on it, narrow
the window; they don't close it. The decision is a test, not a
sentence: two clients act for the same turn in the same tick, exactly
one lands, the other is refused by name, both see the same queue ([b5ed95b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b5ed95b18bff4d852965fb5a4b4337103d4cd995)).

## Decisions I own, and one I'm replacing

A character whose turn passes twenty seconds is held, and two holds
removes them, because a room can't wait on one person ([63323c6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/63323c68936025ab6aaf0d56bd35194c01c52d51)). One
machine stays running so a session picked up the next day doesn't wait
on a cold start ([3ae5ca4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/3ae5ca45ceb43f07199f6fe28991c94dad7cdcda)). Tokens are circles where the gates ban
rounded corners, lifted by name rather than routed around ([2dd3585](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/2dd35850d6d3a10b177bece5cfed28bcc021e2e4)).
The one I'm replacing is the Orrery gaining hit points per joiner: the
median answer to "more people", longer rather than different, and the
README says so.

## What I threw away, and what it cost

The first interface met every check and failed the definition of good:
the rail didn't move, actions existed only as log text. So I started a
battle screen on a branch, a scene a JRPG player would recognise, with
every event shown before it's logged. One area of seven landed; then
seven parallel Opus subagents exhausted the course key's weekly budget
mid-file ([5f8b144](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/5f8b14450be6f9833954f9212eec761e3f98d2a1)). I'm keeping Opus and parallel agents; the
correction is that the budget is read before a big pass and big passes
start on reset day ([a397d83](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/a397d830af796ad28d86f577441a241bf91572fa)). The branch is still frozen. This week
shipped the decision and its test rather than the battle screen, because
a smaller true thing beats a larger half-done one at a cutoff.

## What's checked, what's judged

Enforced: queue identity between clients, rejection out of turn, two at
once resolved by the server's clock, propagation within a tick, unique
names, persistence across restart, the harness's own presence. Judged:
whether the rail reads at a glance on a phone; whether co-presence
changes the fight, which the hit-point placeholder still doesn't; and
whether it looks like a game, which it doesn't yet and I'm not
claiming.
