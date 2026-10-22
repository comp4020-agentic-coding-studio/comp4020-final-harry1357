# Review gate: the lobby and the pace (ADR-009, ADR-010)

The review gate (CLAUDE.md, "How to work in here") on branch `overhaul`,
after the lobby and pacing pass's integration (HEAD `df2cc47`). Run under the
stopping rule: reviewer and breaker once, one fix round, one confirm pass,
closed.

- The **reviewer** (`.claude/agents/reviewer.md`) read this pass's diff,
  `git diff b53ddcf...HEAD`, against CLAUDE.md, every ADR and every spec.
  `b53ddcf` is the tip before this pass; main is far behind, because the
  earlier phases haven't merged, so `main...HEAD` would re-review all of them.
  It ran the roster against a scratch instance of HEAD on `:8090`.
- The **breaker** (`.claude/agents/breaker.md`) attacked a scratch instance
  of HEAD on `:8091` (`TURN_TIMEOUT_MS=1500`, `ROOM_EMPTY_MS=20000`,
  `LOBBY_GRACE_MS=4000`), never the live deploy. The brief added the lobby's
  surfaces: Start from a non-host, an Echo into the public raid, a join during
  Start, and host promotion on leave.

Both were started on 2026-10-22, each on a fresh context, with no part in
building the work. Their reports are kept as they gave them. What was done
about each finding follows, in "Disposition".

## Before the gate: what step 4 measured

All on the committed tuning (`df2cc47`: `CARD_DAMAGE` 0.5, `TEMPO` 2.2,
`ORRERY_BASE_HP` 160, `ECHO_POTENCY` 0.75), against the app at the live tick
(150 ms) with the default turn timer.

**A scripted solo fight.** One person playing the Mender's policy, taking four
seconds per decision, with four Echoes, in a private room through the lobby,
over HTTP and the room's socket.

| | |
| --- | --- |
| outcome | won |
| seats at Start | 3 (one person, four Echoes at half), Orrery 365 HP |
| fight, Start to ending | 67.1 s |
| Orrery turns | 21 |
| player turns | 64 (3.05 per Orrery turn) |
| phase II (Conjunction) | Orrery turn 11, 34.6 s in |
| phase III (the Grand Alignment) | Orrery turn 17, 51.8 s in |
| after the ending | the room's lobby again: waiting, the same host, all five seated |

**A three-browser fight.** Three headless Chromes, so three sessions: Ada the
Warden made the room, Bo the Striker and Cy the Breaker joined by its code,
and Ada pressed Start. Each page pressed its role's policy move in the
command window three seconds after its turn lit, at the target the window
started on.

| | |
| --- | --- |
| in the lobby | Bo's page read "Waiting for Ada Warden to start the fight." and had no Start button |
| outcome | won |
| seats at Start | 3, Orrery 365 HP |
| fight, Start to ending | 244.3 s |
| Orrery turns | 13 |
| player turns | 61 (4.69 per Orrery turn) |
| phase II | Orrery turn 5, 68.3 s in; its title seen on Ada's and Bo's pages |
| phase III | Orrery turn 9, 147.5 s in; its title seen on all three |
| after the ending | every page in the room's lobby, the end panel and the banner gone, "Last fight: victory" on each, Start on Ada's only |

The three-browser ratio, 4.69, is above ADR-010's 3.2 to 3.8 and the spec's
band (2.5 to 4.5). The engine puts the same room at 3.90 under the policy's
own targets; live, each page took the target the window started on (the
server's default), so its turns were faster ones. ADR-010 says the ratio is
the room's rank choices, and this is one.

An earlier three-browser run (not reported above) is void: its driver pressed
the first live command, which is Brace for every role, so nobody ever struck.
It lost at 36 Orrery turns without crossing a phase. Its screen checks still
held: every page back in the lobby, panel and banner gone, Start on the
host's only.

**Sensors.** `check:viewports`, `check:keyboard` and `check:tags` all pass.
None of them reaches the lobby (their routes are bare battles), so the lobby
was probed by hand at 1920×1080 and 390×844, `clientWidth` and `innerWidth`
equal to the viewport each time before any screenshot was read. The phone's
phase title landed under the strip's row; fixed in `8cb85fa`.
**Probe:** another browser sees a strike in a median of 5.3 ms, worst 7.9 ms
(n=6).

## Finding L1 (from step 4's measurement, before the gate)

**L1. The retune makes heal-heavy rooms endless.** Played out on the engine
with every seat its role's policy, rooms of one to three seats (every pair,
every trio and every lone role, 30 rooms):

| | endless | which |
| --- | --- | --- |
| before this pass (`b53ddcf`) | 3 of 30 | Mender alone, Mender + Mender, Mender + Breaker |
| this pass (`df2cc47`) | 6 of 30 | those three, and Warden/Mender/Breaker, Warden/Mender/Chronist, Mender/Striker/Chronist |

The three new ones won before, at 31, 50 and 17 Orrery turns. Now the others
fall and a lone Mender is left, Bracing and Warding: every single-target card
is aimed at them and absorbed by their own Ward, and the raid-wide cards, at
half the script's damage, are halved again by Brace and out-healed by Mend.
The Orrery stands above 35%, so the Grand Alignment, which ends any fight
that reaches phase III, never begins. Measured on Warden/Mender/Breaker: 951
Orrery turns, Orrery at 180 of 365, the Mender's last 2,480 turns all Brace,
Ward or Mend.

A scripted room isn't a person, who would strike. But an Echo is the policy
(rule 25), and a seat that times out becomes one (rule 8), so a table whose
people walk away is exactly this room, and a room with a person seated in it
never expires (rule 26). It breaks ADR-010's target in intent ("a fight is
long enough to see its phases" assumes it ends), and this pass caused the new
three.

## The reviewer's report

*(pending)*

## The breaker's report

Run against `http://localhost:8091` (TURN_TIMEOUT_MS=1500, ROOM_EMPTY_MS=20000, LOBBY_GRACE_MS=4000, READY_MS at its 8 s default), never fly.dev or :8080. Five attempts broke a CLAUDE.md rule or an ADR-009 sentence, and two more broke the page's own screen contract. Everything else held, including every Start, Echo-seating, join-race and host-promotion attack in the brief.

**Side effect on the shared instance:** the raid joins left about 22 characters seated in the public raid on :8091. They are being carried from fight to fight (see B3), so the raid's Orrery there is huge (1280 max HP at pull).

Scratch scripts are in `/tmp/brk/` (`h.ts` is the helper; `t*.ts` are HTTP/WebSocket attacks, `c*.ts` are Chrome attacks).

### BROKE: a rule or ADR named

**B1. A guest who arrives by a room link is unseated from the lobby while their page is open.**
- **Rule:** 27 and ADR-009 ("Leaving is … no socket open on the room for `LOBBY_GRACE_MS`"). Knock-on: rule 20, since Start counts seats without them.
- **Attempt, over the wire (`t6.ts`):** the host makes a room and keeps a `/ws?room=CODE` socket open with their cookie. A second socket opens `/ws?room=CODE` with **no cookie**, which is what a first-time visitor's page does at boot. Then `POST /api/rooms/CODE/join {name, role:"striker"}` with no cookie returns 200 and mints a cookie. That socket stays open.
- **Attempt, real Chrome (`c1.ts`):** the host makes room MYN88 over HTTP. A fresh Chrome profile opens `/?room=MYN88`, where the door is preselected as "code:MYN88". The guest fills in a name, picks Striker and submits. Their own lobby seat appears at 39 ms.
- **Happened:**
  - Wire: "guest (socket open, opened pre-cookie) unseated after 4171ms; log: GP08554e leaves the table." The socket was still `readyState 1`.
  - Chrome: "server unseated the guest after 4219ms with the page open; last log: GuestC1b2d66 leaves the table." The page still showed Live, with the guest's own seat in the lobby (`lobbyMine: true`).
  - The host's Start then returned 200 and pulled `pullSeats 1`, queue `HostC03c607, The Orrery`. The guest's page went to `phase: "join"` with the join form up.
- **Why:** the server reads the cookie once, when the socket opens (`app.ts` /ws, `hub.ts` sessionOf). The page keeps its boot socket when the joined code equals `app.code` (`main.ts` onJoin → `enter` only if `code !== app.code`), so the server never matches the seat to that socket.
- **Repro:** open `/?room=<code>` in a browser with no `raid_sid`, sit down through the form, and wait past LOBBY_GRACE_MS. Reloading the page fixes it, because the new socket carries the cookie.

**B2. Echoes seated by a host who then left the lobby are dropped from the next lobby.**
- **Rule:** 27 ("After a fight ends the room returns to its lobby with everyone still seated"); ADR-009: "The Echoes stay too: they belong to the table, not to one fight."
- **Attempt (`t10.ts`):** H makes a room and seats Warden, Mender, Striker and Breaker Echoes (all 201). G joins and keeps a socket open. H sends `POST /leave` (200), and G is promoted. G's Start returns 200 with `pullSeats 3`, and G Braces through the fight.
- **Happened:** the fight ended "won", with "EGa07356, Mender Echo, Striker Echo, Breaker Echo" standing. The next lobby held only "EGa07356", host G, with `echoRoles` back to all five roles. The three standing Echoes were not carried. `f1.ts` showed the same with downed Echoes.
- **Control (`t17.ts`):** when the host stays, all four Echoes and every person (downed included) are carried, with the same host.
- **Why:** `nextFight` (`rules.ts:608-609`) carries an Echo only if its `seatedBy` is standing in the new fight. After a leave, `seatedBy` still points at the departed host.

**B3. The public raid's carry turns every timed-out Echo back into a person, and the next pull counts each one whole.**
- **Rules:**
  - Rule 8: an Echo plays "until the person acts again, which ends the Echo at once".
  - Rules 20 and 25: an Echo counts half a seat at the pull.
  - ADR-009 for the public raid: "Everyone still **standing** at the end is seated in the next fight".
  - `rules.ts:594` says turning the Echo back is deliberate ("comes back as the person"), so this needs an owner's ruling.
- **Attempt:** about 20 people seated in RAID (`t7.ts`, `t8.ts` and others) never acted. The raid's next two fights were watched, and their logs read through `GET /api/battles/:id/log` once over.
- **Happened:**
  - Fight g8rTSE0rzeYL ended "lost". All 16 actors' last turns were played as their Echo ("… has missed 3 turns running. An Echo plays their seat at 75%"), and nobody was standing.
  - The next fight, 6eqW2kxoxI5g, carried all of them as people: "The Orrery wakes for 16 at the table", max HP 1280. With the 16 counted half it would be 761.
  - In that fight, 22 seats timed out again from zero (64 timeouts, 0 actions by a person).
  - `GET /api/me` for Raider0be591, who joined at 04:58 and never sent an action, showed them carried through Jbp3Qx04pq17 (lost), g8rTSE0rzeYL (lost) and 6eqW2kxoxI5g (running). Their record stayed at 0 turns and 0 losses, so rule 25's "never in anyone's record" held.
- **Effect:** the raid has no lobby sweep, so absent people are pulled at a full seat each, every fight, with no end. The bound ADR-009's Cost relies on ("eventually an Echo (rule 8), which deals its share") resets every fight. A fight lost with nobody standing still carries everyone.

**B4. Creating a room without a body doesn't seat the creator as host.**
- **Rule:** 27 ("Creating a room seats its creator as host in a lobby"). Rule 22 allows this path ("a seated player … asks for one"), so the two rules disagree and the code follows rule 22. The page doesn't use this path.
- **Attempt (`t5.ts`):** a raider seated in RAID sends `POST /api/rooms` with no body. A stranger then joins the new room. The creator tries Start and tries seating an Echo.
- **Happened:**
  - The create returned 201 `{"code":"5DBQ4",…}`, with a lobby of `hostId null` and queue "The Orrery" only.
  - The stranger who joined first became host.
  - The creator's Start: 403 `"Only the host, Strg936644, can start this fight."`
  - The creator's Echo: 403 `"Only someone seated at this table can seat an Echo here."`

**B5. A late joiner in a private room isn't put at the back of the strip.**
- **Rule:** ADR-009: "A late joiner in a private room … takes a seat at the back of the strip". The design record says "back of the strip with Rank 3 delay", and the code gives only the rank-3 delay (`rules.ts:403-404`).
- **Attempt (`t14.ts`):** host H (Warden) makes a room. G (Mender) joins, then leaves the lobby. H starts. G rejoins after Start, then a stranger joins.
- **Happened:**
  - G's rejoin returned 200, and the Orrery grew 160 → 269 (correct).
  - The queue then read `LG598674:17, LJ7200f5:22, The Orrery:51`: the late joiner first, ahead of the host.
  - In the public raid (`t15.ts`), 3 of 6 late joiners landed ahead of seated players (a Breaker at counter 15 in slot 16 of 17, ahead of a Mender at 18). The raid's ADR text says nothing about the back, so only the private-room case is against ADR-009.

**B6. A stranger can take a departed lobby guest's name in the same battle.**
- **Rule:** 4 ("No two people in one battle share a name"). Rule 24 adds "the app tells people apart by name". They were never seated at the same time.
- **Attempt (`t4.ts` A):** guest "GB5ee37c" joins room GH9Z3, then `POST /leave` (200). A no-cookie stranger joins as "GB5EE37C". The original guest then tries to rejoin with their own cookie.
- **Happened:**
  - The stranger got 200, with a new characterId.
  - The original got 409 `"Someone at this table already goes by that name."`, locked out of their own name.
  - Battle 0iyP_uGvzdIO's log (readable now its room has expired) shows `5 join A10lqJLuOr6c GB5ee37c the Chronist takes a seat` and `10 join ntPpfGR6_jYd GB5EE37C the Mender takes a seat`: two people in one battle with the same name.
- **Why:** `leave()` deletes the name from `joined` (`rules.ts:573`), which the code itself describes as "Everyone who has ever joined … for the name check".

### BROKE: the page's own screen contract (no numbered rule or ADR sentence names it; the gate decides finding or risk)

**P1. A downed guest gets the join form over the running fight they are still seated in.**
- **Claim broken:** `spec/moment.test.ts` and `screen.ts`: "the join screen never covers a fight this page is seated in".
- **Attempt (`c3.ts`):** a Chronist guest's page (cookie set first, so presence holds), seated with the host and three Echoes. The guest never acts. `c2.ts` saw the same thing at 109.3 s.
- **Happened:** "84.0s guest DOWNED on server; fight status fighting". At the same moment the page went to `{"phase":"join","joinScreen":true,"form":true}` while the fight was still running. The server still treats the seat as at the table: submitting the form (`t19.ts`) returns 409 `"You fell in this fight; you can't take your seat again."`, or with another name 409 `"You sat down as DjG5882bd, and a name stays with you…"`.
- **Why:** `screen.ts` decides "seated" from `state.queue` only, and a downed seat is in `state.fallen`.

**P2. A viewer who was never seated in a private room is left with an empty screen after its fight ends.**
- **Claim broken:** `screen.ts`: "The end panel stays up only while this page has nowhere to be … it isn't seated in the room's next one."
- **Attempt (`c4.ts`, `c8.ts`):** a page opens `/?room=CODE` without sitting down, watches the fight, and the fight ends.
- **Happened (`c8.ts`):**
  - +1 ms: the end panel is up with the link `/?room=WSEVV`.
  - +2363 ms: `{"phase":"ended","joinScreen":false,"form":false,"panel":0,"link":[]}`. No panel, no link, no form, and focus on BODY.
  - It stayed like that after the host's next Start. Only a reload brought back the join form.

### HELD

**Attack 1: Start (rule 27), `t1.ts`, room VHSAB.**
- Start with no cookie or a made-up one: 403 `"Only someone seated at this table can do that."`
- Start from a seated guest: 403 `"Only the host, Hosta1a4b3, can start this fight."` The same 403 for a guest whose body names the host (`hostId`, `characterId`, `actorId`, `by`), the host of another room, someone seated in RAID, a lowercase code, and a cookie header with the guest's cookie before the host's (the first cookie wins). These 403s name the host to any seated caller; names are visible to anyone holding the code anyway.
- Wrong code: 404. The state afterwards: waiting, lobby, same host, `pullSeats 0`.
- Two host Starts in parallel: 200 and 409 `"This fight has already started."` A later third: 409. A guest after Start: 409. Exactly one `start` and one `pull` event.
- Start on RAID: 403 `"This fight has no host: it starts on its own."` (no cookie: 403 generic). Lowercase `raid`: the same.
- Bare battle: `/api/rooms/<battleId>/start` returns 404 `"No such room."`, and `/api/battles/:id/start` returns 404. Start on a room's battle id: 404.

**Attack 2: Echoes (rule 25), `t2.ts`.**
- An Echo into RAID: 403 `"Echoes can't be seated in the public raid; make a room of your own for them."` (lowercase `raid` the same).
- `/api/battles/:id/echoes`: 404. Joining RAID as "Warden Echo": 409 (the name is kept).
- A RAID join with `echo:true, seatedBy` in the body: 200, but the fields were ignored and no Echo seat appeared.
- A guest seating an Echo: 403 `"Only the host, H4c36f9, seats Echoes."`, also with a forged `seatedBy` or `hostId`. Not seated: 403. No cookie: 403. Role `orrery` or `__proto__`: 400. An array body: 400.
- Seven parallel host Echoes: 4×201, then 409 `"A table seats 4 Echoes at most, and this one has 4."` and 2× 409 `"There's already a … Echo at this table; one per role."` A sixth later: 409.
- A mid-fight Echo, from host or guest: 409 `"Echoes are seated in the lobby, before the fight starts."`
- Start with 2 people and 4 Echoes: `pullSeats 4`, max HP 453 = 160×4^0.75.

**Attack 3: a join racing Start, `t3.ts`.**
- 15 trials. Each fired 6 no-cookie joins (staggered 0–2 ms) and the host's Start at once, with 0, 1 or 2 Echoes in the lobby.
- Every join got 200 and every Start 200, with 7 people seated each time and no duplicates.
- `pull.seats` plus the grow events accounted for every seat (e.g. pull 4.5, then grows 5.5:575 → 6.5:651 → 7.5:725). The final max HP matched the curve in 15 of 15 trials, with Echoes counted half.

**Attack 4: host promotion, `t4.ts`, `t12.ts`, `t18.ts`.**
- Leave by a guest: 200, seat removed. A second leave: 409 `"You aren't seated in this room's lobby."`
- Host leave, with Echoes in seats 2 and 3: the host passed to the person in seat 4, and a `host` event `{from: host}` was sent.
- The old host's Start: 403 naming the new host. The old host's Echo: 403. The new host's Echo: 201.
- Host socket closed: the host moved after about 4275 ms, skipping the Echo in seat 2.
- Four reconnects at 2.5 s gaps, then 5 s more: still host. A battle-id socket on a lobby is refused (4404), so it can't count as presence.
- A host alone with 4 Echoes leaves: seats `[]`, `hostId null`. Start then: 403. The first newcomer becomes host.
- 10 trials racing three leaves, a join and three Starts: always exactly one seated host, or none with nobody seated, and at most one Start at 200.
- A host with two sockets who closes one: stays host.
- A host whose only socket is on another room: unseated after the grace, Echoes gone (as ADR-009 says).
- Leave after Start: 409 and still seated. No socket for 5.5 s mid-fight: still seated. A timed-out Echo seat's leave: 409.

**Attack 5: lobby stillness and raid growth, `t5.ts`, `t7.ts`, `t16.ts`, `t22.ts`, `t23.ts`, `t11.ts`.**
- A lobby over 3.5 s: 0 socket messages, tick 0, counters `[12,18,21,24]` unchanged, 0 cards, `activeId null`, `turnDeadline null`, `preview null`.
- Acting in a lobby: 409 `"This fight isn't under way."` A lobby idle for 12 s: still waiting.
- Raid joins, one at a time and a burst of 8: every grow kept the HP share (largest change 0.00%). Max HP always equalled the curve and never shrank; no jumps.
- A private room's Orrery grown from 83%: 83.13 → 83.27 → 83.29 → 83.22 → 83.18%.
- A rejoin while already seated: 200, no growth. A role change while seated: 409.
- A bare battle pulled 7953 ms after its first join, `pullSeats 2`, max HP 269 = the curve. Before the pull: tick 0 and no cards.
- Rule 19: no boss resolution without an earlier announced card, in a solo-plus-four fight (25 card events, phase events named "Conjunction" and "the Grand Alignment") or in 3 raid resolutions.

**Attack 6: after a fight, `f1.ts`, `t17.ts`.**
- The same host. Everyone carried, downed people included (except B2).
- The new fight was clean: full HP, fresh counters, 0 cards, phase 1, fresh rings, chain 0, nothing fallen.
- A person whose seat was an Echo at the end was carried as a person (private room).
- A host who had left rejoined the next lobby: 200, and the host stayed G.

**Attack 7: Chrome, `c2`, `c5`, `c6`, `c7`.**
- Host page: the end panel shows for about 2 s, then the lobby with only the "won" last-outcome line (no panel, no banner).
- The second Start gives a clean fight with no stale text.
- Guest page: Start hidden and disabled, "Waiting for … to start". Un-hiding and clicking it in the DOM left the server waiting.
- After promotion: Start visible and enabled.

**Rules 1, 2, 10: turns, `t8.ts`.**
- An early action: 409 `"It isn't your turn."`, and nothing fired by itself when the turn came (400 ms, 0 events).
- Three parallel actions on my turn: one 200, two 409 `"Aae3e99f has just taken this turn."` Back to back: 409.
- A body forging `actorId`, `characterId`, `activeId` or `counter`: 409 `"It's Bb909dd0's turn."`
- Two people at once: one 200, the other 409 naming whose turn it was.
- Queues identical across two sockets in 25 of 25 version-matched states.
- Junk sent over the socket was ignored, and the socket stayed open.

**Rules 22, 24: rooms.**
- Acting in another room's battle: 404. Targeting another room's Echo id: 400 (a ring error; nothing leaked).
- Reading a lobby's battle by id (state, log, join): 404. Its socket: 4404.

**Rule 26: expiry, `t13.ts`.**
- The room closed about 24.4 s after the host's socket closed (4 s grace + 20 s). The socket got 4410, and the log became readable.

**Rule 4 and names, `t9.ts`.**
- Six look-alikes (case, padding, zero-width space, full-width letter, non-breaking space, decomposed form): 409.
- The same name in another room: 200.
- Empty, spaces only, 25 characters, BEL, tab, newline, zero-width only, a number, null and an array: 400. 24 characters: 200.
- U+202E is stripped (stored as "evil").

**Rule 18: Reactions, `t9.ts`.**
- No card: 409. An unknown card: 409. A card the server didn't name: 409.
- Three in parallel: one 200, two 409 `"You've used your Reaction…"`. Again: 409.
- A role's action that isn't yours (Mender intercept, Striker mend, `__proto__`): 400.

### RISKS (no rule broken)

- **R1:** the seats panel (`.seats-echo-buttons`, `seats.ts:120-128`) shows five enabled "Add a … Echo" buttons to a guest who isn't host (the server refuses with 403), and ten after promotion, counting the lobby's own five. Rule 27 says the page draws who is host; this draws an action only the host has.
- **R2:** leaving the public raid while seated returns 409 `"You aren't seated in this room's lobby."` The status is right; the wording is odd.
- **R3:** after a host leaves, their Echoes keep a `seatedBy` pointing at someone no longer seated. It only matters through B2.

## Disposition

One fix round, under the stopping rule. Every finding below got its failing
test in a commit ahead of its fix. The reviewer's findings are added when its
report lands.

### The breaker's findings

| finding | rule or ADR | what was done | red | fix |
| --- | --- | --- | --- | --- |
| B1: a room-link guest unseated with the page open | 27, ADR-009 | After sitting down, the page watches the room on a socket opened then, which carries the cookie the seat minted. Held in real Chrome. | `a5e7e59` (`spec/lobby-page.test.ts`) | `3483e13` |
| B2: a departed host's Echoes dropped from the next lobby | 27, ADR-009 | The next lobby seats the table's Echoes whoever seated them, as the host's now. | `3951f09` | `186bfe7` |
| B3: the raid carries timed-out Echoes back as whole people | ADR-009, 8, 20 | The public raid carries only the people still standing as themselves. The owner's ruling the breaker asked for isn't needed, because ADR-009 already says "still standing". A private room still carries a timed-out seat as its person, and the lobby's presence sweep unseats them if they're gone. | `3951f09` | `186bfe7` |
| B4: a seated player's bodiless room has no host | 27 (with 22) | The seated player is seated in it as its host, under their name and role (rule 24), vetted before anything is minted. Two expiry tests made rooms this way to watch them empty; each gets a short `LOBBY_GRACE_MS` so the asker leaves first (`43ccf32`). | `3951f09` | `186bfe7` |
| B5: a late joiner not at the back of the strip | ADR-009 | A late joiner in a running fight sits behind the last seat standing. | `3951f09` | `186bfe7` |
| B6: a departed guest's name taken in the same battle | 4 | Leaving a lobby keeps the name in the battle's `joined`, so no stranger takes it, and its owner may sit down under it again. | `3951f09` | `186bfe7` |
| P1: the join form over a downed guest's running fight | screen contract (ADR-009's clean screen; `moment.test.ts`) | A seat downed in the fight is still at the table, so the join screen isn't put over it. | `a5e7e59` | `3483e13` |
| P2: an unseated viewer left with an empty screen | screen contract | A page not seated in the room's next fight keeps the end panel until the person goes on. | `a5e7e59` | `3483e13` |
| R1: guests offered Echo buttons on the table's panel | risk (rule 25: Echoes are the host's) | Fixed, not just recorded, because it was one condition: only the host is offered them. | `a5e7e59` | `3483e13` |
| R2: leaving the raid says "this room's lobby" | risk, no rule | Recorded and closed: the status (409) is right. | | |
| R3: an Echo's `seatedBy` points at a departed host | risk, no rule | Closed by B2's fix: a next lobby re-seats Echoes as the host's. Within one lobby the stale `seatedBy` is read by nothing. | | |

### L1: waiting on the owner's ruling

`spec/pace.test.ts` holds it, red on the six rooms (`ad3f665`). The fixes
above don't move it. Two ways to close it, both measured on a scratch copy:

- **Recommended: the Grand Alignment begins after a fixed number of Orrery
  turns, whatever the phase.** Past `ALIGNMENT_AFTER` Orrery turns (40, beyond
  ADR-010's target of 12 to 30), every `ALIGNMENT_EVERY`-th card is an
  Alignment, as it already is in phase III, and the third to resolve is the
  wipe. Endless rooms go from 6 of 30 to 0 at 40, and at 60. Every room in
  ADR-010's table gives identical numbers, because they all end before turn
  40. It adds no card, event or renderer: the Alignment card, its event and
  the strip's clock (drawn from `alignmentLeft`) already exist. Only the
  trigger is new. It is the genre's enrage: a fight can't be outlasted.
- **Perihelion pierces Brace.** It narrows the stall but doesn't close it.
  A Ward still absorbs, and a lone Mender Wards themselves before every
  single-target card. It also changes every fight, not only the overrunning
  ones.

Until the owner rules, L1 is open and the branch doesn't merge (CLAUDE.md:
"the branch does not merge to main while any review finding is open").

### The roster after the fix round

`pnpm check` against HEAD `3483e13`: 268 green, 4 red.
- R7 (the README) is the owner's, carried red.
- L1 is red by intent.
- `spec/assets.test.ts` (a 5 s timeout reading PNGs) and `spec/shown.test.ts`
  T4 (168 ms against a 150 ms tick) failed only because the reviewer's own
  roster on `:8090` was running at the same time. Both pass alone, twice.

