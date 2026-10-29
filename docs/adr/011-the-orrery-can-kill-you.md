# ADR-011: The Orrery can kill you

- **Status:** accepted.
- **Date:** 2026-10-29
- **Builds on:** ADR-006 (the strip is the play surface), ADR-007 (Echoes),
  ADR-009 (the fight starts on a decision) and ADR-010 (the fight is as long
  as the room).
- **Amends:** what an unanswered card costs (the teeth, below), ADR-006's
  Reaction (one role had one; every role now does), Charge (banked, never
  spent; now spent), the rings' weaknesses (fixed for the fight; now
  reshuffled each phase), and the Echo's policy (rule 25: which answers are a
  person's).
- **Rules:** 17, 18 and 25 change text, each in its own commit; 33 is new,
  held by `spec/difficulty.test.ts`. The tuning values are in
  `src/server/tuning.ts` and `src/server/orrery.ts`, each marked ours.

## Context

Two findings in `docs/features-rice.md`, from playing the deployed build:

- **Item 18.** A solo player whose every click was Brace won with four Echoes:
  38 Orrery turns, all three phases, carried at 0.75 output. Measured on the
  engine before this ADR, a Brace-only person with four Echoes **won in four
  roles of five** (only the Striker's table lost, at the enrage). A floor with
  no stakes teaches nothing.
- **Items 8, 14 and 9.** Three rules promised mechanics the code didn't have.
  Rule 17's Charge was banked and never spent. Rule 18 gave every player a
  Reaction, and one role in five had one. The server took a ring as a
  target, and the client never offered one.

Measured before this ADR, over the thirty-one rooms below, a table playing
**naive**ly won 10 of 31, **competent**ly 14, and **expert**ly 19. Knowing
the mechanics was worth nine rooms in thirty-one. The cards hurt; they didn't
decide.

## The question

**Difficulty is the cost of not knowing the mechanics, measured, not felt.**
Not "the Orrery hits harder", which punishes everyone alike, but: a table
that doesn't read the strip loses, a table that plays the Echo's policy wins
some, and a table that reads the strip and answers it wins almost always.

## Options considered

1. **More HP, harder cards.** Every table loses more, and the gap between
   knowing and not knowing stays nine rooms wide. Rejected: it makes the fight
   longer, not more legible.
2. **Lower `ECHO_POTENCY` at a solo table (item 18's first suggestion).** It
   fixes the Brace-only solo player by making Echoes weaker, which also
   makes the expert's solo table weaker, and ADR-007's floor says a solo
   person can win. Rejected as the main lever; it would still be the knob if
   the teeth weren't enough.
3. **Cards that kill when nobody answers them, answers that are a person's
   (chosen).** Item 18's second suggestion: give Echoes nothing to do against
   a card only a person answers. The four teeth below are already the
   design record's (docs/design/overhaul.md, Priority 3); this ADR gives them
   their full weight, and gives every role a Reaction that answers one.

## Decision

### The policies, and what is measured

Three scripted players per role are test fixtures (`spec/difficulty/`). They
read only the state every client is sent, as an Echo does (rule 25), and every
move goes through the engine's `checkAction`, as a person's does.

- **naive** plays its role's highest-damage card at the Orrery's default ring
  every turn, and never braces, swaps, cancels, reacts or chooses a ring. (A
  role with no blow plays the action whose label sounds biggest: the Mender
  Mends, the Breaker Pries or Marks, the Chronist Hastes or Relays.)
- **competent** is the Echo's policy, at a person's output.
- **expert** reads the strip: it chains, takes its Reaction against every card
  the server names, hits the revealed weakness by naming the ring, swaps a
  Gravity Lunge with Anchor, cancels Retrograde with Delay or Stillpoint,
  meets Perihelion with Bastion and a Break, and spends Charge on its
  signature move.

**The rooms.** Every set of distinct roles from one to five seats: thirty-one
rooms. The brief asked for thirty; the natural set of one to five seats is
thirty-one, and none of it is dropped. A room is all one level. The targets,
held by deterministic engine tests with no wall clock (`spec/difficulty.test.ts`):

| table | target |
| --- | --- |
| naive | wipes before phase III in at least 25 of 31 |
| competent | wins between 10 and 20 of 31 |
| expert | wins at least 25 of 31 |
| a solo Brace-only person, four Echoes | wipes before phase III, in every role |
| a solo expert, four Echoes | wins, in every role |

ADR-010's pace band and the forty-turn enrage stay, held by
`spec/pace.test.ts` as before.

### The teeth

Each is one spec in `spec/difficulty.test.ts` that names the mechanic and
the seat, so the fight can later say what killed you.

1. **Gravity.** A Lunge on a seat that hasn't been swapped, and that isn't
   Braced, downs it once it carries Gravity: from the **second** stack
   (`GRAVITY_LETHAL`, 2, was 3), the Lunge takes everything. Bracing halves it
   instead (the seat survives on its HP); a Warden's Anchor or Intercept
   swaps it. **A blow a Warden takes on purpose is never lethal**: that is
   the swap. A Ward takes it, as before.
2. **Perihelion.** Unmet, it deals its full amount to every seat, and that
   amount is now the whole party's death (`AMOUNT.perihelion`). Met is any of:
   the outer ring Broken (halves it), a Bastion (takes 40% off), Brace (halves
   it for the seat). A table that Breaks and Bastions survives it; one that
   does nothing doesn't.
3. **Retrograde.** Uncancelled, it costs the table **a full rotation of the
   strip**: every seat's counter is set back by a whole Standard turn of its
   own, after the five-slot flip. The Orrery's counter isn't touched (rule 1:
   the Orrery never moves faster; the table moves slower), so the Orrery's
   next turns come before the table's. A Chronist's Delay or Stillpoint
   cancels it, as before.
4. **Eclipse.** On a seat that isn't Warded, it downs it. A Ward takes it. A
   Brace doesn't: an Eclipse is a shadow, not a blow.
5. **The Grand Alignment's third card wipes**, as now.

### Every role has one Reaction

Rule 18 has always promised every player one Reaction per boss turn, off a
telegraphed card. The Warden's Intercept is the model: rank 0, taken out of
turn, against the card the server names (the token's `reactionCard`, rule 2),
once between two boss turns. The other four, chosen from item 14's
candidates or better, each answering the card that most threatens what that
role is for:

- **Mender: Veil**, against a single-target blow (an Eclipse or a Lunge) aimed
  at anyone standing: the target is Warded now. Item 14's candidate was a
  "Brace-for-ally"; Veil is a Ward instead, because a Ward is what answers
  an Eclipse and a Brace isn't.
- **Striker: Riposte**, against a blow aimed at the Striker (an Eclipse, a
  Lunge): the Striker braces and is Warded, and the Orrery takes a
  counter-blow. Item 14's candidate, kept: the hitter's answer is to hit.
- **Breaker: Fracture**, against a raid-wide card (a Revolution, a
  Perihelion): the outer ring loses `FRACTURE_PIPS` shield pips, and if that
  Breaks it, the Perihelion halves. Better than item 14's "Read, which shows
  a card's amount early": the amount is already on the card.
- **Chronist: Nudge**, against any card: the card is pushed back one slot, and
  a Nudged Retrograde comes apart, as a Delayed one does. Item 14's
  candidate, kept: the time role's answer is time.

**Every Reaction stings.** A Reaction taken against a card deals the Orrery a
small counter-blow, `REACTION_STING` × the role's power. That gives the three
roles with no blow of their own a way to hurt the Orrery that only knowing
play reaches: a naive table never reacts, and neither does an Echo.

**A Reaction against a blow aimed at you Wards you.** Veil answers anyone's;
Intercept, Riposte and Nudge, taken against a card aimed at the reactor, leave
them Warded too, so an Eclipse on a seat that reacts to it is met. This is
what keeps the Mender from being mandatory (WoW's "bring the player, not the
class", the design record's lesson 5): a table without one survives Eclipse
by reacting, not by being lucky.

### Charge spends on each role's signature move

Rule 17's Charge (banked by Brace, at most 3) is now spent. Each role's
signature move, the one the join screen names, empties it and adds
`CHARGE_POTENCY` potency per pip:

| role | signature | Charge adds |
| --- | --- | --- |
| Warden | Bastion | a deeper cut, `BASTION_CUT` + `CHARGE_BASTION` per pip |
| Mender | Restore | more HP back, a quarter of max per pip |
| Striker | Finisher | potency per pip |
| Breaker | Shatter | the Break's push: one more slot per pip |
| Chronist | Stillpoint | its Flux cost falls by one per pip |

The `finisher`, `bastion`, `restore`, `shatter` and `stillpoint` events carry
`charge`, the pips spent, so the screen can draw the spend before the log
says it (rule 11).

### The ring step

The command window adds a ring step for every action aimed at the Orrery: the
three rings, starting on the ring the server's preview would take
(`state.preview.actions[a].target`), Broken ones offered too. It decides
nothing: the server takes or refuses the ring named. An action whose ring the
server wouldn't take is refused with the server's own reason (400 for a ring
that isn't one; 409 for one it won't take now).

### Weaknesses re-hide and reshuffle each phase

At each phase change, every ring's weakness is hidden again and the three
elements are dealt to the rings anew (a rotation chosen by the phase and the
pull's seats, so it is the same every run of the same room: no randomness,
ADR-001). The Breaker has a job in every phase, and the phase moment changes
the fight, not just the look. The `phase` event carries `reshuffled: true`, and
the screen hides the rings' glyphs when it draws it.

### Echoes play their job, not the fight

An Echo heals, tanks, strikes, scans and delays by its policy. It **never**
takes a Reaction, never swaps on Gravity (Anchor), never cancels Retrograde
(Delay or Stillpoint at one), never chooses a ring, and never spends Charge
(its signature moves wait until it has none). Those answers are a person's.
Rule 25 says so, and `spec/echoes.test.ts` pins each.

**ADR-007's floor still holds**: a solo expert with four Echoes wins, in every
role, because the expert answers what the Echoes don't. A solo Brace-only
player with four Echoes wipes before phase III, because the cards that kill
are the cards Echoes don't answer.

## Consequences

- **A naive table loses.** A first-time visitor at the public raid will lose
  their first fight unless someone at the table reads the strip. That is the
  point, and it needs the strip to teach: items 7, 11, 12, 13 and 17 in
  `docs/features-rice.md` (hints, Echoes that say why, a how-to-play sheet, a
  glyph glossary, a phase moment that says what changed) move up the list.
- **A solo table needs its player.** Four Echoes alone lose to the first
  Gravity Lunge on a seat that isn't swapped; the person has to Anchor,
  Intercept, Veil, Riposte or Nudge it.
- **The Warden's Echo gives up its Intercept** (rule 25's old exception). A
  table that relied on it, any table with a Warden Echo, takes more Lunges.
  The measurement below includes that.
- **The numbers are ours.** Every value in `tuning.ts` that this ADR adds or
  changes is marked so, and was chosen by the measurement below, not by
  feel.

## How it was tuned

A scratch simulator (`.data/tune.ts`, not committed) played every target at
once on the engine; each change was measured against all five before it was
kept. The final values and the measured results are in
`docs/review/difficulty.md`, and `spec/difficulty.test.ts` holds the targets,
not the values.
