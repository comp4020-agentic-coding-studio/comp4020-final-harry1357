# Review gate: the feedback pass (ADR-012)

The review gate (CLAUDE.md, "How to work in here") on branch `feedback`, cut
from `main` at `86ad8ea`. Run under the stopping rule: reviewer and breaker
once, one fix round, one confirm pass, closed.

The pass is ADR-012, "the fight tells you what happened", and rule 34, in
four pieces, each a spec committed red ahead of its code:

1. **The ending names its cause** (`spec/cause.test.ts`): the server's `end`
   event, the state and the end's log line carry the card that ended the
   fight, its target, what it found there, and the answers the table had
   (ADR-011's), each with the person who held it; on a win, the blow, the
   Break and the longest Chain. The end panel and the lobby print it before
   Start.
2. **The phase moment says what changed** (`spec/phase-line.test.ts`).
3. **A hint for every role** (`spec/hints.test.ts`), and a spec that a
   window told every hint accepts exactly what a window told none accepts.
4. **Your next card, pinned** (`spec/threat.test.ts`), in `--ember`, in the
   order the server sent.

Both agents were started on 2026-11-07 on fresh contexts, with no part in
building the work. The weekly budget was read at `/api/me` before the pass:
$53.78 of $500 spent; the gate ran two agents at a time, under rule 9's
threshold.

- The **reviewer** read `git diff main...feedback` at `cddb1a7` against
  CLAUDE.md, every ADR and the specs, and ran `pnpm check` against a scratch
  instance (`:8093`): 399 of 399.
- The **breaker** attacked a scratch instance of `cddb1a7` on `:8093` (the
  default 12 s turn), never the live deploy. The owner's brief named three
  surfaces: a forged end event, a cause naming the wrong seat, and a hint
  that enables an action.

## Before the gate: what was measured

On a scratch instance of `cddb1a7`: the roster 397 of 399, the two
failures `assets.test.ts`'s sprite fetch (`ECONNRESET`) and
`favicon.test.ts`'s 5 s Chrome timeout, both green alone, with the load at
11.7 (the known flakes recorded in the difficulty gate).
`check:viewports` (six pairs), `check:keyboard` (26 stops) and
`check:tags` green.

### Two scripted solo fights, live

One person playing a scripted policy (`spec/difficulty/policies.ts`),
reading only what the room's socket sent, with four Echoes, in a private
room through the lobby, over HTTP, against `:8093` at `cddb1a7`.

| | naive Breaker ("Ada") | expert Striker ("Sol") |
| --- | --- | --- |
| outcome | lost, phase III | won, phase III |
| Start to ending | 46.5 s | 39.0 s |
| room / fight | `UF7LC` / `HYNK0DBRCaGi` | `WMCBE` / `b8tLb-NpbJNE` |

The end panel's line, verbatim, the naive fight:

> Perihelion landed on everyone, no Bastion standing and the outer ring
> whole. A Warden's Bastion, Ada's Shatter or Fracture, or every seat's
> Brace would have met it.

The expert fight's win line:

> Sol's Cleave into the outer ring ended it. The longest Chain was 5.

The end event, the state and the end log line carried the same words in
both. The Warden at the naive table was an Echo, so the Bastion is named by
role; Ada, the person, is named for the Break she held.

## The reviewer's report

Kept as given, condensed to its findings. `pnpm check` green, 399 of 399.

**Violations**

- **1a (rules 8, 25).** The ending credited a timed-out seat's Echo to its
  person: `nameOf` read `b.joined`, so an Echo's last Counterweight or Break
  was "Ada's Counterweight … ended it" in the end line, which the Echo's own
  line had said as "The Echo of Ada".
- **1b (rule 34).** The answers ignored what the card found and who stood
  when it landed: a Braced seat downed by a halved blow was told its Brace
  would have met it; a Bastion or a Broken ring that stood was listed; a
  Warden who swapped was offered the swap; a person already downed was named
  as holding an answer; a Warden the card was aimed at was offered Anchor,
  which the server refuses. Every case in `cause.test.ts` was an unmet card
  on a seat with nothing.
- **1c (ADR-011).** The answers had no Riposte or Nudge for a Striker or
  Chronist the blow was aimed at; ADR-011 names both.
- **1d (ADR-012 §1).** "A page that arrives after the end reads the same
  words" was false in every room: a room moves on in the same step.
- **1e (the contrast gate).** The pinned card was `--ember` text on the
  window's warm gradient (about 3.85:1 at its top stop), which no pair
  measured.
- **1f (ADR-011, C5).** Conjunction's line said "a Chronist cancels it";
  ADR-011 names two cancels.

**Untested:** 2a the longest Chain; 2b `main.ts`'s wiring of the cause; 2c
1a and 1b; 2d the end line after a restart.

**Weak tests:** 3a the Chain checked by the Chain at the end; 3b the clock's
Alignment by prefix; 3c `threats: state.cards` matched by a regex a sort
passes; 3d an order a client sort would give; 3e rule 2 checked only dark;
3f only one CSS rule's colour; 3g the dark-click test adds nothing beyond
`disabled`; 3h `toBeGreaterThan(0)` for hints drawn; 3i `"*"` in the end's
and phase's declared state; 3j a fixed file list searched for phrases.

**Unrendered events:** none.

## The breaker's report

Kept as given, condensed. Run against `cddb1a7`; the branch moved during the
run, so each engine finding also gave HEAD's line.

**Violations**

- **V1 (rule 34).** A Brace named as missing when the seat had Braced, live
  in four rooms (e.g. `5NZ5F` / `TebX5fcPQQzA`: both seats `braced:true`,
  hits halved, "every seat's Brace would have met it"). At HEAD the
  one-target case was fixed by 1b; a Perihelion or Revolution with every seat
  Braced still offered every seat's Brace.
- **V2 (rule 34).** A person downed before the last card named as holding an
  answer (`8NWHX`: "Wes968's Anchor or Intercept"). Fixed by 1b at HEAD.
- **V3 (rule 34).** Answers the server refuses: a Warden's own Anchor
  (`E55CW`), and Shatter or Fracture after the outer ring was Broken (eight
  runs). Fixed by 1b at HEAD.
- **V4 (rules 8, 25).** An Echo's blow credited to its person, live (`N8V3Q`:
  stdout `echo=true`, end line "Wex's Counterweight"). Fixed by 1a at HEAD.
- **V5 (ADR-012 §1).** A fight out of memory serves `ending: null`; the end
  panel shows no cause (`jjFUovGqT0sA`). The end log line keeps it.
- **V6 (rule 34, questionable).** A name can read as part of the cause ("A
  Warden4ff's Shatter"); and a line with no Warden began in lower case
  ("every seat's Brace").

**Questionable:** Q1 the lobby's cause gone after going on or reloading;
Q2 a timed-out person's answer said by role; Q3 "forty" vs `ENRAGE_AFTER`;
Q4 no Chronist answer to a Lunge (HEAD adds Riposte); Q5 two seats downed by
one card names nobody; **Q6 `table.ts:131` writes a prose line to stdout on
room expiry** (older than this phase, `9e511ee`).

**Held:** every forged end event, `ending` field and crafted name over the
WebSocket and every route (never believed, never reflected; markup printed
as text; control characters refused or escaped); rules 3 and 32 for the new
`ending_*` keys; in Chrome, 365 to 407 presses per role and forced clicks on
every hinted option, with no turn action sent off-turn and every Reaction at
the server's card; the pinned order equal to the server's in 3,701 DOM
snapshots at both viewports; a Riposte sting win, a re-shielded ring, a
Warden who left the lobby, the Grand Alignment; rules 5, 22 and 26.

## The fix round

Each finding a spec ahead of its fix, red then green:

| commit | what |
| --- | --- |
| `7435960` | Spec, red: 1a, 1b, 1c, 1f, 3a, 3b (`spec/carried-feedback.test.ts`) |
| `6a60947` | Spec corrected, in its own commit: three of `cause.test.ts`'s loss cases expected answers from seats `leaveOnly` had downed before the card landed (1b itself); the Lunge case gains the Striker's Riposte (1c); the Perihelion case lands on both seats standing; `phase-line.test.ts` pinned 1f's one cancel |
| `066041d` | **Fix 1a, 1b, 1c, 1f, 3b:** the answers are the table's as it stood when the card landed, none already made, none held by the downed, no Anchor on your own blow, Riposte and Nudge for the target; an Echo's blow or Break is the Echo's; `ENRAGE_AFTER`; both cancels |
| `0b4a854` | Spec, red: 1e |
| `f45688a` | **Fix 1e:** the pinned card paints its own `--ink` |
| `af1a1d5` | ADR-012's text: 1d, and the answers as built |
| `60e9b24` | Tightened 3c, 3d, 3h, 3i (the declared state names the server's line; a mutation to `cause(null)` turns `effects.test.ts` red) |
| `425da6e` | Spec, red: V1, V6 (case), Q6 (`spec/carried-feedback-breaker.test.ts`) |
| `1d2f5b8` | **Fix V1, V6, Q6:** `all-braced` on a blow on everyone; a capital on every line; room expiry written by `log.ts` as `action=expire` |
| `a42cbb5` | ADR-012's text: V5 |

**After the fix round, at `a42cbb5`, on `:8093`:** the roster 417 of 417;
`check:viewports` (six pairs), `check:keyboard` (26 stops) and `check:tags`
green.

### Disposition

| finding | disposition |
| --- | --- |
| 1a, V4 | **Fixed**, `066041d`. |
| 1b, V2, V3 | **Fixed**, `066041d`; `6a60947` corrected the specs that held the bug. |
| 1c | **Fixed**, `066041d`; ADR-012's table follows ADR-011. |
| 1d, V5 | **Fixed in the ADR's text**, `af1a1d5`, `a42cbb5`: a room's page keeps the cause it saw; after memory, the end log line is the cause. Persisting the ending is not this phase's. |
| 1e | **Fixed**, `f45688a`. |
| 1f | **Fixed**, `066041d`. |
| V1 | **Fixed**, `1d2f5b8`. |
| V6, lower case | **Fixed**, `1d2f5b8`. |
| V6, a name that reads as a role | **Risk, recorded and closed**: names are kept as written (rule 24) and no rule says a name can't look like a role; the questionable names no rule broken. |
| Q6 | **Fixed in the gate**, `1d2f5b8`: older than this phase, but a rule-32 letter violation, and a one-line fix rather than a finding carried open. |
| 3a, 3b | **Fixed**, by `carried-feedback.test.ts`. |
| 3c, 3d, 3h, 3i | **Fixed**, `60e9b24`. |
| 2b, 2d, 3e, 3f, 3g, 3j | Listed for the next phase. |
| Q1, Q2, Q5 | **Risks, recorded and closed**: each follows ADR-012 as written (a page keeps what it saw; an Echo's seat is said by role; a card on everyone names everyone). |
| Q3, Q4 | Closed by `066041d` (`ENRAGE_AFTER`; Riposte). |

## The confirm pass

One fresh reviewer, on the fix round's diff (`cddb1a7..a42cbb5`) alone.
`pnpm check` against `:8093`: 417 of 417.

**Held:** 1a, 1b (in code), 1c, 1d and V5 (by the ADR's text), 1e, 1f, 3a,
3b, 3h, V1, V6 (lower case), Q6. The spec change in `6a60947` was deliberate
and justified, not a weakening: in its own commit, every new expectation
exact, the reason written into the test, red ahead of its fix.

**One violation, a regression of the fix round (C1).** ADR-012's example line
("A Warden's Anchor or Ada's Brace would have met it") and its Consequences
("a Warden's Anchor") describe output the amended code can't produce: a
one-target card ends a fight only on the last seat standing, so its answers
are that seat's own. Beside it, borderline: the fix round recorded a swap and
every seat's Brace as tags, and a met card's line said only "It was met",
never by what (rule 34, "what it found there").

**Untested:** 1b's swap and Broken-outer-ring cases (deleting either `made`
check passes the roster).

**Weak tests:** 3d still passes a sort by amount (m 30, z 18, a 12);
3c's negative regex misses `[...state.cards].sort()`; 1a's specs keep the
seat an Echo to the end, so reading `echo` at compose time passes, and a
seated Echo's winning blow is uncovered; 3i's declarations (`x.length >= 3`;
`cause.test.ts:212` by name only); `cause.test.ts:86` can no longer fail;
3b passes a hard-coded 40 while `ENRAGE_AFTER` is 40; `contrast.test.ts:89`
takes the first matching rule; the 1b cases assert with `not.toContain`
only. Residual: `Ending.by` and `brokenBy` carry the seat id with no Echo
flag (the token in the state marks it).

### C1, fixed in the gate

A regression the fix round introduced, fixed in the gate per the rule,
with a confirm pass on that fix alone; it doesn't count as a round.

| commit | what |
| --- | --- |
| `0997580` | Spec, red: a met blow on everyone says what met it; a swapped, unbraced Eclipse says "taken on purpose" and offers the seat's Brace |
| `7ecdf63` | **Fix C1:** `sayFound` words every tag the server records; a swap isn't the target's own Brace (the second test found that bug inside C1: a swapped, unbraced Eclipse said "It was met") |
| `40b2837` | Spec corrected, in its own commit: two pinned lines named less than the card found (a Lunge also unwarded; a met Eclipse on a Braced seat) |
| `43cfdf8` | ADR-012's text: the example lines are ones the code produces (the scripted naive fight's own line, and a Lunge's), and a one-target card's answers are its seat's own |

At `43cfdf8` on `:8093`: the roster 419 of 419.

### The confirm pass on C1's fix

One fresh reviewer, on `a42cbb5..43cfdf8` alone. `pnpm check`: 419 of 419.

**Held:** C1 in code (`sayFound` words every tag; a swap isn't the
target's Brace), held by `carried-feedback-breaker.test.ts`'s two C1 cases;
both new example lines in ADR-012 are ones the code produces. `40b2837` was
deliberate and justified: both expectations stay exact and longer, each
adding the word for a tag its own set-up records.

**Findings:**

- **C2 (ADR text, introduced by `43cfdf8`).** The Consequences said a
  person hears "a Warden's Bastion" by role "because the Echo would never
  have made it"; a Warden Echo does raise Bastion (`echoes.ts:63`), and
  rule 25's person-only answers are Reactions, swaps, cancels, rings and
  Charge. Beside it, minor: the one-target prose left out the Mender's Ward,
  and listed "Warded" among words a met line names, which no ending can say.
  Outside the diff: `Ending`'s comment in `protocol.ts` omitted the
  `swapped` and `all-braced` tags.
- **A commit-history finding.** `7ecdf63` (the fix) was committed with
  `cause.test.ts:87` and `carried-feedback.test.ts:160` red until
  `40b2837` corrected them: green specs the fix turned red, not targets
  (CLAUDE.md: "Never commit a red state"). The fix round before had this
  order right (`6a60947` ahead of `066041d`).
- **Weak tests:** a met Revolution's words are unpinned (wording only a
  Perihelion's passes); "taken on purpose" and "Braced" are pinned only on an
  Eclipse.

### C2, fixed in the gate

A regression of the gate's own fix, fixed in the gate per the rule, with a
confirm pass on that fix alone.

| commit | what |
| --- | --- |
| `a4f745f` | ADR-012's text: an Echo's answer is named by its role because the line names people, not because an Echo couldn't make it; Fracture as the person-only example; the Mender's Ward among a seat's own answers; "Warded" out of the met words; and `Ending`'s comment lists every tag. Text only: no code or spec changed. |

| finding | disposition |
| --- | --- |
| C2 | **Fixed**, `a4f745f`. |
| `7ecdf63` committed red | **Recorded as history**, by the owner's ruling that a finding about the commit history is closed by being recorded: rewriting pushed history isn't done, and this record is the evidence. |
| A met Revolution's words; "taken on purpose" and "Braced" only on an Eclipse | Listed for the next phase. |

### The confirm pass on C2's fix

One fresh reviewer, on `43cfdf8..a4f745f` alone (text only).

**Held:** the one-target prose (the Mender's Ward; "Warded" out), and
`Ending`'s comment, each as the code does it.

**Findings, in the text C2 added:**

- **F1.** "A table of Echoes loses to the card only one of those meets, as a
  Breaker's Fracture meets a Perihelion": Echoes Brace for a Perihelion
  (`echoes.ts:56-59`), ADR-011 counts a Brace as meeting it, and one
  Fracture meets it only if it Breaks the ring.
- **F2.** "An Echo's seat is no person's (rule 25)": false for a seat that
  timed out, which is its person's until they act (rules 8 and 29).
- **F3, F4 (low).** A heading the body contradicted ("An Echo is never an
  answer"); "the line names the people at the table", untrue of the whole
  line.
- **Older sentences (low):** the account keeps a card only for a seat it
  downs; the ending also reads the order seats fell and the names seated;
  the phase line isn't composed from the account.
- **Context:** the Warden Echo's Bastion branch is never reached in play
  (an Echo gains no Resolve, and a timed-out seat is always Charged).

The text fix gave its sentences reasons, and the reasons were wrong twice
over (C1's example, then C2's). So this fix gives none: each sentence now
says only what `ending.ts` does.

| commit | what |
| --- | --- |
| `665b6fc` | ADR-012's text, as plain description: an Echo seat, seated or timed out, is never named as an answer's holder; an Echo's own blow or Break is said as the Echo's; the account is kept per downed seat; the ending reads the order seats fell and the names seated; the phase line isn't the account's. Text only. |

### The confirm pass on `665b6fc`

One fresh reviewer, on `a4f745f..665b6fc` alone (text only).

**Held:** F1 and F4 (closed by deletion), F2 (the Echo clause matches
`ending.ts:65, 68-72`; nothing says a timed-out seat isn't its person's), F3
(the heading and its body agree), the account's contents, the ending's
sources, and the phase line not being the account's. **No contradiction
with any rule or ADR** (rules 8, 25, 29, 34; ADR-011).

**Still open: sentences in ADR-012 the code contradicts.**

- **E1.** Consequences, first bullet: "a mechanic that changes its answer
  changes its sentence in the same commit, and the ending's spec fails if it
  doesn't." No spec checks `ANSWERS` (`ending.ts:134-157`) against the
  mechanics: if `orrery.ts:583` stopped sparing a Braced seat from a lethal
  Lunge, `cause.test.ts` would stay green and still pin "Riposte or Brace
  would have met it". In the ADR since `59f8f30`; the first reviewer didn't
  name it.
- **E2.** Consequences, third bullet: "An answer an Echo held is said by its
  role". Untrue when a person of the same role also stands (the person is
  named, `ending.ts:183-184`; an Echo can sit beside a person of its role,
  `rules.ts:778-781`), and for a blow on everyone's Brace ("every seat's
  Brace", `ending.ts:209`). §1's "or with its role when no person did" is the
  precise version.
- **E3 (low).** §1, "each named with the person … or with its role": "every
  seat's Brace" is neither.
- **E4 (outside the diff).** Consequences, second bullet: "It is written as
  cards land and read once, at the end." `noted()` writes the Chain, Breaks
  and blows at every step and reads `a.chain` each time (`rules.ts:979`,
  `ending.ts:87-102`).

Not judged as findings: the seated Echo's winning blow ("Warden Echo") has
no spec (listed already); `lastBlow` is overwritten on every blow and read
only once the Orrery has fallen.

## The gate stays open

The stopping rule closes a gate when every finding is fixed, carried red,
closed by ruling, or recorded as history, **and the last review finds no rule
or ADR violation**. The last review found no contradiction with a rule or
another ADR, but E1 to E4 are sentences of ADR-012 the code contradicts, the
same class as C1 and C2, which this gate treated as violations. They are
open, and the branch doesn't merge while they are.

**Why it stopped here rather than fixing E1 to E4.** Each text fix in this
gate gave its sentences reasons, and a reason was wrong twice running: C1's
example, then C2's. The gate's rule makes a regression of a fix round a fix
in the gate with its own confirm pass, so prose that keeps regressing keeps
the gate running. E1 to E4 are deletions or one-clause edits, not new
claims; they are left for the owner to rule on or to fix with a confirm pass
of their own.

**Proposed, not made:**

- E1: end the first Consequences bullet after "in one place each
  (`src/server/ending.ts`, `src/server/orrery.ts`)."
- E2: replace the third bullet's first sentence with "An answer is named as
  §1 says."
- E3: §1 adds "or as every seat's, for a Brace against a blow on everyone".
- E4: "It is written as the fight runs and read at the end."

**Carried red:** nothing. E1 to E4 are claims in an ADR's prose with no
behaviour to fail; there is no red test that would hold them.

**At `665b6fc`:** the roster was 419 of 419 at `43cfdf8` on `:8093`; the
commits since change ADR-012's text and one comment in `protocol.ts`, and
`pnpm typecheck` is clean. `check:viewports`, `check:keyboard` and
`check:tags` were last run at `a42cbb5`, green; nothing on the page has
changed since. Not run, because the gate didn't close: the roster on a fresh
image, the probe, the merge and the deploy.

### For the next phase

- The test strength the confirm passes listed: 3d (a sort by amount passes),
  3c (`[...state.cards].sort()` passes), 3e, 3f, 3g, 3j, 2b, 2d; 1b's swap
  and Broken-ring cases; 1a's compose-time `echo` read and the seated Echo's
  winning blow; 3i's declarations; `cause.test.ts:86`; 3b's 40;
  `contrast.test.ts:89`'s first match; the 1b cases' `not.toContain`; a met
  Revolution's words; "taken on purpose" and "Braced" beyond an Eclipse.
- Risks: V6's names that read as roles; Q1, Q2, Q5; `Ending.by` and
  `brokenBy` carrying no Echo flag; the Warden Echo's unreachable Bastion
  branch.
