# ADR-002: A room can't wait on one person

- **Status:** accepted. Partly superseded by ADR-006 (timeouts now Brace and
  can Echo; nobody leaves on a timeout). The twenty-second figure became
  twelve seconds under ADR-006. Its "never act in an absent player's name" is
  reversed by ADR-006 ("The Echo"): an Echo the server plays, which its person
  can reclaim in a three-second beat, and whose turns are never counted in
  their record. The reason a room can't wait on one person still stands.
- **Date:** 2026-10-01
- **Builds on:** ADR-001 (one process, one tick).

## Context

CTB stops the clock while a combatant is on the strike plate. That is the
game: nobody acts out of turn, and the person whose turn it is gets to think.
But the clock is shared. While one person deliberates, everyone at the table
waits, and in a room the usual reason for a long wait isn't deliberation. The
person put their phone down, closed the tab, or walked to the next stand at
the showcase. Nothing tells the server which of those happened. Sockets here
are anonymous, a one-way broadcast (ADR-001), so a closed tab isn't tied to a
character.

Two other things scale with the number of people, and v1 handled both crudely:

- **Pacing.** One absent person can freeze the fight for everyone else.
- **Difficulty.** The Orrery has to be a fight for one person and for five.
  v1 gives it 100 hp plus 140 for every character who joins.

## Options considered (pacing)

1. **No timeout.** The clock waits forever. This is the purest CTB, and in a
   room it fails completely: one closed tab freezes the table, and the only
   remedy is everyone leaving.
2. **Act for them.** After a timeout the server picks a real action for the
   absent person (a strike, say). The fight keeps moving, but the server is now
   making choices in someone's name, and a "you" who strikes while you're away
   gets credited with damage you didn't choose. It also blurs rule 1: the
   server owns turn *order*, not what a person chooses to do.
3. **Hold forever.** After a timeout the server takes a *hold* (no effect, the
   turn passes) and the person stays. Nobody is impersonated. But a departed
   player keeps costing the table one full timeout every cycle, forever, and
   the queue fills with ghosts.
4. **Hold, then leave (chosen).** After `TURN_TIMEOUT_MS` (20 s) the server
   takes a hold: no damage, no heal, nothing chosen, and a rank-3 reset so the
   person drops back down the rail like anyone who just acted. Two holds in a
   row and they leave the battle: off the rail, into the fallen list, logged
   as "stepped away from the table". Acting at all resets the count. A person
   who left can rejoin from the same session, keeping the hp they left with,
   at a new seat.
5. **Presence from the socket.** Leave when the socket closes. This is the
   right signal eventually, but the socket carries no identity yet, a phone
   locking its screen closes it while the person is still present, and it
   would need an authenticated socket. That's week 10 material at the
   earliest.

## Decision

Option 4. A hold is the *least* the server can do on someone's behalf that
still lets the room move: it chooses nothing, deals nothing, heals nothing.
Two in a row is the shortest pattern that tells "slow" apart from "gone". One
hold can be a long think or a text message; two consecutive holds, 40 seconds
of nothing across two separate turns, is someone who isn't there.

**The Orrery's scaling** stays at 100 + 140 hp per joiner, explicitly as a
placeholder. In week 10 it is replaced by *composition-aware* behaviour: the
Orrery's script reads who is standing *now* (how many, which roles, who is
braced or hasted) rather than counting how many people ever sat down. The
three-branch script is where that belongs. The shape of a fight should change
because of who is at the table, not just how long the health bar is.

## Cost

- **A slow reader gets held.** Twenty seconds is short for someone new reading
  four action blurbs. The countdown is on screen, and a hold costs only a turn,
  not the seat, but it will feel abrupt the first time. Tune
  `TURN_TIMEOUT_MS` from what crit 8 shows, not from guesses.
- **An absent player costs the table up to 40 s** (two timeouts) before they
  leave. With three absent players that is two minutes of a frozen rail. The
  rule bounds the damage; it doesn't remove it.
- **The timer is wall-clock, not ticks.** It is the one place where real time,
  not the queue, decides something. It decides only *that* a turn passes,
  never *who* goes next. Order still comes from the counters.
- **Per-joiner hp is wrong in both directions.** Joining adds 140 hp, but
  leaving or falling takes none away (and rejoining adds none), so a table that
  shrinks fights an Orrery sized for the table it used to be. That's
  acceptable for a week, and it's why it's on a deadline.
- **Holds are logged and durable** (rule 5), so a log can show someone timing
  out, which some people might find unkind. It's also honest, and the log is
  the only record of why the fight went the way it did.

`spec/pacing.test.ts` holds the rule: a hold chooses nothing, two in a row and
you leave, and acting in between resets the count.
