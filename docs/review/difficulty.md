# Review gate: the difficulty pass (ADR-011)

The review gate (CLAUDE.md, "How to work in here") on branch `difficulty`,
cut from `origin/main` (`5a5a57c`) with `docs/features-rice.md`'s commit
carried over. Run under the stopping rule: reviewer and breaker once, one fix
round, one confirm pass, closed.

- The **reviewer** read `git diff origin/main..difficulty` at `3aadf22`
  against CLAUDE.md, every ADR and every spec, and ran the engine and client
  specs. Its Bash refused `grep` and `git log`, so it could not check commit
  order; that is answered from the history below.
- The **breaker** attacked a scratch instance of `3aadf22` on `:8080` (the
  default 12 s turn), never the live deploy. The owner's brief named three
  surfaces: the Reactions off-turn, Charge spent twice, and a ring the server
  doesn't offer.

Both were started on 2026-10-29 on fresh contexts, with no part in building
the work. The weekly budget was read at `/api/me` before the pass: $5.53 of
$200 spent; the gate used two agents at a time, under rule 9's threshold.

## Before the gate: what step 4 measured

### ADR-011's targets, on the engine

Over the thirty-one rooms of one to five distinct roles (`spec/difficulty.test.ts`),
deterministic, no wall clock, on the committed tuning:

| target | held at | measured |
| --- | --- | --- |
| naive wipes before phase III | ≥ 25 of 31 | 25 |
| competent wins | 10 to 20 of 31 | 11 |
| expert wins | ≥ 25 of 31 | 30 |
| solo Brace-only, four Echoes, wipes before III | every role | 5 of 5 |
| solo expert, four Echoes, wins | every role | 5 of 5 |

Before ADR-011, on the same harness: naive won 10, competent 14, expert 19;
a Brace-only solo table won in four roles of five (finding 18). Naive and
competent sit at the edge of their bands: a retune that moves either by one
room goes red.

### A scripted solo fight, live

One person playing the expert Striker's policy, reading only what the room's
socket sent, four seconds per decision, with four Echoes, in a private room
through the lobby, over HTTP, against a scratch instance on `:8092`.

| | |
| --- | --- |
| outcome | won |
| seats at Start | 3 (one person, four Echoes at half), Orrery 274 HP |
| fight, Start to ending | 85.9 s |
| Orrery turns | 17 |
| player turns | 43 (2.53 per Orrery turn, inside ADR-010's band) |
| phase II | Orrery turn 6 |
| phase III | Orrery turn 10 |
| downed | the Chronist Echo |
| Reactions | none: a solo Striker's Riposte answers only a blow at the Striker, and the Lunge's mark was the Warden Echo |
| timeouts | none |

### A three-browser fight

Three headless Chromes, three sessions: Hal the Warden made the room through
the form, Mira the Mender and Sol the Striker opened its `?room=` link and sat
down through the form, and Hal pressed Start. Each page pressed the first live
command in its own command window three seconds after its turn lit, confirmed
on the target the window started on, and took its Reaction whenever the
window lit one.

| | |
| --- | --- |
| outcome | won |
| seats at Start | 3, Orrery 274 HP |
| fight, Start to ending | 103.8 s |
| Orrery turns | 8 (Revolution, Lunge, Revolution, Eclipse, Revolution, Lunge, Perihelion, Revolution) |
| player turns | 30 (3.75 per Orrery turn) |
| phase II | after the Orrery's 2nd turn |
| phase III | after its 5th |
| Reactions | 12 applied: Hal's Intercept 9, Mira's Veil 3 (her page pressed Veil 9 times; the server refused 6, the mark already Warded) |
| downed | nobody; no timeouts |
| the end panel, on every page | "The Orrery grinds to a halt" / "Its rings have stopped. The table won this raid." |

**A risk this measured (no rule broken):** eight Orrery turns is under
ADR-010's twelve. Rule 28 holds twelve for a solo table and for five people,
not for three, and `spec/pace.test.ts`'s band holds; but a three-person table
whose every seat reacts each boss turn stings the Orrery twelve times, and
ends faster than ADR-010's target meant for five. Measured, not tuned for,
in this pass.

The step-4 sensors ran on the build: `check:viewports` (six route×viewport
pairs, and the new fold claim on `/` before joining), `check:keyboard` (26
stops) and `check:tags` (no plate covered at 390×844) all green.

## The reviewer's report

Kept as given, condensed to its findings. All 97 tests it ran passed.

**Violations**

- **F1 (rule 18).** A Reaction could be taken on your own turn:
  `checkReaction` and `reactionCardOf` never checked `activeId`, and
  `rules.checkAction` sent a Reaction there before the turn check. With the
  sting, a free counter-blow and a Ward on your own turn. No test.
- **F2 (ADR-011).** The ADR disagreed with the code: Fracture's Break
  "halves" the Perihelion (code: an eighth); Retrograde sets back "every
  seat by a whole Standard turn of its own" (code: every seat by the slowest
  seat's); `charge` is carried "so the screen can draw the spend" (no
  renderer reads it, nor `setBack` or `reshuffled`).
- **F3 (risk, rule 11).** A Reaction against a blow at the reactor Wards them
  with no event field or log text saying so (Intercept-at-self, Nudge).

**No test that would fail**

- T1: Eclipse halved by a Brace. T2: `gravityBefore` (two Lunges on one
  turn). T3: a blow on a revealed weakness cracking a pip. T4: the Echo's
  Brace before a blow on everyone. T5: Broken rings offered in the ring step.
  T6: the sting ignores `ECHO_POTENCY`; only `offTurn` returning null keeps an
  Echo from it.

**Weak tests**

- W1: the "met Perihelion" test announced its own amount, so the Break's cut
  was held by nothing.
- W2: the Retrograde test re-derives tick speeds from a hard-coded table.
- W3: the Gravity swap arm doesn't check the blow landed as ordinary; no
  Intercept arm.
- W4: the enrage specs' `shield()` makes the party invulnerable, so they no
  longer fail if the teeth stop firing (disclosed in ADR-011).
- W5: the Echo never-spend test drives `echoes.onTurn`, not `echoMove`.
- W6, W7: runner-level assertions; targets held as counts only.

**Renderers:** every event kind has full and reduced renderers with real
declared state. **Clean:** rules 1 and 2 on the client (the nudge reads only
`activeId`, `turnDeadline` and status; the ring step starts on the preview's
target), determinism, rule 12 and rule 32 for the favicon, rule 25 on the
Echo's paths. One more risk: an Echo that Braces banks Charge and then never
takes its signature move again.

## The breaker's report

**No finding. Two risks.**

- **R-A (risk).** A non-string `targetId` (an object, array, number) on a
  ring action becomes null and takes the default ring: refused or applied as
  the default would be, not 400. A string that isn't a ring is 400. Nothing
  leaks (`target=unknown` in the log).
- **R-B (risk).** A refused ring string is echoed in the 400 body, up to
  5000 characters, to its sender only. Rule 32 covers the log, which carried
  `target=unknown` for every one.

**Held:** Reactions with no card, an invented card, the wrong role's name, a
card the role can't answer, a card answered but not named (409 naming the
first that lands), twice in a boss turn (sequential and raced: one 200),
another seat named (403, logged with `as_seat`), extra body fields ignored,
one log line with `sid` per refusal, nothing fired later. Out of turn, no
cookie, a cookie never minted, another fight's seat, the WebSocket ignoring a
client's state. Rule 10: three signature moves raced, one applied. Rule 17:
three Finishers raced at Charge 2, one applied, Charge 0 after, never below 0
or over 3; a refused Stillpoint spent nothing over 40 tries. Names, rooms,
codes, `/favicon.ico` (200, svg, CSP) and an unserved path (one refusal line,
query not echoed).

**Not reached:** Reactions against a fallen target's card, a frozen card or an
Alignment; a Reaction on the sender's own turn; Restore, Bastion over Bastion,
Shatter or Pry at a Broken ring; the 12 s timeout to Echo sequence.

## Disposition

| finding | disposition |
| --- | --- |
| F1 | **Fixed.** Spec red in `a05f495`; `2c4fb62` refuses a Reaction from the seat on the plate and names it no card. The five targets re-measured after: unchanged. |
| F2 | **Fixed** in the ADR's text, `60d5aff`: Retrograde's set-back is the slowest seat's for all, Fracture's Break is an eighth, and `charge`, `setBack` and `reshuffled` are for the log; the screen draws each from state on arrival (checked: `seat.ts` and `marks.ts` read the token's `charge`). |
| T1, T2, T3, T4, W1 | **Fixed** in `3d09ea2`: each test shown red with its mechanic broken on a scratch copy, green on the build. They hold code that was already there, so they land green; this report is the record of the miss. |
| F3 | Risk, recorded: the Ward is drawn from state on arrival, which rule 11 allows; the log doesn't say why. For the next phase. |
| T5, T6, W2, W3, W5 | Test strength, listed for the next phase (CLAUDE.md: residuals in the strength of tests aren't re-reviewed in this one). |
| W4 | Risk, recorded: disclosed in ADR-011; rule 28's enrage is held, against a table that only defends. |
| W6, W7 | Risk, recorded. |
| Echo's Charge locks its signature | Risk, recorded: ADR-011 says an Echo never spends Charge; one that has braced takes its signature no more. Intended by the letter; whether it should Brace less is for the next phase. |
| R-A, R-B | Risks, recorded: no rule names a response body, and absent targets default by design. |
| Commit order (the reviewer couldn't check) | From the history: the favicon's CREDITS row and file landed in one commit (`fcb9c66`), after its red spec (`ed327c9`): the row wasn't committed ahead of the file. Recorded as history. The new specs went red first (`887ff55`, 25 of 30 red), each changed spec in its own commit, the rule text alone (`b449f1e`), then the code (`9327f5a`). |

### Carried

- **`assets.test.ts`'s connection reset, a third time.** "every sprite has
  every required frame" failed with `ECONNRESET` in two full-roster runs in
  this phase (after step 0's fold, and after the fix round), and passed alone
  and on the next run each time. It is the lobby gate's carried item, still
  open: the test fetches a 59 KB file with no retry.

### The roster after the fix round

347 of 347 on `60d5aff`, after one run at 346 with the reset above.

## Confirm pass

One fresh reviewer read the fix round only, `git diff 3aadf22..60d5aff`, and
ran the engine and client specs (84 passed). Its report, condensed:

- **F1: fixed, no new hole.** The guard refuses the seat on the plate first,
  and no card is named for it. A seat whose turn just ended can react (no
  reset is 0). Echoes never reach `react`. A person in their Echo's beat is
  now refused a Reaction, which agrees with rule 8 (only an ordinary turn
  ends an Echo). One refusal line, nothing echoed. The spec was red first.
- **F2: Retrograde's amount and Fracture's eighth fixed; `setBack` and
  `reshuffled` drawn from state, as the ADR now says.** Not fixed:
- **1. Rule 11 (kind 1).** The ADR's new sentence, that the Charge spend is
  drawn from state before the log line, holds for Bastion only. Restore,
  Finisher, Shatter and Stillpoint don't redraw the spender's marks; the
  conductor reconciles the scene after the queue drains, after the line is
  written. So "…3 Charge behind it…" is logged while the sprite still shows
  3. No declared state would catch it.
- **2. ADR-011 tooth 3 (kind 1, new).** "So the Orrery's next turns come
  before the table's" is false in a one-seat room: the Orrery's reset there
  (26 to 53 ticks) is larger than the set-back (12 to 24).
- **3. Risk.** "halved" survives in the Perihelion's log line and comments;
  the cut is an eighth.
- **4-6. Weak tests.** F1's spec passes with the guard deleted (the name
  check refuses with the wrong reason) and exercises Intercept only. T4
  drives `echoMove`, which falls back to Brace; the Revolution-while-hurt
  arm is untested. T3 covers a Jab on the outer ring only.
- **Outside its scope:** the Bastion's blurb says 40% (it is 60%), and the
  screen marks Gravity lethal at 3 stacks while a Lunge kills from 2.

### Disposition of the confirm pass

The stopping rule allows one fix round, and it has run. So each finding that
names a rule or an ADR is **carried red** (`spec/carried-difficulty.test.ts`),
and the rest are recorded:

| finding | disposition |
| --- | --- |
| 1 (rule 11): the Charge spend drawn after its line | **Open, carried red as C1**: Restore, Finisher, Shatter and Stillpoint must redraw the spender's marks. Bastion passes, so the test can. |
| 2 (ADR-011 tooth 3): the solo Retrograde | **Open, carried red as C2**: the engine shows a lone seat at 13 to 25 ticks, the Orrery at 26 to 53. Either the set-back or the ADR's clause has to change; that is a decision about the tooth, so it isn't made here. |
| Gravity marked lethal at 3 (ADR-011 tooth 1; ADR-006, a rule read off the screen) | **Open, carried red as C3.** |
| 3: "halved" in the Perihelion line and comments | Risk, recorded. |
| Bastion's blurb says 40% | Risk, recorded: it misstates a tuning value on the button. |
| 4-6: weak tests (F1, T3, T4) | Listed for the next phase. |

## The gate stands open

Every finding from the first pass is fixed, recorded as history, or recorded
as a risk. The confirm pass found two rule or ADR violations and one more
outside its scope, carried as three red tests. The last review found a
violation, so **the gate is not closed** (CLAUDE.md: a gate closes when "the
last review finds no rule or ADR violation"), and **the branch does not merge
to main while C1 to C3 are open.** The branch is pushed, unmerged.

The roster on the branch's tip: 347 green, and the carried file's 6 red, by
design.

### For the next phase

- Close C1 to C3: then one review pass on that fix, under the stopping rule.
- C2 needs a decision first: keep the clause and set a solo table back
  further, or drop the clause.
- Risks: F3 (self-Ward unsaid in the log), "halved", the Bastion's 40%, an
  Echo that has Braced never taking its signature again, R-A and R-B, and the
  three-person table's eight Orrery turns.
- Weak tests: T5, T6, W2, W3, W5 to W7, and the confirm pass's 4 to 6.
- `assets.test.ts`'s reset, carried from the lobby gate, three times now.
