# Final project reflection

**What was the breakthrough that moved the work forward?**

Learning when to close a review. The gate I built found real holes every time it ran: a Lunge killing a stack early, a fight anyone could mint with one request, a reviewer that could write files. Then it kept running, and the findings got smaller until it was hunting Unicode look-alikes for a name check that protected nothing, because every log line already carries `echo=true` or `false`. The breakthrough was writing down which property mattered, closing the rest as recorded risks, and putting a stopping rule into CLAUDE.md so the next gate had an end. A harness that can't stop is anxiety with a commit log. The same week the harness turned on me twice: a clause I wrote into a rule had no test that could fail, and a target I set for fight length produced a long, easy boss. Both corrections landed in the record, not in a retry.

**What did this work change about who I want to be as a software developer?**

I used to think directing agents meant writing better prompts. It means owning the targets. Everything the agent optimised, it optimised exactly as measured, and every bad outcome traces to a measurement I chose badly or a property I never wrote down. The developer I want to be decides what the system is held to, keeps reviewers that can't approve, puts intent where the next reader will find it, and rules on when a question is closed. That part can't be handed off, and this project is the first time I've seen clearly that it is the whole job.
