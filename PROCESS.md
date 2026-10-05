# Process overview

## What I built

The Rail: a raid for a room. Every open session is one character in the
same fight against the Orrery, the turn order is a single rail everyone
watches, and the server is the only thing that decides whose turn it
is. Characters and finished fights persist; a live fight does not
survive a restart, by design.

## Why this stack

One Node process on Fly, Hono serving the client and a WebSocket
endpoint, the game loop and every counter running server-side in memory
with write-through to SQLite on the one volume ([556051b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/556051b01699ae3a689a470a9bb675d82de5bf59)). The options I
weighed were the crit 7 stack, Phoenix LiveView, and a managed real-time
service. Astro with a backend has nowhere for a server-side tick to
live. LiveView is the right shape and a language I'd be learning under a
deadline. A managed service moves the one claim the app rests on, that
the server is the sole authority on turn order, off a machine I control.
The cost of what I chose is that in-memory state dies with the process,
which the README accepts up front: a fight outliving a restart was never
a promise. One correction landed the same day: the WebSocket package I
named only works with the old node-server, and the current one does
WebSockets itself ([aa3776d](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/aa3776dd472a5b5cee4857193ff17a58fbe83b32)).

## The harness went first, and it was the first thing to break

Crit 7's CLAUDE.md had a design-gates section marked never to be
trimmed. The course start skill's carry-forward dropped it, and this
repo's CLAUDE.md arrived as the empty template. Restoring it was the
first commit of the project, before any rule for the app ([11119c8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/11119c83252df24670544b8447126a5778c621ac)). A
rule that says "never remove this" is text, and text can't protect
itself; what holds is a check that fails the build when the section is
gone ([d6fdd10](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/d6fdd10c999c0f6db4411489033e6cd22fde37b3)). The app's own rules followed:
seven things the server must never do, derived from the README's claims
([cce4938](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/cce4938b8a9e753db1444d622fdb6ae617dd3999)), and six spec tests committed red before any code existed,
each failing for the right reason with no server to answer ([3be90be](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/3be90bebfd6897e5acf6a64d9590b58f5087a03d)).

## The queue is the truth

Every README claim that can be checked is a test, and the tests came
before the server ([918f6ed](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/918f6ed60ada5bb54999963f451d611e9064dce3)). The one that matters most is the probe:
two separate headless browsers join as two characters, one strikes,
and the probe measures how long the other takes to see the queue change
([b54fe16](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b54fe1636e9e6d00e7940ba5a59acc4b44d137c6)). Against the live app, over eight strikes, the median was 17
milliseconds and the worst 20, on polling. Week 10's move to WebSockets
is now an architecture decision, not a scramble to meet the one-second
line.

## Nothing accepted on trust

Four subagents built v1 in parallel after a scaffold commit fixed the
shared files ([ba74f17](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ba74f17cea1e222f22167d4b8447d2a7d66602b1)). One stalled and was resumed. I didn't take any
agent's report as evidence: the image was rebuilt from the final tree
and every check re-run ([99be6a2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/99be6a2936a5d3d48126a5ac0f906646114302d6)), the server and client were read
against the never-do rules, and a container was killed and restarted on
a real volume. The sensors caught two things the agents had passed as
done, a client overflow at 390px and an empty log that took keyboard
focus ([7b6eab4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/7b6eab4fbb0e552c2082e6da1eebc2a4cce5ab8b), [ebfbf6a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ebfbf6ac86aca170e22dcd847bb8cdbddce95cdc)). The live restart test was the crit 7 test
again: two characters seated, one strike, a machine restart, both back
identical with the turn and damage intact, and the fight closed as lost.

## Decisions I own, and one I'm replacing

Three calls the agent made, kept on purpose and now rules: a character
whose turn passes twenty seconds is held, and two holds in a row removes
them, because a room can't wait on one person ([918f6ed](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/918f6ed60ada5bb54999963f451d611e9064dce3)); tokens drawn as
circles where the gates ban rounded corners, lifted for tokens by name
rather than routed around ([ebfbf6a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ebfbf6ac86aca170e22dcd847bb8cdbddce95cdc)); one battle per page load joining
the open raid, with separate battles for tests so they never wait on
each other. The one I'm replacing is the Orrery gaining hit points per
joiner. It's the median answer to "more people", it makes the fight
longer rather than different, and the README says so.

## What I threw away, and what it cost

The first interface met every check and failed the definition of good.
The rail didn't move, actions existed only as log text, and the Orrery
was a dot with a number. The README says the rail is the conversation;
on that screen it said nothing. So I started a battle screen on a
branch, a scene a JRPG player would recognise, drawn original or openly
licensed, with the rail as a turn strip and every event shown before
it's logged. One area of seven landed. Then seven parallel subagents on
Opus exhausted the course key's weekly budget mid-file and the other six
died. The attempt is frozen on the branch ([5f8b144](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/5f8b14450be6f9833954f9212eec761e3f98d2a1)). I'm keeping
Opus and parallel agents, because the quality difference on this kind of
build is real and the allocation resets weekly; the correction is
narrower than a model ban. The budget is read at /api/me before any
pass with more than three agents, and the big passes start the day the
allocation resets rather than the day before it runs out ([a397d83](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/a397d830af796ad28d86f577441a241bf91572fa)). v1 ships this week because it clears the
spec; the battle screen is week 10's build, on the fresh allocation.

## What's checked, what's judged

Enforced: queue identity between clients, rejection out of turn,
propagation within a tick, unique names, persistence across restart,
the harness's own presence. Judged: whether the rail reads at a glance
on a phone, which I'll test at the crit by handing mine over; whether
co-presence changes the fight, which is next week's one decision about
several people; and whether it looks like a game, which it doesn't yet,
and which I'm not claiming.
