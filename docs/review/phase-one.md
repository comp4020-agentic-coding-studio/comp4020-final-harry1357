# Review gate: phase one (the overhaul's server)

The review gate (CLAUDE.md, "How to work in here") on branch `overhaul`, after
the step-4 integration and the pull, at `0e5c564`. Two agents, each on a fresh
context with no part in building the work: the **reviewer**
(`.claude/agents/reviewer.md`), reading the diff from main against CLAUDE.md,
every ADR and every spec; and the **breaker** (`.claude/agents/breaker.md`),
attacking a running scratch instance through the API and the WebSocket.

Run on 2026-10-16. The agent files were new in this session, which can't load a
new agents directory until restart, so each was run as a general agent given its
file's instructions verbatim. The reviewer's read-only Bash, which the file's
hook enforces, was imposed in its brief instead. The breaker attacked a scratch
instance on its own database (`PORT=8091`, `TURN_TIMEOUT_MS=1500`, so Echoes
were reachable in seconds), never the live deploy.

The reports are kept as the agents gave them. What was done about each finding
follows them, in "Disposition".

## The reviewer's report

**Summary.** 10 rule or ADR violations, 4 untested rules, 11 tests that pass
under a wrong implementation, 30 unrendered events. Cannot approve, only find.

**Read and run.** CLAUDE.md in full, ADRs 001–006, `docs/design/overhaul.md`,
every file in `spec/`, every changed file in full plus the server and client
files they depend on. `pnpm check` against :8080: typecheck and stylelint
clean; vitest 6 failed, 77 passed. Red as declared targets: `sprites.test.ts`
(both), `effects.test.ts`, `shown.test.ts` (first test). Red but not declared:
`assets.test.ts` (two tests).

### 1. Violations of a rule or an ADR

- **F1, rules 11 and 21.** `src/client/battle/conductor.ts:67-74` writes an
  event's log line even when it has no renderer, so the 30 unrendered kinds
  reach the log unshown, against "the client writes an event's log line only
  once its renderer has shown it". `src/client/battle/api.ts:94` made
  `Registry` Partial, so typecheck no longer catches a missing renderer. (The
  missing renderers are tracked by the red specs; the unshown log write is not.)
- **F2, rule 19 on screen.** `src/client/strip/strip.ts:207-251` never reads
  `state.cards`, and `card` has no renderer: no boss card is drawn on any
  screen. `orrery.test.ts` passes on the engine only. (The `card` renderer is
  tracked red; the strip not drawing cards is not.)
- **F3, rule 8.** "Until the person acts again, which ends the Echo at once"
  is unreachable live. An Echo on the plate is played on the very next tick
  (`rules.ts:411-413`), so a person has about 150 ms to act, and the only
  off-turn action is a Reaction, which the client can't send:
  `main.ts:130-131` keeps the command window disabled off-turn, as rule 2
  requires. An Echo is permanent in practice.
- **F4, ADR-002 §Options 2 and §Decision.** ADR-002 rejected "act for them"
  ("the server is now making choices in someone's name, and a 'you' who
  strikes while you're away gets credited with damage you didn't choose") and
  decided a hold "chooses nothing, deals nothing". `economy.ts:135-148` deals
  and credits damage in the absent player's name (`:138`, turns at `:79`;
  wins credited to Echo seats at `rules.ts:667-672`). ADR-002 is marked
  "partly superseded by ADR-006", but ADR-006 holds no pacing decision: no
  options, no answer to those objections, no cost. `ADR-003:70-73` ("holds will
  send its absent players away") is now false.
- **F5, rule 16.** The rule requires applier and spender "both … in the state
  the client is sent". `view()` (`rules.ts:448-486`) omits `spentExposed`;
  `BattleState` (`protocol.ts:202-231`) has no such field, and `ExposedStack`
  (`protocol.ts:147-150`) carries `appliedBy` only. The spender exists only in
  the `exposed` event, which a newly connected client is never sent.
- **F6, rules 8 and 11.** "Their portrait dims (drifting)": no client code
  reads `drifting` or `echo` (`strip.ts:170-178`, `scene/scene.ts:285-306`).
  The server now Braces on a timeout (`economy.ts:109`), but the `hold`
  renderer still clears the guard (`effects/table.ts:51`, `:61`): the screen
  shows "not braced" just before logging "the table braces for them".
- **F7, ADR-006 §Decision.** "Every role gets one action that changes the turn
  strip": the Warden has none that works from the app.
  `command/window.ts:305` offers allies as targets for every card-target action,
  so Anchor, Delay and Stillpoint always send an ally id and are refused (409)
  at `roles.ts:619-624`; Intercept can't be sent at all (F3).
- **F8, rule 19.** `orrery.ts:400` (Eclipse) and `:415` (Lunge) re-aim a card
  whose target has fallen, at resolution: the blow lands on someone no card
  named, against "nothing the Orrery does arrives unannounced".
- **F9, "never commit a red state".** `assets.test.ts:42-44` and `:66-68`
  were green on main and are red now, because `ROLE_IDS` (`protocol.ts:112`)
  changed while `sprites.json` kept the old four: a broken existing claim, not
  a feature not yet built, and not declared as a target (`sprites.test.ts:5-12`
  names only itself).
- **F10, the review gate's own claim.** CLAUDE.md:329-331 says the reviewer is
  read-only, but `.claude/agents/reviewer-bash.sh:22-23` passes
  `git diff --output=<file>` and `pnpm vitest run --outputFile=<file>`, which
  write or truncate any file, `README.md` included.

### 2. Rules with no test

- **F11, rule 13.** "Haste halves the reset, never the rate": every counter
  assertion uses `"normal"` (`economy.test.ts:22`, `:34`, `:101`); all pass if
  `reset()` (`rules.ts:537-541`) ignored `hasteLeft`.
- **F12, rule 15.** "+10% potency per link" is asserted only as
  `chain.potency` in state; nothing fails if `potency()` (`economy.ts:232-236`)
  or `aim()` (`roles.ts:512-515`) never applied it to damage or healing.
- **F13, rule 14.** The "or a Broken ring" half has no test; all pass if
  `resonant()` (`roles.ts:509`) ignored `ring.broken`.
- **F14, rule 1.** Its client half is "Judged in src/client/", but could be
  held: feed `createStrip` a queue out of counter order in jsdom and assert the
  DOM order matches. Low priority.

(Rule 9 is judged, and no test can see a launch.)

### 3. Tests that would pass under a wrong implementation

- **F15, `economy.test.ts:144-150`.** The Echo test passes if an Echo's turn
  only emits `brace`, deals nothing, or deals full output: "low output" is
  never checked.
- **F16, `economy.test.ts:152-155` and `pacing.test.ts:77-97`.** Neither shows
  acting ending an Echo live: the engine test gives a turn via `plate()`, which
  the live clock never leaves open (F3); the HTTP test is named "…and ends an
  Echo" but never makes one. Both pass if Echoes are permanent.
- **F17, `economy.test.ts:80-84`.** Asserts engine-internal
  `Battle.spentExposed`, never `view()`: passes while the spender is never sent
  (F5).
- **F18, `pull.test.ts:85` and `orrery.test.ts:181`.** Pull HP is checked only
  at one seat (where base × 1^0.75 = base × 1) and over the wire only as "3
  seats > 2": both pass if `pull()` (`rules.ts:434`) used base × seats while
  the separately tested `orreryHp()` kept the curve.
- **F19, `orrery.test.ts:39-53`.** Checks only that some card of the same
  intent was on the strip, never that a `card` event was emitted (`table()`
  discards the pull's events): passes if a card not yet due resolves, an extra
  unannounced hit lands, or cards go up silently.
- **F20, `economy.test.ts:215-227`.** "Each role can take each of its actions"
  never calls `act()`: passes if `checkAction` refuses all 20 with any wording
  but "can't do that"; at least 7 are refused in this setup.
- **F21, `orrery.test.ts:70-78`.** Gravity set to 3 so the Lunge takes it to 4:
  can't tell "lethal on the Lunge that reaches 3" (the implementation,
  `orrery.ts:419-420`) from the design record's "At 3 stacks the next Lunge is
  lethal" (one Lunge later).
- **F22, `orrery.test.ts:105-108`.** "Unless a Chronist Delays it" checks only
  the countdown went to 1 and never runs the boss turn: passes if a Delayed
  Retrograde still flips.
- **F23, `economy.test.ts:52-53`.** The Chain is checked only at the first two
  potencies and the max: passes with 1, 1.1, 1.3, 1.5…; the exact sequence is
  knowable.
- **F24, `orrery.test.ts:19-33`.** HP set on the threshold then hit, never held
  just above: passes with the phase-II line anywhere above ~68.6% (likewise 35%).
- **F25, `effects.test.ts:67-70`.** Accepts any non-motion call as "shows the
  state change": passes the `hold` renderer that draws the guard dropping (F6).

### 4. Events with no renderer

- **F26, `src/client/battle/registry.ts:13-27` against `protocol.ts:241-289`.**
  30 kinds have no renderer: echo, resonance, chain, exposed, reaction,
  intercept, anchor, bastion, counterweight, ward, quicken, restore, cleave,
  finisher, feint, scan, pry, mark, shatter, delay, relay, stillpoint, card,
  pull, phase, break, lunge, gravity, retrograde, alignment. Tracked red by
  `shown.test.ts` (first test) and `effects.test.ts`. jab and haste are
  registered only through `SHIM_RENDERERS` (`src/client/sprites.ts:45-48`),
  tracked red by `sprites.test.ts`. The server raises nothing `EVENT_KINDS`
  doesn't declare; `leave` is declared and rendered but no longer raised.

## The breaker's report

**Target.** A scratch instance at `http://localhost:8091` (`TURN_TIMEOUT_MS`
1500, `TICK_MS` 150), never the live deploy. Scratch scripts in `/tmp` only;
no repo file touched. The instance predated the F5, F10 and F17 commits made
while it ran, so its findings describe the code it was serving.

**Result: every never-do rule reachable from outside held. Zero breaks.** Two
questionable holds.

### Broke

None.

### Held

- **Rule 1.** Two sockets on one busy four-player battle over about 20 s: 189
  same-version states compared, 0 queue-order and 0 `activeId` mismatches.
  Client-to-server frames on the watch socket (a fake `act`, a forged `state`
  at version 999999, non-JSON) were ignored; state flows one way. The client
  renders the queue as sent; its only `.sort()` is the Orrery SVG's ring order.
- **Rule 2.** An off-turn action got 409 "It's <name>'s turn.", and nothing
  fired for that actor in the next 3 s, nor when their turn came (a timeout
  auto-Brace instead). Twenty parallel actions from the active cookie for one
  turn: exactly 1 accepted, 19 refused.
- **Rule 3.** A forged cookie got a fresh one minted (never adopted), 403 on
  act, `{"character":null}` from `/api/me`. Body fields naming another player
  (`characterId`, `id`, `sessionId`, `actorId`, `activeId`) were ignored.
  Every account-shaped route 404. `Set-Cookie` is `HttpOnly; SameSite=Lax`.
- **Rule 4.** Case, padding, tab, newline, NBSP and ideographic-space variants
  of a name in one battle: all 409. The same name in another battle: 200.
  Rejoining with another name returns the original character unchanged.
- **Rules 5 and 6.** Write-through precedes broadcast (read). A solo fight to
  "lost": status, all 23 log lines and the character's loss survived as
  readable. (No restart: instructed not to.)
- **Rule 8.** Five seats left idle each timed out to an auto-Brace (Charge
  banked, drifting), and after three in a row each became an Echo; all five
  stayed standing. Acting for an Echo off its turn: 409.
- **Rule 10.** Eight turns with both sessions firing at once: the active one
  accepted every time, the other refused "<name> has just taken this turn.",
  0 double-lands.
- **Rule 18.** Intercept with no card, a bogus card, a raid-wide card, a second
  in one boss turn, or as a normal turn: 409. A valid single-target card: 200.
  A Mender's Intercept: 400.
- **Rule 20.** Pulls at 1 to 5 seats set max HP to round(240 × seats^0.75)
  exactly (240, 404, 547, 679, 802). A seat after the pull left max HP unchanged.
- **Cross-room.** A battle-A cookie acting in battle B: 403. Battle-B ids aimed
  from a legal battle-A turn: 400, resolved in A only.
- **Roles and input.** Wrong-role actions 400; resource-gated actions with an
  empty resource 409 with the right message. Bad names (empty, control
  characters, over 24, oversize) and bad roles (`__proto__`, `bulwark`, null)
  400; malformed bodies 400; path traversal 404 everywhere; no CORS; SVG served
  with a strict CSP and `nosniff`; no stack trace or server header leaks; names
  render through `textContent`.

### Questionable holds

- **Q1, rule 4.** `cleanName` rejected control characters but not format ones,
  so "Dup" and "Dup" with a zero-width space (or soft hyphen, or bidi override)
  were both seated in one battle, rendering as one name, and a name of nothing
  but invisible marks was accepted.
- **Q2, low.** `/join` and `/actions` parse the body as JSON whatever its
  `Content-Type`. Harmless (identity still from the cookie, validation still
  runs) but lenient.

Not reachable from outside: rule 7 (the volume, config), rule 9 (agent
launches), rule 11 (a client renderer, held by spec; every event carried its
log seq), rule 12 (licences), and a full restart.

## Disposition

Every finding is fixed, carried as a red test, or left with a reason. A fix
is in a commit that names the finding. Per the gate (CLAUDE.md), the branch
does not merge to main while any finding below is **open**.

| Finding | What was done | Where |
| --- | --- | --- |
| F1 log line for an unrendered event | **Open, carried red** (phase-two client) | `spec/phase-two.test.ts` F1 |
| F2 no boss card drawn | **Open, carried red** (phase-two client) | `spec/phase-two.test.ts` F2 |
| F3 an Echo can't be reclaimed live | Fixed: a 3 s beat on the plate | `6a760a4` red, `3ef4e9f` |
| F4 Echo acts for an absent player, unrecorded | Fixed: Echo turns never credit the person; ADR-006 "The Echo" records the reversal; ADR-002 and ADR-003 corrected | `3ef4e9f`, `d4faca7` |
| F5 spender not in the client's state | Fixed: `spentExposed` sent | `a0daad5` red, `40b100e` |
| F6 hold drops the guard; drifting undrawn | **Open, carried red** (phase-two client) | `spec/phase-two.test.ts` F6 |
| F7 card actions sent an ally id | **Open, carried red** (phase-two client) | `spec/phase-two.test.ts` F7 |
| F8 a fallen target's card re-aims | Fixed: spent on nobody | `9b4b7b7` red, `4cb1154` |
| F9 assets red, undeclared | Fixed: holds the art actually drawn | `ee33e6e` |
| F10 reviewer could write files | Fixed: write arguments refused | `ed255f6` |
| F11 haste untested | Fixed: test, mutation-checked | `5189870` |
| F12 Chain never on damage | Fixed: test, mutation-checked | `02dd18e` |
| F13 Broken-ring Resonance untested | Fixed: test, mutation-checked | `5189870` |
| F14 rule 1 client half judged | Fixed: jsdom test, mutation-checked | `ed69e67` |
| F15 Echo output unchecked | Fixed: exact share, mutation-checked | `d2f70f7` |
| F16 no live Echo-reclaim test | Fixed: live HTTP test; misnamed test renamed | `4cebdd0` |
| F17 Exposed test read engine state | Fixed: reads `view()` | `a0daad5` |
| F18 pull HP unchecked off one seat | Fixed: four seats, mutation-checked | `b58bdcb` |
| F19 cards matched by intent only | Fixed: exact due set, every card announced; mutation-checked | `7469da9` |
| F20 actions never performed | Fixed: each performed, mutation-checked | `9192476` |
| F21 Gravity a stack early | Fixed: a real bug; lethal on the Lunge after three | `fccab70` red, `1e884ee` |
| F22 Delayed Retrograde never run | Fixed: followed to the end, mutation-checked | `5a39017` |
| F23 Chain checked at two points | Fixed: exact sequence | `02dd18e` |
| F24 phase line unpinned | Fixed: both sides, mutation-checked at 68%, 37% | `ffe7219` |
| F25 reduced check accepts a wrong state | **Open, carried red**: its one instance is F6's hold renderer; a general expected-state check needs per-event renderer design | `spec/phase-two.test.ts` F6 |
| F26 30 events unrendered | **Open, carried red** (phase-two client) | `spec/effects.test.ts`, `spec/shown.test.ts` |
| Q1 invisible characters in names | Fixed: `\p{Cf}` stripped | `a5036d6` red, `b8b2ef7` |
| Q2 body parsed whatever its type | Not fixed, by judgement: harmless (identity from the cookie, validation runs); not a rule | none |

**Mutation-checked** means the fix was proven by breaking the code on purpose
and watching the strengthened test fail, then restoring it. One first attempt
at F22 passed with the bug still in, and was rewritten until it didn't.

**Open, and blocking the merge:** F1, F2, F6, F7, F25 and F26, all client
work outside phase one's server surface, each held by a red test. "Shown as
the Echo's on the strip" (ADR-006, "The Echo") is client work too, part of
F26's `echo` renderer.

**The roster after the fixes:** 91 green, 8 red, every red a declared
phase-two target (`sprites` ×2, `effects`, `shown`, `phase-two` ×4).

## Re-review

The reviewer, run again on a fresh context against `0e5c564..34f0780`, checked
each disposition against the code and reviewed the fixes as new code. Its Bash
was held to `git diff` and `pnpm check`. `pnpm check`: typecheck and stylelint
clean; vitest 91 passed, 8 failed, matching the roster above.

**The disposition table above overstated three findings as fixed.** The
re-review is right on each, and it was confirmed by hand: F4 (an Echo seat is
still credited a win or loss, and the economy.ts header still says its turn
and damage are credited), F10 (the hook still passes `--config`, which runs any
script, and `--clearCache`), and F12 (healing still ignores potency untested).

### (A) The original findings, re-checked

| Finding | Re-review | Note |
| --- | --- | --- |
| F1 | carried red correctly | fails on the line appended for an unrendered `pull` |
| F2 | carried red correctly | but its target is weak (R9) |
| F3 | resolved on the server | the client side of the beat is wrong (R8) |
| F4 | **not fully resolved** | wins and losses still credited to an Echo seat (`rules.ts:677-684`), untested; `economy.ts:29-31` comment says the opposite of the fix |
| F5 | resolved | |
| F6 | carried red correctly (the guard) | its drifting check passes a wrong implementation (R5) |
| F7 | **carried red only in part** | covers Delay, not Anchor or Stillpoint; and Intercept / every Reaction still can't be sent from the app (`main.ts:130-131` keeps the window dark off-turn), neither fixed nor carried |
| F8 | resolved on the server | the spent card is drawn as a hit (R1) |
| F9 | resolved | `assets.test.ts:6` imports the shim statically, so deleting it in phase two breaks rule 12's licence checks |
| F10 | **not resolved** | `--config <script>` runs any script; `--reporter=blob` writes; `--clearCache` deletes |
| F11 | resolved | |
| F12 | **partly resolved** | damage reads potency; healing (`roles.ts:254`) untested; the ratio is loose (R10) |
| F13 | resolved | |
| F14 | resolved | CLAUDE.md rule 1 still says "Judged in src/client/" |
| F15–F18 | resolved | |
| F19 | resolved for the turn it samples | samples one phase-I turn (R11) |
| F20 | resolved as stated | but event-only (R6) |
| F21–F24 | resolved | F21 a real bug fix |
| F25 | **carried red wrongly** | the named test holds one renderer; the general weakness (`effects.test.ts:69-70`, any non-motion call counts) is what all 30 phase-two renderers will be judged by, and no red test carries it |
| F26 | carried red correctly | masks a regression check (R7) |
| Q1 | **partly resolved** | other invisible characters and unnormalised forms pass (R4); stripping renames some names (R2) |
| Q2 | not resolved, by recorded judgement | no rule requires it |

### (B) New findings

**Violations of a rule or an ADR**

- **R1, rule 11 (and rule 19's intent).** `src/server/orrery.ts:405-414` emits a
  spent card as an ordinary `eclipse` or `lunge` with the fallen target's id,
  `amount: 0` and a made-up `gravity: 0`; the registered renderer
  (`effects/orrery.ts:13-37`) draws a bolt, a hurt frame and a harm number on the
  fallen sprite while the log says it "passes over the table". The cast
  `as Parameters<Ctx["say"]>[3]` hides the shape from tsc; the protocol has no
  field for "spent"; no test covers what a spent card draws.
- **R2, rule 4 ("never suffixed or silently renamed").** `rules.ts:211` strips
  all `\p{Cf}`, including ZWJ U+200D and ZWNJ U+200C, which shape emoji
  sequences and Persian and Indic spelling: such a name is stored and shown
  differently from what was typed, silently.
- **R3, ADR-002 §Options 3 against ADR-006 §The Echo.** The beat stops the
  table's clock 3 s on every Echo turn for as long as the person is gone:
  ADR-002's rejected option 3 ("keeps costing the table one full timeout every
  cycle, forever"). ADR-006 records a cost for the record but none for this.

**Tests that would pass under a wrong implementation, and rules with no test**

- **R4, rule 4 / Q1.** `queue.test.ts:128-149` tries only Cf characters: an
  invisible twin with U+034F or U+FE0F (Mn), a blank name of U+3164, U+FFA0 or
  U+2800, and NFC against NFD "José" all pass `cleanName`. It would also pass
  if Cf were stripped only for comparison and the raw name stored.
- **R5, rule 8 "Their portrait dims" and ADR-006 "shown as the Echo's on the
  strip".** `phase-two.test.ts:108-111` goes green with a one-off
  `strip.flag(id, "drifting")` stamp that clears in 1.1 s; nothing holds a
  persistent mark (`strip.ts:166-195` reads neither `drifting` nor `echo`); a
  client connecting mid-fight gets no past events, so an event-driven mark never
  shows to it.
- **R6, ADR-006 §Decision.** `economy.test.ts:324` checks only that each action
  emits its event: it passes if Quicken never cuts a wait, Ward never absorbs,
  Bastion never blunts, Relay never hands on, Pry or Shatter never strip pips or
  push a card, Restore never revives, or Finisher never doubles on a Broken
  ring. Quicken and a Break pushing a card back have no effect test anywhere.
- **R7, rule 11 (server side), masked.** `shown.test.ts:52-93`, the only check
  that the server raises nothing undeclared, sits behind the red registry loop
  and doesn't run; when it does, its idle Chronist becomes an Echo and every
  Echo turn waits a fixed 3 s no env can shorten: an estimated 20+ Echo turns
  overrun its 60 s budget, so it would go red for the wrong reason.
- **R8, ADR-006 §The Echo ("its person's portrait lights for them").** Not
  implemented or tested: `turnMs` is documented as the plate's time, the beat is
  `ECHO_BEAT_MS` and isn't sent, so `main.ts:132-134` and `:205-210` draw the
  beat as a turn already 75% gone and sound the hold warning at once.
- **R9, rule 19.** `phase-two.test.ts:91-93` checks only a card's id and intent;
  a card with no target and no countdown passes.
- **R10, rule 15.** `economy.test.ts:105-121` uses a Jab of 6, so any potency
  from about 1.35 to 1.54 rounds to 9 and passes `toBeCloseTo(1.5, 1)`.
- **R11, rule 19.** `orrery.test.ts:44-68` samples one phase-I turn, whose only
  due card is a Revolution: a Retrograde, Perihelion or Alignment resolving
  unannounced later passes.

**Events with no renderer:** none new. `leave` is declared and rendered but no
longer raised.

### What was done about the re-review

Each fixed in its own commit naming the finding, red first where there was a
test; new tests mutation-checked (the code broken on purpose, the test seen to
fail, the code restored).

| Finding | What was done | Where |
| --- | --- | --- |
| F4 (rest) | Fixed: an Echo seat at the end gets no win or loss; the economy.ts comment corrected | `1683b0f` red, `a9a5004` |
| F10 | Fixed: the hook is now an argument allowlist (refs, paths, read-only flags; spec paths and `-t`); tested on 11 reads and 21 attempts, every re-review leak included | `58a134e` |
| F12 (healing) | Fixed: Mend at +50% heals exactly 1.5x | `3150b23` |
| F7 (rest) | **Open, carried red**: Anchor and Stillpoint must aim at cards; a Reaction must be sendable off-turn | `spec/phase-two.test.ts` |
| F9 (rest) | Fixed: the shim is loaded defensively; with it removed, the licence checks still pass | `1414c67` |
| F14 (rest) | Fixed: rule 1 names its two specs | `68b5eea` |
| F25 | **Open, carried red correctly now**: every event needs a declared expected state | `spec/phase-two.test.ts` F25 |
| R1 | Fixed on the server: a `spent` flag in the protocol, no cast; **drawing it, open, carried red** | `d4eff84` red, `792a6ee` |
| R2 | Fixed: names stored as typed (NFC, only deceiving invisibles removed), so joiners survive | `781ec9d` |
| R3 | Fixed: ADR-006 records the beat's cost to the clock, and why it's accepted | `952cb8d` |
| R4 | Fixed: compared by a folded key with everything invisible removed; a name with nothing visible refused | `781ec9d` |
| R5 | **Open, carried red**: drifting and Echo drawn from state, persistently | `spec/phase-two.test.ts` R5 |
| R6 | Fixed: `spec/actions.test.ts` pins each action's effect; five mutation-checked as no-ops | `3150b23` |
| R7 | Fixed: the beat is set by `ECHO_BEAT_MS`; the masked check now finishes in 16 s | `f9afd47` |
| R8 | Fixed on the server: `plateMs` sent; **drawing it, open, carried red** | `f9afd47`; `spec/phase-two.test.ts` R8 |
| R9 | **Open, carried red**: a card shows its target and countdown | `spec/phase-two.test.ts` F2 |
| R10 | Fixed: the Chain checked on a heal too large for rounding to hide | `3150b23` |
| R11 | Fixed: the card rule held on every turn through all three phases; a silent-Retrograde mutant passes the old test and fails this one | `6bbadb0` |

**One rule needs the owner's wording.** Rule 2 says the command window "stays
disabled until the server says it is your turn"; rule 18 says a Reaction "is
taken out of turn". Read together they make Intercept unsendable from the app.
The red F7 Reaction test is written to the reading that keeps both rules'
intent: the turn's actions stay dark off-turn, and a Reaction is live while the
server says one is ready (`reactionReady` and a card on the strip), so the
client still decides nothing. Rule 2's wording should say so; that is the
owner's to change.

### Open, and blocking the merge

All client work outside phase one's server surface, each held by a red test
that fails on that finding and nothing else:

- **F1**: a log line written for an event no renderer showed.
- **F2 / R9**: no boss card on the strip, with its intent, target and countdown.
- **F6**: the hold renderer drops the guard the server Braced.
- **R5**: drifting and Echo seats not drawn from state.
- **R8**: the countdown not drawn against `plateMs`.
- **R1**: a spent card drawn as a hit.
- **F7**: card actions sent ally ids (Delay, Anchor, Stillpoint); Reactions unsendable off-turn.
- **F25**: no declared expected state per event.
- **F26**: thirty events with no renderer (`effects`, `shown`).
- The shims: two roles share a sprite, and Jab and Haste borrow animations (`sprites` ×2).

**Roster after the re-review's fixes:** 107 green, 14 red, every red one of the
above. Typecheck and lint clean.
