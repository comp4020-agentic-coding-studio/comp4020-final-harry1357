# Process overview

## What I built

The Rail: a raid for a room, on a battle screen a JRPG player
recognises. Every open session is one character in the same fight
against the Orrery, the turn order is a strip of portraits everyone
watches, every event is shown before it's logged, and the server is
the only authority on whose turn it is. This week the live app learned
to tell people apart on the server and in its logs. A second version,
with a full action economy, five roles, rooms and Echoes, is built and
reviewed on a branch and is not live, for a reason the record shows.

## Why this stack

One Node process on Fly, Hono serving the client and the WebSocket,
the game loop and every counter running server-side in memory with
write-through to SQLite on the one volume ([556051b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/556051b01699ae3a689a470a9bb675d82de5bf59)). I weighed the crit
7 stack, Phoenix LiveView and a managed real-time service. Astro has
nowhere for a server-side tick to live; LiveView is the right shape
and a language I'd be learning under a deadline; a managed service
moves the one claim the app rests on off a machine I control. The cost
is that in-memory state dies with the process, which the README
accepts. The transport has been the socket since v1 ([a09f3a7](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/a09f3a7c66da846ab1b9ac2891294f20edbadb8c)).

## The harness went first, and keeps breaking first

The course's carry-forward dropped my design gates on day one, and
restoring them was the first commit ([11119c8](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/11119c83252df24670544b8447126a5778c621ac)). A rule that says "never
remove this" is text; what holds is a check that fails the build when
the section is gone ([d6fdd10](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/d6fdd10c999c0f6db4411489033e6cd22fde37b3)). The app's rules followed from the
README's claims ([cce4938](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/cce4938b8a9e753db1444d622fdb6ae617dd3999)), and the first specs were committed red
before any code existed ([3be90be](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/3be90bebfd6897e5acf6a64d9590b58f5087a03d)).

## Told apart, on the server and in the logs

This crit asks for the authorisation decision checked on the server
and written down, and for logs that say who did what. Before writing
the decision I had the agent try the obvious attack on the running
app: session A's cookie with a body naming B's seat. It came back 200
and spent A's own turn, unrecorded. That is the finding the brief
describes, found three days before the pod would have found it. ADR-008
([b1c4764](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b1c47649f78fd4a6cd5603274a39a23c752e3c19)): a session acts only for the seat it created, within its
role's catalogue, on targets in the same fight; everyone in a fight
sees everything; a session with no seat watches and never acts. The
spec went red first ([b20ae6f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b20ae6fd87df155528af68a23bdada28f068dcb7)), and one test still passed with the seat
check removed, because the refusal was merely "not your turn"; it was
rewritten to require the refusal to name both seats, and committed red
before the fix ([26ccef6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/26ccef64530cb7c3d93b5ae8d2e63d9bca2f7905)). The logger is one module with three callers,
so the branch's rebase touches one file ([8c6ab1f](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/8c6ab1f422776d473a00bd10d9af6dd5f5b97bc0)): every applied action
and every refusal is one key=value line with a stable six-character
session id and never a cookie. Live, two Chrome profiles produced two
ids, and a forged seat was refused with both seats named in the line.
The narration guide is built from those real lines ([d9d345a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/d9d345a41f834787aa3b7eed7cf39e20046c8fe8)).

## The second version, and why it isn't live

After crit 9 I read the fight as a JRPG player, and the honest verdict
was that every turn was Strike or Brace and nothing changed which was
right. I commissioned a design study (docs/design/overhaul.md) and
recorded the decision: the strip is the play surface ([a8c8f9a](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/a8c8f9ac014ac2fdd2f3fa79e1fc1333cf690e27)).
Harness before content, as always: rules first ([f220043](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/f220043798f2ab2815bf6aeeecc72bd23c4f3fce)), specs red
([2609f94](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/2609f9430e48c39bef91724f8baec44f52695fb8)), then three agents built the economy, five roles and the
Orrery's phases ([3876cbd](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/3876cbd553935b150b8cae2696c6487786d12c99)), and after ADR-007 two more built rooms and
Echoes ([c67ce18](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/c67ce187c3e397cd6d40445ab4a50d9e979d47ef), [6f94ea0](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/6f94ea0f5a83cb02b8580d5ca620a1263ae25f6e)). Every number the study didn't supply is
marked "ours" in tuning.ts.

## A gate that grades the graders

Two agents now sit between a build and a merge, each on a fresh context
with no part in the work: a reviewer that reads the diff against every
rule, ADR and spec and can only find, never approve; and a breaker that
attacks a running instance ([0e5c564](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/0e5c56483bda3928d1dfcf0d21f6637fa681e27b), [4887b00](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/4887b00e53191faf5f9745e0fa3c78de3fac6929)). Phase one's gate found
Gravity killing one Lunge earlier than the design record says ([fccab70](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/fccab70c8e0a63e7ae8d4f9e1d4d0423f2f17ab2),
[1e884ee](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/1e884eec4c62496a913056091452aef2390ad2e0)), a card re-aiming onto someone nothing announced ([9b4b7b7](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/9b4b7b77fbb67d5ccff70a9fbcf3f156f3a71d40),
[4cb1154](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/4cb115463d548943afdd8e13e19794454f2b0852)), and the reviewer itself able to write files through two
flags, fixed with an allowlist after a blocklist leaked twice ([ed255f6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/ed255f682cd0152b9aa925c6eda8df55684ca953),
[58a134e](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/58a134ead59bc77b3330e9a88215019c1edf5a62)). Twenty weak tests were strengthened and each proven by
breaking the code on purpose; the re-review caught my disposition table
overstating three fixes. Phase one-b's gate found a real bypass, an
unlisted and unexpiring fight anyone could mint with one unauthenticated
request ([810650b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/810650b12f87f5e09ace7473043727b2166b1e72)); a leak that left ten orphan fights in the breaker's
database ([71e00df](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/71e00df71a2556796a64556d5a80fdec5560c2a1)); a finished private fight handing out the open
room's code ([361dc82](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/361dc824e869202e32cb9c6ccca9d1fea30f87a9)); and five more overstated dispositions. Every
sensor was proven to fail on a planted fault before it was trusted
([d792ee5](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/d792ee56090c4cf75edbcac9e2fc2cbf6f4af021)). The commit messages name the findings.

## Decisions I own

A name is for life and a role is for a fight, because the app tells
people apart by name ([3b7dbaf](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/3b7dbafa7389e8f9d0879d183c98ee17c782ef77)). ADR-004's amendment was rewritten to
say what happened rather than the reason I'd given, which the ADR
contradicted ([b1ea0d3](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b1ea0d3afe208af6da8dc32c63bc1611103c627c)). Two at once, the clock decides ([b5ed95b](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/b5ed95b18bff4d852965fb5a4b4337103d4cd995),
[80c34f1](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/80c34f1a40d5bb7e25a95aadce54c386be772863)). A room can't wait on one person ([63323c6](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/63323c68936025ab6aaf0d56bd35194c01c52d51)); one machine stays
on ([3ae5ca4](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/3ae5ca45ceb43f07199f6fe28991c94dad7cdcda)); the gates lift by name, never by workaround ([2dd3585](https://github.com/comp4020-agentic-coding-studio/comp4020-final-harry1357/commit/2dd35850d6d3a10b177bece5cfed28bcc021e2e4)).

## What the floor is for

The gate's rule is that nothing merges with a finding open. Sixteen
are open, all client work, each held by a red test, plus the README's
own. Phase two, the client, was scheduled for the weekend; the home
connection failed and it did not run. So main ships as it stands, the
battle screen with the seat check and the logs, and the branch waits
with its gates passed. That is the rule working. It isn't the week I
planned; it is the week the record shows. Next: phase two, the README
to the new definition of good, the merge.

## What's checked, what's judged

Enforced: queue identity between clients, rejection out of turn and
for another seat, two at once by the server's clock, every event shown
before logged, one log line per action and refusal, no cookie in a
log, persistence across restart, the harness's own presence. Judged:
whether the strip reads at a glance, and whether a room makes the fight
different, which the branch answers and main still doesn't.
