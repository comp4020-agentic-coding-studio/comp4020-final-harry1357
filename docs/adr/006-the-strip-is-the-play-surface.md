# ADR-006: The strip is the play surface

- **Status:** accepted.
- **Date:** 2026-10-15
- **Builds on:** ADR-001 (one process, one tick), ADR-002 (a room can't wait on
  one person) and ADR-005 (two at once, the clock decides). The research behind
  it is `docs/design/overhaul.md`.

## Context

The first battle screen shows the fight. Every event is drawn before it is
logged, the turn strip is the server's queue in the order sent, and another
player's screen shows a strike within one tick. But showing the fight was never
the same as the fight being worth showing. Every turn is Strike or Brace, and
nothing in the situation changes which of them is right. The strip is something
you watch, not something you play.

The design record's finding is that interesting decisions are situational and
must have visible consequences (Sid Meier, GDC 2012, `docs/design/overhaul.md`
§1). A choice where everyone picks the same button isn't a choice. The systems
in the reference games that do this well (FFX's Rank, Persona and SMT's
extra-turn economies, Octopath's Break, Slay the Spire's and Into the Breach's
telegraphed intents) all work the same way: the player can see something
coming, and spends a turn answering it.

The same fault shows in the boss's hit points. Today the Orrery starts at 100
and gains 140 for every character who joins, linearly. A room of ten fights
exactly as long as one person does, and more people make the fight longer, not
different. The README already says this is the answer being replaced.

## Options considered for the surface

1. **Keep Strike and Brace and add damage variety.** Elements, crits,
   weaknesses on the Orrery. The numbers change and the choice doesn't: the
   right button is still whichever hits hardest, and the strip is still a
   display.
2. **A real-time layer.** Dodges, timed presses, quick-time events over the
   CTB queue. It adds pressure, but it moves the decision from what to do to how
   fast your thumbs are. It also fights the one thing the app rests on, that
   the server's tick decides order (rule 1, ADR-005), and it punishes a slow
   link.
3. **Make the strip the play surface (chosen).** Every role has an action that
   changes the strip, every boss attack is announced on it before it lands,
   and the action economy pays for reading it.

## Options considered for the Orrery's HP

1. **Fixed.** One number for any room. A room of twelve deletes the boss in a
   round, and a room of one can't finish it.
2. **Linear per joiner.** The current rule: base plus a fixed amount per
   character. A room fights exactly as long as one person does, which is the
   fault, not a fix.
3. **Set at the pull from the seats present, sub-linearly (chosen).**

## Decision

The strip is the play surface. Three rules carry it:

- **Every role gets one action that changes the turn strip.** It moves an ally
  up, pushes a boss card back, links player turns together, or freezes a boss
  card. Which one is right depends on what the strip shows.
- **Every boss attack appears on the strip as a card before it resolves,** with
  an intent icon, a target and a countdown. Nothing the Orrery does arrives
  unannounced, and the answers to it are role-gated: a Warden intercepts, a
  Mender wards, a Chronist delays, a Breaker shatters a shield.
- **The action economy rewards reading the strip.** A weakness hit refunds a
  rank and the portrait jumps forward (Resonance). Consecutive player turns
  with no boss card between them form a Chain. Exposed stacks are set by one
  player and spent by another. The turn you choose, and when you take it, both
  matter.

The battle screen stands. The strip and the command window gain content: boss
cards, chain links, stacks, previews and the new actions. The scene does not
change.

The Orrery's HP is set once, at the pull, from the seats present, and grows
more slowly than the room does (base × seats^0.75). A bigger room is slightly
favoured, as in WoW's flexible raids, and difficulty comes from the mechanics,
never from hit points alone. The rules themselves are written into CLAUDE.md
as things the app must hold to, and each is a spec test before it is code.

## The pull

Setting the Orrery's HP at the pull, from the seats present, has a
consequence: the fight can't begin the moment the first person sits down, or
it is always pulled for one. So the room is given time to sit down before the
HP is fixed.

The countdown starts at the first seat and runs ten seconds. Whenever a new
seat joins during it, it restarts to ten seconds, so a room arriving together
is counted together. It never runs past thirty seconds from the first seat:
after that it pulls regardless, so a steady trickle of arrivals can't hold the
fight off for ever. A late joiner after the pull takes a seat but doesn't
change the HP (rule 20); the next fight is pulled for the room as it then is.

The countdown is wall-clock time, not ticks. One tick is 150 ms live
(`TICK_MS`), so the old 20-tick countdown was three seconds, too short for a
room to sit down. A tick is also 5 ms in a fast spec, and the countdown has to
mean ten seconds in both, so it is measured on the clock the caller supplies.
`spec/pull.test.ts` holds the restart and the cap.

**No timeout-Echo can exist at the pull.** An Echo is a character who has
timed out three turns in a row, which takes three twelve-second turns of a
fight already under way. At the pull nobody has had a turn, so every seat
counts whole. The half-seat rule (rule 20) is for Echoes seated
deliberately, which arrive in phase one-b as ADR-007. It does not act in this
phase.

The pull is a state change, so it is shown before it is logged (rule 11): the
server emits a `pull` event with the seats counted and the HP set, and
`spec/effects.test.ts` is red for it until the client has a pull card to draw.

## The Echo

A seat that times out three turns in a row becomes an Echo: the server plays
it, at low output, until its person comes back (rule 8). **This reverses
ADR-002**, which rejected acting for an absent player ("the server is now
making choices in someone's name") and decided a timeout should choose
nothing and deal nothing.

The reason: in a room of five, a dead seat holds the fight worse than a bot
does. ADR-002's answer to a seat nobody plays was to send it away after two
holds, which empties the table and, under the pull (above), would leave the
Orrery scaled for people who are gone. An Echo keeps the seat in the fight,
taking its place in the turn order and dealing a little, so the room isn't
playing around a hole.

An Echo has to be reclaimable, or it's just a slower way of being sent away.
So when an Echo reaches the plate it waits a three-second beat
(`ECHO_BEAT_MS`) before the server plays it. Its person's portrait lights for
them, and any action from them in that window is an ordinary turn that ends
the Echo and plays as theirs. Otherwise the server plays the Echo. Nothing
happens off-turn: the beat is the Echo's own turn on the plate, so rule 2 (an
action is never queued, and the command window is live only on your turn)
stands. Without the beat an Echo was played the instant it arrived and could
never be ended in a running fight (review F3).

**The cost** is that a person's record could show turns they didn't take, which
is exactly what ADR-002 objected to. So an Echo's turns are the Echo's: they
are logged as the Echo's ("The Echo of …"), never counted in the person's
record (no turns, no damage credited to them), and shown as the Echo's on the
strip. The first two are held by `spec/echo.test.ts`. Drawing the Echo on the
strip is client work, carried into phase two (docs/review/phase-one.md).

**A second cost: the beat stops the table's clock** for its three seconds on
every Echo turn, for as long as the person is gone. That is the cost ADR-002's
option 3 was rejected for ("keeps costing the table one full timeout every
cycle, forever"; review R3). It is accepted here because it is a quarter of
what option 3 cost: three seconds against a whole twelve-second turn, and
an Echo, unlike a held seat, still acts when its beat runs out. A table of
Echoes therefore keeps moving, at about a beat per Echo per cycle. The beat is
set by `ECHO_BEAT_MS`, so it can be cut if a room finds it slow.

## Cost

- **More rules to teach, without a tutorial.** Ranks, Resonance, Chains,
  Exposed, Charge, Reactions and boss cards are a lot for a room that hasn't
  played before, and there is no time at a showcase to explain them. So the
  strip itself has to teach them: a boss card shows what it will do, to whom
  and when; a preview shows where your portrait will land; a stack shows who
  set it. If a rule can't be read off the strip, it isn't finished.
- **More for the client to draw.** Every new mechanic needs a renderer before
  it ships (rule 11). The strip and the command window are where the work moves.
- **Roles start to matter.** A room of five Strikers will do worse than a mixed
  room. That is intended (`docs/design/overhaul.md` §5), but no single role is
  made mandatory to win.
- **The numbers are starting values.** Timers, percentages and pip counts are
  for playtesting, not findings (`docs/design/overhaul.md`, Caveats).
