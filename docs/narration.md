# Narration: reading the fight from the logs

At the crit, two of the pod play from the URL in separate Chrome profiles, and
the fight is narrated from the server's log, not from the UI. This page is
for reading that log. What gets logged, and why, is in `docs/adr/008`. The
format is held by `spec/told-apart.test.ts`, and that every refusal on every
route is one line by `spec/refusals.test.ts`.

## The tail

From the main checkout, where `mise.local.toml` holds the Fly token:

```sh
mise exec -- flyctl logs -a comp4020-final-harry1357
```

Leave it running in a terminal beside the browser. Fly puts its own prefix
on each line (`2026-10-16T13:52:54Z app[683dde6a365978] syd [info]`), and
everything after `[info]` is the app's. To follow one fight and hide the
turn-reached lines, filter on its room's code (the `?room=` in the URL, or
`RAID` for the public raid). Every line about a room's fight carries `code=`,
and a room's code stays the same from fight to fight, so this follows the
table, not one fight:

```sh
mise exec -- flyctl logs -a comp4020-final-harry1357 | grep --line-buffered 'code=TPXWM' | grep --line-buffered -v 'action=plate'
```

## How a line reads

Every line is key=value pairs in the same order, so a column means the same
thing on every line:

```
ts room [code] tick sid name role seat echo action target [actor] outcome, then the line's own
```

- `sid`: who sent it. Six hex characters of a hash of the session. One
  browser profile is one sid, on every line and after a restart. A different
  profile is a different sid, even under the same name. It is never the
  cookie. `sid=-` means no session at all.
- `room` and `code`: the fight's battle id, and the room it is in (rule 22).
  A room's next fight is a new `room` under the same `code`.
- `name`, `role`, `seat`: the character, and the seat id the server gave
  them. A name with a space in it is quoted.
- `echo`: `true` when an Echo is that seat (rule 25), whether one the host
  seated or a person's seat left to one (rule 8); `false` for a person; `-`
  for the Orrery or nobody. This, not the name, is how a line tells an Echo's
  act from a person's.
- `action`: what happened. `target`: who it was aimed at (`orrery`,
  `party`, a seat id followed by `target_name=`, or `-`).
- `actor`: present when someone other than the `sid` person made it
  happen. `actor=orrery` is the Orrery's turn, `actor=clock` is the clock
  acting on a seat (a turn reached, a hold, an Echo playing a seat whose
  person has gone, a lobby seat unseated for having no socket), and
  `actor=server` is the process itself. A line with no `actor` was done by
  the `sid` person.
- `outcome`: `applied`, or `refused` followed by `reason="…"` (what the
  person was told) and `status=`.
- `-` means no value. `seq` is the line's number in the battle log the app
  stores (`/api/battles/<room>/log`).

## One of each

All of these are from the rebased app on 2026-10-22, run locally with a fast
clock: Ada-7kq (a Striker) made room `TPXWM`, Bo-7kq (a Mender) joined it by
its code, Ada seated a Warden Echo and pressed Start, and Bo never acted. Then
two more people sat down in the public raid.

**Process start**: the commit running, and fights the last process left open.

```
ts=2026-10-22T16:48:28.461Z room=- tick=- sid=- name=- role=- seat=- echo=- action=start target=- actor=server outcome=applied sha=7482a1d listen=0.0.0.0:8080 db=/data/raid.db tick_ms=40 turn_ms=1500 closed=0
```

`sha` is the deployed commit. `closed=1` would mean one fight was open when
the last process stopped (a redeploy), and the next line closes it:

```
ts=2026-10-16T13:51:33.353Z room=fR1YeeBFiww2 tick=- sid=- name=- role=- seat=- action=end target=- actor=server outcome=applied result=abandoned cause=restart
```

**A room's first seat.** Making a room is sitting down in it, as its host
(rule 27):

```
ts=2026-10-22T16:48:28.513Z room=svDjzUz0D8wd code=TPXWM tick=0 sid=19cb7a name=Ada-7kq role=striker seat=KL1I3ndQMTiK echo=false action=join target=- outcome=applied seq=1 returning=false
```

`sid=19cb7a` is Ada's browser from now on, and `code=TPXWM` the room.
`returning=true` would mean they were here before and stepped away.

**A guest, by the code.** Same room, different sid:

```
ts=2026-10-22T16:48:28.516Z room=svDjzUz0D8wd code=TPXWM tick=0 sid=392bf1 name=Bo-7kq role=mender seat=RmcUXczUJfQ8 echo=false action=join target=- outcome=applied seq=2 returning=false
```

**An Echo seated.** Only the host, in the lobby (rule 25). It is Ada's act,
under Ada's sid; the line's `name` and `seat` are the Echo's, `echo=true`,
and `seated_by` is Ada's seat:

```
ts=2026-10-22T16:48:28.517Z room=svDjzUz0D8wd code=TPXWM tick=0 sid=19cb7a name="Warden Echo" role=warden seat=hntV7xoa0a2Y echo=true action=seat target=- outcome=applied seq=3 seat_role=warden seated_by=KL1I3ndQMTiK
```

**A Start that isn't the host's** (rule 27), refused:

```
ts=2026-10-22T16:48:28.519Z room=svDjzUz0D8wd code=TPXWM tick=0 sid=392bf1 name=Bo-7kq role=mender seat=RmcUXczUJfQ8 echo=false action=start target=- outcome=refused reason="Only the host, Ada-7kq, can start this fight." status=403
```

**The host's Start**, then the pull it causes, the Orrery's HP set from the
seats present: two people and an Echo at half (rule 20):

```
ts=2026-10-22T16:48:28.520Z room=svDjzUz0D8wd code=TPXWM tick=0 sid=19cb7a name=Ada-7kq role=striker seat=KL1I3ndQMTiK echo=false action=start target=- outcome=applied seq=4 seats=2.5 max_hp=318
ts=2026-10-22T16:48:28.520Z room=svDjzUz0D8wd code=TPXWM tick=0 sid=- name="The Orrery" role=orrery seat=orrery echo=- action=pull target=- actor=orrery outcome=applied seq=5 seats=2.5 max_hp=318
```

In the public raid there is no Start: the pull comes a ready window after its
first seat, and reads the same with `code=RAID`.

**A card announced.** Every boss move goes up on the strip first (rule 19):

```
ts=2026-10-22T16:48:28.520Z room=svDjzUz0D8wd code=TPXWM tick=0 sid=- name="The Orrery" role=orrery seat=orrery echo=- action=card target=- actor=orrery outcome=applied card_intent=perihelion card_target_id=party card_amount=16 card_countdown=4 card_id=card-1 card_frozen=false
```

**The Orrery's turn:**

```
ts=2026-10-22T16:48:29.082Z room=svDjzUz0D8wd code=TPXWM tick=13 sid=- name="The Orrery" role=orrery seat=orrery echo=- action=revolution target=party actor=orrery outcome=applied seq=6 hits="Ada-7kq:4, Bo-7kq:4, Warden Echo:4" card_id=card-2
```

`revolution`, `eclipse`, `lunge`, `perihelion`, `retrograde` or
`alignment`. `hits` lists who took what; `card_id` is the card that resolved.

**A turn comes up.** The second filter above hides these:

```
ts=2026-10-22T16:48:29.207Z room=svDjzUz0D8wd code=TPXWM tick=15 sid=19cb7a name=Ada-7kq role=striker seat=KL1I3ndQMTiK echo=false action=plate target=- actor=clock outcome=applied
```

**An action:**

```
ts=2026-10-22T16:48:29.266Z room=svDjzUz0D8wd code=TPXWM tick=15 sid=19cb7a name=Ada-7kq role=striker seat=KL1I3ndQMTiK echo=false action=jab target=- outcome=applied seq=9 ring_id=outer amount=6
```

No `actor`, so Ada did it herself: her sid, on her plate, at tick 15.
Actions aimed at an ally name it: `target=<seat> target_name=<name>`.

**A refusal**: one session asking to act for another's seat (ADR-008):

```
ts=2026-10-22T16:48:29.262Z room=svDjzUz0D8wd code=TPXWM tick=15 sid=19cb7a name=Ada-7kq role=striker seat=KL1I3ndQMTiK echo=false action=jab target=- outcome=refused reason="You can only act for your own seat." status=403 as_seat=RmcUXczUJfQ8 as_name=Bo-7kq
```

Ada's session sent a Jab with `seatId` set to Bo's seat. `as_seat` and
`as_name` say whose seat she asked for. Nothing happened. Every refusal, on
every route, is one line like this (rule 32), with `action=` the route when it
isn't a turn: `join`, `room`, `start`, `leave`, `echo` or `read`. Other
reasons: `"It isn't your turn."` (rule 2), `"Bo-7kq has just taken this
turn."` (ADR-005), `"A Striker can't do that."` (off the role's catalogue),
`"You aren't standing in this fight."`, `"Echoes can't be seated in the
public raid…"` (rule 25), `"No such room."` (a wrong code, rule 22).

**A hold, then an Echo.** The clock Braces for a turn nobody took (rule 8):

```
ts=2026-10-22T16:48:30.915Z room=svDjzUz0D8wd code=TPXWM tick=18 sid=392bf1 name=Bo-7kq role=mender seat=RmcUXczUJfQ8 echo=false action=hold target=- actor=clock outcome=applied seq=10 charge=1 timeouts=1
```

Three in a row and the seat becomes an Echo, `echo=true` from here on:

```
ts=2026-10-22T16:48:35.198Z room=svDjzUz0D8wd code=TPXWM tick=42 sid=392bf1 name=Bo-7kq role=mender seat=RmcUXczUJfQ8 echo=true action=echo target=- actor=clock outcome=applied seq=22 on=true
```

and the Echo plays the seat, as the clock's act, never in Bo's record:

```
ts=2026-10-22T16:48:36.027Z room=svDjzUz0D8wd code=TPXWM tick=54 sid=392bf1 name=Bo-7kq role=mender seat=RmcUXczUJfQ8 echo=true action=mend target=hntV7xoa0a2Y target_name="Warden Echo" actor=clock outcome=applied seq=28 amount=26
```

**A phase change** (rule 28):

```
ts=2026-10-22T16:48:37.060Z room=svDjzUz0D8wd code=TPXWM tick=70 sid=- name="The Orrery" role=orrery seat=orrery echo=- action=phase target=- actor=orrery outcome=applied seq=35 phase=2 phase_name=Conjunction
```

**The end.**

```
ts=2026-10-22T16:48:45.212Z room=svDjzUz0D8wd code=TPXWM tick=202 sid=- name=- role=- seat=- echo=- action=end target=- actor=server outcome=applied seq=97 result=won seated=3
```

`result` is `won`, `lost` or `abandoned`. `seated` counts everyone who sat
down. The room then returns to its lobby with everyone still at the table
under a new `room` and the same `code`. That carry is silent, because the
next fight reaches every screen as a whole state with no events (rule 11).
Its first lines are whatever happens in the new lobby.

**The public raid grows.** A seat that joins the running public fight raises
the Orrery's max HP with its share kept (rule 20). Here the first raider had
already timed out into an Echo, so the room counts one and a half seats:

```
ts=2026-10-22T16:49:00.874Z room=F7L3W_RBFYp9 code=RAID tick=59 sid=- name="The Orrery" role=orrery seat=orrery echo=- action=grow target=- actor=orrery outcome=applied seq=9 seats=1.5 max_hp=217 hp=217
```

## Three things to point at

1. **Who joined.** Find the `action=join` lines for the room: two names, and
   two different `sid`s. That is two browser profiles, told apart by the
   server, not by the names they typed. Every later line for each person
   carries the same sid.
2. **Who acted, on whose turn.** A `action=plate … actor=clock` line names
   whose turn it is. The applied action after it has the *same* `sid` and
   `seat` and no `actor`, so the person whose turn it was acted, and nobody
   else. Follow the `tick` column: the plate and the action share a tick,
   and nothing else acts in between.
3. **A refusal.** An `outcome=refused` line, ideally `reason="You can only
   act for your own seat."` with `as_seat=`. It names the session that
   asked (`sid`, `seat`) and the seat it asked for (`as_seat`, `as_name`),
   and no applied line follows for that seat. If a classmate presses during
   someone else's turn, the same thing shows up with `reason="It's …'s
   turn."`. In a lobby, a guest pressing Start shows up as `action=start`
   with `reason="Only the host, … can start this fight."`.

To make the third one happen live, send the request ADR-008 refuses. Copy
your own cookie from the browser's devtools (Application → Cookies →
`raid_sid`), take the other person's seat id from their `join` line, and
run (the battle id is the line's `room=`):

```sh
curl -s -H 'cookie: raid_sid=<yours>' -H 'content-type: application/json' \
  -d '{"action":"jab","seatId":"<their seat>"}' \
  https://comp4020-final-harry1357.fly.dev/api/battles/<room>/actions
```

The answer is `403 {"error":"You can only act for your own seat."}`, and
the tail shows the line above with your sid. Your cookie value appears only
in your own terminal history. The log never has it.
