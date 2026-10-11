# ADR-005: Two at once, the clock decides

- **Status:** accepted.
- **Date:** 2026-10-12
- **Builds on:** ADR-001 (one process, one tick) and ADR-002 (a room can't wait
  on one person).

## Context

The strike plate holds one character at a time, but nothing stops two clients
from pressing Strike inside the same few hundred milliseconds: the person whose
turn it is, and someone whose screen hasn't caught up, or the same person on
two devices. A tick is `TICK_MS` (150 ms), so "the same few hundred
milliseconds" is two or three ticks, and a request in flight when the turn
passes is a real case, not a contrived one.

The README makes two claims that bear on this. The server is the only authority
on turn order, and the queue is the truth. Whatever the server does with the
second action has to leave both of those standing.

## Options considered

1. **Queue the later action for that character's next turn.** Nobody is told
   no. But the action was chosen against a rail that has since moved, and it
   now fires in a later tick as the client's stale intent, with the server
   carrying it out in someone's name. That makes a client's old decision
   authoritative about a turn the client didn't see.
2. **Apply both and let the fight absorb it.** Two strikes for one turn. The
   fight survives it, but the queue no longer describes what happened: one
   place on the rail produced two actions. The queue becomes a lie.
3. **Refuse the later one with a message naming whose turn it is (chosen).**
   The server's clock orders the two requests, the first is applied, and the
   second is dropped with a refusal that names the character on the plate.

## Decision

Option 3. When two actions arrive for one turn, the server's clock decides.
The first to be processed is applied. The second is refused (409) with the name
of whose turn it is, and is dropped: not queued, not deferred, not retried by
the client. This is rule 2 (an action is never queued) applied to the case
where the early action isn't early but late.

"First" means first in the server's own order. Nothing between checking an
action and taking the turn yields, so two requests cannot both pass the check
for one turn. The refusal names the acting character so the person refused can
see on their own screen why, instead of being told only no.

After both requests are answered, every client receives the same queue. That
follows from rule 1 and is checked, not assumed (`spec/two-at-once.test.ts`).

## Cost

- **Being told no feels like being ignored.** On a slow connection you can
  press Strike and be told it isn't your turn, when on your screen it was.
  The refusal names whose turn it is, which at least says what happened.
- **Mitigated, not removed.** The rail shows who is on the plate and the
  countdown, and the action panel enables only when the server says you are
  on it (rule 2). Both are on the client's last state, so a race in the last
  few hundred milliseconds remains: the turn can pass between the server
  sending it and your press arriving.
- **The server decides by arrival, not by who pressed first.** A press made
  earlier on a slower link loses to a later one on a faster link. The clock is
  the server's, on purpose; there is no fairer one to appeal to without the
  client telling the server what time it is, which rule 1 rules out.
- **A refused action is gone.** The person has to press again if the turn
  comes round. That is the point of option 1 not being chosen.
