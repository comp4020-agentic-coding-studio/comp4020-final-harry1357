# ADR-012: The fight tells you what happened

- **Status:** accepted.
- **Date:** 2026-11-07
- **Builds on:** ADR-006 (the strip is the play surface), ADR-010 (a phase is
  a moment) and ADR-011 (the Orrery can kill you; its teeth name the
  mechanic and the seat).
- **Rules:** 34 is new. Rules 1, 2 and 11 hold every piece: the server says
  what happened, the client draws it, and nothing is enabled by advice.

## Context

ADR-011 made a naive table lose, on purpose, and said what that costs: "it
needs the strip to teach". Its Consequences moved five items up
`docs/features-rice.md`. Three of them are this pass:

- **Item 7, a hint for every role.** The command window holds one hint, the
  Warden's Bastion while a Perihelion is coming. The other four roles have
  none.
- **Item 10, your next card, pinned.** The strip truncates its cards at
  1920×1080 and hides most targets at 390×844, so the card that is about to
  down you is one you have to find.
- **Item 17, the phase moment says what changed.** A phase change stops the
  screen and names itself, and doesn't say what the new phase does.

And one the brief adds, which ADR-011 promised: each tooth's spec names the
mechanic and the seat "so the fight can later say what killed you". The end
panel says "Defeat" and nothing else. Measured on the engine before this ADR,
a solo naive Breaker with four Echoes loses on Orrery turn 15 to an unmet
Perihelion; the panel says the Orrery keeps turning.

## Decision

### 1. The ending names its cause

The server keeps an account of the fight as it runs (`Battle.account`): for
each boss card as it lands, what it found on the seat it landed on (the
Gravity carried in, a Brace, a Ward, a Warden's swap, a standing Bastion, the
outer ring Broken, the clock's enrage); which card downed whom; who Broke each
ring; the longest Chain; and the blow that took the Orrery's last HP.

When a fight ends, the server composes an `Ending` from that account and
nothing else, and sends it twice: on the `end` event and on the state
(`BattleState.ending`), so a page that arrives after the end reads the same
words. It carries:

- **lost:** the card that downed the table's last seat, its target (a seat,
  or `party` for a card on everyone), what it found there, and **the answers
  the table had**, taken from ADR-011's teeth, each named with the person at
  this table who held it, or with its role when no person did. An Echo is
  never named as an answer, because it never makes one (rule 25).

  | the card | its answers (ADR-011) |
  | --- | --- |
  | a lethal Lunge | a Warden's Anchor or Intercept (the swap), a Mender's Ward or Veil, the seat's own Brace |
  | a whole Eclipse | a Mender's Ward or Veil, a Warden's Anchor or Intercept, the seat's own Brace |
  | an unmet Perihelion | a Warden's Bastion, a Breaker's Break (Shatter, Fracture), a Brace |
  | a Revolution | a Warden's Bastion, a Brace |
  | the third Alignment | none: the Orrery has to fall first, and the line says if the clock began it |

- **won:** the blow that ended it (who struck it, with what, on which ring),
  who Broke that ring if it was Broken, and the longest Chain.
- **abandoned:** the line the server already writes.

`Ending.line` is that, in plain words, composed by the server: "Lunge landed
on Ada at Gravity 2, unbraced. A Warden's Anchor or Ada's Brace would have
met it." The end renderer draws it under the outcome's banner, and the end
panel and the lobby's last-fight line print it before Start is offered
again. **The client composes no part of it.** The `end` log line carries it
too, so a finished fight's log, read after a restart, says what ended it.

### 2. The phase moment says what changed

The `phase` event carries `change`: one line, the server's, in the game's
words. Phase II: "Conjunction: the Orrery flips the strip; a Chronist cancels
it. Every weakness hides again." Phase III: "The Grand Alignment: every
fourth card is an Alignment, and the third wipes the table. Every weakness
hides again." The scene's title draws it under the phase's name, in both
variants, and holds long enough to read.

### 3. A hint for every role

`src/client/command/prompts.ts` reads the state every client is sent and
nothing else, as the Bastion prompt does, and writes one note per role on the
command it asks for:

| role | when the state shows | the note, on |
| --- | --- | --- |
| Warden | a Lunge on the strip aimed at an ally carrying Gravity | Anchor |
| Mender | a Lunge or Eclipse aimed at a seat that isn't Warded | Ward |
| Striker | a Broken ring | Finisher |
| Breaker | a revealed weakness on a ring that still has a shield | Pry |
| Chronist | a Retrograde on the strip | Delay |

**A hint is advice.** It changes the words on an option and nothing about
whether the option is live: the turn's actions are live while the server says
it is your turn, a Reaction while it names a card (rule 2). A spec holds
that a window told every hint accepts exactly what it accepts told none.

### 4. Your next card, pinned

When a card on the strip is aimed at your seat, the command window shows it
above the commands, soonest first, with its countdown and its amount, in
`--ember` ("Lunge in 1 → you, 8"). It is read from `state.cards` as sent:
the client orders nothing (rule 1) and decides nothing about it.

### What a renderer is here

Pieces 1 and 2 are events (`end`, `phase`): each has a renderer in the
registry and a declared expected state (`scene.cause`; `scene.title` with its
line), held by `spec/effects.test.ts`. Pieces 3 and 4 are state, drawn by the
command window on every message as its meters are; their renderer is the
window, and their declared state is the hook their spec holds
(`[data-prompt]` with its note; `[data-threat]`).

## Consequences

- **The server's sentences are a contract.** The ending's line and the phase's
  line are composed in one place each (`src/server/ending.ts`,
  `src/server/orrery.ts`), from the account, so a mechanic that changes its
  answer changes its sentence in the same commit, and the ending's spec fails
  if it doesn't.
- **The account is memory, not a source of truth.** It is written as cards
  land and read once, at the end. Nothing decides a turn from it (rule 5);
  it is not persisted beyond the `end` line, and a fight closed by a restart
  gets the restart's line, as before (rule 6).
- **An Echo is never an answer.** A solo person whose last seat was an Echo
  hears the role's answer ("a Warden's Anchor"), not the Echo's, because the
  Echo would never have made it. That is the lesson ADR-011 wanted taught.
- **The command window grows a line.** At 390×844 it is one more row above
  the commands, present only while a card is aimed at you; the viewport and
  tag checks hold it.
