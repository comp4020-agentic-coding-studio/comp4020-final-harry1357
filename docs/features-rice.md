# Forty recommended features, scored with RICE

*Reviewed on 29 October 2026 against the build that is live: `5a5a57c` on
`main`, the overhaul merged and deployed. A scratch copy of that build was
played in headless Chrome, solo with four Echoes, at 1920×1080 and 390×844.
These are candidates, not decisions. Each one still has to pass CLAUDE.md: a
spec before code and a renderer before players (rules 11 and 21), the
six-token palette, and the review gate.*

## What changed since the last list

- **The game is live.** Rooms, the lobby, Echoes, five roles and the
  three-phase Orrery are on the deploy, so Reach is now measured against real
  visitors rather than a branch.
- **Two of last time's items were already built**, and are dropped:
  - *every action gets its own frames:* heals, Scan and Mark play cast frames,
    and Brace, Bastion, Intercept and Anchor play guard frames;
  - *the Orrery changes form each phase:* phase II's pointers, phase III's
    aligned, running-hot rings (`scene.css:592`).
- **Playing it found six new items:** 1, 3, 4, 10, 15 and 18.

## The scales

- **Reach:** out of 100 showcase visitors, how many would meet the feature
  in a session.
- **Impact:** 3 massive, 2 high, 1 medium, 0.5 low, 0.25 minimal.
- **Confidence:** 100% (seen in play or verified in the code), 80% (strong
  reason), 50% (a guess).
- **Effort:** person-days with agents. This includes the red spec, the
  renderer and a share of a review gate, so the numbers rank features against
  each other rather than estimate calendar time.
- **Score** = Reach × Impact × Confidence ÷ Effort.

## Ranked

| # | Feature | Area | R | I | C | E | Score |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Take a Seat above the fold | UI | 100 | 1 | 100% | 0.5 | **200** |
| 2 | Your-turn nudge | UI | 90 | 0.5 | 80% | 0.5 | **72** |
| 3 | Copy-link and share for the room code | UI | 60 | 0.5 | 100% | 0.5 | **60** |
| 4 | A favicon, and no refusal per page load | UI | 100 | 0.25 | 100% | 0.5 | **50** |
| 5 | "The table needs…" on the join screen | Education | 70 | 1 | 80% | 1.5 | **37.33** |
| 6 | Number keys pick a command | UI | 50 | 0.5 | 100% | 0.75 | **33.33** |
| 7 | A hint for every role | Education | 90 | 2 | 80% | 4.5 | **32** |
| 8 | Charge finally spends | Mechanics | 90 | 2 | 80% | 5 | **28.8** |
| 9 | Pick the ring | UI | 60 | 1 | 100% | 2.5 | **24** |
| 10 | Your next card, pinned | UI | 80 | 1 | 80% | 3 | **21.33** |
| 11 | Echoes that say why | Education | 60 | 1 | 80% | 2.5 | **19.2** |
| 12 | How-to-play sheet on the stage | Education | 60 | 1 | 80% | 2.5 | **19.2** |
| 13 | Glyph glossary on hover and focus | Education | 70 | 0.5 | 80% | 1.5 | **18.67** |
| 14 | A Reaction for every role | Actions | 80 | 2 | 80% | 7 | **18.29** |
| 15 | Full names on the phone strip | UI | 50 | 0.5 | 100% | 1.5 | **16.67** |
| 16 | Room code as a QR on the lobby | UI | 40 | 1 | 80% | 2 | **16** |
| 17 | The phase moment says what changed | Education | 80 | 1 | 50% | 2.5 | **16** |
| 18 | A solo table that needs its player | Mechanics | 30 | 2 | 80% | 3 | **16** |
| 19 | Weaknesses re-hide each phase | Elements | 60 | 1 | 80% | 3 | **16** |
| 20 | End-of-fight recap | UI | 80 | 1 | 80% | 4 | **16** |
| 21 | In-game motion and flash settings | UI | 15 | 2 | 100% | 2 | **15** |
| 22 | Defeat gets its own scene | Art | 40 | 0.5 | 80% | 1.5 | **10.67** |
| 23 | Victory poses | Art | 50 | 0.5 | 80% | 2 | **10** |
| 24 | A short tour on a first visit | Education | 70 | 1 | 50% | 4 | **8.75** |
| 25 | Music that follows the phase | Art | 50 | 0.5 | 80% | 2.5 | **8** |
| 26 | Lobby difficulty tiers | Mechanics | 40 | 1 | 80% | 4 | **8** |
| 27 | Elemental blows | Elements | 80 | 2 | 50% | 10 | **8** |
| 28 | Ring elements in the field's light | Art | 60 | 0.5 | 50% | 2 | **7.5** |
| 29 | Conjunction, the tether | Mechanics | 60 | 2 | 50% | 8 | **7.5** |
| 30 | Audio cues for every role | Art | 50 | 0.5 | 80% | 3 | **6.67** |
| 31 | Reading a finished fight's log | UI | 20 | 1 | 80% | 2.5 | **6.4** |
| 32 | Weakness chart on the Orrery's plate | Elements | 60 | 0.5 | 50% | 2.5 | **6** |
| 33 | Eclipse as a shadow over a row | Mechanics | 50 | 1 | 50% | 5 | **5** |
| 34 | Each Orrery script played in rotation | Mechanics | 30 | 1 | 50% | 4 | **3.75** |
| 35 | Echo difficulty that tracks the table | Mechanics | 30 | 1 | 50% | 4 | **3.75** |
| 36 | A guided first fight | Education | 50 | 2 | 50% | 14 | **3.57** |
| 37 | A sixth element, for a fourth ring | Elements | 40 | 1 | 50% | 6 | **3.33** |
| 38 | The Orrery speaks its cards | Art | 70 | 0.25 | 50% | 3 | **2.92** |
| 39 | Squads for big rooms | Mechanics | 5 | 2 | 50% | 10 | **0.5** |
| 40 | The Cartographer, a sixth role | Actions | 5 | 1 | 50% | 12 | **0.21** |

*Ties are broken by lower effort. Scores within a point of each other are effectively equal: the inputs aren't that precise.*

## The features

### 1. Take a Seat above the fold (UI), 200

At 1920×1080 the join panel puts four role cards on one row and the
Chronist on a row of its own. That pushes the name field and **Take a
Seat** below the bottom of the screen (screenshot, 29 October). Every new
visitor meets this, on a desktop or the showcase projector. Five cards in
one row, or the name and the button beside the doors, brings everything
into one screen. `pnpm check:viewports` should also check that Take a Seat
is visible without scrolling.

### 2. Your-turn nudge (UI), 72

When your turn lights up: the tab title changes ("▶ Your turn: The Rail"),
the phone vibrates (`navigator.vibrate`), and the favicon swaps. A hold
warning already sounds (`src/client/main.ts:92`), but nothing reaches
someone with sound off or in another tab. This is the cheapest defence
against the timeouts that turn a seat into an Echo (rule 8). It is driven by
the server's `activeId` and decides nothing (rule 1).

### 3. Copy-link and share for the room code (UI), 60

The lobby shows the code large, but there is no way to send it. The
`?room=CODE` link already works (`src/client/door.ts:2`). Add a "Copy link"
button (`navigator.clipboard`), plus `navigator.share` on phones, so a
friend across town gets a link instead of five letters read over chat.

### 4. A favicon, and no refusal per page load (UI), 50

`/favicon.ico` returns 404, and the not-found route logs it as a refused
`read` (`src/server/app.ts:387`). So every page load writes one refusal line
that names a session but isn't a refusal of anything, and that noise makes
`docs/narration.md`'s log harder to read. Serve a small icon: the Orrery's
ring, original work, credited under rule 12. Item 2 then has a favicon to
swap.

### 5. "The table needs…" on the join screen (Education), 37.33

The role cards (`src/client/join/join.ts:229`) show each role's blurb and
moves, but not who is already seated in the public raid. Mark the roles the
fight already has, and point to a gap ("No Mender yet"). New players pick a
role knowing what it is for, and the table gets the mix the design depends
on. The data is already in the public state (rule 31).

### 6. Number keys pick a command (UI), 33.33

The command window takes arrow keys, Home, End and Enter
(`src/client/command/window.ts`). Add 1–5 to jump to a command, so a
keyboard player acts in one key within the 12-second timer. It is
additional to the arrows, so `pnpm check:keyboard` holds both.

### 7. A hint for every role (Education), 32

`src/client/command/prompts.ts` holds one hint: the Warden's Bastion while a
Perihelion is coming. Add the rest, each read from state: "Gravity 2 on Bo:
Anchor it", "Middle ring revealed: Pry it", "A ring is Broken: Finisher
doubles", "Lunge in 1 on Cy: Ward them". ADR-006's cost sets the bar: "If a
rule can't be read off the strip, it isn't finished." The hints are advice
only: no action is enabled because of one (rule 2).

### 8. Charge finally spends (Mechanics), 28.8

Brace banks Charge (rule 17), and the command window shows it (CHARGE
◆◆◆ 3/3), but nothing in `src/server/` spends it. In play the meter sits
full all fight, and the log says "their Charge is already full (3)". The
design study says "Charge powers each role's signature move". Let Charge add
potency to Bastion, Restore, Finisher, Shatter and Stillpoint, so a Brace is
an investment as well as a defence.

### 9. Pick the ring (UI), 24

The server accepts a ring as an action's target (`src/server/roles.ts:623`),
but the command window offers allies and cards, never rings, so every blow
goes to the server's default. Add a ring step that starts on the server's
default (`state.preview.target`), so a Breaker can open the inner ring while
the Striker finishes the outer one.

### 10. Your next card, pinned (UI), 21.33

At 1920×1080 the strip's cards are truncated ("ECLIP…", "→ War…"), and at
390×844 the card row hides most targets. The design study asks for "the same
icon on the target's portrait". The strip already draws a card's target on
the portrait (`strip.ts:449`). Add a line in the command window when a card
is aimed at **you** ("Lunge in 1 → you, 8"), in `--ember`, so your own threat
is never one you have to find.

### 11. Echoes that say why (Education), 19.2

An Echo plays a fixed policy that reads only public state (rule 25). Give
each move a one-line reason in its log line and caption ("Warden Echo
Anchors: Gravity 2 on you"). A solo player with four Echoes then learns the
roles by watching them, and an Echo still decides nothing a person couldn't.

### 12. How-to-play sheet on the stage (Education), 19.2

"About this raid" leads to `/readme/`, outside `#battle`, in the rulebook
faces, and off the stage. Add a "?" stop in the command window that opens
one ink panel covering the strip, ranks, boss cards, Chain, Exposed and
Reactions, drawn in the stage's own glyphs. It must work by keyboard and at
390×844.

### 13. Glyph glossary on hover and focus (Education), 18.67

Portraits and plates carry small glyphs (Braced, Hasted, Warded, Gravity,
Exposed, ember, frost, aether), and only a screen reader hears what they
mean (`strip.ts:126`). Add a visible label on hover, on focus, and on a long
press on a phone, built from the same words the screen reader gets.

### 14. A Reaction for every role (Actions), 18.29

Rule 18 gives every player one Reaction per boss turn, but only the Warden
has one. `intercept` is the only action marked `reaction: true` in
`src/shared/protocol.ts`. In play, the Warden Echo's Intercept is the only
off-turn move ever logged. Candidates:

- the Mender's Brace-for-ally;
- the Striker's Riposte;
- the Breaker's Read, which shows a card's amount early;
- the Chronist's Nudge, one tick.

Each needs a rule-18 spec, a renderer and an Echo policy. It scores lower
than it matters because of its effort.

### 15. Full names on the phone strip (UI), 16.67

At 390×844 the strip's names are cut to "Chronis…", "Solo…", "Mender…".
With four 24-character names that is all most portraits say.
`pnpm check:tags` holds overlap, not legibility. A tap on a portrait could
show its full plate, or names could wrap to two lines in the strip's own
lane.

### 16. Room code as a QR on the lobby (UI), 16

At the showcase, a friend at the next table scans the code instead of
typing it. It needs a small encoder (a dependency, or about 200 lines in the
client bundle), drawn in `--ink` on `--card`. Item 3 covers most of the same
need for less.

### 17. The phase moment says what changed (Education), 16

A phase change stops the screen, flashes and names itself (rule 28), but
doesn't say what the new phase does. Add one line to the title card:
"Conjunction: the Orrery turns the strip backwards", "The Grand Alignment:
every fourth card is a countdown to a wipe".

### 18. A solo table that needs its player (Mechanics), 16

In our run, a player whose every click landed on Brace (38 Orrery turns,
all three phases) still won, carried by four Echoes at 0.75 output. A solo
table is meant as a floor, but a floor with no stakes teaches nothing. Lower
`ECHO_POTENCY` when one person sits with four Echoes, or give Echoes nothing
to do against a card only a person's Reaction answers. Either way it is
measured against ADR-010's pace band first, and the value stays "ours".

### 19. Weaknesses re-hide each phase (Elements), 16

Each ring's element is fixed (outer ember, middle frost, inner aether,
`src/server/orrery.ts:143`), and once Scanned it stays revealed all fight
(`roles.ts:411`). After a few turns the Breaker's Scan has nothing to do.
Re-hide the weaknesses and shuffle the elements at each phase change, so
the Breaker has a job in every phase and the phase moment changes the
fight, not just the look.

### 20. End-of-fight recap (UI), 16

The waiting room says "Last fight: victory." Add who dealt and healed what,
the longest Chain, the Resonances, and each Exposed hand-off (the state
records the applier and the spender, rule 16). It is a recap of one fight,
not a profile page (rule 3), and Echo lines stay apart from people's
(rule 25).

### 21. In-game motion and flash settings (UI), 15

Reduced motion follows only the operating system
(`src/client/battle/conductor.ts:46`), and a visitor on a shared showcase
laptop can't change that. Add a toggle beside Mute that selects the reduced
variants that already exist. The design study names screen shake as a
motion-sickness trigger. Few people need this, and they need it badly.

### 22. Defeat gets its own scene (Art), 10.67

On a win the Orrery comes apart (`table.ts`, `apart`). On a loss it plays
one attack frame, spins up, and shows a banner. Give the loss its own
moment, the rings closing over a dimmed party, so a loss is a scene and not
a sentence. It needs a reduced variant.

### 23. Victory poses (Art), 10

The party sheets have rows the scene doesn't use for an ending. On a win,
everyone standing plays their special or cast pose once and holds it, so the
table's win reads on the party's side too.

### 24. A short tour on a first visit (Education), 8.75

On a first visit, three callouts on the live stage, one at a time and
dismissable: "This is the turn order", "This card is the boss's next move",
"This is your command window". It is stored per browser
(`localStorage`, wrapped in try/catch), so it never shows twice. No fight
pauses for it (rule 8).

### 25. Music that follows the phase (Art), 8

The sequencer (`src/client/audio/music.ts`, 144 BPM) plays one loop all
fight. Add a layer in phase II, and a faster, sparser loop in the Grand
Alignment. It is atmospheric, but only for players with sound on.

### 26. Lobby difficulty tiers (Mechanics), 8

Let the host pick Gentle, Standard or Hard. Card damage and shield pips
scale, HP doesn't (rule 20). **This needs a rule change first:** rule 27
says the host has "no power beyond Start and the Echo buttons". That means
an ADR and a separate commit for the rule's text.

### 27. Elemental blows (Elements), 8

Players carry no element (`roles.ts`: "Players carry no element"), so a
weakness only means "Scanned". Give each role's blows an element, so the
open weakness changes who should act. That is SMT's "composition decides
which weaknesses you hit", which the design study cites. It is drawn as
glyphs, never new hues, and the pace needs re-measuring.

### 28. Ring elements in the field's light (Art), 7.5

When a weakness is revealed, the ring's element glyph appears
(`scene/glyphs.ts:32`). Let the field pick it up too: a faint ember, frost or
aether cast on the floor under that ring, mixed from the palette with
`color-mix` (no seventh hex). It is cheap atmosphere, but the palette makes
"frost" hard to draw.

### 29. Conjunction, the tether (Mechanics), 7.5

Phase II is named Conjunction and draws its two pointers, but the design
study's tether isn't built: two seats joined by a beam, with damage split
by the number of distinct roles that Join. Its card list
(`src/server/orrery.ts:117`) reuses phase I's intents plus Retrograde. It
needs a new intent, a Join action for every role, renderers, and a re-measure
of the pace.

### 30. Audio cues for every role (Art), 6.67

There are six cues (`strike`, `hit`, `revolution`, `plate`, `hold`,
`phase`; `api.ts:129`), so a Mend, a Scan and a Delay all sound alike or are
silent. Give each role one voice from the synth: a bell for heals, a tick
for the Chronist, a crack for Shatter.

### 31. Reading a finished fight's log (UI), 6.4

A finished fight's log is kept and readable by battle id (rule 26), but only
as JSON at `/api/battles/:id/log`. A page that draws it in the stage's log
window, linked from the waiting room's "Last fight", lets a table reread its
fight.

### 32. Weakness chart on the Orrery's plate (Elements), 6

Show the three rings and their elements as "?" until Scanned, on the
Orrery's plate, so "Scan it" points at something. The rings already carry
the glyphs. This puts them in one place you can read at a glance.

### 33. Eclipse as a shadow over a row (Mechanics), 5

The design study's Eclipse is a healer check: a stacking shadow over one
part of the party that Mender Wards cancel. In the build it is
single-target damage. The study's version gives the Mender a job the strip
announces, but it is a new mechanic with a spec, a renderer and a pace
re-measure.

### 34. Each Orrery script played in rotation (Mechanics), 3.75

Each phase's cards run in a fixed order (`orrery.ts:116`), so a returning
table learns the script. Two or three scripts per phase, chosen at the pull
and announced the same way, keep a second fight fresh. Rule 19 still
holds, because every card is announced before it lands.

### 35. Echo difficulty that tracks the table (Mechanics), 3.75

Echo output is one number (`ECHO_POTENCY`). Scale it by how many people are
seated, so an Echo fills a gap at a table of four but doesn't carry a solo
player (see 18). Rule 25's "low output" still holds at every value.

### 36. A guided first fight (Education), 3.57

A private practice room with a scripted Orrery that plays one card type at a
time and pauses on a prompt until it's answered. It is the strongest way to
teach, but a pause fights rule 8 (no fight waits on a person) and needs its
own ADR. Items 7, 11, 12, 17 and 24 together do most of this for a fraction
of the effort.

### 37. A sixth element, for a fourth ring (Elements), 3.33

A fourth ring that appears in phase III with an element of its own gives
the Breaker a late job and the Grand Alignment a target. It needs new art
from `scripts/assets/orrery.ts`, new tuning, and a glyph that isn't a
colour.

### 38. The Orrery speaks its cards (Art), 2.92

A one-line caption over the Orrery as each card is announced ("I turn
against you all"). It is flavour that also says the card's meaning. It must
be original text, and it is shown before the log line (rule 11).

### 39. Squads for big rooms (Mechanics), 0.5

The design study's Priority 4: squads of four to six, each with a colour
band. It matters only at 12 to 40 seats, which the showcase is unlikely to
reach. `SQUADS = 1` is already the hook in `tuning.ts`.

### 40. The Cartographer, a sixth role (Actions), 0.21

The study's optional squad leader (Plot, Rally, Reroute). It is for big
rooms, so it waits on 39. Reroute swaps two allies on the strip, which
would have to be the server's move (rule 1). It needs new art under rule 12,
and a sixth Echo would break `ECHO_MAX`.

## Considered and left off

- **Stargazers, spectators who vote:** rule 31 says a session with no seat
  "watches but never acts". It needs a ruling first.
- **A player stats page:** rule 3 bans profile pages. The recap (20) and the
  welcome-back line are as far as that goes.
- **Frost that slows the Orrery:** it would change the rate its counter
  drops, which rule 13 forbids.
- **Every action gets its own frames, and the Orrery changes form each
  phase:** both are built (see "What changed").

## Notes

- **The first four are a day's work in total and touch every visitor.** Two
  of them, the fold and the favicon, were found only by playing the deploy,
  not by reading code.
- **Items 8, 14 and 18 are gaps between the rules and the build.** Rule 17's
  Charge is never spent. Rule 18's Reaction exists for one role in five. And
  a solo table can't lose for lack of trying. A reviewer could reasonably
  call either of the first two a finding.
- **The education items (5, 7, 11, 12, 13, 17, 24) answer ADR-006's
  cost:** "there is no time at a showcase to explain them. So the strip
  itself has to teach them."
- **Before the showcase:** the showcase is on 11 November, and ADR-001 says
  not to deploy during it. A pass of more than three parallel agents reads
  the budget first (rule 9).
