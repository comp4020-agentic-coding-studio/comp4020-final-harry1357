# ADR-010: The fight is as long as the room

- **Status:** accepted.
- **Date:** 2026-10-22
- **Builds on:** ADR-006 (the strip is the play surface), ADR-007 (Echoes)
  and ADR-009 (the fight starts on a decision).
- **Amends:** the Orrery's tempo, which was a fixed rank-3 reset (21 ticks)
  whatever the room, and the starting values ADR-006 called "for
  playtesting": base HP, Echo output and the cards' damage.
- **Rules:** 28 is new, with `spec/pace.test.ts`. The tuning values are in `src/server/tuning.ts`,
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
| `CARD_DAMAGE` (scales every card's amount) | 1 | 0.55 |

Base HP falls because the Orrery now acts three times as often, so the
fight gets longer in Orrery turns while lasting about the same wall-clock
time. The cards' damage falls by about the same factor, or a room would take
three times the punishment. Echo output rises because at the old tempo the
Orrery barely touched the Echoes. At the new one they have to hold their
seats, and at half a person they couldn't.

Measured with these values (each seat its role's policy, a person taking
four seconds to decide):

| room | outcome | Orrery turns | phase II, III at Orrery turn | player turns per Orrery turn | wall-clock |
| --- | --- | --- | --- | --- | --- |
| Warden + four Echoes | won | 19 | 8, 12 | 3.4 | 1 min 21 s |
| Mender + four Echoes | won | 24 | 9, 15 | 3.4 | 1 min 34 s |
| Striker + four Echoes | won | 17 | 8, 12 | 3.4 | 2 min 14 s |
| Breaker + four Echoes | won | 21 | 8, 15 | 3.4 | 1 min 38 s |
| Chronist + four Echoes | won | 24 | 9, 15 | 3.3 | 1 min 50 s |
| Warden, Mender, Striker | won | 16 | 4, 10 | 3.8 | 4 min 54 s |
| five people | won | 24 | 10, 17 | 3.4 | 6 min 20 s |

A scripted room isn't a real one: a policy never reads ahead and never
coordinates, so people should do better than these. The rooms that lose
under policy (three damage roles and nobody to heal) are meant to be hard
(ADR-006's Cost: "roles start to matter").

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
