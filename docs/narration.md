# Narration: reading the fight from the logs

At the crit, two of the pod play from the URL in separate Chrome profiles, and
the fight is narrated from the server's log, not from the UI. This page is
for reading that log. What gets logged, and why, is in `docs/adr/008`. The
format is held by `spec/told-apart.test.ts`.

## The tail

From the main checkout, where `mise.local.toml` holds the Fly token:

```sh
mise exec -- flyctl logs -a comp4020-final-harry1357
```

Leave it running in a terminal beside the browser. Fly puts its own prefix
on each line (`2026-10-16T13:52:54Z app[683dde6a365978] syd [info]`), and
everything after `[info]` is the app's. To follow one fight and hide the
turn-reached lines, filter on its room (from the `?battle=` in the URL, or
the first `join` line):

```sh
mise exec -- flyctl logs -a comp4020-final-harry1357 | grep --line-buffered 'room=HZ7xfGzF_jRn' | grep --line-buffered -v 'action=plate'
```

## How a line reads

Every line is key=value pairs in the same order, so a column means the same
thing on every line:

```
ts room tick sid name role seat action target [actor] outcome, then the line's own
```

- `sid`: who sent it. Six hex characters of a hash of the session. One
  browser profile is one sid, on every line and after a restart. A different
  profile is a different sid, even under the same name. It is never the
  cookie. `sid=-` means no session at all.
- `name`, `role`, `seat`: the character, and the seat id the server gave
  them. A name with a space in it is quoted.
- `action`: what happened. `target`: who it was aimed at (`orrery`,
  `party`, a seat id followed by `target_name=`, or `-`).
- `actor`: present when someone other than the `sid` person made it
  happen. `actor=orrery` is the Orrery's turn, `actor=clock` is the clock
  acting on a seat (a turn reached, a hold, a leave), and `actor=server` is
  the process itself. A line with no `actor` was done by the `sid` person.
- `outcome`: `applied`, or `refused` followed by `reason="…"` (what the
  person was told) and `status=`.
- `-` means no value. `seq` is the line's number in the battle log the app
  stores (`/api/battles/<room>/log`).

## One of each

All of these are from the live app on 2026-10-16, one fight between two Chrome
profiles (`Ada-5ird`, a Herald, and `Bo-5ird`, a Bulwark), with Fly's prefix
removed.

**Process start**: the commit running, and fights the last process left open.

```
ts=2026-10-16T13:51:33.343Z room=- tick=- sid=- name=- role=- seat=- action=start target=- actor=server outcome=applied sha=8c6ab1f listen=0.0.0.0:8080 db=/data/raid.db tick_ms=150 turn_ms=20000 closed=1
```

`sha` is the deployed commit. `closed=1`: one fight was open when the last
process stopped (the redeploy), and the next line closes it.

**A fight ended by a restart** (rule 6):

```
ts=2026-10-16T13:51:33.353Z room=fR1YeeBFiww2 tick=- sid=- name=- role=- seat=- action=end target=- actor=server outcome=applied result=abandoned cause=restart
```

**A join.** Someone takes a seat:

```
ts=2026-10-16T13:52:54.178Z room=HZ7xfGzF_jRn tick=0 sid=32abcb name=Ada-5ird role=herald seat=Itu5IntqcAOc action=join target=- outcome=applied seq=1 returning=false
```

`sid=32abcb` is Ada's browser from now on. `returning=true` would mean they
were here before and stepped away.

**The pull.** The fight begins at the first seat:

```
ts=2026-10-16T13:52:54.178Z room=HZ7xfGzF_jRn tick=0 sid=- name="The Orrery" role=orrery seat=orrery action=pull target=- actor=orrery outcome=applied seats=1 max_hp=240
```

**A second person, in a second profile.** Same room, different sid:

```
ts=2026-10-16T13:52:54.317Z room=HZ7xfGzF_jRn tick=1 sid=71481b name=Bo-5ird role=bulwark seat=jnGYqvgjJCFH action=join target=- outcome=applied seq=2 returning=false
```

**A turn comes up.** The second filter above hides these:

```
ts=2026-10-16T13:52:55.837Z room=HZ7xfGzF_jRn tick=12 sid=32abcb name=Ada-5ird role=herald seat=Itu5IntqcAOc action=plate target=- actor=clock outcome=applied
```

The clock put Ada on the strike plate at tick 12. If she acts, her action
comes next, on the same tick.

**An action:**

```
ts=2026-10-16T13:52:55.911Z room=HZ7xfGzF_jRn tick=12 sid=32abcb name=Ada-5ird role=herald seat=Itu5IntqcAOc action=strike target=orrery outcome=applied seq=3 amount=10
```

No `actor`, so Ada did it herself: her sid, on her plate, at tick 12. Mend
and Hasten name their ally: `target=<seat> target_name=<name>`.

**The Orrery's turn:**

```
ts=2026-10-16T13:52:57.341Z room=HZ7xfGzF_jRn tick=21 sid=- name="The Orrery" role=orrery seat=orrery action=revolution target=party actor=orrery outcome=applied seq=4 hits="Ada-5ird:12, Bo-5ird:12"
```

`revolution`, `eclipse` or `perihelion`. `hits` lists who took what. A
`down` line during the Orrery's turn carries `actor=orrery` too, because
its turn did that.

**A hold.** The clock passes a turn nobody took (rule 8):

```
ts=2026-10-16T13:53:17.927Z room=HZ7xfGzF_jRn tick=24 sid=32abcb name=Ada-5ird role=herald seat=Itu5IntqcAOc action=hold target=- actor=clock outcome=applied seq=5
```

`actor=clock`: this was done to Ada, not by her. A second hold in a row is
followed by a leave, also `actor=clock`:

```
ts=2026-10-16T13:53:39.875Z room=HZ7xfGzF_jRn tick=36 sid=32abcb name=Ada-5ird role=herald seat=Itu5IntqcAOc action=leave target=- actor=clock outcome=applied seq=8
```

**A refusal**: one session asking to act for another's seat (ADR-008):

```
ts=2026-10-16T13:53:18.969Z room=HZ7xfGzF_jRn tick=30 sid=32abcb name=Ada-5ird role=herald seat=Itu5IntqcAOc action=strike target=- outcome=refused reason="You can only act for your own seat." status=403 as_seat=jnGYqvgjJCFH as_name=Bo-5ird
```

Ada's session (`sid=32abcb`, `seat=Itu5IntqcAOc`) sent a Strike with
`seatId` set to Bo's seat. `as_seat` and `as_name` say whose seat she asked
for. Nothing happened, and Bo's turn isn't spent. Other refusals read the
same way with a different reason: `"It isn't your turn."` (rule 2),
`"Bo-5ird has just taken this turn."` (ADR-005), `"A Herald can't do that."`
(off the role's catalogue), `"You aren't standing in this fight."` (no seat,
so `sid=-` or a sid with `name=-`), and `"Someone at this table already goes
by that name."` (a join, with the name tried as `asked_name`).

**The end.** Here both stepped away, so it was abandoned:

```
ts=2026-10-16T13:54:25.998Z room=HZ7xfGzF_jRn tick=73 sid=- name=- role=- seat=- action=end target=- actor=server outcome=applied seq=14 result=abandoned seated=2
```

`result` is `won`, `lost` or `abandoned`. `seated` counts everyone who sat
down.

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
   turn."`.

To make the third one happen live, send the request ADR-008 refuses. Copy
your own cookie from the browser's devtools (Application → Cookies →
`raid_sid`), take the other person's seat id from their `join` line, and
run:

```sh
curl -s -H 'cookie: raid_sid=<yours>' -H 'content-type: application/json' \
  -d '{"action":"strike","seatId":"<their seat>"}' \
  https://comp4020-final-harry1357.fly.dev/api/battles/<room>/actions
```

The answer is `403 {"error":"You can only act for your own seat."}`, and
the tail shows the line above with your sid. Your cookie value appears only
in your own terminal history. The log never has it.
