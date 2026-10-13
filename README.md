# The Rail

## What this is

Everyone who opens the page joins the same fight as one character. It 
looks like what it is: your party stands on the left, the Orrery turns 
on the right, a bordered command window waits at the bottom, and the 
turn order runs down the edge as a strip of portraits in the order 
they'll act. That strip is the rail. When you strike, the room watches 
it land. It's a raid built for the capstone showcase, where a room of 
people will be on it at once.

## What good means here

A raid is good when everyone in the room can tell whose turn is next and 
why, when every change is something you watch rather than something you 
read, and when being there with other people changes the fight instead 
of only making the boss bigger.

The first part comes from Final Fantasy X, whose battle system shows the 
next sixteen turns on screen, computed from each combatant's counter. I 
rebuilt that counter for Assignment 1; here it runs on a server for a 
room. Most multiplayer games hide this. An MMO raid shows you a health 
bar and a cast bar and leaves the order of events to be felt. Dourish 
and Bellotti's work on shared workspaces argues that coordination comes 
from awareness of what others are doing, not from rules about who goes 
when. The strip is that awareness made literal, and the screen is where 
it happens: the log is a receipt for what you already saw.

The last part is the hardest claim. Shirky's "Situated Software" 
describes software built for a group that already knows each other, 
where fit matters more than scale, and Robin Sloan's "An app can be a 
home-cooked meal" makes the same case for building for the people in 
the room. This app is for one room on one afternoon. If it's good, it's 
because the people in the room make the fight different, through the 
roles they bring and the order they act in.

## The claims, and who enforces them

Enforced by spec/: the server is the only authority on turn order, and 
two clients see the same queue. An action from a character whose 
counter isn't zero is rejected, and when two arrive for one turn the 
server's clock decides and the second is refused by name. An action 
changes everyone's queue within one tick. Every event the server sends 
has a renderer, and another player's screen shows it before its log 
line. Names are unique within a fight. A character, and a finished 
fight's log, survive a restart and a redeploy. A person is a cookie, a 
name and a role, and nothing more. Every asset ships with a licence.

Judged: whether a JRPG player looks at it and wants to join; whether the 
strip reads at a glance on a phone to someone who's never seen a 
counter; and whether more people make the fight more interesting rather 
than longer. I'll judge the first two by handing my phone to people 
without explaining anything. The third is still open: the boss gains 
hit points per joiner, which is the answer I'm replacing, not the one 
I'm defending.

## What I chose not to build

Accounts. Chat, because the strip is the conversation. Levels and loot, 
because they reward time spent rather than the fight in front of you. 
Rooms and lobbies: there's one fight, and you're in it. And per-joiner 
hit points as anything more than a placeholder.

## Sources

- Dourish, P. and Bellotti, V. (1992). Awareness and Coordination in 
  Shared Workspaces. CSCW '92.
- Shirky, C. (2004). Situated Software.
- Sloan, R. (2020). An app can be a home-cooked meal.
- Final Fantasy Wiki, Final Fantasy X battle system; SinirothX, FFX Stat 
  Mechanics FAQ (GameFAQs), for the counter model.
- Character sprites: Superpowers asset pack by Pixel-boy, CC0; full 
  attribution in CREDITS.md. The Orrery is original.
