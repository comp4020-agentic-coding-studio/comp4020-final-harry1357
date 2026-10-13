# Process overview

## What I built

The Rail: a raid for a room, on a battle screen a JRPG player 
recognises. Every open session is one character in the same fight 
against the Orrery, the turn order is a strip of portraits everyone 
watches, every event is shown on screen before it's logged, and the 
server is the only thing that decides whose turn it is. Characters and 
finished fights persist; a live fight does not survive a restart, by 
design. State is pushed over a WebSocket from the server's tick; this 
week's probe put the worst sample at 27 milliseconds against the live 
app.

## Why this stack

One Node process on Fly, Hono serving the client and the WebSocket, the 
game loop and every counter running server-side in memory with 
write-through to SQLite on the one volume ([556051b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/556051b01699ae3a689a470a9bb675d82de5bf59)). I weighed the crit 
7 stack, Phoenix LiveView, and a managed real-time service. Astro with a 
backend has nowhere for a server-side tick to live. LiveView is the 
right shape and a language I'd be learning under a deadline. A managed 
service moves the one claim the app rests on, that the server is the 
sole authority on turn order, off a machine I control. The cost is that 
in-memory state dies with the process, which the README accepts up 
front. One correction landed on day one: the WebSocket package I named 
only works with the old node-server ([aa3776d](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/aa3776dd472a5b5cee4857193ff17a58fbe83b32)). The transport has been 
the socket since v1; the status note records that there is no switch 
left to make ([a09f3a7](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/a09f3a7c66da846ab1b9ac2891294f20edbadb8c)).

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

## The queue is the truth, and the screen is where it's told

Every README claim that can be checked is a test, and the tests came 
before the server ([918f6ed](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/918f6ed60ada5bb54999963f451d611e9064dce3)). The probe joins two headless browsers as 
two characters, strikes in one, and measures when the other sees the 
queue change ([b54fe16](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b54fe1636e9e6d00e7940ba5a59acc4b44d137c6)). The battle screen added a second rule and a 
second probe: every event the server sends has a renderer, and another 
player's screen must show the event before its log line. On the live 
app, B saw the projectile at 270 milliseconds, the damage number at 747, 
and the log line at 1011 ([ae746c7](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ae746c710b5b5b603c03f98f9582bf851cf7cb67)).

## Nothing accepted on trust

Four subagents built v1 in parallel after a scaffold commit fixed the 
shared files ([ba74f17](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ba74f17cea1e222f22167d4b8447d2a7d66602b1)). I didn't take any agent's report as evidence: 
the image was rebuilt and every check re-run ([99be6a2](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/99be6a2936a5d3d48126a5ac0f906646114302d6)), the code read 
against the never-do rules, a container killed and restarted on a real 
volume. The sensors caught two things the agents had passed as done 
([7b6eab4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/7b6eab4fbb0e552c2082e6da1eebc2a4cce5ab8b), [ebfbf6a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ebfbf6ac86aca170e22dcd847bb8cdbddce95cdc)). This crit, the agent caught me: a draft of this 
document said the app polled, and it doesn't; the claim contradicted 
the commit it cited, and the correction is in the history. And when the 
battle screen changed the interaction to two presses, the keyboard 
check and the probe were rewritten to press twice and assert the first 
press fires nothing ([the keyboard sensor commit](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/7a5e59771070cdff364a1e2100d98b2583af1cf9)). The viewport check 
had been calling a long page a failed viewport because of headless 
Chrome's scrollbars; it was fixed, then proven by planting a real 
2,100-pixel overflow and watching it fail at both widths ([the viewport 
sensor commit](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/7a800e89e8bc107772d8c8885560815eb7db441d)). A sensor that can't fail isn't one.

## Two people act at once

The plate holds one character, but two clients can press Strike inside 
the same few hundred milliseconds. Queue the later one, apply both, or 
refuse the later one by name. I chose refusal, and the README made the 
choice: the server is the only authority on turn order ([b5ed95b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b5ed95b18bff4d852965fb5a4b4337103d4cd995)). 
Queueing makes a client's stale intent authoritative in a later tick; 
applying both makes the queue a lie. The cost is written down: on a 
slow connection you can press Strike and be told it isn't your turn. 
The decision is a test: two clients act for the same turn in the same 
tick, exactly one lands, the other is refused by name, both see the 
same queue ([80c34f1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/80c34f1a40d5bb7e25a95aadce54c386be772863)).

## What I threw away, and what came back

The first interface met every check and failed the definition of good: 
the rail didn't move, actions existed only as log text, the Orrery was 
a dot with a number. I started a battle screen on a branch, with a 
party you can see, an original Orrery of rotating rings, a command 
window, and every event shown before it's logged. One area of seven 
landed; then seven parallel Opus subagents exhausted the course key's 
weekly budget mid-file ([5f8b144](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/5f8b14450be6f9833954f9212eec761e3f98d2a1)). I kept Opus and parallel agents; the 
correction was that the budget is read before a big pass ([a397d83](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/a397d830af796ad28d86f577441a241bf91572fa)). The 
branch sat frozen through a power cut. The extension bought three 
hours, and the way to spend them safely was a gate: the shipped crit-9 
tag was the floor, three agents at a time, merge only if every check 
and every hand test was green by 10:45. It was green at 10:03. The 
merge also fixed a join bug no sensor had caught, a new player stuck on 
"Taking a seat" until the next server message ([the seat fix](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/c96c16254affb8b466b64fb00a22d461ba221651)), and a 
4.37:1 contrast on a lit portrait that the arithmetic check found at 
the new size. Sprites are a CC0 pack credited before a file was copied; 
the Orrery is original ([ae746c7](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ae746c710b5b5b603c03f98f9582bf851cf7cb67)).

## Decisions I own, and one I'm still replacing

A character whose turn passes twenty seconds is held, and two holds 
removes them, because a room can't wait on one person ([63323c6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/63323c68936025ab6aaf0d56bd35194c01c52d51)). One 
machine stays running so a session picked up the next day doesn't wait 
on a cold start ([3ae5ca4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/3ae5ca45ceb43f07199f6fe28991c94dad7cdcda)). Inside the battle screen the web gates are 
lifted by name and the game's rules apply; outside it they stand 
([2dd3585](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/2dd35850d6d3a10b177bece5cfed28bcc021e2e4)). The one I'm still replacing is the Orrery gaining hit points 
per joiner: the median answer to "more people", and the README says so.

## What's checked, what's judged

Enforced: queue identity between clients, rejection out of turn, two at 
once resolved by the server's clock, every event rendered and shown 
before it's logged, propagation within a tick, unique names, 
persistence across restart, every asset licensed, the harness's own 
presence. Judged: whether a JRPG player wants to join, which I'll find 
out by handing over my phone; and whether co-presence changes the fight, 
which the hit-point placeholder still doesn't, and which is the next 
decision.
