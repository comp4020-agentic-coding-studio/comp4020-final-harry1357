# Crit 9 — All at once

## The breakthrough

Real-time turned out to be a number I already had. Week 9's probe had
measured 17 milliseconds on polling, and the brief's one second was
never in question, so the transport stopped being the work. The work
became the decision the brief actually asks for: what the app does when
two people act at once. I'd assumed the nice answer was to queue the
second action so nobody's press is wasted. Deciding it from the README
instead of from what feels kind gave the opposite answer. The server is
the only authority on the queue, so the second press is refused, by
name, and the cost of that is written next to it.

## What it changed

Two things. I used to think real-time meant WebSockets; it means a
measurement, and a measurement can turn a scary requirement into a
deferral you can defend. And I lost most of this week to a power cut
and shipped the decision instead of the battle screen. Last month that
would have felt like failure. Now it reads as the right call: the
branch is frozen and intact, the smaller thing is true and tested, and
the pod has something to argue with. Shipping what's finished beats
shipping what's impressive.
