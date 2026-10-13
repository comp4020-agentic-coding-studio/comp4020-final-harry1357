# Crit 9 — All at once

## The breakthrough

Real-time turned out to be a number, not a feature. The socket has been 
there since v1, and the probe that measures it runs before every ship; 
this week it read tens of milliseconds against a requirement of a 
second. So the transport was never the work. The work was the decision 
the brief asks for: what the app does when two people act at once. I'd 
assumed the kind answer was to queue the second press so nobody's action 
is wasted. Deciding it from the README instead of from what feels kind 
gave the opposite answer: the server is the only authority on the queue, 
so the second press is refused, by name, with the cost written next to 
it.

## What it changed

Two things. A draft of this week's process document said the app 
polled. It doesn't, and the agent inserting the text flagged that the 
claim contradicted the commit it cited. I'd written from memory of a 
plan rather than from the repo, the exact mistake I'd spent the semester 
catching agents in. The record is the source now, including for my own 
account of it. And the battle screen I'd thrown away and lost to a 
budget came back under an extension in three hours, because the shipped 
tag was a floor and the merge had a gate. A gamble with a floor isn't a 
gamble. That's how I want to take every risk from here: name what 
stands if it fails, then go.
