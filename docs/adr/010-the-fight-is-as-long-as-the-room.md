# ADR-010: The fight is as long as the room

- **Status:** accepted.
- **Date:** 2026-10-22
- **Builds on:** ADR-006 (the strip is the play surface), ADR-007 (Echoes)
  and ADR-009 (the fight starts on a decision).
- **Amends:** the Orrery's tempo, which was a fixed rank-3 reset (21 ticks)
  whatever the room, and with it rule 13's text, since the Orrery's tick
  speed is now the room's pace and not a band of `ctb.ts`; and the starting
  values ADR-006 called "for playtesting": base HP, Echo output and the
  cards' damage.
- **Rules:** 28 is new, with `spec/pace.test.ts`, and holds the enrage (the
  owner's ruling on the lobby gate's L1); 13 says the Orrery's tick speed is
  the room's pace. The tuning values are in `src/server/tuning.ts`,
  each marked ours.

## Context

The Orrery reset to the same 21 ticks after every turn, whatever the room.
The party's turns don't work that way: every seat brings its own counter, so
a room of five takes five times as many turns between two Orrery turns as a
room of one. Measured on the engine with each seat playing its role's policy
(the scratch simulation is described under "How it was tuned"):

| room | Orrery turns | player turns per Orrery turn | phases at Orrery turn |
| --- | --- | --- | --- |
| one Striker | 7 | 3.9 | 3, 6 |
| one Mender, four Echoes added after the pull | 6 | 9.7 | 3, 4 |
| one Mender, four Echoes seated before the pull | 18 | 8.4 | 5, 11 |
| five people | 11 | 9.2 | 4, 6 |

At nine player turns to one Orrery turn, the strip's whole premise (read the
boss card, answer it) stops mattering: by the time the Orrery acts, the
room has had two rounds to finish what the card threatened. The first finding
ADR-009 answers, a solo Mender who killed the Orrery without seeing a phase,
is that table's second row: wrong HP and wrong tempo at once.

A phase change was also a log line and a small redraw. A room didn't notice
it, so the fight read as one long phase.

## Options considered for the tempo

1. **Keep the Orrery's rank and give it more HP.** A longer fight, but the
   same nine-to-one tempo, just more of it: more turns where the cards don't
   matter.
2. **Give the Orrery extra turns per round, as a raid boss gets extra
   actions.** It breaks the CTB model (rule 13): a boss that acts twice in a
   row isn't on the strip's single queue, and its second card can't be
   announced a slot ahead.
3. **Scale the Orrery's reset by the room's pace (chosen).** The Orrery stays
   one portrait on one queue, with a counter that drops by exactly 1 a tick
   (A1's model, rule 13). Only the value it resets to changes.

## Decision

### The Orrery keeps pace with the room

**After its turn, the Orrery's counter resets so that it comes round about
once per three player turns, whatever the room's size.** The reset is the
room's combined pace: each seat standing comes round once every
tickSpeed × 3 ticks at Standard rank, so a room of seats with tick speeds
t₁…tₙ takes Σ(1/tᵢ) turns per tick between them. The Orrery resets to

    max(TEMPO_MIN, round(3 × TEMPO / Σ(1/tᵢ)))

ticks: its own tickSpeed × rank, where its effective tick speed is
`TEMPO ÷ Σ(1/tᵢ)` and its rank is Standard's 3. For a room of identical
seats that is the seat's own reset × TEMPO ÷ seats, divided by the seats
present, as the brief asks. Weighting by each seat's speed instead of
counting heads keeps the ratio level across role mixes: a room of Chronists
(tick speed 4) and a room of Wardens (tick speed 8) both see the Orrery about
once per three of their turns.

- `TEMPO` (ours): **2.2**. It isn't 3, because a player turn isn't always
  Standard: Brace and Mend are rank 2, a Jab rank 1, and a Resonance refunds
  a rank. Measured over every room below, 2.2 lands the ratio at 3.2 to 3.8.
- `TEMPO_MIN` (ours): **2** ticks. A very large room of fast seats would
  otherwise give the Orrery a 1-tick reset; 2 keeps the plate from
  flickering. No room of five or fewer reaches it.
- The ratio is counted in turns, and a turn's rank is the player's choice: a
  lone Striker who only Jabs (rank 1) takes about six turns per Orrery turn,
  because each is a third of a Standard one. That is the one room outside
  the band, and it is the Quick action doing what rule 13 says it does.
- The reset is worked out from the seats standing **when the Orrery acts**,
  so a seat downed, or a late joiner (ADR-009), changes its pace from its
  next turn. Haste never touches it (rule 13): nothing hastes the Orrery.

This is still rule 1: the server computes the Orrery's reset, and the client
draws the counter it is sent.

### A target fight length

**A fight is long enough to see its phases.** Tuning target (ours):

- a solo person with four Echoes sees **at least twelve Orrery turns and all
  three phases** before an ending, in every role;
- five people take **about the same**: twelve to thirty Orrery turns.

The numbers rebalanced to that target, all ours and all in `tuning.ts`:

| value | was | now |
| --- | --- | --- |
| `ORRERY_BASE_HP` | 240 | 160 |
| `ECHO_POTENCY` | 0.5 | 0.75 |
| `CARD_DAMAGE` (scales every card's amount) | 1 | 0.5 |

Base HP falls because the Orrery now acts three times as often, so the
fight gets longer in Orrery turns while lasting about the same wall-clock
time. The cards' damage falls by about the same factor, or a room would take
three times the punishment. Echo output rises because at the old tempo the
Orrery barely touched the Echoes. At the new one they have to hold their
seats, and at half a person they couldn't.

Measured with these values on the committed engine (each seat its role's
policy, a person taking four seconds to decide). The first table this ADR
carried was measured on a scratch copy of the server, before the Orrery's
first counter was set at the room's pace too; on the committed engine five
people lost at 34 Orrery turns at the then card damage of 0.55, past the
target, so the cards were cut to 0.5 and the table re-measured:

| room | outcome | Orrery turns | phase II, III at Orrery turn | player turns per Orrery turn | wall-clock |
| --- | --- | --- | --- | --- | --- |
| Warden + four Echoes | won | 19 | 10, 14 | 3.1 | 1 min 4 s |
| Mender + four Echoes | won | 21 | 11, 17 | 3.0 | 1 min 8 s |
| Striker + four Echoes | won | 19 | 10, 12 | 3.0 | 2 min 4 s |
| Breaker + four Echoes | won | 21 | 10, 17 | 3.0 | 1 min 20 s |
| Chronist + four Echoes | won | 21 | 11, 17 | 3.0 | 1 min 24 s |
| Warden, Mender, Striker | won | 16 | 5, 11 | 3.7 | 4 min 39 s |
| Striker, Breaker, Chronist | lost | 25 | 10, 13 | 3.0 | 6 min 13 s |
| five people | won | 26 | 12, 18 | 3.1 | 6 min 6 s |

A scripted room isn't a real one: a policy never reads ahead and never
coordinates, so people should do better than these. The rooms that lose
under policy (three damage roles and nobody to heal) are meant to be hard
(ADR-006's Cost: "roles start to matter").

### The enrage: no fight may be endless

**Past forty Orrery turns, whatever the phase, the Orrery enrages.** Every
fourth card is an Alignment, as in phase III, and the third to resolve is the
wipe. The enrage clock is the Orrery's answer to a table that only defends.
A Mender who Braces and Wards can outlast cards at the room's pace
indefinitely, and a table of Echoes playing their policies (rule 25), or of
seats that timed out into them (rule 8), will. A room with a person seated
in it never expires (rule 26), so without the clock that table plays forever.
The owner's ruling on the lobby gate's L1.

- `ENRAGE_AFTER` (ours): **40** Orrery turns. It is past the target (twelve
  to thirty) so that no fight that ends on its own ever meets it: every room
  in the table above ends before turn 40, and `spec/pace.test.ts` holds that.
- It adds no card, event or renderer. It uses the Grand Alignment's own card,
  its `alignment` event and the strip's clock (drawn from the state's
  `alignmentLeft`), so a table sees the enrage coming exactly as it sees
  phase III's. Only the trigger is new.
- Its count starts afresh when the clock begins it, so its first Alignment
  is the fourth card of the rotation, as phase III's is (a Perihelion, the
  Orrery's other cadence, isn't counted, in either).
- Played by the policies, rooms of one to three seats that never ended went
  from 6 of 30 (3 before this pass) to 0. Those six are wiped at Orrery turn
  55 or 56. A seventh room runs past the clock: a Mender, Breaker and
  Chronist, which ended on its own before this pass, lost at 75 Orrery
  turns, and now meets the clock and is wiped at 48. That is the cost below,
  in one measured room. Every room that ends before turn 40 is unchanged.
- **The fight log says so.** Every Alignment the clock began says the Orrery
  "has turned 40 times and will be outlasted no longer", whatever phase it
  lands in, so a table that crosses into phase III after the clock is still
  told why it was wiped (the confirm pass's F1). Phase III's own entry line
  says the Grand Alignment, "already begun by the clock, goes on".

**The cost.** A slow table that is winning can still be wiped: a table that
hasn't brought the Orrery below 35% by turn 40 meets the wipe about twelve
Orrery turns later, around turn 52 to 56 (four cards to an Alignment,
three Alignments), however close it was. The clock is visible from the first
Alignment card on, and so is the strip's countdown to the wipe, so the
table can see it coming and race it. But a fight that runs long now ends in
a loss, not a win. That is the trade for no fight being endless.

### A phase change is a moment

**Crossing a phase line stops the table for a beat, on every screen.** The
server's `phase` event now carries the phase's name. A phase card is drawn on
the strip in the boss cards' row, and the client draws, in order:

- **hit-stop**, the frames' freeze on impact (motion);
- **a flash on the Orrery's rings** (state: a one-frame flash);
- **the rings visibly reconfigure** to the new phase's look (state);
- **a title across the field in the pixel display face**: "Phase II:
  Conjunction", "Phase III: the Grand Alignment" (state);
- **a sound**, its own cue (`phase`).

Under reduced motion the hit-stop and the spin go, and the title, the ring
change, the flash's single static frame and the phase card all still show.
The title is the scene's `title()` (state), the card is the strip's
`phaseCard()` (state), and both are declared in the registry's expected state
so `spec/effects.test.ts` holds them.

## How it was tuned

A scratch simulation (kept out of the repo, because it is a measuring tool
and not a sensor) drove the pure engine (`rules.ts`) through whole fights:
every person on the plate plays their role's Echo policy at full output after
four seconds, and every Echo is played by the clock as live. It ran each room
under a grid of tempo, HP, damage and Echo output. The numbers above are its
output at the chosen values. `spec/pace.test.ts` holds the target
and the band on the same engine, so retuning that breaks them goes red.

## Cost

- **More boss turns means more boss cards on the strip.** The strip shows
  the next two Orrery turns plus a Perihelion, and those turns now come about
  three times as often. Rooms will see more cards land. That is the intent,
  but it is three times the reading load per minute.
- **The Orrery's pace now depends on who is standing.** A downed seat makes
  the Orrery slower, which softens a wipe a little. A late joiner makes it
  faster. Both happen from its next reset, never mid-counter, so the strip
  never jumps.
- **Echoes hit harder** (0.75 of a person, not 0.5). A solo player's four
  Echoes do more of the fight than before. ADR-007's Cost already says an
  Echo table is a floor, not the point, and the README says so.
- **The numbers are still starting values.** The target is in the spec, so
  retuning stays honest, but the values themselves are ours.
