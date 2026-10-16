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
