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
