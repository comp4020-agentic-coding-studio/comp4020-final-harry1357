# ADR-007: A room is a code, a bot is an Echo

- **Status:** accepted.
- **Date:** 2026-10-17
- **Builds on:** ADR-001 (one process, one tick, one volume), ADR-002 (a room
  can't wait on one person), ADR-005 (two at once, the clock decides) and
  ADR-006 (the strip is the play surface, and its Echo).
- **Rules:** 22 to 26 in CLAUDE.md, under "What the app must never do", and
  rule 8's Echo.

## Context

The app has one fight. Everyone who opens it lands in the public raid.
`POST /api/battles` can make another, but the only way to get a group into it
is to pass its id around, and nothing about it is private.

The showcase will bring two kinds of visitor the one fight serves badly. A
table of friends wants its own fight, without strangers walking into it. A
single visitor wants to play at all. The strip is a team game (ADR-006):
Wardens intercept, Menders ward, Chronists delay. One seat can't read and
answer a strip built for five, and at a quiet moment the public raid has
nobody else in it.

ADR-006 already promised half of the answer. Its half-seat rule (rule 20) "is
for Echoes seated deliberately, which arrive in phase one-b as ADR-007".

## Options considered

1. **Rooms with accounts and invites.** An owner, an invite list, a way to
   remove someone. It's the usual answer, and it breaks rule 3 (no accounts):
   an invite needs someone to address, a kick needs an owner, and both need an
   identity that outlives a cookie. It answers the table of friends and does
   nothing for the single visitor.
2. **No rooms, one raid.** Everyone in one fight, as now. It's the simplest,
   and the public raid already scales its HP at the pull. But a table can't
   have its own fight, and a lone visitor at an empty hour still faces the
   Orrery by themselves.
3. **A room code with no accounts, plus Echoes to fill seats (chosen).** A
   room is a short code, and whoever has it can sit down. Echoes, the
   automated seats ADR-006 made for absent players, can be seated on purpose
   to fill the roles nobody is playing.

## Decision

**A room is a short code.** Any seated player can create one: a session that
has sat down and so has a character. The server mints the code. A room is
private until someone shares it. Nothing lists rooms, and a wrong code is
refused, never guessed at or redirected to another room. There is no owner,
password or invite list. The code is the only key, and identity stays the
cookie (rule 3).

**The public raid is a permanent room.** It is always open, it never expires,
and it is the default door: anyone who arrives without a code goes there.

**A character persists across rooms, and the seat is per room.** A character
is the session's name, role and record. Sitting in two rooms means two seats,
each with its own place on its own strip, its own counter and its own HP, and
one record that both feed. Each room holds its own fight, queue and
broadcast, so nothing done in one room touches another room's queue.

**An Echo is the same automated character a timed-out player becomes, seated
on purpose by whoever's in the room.**

- One per role, and up to four per room.
- Visibly marked, on every state the strip draws.
- It obeys every rule a person does. It acts on its own turn, or with a
  Reaction against a card already announced, and every action it takes goes
  through the same check a person's does. So it is refused exactly as a
  person is: by the queue, by rule 2, and by rule 10's two-at-once refusal.
- It counts as half a seat for the Orrery's HP (rule 20).
- Its turns are the Echo's, logged as the Echo's and never counted in anyone's
  record (ADR-006).

**A seated Echo waits for nobody.** ADR-006 gives a timed-out seat's Echo a
three-second beat on the plate so its person can come back, and accepted that
cost for that reason alone (ADR-002 rejected a timeout that "keeps costing the
table one full timeout every cycle"). A seated Echo has no person, so it gets
no beat: it is played on the next tick, and the client is told its window is
nothing (review R2). One person with four seated Echoes would otherwise wait
twelve seconds a cycle for nobody.

It plays a fixed, deterministic policy for its role, using only that role's
own actions and reading only the state every client is sent. It never sees a
weakness nobody has Scanned or the Orrery's script. A seat that times out
into an Echo (rule 8) plays the same policy, at the same low output. That is
what "the same automated character" means.

**Rooms expire after fifteen minutes empty**, meaning no person is seated in
the room's fight. The public raid never expires. Rooms live in memory with
their fights, so fights still don't survive a restart (rule 6), and nor do
private codes. Characters still do, and so does every finished fight's log,
which stays readable by its battle id after its room is gone.

## The policies

One per role, deterministic, first match wins:

- **Warden.** Anchor a single-target card aimed at an ally whose Gravity is
  high (one Lunge short of lethal). Otherwise Counterweight. Off its turn,
  Intercept a blow about to land on a marked ally: a single-target card aimed
  at someone else.
- **Mender.** Ward the player a boss card targets. Otherwise Mend the lowest.
  Otherwise Quicken the next player.
- **Striker.** Finish a Broken ring. Otherwise Jab, to build Momentum.
- **Breaker.** Scan an unknown weakness. Shatter a ring at two pips or fewer.
  Mark a ring that has no Exposed stack on it. Otherwise Pry a revealed ring
  toward Shatter's range. Pry is the one addition to the policy as first
  written (Scan, Mark, Shatter): only Pry takes shield pips off a ring, so
  without it no ring ever reaches two pips and the Breaker would never
  Shatter.
- **Chronist.** Delay a boss card within two slots. Otherwise Relay.

## Cost

- **Echoes are a floor for co-presence, not the point.** A room of one person
  and four Echoes can play the strip, but the strip was designed for people
  reading it together (ADR-006). The README has to say so: a solo visitor gets
  a fight worth playing, not the game at its best.
- **A room code is a secret only as long as nobody shouts it.** There's no
  kick and no lock. Anyone who hears a code can sit down, under any name the
  table hasn't taken.
- **A restart forgets every private code.** A table mid-evening has to make a
  new room and pass the new code round. The public raid's code doesn't change.
