# Review gate: phase one-b (rooms and Echoes)

The review gate (CLAUDE.md, "How to work in here") on branch `overhaul`, after
the step-3 integration (`6f94ea0`) and the sensor fix (`d792ee5`). Two agents,
each on a fresh context with no part in building the work: the **reviewer**
(`.claude/agents/reviewer.md`), reading the diff from `d9456c0` (the tip
before this phase) against CLAUDE.md, every ADR and every spec; and the
**breaker** (`.claude/agents/breaker.md`), attacking a running scratch instance
through the API and the WebSocket, rooms included: a wrong code, a cross-room
action, a fifth Echo, a bare battle used to bypass a room's rules, an Echo
acting out of turn, and a room's expiry.

Run on 2026-10-17. As in phase one, neither agent type is registered in this
session, so each was run as a general agent given its file's instructions
verbatim; the reviewer's read-only Bash (`git diff` and the test runner) was
imposed in its brief. The reviewer ran the roster against a scratch instance
of HEAD on `:8090`. The breaker attacked its own scratch instance on `:8091`
(`TURN_TIMEOUT_MS=1500`, `ROOM_EMPTY_MS=20000`, so Echoes and expiry were
reachable in seconds), never the live deploy.

Before the agents ran, the propagation probe and the keyboard, tags and
viewport checks were moved onto the current roles and actions (`d792ee5`),
and each was proven to fail on purpose first: a planted overflow, a removed
focus ring, plates pinned to one spot, and a broadcast stalled 1.5 s.

The reports are kept as the agents gave them. What was done about each finding
follows them, in "Disposition".

## The reviewer's report

**Summary.** 7 rule or ADR violations, 4 rules with no test, 6 tests that would pass under a wrong implementation, and 1 event with no renderer (new in this phase, and already held by a red spec). The reviewer can't approve, only find.

**What was read and run.** The scope is `git diff d9456c0...HEAD` on `overhaul` (22 files).

Read in full:
- CLAUDE.md, ADRs 001–007, `docs/review/phase-one.md` and `docs/design/overhaul.md`.
- Every file in `spec/`.
- Every changed server and shared file: `rooms.ts`, `table.ts`, `app.ts`, `main.ts`, `hub.ts`, `view.ts`, `echoes.ts`, `rules.ts`, `economy.ts`, `tuning.ts` and `protocol.ts`.
- The diffs of the four `scripts/` sensors. They follow the new roles, and no finding came from them.
- For context: `db.ts`, `roles.ts`, `src/client/main.ts`, `net.ts` and `battle/registry.ts`.

Ran `APP_URL=http://localhost:8090 npx vitest run`: 119 passed, 14 failed.
- The 14 failures are exactly the carried set: `sprites` ×2, `effects`, the first test in `shown`, and `phase-two` ×10.
- The new and changed specs (`rooms`, `echoes`, `economy`, `echo`) are 32/32 green.
- Typecheck and stylelint were not run, because the brief held Bash to `git diff` and vitest.

### 1. Violations of a rule or an ADR

- **R1, rule 24 and ADR-007 §Decision: a character's name and role don't persist across rooms.**
  - `src/server/app.ts:65-82` seats a known session under whatever name and role the request body carries.
  - `src/server/db.ts:107-113` then writes both over the character row (`onConflictDoUpdate … set: { name, role }`).
  - So one session can sit as "Ada the Warden" in room A and "Bo the Striker" in room B. The record's name and role become whichever join came last.
  - This breaks "A character (name, role, record) persists across rooms and the seat is per room" (rule 24) and "A character is the session's name, role and record" (ADR-007:55-56). Only the shared record holds. The test that should catch it doesn't (R15).

- **R2, ADR-002 (Status: "The reason a room can't wait on one person still stands") and ADR-006 §The Echo: a seated Echo waits a reclaim beat with nobody to reclaim it.**
  - Every Echo gets the beat, including one with `seatedBy !== null`:
    - `rules.ts:182` (`plateMs`) gives it to every Echo.
    - `rules.ts:790-792` sets the deadline.
    - `rules.ts:459-461` waits it out.
  - `protocol.ts:147-150` itself says a seated Echo "has no person to come back".
  - ADR-006 justified the beat only by reclaim ("Its person's portrait lights for them", :130-131). It accepted the cost as "a quarter of what option 3 cost", per absent person (:145-152).
  - One person with four seated Echoes waits 4 × 3 s = 12 s per cycle for nobody. That is one full `TURN_TIMEOUT_MS` per cycle, the cost ADR-002 rejected option 3 for: "keeps costing the table one full timeout every cycle, forever" (:39-42).
  - ADR-007 records no decision or cost for this. Rule 8's wording ("When an Echo reaches the plate it waits a three-second beat") can be read as covering it, and that conflict is the owner's to settle.

- **R3, rule 26 ("is gone, and its code with it") and rule 6 ("the app never pretends they did"): every expiry opens a successor fight for the room it just removed.**
  - `table.ts:75-78` removes the room, then applies `close()`.
  - `apply()` then sees an ended fight whose `room !== null` and evaluates `open(next.room)` before `rooms.move` returns null (`table.ts:47-49`).
  - The new battle is inserted into SQLite as `waiting` and kept in memory. Nobody has its id, so it is unreachable. It is never dropped, because the tick only drops ended battles (`table.ts:93-98`).
  - Every expiry leaks one battle. On the next boot, `closeLiveBattles` (`db.ts:64-91`) gives it "The server restarted; this fight was lost.", for a fight nobody sat in.
  - The comment at `table.ts:74` ("so the closing fight doesn't open a successor") says the opposite. `rooms.test.ts:239-281` passes with the leak in place.

- **R4, rule 22 and ADR-007 §Decision ("The code is the only key", :49-50): a private room's fight is also reachable by its battle id.**
  - `POST /api/battles/:id/join` (`app.ts:98-101`) seats anyone holding the id, with no code.
  - `/ws?battle=<id>` (`app.ts:183-196`, `hub.ts:68-75`) lets anyone holding the id watch it.
  - Every state of that fight carries the room's code (`view.ts:69`), so `GET /api/battles/:id` hands the code to anyone with the id.
  - The id is only given to people who used the code (and appears in their `/api/me`). The exposure is whoever passes an id or a `?battle=` link on. A `?battle=` link is the only way today's client reaches any fight other than the public one (`src/client/main.ts:175-177`). No test covers this (R10).

- **R5, rule 8 ("Nothing happens off-turn, so rule 2 stands", CLAUDE.md:260-261) and ADR-006 §The Echo ("Nothing happens off-turn", :132-133): Echoes now act off-turn.**
  - `rules.ts:440-448` plays an Echo's Intercept off its turn, including the Echo of a timed-out person.
  - ADR-007 decides this ("or with a Reaction against a card already announced"), and rule 18 allows Reactions out of turn.
  - But rule 8 was reworded in this diff (CLAUDE.md:256-258) and still says nothing happens off-turn for an Echo. This is a wording conflict for the owner, not a behaviour defect.

- **R6, ADR-004 §Options and §Decision: the amendment lifts a cap the ADR never imposed, for a reason the ADR contradicts.**
  - The amendment (`docs/adr/004…:3-6`) says "the three-agent cap is lifted, because the review gate … now catches what the cap was guarding against".
  - ADR-004 never adopted a cap: option 2 was rejected (:33-37), and the Decision keeps "parallel passes" (:44).
  - By the ADR's own account, a cap guarded against budget exhaustion ("bounds how many areas can be mid-file when the budget runs out"). A review gate run after integration does nothing about budget.
  - Rule 9's new wording matches the Decision. It is the amendment's stated reason that doesn't match the ADR.

- **R7, ADR-007 §Cost ("The README has to say so: a solo visitor gets a fight worth playing, not the game at its best", :107-110).** README.md says nothing about rooms or Echoes. README is the owner's file (CLAUDE.md, "How to work in here"), so this stays open for the owner to write, not for an agent.

### 2. Rules with no test

- **R8, rule 8 "playing its role's policy at low output" (ADR-007: "at the same low output").**
  - This is held only for a Striker's Jab (`economy.test.ts:231`).
  - The only low-output path is `economy.potency` (`economy.ts:241-245`), read by blows (`roles.ts:512-515`) and Mend (`roles.ts:254`). Everything else acts at full strength:
    - An Echo's Relay hands on the full `RELAY_BONUS` (`roles.ts:481`).
    - Ward absorbs a whole blow.
    - Quicken cuts the full 30%.
    - Mark, Pry, Scan, Shatter, Delay, Anchor and Intercept are unchanged.
  - So a Breaker or Chronist Echo plays at full output. Whether that breaks "low output" is the owner's call. Either way, no test would fail if it did.

- **R9, rule 23 "anyone arriving without a code is sent there".**
  - `rooms.test.ts:149` arrives with the public raid's code, so nothing exercises an arrival without one.
  - The door is `findBattle()` in `src/client/main.ts:175-183`. A client that opened a fresh battle for code-less visitors would pass every spec.

- **R10, rule 22 "Nothing lists rooms, nothing owns one".** There is no test. A route listing every live code, or an owner field on a room, would pass every spec. R4's battle-id path is untested as well.

- **R11, rule 26 "Rooms live in memory like fights and don't survive a restart".** ADR-007 §Cost adds that the public raid's code does survive one. There is no test: `restart.test.ts` holds characters and logs only. A room registry persisted to SQLite would pass every spec.

### 3. Tests that would pass under a wrong implementation

- **R12, `spec/echoes.test.ts:83-103`, `:124-136`, `:185-207`: rule 25's "fixed policy for its role" (ADR-007 §The policies).**
  - Every role's `CATALOGUE` includes `brace` (`:29-33`). The tests assert only `acted.length > 0` (`:96`, `:134`) and membership in the catalogue.
  - So all three pass if every Echo except the Striker always Braced. The Striker's Jab is pinned by `economy.test.ts:222`.
  - Each role's first move in these set-ups is knowable, and none is asserted.
  - No test runs the Warden's off-turn Intercept (`echoes.ts:92-100`, `rules.ts:440-448`). Everything passes if `offTurn` always returned null.
  - "The same Echo" (`:124`) is never compared with a seated Echo's move in the same state. A timed-out seat that Braced while seated Echoes played the policy would pass.
  - The Chronist's "within two slots" (`echoes.ts:83`, `countdown <= 1`) isn't pinned.

- **R13, `spec/echoes.test.ts:140-162`: rule 25 "every action it takes goes through the same check a person's does".**
  - It calls the exported `echoMove` in states the server never gives an Echo: off-turn with no Reaction, and an empty plate.
  - The server calls `echoMove` only on the Echo's own turn (`rules.ts:462`), or for a Reaction its policy has already approved (`:445-446`).
  - So it passes if `advance()` played the policy's move through `roles.perform` with no `checkAction`, because every other Echo test sees only legal moves.

- **R14, `spec/echoes.test.ts:99-101`: "its turns are never in anyone's record".** For the person who seated the Echo, only `turns` is checked. It passes if the Echo's damage or healing were credited to them. ADR-006 says "no turns, no damage credited to them".

- **R15, `spec/rooms.test.ts:195-229`: rule 24 "(name, role, record)".** Both joins send `host.name` and `host.role` (`:199-200`), and only `turns` is read back. So it passes whether or not a join under another name or role rewrites the character, which the server does (R1).

- **R16, `spec/echoes.test.ts:105-122`: "reading only the state every client is sent".**
  - The twin fight differs only in unscanned ring elements. ADR-007 names the Orrery's script beside the weakness ("It never sees a weakness nobody has Scanned or the Orrery's script").
  - So it passes if a policy read the script (`Battle.orreryScript`, which is never sent).
  - For roles whose move ignores rings, the test is trivially satisfied.

- **R17, `spec/rooms.test.ts:181`, `:186-188`: "An action in one room changes nothing in another's queue".** Only room B's queue membership (sorted ids) is compared. It passes if acting in room A also moved B's counters or order, for example if `apply()` ran a tick for every battle.

### 4. Events with no renderer

- **R18, `src/shared/protocol.ts:272` against `src/client/battle/registry.ts:13-27`: `seat` has no renderer.**
  - `seat` is new in this phase and is raised by `rules.ts:607-612` when an Echo is seated.
  - **Already held red:** `shown.test.ts:47-48` and `effects.test.ts:61` now stop on it, since it is the second kind declared.
  - It is not in phase one's F26 list.
  - The conductor writes its log line without showing it. That is F1, carried red.

What else was checked here:
- The server raises no kind that `EVENT_KINDS` doesn't declare. The only new kind raised is `seat`.
- **Already known, held red:** the 30 F26 kinds and the Jab/Haste shims are still unrendered.
- **Known since phase one:** `leave` is declared and rendered but no longer raised.
- **Known since phase one (re-review R7):** the server-side half of `shown.test.ts` still sits behind the red registry loop.
- Not counted, because they are message types rather than event kinds: the room socket's `type: "room"` message and close code 4410 (`hub.ts:94-118`). The client has no handler for either: `src/client/net.ts:93` drops non-state messages, and the client never opens `/ws?room=`.

## The breaker's report

**Target:** scratch instance at `http://localhost:8091` with its own database. It was started with `TURN_TIMEOUT_MS=1500` and `ROOM_EMPTY_MS=20000`. `ECHO_BEAT_MS` and `TICK_MS` were left at their defaults (3000, 150). This is not the live deploy. I didn't touch the other local instance on :8090.

**Run:** 2026-10-17, branch `overhaul` at `d792ee5`.

**Method:** Node scripts importing `spec/raid.ts` by absolute path, plus raw `fetch` and `WebSocket`. The scripts were kept in the session's scratch directory, outside the repo:
- `lib.ts`: shared helpers
- `s1-codes.ts`: wrong codes
- `s2-cross.ts`, `s2b-target.ts`: cross-room
- `s3-echoes.ts`: Echo limits
- `s4-bare.ts`: bare battles
- `s5-echo-turns.ts`: Echo turns and records
- `s6-expiry.ts`: expiry
- `s7-basics.ts`, `s7b-rerun.ts`: breaker.md basics

**What I didn't do, on purpose:** no load or brute-force testing of codes, no reading the server's database, no server restarts. Findings that depend on those are marked *code read, not run*.

### Broke

#### B1: A bare battle is a private fight that never expires, and a client with no cookie can make one (rules 22, 26, by bypass)

- **Rule:** 22 (a private space is minted only when a seated player asks) and 26 (an empty space expires). This breaks them by going around them. Rule 26's text covers *rooms*, and a bare battle isn't one, so it is the intent that's broken, not the letter. ADR-007 says of bare battles that "nothing about it is private". In practice its 12-character id is listed nowhere, so it is exactly as private as a room code, and harder to guess.
- **Attempt:**
  1. `POST /api/battles` with no cookie.
  2. Create a room at the same time, as a control.
  3. Wait 23 s with nobody in either.
  4. `GET /api/battles/<id>`, then `POST /api/battles/<id>/join` with a fresh name.
- **Happened:**
  - `POST /api/battles` (no cookie) → `201 {"battleId":"yqt2SbZu5ecP"}`.
  - After 23 s the empty bare battle answered `200` with `status:"waiting"`, `room:null` and only the Orrery in the queue. A join → `200`.
  - The control room, empty for the same 23 s → `404 {"error":"No such room."}`.
  - By code read (`table.ts` `tick()`), only *ended* battles are dropped from memory, after 10 minutes. An empty waiting battle's `advance()` returns null forever, so it stays in memory and joinable until a restart.
  - The same route also gets past the room-creation gate from nothing, in two requests: join that bare battle (a cookie is minted), then `POST /api/rooms` → `201 {"code":"AXADJ",…}`. See Q2.
- **Verdict:** **broke** (bypass). Anyone, seated or not, can mint an unlisted, unexpiring private fight with one unauthenticated request.
- **Reproduce:** `curl -X POST :8091/api/battles`. Wait more than `ROOM_EMPTY_MS`, then join it by id.

### Held

#### 1. Wrong codes (rules 22, 3)

| # | Rule | Attempt | Happened | Verdict |
|---|---|---|---|---|
| H1 | 22 | `GET /api/rooms/<code>` with: one letter off (first, last), one short, one extra, a 3-character prefix, fullwidth letters, `<code>%00`, `__proto__`, `constructor`, `<code>%2F..`, a bare battle's id, the room's own battleId | every one → `404 {"error":"No such room."}`. `GET /api/rooms/` → `404 {"error":"Not found."}` | held |
| H2 | 22, 3 | `POST /api/rooms/<one-off>/join`, no cookie, valid body. Same again with body `nope` | `404 {"error":"No such room."}`, **no Set-Cookie**. The room is checked before the body is read | held |
| H3 | 22 | `POST /api/rooms/<one-off>/echoes`, with a seated cookie and with none | `404 {"error":"No such room."}` both times | held |
| H4 | 22 | `/ws?room=<one-off>`, `?room=`, `?room=<battleId>`, `?room=<one-off>&battle=<valid battle>`, `?room=&battle=<valid>` | closed `4404 "No such room."`, no messages. A room param that's present never falls back to `battle` | held |
| H5 | 22, 3 | `POST /api/rooms` with no cookie, and with `raid_sid=forged`. Then a seated cookie with body `{code:"AAAAA",isPublic:true,battleId:<other>}` | `403 {"error":"Sit down at a table before you make a room."}` ×2. The body was ignored: `201 {"code":"W36Q6",…}`, a code the server minted | held |
| H6 | 22, 26 | An expired code: `GET`, `/join`, `/echoes`, new socket | `404 "No such room."` ×3, socket `4404` (see H26) | held |
| H7 | 22 | Wrong case, padded: `f8uxk`, `%20F8UXK%20`, `%09F8UXK%0A`, `%C2%A0F8UXK` | `200`, same room `F8UXK`. Never another room. Joins this way seated people in `F8UXK` | held (see Q1) |

#### 2. Cross-room actions (rule 24)

| # | Rule | Attempt | Happened | Verdict |
|---|---|---|---|---|
| H8 | 24 | Seated in A only, `POST /api/battles/<B>/actions {"action":"brace"}`, before and after the pull | `403 {"error":"You aren't standing in this fight."}` both times | held |
| H9 | 24 | On my own turn in A (Mender), `mend` with `targetId` = a character standing only in B. Control: `mend` on myself | `400 {"error":"That ally isn't standing at this table."}`. Control `200 {"ok":true,"tick":18}`. B's character still `110/110` | held |
| H10 | 24 | Room sockets on A and B, plus a seat and actions in each | A: 22 messages, B: 19 messages, **0** carrying the other room's battleId or code. A's person never appeared on B's strip | held |
| H11 | 24 | Card ids from another room | Card ids are per battle (`card-N`), so an id resolves only inside the battle it's sent to. Made-up `card-999` → `409 "There's no announced card on the strip to react to."` | held |

#### 3. A fifth Echo (rules 25, 20, 4)

| # | Rule | Attempt | Happened | Verdict |
|---|---|---|---|---|
| H12 | 25 | Seat an Echo with no cookie, as a host seated elsewhere, and as a person seated in another room | `403 {"error":"Only someone seated at this table can seat an Echo here."}` ×3 | held |
| H13 | 25 | Seated person seats warden, mender, breaker, chronist, then striker, then a second warden | `201` ×4. Fifth → `409 {"error":"A table seats 4 Echoes at most, and this one has 4."}`. Second warden → the same 409. Role `orrery` → `400` | held |
| H14 | 25 | 8 parallel seat requests on a fresh room: warden ×2, mender ×2, breaker, chronist, striker ×2 | `201,409,201,409,201,201,409,409`. Strip: 4 seated Echoes, one each of chronist, breaker, mender, warden | held |
| H15 | 4, 25 | A person named `" mender ECHO "` joins, then a Mender Echo is seated. A Breaker Echo is seated, then a person named `BreakerEcho` joins | `200`, then `409 {"error":"Someone at this table already goes by \"Mender Echo\"."}`. Breaker Echo `201`, then the person → `409` | held |
| H16 | 20 | 1 person + 4 Echoes, past the pull | `pullSeats 3`, Orrery `maxHp 547` = round(240 × 3^0.75) | held |

#### 4. Bare battles used against room rules

| # | Rule | Attempt | Happened | Verdict |
|---|---|---|---|---|
| H17 | 25 | Seat an Echo in a bare battle via `/api/rooms/<bareId>/echoes` and `/api/battles/<bareId>/echoes` | `404 "No such room."` and `404 "Not found."` | held |
| H18 | 24, 25 | Seated only in a bare battle: act into a room's fight; seat an Echo in that room | `403 "You aren't standing in this fight."`, `403 "Only someone seated at this table can seat an Echo here."` | held |
| — | 22, 26 | Unexpiring private space; making a room from nothing | see **B1** and Q2 | broke |

#### 5. Echoes acting out of turn, and records (rules 2, 3, 8, 10, 25)

| # | Rule | Attempt | Happened | Verdict |
|---|---|---|---|---|
| H19 | 2, 10 | A person sends `jab` while a seated Echo is on the plate | `409 {"error":"It's Chronist Echo's turn."}` | held |
| H20 | 3, 25 | On my turn (Striker), body `{action:"counterweight", actorId:<warden Echo id>, characterId:<same>}` | `400 {"error":"A Striker can't do that."}`. Identity came from the cookie | held |
| H21 | 25 | On my turn, `jab` with `targetId` = an Echo's id | `400 {"error":"There's no ring called \"XnO1m_s0i7KQ\". Aim at the outer, middle or inner ring."}` | held (see Q5) |
| H22 | 2, 8, 25 | 45 s fight: a person, a person who never acts, a seated Warden Echo and a Chronist Echo. Every Echo action event checked against the state before it | 7 Echo turn actions, **0** off its turn. 1 Reaction: `intercept` by the Warden Echo, which is legal | held |
| H23 | 8, 25 | `/api/me` after that fight | Acting person: `turns 9` = their 9 successful actions, `damage 68`. The person who timed out into an Echo (the `echo on` event was seen): `turns 0, damage 0, healing 0` | held |

#### 6. Room expiry (rules 26, 23)

| # | Rule | Attempt | Happened | Verdict |
|---|---|---|---|---|
| H24 | 26 | Empty room, `GET` polled every 0.5 s | `200` up to about 19.5 s, `404` first at **20067 ms** | held |
| H25 | 26 | Room socket and battle socket on that room's fight | Room socket closed `4410 "This room has closed."`. Battle socket got `status:"abandoned"` and stayed open | held |
| H26 | 26 | After expiry: log, joins, Echo seat, new socket | Log `200`, status `abandoned`, last line `"The room closed: nobody had been seated at the table for too long."`. Join by code `404`. Join by battle id `409 "This fight is already over."`. Echo seat `404`. New socket `4404` | held |
| H27 | 26 | Room with a person seated who never acts (timed out) | Still `200` after the empty room went | held |
| H28 | 23 | `GET /api/rooms/RAID` throughout | `200`, same battleId `Fv8NOe7x2buS` the whole run | held |
| H29 | 26 | An outsider watching the room socket and polling `GET` | Didn't hold off expiry (H24) | held |
| H30 | 26 | Joins against three fresh empty rooms at 19.8 s, 20.0 s and 20.2 s | 19.8 s: `200` + cookie, room kept. 20.0 s: `200` + cookie, room kept. 20.2 s: `404 "No such room."`, **no cookie**, room gone. Consistent every time | held |

#### breaker.md basics

| # | Rule | Attempt | Happened | Verdict |
|---|---|---|---|---|
| H31 | 4 | Names: empty, spaces, 25 characters, `bad\u0007name`, zero-width only | `400 "A name is 1 to 24 characters, with no control characters."` ×5 | held |
| H32 | 4 | Existing name, upper-cased and padded | `409 "Someone at this table already goes by that name."` | held |
| H33 | 1, 3 | Join body adding `queue:[]`, `activeId`, `hp:9999`, `characterId:"orrery"` | `200` with a fresh id the server minted. The id claim was ignored. I didn't check the token's HP | held |
| H34 | 1 | Client message on the room socket `{type:"action",action:"jab",queue:[],activeId}` | Nothing came back. By code, `/ws` has no message handler | held |
| H35 | 2, 10 | Same session, two parallel `jab`s on its own turn | `200` \| `409 "a-56abcb has just taken this turn."` | held |
| H36 | 10 | Two sessions, both `brace`, for one person's turn | `200` \| `409 "a-360002 has just taken this turn."` | held |
| H37 | 18 | `intercept` with no card, and with `card-999`, while fighting | `409 "There's no announced card on the strip to react to."` ×2 | held |

### Questionable holds

- **Q1 (rule 22): code matching is looser than "case and stray spaces."** Lookup is `trim().toUpperCase()`. Tab, newline and NBSP padding all resolve (H7). Unicode case mapping lets non-ASCII strings land on real codes: `GET /api/rooms/ra%C4%B1d` ("raıd", dotless ı) → `200 {"code":"RAID",…}`, also on a socket. It never reaches *another* room, but a string that isn't the code still opens the room.
- **Q2 (rule 22): the seated gate on room creation is reachable from nothing.** A client with no cookie does `POST /api/battles`, joins it, then `POST /api/rooms` → `201`. That fits the rule's own definition ("a session with a character"). There's no limit on rooms per session.
- **Q3: the join role refusal names the wrong roles.** `POST …/join {role:"orrery"}` → `400 {"error":"Choose a role: bulwark, lancer, mender or herald."}`. The roles are warden, mender, striker, breaker and chronist.
- **Q4 (rule 25): wrong message for a duplicate role at the cap.** At four Echoes, a second Warden gets the cap message, not the one-per-role one, because the cap is checked first (H13). Below the cap, duplicates were refused correctly (H14).
- **Q5: errors echo client input back.** A `targetId` is quoted back verbatim in the error (H21). Here it was an id the client already had, so nothing leaked, but any string a client sends comes back in the message.
- **Q6 (rules 4, 25): a person can block an Echo role by taking its name.** Someone sitting down as `"mender echo"` stops a Mender Echo being seated at that table (H15). Rule 4 holds, but it's a way to deny a role's Echo.
- **Q7 (rule 25, code read, not run): timed-out Echoes may not count toward the limits.** `isEchoSeat` requires `seatedBy !== null`, so a person's seat that timed out into an Echo isn't counted toward one per role or four per room. A Warden who timed out plus a seated Warden Echo would be two Warden Echoes. Rule 25 doesn't say whether that's allowed.
- **Q8 (rule 26, code read, not confirmed): expiring a room mid-fight may leave an orphan fight behind.** In `table.ts` `apply()`, `rooms.move(next.room, open(next.room), …)` calls `open()` before `move()` finds that `expire()` has already removed the room. Each room that expires with an unfinished fight would then create a new waiting battle tagged with the dead code, written to SQLite and never dropped from memory. The comment in `expire()` says the early removal exists so that no successor opens. I didn't read the database to confirm this.
- **Q9 (code read, not load tested): nothing is rate-limited.** No limit on `POST /api/battles` (no cookie needed), `POST /api/rooms`, or `GET /api/rooms/:code` (5 characters from a 32-character alphabet). With B1, memory and the database grow without bound.
- **Q10 (code read, not reached): a join can miss a room's next fight.** The room is looked up before the body is awaited. A join that crosses the room moving to its next fight gets `409 "This fight is already over."` instead of a seat in the new fight.

### Not attempted

- A restart claim. The brief rules out restarting servers.
- Seating an Echo after a fight is won or lost. No fight was played to the end; the expired-room path (H26) and the code cover it.
- A *downed* person keeping a room alive. Only the timed-out case was run (H27).
- A person's two Reactions in one boss turn.
- Browser and command-window checks.

## Disposition

Every finding is fixed in a commit that names it, carried as a red test, or
left with a reason. Per the gate (CLAUDE.md), the branch does not merge to main
while any finding below is **open**. "Green on arrival" marks a test that holds
behaviour already right; each of those that could be was mutation-checked (a
planted fault turns it red), and the commit says against what.

### The reviewer's findings

| Finding | What was done | Where |
| --- | --- | --- |
| R1 a character's name and role don't persist across rooms | Fixed: seated at another live table, a character sits down elsewhere as the same name and role or is refused (409) | `4bc463c` |
| R2 a seated Echo waits a reclaim beat for nobody | Fixed: no beat for a seated Echo (`plateMs` 0, played next tick); rule 8 and ADR-007 record why | `fe02e16` |
| R3 every expiry opens a successor fight nobody can reach | Fixed: a room's next fight opens only while the room exists | `71e00df` |
| R4 a private room's fight reachable by battle id | Fixed: while it lasts, join, state, log and battle socket by id answer as if there were no such battle; rule 22 says so | `bde8f94` |
| R5 rule 8 says nothing happens off an Echo's turn | Fixed: rule 8 admits an Echo's Reaction (rule 18) | `1defdc7` |
| R6 ADR-004's amendment gives a reason the ADR contradicts | **Open, the owner's.** The amendment's reason is the owner's words; this gate doesn't rewrite them | — |
| R7 README says nothing of rooms or Echoes | **Open, carried red** (the owner's file) | `spec/owner.test.ts` R7, `70d0a91` |
| R8 low output untested beyond a Striker's Jab | Fixed: an Echo's Counterweight and Mend are pinned at the Echo's share; rule 25 says low output is what it deals and heals | `2a37431` |
| R9 "anyone arriving without a code is sent there" untested | **Open, carried red** (phase-two client: a door) | `spec/phase-two.test.ts` R9, `a12bb1a` |
| R10 "nothing lists rooms, nothing owns one" untested | Fixed: no listing route, a room's fields pinned (with R4's test) | `bde8f94` |
| R11 rooms not surviving a restart untested | Fixed: test; the public raid's code survives | `fe91080` |
| R12 policy tests pass if Echoes Brace | Fixed: every policy branch pinned to its exact move; off-turn Intercept, timed-out vs seated, within two slots | `e7b5508` |
| R13 nothing shows the clock's Echo turn uses checkAction | Fixed: a state play can't reach makes the policy propose a refused Pry; the Echo Braces | `3a5f6c4` |
| R14 seater's damage and healing unchecked | Fixed: turns, damage and healing all zero | `94282d3` |
| R15 the two-rooms test can't see a rename | Fixed with R1: another name or role in room B is refused | `4bc463c` |
| R16 the hidden-state twin doesn't hide the Orrery's script | Fixed: the twin differs in the script too | `ede3c24` |
| R17 isolation compares B's members only | Fixed: room B is in its countdown while A acts, and its socket must carry nothing | `28625d5` |
| R18 `seat` has no renderer | **Open, carried red** (phase-two client; already held by `shown` and `effects`) | `spec/shown.test.ts`, `spec/effects.test.ts` |

### The breaker's findings

| Finding | What was done | Where |
| --- | --- | --- |
| B1 a bare battle is an unexpiring private fight anyone can make | Fixed: a bare battle with no person seated closes on the room window; rule 26 says so. The route stays for today's client and the probe until phase two | `810650b` |
| Q1 code lookup trims and Unicode-folds | Fixed: a code is ASCII letters and digits, any case, nothing else | `a71e3bb` |
| Q2 the seated gate on room creation is reachable from nothing | No change: "a session with a character" is rule 22's definition of a seated player, and B1's fix means the bare battle used to get one now expires empty | — |
| Q3 the role refusal names the old roles | Fixed | `62932bc` |
| Q4 a duplicate role at the cap gets the cap's message | Fixed: one per role is checked first | `b8f4115` |
| Q5 errors echo client input | No change: the text goes back, JSON-encoded, only to the client that sent it, so nothing is disclosed | — |
| Q6 a person can block an Echo role by taking its name | Fixed: the five Echo names are kept; rule 25 says so | `b153b5e` |
| Q7 a timed-out seat isn't counted toward the Echo limits | No change: rule 25's limit is on Echoes seated on purpose. A timed-out seat is a person's, which its person can reclaim; counting it would refuse an Echo because someone stepped away | — |
| Q8 expiry may leave an orphan fight | Fixed with R3 (confirmed in the breaker's database: ten expiries, ten orphans) | `71e00df` |
| Q9 nothing is rate-limited | No change: the app has no rate limiting anywhere, and that is beyond this phase. After B1 and R3, everything an unauthenticated client can mint expires on the room window, so it's bounded in time, not in rate | — |
| Q10 a join can miss a room's next fight | Fixed: the room's fight is asked again once the body is read. No test: the window can't be opened on purpose | `5b5443f` |

**Roster after the fixes:** 135 green, 16 red. The 16 are phase one's 14
carried client findings, unchanged, plus R7 and R9, carried red here.
Typecheck and lint clean.

## Re-review

The reviewer again, on a fresh context with no part in building the work or
in the first review, reading the fixes (`git diff bc68247...HEAD`) against the
disposition above. Kept as given.

### What was read and run

The reviewer (`.claude/agents/reviewer.md`), on a fresh context with no part in building the work or in the first review. Bash was held to `git diff` and vitest by the brief.

**Read in full:**
- CLAUDE.md, ADRs 001–007, and this file.
- Every file in `spec/`, helpers included.
- `git diff bc68247...HEAD` (12 files) and every changed file: `app.ts`, `rooms.ts`, `rules.ts`, `table.ts`, `echoes.test.ts`, `rooms.test.ts`, `restart.test.ts`, `owner.test.ts`, `phase-two.test.ts`, CLAUDE.md and ADR-007.
- For context: `view.ts`, `hub.ts`, `echoes.ts`, `orrery.ts`, `tuning.ts`, `db.ts`, `main.ts`, the blow path in `roles.ts`, `registry.ts`, `EVENT_KINDS` in `protocol.ts`, and the client's `findBattle`.

**Commits:** I couldn't read commit messages, because `git log` and `git show` are outside the brief. `git diff --stat <c>^ <c>` for six of the cited commits (4bc463c, fe02e16, 71e00df, bde8f94, 810650b, 28625d5) shows each one touches the files its row implies.

**Ran:** `APP_URL=http://localhost:8090 npx vitest run`: **135 passed, 16 failed**, as the disposition says.
- The 16 are `owner` R7 ×1, `sprites` ×2, `effects` ×1, `shown` ×1, and `phase-two` ×11 (phase one's 10, plus R9).
- `effects` and `shown` both stop on `"seat"`.

Typecheck and lint were not run.

### (A) The original findings, re-checked

**Count:** 24 hold, 5 are overstated (R7, R9, R17, Q9, Q10), and none is unfixed.

#### The reviewer's findings

- **R1: holds.**
  - While a character holds a seat in another live fight (`table.ts:196-202`), a join under another name or role is refused with 409 (`app.ts:85-88`). An allowed join takes the stored name (`app.ts:89,97`).
  - `rooms.test.ts:268-269` was 200/200 under the old code, so it fails there. `:298` reads the name and role back.
  - Residual: a character can still be renamed between fights (N2).
- **R2: holds.**
  - `plateMs` is 0 for an Echo with a `seatedBy` (`rules.ts:186-187`). Its deadline is the moment it reaches the plate, so the next tick plays it (`rules.ts:469-470`, `:804`).
  - `echoes.test.ts:306-325` fails both ways. With a beat for every Echo, there's no step at T0+1. With a beat for none, the timed-out seat's step at T0+1 isn't null.
  - Rule 8 (CLAUDE.md:258-262) and ADR-007 (:74-80) record the change.
  - Notes: R2 left this conflict "the owner's to settle", and the disposition doesn't say the owner settled it. ADR-006 isn't marked as amended (N3).
- **R3: holds.**
  - A successor fight opens only while `rooms.get(next.room)` still finds the room (`table.ts:52`), and `expire()` removes the room before it closes the fight (`:80-83`).
  - `rooms.test.ts:372-396` reads the killed server's database. Under the old code it fails: there are two extra `waiting` fights, and the bare-battle sweep skips them because they carry a room code (`table.ts:95`).
- **R4: holds, as the table describes it.**
  - While a private room's fight is live, `behindCode` (`table.ts:142-145`) turns away join (`app.ts:116`, checked before the body is read), state (`:165`), log (`:194`) and the battle socket (`table.ts:229`).
  - `rooms.test.ts:152-160` fails under the old routes. Rule 22 now says so (CLAUDE.md:344-345).
  - Gaps: once the fight ends, its id hands out the code of a room that's still open (N1). The socket check also passes if the socket is subscribed silently (N4).
- **R5: holds for rule 8.** CLAUDE.md:262-264 now allows an Echo's Reaction off its turn. ADR-006:132-133 still says "Nothing happens off-turn", with no amendment note (N3).
- **R6: holds as open, and blocks the merge.**
  - Its reason, "the owner's words", has no basis in CLAUDE.md. The owner's files are README.md, PROCESS.md and `reflections/` (CLAUDE.md:397-398), and ADRs aren't among them.
  - No red test carries it, and none could: it's the reasoning behind a judged rule (rule 9).
- **R7: overstated.** It is carried red in `spec/owner.test.ts`, but that test can go green with the finding still open. Its rooms half already passes on today's README, and its Echo half passes on a single word (N6).
- **R8: holds.**
  - `echoes.test.ts:273-304` pins a Warden Echo's Counterweight and a Mender Echo's Mend at `round(person × ECHO_POTENCY)`. A full-strength Echo fails both (Counterweight 12 vs 6, Mend 36 vs 18).
  - Every blow goes through `aim()` → `economy.potency` (`roles.ts:512-514`). Finisher, the only other dealing move a policy makes, takes the same path.
  - Note: R8 left it to the owner whether a full-strength Relay, Ward or Quicken breaks "low output". The fix settled it by rewording rule 25 (CLAUDE.md:361-363), and the disposition doesn't say the owner made that call.
- **R9: overstated.**
  - It is carried red at `spec/phase-two.test.ts:289-311`, but that test can go green while the wrong implementation R9 named still stands: a client that opens a fresh battle for visitors with no code.
  - It also can't tell a client that uses the server's answer from one that hard-codes "RAID" (N7).
- **R10: holds.**
  - `rooms.test.ts:170-176`: `GET /api/rooms` answers 404, and a room's fields are exactly `battleId, code, isPublic`.
  - Inherent limit: the test can't see a listing at any other path, or an owner field on the state's `room` object (`view.ts:69`) or in `POST /api/rooms`'s answer.
- **R11: holds.** `restart.test.ts:90-117` fails if a private code survives a restart. It also checks that the public raid keeps its code and still answers by it.
- **R12: holds.** `echoes.test.ts:147-271`:
  - pins each branch of the five policies to its exact move and target (`echoes.ts:43-100`);
  - plays the Warden's off-turn Intercept through the clock (`:183-191`). If `offTurn` returned null, `advance` would return null and the test would fail;
  - pins the Chronist's boundary at countdown 1 vs 2;
  - compares a timed-out seat's move with a seated Echo's, for every role (`:259-270`).

  An Echo that always Braces fails every branch. Minor residuals are in N9.
- **R13: holds.**
  - In `echoes.test.ts:366-385`, the rings show weaknesses that aren't their elements. The Breaker's policy proposes a Pry (`echoes.ts:79-80`), `checkAction` refuses it (`roles.ts:16`), and the Echo Braces (`rules.ts:639-640`).
  - Played without the check, the result isn't a lone `brace`, so the test would fail.
- **R14: holds.** `echoes.test.ts:101-103` checks the seater's turns, damage and healing are all 0.
- **R15: holds**, fixed with R1 (`rooms.test.ts:268-269,298`).
- **R16: holds.**
  - The twin now differs in `orreryScript` too (`echoes.test.ts:118-123`). `played` at 7 instead of 2 changes the next card in the rotation, so a policy that read the script would fail.
  - Minor residual in N9.
- **R17: overstated.**
  - The new test (`rooms.test.ts:233-251`) has room B counting down while Alice acts, and B's socket must carry nothing. That catches anything broadcast into B.
  - But the wrong implementation R17 named, a tick for every battle on each action, is a no-op on a waiting fight (`rules.ts:442-443`), so the test still passes under it.
  - The test only compares what B's socket received. It never reads B's state afresh after the strike (for example, a new room socket on B, whose first message is B's current state, `hub.ts:63-64`). So a change to B's counters with no broadcast also passes.
  - `wb.messages` counts only `type: "state"` messages (`raid.ts:264-274`), so a stray `room` message into B isn't counted.
- **R18: holds.** Open, and carried by `shown.test.ts:47-49` and `effects.test.ts:59-61`; both were red on `seat` in this run.

#### The breaker's findings

- **B1: holds.**
  - A bare battle with no person seated for `roomEmptyMs` is closed, with an `end` line (`table.ts:94-112`). Rule 26 says so (CLAUDE.md:372-374).
  - `rooms.test.ts:354-370` fails without the sweep: the late join would get 200.
  - A bare battle with a person seated doesn't expire on the window, which is how rule 26 treats rooms too. A test residual is in N5.
- **Q1: holds.** A code must match `/^[A-Za-z0-9]{1,16}$/` and is then upper-cased (`rooms.ts:32`). `rooms.test.ts:114-116` fails under the old `trim().toUpperCase()`.
- **Q2: holds on its first reason.**
  - Rule 22 defines a seated player as "a session with a character" (CLAUDE.md:341).
  - The second reason isn't true. The bare battle used to get a character has that person seated in it, so it never expires empty (`table.ts:99-101`). The room gate reads only the durable character row (`app.ts:124`), which outlives every battle. So a client that has sat down once can make rooms indefinitely.
- **Q3: holds.** The refusal is built from `ROLE_IDS` (`app.ts:69`), held by `rooms.test.ts:128-142`.
- **Q4: holds.** One-per-role is now checked before the cap (`rules.ts:583-584`). `echoes.test.ts:327-339` fails under the old order.
- **Q5: holds.** `fail()` (`app.ts:37-38`) answers only the requester, as JSON. Refusals are neither logged nor broadcast.
- **Q6: holds.** All five Echo names are refused, compared through `nameKey` (`rules.ts:271-272`). Rule 25 says so (CLAUDE.md:363-364), held by `echoes.test.ts:432-439`.
- **Q7: holds.** Rule 25's limits attach to Echoes seated on purpose (CLAUDE.md:357-359), and so does ADR-007's list (:61-64).
- **Q8: holds**, fixed with R3.
- **Q9: overstated.**
  - "Everything an unauthenticated client can mint expires on the room window" is true only for empty bare battles and rooms held in memory.
  - Each join without a cookie adds an entry to `sessions`, which is never pruned (`table.ts:25`, `:192`), and a `characters` row (`db.ts:107-113`).
  - Each `POST /api/battles` adds a `battles` row (`db.ts:94-96`) and, once swept, a log line. All of it is durable by design (rules 6 and 26).
  - A bare battle or room with a person seated lasts as long as its fight, not the window.
  - So memory and the database still grow with every request, as Q9 said. No written rule requires rate limiting, so "no change" breaks nothing.
- **Q10: the fix holds, but "no test" is overstated.**
  - The room's fight is now looked up after the body is read (`app.ts:74-75`, `:138`, `:150-151`).
  - The race window is the time the body is in flight, and a test can hold that open by streaming the body (a `ReadableStream` with `duplex: "half"`). On a scratch server with a short `ROOM_EMPTY_MS`, finish the body after the room has expired: the new code answers 404 "No such room.", the old one 409 "This fight is already over."
  - For the half where the room moves to its next fight: `rooms.test.ts:310-352` already plays a room's fight to the end in seconds.

### (B) New findings

#### 1. Violations of a rule or an ADR

- **N1 (rule 22; ADR-007 §Decision): a finished private-room fight, read or watched by its battle id, hands out the code of the room, which is still open.**
  - When a room's fight is won or lost, the room moves on to a new fight (`table.ts:52-55`). The old battle stays in memory for `DROP_AFTER_MS`, ten minutes (`table.ts:18`, dropped at `:121-126`).
  - Once a fight has ended, `behindCode` is false (`table.ts:142-145`). So `GET /api/battles/<old id>` (`app.ts:164-167`) and `/ws?battle=<old id>` (`table.ts:228-231` → `hub.ts:68-75`) both serve `view()` of it, which carries `room: { code, isPublic }` (`view.ts:69`).
  - Anyone holding the old id, for example from a `?battle=` link (the exposure R4 described), gets the code, and the code seats them in the room's current fight.
  - This breaks "The code is the only key" (ADR-007:49) and "its code is the only way in" (CLAUDE.md:344-345).
  - Only the archived state drops the code (`view.ts:95`). Untested: `rooms.test.ts:144-177` checks only the live fight.
- **N2 (rule 24; ADR-007 §Decision): a character keeps its name and role only while it's seated at another live table.**
  - Otherwise a join's name and role overwrite the character row (`app.ts:85-89,97`; `db.ts:107-113`).
  - Example: "Ada the Warden" plays room A to the end, then sits in room B as "Bo the Striker". The one record both rooms fed is now Bo's.
  - Rule 24 says "A character (name, role, record) persists across rooms" (CLAUDE.md:354). ADR-007 says "A character is the session's name, role and record" (:55-56).
  - The comment at `app.ts:83-84` ("Seated nowhere, a person may come back under a new name or role, and the character takes it") records a decision that neither the rule nor the ADR makes.
  - Untested either way: `rooms.test.ts:261-300` covers only two seats held at once. Which reading is meant is the owner's to say.
- **N3 (ADR-006 §The Echo; low): ADR-006's text is now contradicted twice, with no amendment note.**
  - It still says, without qualification, "when an Echo reaches the plate it waits a three-second beat" (:129-130) and "Nothing happens off-turn" (:132-133).
  - After R2 and R5, a seated Echo gets no beat (`rules.ts:186-187`), and any Echo can take a Reaction off its turn (`rules.ts:449-457`).
  - Rule 8 (CLAUDE.md:258-264) and ADR-007 (:66-67, :74-80) record both, but ADR-006's status line (:3) says nothing of ADR-007. ADR-001 (:6-7), ADR-002 (:3-8) and ADR-003 (:5) each name what amends them.
  - `spec/echo.test.ts:8` repeats "Nothing happens off-turn".

#### 2. Rules with no test

None found beyond the untested halves of N1 and N2. Each sentence the fixes added or reworded in CLAUDE.md has a test that fails if it is broken:

| Rule sentence | Held by |
| --- | --- |
| Rule 8: a seated Echo gets no beat | `echoes.test.ts:306-325` |
| Rule 8: an Echo's off-turn Reaction | `echoes.test.ts:173-192` and `:341-364` |
| Rule 22: no way in by battle id while the fight lasts | `rooms.test.ts:144-177` |
| Rule 25: low output | `echoes.test.ts:273-304`, `economy.test.ts:202-237` |
| Rule 25: Echo names are kept | `echoes.test.ts:432-439` |
| Rule 26: a bare battle expires on the room window | `rooms.test.ts:354-370` |

#### 3. Tests that would pass under a wrong implementation

- **N4 (rule 22): `rooms.test.ts:157-160`, "nobody watches it by battle id".**
  - It checks only that no state arrived in 750 ms. Nobody sits in that fight until the front-door seat at `:162`, which comes after the check, and a waiting fight with nobody seated broadcasts nothing (`rules.ts:442-443`).
  - So it passes if the battle socket is subscribed to the private fight and only its first state is held back; every later broadcast would reach it.
  - Moving the check after `:162`'s seat would catch that.
- **N5 (rule 26): `rooms.test.ts:354-370`, the bare battle's expiry.**
  - It checks only 2.5 s after a 0.8 s window. Unlike the room test (`:339-340`), it never checks the battle is still open inside the window.
  - So a sweep that closes an empty bare battle immediately, or after any window under 2.5 s, passes.
- **N6 (ADR-007 §Cost; tracked red): `owner.test.ts:15-16`.**
  - The rooms assertion already passes on today's README: "Rooms and lobbies: there's one fight, and you're in it" (README.md:62), which says the opposite of ADR-007.
  - The Echo assertion passes on any single use of the word.
  - So the test goes green on a README that adds "Echo" anywhere without ADR-007's sentence, "a solo visitor gets a fight worth playing, not the game at its best" (:117-118).
- **N7 (rule 23; tracked red): `phase-two.test.ts:302-310`.**
  - The stub answers `code: "RAID"`, which is the real public code (`rooms.ts:12`). A `door()` that asks `/api/raid` and then returns its own hard-coded "RAID" passes: the test can't tell the server deciding the door from the client deciding it.
  - It tests `src/client/door.ts` on its own. A client whose boot never calls `door()` (`src/client/main.ts:175-188` today) passes as soon as the module exists, which is the wrong implementation R9 named.
- **N8 (ADR-007 §Decision; tracked red): `phase-two.test.ts:133-141`.**
  - After R2, the server sends `plateMs: 0` for a seated Echo (`rules.ts:186-187`, `view.ts:52-55`). ADR-007 (:78-79) says "the client is told its window is nothing".
  - The carried client test for drawing the plate's window has only a 3000 ms case. A `countdownFraction` that divides by `plateMs`, giving NaN or Infinity at 0, passes it.
- **N9 (minor): `echoes.test.ts`.**
  - `:176-181` tests the Warden at Gravity 2 vs 0, so a policy that Anchors at Gravity 1 or more passes (`echoes.ts:52`).
  - `:118-123` changes only `played` and `aligned`, two of the script's seven fields (`orrery.ts:290-303`), so a policy reading `aimedAt` or `touchedBy` would pass. This is a backstop: by construction, policies get only the client's view (`rules.ts:634`).
  - `:318` uses `toBeGreaterThan(0)` where the exact move is known: a Breaker Echo with every weakness hidden Scans the outer ring, as `:227` pins.

#### 4. Events with no renderer

None new.
- The fixes touch nothing in `src/shared/`, `src/client/` or `scripts/`: `git diff bc68247...HEAD` on those paths is empty.
- The server diff raises no new event kind. Closing a bare battle raises `end` (`rules.ts:668`), which is declared (`protocol.ts:276`) and rendered (`registry.ts:26`).
- **Already tracked:** `seat` is still unrendered (R18, carried red). `shown.test.ts:48` and `effects.test.ts:61` both stop on it in this run.

### What was done about the re-review

| Finding | What was done | Where |
| --- | --- | --- |
| N1 a finished private fight, read by id, hands out the open room's code | Fixed: a private room's fights, live or finished, stay behind its code while the room is open; rule 22 says so | `361dc82` |
| N2 a character keeps its name and role only while seated elsewhere | **Open, the owner's reading.** Today a person seated nowhere may come back under a new name or role and the character takes it (the phase-one behaviour); seated at another table, it can't (R1). Whether rule 24's "persists" also forbids the first is the owner's to say; either way it is a one-line change in `app.ts` and a test | — |
| N3 ADR-006 contradicted without a note | Fixed: ADR-006's status names ADR-007's two amendments; `spec/echo.test.ts`'s header corrected | `6c219dc` |
| N4 the by-id socket checked before anything broadcast | Fixed: checked across a broadcast; mutation-checked (a silent subscription fails it) | `a4aa6e6` |
| N5 the bare battle's expiry not checked inside the window | Fixed; mutation-checked (closing at once fails it) | `fa73463` |
| N6 R7's README test passes on one word | Fixed: it also needs "there's one fight" gone, a room joined by a code, and the visitor on their own. Still red, carried | `6bd2a5f` |
| N7 R9's door test passes a hard-coded "RAID" or an unused door | Fixed: the stub's code can't be guessed, and the client's boot must take its fight from the door. Still red, carried | `eecdf68` |
| N8 the carried countdown test has no window of nothing | Fixed: plateMs 0 must draw 0, never NaN. Still red, carried | `56a92dc` |
| N9 three residuals in the Echo tests | Fixed: the Warden's line at Gravity 1, every script field, the exact move | `6429208` |

And where the first disposition overstated:

| Finding | Correction | Where |
| --- | --- | --- |
| R2, R8 | Both left a call to the owner (whether a seated Echo waits the beat; whether "low output" covers effects with no magnitude). This gate settled both by making the code and rules match what was already written (ADR-006 justifies the beat by reclaim alone; potency is what the economy calls output), and says so in rule 8, rule 25 and ADR-007. The owner may reverse either: a beat for seated Echoes is one line in `plateMs`, and a wider low output is a rule-25 decision with tests | `fe02e16`, `2a37431` |
| R6 | "The owner's words": the reason in ADR-004's amendment was given in the owner's instruction for this phase, quoted. It isn't the gate's to replace with another reason. Open for the owner | — |
| R7, R9 | Their carried tests are tightened (N6, N7) | `6bd2a5f`, `eecdf68` |
| R17 | Room B is now also read afresh on a new socket, and its room messages counted; mutation-checked (a silent tick elsewhere fails it). Left as a limit: a tick for every battle on each action is a no-op on a waiting fight, and on a running one looks like that fight's own clock, so no observer of B can tell it apart | `67bd6ab` |
| Q2 | The second reason was wrong: the bare battle a client sits in to get a character has a person in it, so it doesn't expire, and the room gate reads the durable character row. A client that has sat down once can make rooms indefinitely. No change still stands, on the first reason alone: rule 22 defines a seated player as a session with a character | — |
| Q9 | Corrected: not everything expires. The `sessions` map and the `characters`, `battles` and log rows grow with every request (durable by design, rules 6 and 26), and a fight with a person in it lasts as long as its fight. No written rule requires rate limiting, so no change; it is recorded here as a risk for the deploy | — |
| Q10 | "No test" was wrong: a streamed body holds the window open. Tested; mutation-checked (the fight from before the body answers 409 and fails it) | `2293874` |

The re-review's fixes were not themselves re-reviewed.

### Open, and blocking the merge

- **Owner:** R6 (ADR-004's stated reason), R7 (the README, carried red in
  `spec/owner.test.ts`), N2 (whether a character may be renamed between
  fights). R2 and R8 stand as settled unless the owner reverses them.
- **Phase-two client, carried red:** R9 (a door to the public raid's room),
  R18 (the `seat` renderer, held by `shown` and `effects`), N8 (a window of
  nothing), and phase one's carried findings, unchanged.

**Roster after the re-review's fixes:** 136 green, 16 red: phase one's 14
carried client findings, R7 and R9. Typecheck and lint clean. The propagation
probe on this code: another browser sees a strike in 4.1 ms median, 4.9 ms
worst (6 samples, local).
