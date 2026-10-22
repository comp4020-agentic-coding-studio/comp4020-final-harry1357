# ADR-009: The fight starts on a decision, not a timer

- **Status:** accepted.
- **Date:** 2026-10-22
- **Builds on:** ADR-006 (the strip is the play surface, and its pull) and
  ADR-007 (a room is a code, a bot is an Echo).
- **Amends:** ADR-006's "The pull" (the countdown, and "a late joiner after
  the pull … doesn't change the HP"); ADR-007's Echo seating ("seated on
  purpose by whoever's in the room", now only in a private room's lobby, by
  its host); and ADR-007's "There is no owner" and rule 22's "nothing owns
  one", which a host qualifies without breaking: a host's only say is Start
  and the Echoes, in the lobby, and it passes on (rule 22 says so, since the
  lobby gate).
- **Rules:** 20 and 25 change with it; 27 is new; 22 says what a host is.
  Each change to a rule's text should be its own commit. (The first one,
  `0880745`, changed 20, 25, 27 and 28 together; the lobby gate's reviewer
  recorded it, and later changes were made one at a time.)

## Context

Two findings from play, both from the same cause.

1. **A solo Mender with four Echoes, added after the pull, killed the Orrery
   in a few turns without seeing a phase.** The pull fired ten seconds after
   the Mender sat down, alone, so the Orrery woke at one seat's HP (240). The
   Echoes the Mender then seated were extra seats in a fight already sized
   for one. Rule 20 says so on purpose ("a late joiner does not change a
   running fight's HP"), and the result was an Orrery that went from phase I
   to dead in six of its own turns.
2. **Creating a room dropped the creator straight into a fight sized for
   one, with the previous fight's victory text still on screen.** Same
   countdown, same one seat. The stale text is a client bug (ADR-010's spec
   holds it), but what was underneath it is this ADR's: a room with nobody
   else in it yet was already fighting.

The countdown was always a guess at when a table has finished arriving: ten
seconds from the last seat, thirty at most. That works when everyone arrives
together. Tables don't. Friends read a code out over a minute; one of them
is fetching a drink; someone seats the Echoes once they see who's turned up.
A guess wrong in that direction is unrecoverable, because rule 20 fixes the
HP at the pull.

## Options considered

1. **Lengthen the countdown.** Thirty seconds, or sixty. It moves the guess
   and keeps it a guess: a table that takes ninety seconds is still pulled
   for whoever was there at sixty, and a solo visitor waits a minute for
   nobody.
2. **Re-scale the Orrery whenever anyone joins, everywhere.** It fixes the
   first finding in any room, but in a private room it means the fight
   starts before the table is ready: the first person's opening turns are
   taken alone against a boss that then grows. A table of friends wants to
   start together.
3. **A private room has a lobby and a host's Start; the public raid grows
   with its room (chosen).** The two kinds of room want different things, so
   each gets its own answer.

## Decision

### A private room starts on a decision

**A private room has a lobby.** Creating a room seats its creator as the
**host**, in a waiting room: the seat list, the code to read out, "add an
Echo", and **Start**, which only the host can press. Nobody's counters run
until Start, and no boss card is announced: the fight is not under way, so
there is nothing to wait on and nothing to time out (rule 8 applies to a
turn, and there are none yet).

**HP is set at Start, from the seats present** (rule 20), a person whole and
an Echo half. Start with four Echoes seated beside you, and the Orrery wakes
for three seats.

**The host is the first person seated, and passes on.** If the host leaves
the lobby before Start, the next-seated person becomes host. Leaving is one
of two things the server can see: the host asks to
(`POST /api/rooms/:code/leave`), or has had no socket open on the room for
`LOBBY_GRACE_MS` (ours: ten seconds, so a reload or a dropped connection
isn't a leave). Sitting down at another table isn't leaving: one character
may hold seats in two rooms (rule 24), and a host who opens a second room in
another tab still has this one's socket. A host who leaves is unseated from the lobby, since a lobby
seat holds no fight state to keep, and the same rule unseats anyone else
who leaves a lobby. An Echo is never host: it has no person to press
anything. If no person is left, the Echoes go too, and the room is empty
and rule 26's window starts.

**After a fight ends, the room returns to its lobby.** Everyone still seated
in it is seated in the new lobby, in their seat order, with their roles. The
Echoes stay too: they belong to the table, not to one fight, and are the
host's. A seat its person left to an Echo comes back as that Echo until the
person acts (rule 8), so it is half a seat at Start. The host starts the next
fight. Who has gone isn't known at the moment a fight ends; a person who has
gone between fights is unseated from the new lobby when the lobby's presence
says so (no socket for `LOBBY_GRACE_MS`, below). The carry is silent: the
next fight reaches every screen as a whole state, so it narrates nothing a
screen won't show (rule 11).

**Echoes are seated only in a private room's lobby, by its host.** Never in
the public raid, because strangers shouldn't be able to fill a public fight
with bots. The host seats them because the host is composing the table they
will press Start for; anyone else at the table asks the host.
Never mid-fight either. ADR-007 let anyone seated seat an Echo at any time,
and that is half of finding 1: four Echoes appeared after the pull, and the
Orrery couldn't account for them. In a lobby the Echoes are counted at Start
like everyone else.

**Start is checked like an action** (rule 10): the server's clock orders it
against a join or an Echo arriving at the same moment, because each is one
synchronous step on the one process (ADR-001). A seat that lands
before Start is counted. One that lands after joins a running fight, which
in a private room is the late-joiner case below. A second Start is refused
(409), and so is a Start from anyone but the host (403).

**A late joiner in a private room** (someone who sits down after Start)
takes a seat at the back of the strip and the Orrery grows by their seat
weight, as in the public raid below. Rule 20 already favours a bigger room
slightly, and a friend arriving five minutes late shouldn't make the fight
easier. Echoes can't be added after Start, so only people arrive late.

### The public raid grows with its room

**The public raid has no host and no lobby.** Its fight is always running,
so anyone who opens the front door sees a fight, and there is no stranger
whose Start everyone waits on.

**A join to the running public fight raises the Orrery's max HP** by that
seat's weight (a person 1), following rule 20's curve: the max becomes
base × seats^0.75 for the seats now present, and **the current percentage is
kept**, so the bar doesn't jump. If the Orrery stood at 60% before, it
stands at 60% after, of a bigger number. The rings shed segments at fixed
HP shares and the phase lines are shares too, so neither moves.

**When the public fight ends, the next one pulls after a short ready window**
(`READY_MS`, ours: eight seconds) from whoever is seated in it, and it pulls
even if that is nobody new. Everyone still standing at the end is seated in
the next fight, as in a private room. The window is for the end of one fight to
be seen, not for a table to arrive: a public raid's table never finishes
arriving, so it doesn't wait for one. If nobody is seated when the window
ends, the fight waits until the first seat, then pulls after the same
window.

### What this replaces

- **ADR-006's pull countdown** (ten seconds from the last seat, thirty at
  most) is gone from both kinds of room. A countdown assumes a table arrives
  together, and tables don't. A private room starts when its host decides;
  the public raid starts when it can and grows as people come.
- **ADR-006's late-joiner rule** ("a late joiner after the pull takes a seat
  but doesn't change the HP; the next fight is pulled for the room as it then
  is") is reversed. A late joiner grows the Orrery, with its percentage kept.
  The next fight is still pulled for the room as it then is.
- **ADR-007's Echo seating** narrows: only in a private room's lobby, by its
  host.

## Cost

- **A host who walks away before Start stalls the table** until the next
  person is promoted. Promotion waits on the departing session's last socket
  closing, which can take a few seconds for a dropped connection. A host who
  stays connected and simply doesn't press Start holds the table for as long
  as they like. There is no vote and no timer to take it from them, because
  either would bring back the guess this ADR removes, and the table can walk
  to another room for the price of reading out a new code.
- **The public raid's boss can be grown by a stream of joiners.** Each one
  adds HP, so a crowd arriving one at a time makes a long fight. It is
  bounded by rule 20's sub-linear curve: the tenth seat adds about a third of
  what the second did, and every joiner also takes turns. A stream of
  joiners who sit down and do nothing becomes a stream of timeouts, each
  Braced for and eventually an Echo (rule 8), which deals its share.
- **A bare battle** (`POST /api/battles`, the sensors' way in) keeps a short
  ready window like the public raid's and grows the same way, so the sensors
  still get a fight without pressing Start. It is kept until they move onto
  rooms, as before.
- **A lobby is one more screen.** It is drawn from state the server already
  sends (the seats, the room, who is host), so the client decides nothing in
  it: whether Start is live is the server's `hostId`, never the client's
  guess.
