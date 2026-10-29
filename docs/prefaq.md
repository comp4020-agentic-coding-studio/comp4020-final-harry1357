# PREFAQ: The Rail

*Written for launch day, the showcase on 11 November 2026, from the build
deployed today (29 October): `5a5a57c` on `main`, the overhaul merged and
live at comp4020-final-harry1357.fly.dev. Any figure not taken from
`docs/review/` comes from a scratch copy of that build, played in headless
Chrome on 29 October.*

---

## Press release

### The Rail: a JRPG boss fight for everyone in the room, in a browser tab

**Canberra, 11 November 2026.** The Rail is open at
comp4020-final-harry1357.fly.dev. It is a multiplayer raid in the shape of a
16-bit JRPG battle. Everyone who opens the page takes a seat in the same
fight against the Orrery, a clockwork boss of brass rings around an ember
eye, and the rings shed segments as it takes damage. There is nothing to
install and no account to make. You choose where to sit, pick one of five
roles, type a name, and take a seat.

Most browser games for a group are either a quiz someone else runs or a
real-time scramble the fastest thumbs win. The Rail is turn-based, and the
turn order is public: a strip of portraits down the side of the screen
shows who acts next and how long each seat waits. Every attack the Orrery is
about to make sits at the top of that strip as a card, naming its target and
counting down, before it lands. The game is reading that strip together and
deciding who answers which card. The Warden steps in front of an Eclipse
meant for someone else. The Breaker reveals a ring's weakness so the
Striker's blow comes round sooner. The Chronist pushes the boss's card back a
slot to buy the Mender a turn.

"I wanted the moment a JRPG player knows, seeing the boss wind up, but with
the people sitting next to you," says the developer. "The server holds
every rule. Your screen draws what it's told and decides nothing, so two
people looking at the same fight always see the same fight."

There are three doors. **Join the public raid** to sit down in whatever
fight is on: it never closes, and the boss grows to fit you with its
percentage kept. **Create a room** for a table of your own behind a
five-letter code you read out, with a waiting room where the host presses
Start once everyone is in. **Enter a code** to join one. On your own, the
host can seat up to four **Echoes**, server-played seats marked as Echoes
everywhere, so one visitor still gets the whole fight: a solo player with
four Echoes reaches all three phases, and the fight ends in about two
minutes. The room never waits on one person: anyone who goes quiet for 12
seconds is Braced automatically, and after three timeouts in a row their
seat plays as an Echo until they act again.

The Rail runs in any current browser, on a phone or on a 1920×1080 screen.
It's free.

---

## Customer FAQ

**What do I need to play?**
A browser and a name, and nothing else: no download, no sign-up, no email.
Your name stays yours for as long as your browser keeps its cookie, and your
turns and wins carry over between visits ("Welcome back").

**How long is a fight?**
It depends on the table. One person with four Echoes took about two minutes
(1 min 56 s in our run on 29 October, 38 Orrery turns, all three phases, a
win). Three people in three browsers, each taking a few seconds a decision,
took about four minutes (the lobby review's measured fight). The boss keeps
pace with the room: it acts about once for every three player turns, however
many of you there are.

**I've never played a JRPG. Will I be lost?**
The command window lists your five moves. Each shows what it does and how
long it will hold you back ("short wait", "steady wait"), and a move you
can't use yet says why in plain words, for example "Pry needs the outer
ring's weakness revealed first. Scan it." Highlight a move and a ghost of
your portrait shows where on the strip you would land. Brace is always safe.

**What are the five roles?**
- **Warden:** takes blows meant for others. Signature move: Intercept.
- **Mender:** heals before the hit lands. Signature move: Ward.
- **Striker:** builds Momentum and cashes it in. Signature move: Finisher.
- **Breaker:** finds weaknesses and cracks shields. Signature move: Shatter.
- **Chronist:** bends the turn order. Signature move: Delay.

Each role has its own resource. Some of its moves only pay off because of
what another role did.

**What happens if I close the tab mid-fight?**
The fight carries on. Each turn you miss is Braced for you, and after three
in a row your seat plays as an Echo. Come back and act, and the seat is yours
again. Nothing an Echo does is counted in your record.

**Can someone else act for me, or walk into my room?**
No. Your browser can only act for the seat it created, and the server
refuses, and logs, any request that names another seat. A private room can
only be reached by its code, and nothing lists codes.

**Is anything saved?**
Your character and every finished fight's log are saved, and they survive
restarts. A fight still running when the server restarts does not: it is
closed as abandoned with a log line saying so, and never quietly resumed.
Room codes don't survive a restart either.

**Does it work on my phone?**
Yes. At phone width the Orrery and its HP sit at the top, the turn strip runs
across beneath them, then the party, then the command window. It is checked
for sideways scrolling at 390×844. Touch, mouse and the keyboard alone (arrow
keys and Enter) all work.

**I get motion sick.**
With your system's reduced-motion setting on, nothing rotates or shakes.
Every effect has a still version that shows the same change: bars that set
instead of draining, numbers that appear in place. Sound has a Mute button.

---

## Engineer FAQ

**What's the architecture?**
One Node process on one 256 MB Fly machine. Hono serves the client, the JSON
API and a WebSocket per room. The game loop and every turn counter live in
memory on a 150 ms tick, beside a SQLite file on the one Fly volume at
`/data`. Node runs the server's TypeScript directly, with no build step
(ADR-001). Only the client is bundled, with esbuild.

**Why in memory, and what does that cost?**
Turn order needs exactly one authority and one clock, and one process
provides both with no locks and no consensus. The cost is that a restart
ends live fights. That is accepted and handled openly: each turn's durable
consequences are written to SQLite *before* the new state is broadcast, and
on boot any fight still marked live is closed as abandoned (rules 5 and 6).

**How do clients agree on turn order?**
They never compute it. The client draws the `queue` and `activeId` the server
sent, in the order sent. The landing ghost is the server's `state.preview`,
which also carries the server's refusal text for each move. That is why the
command window can say "not now, and why" without deciding anything. Two
clients in one fight are tested to receive identical queues, and the strip is
tested never to re-sort them.

**What if two people act at the same moment?**
The server's clock decides. The second request gets a 409 naming whose turn
it is, and it is dropped, never queued or retried (ADR-005). An off-turn
action is refused the same way (rule 2). A Reaction is the one off-turn
move, and it is live only while the server says one is ready.

**How fast does a move reach the other screens?**
The propagation probe uses two separate Chromes and times one strike from
the first to the second. At the last gate, the median was 6.6 ms and the
worst 8.8 ms. The roster requires that a strike appear on another player's
rendered page before its log line, and within a second.

**How do you authorise anything with no accounts?**
A person is an HttpOnly session cookie the server mints, plus a name and a
role. Identity always comes from the cookie. A body that names any other
seat (`seatId`, `characterId` or `actorId`) is refused with a 403 before the
turn is looked at (ADR-008). Every applied action and every refusal, on
every route, is exactly one key=value log line carrying a six-character
hash of the session and never the cookie. A walker over the app's own route
table holds that to every route.

**How is it tested?**
262 tests in 38 spec files, run over HTTP against the running app, and
against a container built from the same Dockerfile Fly runs. Some tests
boot their own server with a fast clock. Five drive real headless Chrome,
because claims like "shown before logged", a guest staying seated, and
focus rings can only be judged on a rendered page; one more mounts the real
command window in jsdom. Since `5a5a57c`, `pnpm check` builds the client
before the roster, so page specs can no longer pass against a stale bundle.
CI is green on `main`. Layout, keyboard and name-plate overlap checks run by
hand in Chrome. Specs are committed red before the code that turns them
green.

**How do you know the tests test anything?**
Each phase passes a review gate before it merges. Two agents that had no
part in the work review it: one reads the diff against every rule and ADR,
and one attacks a scratch instance through the API, the socket and Chrome.
Neither can approve. Findings are fixed red-first in commits that name them,
and the reports are kept in `docs/review/`. The gates have found what a
green roster hid: a fight anyone could mint with one unauthenticated
request, a lethal Lunge arriving a stack early, a private room's code
leaking, and a reviewer agent that could write files.

**What are the limits?**
- One machine: no horizontal scaling, no failover.
- Rooms live in memory, so a redeploy forgets every code.
- The tuning numbers (boss HP, Echo output, card damage, tempo) are starting
  values marked "ours" in `tuning.ts`. They were measured in scratch
  simulations and a handful of scripted fights, not in playtests at room
  scale.
- One known flaky test: `assets.test.ts` lost its connection twice against
  the container under load. It is recorded as a risk, and a retry is on the
  next phase's list.

---

## Manager FAQ

**What shipped?**
The full game is on `main` and live: five roles and the action economy, a
three-phase Orrery with telegraphed cards and an enrage, private rooms with
a waiting room and a host's Start, the always-on public raid, and Echoes.
Server-side seat checks and per-action logs are also live. The `overhaul`
branch merged after its gates closed with no open findings, and the README
was rewritten to match.

**Why did it take until now?**
Nothing merges while a review finding is open. When phase two (the client)
slipped after a lost weekend, `main` kept the finished smaller version
instead of a half-built bigger one, until every gate closed. `PROCESS.md`
and `docs/review/` hold the record.

**What does it cost to run?**
One always-on shared-CPU machine in Sydney, about US$2.47 a month, paid by
the course org (ADR-003). It stays on because a cold start took 4.6 s, and a
visitor's first sight of a real-time app would be several seconds of
nothing. This is to be revisited after the showcase.

**What are the risks on launch day?**
- *A redeploy mid-showcase ends every fight and forgets every room code.*
  Mitigation: don't push `main` during the showcase (ADR-001).
- *A crowd on one machine.* One shared CPU handles a table comfortably, but
  a crowd hasn't been load-tested.
- *Balance.* In our 29 October solo run, a player who only ever pressed
  Brace still won, carried by four Echoes. A solo table is a floor, not a
  test of skill. The numbers are lightly playtested, and past forty Orrery
  turns the boss enrages, so no fight runs forever.
- *A newcomer's first minute.* At 1920×1080 the name field and the Take a
  Seat button sit below the fold on the join screen.
- *Agent budget.* The build uses Claude Code agents on a weekly course
  budget, which once ran dry mid-pass. The meter is read before any pass of
  more than three parallel agents, and big passes start on reset day
  (ADR-004).

**Is it safe to let strangers in?**
There are no accounts and no personal data, only a name and a cookie. The
server refuses any attempt to act for another seat or to reach a private
room without its code, and logs each refusal once, without the cookie. Each
of these is held by a test, and the breaker agent attacks them before every
merge.

**What does success look like?**
A table of strangers at the showcase talking about the strip ("Lunge on you
in one, Brace") instead of staring at their own buttons. We'll judge that by
watching. No test can say whether the strip reads at a glance, so it is
listed as judged, not checked.

**What's next?**
See `docs/features-rice.md`: forty candidates, scored. The highest-scoring
ones close the first minute (the join screen, the turn nudge) and the gaps
between rules and code (Charge that's banked but never spent, and a
Reaction for only one role in five). After the showcase: playtest at room
scale, retune the "ours" numbers, and revisit always-on.
