# ADR-008: Your seat, your actions, everyone's strip

- **Status:** accepted.
- **Date:** 2026-10-16
- **Builds on:** ADR-001 (one process), ADR-002 (a room can't wait on one
  person) and ADR-005 (two at once, the clock decides).
- **Rules:** 13 to 16 in CLAUDE.md, under "What the app must never do".

## Context

Crit 10 asks for what each person may see and change to be checked on the
server, and for that decision to be written down with the reasons. Rule 3
already fixes who a person is: the session cookie the server minted, plus a
name and a role. The rule says identity comes from the cookie and never from
the body, but it says nothing about a body that names someone anyway.

Most of the check already existed. The action route resolves the cookie to a
character, and `checkAction` refuses a character who isn't standing, an
action outside the role, an ally target who isn't standing, and an action out
of turn. There were two gaps:

- **A body that named another seat was ignored without a word.** With A's
  cookie, `{"characterId": "<B>", "action": "strike"}` sent on A's turn
  landed as A's strike and answered 200. Nobody could act *as* B, but A's
  turn was spent on a request that asked for B, and nothing recorded the
  attempt. An attempt to act for someone else looked exactly like a normal
  turn.
- **Nothing was logged.** Stdout had a boot line and an end-of-battle line.
  If two classmates were at the same table, the logs couldn't tell them apart,
  and a refusal left no trace on the server.

## Options considered

For a request that names a seat other than its own:

1. **Ignore the named seat and act as the cookie's seat (the old behaviour).**
   It's safe in effect, but the request is answered "ok" for something it
   didn't ask, its turn is spent, and the attempt is invisible.
2. **Let the body choose the seat, and check that the session owns it.** That
   is one session holding several seats. A person here is one seat, so this
   would add a second identity and weaken rule 3.
3. **Refuse it, and log it (chosen).** The seat is always the cookie's.
   Naming any other seat is refused before the turn is looked at, so the
   turn isn't spent, and the refusal line carries both the session's id and
   the seat it named.

For what a person may see:

1. **Filter per viewer**: hide other people's HP, waits or log lines. But
   CTB is a game of reading the queue, and rule 1 rests on every client
   receiving the same queue. A filtered strip would be a different game.
2. **Everyone in a fight sees everything (chosen).** Nothing in a fight is
   private: there are no accounts, and a name is something its owner chose
   for the table to see.

## Decision

- **A person is a session cookie, a name and a role** (rule 3). The server
  mints the cookie at the join that creates the seat. That seat is the only
  one the session will ever act for.
- **A session may act only for the seat it created.** A request whose body
  names a seat (`seatId`, `characterId` or `actorId`) other than the
  session's own is refused with 403, whatever else it asks and whoever's turn
  it is, and the refusal is logged. A request that names the session's own
  seat goes ahead, since naming yourself changes nothing. The same check
  applies to the join route.
- **A seat's actions are its role's catalogue** (`ROLES[role].actions` in
  `protocol.ts`). Anything outside it is refused.
- **A target must be standing in the same fight.** An ally from another fight,
  or one who has fallen or left, is refused.
- **An action reaches another character only as the role defines it.** On
  this build that means Mend and Hasten aimed at an ally. Strike and Lunge
  reach only the Orrery, and Brace only yourself, whatever target the request
  names.
- **Nobody can rename, remove or act for another seat.** No route could do it.
  A name is set by your own join, a seat leaves only by falling or by the
  clock's holds (rule 8), and every route that changes a fight acts for the
  cookie's seat or is refused.
- **Everyone in a fight sees everything.** The state, the strip, the log and
  the socket are open to anyone with the fight's link, seated or not, and
  nothing is filtered per viewer. The strip being public is the point.
- **A session with no seat may watch and may not act.** That covers no
  cookie, a cookie the server never minted, and a seat in a different fight.
  The answer is 403, and the refusal is logged.
- **Checked in one place.** All of this is checked on the server, where
  actions enter (`POST /api/battles/:id/actions` in `src/server/app.ts`),
  before the turn is looked at. The client's disabled buttons are a courtesy
  and not the check.
- **Logged, by a session id that isn't the cookie.** Every applied action,
  and every refusal at the join and action routes, is one line on stdout.
  The line names the session by `sid`: six hex characters of a hash of the
  session, the same for that cookie across restarts, and never the cookie
  itself. Two people are told apart in the logs even when they use the same
  name in different fights.

## Cost

- **No moderation.** There's no host, no kick and no ban. A griefer can sit on
  the plate for the full 20 s timeout every turn. Two holds in a row and
  they're out (rule 8), but they can rejoin from the same session and do it
  again. The timeout rule bounds the damage; it doesn't prevent it.
- **A session is a bearer token.** Whoever holds the cookie is that person.
  It is HttpOnly, and Secure behind TLS, but it lasts a year and nothing
  re-checks it. Copying a cookie means taking over the seat.
- **No private fights.** A shared link is a fight anyone can watch.
- **Logs grow at the rate requests arrive.** Every refusal is a line, and
  nothing limits the request rate, so a client that hammers the action route
  writes one line per request.
- **Names are kept.** A name is in the stdout log and the battle log in
  SQLite for as long as either lasts.
