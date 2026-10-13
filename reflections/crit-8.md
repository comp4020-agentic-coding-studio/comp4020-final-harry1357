# Crit 8 — It's alive

## The breakthrough

The harness was the first thing that broke. I'd written a design-gates
section marked never to be trimmed, and the tool whose job is to carry
the harness forward deleted it before I'd written a line of the app. A
rule saying "don't remove this" is just text, and text can't protect
itself. What protects it is a check that fails the build when it's gone,
so the harness now guards itself: a spec test that reads CLAUDE.md and
fails if the section is missing. It's the first check I've written whose
subject is the harness rather than the app.

## What it changed

Two things, both about trust. Four agents built the first version, one
stalled, and when they all reported done I didn't believe any of them: I
rebuilt the image, re-ran everything, and killed a container on a real
volume. The sensors found two things the agents had called finished.
Then I threw that interface away for failing the README, launched seven
agents on Opus to replace it, and burned the week's budget mid-file. The
first lesson was that an agent's report is a claim. The second was that
my own ambition needs a meter too: I'm keeping the parallel Opus agents,
but the budget gets read before they launch, and the big passes now
start on reset day.
