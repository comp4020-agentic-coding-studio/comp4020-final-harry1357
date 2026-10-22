# The Rail

A multiplayer raid in the shape of a JRPG boss fight. People 
sit down at a table in their browsers, pick a role each, and fight the 
Orrery, a boss that gets harder and faster the more of you there are. 
Turns run on a counter, not a clock: everyone's counter ticks, whoever 
hits zero first acts, and the Orrery's counter is set by the pace of 
the room, each seat weighted by its speed, so it acts about once for 
every three player turns however many seats are filled.

Live at https://comp4020-final-harry1357.fly.dev/.

## Playing

The join screen has three doors. The public raid is always running: 
you sit down into whatever fight is on, the Orrery's maximum HP grows 
by your seat with its current percentage kept, and when the fight ends 
the next one pulls after a short ready window. Creating a room gives 
you a five-character code and a lobby; sharing the code with a friend 
puts them in the same lobby. Entering a code is the third door.

A private room's lobby is a seat list, the code, and a Start button 
that only the host can press. The host is whoever sat down first, 
passes the role on if they leave, and has no power beyond Start and 
the Echo buttons; nobody owns a room. Hosting exists because a boss 
sized at the pull for one person is the wrong boss for the four who 
arrive a minute later, so HP is set at Start from the seats present. 
When the fight ends the room returns to its lobby. A private room 
with nobody in it expires after fifteen minutes. Rooms live in memory, 
so a redeploy forgets every code.

A name is for life and a role is for a fight: the name you give is 
yours for as long as your browser keeps its cookie, the role is chosen 
each fight. Your session acts only for its own seat; naming another 
seat's action is refused.

### Roles

Each role runs on its own resource and plays a different job at the 
table. The Warden holds Resolve and takes hits for the others. The 
Mender holds Grace and keeps people standing. The Striker holds 
Momentum and does the damage. The Breaker holds Insight and finds the 
Orrery's weaknesses. The Chronist holds Flux and bends the turn order. 
Cards come in ranks one to five; hitting a weakness refunds the rank 
(Resonance), consecutive hits chain for more damage, Exposed stacks 
make the next hit land harder, Brace and Charge spend a turn to shape 
the next, and a Reaction is one off-turn play per Orrery turn when the 
server says you're ready.

### The Orrery

Three phases, at 70% and 35% HP, each with its own cards. Perihelion 
is a damage check with four slots' warning. Gravity pulls one seat's 
attention until a Lunge, which a tank swap answers. Retrograde flips 
the turn strip, and the Chronist can cancel it. Phase three is the 
Grand Alignment, a clock that ends the fight if the table can't. A 
fight that runs past forty Orrery turns meets that clock whatever the 
phase, because no fight is allowed to last forever. Every card shows 
its intent, its target and its countdown on the strip before it lands, 
and a phase change stops the screen, flashes, and names itself.

### Echoes

An Echo is a bot that plays a role at the table. They're there so a visitor on their own still gets a fight worth 
playing: sit down, seat Echoes for the roles you don't have, and 
Start. That's a floor for having people at the table, not the point 
of it; the game is at its best with five people who can hear each 
other. The host can seat up 
to four in a private room's lobby, one per role, and a person who stops 
acting is played as an Echo until they act again. Echoes play a fixed 
policy at three-quarters output, count as half a seat for the Orrery's HP, and 
are marked everywhere: on the strip, in the seat list, and on every 
line of the fight's log as `echo=true`, so nothing an Echo does is ever 
credited to a person. The five Echo names are reserved; the check that 
refuses a look-alike is a courtesy, not a security boundary, because 
the log tells Echoes apart by that field, not by name.

## Running it

```
pnpm install
pnpm build
DATABASE_PATH=.data/raid.db pnpm start
```

The server and the client run from one process on port 8080 with a 
SQLite file beside them. `pnpm check` runs typecheck, lint and the 
test roster against the running app, and some of its tests boot servers of their own; the roster also runs against 
a container built from the Dockerfile, which is what Fly runs, so what 
is tested is what ships. Pushing `main` deploys. The database lives on 
a Fly volume at `/data`.

## Where the thinking is

`CLAUDE.md` holds the rules the project is built under, numbered, with 
the ones that may never be broken marked. `docs/adr/` holds the 
decisions and what each one cost. `docs/design/` holds the design 
study the overhaul came from. `docs/review/` holds every review gate: 
what the reviewer and the breaker found, what was fixed red-first, and 
what was closed as a recorded risk by ruling. `docs/narration.md` 
explains how to read the server's log. `PROCESS.md` is the account of 
how all of this was made with Claude Code.
