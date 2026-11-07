# The Rail

## What this is

A multiplayer raid in the shape of a JRPG boss fight. People sit down at 
a table in their browsers, pick one of five roles, and fight the Orrery, 
a clockwork boss that gets harder the more of them there are. The turn 
order runs down the edge of the screen as a strip of portraits. That 
strip is the rail. Live at comp4020-final-harry1357.fly.dev.

## What good means here

A raid is good when everyone can tell whose turn is next and why, when 
every change is watched rather than read, when other people change the 
fight instead of only making the boss bigger, and when losing teaches 
you something.

The first part comes from Final Fantasy X, which shows the next sixteen 
turns on screen, computed from each combatant's counter. Dourish and 
Bellotti argue that coordination comes from awareness of what others 
are doing, not from rules about who goes when. The strip is that 
awareness made literal: every attack the Orrery will make sits on it as 
a card, with its target and a countdown, before it lands. The log is a 
receipt for what you saw.

The third part is Shirky's "Situated Software" and Sloan's "home-cooked 
meal": software built for a group in a room, where fit matters more than 
scale. The crit-8 version answered co-presence with hit points per 
joiner, a placeholder. Now the Orrery's HP follows a sub-linear curve of 
the seats present, its tempo scales to the table, and its mechanics need 
roles to answer them: a Lunge needs a Warden's swap, a Retrograde a 
Chronist's cancel. Five people with five roles have a fight one person 
can't.

The fourth part came from playing it. A boss that can't kill you teaches 
nothing, so difficulty is measured: scripted naive, competent and expert 
tables play thirty-one rooms, and the roster holds that naive tables wipe 
before the last phase in at least 25 while expert tables win at least 
25. The cost is an enrage clock at forty Orrery turns.

## Who is at the table

Three doors. The public raid never closes: you sit into whatever fight 
is on. Create a room and you get a five-character code and a lobby, 
where the host presses Start once everyone has arrived. Enter a code to 
join a friend's. A visitor on their own can seat up to four Echoes, 
server-played bots marked as such everywhere, so a solo visitor still 
gets a fight worth playing: a floor for having people at the table, not 
the point of it. Echoes answer no mechanic that needs reading the strip, 
so a solo player still has to learn it. A name is for life, a role is 
for a fight.

## The claims, and who enforces them

Enforced by `spec/`: the server alone decides turn order and two clients 
see the same queue; an off-turn action is refused, and of two for one 
turn the server's clock picks; a seat acts only for itself; every card 
is announced before it lands and every event shown before its log line; 
a character and a finished fight's log survive a restart and a redeploy; 
the pace band and the difficulty targets hold on thirty-one scripted rooms; 
a refusal is one log line with neither the cookie nor the request's text.

Judged: whether the strip reads at a glance on a phone to someone who 
has never seen a counter, whether a phase change feels like a moment, 
and whether a wipe makes a table press Start again, all by handing my 
phone to people at the showcase without explaining anything.

## What I chose not to build

Accounts, profiles and feeds: a name and a cookie are all the game needs 
to tell people apart. Chat, because the strip is the conversation. 
Levels and loot, because they reward time spent rather than the fight in 
front of you. A second machine: one process is the one authority on the 
clock, and a restart ends live fights and says so.

## Sources

- Dourish, P. and Bellotti, V. (1992). Awareness and Coordination in 
  Shared Workspaces. CSCW '92.
- Shirky, C. (2004). Situated Software.
- Sloan, R. (2020). An app can be a home-cooked meal.
- Final Fantasy Wiki, Final Fantasy X battle system; SinirothX, FFX Stat 
  Mechanics FAQ (GameFAQs), for the counter model.
- Character sprites: Superpowers asset pack by Pixel-boy, CC0; the 
  Chronist and the Orrery are original. Full attribution in CREDITS.md.
