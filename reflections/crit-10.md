# Crit 10 — Fly by instruments

## The breakthrough

Trying the attack before writing the rule. The brief says the finding
is a classmate changing what should be yours, so before writing ADR-008
I had the agent send session A's cookie with B's seat in the body
against the running app. It was accepted, and A's own turn was spent
with nothing recorded. The rule, the check and the log line all came
out of that one request rather than from a description of what the
server ought to do. The same instinct then built the review gate: an
agent that hasn't seen the work, reading it against the rules and
trying to break it, found a lethal Lunge arriving a stack early, a
fight anyone could mint without a cookie, and a reviewer that could
write files. None of that was visible in a green run.

## What it changed

The gate caught me as much as the code. Twice its re-review found my
own disposition table claiming fixes that hadn't fully landed, and once
it found a reason I'd written into an ADR that the ADR itself
contradicted. I used to think verification was something I did to the
agent's work. It's something that has to be done to mine too, and by
something that didn't write it. And when the connection failed this
weekend with phase two unstarted, the merge rule meant there was no
half-built thing to ship, only a finished one. The floor is the
freedom to take the risk.
