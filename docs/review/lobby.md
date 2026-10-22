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

The reviewer approves and rejects nothing; this is what it found. Scope: `git diff b53ddcf...HEAD` (HEAD df2cc47). It read CLAUDE.md in full, all nine ADRs, every file in spec/ and its helpers, and every changed source file in full.

### The roster

- **The run did not hit :8090.** The reviewer's Bash hook refuses an env prefix, so `APP_URL=http://localhost:8090 pnpm check` was rejected, and `pnpm check` ran against the default http://localhost:8080. It couldn't confirm which source that instance ran. It answers `/api/rooms/:code/start`, because the rooms and echoes tests that call `startRoom` passed. The specs that boot their own server (lobby.test's wire tests, rooms.test expiry, shown, gate-two-page) did run against HEAD's source.
- **Full run:** typecheck passed and stylelint passed. vitest ran 35 files and 262 tests: **251 passed, 11 failed** (9 files).
  - owner.test R7 failed: the README finding the owner holds, carried red and not re-argued.
  - 8 tests hit vitest's 5 s default timeout: assets (frames), echo-lines C1, gates (soft stage), sprites (silhouette), pace ×2, and moment's "server's phase event carries the phase's name".
  - 2 rooms.test tests failed to boot their server ("didn't answer within 15s").
  - shown T4 failed at 217 ms against a 150 ms tick.
- **Rerun one file at a time:** pace + moment + lobby + pull 26/26; assets + echo-lines + gates + sprites + shown 29/29; rooms 17/17. Run alone, only R7 is red.
- **New tests from this pass go red under load.** All three pace.test tests and moment.test's engine test pass no timeout argument and take about 7 s in a parallel run, so they fail a full `pnpm check` on this machine.

### 1. Places the diff breaks a rule or an ADR

**1a. Most serious: someone who opens a shared `/?room=CODE` link for the first time is unseated from the lobby while their page is still open.**
- At boot the page opens the room socket before any cookie exists.
- They sit down through the pre-filled code door. `src/client/main.ts:236` (`if (code && code !== app.code) enter(code);`) skips `enter()` because the code is already the one being watched, so the socket is never reopened with the cookie the join just minted.
- The server records whose socket it is only at the upgrade (`src/server/app.ts:293-294`, `src/server/hub.ts:64`), so `hub.watching` (`hub.ts:82-85`) never matches them, and `sweepLobbies` (`src/server/table.ts:171-182`) calls `leave()` after LOBBY_GRACE_MS. If that person was host, the host role passes on.
- This breaks ADR-009 §Decision ("has had no socket open on the room for `LOBBY_GRACE_MS` … so a reload or a dropped connection isn't a leave") and rule 27 ("if they leave the lobby before Start, the next person seated becomes host"). This person never left.
- `enter()` itself writes `?room=` into the address "so a reload, or a link, comes back to it" (`main.ts:278`), so links are an intended way in. No test covers this.

**1b. A room's next fight brings timed-out Echoes back as fresh people.**
- `nextFight` (`src/server/rules.ts:595-607`) re-seats every character still standing or downed through `join()`, which builds the seat from `blankFighter()` (`rules.ts:396-409`, `866-882`). So `echo` becomes false and `timeouts` becomes 0.
- This breaks rule 8 ("until the person acts again, which ends the Echo at once"; "Acting resets the count"): the person hasn't acted.
- It breaks rule 20 ("an Echo counting as half a seat"): `seatsOf` (`economy.ts:66-68`) counts the absent seat as a whole seat at the next pull.
- The public raid has no presence check, so an absent person is carried into every following public fight indefinitely, and each fight their seat costs 3 × TURN_TIMEOUT_MS before it is an Echo again.
- In a private room the person is carried first and removed by the sweep only 10 s later. ADR-009 says "A person who has gone between fights is not carried over." No test covers this.

**1c. Rule 27 says "Creating a room seats its creator as host in a lobby", but the seated-player path doesn't.**
- `POST /api/rooms` with no name or role (`src/server/app.ts:168-171`) creates a room and seats nobody, and the first person to join becomes host (`rules.ts:412`).
- Rule 22 allows this path, so rules 22 and 27 contradict each other, and ADR-007's new status note ("its creator is the room's host", `docs/adr/007…md:8-10`) is false for it.
- `spec/rooms.test.ts:264-266` depends on it: "alice is its first person seated, so she is its host" of a room someone else created.

**1d. Rule 22 and the new host don't fit together, and nothing amends rule 22.**
- Rule 22 says "nothing owns one"; ADR-007 says "There is no owner, password or invite list."
- Under rule 27 the host alone can Start and seat Echoes, and ADR-009 §Cost says the host "holds the table for as long as they like … no vote and no timer to take it from them".
- ADR-009's Amends line names neither rule 22 nor ADR-007's "no owner". This is a judgement call, but the conflict between the texts is unresolved.

**1e. Echoes carried into the next lobby don't follow ADR-009.**
- `rules.ts:608-610` re-seats an Echo only if the person who seated it is still standing, so an Echo seated by a host who later left the lobby is dropped at the next fight. ADR-009 says "The Echoes stay too: they belong to the table, not to one fight."
- All Echoes are seated after all people, where ADR-009 says "in their seat order".
- No test covers either.

**1f. Rule 11: the next fight's join and seat events are thrown away, but their log lines are kept.**
- `table.ts:86-92` writes `nextFight`'s log lines, then `hub.moved` sends the state with `[]` events (`hub.ts:108-112`).
- The conductor's carry path appends those lines directly (`conductor.ts:154-157`), and the join and seat renderers never run.
- Rule 11 says "the client writes an event's log line only once its renderer has shown it". In mitigation, `strip.render` draws the seats from the same state just before (`conductor.ts:146`). Low severity.

**1g. Rule 13's text no longer describes the Orrery's reset.** Low severity, a judgement call.
- Rule 13 says "wait = tickSpeed × rank × haste … (A1's model, `src/server/ctb.ts`)".
- The Orrery's counter is now set directly (`rules.ts:477`, `510`, `623-627`). It bypasses `ctb.ts` and `reset()` (`rules.ts:817`), uses `round()` instead of floor, and clamps at TEMPO_MIN.
- ADR-010 recasts this as an "effective tick speed", but it doesn't list rule 13 as amended, and rule 13's text is unchanged.

**1h. Commit history (record only).**
- Commit 0880745 changes the text of rules 20, 25, 27 and 28 in one commit, where ADR-009's header says "Each change to a rule's text is its own commit."
- c2d8e9f bundles shown.test's 409 relaxation, which has nothing to do with the lobby, into the lobby spec commit, where CLAUDE.md says a wrong spec is changed "in its own commit".

### 2. Rules with no test that would fail

- **Rule 27, "The client draws who is host and never decides it".** No spec exercises `src/client/lobby/lobby.ts`. gate-two-page's `start()` helper (`spec/gate-two-page.test.ts:59-63`) looks only at the host's own page, and the host is also the first person seated, so a lobby that showed Start to the first character in the queue, or to everyone, would pass.
- **Rule 27, "The public raid has no host and no lobby … its next one pulls after a short ready window".** No test checks that the public raid has `hostId: null` and `lobby: false`, or that a Start there is refused (`rules.ts:534-537`). The *next* public fight (carry-over plus READY_MS) is untested: pull.test covers only a fresh fight's first seat.
- **Rule 28, "across one, three and five seats".**
  - No test holds a room of one seat. The "one" case is one person plus four Echoes, which rule 20 counts as three seats.
  - ADR-010 itself says a lone Striker who only Jabs is outside the band (`docs/adr/010…md:76-79`), so rule 28's text claims more than ADR-010 or the spec delivers.
  - Commit 93304d1 swapped "one person, one Echo" for "one person, two Echoes". It was its own commit and landed while the spec was still red, before the server, but its comment explains dropping the lone seat and gives no reason for moving from one Echo to two. Whether that is a deliberate amendment or a narrowing toward what passes is for the gate to judge.
- **ADR-009 lobby presence** (finding 1a) is held only indirectly, through rooms.test's expiry test and gate-two-page Q2. Nothing tests "a socket open means still seated".
- **ADR-010's mechanics have no direct test**: weighting by seat speed rather than head count, a downed seat slowing the Orrery, TEMPO_MIN, and the first turn coming at the room's pace. Only the wide band (2.5–4.5) holds any of it.
- **Rule 28, "a card the strip draws".** `strip.phaseCard`'s DOM output is never checked; only the recorded API call is. Low.

### 3. Tests that would pass under a wrong implementation

- **`spec/shown.test.ts:120-122` passes under a server that refuses every action.** With `[200, 409]` accepted, if every person's action came back 409, timed-out seats would become Echoes and the Striker's Echo would jab, so the fight would end and every asserted kind would still be seen (join, jab, hold, end, an Orrery move). The change has a stated reason, but it drops the test's premise of "every role acting". A fix: require at least one 200 per role, or that each 409's error names whose turn it is.
- **`spec/lobby.test.ts:200-204` passes if a private room pulled on any timer longer than 1.5 s.** The comment says 1.5 s is "far past the old countdown", but the old countdown was 10 s of wall clock (ADR-006: "The countdown is wall-clock time, not ticks"). A countdown in progress broadcasts nothing, so `last` and `waiting` are the same state, and `last.tick === waiting.tick` compares a value with itself. The engine tests do hold the rule (`lobby.test.ts:61-77`, `pull.test.ts:64-71`).
- **`spec/pace.test.ts:127-133` would have passed the tuning ADR-010 rejected.** It allows up to 40 Orrery turns for five people, against ADR-010's target of "twelve to thirty", and the tuning commit records 34 turns and a loss at CARD_DAMAGE 0.55. There is no outcome check for five people either.
- **`spec/pace.test.ts:59, 123, 132` can't tell which phase was reached.** `phases.length === 2` counts the boss turn of each phase event, not the phase number, so a server that emitted phase II twice and never reached phase III would pass. orrery.test pins the phase lines separately. Low.
- **`spec/orrery.test.ts:290-295` and `spec/lobby.test.ts:281-287`: the Orrery is at 100% when the late joiner arrives.** Nobody acts first, so "share kept" can't be told apart from "refilled to the new max". Only lobby.test's engine test (`:141-159`, wounded to 60%) distinguishes the two.
- **`spec/lobby.test.ts:254-269` passes if the Echoes came back as people.** It asserts five characters and the same host. It doesn't check that four of them are still Echoes (`echo`/`seatedBy`), or that roles are kept, so shuffled roles would pass too.
- **`spec/queue.test.ts:100-111` asserts what its own filter already guaranteed.** The two new assertions repeat the `waitFor` predicate on the state it selected, and the queue-order check they replaced (`queue[0]`) is gone. The reason given is sound; the new lines add nothing. Low.
- **`spec/moment.test.ts:83-95` checks only phase II's name**, so a server that named every phase "Conjunction" would pass. Separately, the client hard-codes the names (`src/client/strip/strip.ts:52`) for the card it draws from state, and nothing checks them against the server's. Low.
- **`spec/lobby.test.ts:123-129`: the test name over-claims.** It says "in its lobby or its fight", but only the waiting public fight is tested. Low.

### 4. Events with no renderer

**None found.**
- EVENT_KINDS (`src/shared/protocol.ts:325-377`) has 47 kinds, and the registry's OWNERS (`src/client/battle/registry.ts:19-30`) lists 13 + 2 + 32 = 47, the same set.
- `FEEL.renderers` (`src/client/battle/effects/feel.ts:85-119`) has all 32 of its kinds, including the new start, host and grow.
- The strip and command areas are unchanged in this pass, and shown.test's registry check passes when run alone.
- On the server side (grep isn't available to the reviewer) it read every file that raises events and was touched by this pass: rules.ts, orrery.ts and economy.ts (roles.ts is unchanged). Every `kind` they raise is declared.

### Older specs this pass changed: amendment or weakening

- **Deliberate amendments with stated reasons:**
  - echoes.test: Echo seating moved into the lobby, as rule 25 now requires.
  - engine.ts: `lobbyTable` added.
  - pull.test: the restart and cap tests are gone because ADR-009 removed those features; the new tests hold READY_MS and "a private room never pulls on a timer".
  - orrery.test: the late-joiner assertion is inverted to match amended rule 20 (its share check is weak; see section 3).
  - rooms.test: `startRoom` calls and LOBBY_GRACE_MS added.
  - gate-two-page: reworked for the lobby flow, with Q2 moved to a second browser that isn't seated.
  - contrast.test: lobby selectors added.
- **Amended but weak:** queue.test (section 3).
- **Open to question:** pace.test in 93304d1 (section 2), and shown.test's 409 relaxation, which is not driven by the lobby (sections 3 and 1h).

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

One fix round, under the stopping rule. Every finding that a test can hold
got its failing test in a commit ahead of its fix.

**A correction to the record, found while triaging the reviewer's roster
note.** The shared app on `:8080` was never restarted after `df2cc47`: the
restart's kill matched the wrong pattern, and the new process failed on
`EADDRINUSE`. So the roster reported after the breaker's fix round, 268 green,
had its over-HTTP specs run against the pre-fix server. The reviewer's run on
`:8080` was against that same old server too. The specs that boot their own
server did test HEAD each time. The roster below is against a server confirmed
at HEAD from its start line, killed and started by port.

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

### The reviewer's findings

| finding | what was done | red | fix |
| --- | --- | --- | --- |
| 1a: a room-link guest unseated with the page open | The same defect as the breaker's B1; closed by its fix. | `a5e7e59` | `3483e13` |
| 1b: a timed-out Echo carried back as a fresh person | The public raid half was the breaker's B3, closed by `186bfe7`. In a private room a seat left to an Echo is now carried as that Echo, its count kept, until its person acts (rule 8), and is half a seat at Start (rule 20). ADR-009 now says who has gone isn't known when a fight ends, and the lobby's presence unseats them. | `592ef41` | `3d106ac`, `efb89c0` |
| 1c: a seated player's bodiless room has no host | The same defect as the breaker's B4; closed by its fix. `rooms.test.ts`'s cross-room test, which relied on the old behaviour, makes room A alice's own. | `3951f09` | `186bfe7`, `b28018e` |
| 1d: rule 22's "nothing owns one" against the host | Rule 22 now says a host is not an owner: their only say is Start and the Echoes in the lobby, it passes on, and there's no kick and no lock. ADR-009's Amends line names rule 22 and ADR-007's "no owner". | | `2ded35c`, `efb89c0` |
| 1e: Echoes dropped with their seater; Echoes after people | The first half was the breaker's B2 (`186bfe7`). The table is now seated in its seat order, Echoes among people, as the host's: the host is set first. | `592ef41` | `3d106ac` |
| 1f: the carry's lines written with no event shown (rule 11) | The carry is silent: no line and no event, since the next fight reaches every screen as a whole state. Member rows are still written. | `592ef41` | `3d106ac` |
| 1g: rule 13's text doesn't cover the Orrery's reset | Rule 13 now says the Orrery's tick speed is the room's pace and its counter still drops by 1 a tick. ADR-010's Amends line names rule 13. | | `62fed4b`, `efb89c0` |
| 1h: four rules in one commit; an unrelated spec change bundled | Recorded, as the owner's ruling says: a finding about history is closed by being recorded. ADR-009's header now notes it. | | `efb89c0` |
| §0: new tests go red on the 5 s default under load | Each test that plays whole fights or decodes sheets has an explicit timeout, sized from its measured time alone (up to 3.2 s). | | `b28018e` |
| §2: rule 27, the client draws who is host | jsdom test of the lobby with the host as the second seat: no Start, no Echoes and "waiting for Sol" for the first seat; Start for the host; Start leaves when the server moves the host. It found the lobby drawing hidden Echo buttons for a guest. | `b28018e` | `d68fad3` |
| §2: rule 27, the public raid has no host or lobby; its next pull | Engine tests: `hostId` null, `lobby` false, Start refused; the next public fight carries the standing and pulls at `READY_MS`, not before. | `b28018e` | (held) |
| §2: rule 28, "one, three and five seats" claims more than delivered | Rule 28 now claims the band for what ADR-010 and the spec hold: a solo person with four Echoes, and rooms of three and five. 93304d1's swap was a narrowing toward what passed (one Echo measured 2.42), and is recorded as such. The band now holds two three-person mixes and no two-seat room. | | `bf15a55`, `98036e7` |
| §2: lobby presence held only indirectly | B1's page test holds it in Chrome: a page with its socket open stays seated past twice the grace. | `a5e7e59` | `3483e13` |
| §2: ADR-010's mechanics untested | Direct tests of `orreryReset`: weighted by speed (three Chronists against three Wardens, about 2×), a bigger room is faster (one Striker against three, about 3×), a downed seat slows it, 45 seats floor at `TEMPO_MIN`, and the first counter at Start is the room's reset. | `b28018e` | (held) |
| §2: the phase card's DOM unchecked | The strip rendered at phases 2 and 3: the card up, naming each as the server's phase event does. | `b28018e` | (held) |
| §3: shown.test passes a server that refuses everything | Each role must land some of its actions, and each late 409 must name the turn. | `b28018e` | (held) |
| §3: the stillness test compared a state with itself | It waits 11 s, past the old 10 s countdown, checks the lobby broadcast nothing, and reads it afresh on a new socket: waiting, the host named, tick 0. The presence sweep is put out of its reach, since nobody holds a socket of their own. | `b28018e` | (held) |
| §3: five people allowed 40 turns, no outcome; phases by count | Five people within 12 to 30, and won; phases held as `[2, 3]`. | `b28018e` | (held) |
| §3: the late joiner meets a full Orrery | The wire test has the Striker cleave first, so the Orrery is wounded, then checks the share is kept and isn't a refill. | `b28018e` | (held) |
| §3: the next lobby's Echoes could come back as people | Held as four Echoes, as their roles, the host's, with the host still the Striker. | `b28018e` | (held) |
| §3: queue.test re-asserted its filter | Holds that the queue as sent is in counter order, with the actor placed behind everyone with less to wait. | `b28018e` | (held) |
| §3: one phase name checked; client names not held to the server's | Phase III's name too, and the strip's card names held to the server's events. | `b28018e` | (held) |
| §3: an over-claiming test name | It now tests what it says: no Echo in the public raid, waiting or running. | `b28018e` | (held) |

"(held)" means the stronger test passed against the code as it stood. The
weakness was in the test, not the code.

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

`pnpm check` against HEAD `efb89c0`, on a server confirmed at HEAD: 279
green, 2 red.
- R7 (the README) is the owner's, carried red.
- L1 is red by intent, until the owner rules.

## Confirm pass on L1

The reviewer, on a fresh context, read the L1 fix alone (`git diff efb89c0 e7453b7`) and the files it leans on, and ran the roster through its hook as `APP_URL=http://localhost:8090 pnpm check`, which the hook now accepts. Its report, summarised; its verdicts are kept as it gave them.

- **Roster:** 278 of 285 passed on the full run. Seven failed, each a load timeout or a boot that ran out, while this session's own image roster ran at the same time. Rerun alone against `:8090`, only R7 is red. None of the failures is in `pace.test.ts`, and every L1 test was green in both runs.
- **What the ruling asked for, as built:**
  - the enrage past 40, whatever the phase (`orrery.ts:290`);
  - every fourth card an Alignment, the third the wipe;
  - the log line;
  - 40 marked ours;
  - ADR-010 with its cost, and rule 28's line in a commit of its own;
  - red first; no new event kind.
- **F1 (kind 1: rule 28, a narrow case).** The reason was read from the phase each Alignment resolved in (`orrery.ts:544`), and the Alignment count isn't reset at phase III. So a table that crossed 35% after turn 40, before the first enraged Alignment landed (the slow, winning table of the Cost paragraph), met a wipe the clock began, and no line said so. Phase III's entry line also said the Grand Alignment "begins" when it had already begun.
- **F2 (kind 2).** "No fight that ends on its own meets it" was held for ADR-010's eight rooms only, not the thirty L1 lives in, and as written it reads as a guarantee that conflicts with ADR-010's own Cost.
- **F3 (kind 3).** The enrage test passed:
  - a wipe on the first or second Alignment;
  - every card after the clock being an Alignment;
  - an enrage starting at 39.
  It also didn't say which phase its table was in.
- **F4 (kind 3).** The strip's clock during the enrage was untested: `alignmentLeft` put back to phase III alone passed the roster. `protocol.ts:282` still said "null before phase III".
- **F5 (kind 3).** A server putting the clock's reason on every Alignment line, phase III's own included, would pass.
- **F6 (kind 1, low).** The enrage didn't reset the card count, so its first Alignment could be the first card after the clock, up to three cards less warning than "as in phase III".
- **Kind 4:** none. No new event kind; `alignment` keeps its fields and renderer, and nothing reaches the log before the screen when the enrage starts.

### Disposition of the confirm pass

| finding | what was done | red | fix |
| --- | --- | --- | --- |
| F1 | The script remembers that the clock began the Grand Alignment (`enraged`), so every Alignment it brings names the clock, the wipe's included, whatever phase it lands in. Phase III's entry line says the Grand Alignment "already begun by the clock, goes on". | `f15b4fe` | `cb99e4d` |
| F6 | The rotation's count starts afresh when the clock begins it, so its first Alignment is the fourth card, as phase III's is. ADR-010 now says wipes land at about 52 to 56. | `f15b4fe` | `cb99e4d`, `3428684` |
| F3 | The enrage test holds the exact start (the strip's clock null at 39, three at 40), the every-fourth spacing over the rotation (a Perihelion, the Orrery's other cadence, isn't counted, in either case, `2e1940f`), exactly three Alignments with the wipe on the third, and its table's phases, `[2]`. | `f15b4fe` | (held) |
| F4 | `cards.test.ts` holds the clock in phase II: null at the thirty-ninth Orrery turn, three at the fortieth. `protocol.ts` says the clock begins at the enrage too. | `82741c7` | `3428684` |
| F5 | A table enters phase III by a real blow before the clock and Braces through phase III's three Alignments; none of their lines claims the clock. Its first form ran over no lines at all (`6f715ab`). | `f15b4fe`, `6f715ab` | (held) |
| F2 | Held in its honest form: of the thirty rooms of one to three seats, every one that ends before turn 40 meets no clock, and the seven that run past it are named. One of the seven, a Mender, Breaker and Chronist, ended on its own before this pass (lost at 75 Orrery turns) and now meets the clock and is wiped at 48. The owner's clause, "no fight that ends on its own ever meets it", is stronger than that, and is the owner's to word; it is left as ruled, with this fact before them. ADR-010 states the room. | `f15b4fe` | `3428684` |

**Every wrong implementation the confirm pass named now fails a test**, checked by planting each one in `orrery.ts` and running `pace.test.ts` and `cards.test.ts`:
- an enrage at 39: 2 red;
- a wipe on the first Alignment: 3 red;
- the reason read from the phase: 1 red;
- no fresh count: 1 red;
- the reason on every line: 1 red;
- `alignmentLeft` back to phase III only: 2 red.

The file was restored after each.

**After the round:**
- The 30 scripted rooms: 0 endless.
- ADR-010's table: unchanged.
- The roster on a fresh instance of HEAD (`6f715ab`), `APP_URL=http://localhost:8090 pnpm check`: 287 green, R7 red.

## Second confirm pass, on the confirm pass's fix round

The reviewer, on a fresh context, read `git diff e413e3d 6f715ab` and the files it leans on, and ran the roster twice through its hook against a fresh instance of HEAD on `:8090`, uncontended:
- **Run 1:** 286 of 288 passed. R7 failed, and so did `assets.test.ts`, on a fetch reset (`ECONNRESET`); that test passed alone, 4 of 4.
- **Run 2:** 287 of 288 passed, R7 the only failure.

Its report, summarised; its verdicts are kept as it gave them.

- **Status of the first pass's findings:**
  - F1: fixed in code, partly held.
  - F2: not closed.
  - F3: closed, apart from a dropped bound.
  - F4: closed. The client comment at `cards.ts:307` still said "before phase III".
  - F5: partly closed.
  - F6: closed at the enrage's start.
- **1 (kind 1: rule 28 and ADR-010, with kind 2).** The clause "no fight that ends on its own meets it", in rule 28, ADR-010:148-150, `tuning.ts` and `pace.test.ts`, is broken in letter by the measured Mender/Breaker/Chronist room, which ADR-010 itself describes in the same section. As a guarantee it has no test that can go red: the thirty-room test asserts only that a room ending before 40 meets no clock that starts at 40. "No ruling closes this … The owner has to reword the clause or rule on it."
- **2 (kind 1: "Never weaken one to get a green roster … change it deliberately, in its own commit"; and kind 3).** `f15b4fe`, a red-spec commit, removed the enrage test's wipe-timing bound (`ENRAGE_AFTER + 4 * 3 + 2`), which the fresh count would have failed (55 to 56 against 54). The removal wasn't named or made in its own commit. With no bound, a server whose enraged Alignments resolve many turns late passed, and ADR-010's Cost ("around turn 52 to 56") was held by no test.
- **3 (kind 3).** A table already in phase III before turn 40 and still fighting at it was never tested. Either deleting the `b.phase !== 3` guard or keying the reason on the turn would pass, and would make phase III's own Alignments claim the clock.
- **4 (kind 3).** Phase III's entry line during the enrage was held by no test. The F1 test recorded no phase per Alignment, so the old phase-read reason passed whenever no Alignment landed after the crossing.
- **5 (kind 1, low: ADR-010's "goes on").** The rotation's count restarted on any phase change during the enrage, putting two Alignments up to seven cards apart.
- **6 (kind 3, low).** The thirty-room test's `every` ignored its argument, so an Alignment in phase II before 40, in a room that later reached phase III, passed.
- **Kind 4:** none.
- **Other rules:** no violation found.

### Disposition of the second confirm pass

| finding | what was done | red | fix |
| --- | --- | --- | --- |
| 1 | **Open: the owner's ruling.** Rule 28's and ADR-010's clause "no fight that ends on its own meets it" is the owner's own wording, from their ruling on L1, and a measured room contradicts it. The room is a Mender, Breaker and Chronist that ended on its own before this pass, lost at 75 Orrery turns. It now meets the clock's first Alignment at 45, survives it, and falls to ordinary blows at 48. ADR-010 had said it was "wiped at 48"; that is corrected in `adffc96`. The clause is not reworded here, because rewording it is the owner's to do. The gate does not close until it is ruled on. | | |
| 2 | The timing is held again, and tighter than the dropped bound: the first enraged Alignment within six Orrery turns of the clock, each after it within six of the last, and the wipe twelve to sixteen Orrery turns after the clock, which is ADR-010's "around 52 to 56". The removal of the bound in `f15b4fe`, without its own commit, is recorded here as history. | `bd6a2f9` | (held) |
| 3 | A table put into phase III at turn 34 that defends past the clock: no line of its Grand Alignment claims the clock, and its Alignments stay four cards apart across turn 40. Deleting the phase guard fails it, and so does keying the reason on the turn. | `bd6a2f9` | (held) |
| 4 | The F1 test reads the phase III line ("already begun by the clock", not "begins:") and the phase each Alignment lands in, and requires one of the clock's Alignments to land in phase III. Putting the old line back fails it, and so does the phase-read reason, on any timing. | `bd6a2f9` | (held) |
| 5 | Once the clock has begun the Grand Alignment, a phase line doesn't restart its count. Red on a crossing in the middle of a cycle (six cards apart), green after. | `bd6a2f9` | `adffc96` |
| 6 | Each Alignment a room meets before the clock must come after that room's phase III began. | `bd6a2f9` | (held) |
| F4's comment | `cards.ts` says the clock starts at the enrage too. | | `adffc96` |

**After the round:**
- The 30 scripted rooms: 0 endless.
- ADR-010's table: unchanged.
- The roster on a fresh instance of HEAD (`adffc96`), `APP_URL=http://localhost:8090 pnpm check`: 289 green, R7 red.

**The gate is not closed.** Finding 1 is open, waiting on the owner's ruling. The stopping rule permits one fix round on a confirm pass's findings, so the fixes to 2–6 are not re-reviewed by a third pass. Under CLAUDE.md, a gate closes when every finding is fixed, carried red, closed by ruling or recorded as history, and the last review finds no rule or ADR violation; finding 1 is a rule violation until it is ruled on. Nothing is pushed while the gate is open.
