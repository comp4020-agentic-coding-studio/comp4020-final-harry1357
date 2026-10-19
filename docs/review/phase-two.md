# Review gate: phase two (the client)

The review gate (CLAUDE.md, "How to work in here") on branch `overhaul`,
after phase two's integration and its VERIFY fixes (HEAD `9b7ef0b`). Two
agents, each on a fresh context with no part in building the work:

- The **reviewer** (`.claude/agents/reviewer.md`) read phase two's diff,
  `git diff b1ea0d3...HEAD`, against CLAUDE.md, every ADR and every spec.
  `b1ea0d3` is the tip before phase two. It also checked every finding the
  two earlier reviews carried into this phase.
- The **breaker** (`.claude/agents/breaker.md`) attacked a running scratch
  instance through the API, the WebSocket and real headless Chrome. It also
  attacked the client's new surfaces: the room door, the seat list,
  Reactions off-turn, the ghost preview (it must come from the server,
  never the client's own guess), and the end-of-fight panel.

Run on 2026-10-19 and 2026-10-20. As in the earlier gates, neither agent type
is registered in this session. Each was run as a general agent following its
file's instructions verbatim, and the reviewer's read-only Bash (`git diff`
and the test runner) was imposed in its brief. The two instances:

- the reviewer ran the roster against a scratch instance of HEAD on `:8090`;
- the breaker attacked its own scratch instance on `:8091`, with
  `TURN_TIMEOUT_MS=1500` and `ROOM_EMPTY_MS=20000`, never the live deploy.

The owner added three findings from play to the open list (P1 to P3, below).
The reports are kept as the agents gave them; what was done about each
finding follows, in "Disposition".

## The reviewer's report

### Summary

I read phase two as `git diff b1ea0d3...HEAD` (70 files, at 9b7ef0b) against CLAUDE.md, ADRs 001–007 and `spec/`, and checked every finding the two earlier reviews carried into this phase. Findings: **6 rule or ADR violations, 3 rules with no test, 11 tests that would pass under a wrong implementation, and none found for events with no renderer.** The two most serious:

- After any refused action the client keeps your turn dark. Phase two's command window makes refusals easy to hit, so a turn can be lost to the timeout (rule 2, and through it rule 8).
- The client works out for itself which boss card a Bastion will blunt, and gets it wrong for Alignment cards.

Of the carried findings, every client finding is closed in code. Several of the tests that claim to close them would still pass under a wrong implementation (F25, phase-one R1, F7, phase-one-b R9). Phase-one-b R7 (the README) is still open and still red. I cannot approve; what follows is what I found.

### What was read and run

**Read in full:**
- `.claude/agents/reviewer.md`, CLAUDE.md, ADRs 001–007, `docs/review/phase-one.md`, `docs/review/phase-one-b.md`.
- Changed and new spec files: `phase-two`, `effects`, `shown`, `sprites`, `bastion`, `cards`, `preview`, `ending`, `engine.ts`, `contrast`; `rooms` (its diff, plus lines 1–135).
- Unchanged spec files read for context: `strip-order`, `command`, `owner`, `queue`, `design`, `gates`, `spec/README.md`.
- Client source: `registry.ts`, `api.ts`, `conductor.ts`, `effects/{feel,command,strip,kit,party,orrery,table}.ts`, `main.ts`, `command/window.ts`, `command/seat.ts`, `strip/strip.ts`, `strip/cards.ts`, `join/join.ts`, `seats/seats.ts`, `scene/scene.ts`, `scene/party.ts`, `scene/marks.ts`, `src/assets/sprites.json`.
- Server and shared source: `app.ts`, `view.ts`, `rules.ts`, `roles.ts`, `economy.ts`, `orrery.ts`, `tuning.ts`, `src/shared/protocol.ts`.

**Read as diffs only:**
- `door.ts`, `net.ts`, `scene/orrery.ts`, `plate.ts`, `fx.ts`, `scripts/check-tags.ts`, `scripts/assets/roles.ts`, CREDITS.md.
- CSS: the colour hunks of `scene.css`, and all of `join.css`, `seats.css`, `stage.css` and `mobile.css`.

**Not read line by line:**
- `strip.css` and `command.css`. I checked them mechanically instead: no added selector that doesn't begin with `#battle`, no `backdrop-filter`, and the only hex in the phase's CSS is in `scene.css`.
- `scene/glyphs.ts`, `strip/pixels.ts`.
- The unchanged spec files `actions`, `assets`, `boot`, `browser`, `echo`, `echoes`, `economy`, `global-setup`, `harness`, `invariants`, `orrery`, `pacing`, `pull`, `raid`, `restart`, `served-css` and `two-at-once`.

**Tooling:**
- This session had no Grep or Glob tool. To list and search files I used `git diff --name-only` (with `-G`) against the empty tree `4b825dc`.
- Deviation from the brief: some `git diff` and `vitest` output was piped through `grep`, `head`, `sed` or `tail`, and commands began with `cd`. All of it was read-only. No file was written.

**Ran:**
- `git diff --stat b1ea0d3...HEAD`, and per-file `git diff`.
- `APP_URL=http://localhost:8090 npx vitest run`: 28 files, 175 tests. **174 passed, 1 failed**: `spec/owner.test.ts` R7, which fails on README.md:78, "Rooms and lobbies: there's one fight". Every phase-two target is green, including the Chrome half of `shown`.
- `APP_URL=http://localhost:8090 pnpm check`: typecheck and stylelint passed (the `&&` chain reached vitest); vitest gave the same 174/1, so the command exited non-zero.

**Could not check:** commit order. Without `git log` I can't tell whether CREDITS.md rows landed before the chronist art (rule 12), or whether the `shown.test.ts` change was made in its own commit (CLAUDE.md:404-406).

### 1. Violations of a rule or an ADR

**R1 — Rule 2: "The client decides nothing about when either is available" (CLAUDE.md:229).** Rule 8 suffers through it.
- What happens: `src/client/main.ts:146` turns the command window off on every choice. On a refusal, `:152` only announces the error. The window comes back only in `onState`. While a person is on the plate the server broadcasts nothing (`src/server/rules.ts:477-481` returns null; `table.ts` `tick()` broadcasts only a step). So after a 409 the turn stays dark while the server still says it's yours, until the 12 s timeout Braces for them. Three of these in a row make them an Echo.
- Why phase two makes it easy to reach:
  - `window.ts:554` offers Quicken the allies list, and `main.ts:100-106` puts yourself first. "Quicken, Enter, Enter" quickens yourself, which `src/server/roles.ts:597` refuses.
  - `window.ts:552` offers Anchor every card, and the first is usually a raid-wide Revolution, which `roles.ts:586` refuses.
- Status: the `setEnabled(false)` line predates this phase, but these target lists are new in it.

**R2 — CLAUDE.md:299-300: "The server holds every one of them; the client draws them and decides none."** Also ADR-006 §Cost: "If a rule can't be read off the strip, it isn't finished".
- What the server does: it sends only `bastion: boolean` (`view.ts:133`).
- What the client does: it decides which card a standing Bastion meets (`src/client/strip/cards.ts:149-151`, the first card with `targetId === "party"`). It also decides which card a Bastion raised now would meet first (`cards.ts:145`), which `main.ts:126-133` turns into the Warden's prompt.
- Where it's wrong: an Alignment card is `targetId: "party"` (`src/server/orrery.ts:360-361`), but only a Revolution or Perihelion spends a Bastion (`orrery.ts:387`, `:399`, `:527-537`; header `:65-66`, "The Alignment's wipe ignores it"). So in phase III every screen marks an Alignment "Bastion stands", and the Warden is told "The Alignment, next, would take one raised now". A frozen raid-wide card at countdown 0 is marked in place of the one that actually resolves.
- The pattern it breaks: rule 1 has the server compute the preview, and rule 2 has it name `reactionCard`. Bastion's card is the same kind of decision, left to the client.

**R3 — Rule 22: "…or when someone asks with a name and a role, which seats them in it as its first seat" (CLAUDE.md:344-346).**
- `src/server/app.ts:142` mints the room before `seatIn` runs its checks: name for life (`:94-96`), seated elsewhere (`:97-99`), `checkJoin` (`:101-103`).
- A refused founder therefore leaves a minted room with no seat in it. Anyone with no cookie can do this, for example with the name "Mender Echo", which is kept for the Echo (`rules.ts:271-272`): the room is made, then the request gets 409. The room lives until `ROOM_EMPTY_MS`.

**R4 — ADR-007 §Decision: "Any seated player can create one: a session that has sat down and so has a character" (docs/adr/007:45-46).**
- Rule 22 now also admits a newcomer with a name and a role (CLAUDE.md:344-346; `app.ts:133-146`). ADR-007 has no amendment or status note saying so.
- Phase-one-b N3 required exactly such a note for ADR-006. Low.

**R5 — Rule 11: "the client writes an event's log line only once its renderer has shown it" (CLAUDE.md:287-288).**
- In `src/client/battle/conductor.ts:71-75` a renderer that throws, or runs past `CAP_MS` (2.4 s, `:14`, `:57-59`), still falls through to writing its log line (`:81-85`).
- This predates the phase, inside the function phase two rewrote. Low: `stage()` fences most throws.

**R6 — Design gate: "never a seventh hex" (CLAUDE.md:130); "Healing is `--card`… not a seventh colour" (CLAUDE.md:142-143).** This is a judged gate. Low.
- `src/client/styles/scene.css:17` makes a cyan, `color-mix(in oklch longer hue, ember, brass)`, which its own comment gives as "rgb(0 166 174)". It is mixed from the tokens as the gate's letter asks, but it is a seventh colour by intent.
- `scene.css:274` adds a literal `#000` in a mask.
- Stale comments that contradict the design: `src/client/battle/api.ts:29` ("heal: green") and `effects/party.ts:203` ("no state the client is sent marks it", untrue now that `bastion` is sent).

### 2. Rules with no test

**U1 — Rule 1's new sentence: "The ghost… is the server's preview (`state.preview`), drawn and never computed" (CLAUDE.md:216-217).**
- Nothing on the client side checks it. `strip.ts:617-626` and `:665-681` do use `preview.slot`, but a strip that sorted counters to place the ghost would pass every spec.
- jsdom could hold it: give `preview()` a slot that disagrees with the counters and check where the ghost lands.

**U2 — Rule 2's new clause: "only against the card the server names (the token's `reactionCard`)" (CLAUDE.md:226-227).**
- `phase-two.test.ts:210-272` hands the window a card id directly.
- Nothing checks that `main.ts:188` passes `token.reactionCard`. A `main.ts` that picked the card from `state.cards` itself passes.

**U3 — Contrast gate: "When the palette changes, that test's pairs change with it" (CLAUDE.md:59-62).**
- New text inks have no pair in `spec/contrast.test.ts:71-88`:
  - `--tone-shield` and `--tone-gold` damage numbers on the field (`scene.css:680-686`);
  - `--brass-lit` on ink, for the room code (`seats.css`, `.seats-code`) and Echo plate tags.
- By my arithmetic the cyan clears about 6.5:1 on `--void`, so this is untested rather than failing. Low.

### 3. Tests that would pass under a wrong implementation

**T1 — `spec/effects.test.ts:153-180` with `EXPECTED_STATE` (F25's closure).**
- The expected states are declared by the code under test (`effects/feel.ts:38-78`, `effects/strip.ts:259-296`, `effects/command.ts:88-101`). Only `hold` is pinned independently (`phase-two.test.ts:291`).
- `resolveArg` (`effects.test.ts:116-122`) can't refer to any event field except actor, target, card and ring. So the fields that carry each event's meaning are wildcards, and each of these passes:
  - `alignmentReduced` always calling `strip.alignment(0, true)`, drawing a wipe every time (`strip.ts:295`);
  - `chain` always drawing a broken Chain (`:262`);
  - `retrograde` always drawn flipped (`:294`);
  - `echoReduced` always marking the seat an Echo, even when the event says its person is back (`command.ts:97`; the sample only sends `on: true`, `effects.test.ts:79`);
  - `endReduced` calling `scene.banner(null)`, which clears the banner (`feel.ts:44`);
  - raid-wide blows flashing only one target, or the Orrery (`feel.ts:20-25`).
- Full variants are never checked at all.

**T2 — `spec/bastion.test.ts:76-86`.**
- It pins the client's own choice of card ("The server spends it on the soonest blow on everyone"), so it requires the client to decide, and it can't tell that from the server deciding.
- It uses only Revolution, Eclipse and Perihelion, so it passes with R2's Alignment and frozen-card errors in place.

**T3 — `spec/preview.test.ts:30-37`.**
- It checks only `brace`, `jab` and `cleave`, for a Striker.
- It passes with the Chronist's Haste preview wrong. Haste's default target is the actor (`roles.ts:663`). `view.ts:53` reads `hasteLeft` before Haste sets it (`roles.ts:477`), but the real reset reads it after (`rules.ts:685`). So the ghost shows double the wait.
- Also, `:80-91` has a single eligible card, so a `reactionCard` naming any eligible card, not the soonest (`view.ts:23-38`), passes.

**T4 — `spec/shown.test.ts:192-200`.**
- B's screen is now timed from B's receipt of the message, with a 1 s ceiling from the strike. A server that held the strike's broadcast about 800 ms now passes.
- `queue.test.ts:106` bounds ticks, not wall time, so nothing else bounds server-to-screen latency at one tick.
- Rule 11's spec line still says "the strike shows within one tick" (CLAUDE.md:289), unchanged. The test states its reason.

**T5 — `phase-two.test.ts:148-160` (phase-one R1, a spent card).**
- It runs only the reduced variants (`:157`).
- A full `strike()` that drew the bolt, the hurt frame and a number on the fallen sprite passes. That was R1's original fault.

**T6 — `phase-two.test.ts:185-208` (F7, Anchor).**
- It gives the window one eligible card.
- It passes with the window offering raid-wide cards first for Anchor, and nothing tests the refusal-then-dark path (R1).

**T7 — `phase-two.test.ts:320-322` (phase-one-b R9, the door).**
- The boot check is a regex on an import line.
- A `main.ts` that imports `door` only for `publicRaid()` but boots a fresh battle for visitors with no code passes. That is R9's named wrong implementation.

**T8 — `spec/rooms.test.ts:122-127`.**
- "Refused, and makes no room" asserts only the 400, which `app.ts:140-141` returns before any room is made.
- It passes with R3's mint-then-refuse path, and never checks that no room was made.

**T9 — `spec/sprites.test.ts:41-54`.**
- With `src/client/sprites.ts` deleted it checks nothing: a renderer borrowing another event's animation anywhere else passes.
- The new silhouette test (`:56-105`) is real.

**T10 — `phase-two.test.ts:91-96` (F2).**
- It reads only `data-*` attributes. A card whose visible face shows no target or countdown passes. Low.

**T11 — `scripts/check-tags.ts:117-119` (off the roster).**
- It skips any element of 1×1 px or less. A visible name collapsed to 1×1 by a layout fault is skipped too.
- The self-test plants no such case. It should key on the visually-hidden clip, not the size. Low.

### 4. Events with no renderer

**None found.** What I checked:
- All 44 `EVENT_KINDS` (`protocol.ts:297-346`) are in `OWNERS` exactly once (`registry.ts:19-30`), and the three areas' renderer keys are disjoint and match it (`feel.ts:81-111`, `strip.ts:242-256`, `command.ts:84-87`).
- `shown.test.ts:37-50` and both effects tests are green.
- Server-raised kinds, read in `rules.ts`, `economy.ts`, `roles.ts` and `orrery.ts`, are all declared. `db.ts`'s `kind: "system"` is a log-entry kind, and `hub.ts` raises `type:` messages.
- `room` messages and close codes 4410/4404 are now handled (`net.ts` `watchRoom`).
- Known since phase one: `leave` is declared and rendered but no longer raised.
- Not a finding: nothing enforces `OWNERS`, so a duplicate key across areas would silently override another's renderer.

### The findings carried in from the earlier reviews

**From phase one:**

| Finding | Closed? | Would its test pass a wrong implementation? |
| --- | --- | --- |
| F1: log line for an unrendered event | Yes (`conductor.ts:76-80`) | Covers the missing-renderer case only. A renderer that throws or overruns the cap still gets its line (R5). |
| F2 / phase-one R9: boss cards with intent, target, countdown | Yes (`cards.ts:188-271`) | Yes for the visible face (T10). |
| F6: the hold renderer drops the Brace | Yes, guard up and seat dimmed (`command.ts:19-45`) | Rejects guard-down. Covers the reduced variant only; the full variant is unchecked. |
| R5: drifting and Echo drawn from state | Yes on the strip (`strip.ts:307-310`) and the scene (`scene.ts:102-107`, reconcile) | The test covers the strip only. The scene's persistent marks are untested. |
| R8: the countdown against `plateMs` | Yes (`window.ts:62-66`; `main.ts:194`, `:371`) | A unit test. A `main.ts` dividing by `turnMs` passes. |
| Re-review R1: a spent card drawn as a hit | Yes in both variants (`effects/orrery.ts:39-44`, `:63-72`) | Yes, full variant (T5). |
| F7: card actions sent ally ids; Reactions unsendable off-turn | Yes at the window (`window.ts:546-555`, `:725-735`; `main.ts:108`, `:188`) | Wiring untested (U2); Anchor with several cards (T6). The new target lists cause R1. |
| F25: an expected state per event | In form | Yes (T1). |
| F26: thirty events unrendered | Yes, 44 of 44 | No. |
| The shims (two roles shared a sprite; Jab and Haste borrowed animations) | Yes: `sprites.ts` deleted, chronist sheet added, silhouette test | The shim tests are vacuous now (T9); the silhouette test isn't. |

**From phase one-b:**

| Finding | Closed? | Would its test pass a wrong implementation? |
| --- | --- | --- |
| R7: the README says nothing of rooms or Echoes | **No.** Still red (`owner.test.ts:19`; README.md:78). The owner's file; blocks the merge. | — |
| R9: a door to the public raid | Yes (`door.ts`; `main.ts:359`) | Yes (T7). |
| R18: the `seat` renderer | Yes (`effects/table.ts:36-52`) | Its expected state is self-declared (T1). |
| N8: a seated Echo's window of nothing | Yes (`window.ts:64`; no beat drawn at `plateMs` 0, `strip.ts:568`) | No; the test is adequate. |

**The owner's decisions:** R6 and N2 were decided in phase one-b and nothing here reopens them. R2 and R8 still stand: phase two changes neither `plateMs` nor `ECHO_POTENCY` (it only moves `ECHO_MAX` into `protocol.ts:116`).

**Stale comment:** the header of `spec/phase-two.test.ts:5-9` still calls every test "red on purpose", but all are green now.

## The breaker's report

**Target:** `APP_URL=http://localhost:8091`, the scratch instance (TURN_TIMEOUT_MS=1500, ROOM_EMPTY_MS=20000, tick 150 ms, Echo beat 3000 ms). I didn't start, stop or restart anything, and I didn't touch :8090 or :8095. The repo is unchanged (`git status` is clean). Scratch scripts and the long-probe log are in `/private/tmp/claude-501/-Users-twoauthentic-comp4020-comp4020-final-harry1357/a57bd467-2042-4c7e-a995-7733e2edcf53/scratchpad/brk/`. Files `a*.ts` drive the API, `b*.ts` drive headless Chrome through `spec/browser.ts`, `long.ts` writes `long.out`, and `rx.js`/`mon.js` are the in-page probes.

**Summary:** 3 broke (B1–B3). 26 groups of attempts held (H1–H26). 10 questionable (Q1–Q10). A few rules weren't reachable from outside, listed at the end.

---

### Broke

#### B1. Rule 2 (as reworded) and rule 18: the server accepts a Reaction at a card it didn't name
- **Attempt:**
  - Private room with four people: Warden W2 (founder), Warden W1, a Mender and a Chronist.
  - Everyone Braces on their turn. The Chronist Delays the soonest single-target card for its first few turns, which puts two single-target cards on the strip at once.
  - In one state, W2's token had `reactionReady: true` and `reactionCard: "card-3"`. The strip held `card-3` (eclipse, countdown 0), `card-1` (perihelion) and `card-7` (eclipse, countdown 1). Both eclipses were aimed at a standing ally other than W2.
  - With W2's cookie I sent `POST /api/battles/<id>/actions {"action":"intercept","targetId":"card-7"}`.
- **Happened:**
  - Answer: `200 {"ok":true,"tick":84}`.
  - The state just before the Reaction landed (v115) still named `card-3` for W2.
  - The broadcast that carried the Reaction has `reaction` with `cardId: "card-7"`, and card-7 was retargeted onto W2.
  - A second Intercept in the same boss turn was refused: `409 "You've used your Reaction; it comes back after the Orrery's next turn."`
- **Verdict: broke.** Rule 2 says a Reaction is live "only against the card the server names (the token's `reactionCard`)". The server took one against a different card that was on the strip.
  - The once-per-boss-turn half of rule 18 held.
  - The page never offers card-7 (see H23), so this is reachable only through the API or the console.
- **Reproduce:** run `a4b.ts` from the scratch folder. It's deterministic on this build: card-3 is named, card-7 is fired at, tick 84.

#### B2. Rule 22: the page turns Unicode look-alike codes into real room codes and seats you there
- **Attempt:**
  - (a) Open `/?room=raıd` (dotless i, U+0131).
  - (b) Make a room whose code is `Z7ZSC`, then open `/?room=Z7ZſC` (long s, U+017F).
  - (c) In `form[data-join]`, choose the code door and type `raıd`, then `Z7ZſC`.
- **Happened:**
  - The server refuses both codes: `GET /api/rooms/ra%C4%B1d` and `GET /api/rooms/Z7Z%C5%BFC` both answer `404 {"error":"No such room."}`.
  - (a) The page set `#battle[data-room]="RAID"`, opened `/ws?room=RAID` and showed the public raid's join form.
  - (b) The page opened `/ws?room=Z7ZSC` and showed that private room.
  - (c) The form sent `POST /api/rooms/RAID/join` and `POST /api/rooms/Z7ZSC/join`. Both answered 200, and the person sat down in those rooms. The address became `/` and `/?room=Z7ZSC`.
  - Full-width `ＲＡＩＤ` was refused correctly: the form refused it, and through `?room=` the page got 4404 and showed "No such room".
- **Verdict: broke.** "A wrong code is refused (404), never guessed at or redirected to another room." The server already guards against exactly this (the comment in rooms.ts cites breaker Q1), and the client undoes the guard.
  - From reading the code: `src/client/door.ts` does `given.toUpperCase()`.
  - `src/client/join/join.ts` upper-cases the code field on input, and `chosenDoor()` runs `.trim().toUpperCase()` before the `/^[A-Z0-9]{4,8}$/` check.
  - JavaScript's full Unicode case mapping turns ı into I, ſ into S, and the ligatures ﬀ, ﬁ, ﬆ and so on into ASCII.
- **Reproduce:** run `b1.ts` (lines 5, 8 and 8b–8c of its output).

#### B3. Rule 22: a private room's finished fight becomes readable and watchable by battle id about 10 minutes after it ends, while the room is still open
- **Attempt (`long.ts`):**
  - Made private room `KBK68`; its first fight was `f6ghRGR_8o_w`. Seated four Echoes so the fight would end.
  - Rejoined the founder (same cookie, same role) into every next fight the room opened, so the room never emptied and never expired.
  - Every 30 s, probed `GET /api/rooms/KBK68`, `GET /api/battles/f6ghRGR_8o_w`, `GET /api/battles/f6ghRGR_8o_w/log` and `/ws?battle=f6ghRGR_8o_w`.
- **Happened:**
  - The first fight ended (won) at about 217 s.
  - Up to 593 s after it ended, all three by-id probes refused: 404, 404, and close 4404.
  - At 624 s, 654 s, 685 s and 716 s after it ended, the room still answered 200, but:
    - `GET /api/battles/f6ghRGR_8o_w` answered 200 (the archived state);
    - `GET .../log` answered 200 with all 280 log lines;
    - `/ws?battle=f6ghRGR_8o_w` stayed open and sent a state.
- **Verdict: broke.** "While a private room is open, its code is the only way in: none of its fights, live or finished, is joined, watched or read by battle id."
  - From reading the code: `behindCode()` in `src/server/table.ts` looks only at battles still in memory, and an ended battle leaves memory after `DROP_AFTER_MS` (10 min).
  - The store doesn't record a battle's room, so after that, `state()`, `/log` and the hub serve the fight by id. Every later fight in the room goes the same way 10 minutes after it ends.
- **Reproduce:** `long.ts` (takes about 15 min). Output is in `long.out` in the scratch folder.

---

### Held

**H1. Rule 2: acting out of turn.**
- Attempt: A sent jab while B was on the plate.
- Happened: `409 {"error":"It's Bo53e932's turn."}`. When A's turn came, the only event for A was `hold` (the timeout's auto-Brace). The refused jab never fired.
- Verdict: held.

**H2. Rules 2 and 10: acting twice in one turn.**
- Attempt: three parallel actions from A on its own turn (jab, jab, brace), then a jab right after.
- Happened: `200`, `409 "Ana38cc72 has just taken this turn."` twice, then the same 409 back to back.
- Verdict: held.

**H3. Rules 10 and 1: two clients for one turn.**
- Attempt: A's jab and B's brace sent together on B's turn; B's mend and A's jab sent together on A's turn.
- Happened:
  - B's turn: A got `409 "It's Bo53e932's turn."`, B got 200.
  - A's turn: B got `409 "It's Ana38cc72's turn."`, A got 200.
  - Two watchers on the room shared 65 versions, with 0 differences in queue or activeId.
- Verdict: held.

**H4. Rules 1 and 3: a body that claims identity or turn order.**
- Attempt: sent `queue`, `counter`, `activeId`, `hp`, `characterId`, `actorId`, `name` and `role` fields, off-turn and in other forms.
- Happened:
  - With A's cookie: `409 "It isn't your turn."`.
  - With no cookie: 403. With an invented `raid_sid`: 403.
  - A join carrying B's `characterId` minted a new character; the id was ignored.
  - An Echo request with a forged `seatedBy` and no cookie: 403.
  - JSON, junk and non-JSON sent up the socket were ignored, and the socket stayed open.
- Verdict: held.

**H5. Rule 4: duplicate names.**
- Attempt: in one room, the same name exactly, upper-cased, padded, with a trailing zero-width space, in NFKD, with soft hyphens between letters, with a leading right-to-left override, and with one full-width letter. Then the same name in another room.
- Happened: every same-room variant got `409 "Someone at this table already goes by that name."`. The other room accepted it with 200. Homoglyphs are a separate question (Q4).
- Verdict: held.

**H6. Names.**
- Attempt: empty, spaces only, 25 characters, NUL, LF, BEL, zero-width spaces only, the Hangul filler, 24 and 25 emoji, a number, null, an array, an object. Also variants of "Warden Echo" and "Mender Echo" plus a zero-width joiner.
- Happened:
  - Every bad name: `400 "A name is 1 to 24 characters, with no control characters."`.
  - 24 plain characters: 200.
  - The Echo-name variants: `409 "\"Warden Echo\" is kept for the Warden's Echo; choose another name."`.
- Verdict: held.

**H7. Roles and bodies.**
- Attempt: role `orrery`, `WARDEN`, missing, and `["warden"]`; a non-JSON body; an array body.
- Happened: every bad role got `400 "Choose a role: warden, mender, striker, breaker or chronist."`. Both bad bodies got `400 "Send a JSON object with a name and a role."`.
- Verdict: held.

**H8. Rule 24 through the API: renames and role changes.**
- Attempt: rename in your own room, in another room, through `POST /api/rooms`, and in a bare battle. Join another room with a different role, and found a room with a different role, while seated elsewhere.
- Happened:
  - Every rename: `409 "You sat down as Nia4ab87a, and a name stays with you: …"`.
  - Every role change while seated: `409 "You're seated at another table as … the Warden; sit down here as the same role, or finish that fight first."`.
  - `/api/me` still showed the same name and role.
- Verdict: held.

**H9. Rule 18 through the API: Reactions.**
- Attempt: Intercept at a raid-wide card, at `card-999`, with no target, at `orrery`, and at a character id. Mender and Chronist trying `intercept`. A second Intercept in the same boss turn. An Intercept at a card that had resolved.
- Happened:
  - Raid-wide card: `409 "Intercept answers a blow aimed at one ally; …"`.
  - `card-999`, no target, `orrery`, character id: `409 "There's no announced card on the strip to react to."`.
  - Mender and Chronist: `400 "A Mender can't do that."` (and the Chronist's equivalent).
  - Second in the same boss turn: 409 "You've used your Reaction…".
  - Resolved card: 409 "There's no announced card…".
  - Across 460 token-states, `reactionCard` was never set for anyone but a ready Warden, and always named a card the server would accept.
- Verdict: held.

**H10. Rule 25: seating Echoes.**
- Attempt: five roles in parallel; then the one role left; four parallel Warden Echoes; a request from someone seated in another room; no cookie; role `orrery`; no role; no such room; after the fight ended.
- Happened:
  - Five in parallel: `201,201,201,201,409 "A table seats 4 Echoes at most, and this one has 4."`. The missing role afterwards: the same 409.
  - Four parallel Wardens: `201,409,409,409 "There's already a Warden Echo at this table; one per role."`.
  - Seated elsewhere: 403. No cookie: 403. Bad or missing role: 400. No such room: 404.
  - After the fight ended: `403 "Only someone seated at this table can seat an Echo here."` (the room had moved on and the caller wasn't seated in the next fight).
- Verdict: held.

**H11. Rule 20: HP at the pull.**
- 1 person and 4 Echoes: `pullSeats` 3, maxHp 547 (240·3^0.75).
- 1 person and 2 Echoes: 2 seats, 404.
- An Echo seated after the pull, and a person who joined a bare battle late: maxHp and `pullSeats` unchanged.
- An Echo seat raced against the 30 s cap (sent at 29 855 ms): 201, seated before the `pull` event, and counted (3 seats, 547).
- Verdict: held.

**H12. Rules 8 and 25: Echo behaviour.**
- 80 Echo turn events over a full fight: none taken off-turn except a Reaction.
- `plateMs` was 0 for a seated Echo and 3000 for a timed-out seat's Echo.
- A person who never acted got no win credited (record stayed at 0 turns).
- 3 timeouts turned the seat into an Echo. Acting while someone else was on the plate got 409.
- A jab 0.8 s into the Echo's beat: 200, events `echo:false` then `jab`, turns 0→1.
- Verdict: held.

**H13. Rule 24: rooms are separate.**
- Someone seated only elsewhere, acting in room A: `403 "You aren't standing in this fight."`.
- A person in A mending or warding a person from room B: `400 "That ally isn't standing at this table."`.
- A legal Brace in A never appeared in B's states.
- Acting in B by its id off-turn: 409.
- A card id from B, sent in A, was refused.
- Each socket saw only its own battle id. One character with two seats had one record.
- Verdict: held.

**H14. Rules 22 and 23: the door through the API.**
- Wrong codes, padded codes, NUL, full-width, dotless i, Turkish İ, zero-width space inside, double-struck R: all `404 {"error":"No such room."}`.
- Lowercase codes: 200 (ASCII case is documented as accepted).
- `/api/rooms//join`: `404 "Not found."`.
- Socket variants: close 4404.
- A private fight by id (GET, log, join, and `/ws?battle=`): 404 or 4404 while the fight is in memory (but see B3).
- No listing route exists: `GET /api/rooms` and `GET /api/battles` answer 404.
- `/api/raid` answered code RAID.
- Verdict: held.

**H15. Rule 26: expiry.**
- An empty room's socket closed with `4410 "This room has closed."` after 20.1 s, after `state:abandoned`.
- Then GET, join and Echo requests answered 404, and the socket 4404.
- Its log stayed readable by id; joining it by id got `409 "This fight is already over."`.
- A bare battle nobody sat in was abandoned with "The fight closed: nobody had been seated at the table for too long."
- Verdict: held.

**H16. Rules 5, 15, 16, 17 and 19: write-through and the economy (bare battle, a full fight).**
- All 264 event log lines were present in `GET /log` fetched right after each broadcast.
- All 25 boss resolutions were announced in an earlier message.
- Charge never went above 3. Chain potency never went above 1.5 and reset on every boss blow.
- Every Exposed stack carried its applier. No stack was spent in this fight, so the spender half of rule 16 wasn't exercised.
- Verdict: held.

**H17. Browser, the default door.**
- `/` set `data-room` to the server's code (RAID) and opened `/ws?room=RAID`.
- The doors were raid (checked), create and code. The code row stayed hidden until the code door was chosen.
- Verdict: held.

**H18. Browser, wrong, empty, expired and junk codes.**
- A wrong code gave "There's no room with that code."; the page stayed on RAID after `POST …/ZZZZZ/join 404`.
- Empty, spaces only, `AB`, `<b>` and `ＲＡＩＤ`: the form refused them inline and sent nothing.
- An expired code through the form: the 404 message. Through `?room=`: `data-closed="missing"`, close 4404, "No such room", no retry.
- Junk in `?room=` (`<script>…`, `../api/raid`, `%00`, `RAID/join`, 200 A's, a zero-width space inside): 4404, "No such room", no other room opened, nothing executed.
- Empty `?room=` and `?room=%20%20` fell back to the server's default door.
- Verdict: held, apart from B2 and Q7.

**H19. Browser, a hard-coded raid code.**
- The served bundle contains no `RAID` literal.
- When `/api/raid` answered a private room's code, the page opened that room.
- When `/api/raid` failed three times, the page opened no room and no socket, backed off and retried, and used RAID only once the server named it.
- The raid door used from a `?room=<private>` page asked `/api/raid` again.
- Verdict: held.

**H20. Browser, rule 24 in the form.**
- A returning session saw its name fixed ("You sit down as Ret0cd23c. A name stays with you…"), the name input hidden, "Welcome back, …: 0 turns, 0 wins", and all five roles selectable.
- Renaming by unhiding the field, by changing the hidden field's value, or through the create door: 409, shown in the form. `/api/me` was unchanged.
- A different role while seated elsewhere: the 409 was shown.
- Once seated nowhere: changing role worked (200, `/api/me` role became striker); renaming still got 409.
- Minor, not a never-do rule: after a refused rename sent through the hidden field, focus moves to `<body>`, because `refuse()` focuses the hidden input.
- Verdict: held.

**H21. Browser, the seat list.**
- `[data-room-code]` showed the code. The buttons were exactly `echoRoles`.
- On a spectator page every button was disabled with a "Sit down first" title. Re-enabled and clicked, it sent a POST that got 403, and the 403 text was shown.
- Triple-clicking one button sent 1 POST. Pressing Mender and Breaker in the same task sent 1 POST.
- An Echo seated in another room never appeared in this room's list.
- At the cap: no buttons, "Echoes 4 of 4", "The table has its 4 Echoes."
- A fifth Echo fetched from the page: 409. A forged `data-add-echo` button sent nothing.
- After the fight ended there were no buttons; on the next fight they were all disabled.
- In three instrumented runs, the page never offered a role missing from the server's latest `echoRoles` (see Q10).
- Verdict: held.

**H22. Browser, the strip order.**
- 237 checks: portrait order (`[data-token-id]`) always equalled queue then fallen, and the card ids (`[data-card-id]`) always equalled `state.cards`.
- Verdict: held.

**H23. Browser, Reactions off-turn.**
- 438 off-turn checks on the Warden page and 613 on a Mender page: the live set was exactly `[intercept]` when `reactionCard` was set and empty otherwise. Two short windows where my own DOM edits were in place are excluded.
- Re-enabled disabled options, synthetic clicks, a forced Confirm, and a keyboard walk (ArrowDown, Enter, Space): no POST, except the live Reaction itself fired by Enter (200).
- The aim offered only the card the server named. ArrowDown didn't change it, and the step buttons stayed hidden.
- Firing twice at once sent 1 POST.
- An aim held open closed once its card left the strip; a forced Confirm and Enter afterwards sent nothing.
- A Mender with a forged `reactionCard` showed nothing live.
- A forged raid-wide `reactionCard` was offered and sent, and the server refused it with 409. The page draws whatever the server says.
- Verdict: held.

**H24. Browser, the ghost.**
- 112 hover and focus probes: the ghost's `data-slot` and `data-counter` always equalled `state.preview` for that action.
- 20 actions sent: the ghost's slot and counter always equalled where the server actually put the portrait.
- With the preview forged to null or to another actor: no ghost.
- In 1051 off-turn checks there was never a ghost off-turn.
- With a forged off-turn preview and a live Intercept, hover and focus drew no ghost.
- Verdict: held.

**H25. Browser, the end panel.**
- The panel stayed up while the next fight ran (checked at 3 s and 6 s). Its link was `/?room=CODE`.
- Going on prefilled the code door, and the greeting "30 turns, 1 win" matched `/api/me`. Sitting down got 200.
- While seated in room Z: going on with another role was refused (409, shown); the same role was seated (200).
- Once the room expired: `data-closed="expired"`, link `/`, and going on led to the public raid.
- A bare battle's ending linked to `/`, which led to the public raid.
- The end line was written to the DOM after its renderer showed the ending and before the next fight was drawn (see Q1).
- Verdict: held.

**H26. Rule 23: the public raid.**
- `/api/raid` always answered during the session, and anyone without a code was sent there.
- Verdict: held (never-expiring wasn't tested beyond this session's length).

---

### Questionable

**Q1. Rule 11: the last fight's end line is never visible.**
- At the end of a room's fight, the end line was appended at page time 49 010 ms and removed in the same millisecond, when the next fight's whole log replaced the log window. It was painted in 0 animation frames.
- The whole last fight's log is gone while the end panel is still up.
- The spec (`spec/ending.test.ts`) asserts this order, so by the spec it holds, but nobody can read the line. Reproduce with `b6b.ts`.

**Q2. The end panel changes to describe a fight nobody played.**
- With the panel up after a win, if the person doesn't go on, the room's empty next fight is closed as abandoned when the room expires.
- The panel's title then changes from "The Orrery grinds to a halt" to "Nobody stayed", and the log shows only "The room closed…". Seen with `b6.ts`.

**Q3. A reload drops the end panel.**
- After a reload the page shows the join form for the next fight, with no outcome.
- The finished fight also can't be read by id while the room is open (correct under rule 22, until B3 kicks in), so the result is lost.

**Q4. Rules 4 and 25: homoglyph names.**
- "Nіa4ab87a" (Cyrillic і) and "Νia4ab87a" (Greek Ν) were both seated beside "Nia4ab87a" in one room.
- "Wаrden Echo" (Cyrillic а) sat down as a person.
- "The Echo of Nia4ab87a" sat down as a person, imitating how a timed-out seat's Echo is narrated in the log.
- The letter of the rules held (trim, case, NFKC and invisibles are all folded), but the app tells people apart by name.

**Q5. Rule 22: the actions route confirms a private fight exists.**
- `POST /api/battles/<private id>/actions` answers `403 "You aren't standing in this fight."` (or 409), while an unknown id gets `404 "No such battle."`.
- GET, log, join and the socket all answer 404 for the same id.

**Q6. Rule 22: a refused founder still mints a room (from reading, not observable from outside).**
- In `POST /api/rooms` with a name and role, `table.createRoom()` runs before `seatIn()`.
- So a request refused with 409 (a rename, a role clash, or the name "Warden Echo", which needs no cookie) still mints a code. The code is never returned and lives until `ROOM_EMPTY_MS`.

**Q7. The page trims padded codes the server refuses.**
- `" JKQP3 "` in the code door and `?room=jkqp3%20` are trimmed by the client and seated in JKQP3; the server answers 404 to the padded code.
- It's a mild form of guessing, related to B2.

**Q8. Rule 24: a rename-looking field when `/api/me` fails.**
- If `/api/me` fails (503), a returning session is shown a blank name field and the newcomer tagline.
- Submitting another name is refused by the server with 409.

**Q9. A re-join with a different role is silently ignored.**
- Re-joining your own room while seated there, with a different role, answers 200 and returns the old role, with no refusal.
- The UI doesn't offer this path.

**Q10. A stale "Add an Echo" button, seen once and not reproduced.**
- In one run, a "chronist" add button stayed in the DOM for about 1 s after the state said `echoRoles: []`.
- Three instrumented reruns never showed it, so treat it as unconfirmed, possibly an artifact of my test.

---

### Not attempted

- **Rule 6, a restart claim:** this needs a server restart, which the brief forbids.
- **Rules 7, 9 and 12:** not reachable from outside.
- **Rules 13 and 14:** not derived independently. Ranks and Resonance were only seen through the server's preview matching where portraits landed.
- **`ECHO_POTENCY`:** output wasn't measured.
- **The `enter()` race:** clicking an old room's Echo buttons in the moment before the new room's first state arrives.
- **Rule 16's spender half:** not exercised (no stack was spent).

## Findings from play (the owner's)

Added to the open list by the owner, from playing phase two:

- **P1.** After sitting down, focus falls to the page body, and the commands
  are three Tabs away.
- **P2.** Restore has no list of the fallen to choose from.
- **P3.** The Echo-off strip flag reuses "restored".
