# Harness

Carried forward from `comp4020-crit7-harry1357` and rebuilt for the final
project. These are rules I decided on, mostly the hard way; each one is here
because something went wrong once and I'd rather not find it again.

**What the starter fixes is explained where it lives** — `fly.toml`, the
`Dockerfile`, `.github/workflows/checks.yml` and `spec/README.md` each say what
they own. Don't restate them here. This file is the part that's mine:
conventions to hold to, sensors that keep catching me out, and facts about the
stack the agent keeps getting wrong.

This repo carries the final project from crit 8 to submission. The brief and
the crit specs are on the course website (`assessments/final-project/`,
`crits/08-its-alive/`, `09-all-at-once/`, `10-fly-by-instruments/`) — read them
there rather than from memory.

<!-- CARRY-FORWARD:BEGIN design-gates
     Standing policy, not week-specific. Every deliverable inherits this
     section verbatim. When this harness is carried into a new repo, this
     block is copied whole — trimming it, or dropping it as "last week's
     notes", is the one edit that is never correct. The part that IS
     week-specific is the `Design: <week>` block that follows the END marker,
     and that one is replaced each week rather than carried. -->

## Design gates — carried forward every week, never trimmed

The look is a decision, not a default. **Before the first UI commit of any
deliverable**, this file gets a `Design: <week>` block naming:

- a **palette** of 4–6 hexes with roles — background, surface, text, one
  accent, one highlight
- a **type pairing** — display face, body face, mono for data; never
  `system-ui` and never the starter's default as the display face
- one **signature element** — the single visual choice a visitor would
  remember
- **what the starter's defaults are being replaced with.** There is no "keep
  the starter" option. A brief saying appearance isn't marked means the floor
  is low, not that the ceiling moved: the look gets a real decision every
  week, and the only thing that varies is how much of the week it gets.

That block is its own commit, landing before any UI does.

**Every visual choice traces to the subject.** A booking board looks like a
timetable on a wall; a JRPG course looks like a spreadsheet; an interrogation
looks like a case file. If a choice could belong to any site, it belongs to
none.

**Banned everywhere**, unless the week's design block lifts one by name:

- `backdrop-filter` — *stylelint enforces*
- `box-shadow` with a blur radius above 0 — *stylelint enforces*
- `border-radius` above 2px — *stylelint enforces*
- gradient backgrounds as mood
- pill-shaped nav
- a centred max-width column as the *only* layout
- framework or starter component styling left untouched

**Body text sits on a solid panel**, and the contrast is checked
arithmetically in `spec/contrast.test.ts`, because axe cannot judge colour
under jsdom. When the palette changes, that test's pairs change with it —
against the ground each ink is really painted on, not against the page.

**Nothing visual is accepted from a screenshot until the probe has been
checked first: `innerWidth` must equal the viewport it claims, or the
screenshot is of a different page.** Both numbers are checked, and they fail
differently, which is why both are worth having.
`documentElement.clientWidth` not matching means the *emulation* never took,
so the run describes a viewport nobody asked for —
`scripts/check-viewports.ts` throws on that. `innerWidth` not matching means
the *page* did not fit: under mobile emulation the layout viewport expands to
meet content wider than itself, so the browser reports the overflow by
growing. That fails the route.

### The two checks this section owns

1. **stylelint.** `declaration-property-value-disallowed-list` bans
   `backdrop-filter` at any value; the local plugin in `stylelint-plugins/`
   rejects a `box-shadow` whose blur is above 0 and a `border-radius` above
   2px. A hard-edged shadow (`4px 4px 0`) is allowed and is usually what the
   design wanted anyway. If a week's design block lifts one of these, it is
   lifted **in `.stylelintrc.json`**, with a comment naming the week.
2. **`spec/design.test.ts`.** Reads the CSS the app actually serves and fails
   if the display face or the accent colour still equals the starter's — the
   mechanical half of "not the starter with the nouns swapped". It reads the
   starter's own theme out of git at test time (the first committed version
   of `src/styles.css`), so there is no value written into the test to go
   stale and no SHA to update when the template moves.

<!-- CARRY-FORWARD:END design-gates -->

## Design: the battle screen

The subject is a JRPG battle screen that a player of the genre recognises on
sight: a field with depth, the party on one side, a large enemy on the other, a
bordered command window with a cursor, damage numbers that pop and rise, and a
turn-order strip. **The genre's conventions are ours to use. Its assets are
not.** Nothing comes from an existing game: no sprites, portraits, window
styles, logos, enemy designs, fonts made to imitate one, or music. Every file
is original or openly licensed under rule 12 below. The Orrery and all the UI
chrome are original regardless of what the party art is.

**Scope: inside `#battle`, the game's rules; outside it, the web's.** `#battle`
is the whole game stage: the character select and the fight. Inside it these
gates are **lifted by name**, because each is a convention of the genre being
drawn, not a framework default:

- **radius**: window corners and HP-bar caps
- **gradients**: the field's depth, the floor's falloff, window fills
- **glow**: blurred shadows and drop-shadows for the Orrery's core, hit
  flashes and the lit portrait
- **pixel fonts**: the pixel faces below

Radius and glow are lifted mechanically, in `.stylelintrc.json`, through the
plugin's `allowSelectors` with a required `lifted` reason. The pattern matches
only selectors that *begin* with `#battle` (so `#battlefield` doesn't count),
and it follows CSS nesting up to its parent rule. Gradients and pixel fonts
are judged gates with no linter, so this paragraph is their lift.
`spec/gates.test.ts` holds the scope: everything inside `#battle` may be soft
and glowing; the site header, the `/readme/` page and anything else outside it
may not.

**The look:** 16-bit-era pixel art on a deep observatory field: a domed dark
sky with a faint star grid, and a perspective floor that recedes toward the
Orrery. The brass-and-ink palette carries over as the UI chrome: windows are
ink panels with a brass border and card-coloured text. Sprites are scaled by
whole numbers with `image-rendering: pixelated` and are never smoothed.

**Palette**: six tokens. Everything else is mixed from them (`color-mix`),
never a seventh hex.

| token | hex | role |
| --- | --- | --- |
| `--void` | `#0a0e1a` | background: the observatory dark, and the field the floor is drawn from |
| `--ink` | `#1a1814` | surface: every window, plate and portrait frame |
| `--card` | `#f1ead9` | text: window text, names, damage numbers |
| `--card-quiet` | `#a89f8c` | quiet text: labels and secondary lines on windows |
| `--brass` | `#b58a3a` | accent: window borders, the cursor, the Orrery's rings |
| `--ember` | `#e0563a` | highlight: harm — the Orrery's turn, hit flashes, a downed portrait |

`--ember` is brighter than the rail's ember because its grounds are now dark:
it clears 4.5:1 on both `--ink` and `--void`. Healing is `--card` with a `+`
and a brass outline, not a seventh colour. `spec/contrast.test.ts` holds the
pairs, and `spec/design.test.ts` holds this table to the served CSS.

**Type**, loaded from Google Fonts with real fallbacks, and used **only inside
`#battle`**:

- display: `"Press Start 2P", Silkscreen, ui-monospace, Menlo, monospace` for
  the title, window headings and damage numbers
- body: `VT323, ui-monospace, "SF Mono", Menlo, monospace` for everything
  else on the stage, numbers included (VT323 is monospaced already)

The faces are SIL OFL 1.1. They are served by Google, not shipped, so rule 12
(which covers files under `src/assets/`) doesn't reach them. CREDITS.md lists
them anyway, under "served, not shipped". **Never self-host them under
`src/assets/`**: OFL isn't CC0 or CC-BY, so that would break rule 12. Outside
`#battle` (the header link, `/readme/`) the gates stand, and the rulebook faces
carry on: `Copperplate, "Copperplate Gothic Light", "Engravers MT", "Iowan Old
Style", serif` for display and `"Iowan Old Style", "Palatino Linotype",
Palatino, Georgia, serif` for body, on `--card` with `--ink` text.

**Signature element: the Orrery.** An original clockwork enemy of nested brass
rings rotating around a dark core, drawn as SVG with each ring its own group so
the rings turn independently, alternating direction at different periods. The
core may be a pixel sprite. It idles constantly. **As its HP falls the rings
slow, and they lose segments**: each ring is a set of arc segments, and the
outer rings shed theirs first, at fixed HP thresholds, so the enemy visibly
comes apart. Revolution spins the rings up. A hit flashes them. Under
`prefers-reduced-motion` nothing rotates, but segments are still shed and the
flash is a single static frame, so the state change still shows.

**Composition, 1920×1080:** the field fills the stage. The party stands left
in a staggered row on the floor (back rank higher and smaller), each with a
name and HP bar beneath, facing right. The Orrery is large on the right. The
turn strip runs down the right edge: portraits ordered by wait, the active one
at the top and lit, your own marked, Hasted and Braced as icons on the
portrait. The command window sits bottom left, bordered, with the cursor. The
log is a narrow window beside it, the least important thing on screen.

**Composition, 390×844:** the Orrery at the top, the turn strip horizontal
beneath it, then the party, then the command window. Nothing scrolls sideways.
`innerWidth` is checked before any measurement is believed.

**Motion:** idle on everything (sprites breathe, rings turn, the core pulses),
a slight camera push-in on impacts, and screen shake on heavy hits. Damage
numbers pop and rise. Under `prefers-reduced-motion` every effect has an
equivalent that shows the same state change with no movement: frame swaps,
bars set rather than drained, numbers that appear in place.

**What the previous design is replaced with**, since there is no keep-it
option:

- the brass rail → the turn strip of portraits. It is still the server's
  queue, rendered in the order sent (rule 1).
- disc tokens → licensed party sprites and the original Orrery
- the felt table → the observatory field and perspective floor
- serif and Copperplate on the stage → the two pixel faces (the rulebook faces
  stay outside `#battle`)
- the action panel of buttons → a bordered command window with a cursor,
  operable by arrow keys and Enter alone, as well as by mouse and touch

## What the app must never do

These are the claims the raid stands on, written as prohibitions. Each one says
where it is held: a `spec/` test, or *judged* when only reading the code can
catch it. If a change needs one of these broken, stop and say so. Don't route
around it.

1. **No client ever decides turn order.** The server is the only authority on
   whose turn it is. Client code never sorts the queue, never decrements a
   counter, never predicts the next actor, and never enables an action because
   *it* thinks a counter reached zero. It renders the `queue` and `activeId`
   the server sent, in the order sent; the turn strip is that queue drawn as
   portraits. Animating between two server states is drawing, not deciding.
   *Spec: two clients in one battle receive identical queues
   (`spec/queue.test.ts`), and the strip draws the queue in the order sent,
   never re-sorted (`spec/strip-order.test.ts`).*
2. **An action is never queued.** An action arriving while the actor's counter
   isn't zero is rejected (409) and dropped. It is not buffered, not deferred to
   their next turn, and not retried by the client. The client holds no pending
   action either. The turn's actions stay disabled until the server says it
   is your turn. A Reaction is different: it is live only while the server
   says one is ready for you (reactionReady) and only against the card the
   server names, and it is the one thing the command window offers off-turn.
   The client decides nothing about when either is available. *Spec: an early
   action is rejected, and nothing fires when the turn comes.*
3. **No accounts.** A person is a session cookie, plus a name, plus a role.
   Nothing else: no email, password, OAuth or profile page. The server mints
   the cookie (HttpOnly). Identity always comes from the cookie, never from a
   name or id in a request body.
4. **No two people in one battle share a name.** Names are compared trimmed
   and case-insensitively. A join that collides is refused (409), never
   suffixed or silently renamed. The same name in a *different* battle is
   fine. *Spec.*
5. **The live fight lives in memory, and every turn is written through.** The
   battle in progress is held in the one Node process, and SQLite is never read
   to decide what happens next. After every turn (a player's action, a timeout,
   or the Orrery's move), that turn's durable consequences are written to
   SQLite on the volume: the log line, the characters' records and the battle's
   status. That write happens **before** the new state is broadcast, so nothing
   anyone has seen can be lost to a crash.
6. **Characters and battle logs survive restart and redeploy. Fights don't,
   and the app never pretends they did.** On boot, any battle still marked live
   is closed as abandoned, with a log line saying the server restarted. A fight
   is never resumed with counters reconstructed or invented. *Spec: a
   character survives a restart, and a completed battle's log is readable
   after one.*
7. **The database is only ever on the volume.** In production that is
   `DATABASE_PATH` under `/data`. Never a file baked into the image, and never
   a path that only exists locally.
8. **The room never waits on one person.** A character on the strike plate
   has 12 seconds to decide (`TURN_TIMEOUT_MS`, 12000). On a timeout the
   server Braces for them: the one safe action, at rank 2, which halves the
   damage they take and banks a Charge. Their portrait dims (drifting). Three
   timeouts **in a row** and the character becomes an automated *Echo*
   (rule 25), playing its role's policy at low output, until the person acts
   again, which ends the Echo at once. When a timed-out seat's Echo reaches
   the plate it waits a three-second beat (`ECHO_BEAT_MS`): an action from its
   person in that window is an ordinary turn that ends the Echo; otherwise the
   server plays it. An Echo seated on purpose has no person to wait for, so it
   gets no beat and is played on the next tick (ADR-007). Off its turn an
   Echo does only what anyone may: a Reaction against a card already on the
   strip (rule 18). So rule 2 stands. An Echo's turns are the Echo's: logged as the
   Echo's, never counted in the person's record. Acting resets the count. A
   timeout never decides *order*: the auto-Brace takes a turn the clock
   already gave them, at Brace's rank.
   This supersedes the old hold rule (two holds and you leave, nothing chosen
   in your name), on purpose: the overhaul's design record (ADR-006) chose an
   auto-Brace and an Echo over removal, so a room keeps its seats.
   *Spec: `spec/pacing.test.ts`, `spec/economy.test.ts`, `spec/echo.test.ts`.
   Why: `docs/adr/002`, `docs/adr/006`, `docs/adr/007`.*
9. **Parallel agents aren't capped; the meter is read instead. Before any
   pass with more than three parallel agents, the weekly budget is read at
   /api/me, and passes expected to cost more than half of what remains start
   on the day the allocation resets.** *Judged: no test can see a launch.
   Why: `docs/adr/004`.*
10. **When two actions arrive for one turn, the server's clock decides; the
    second is refused with the name of whose turn it is, never queued.**
    *Spec: `spec/two-at-once.test.ts`. Why: `docs/adr/005`.*
11. **Every state change is shown on the battle screen before it reaches the
    log. The log is derivative; an event with no renderer doesn't ship.** Every
    event kind the server can broadcast has a renderer in the client's
    registry, and the client writes an event's log line only once its renderer
    has shown it. *Spec: `spec/shown.test.ts`. Every broadcast event type has a
    renderer, and on B's screen the strike shows within one tick and before its
    log line.*
12. **No asset ships without a licence. Every file under `src/assets/` has an
    entry in `CREDITS.md` with source URL, author and licence, and the licence
    is CC0 or CC-BY only. Nothing from a commercial game, nothing share-alike,
    nothing marked personal use.** CREDITS.md is written *before* a file is
    copied in, not after. *Spec: `spec/assets.test.ts`.*

### The action economy (ADR-006)

The overhaul's rules, from the design record (`docs/design/overhaul.md`). The
server holds every one of them; the client draws them and decides none. The
numbers are starting values for playtesting, but while they stand, they are
the rules.

13. **Ranks run 1–5, and wait = tickSpeed × rank × haste.** 1 Quick, 2 Light,
    3 Standard, 4 Heavy, 5 Ultimate. Haste halves the reset, never the rate
    (A1's model, `src/server/ctb.ts`). *Spec: `spec/economy.test.ts`.*
14. **A weakness hit refunds one rank (Resonance), and the portrait visibly
    jumps.** Hitting a ring weakness, or a Broken ring, resets the actor's
    counter as if the action were one rank lower (never below 1), and the
    server says so in an event the strip can draw. *Spec:
    `spec/economy.test.ts`.*
15. **Consecutive player turns with no boss card between them form a Chain.**
    +10% potency per link, capped at +50%. Any boss action resets it to zero.
    *Spec: `spec/economy.test.ts`.*
16. **Exposed stacks are applied by one player and spent by another, and every
    stack shows who applied it.** The server records the applier on each stack
    and the spender when it is consumed, and both are in the state the client
    is sent. *Spec: `spec/economy.test.ts`.*
17. **Brace is rank 2, halves incoming damage, and banks one Charge (max 3).**
    A Brace at three Charge banks nothing more. *Spec:
    `spec/economy.test.ts`.*
18. **Each player has one Reaction per boss turn, triggered off a telegraphed
    card.** A Reaction is taken out of turn, only against a boss card already
    on the strip, and only once between two boss turns. It is not an action
    queued for later (rule 2): it answers a card that is already announced.
    *Spec: `spec/economy.test.ts`.*
19. **Every boss attack is announced on the strip before it resolves.** Each
    boss action is first emitted as a card with an intent, a target and a
    countdown; nothing the Orrery does arrives unannounced. *Spec:
    `spec/orrery.test.ts`.*
20. **The Orrery's HP is set at the pull, from the seats present, as base ×
    seats^0.75, with an Echo counting as half a seat.** A bigger room is
    slightly favoured, and difficulty comes from mechanics, never HP alone. A
    late joiner does not change a running fight's HP; the next fight
    re-scales. *Spec: `spec/orrery.test.ts`.*
21. **No mechanic ships without a renderer and a test.** A new rule here gets a
    spec test before it is code, and every event it emits gets a renderer
    before it reaches a player (rule 11). *Spec: `spec/shown.test.ts`,
    `spec/effects.test.ts`.*

### Rooms and Echoes (ADR-007)

22. **A room is a code, and nothing more.** The server mints a short code
    when a seated player (a session with a character) asks for one. Nothing
    lists rooms, nothing owns one, and no password, invite or account stands
    behind a code (rule 3). A wrong code is refused (404), never guessed at or
    redirected to another room. While a private room's fight lasts, its code
    is the only way in: it isn't joined, watched or read by its battle id.
    *Spec: `spec/rooms.test.ts`.*
23. **The public raid always exists, and it is the default door.** It is a
    permanent room, always open and never expiring. `/api/raid` names it, and
    anyone arriving without a code is sent there. *Spec:
    `spec/rooms.test.ts`.*
24. **Nothing crosses between rooms except the character.** Each room has its
    own fight, queue and broadcast. An action in one room changes nothing in
    another's queue, and a seat acts only in its own room. A character (name,
    role, record) persists across rooms and the seat is per room, so one
    character in two rooms is two seats and one record. *Spec:
    `spec/rooms.test.ts`.*
25. **An Echo is a seat the server plays, and it gets no favours.** Someone
    seated in the room seats it on purpose: one per role, at most four per
    room. A seat that times out becomes the same Echo (rule 8). It plays a
    fixed policy for its role, using that role's actions only and reading
    only the state every client is sent, at low output: what it deals and
    heals is `ECHO_POTENCY` of a person's, and its other effects are its
    action's own. Every action it takes goes through
    the same check a person's does: the queue, its role, rule 2 and rule 10's
    refusal. Every state marks it as an Echo, it counts half a seat at the
    pull (rule 20), and its turns are never in anyone's record. *Spec:
    `spec/echoes.test.ts`.*
26. **Rooms expire. Logs and characters don't.** A room whose fight has had
    no person seated in it for fifteen minutes (`ROOM_EMPTY_MS`) is gone, and
    its code with it. The public raid never expires. A finished fight's log
    stays readable by its battle id after its room is gone. A bare battle
    (`POST /api/battles`, a fight with no room, kept until the client moves
    onto rooms) goes the same way on the same window. Rooms live in memory
    like fights and don't survive a restart; characters do (rule 6).
    *Spec: `spec/rooms.test.ts`.*

## How to work in here

- **No phase merges without the review gate: reviewer and breaker run on a
  fresh context after integration, their findings are fixed in commits that
  name them, and the gate's reports are kept in docs/review/<phase>.md.** The
  two agents are `.claude/agents/reviewer.md` (reads the diff from main against
  this file, every ADR and every spec; read-only, its Bash held to `git diff`
  and the test runner by `.claude/agents/reviewer-bash.sh`) and
  `.claude/agents/breaker.md` (attacks a running local instance through the
  API, the WebSocket and Chrome; never the live deploy). Neither can approve.
  **Findings outside the phase's surface are carried as red tests and listed
  open in the review; the branch does not merge to main while any review
  finding is open.**
- Commit when the checks pass. Never commit a red state, **with one
  exception**: a `spec/` test that is red because the feature isn't built yet
  is a *target*, not a regression. Those are committed red on purpose, and the
  red-to-green commits are the record of the work. Never weaken one to get a
  green roster. If a spec test is wrong, say why and change it deliberately, in
  its own commit.
- `README.md`, `PROCESS.md` and `reflections/` are mine. Don't write them,
  draft them or "tidy" them.
- **Run it:** `pnpm build && DATABASE_PATH=.data/raid.db pnpm start`, which
  serves on `:8080`, the port `pnpm check` looks at by default (`APP_URL`
  overrides it). The server is TypeScript run straight by Node (ADR-001); only
  the client is built, so after a client change rebuild and reload. After a
  server change restart the process, which ends every fight in progress, by
  design. Env: `PORT`, `DATABASE_PATH`, `TICK_MS` (150), `TURN_TIMEOUT_MS`
  (12000), `ECHO_BEAT_MS` (3000), `ROOM_EMPTY_MS` (900000).
- **`pnpm check` needs the app running**, because the specs run over HTTP.
  Three exceptions boot or drive something of their own:
  - `spec/restart.test.ts`, `spec/pacing.test.ts` and the first test in
    `spec/shown.test.ts` boot their own server from source (`spec/boot.ts`:
    `PORT=0`, the server reports the port it bound) with a scratch database,
    a fast clock or a short turn.
  - `spec/command.test.ts` mounts the real command window in jsdom.
  - **The second test in `spec/shown.test.ts` drives real headless Chrome**
    (`spec/browser.ts`), because "B's screen shows the strike before its log
    line" is a claim only a rendered page can answer. That reverses the old
    rule that Chrome stays off the roster, on purpose and for this one claim:
    CI's `ubuntu-latest` runner ships Chrome, and `spec/browser.ts` fails
    loudly (never skips) when there's none. If it ever goes red because a
    browser didn't launch, fix the launch. Don't move the claim off the
    roster.
- **Off the roster, run by hand.** These need Chrome and measure layout,
  timing and feel rather than a contract. Each takes `APP_URL`:
  - `pnpm check:viewports`: 1920×1080 and 390×844, clientWidth then
    innerWidth, on `/readme/`, `/` and `/` with a full table of 24-character
    names
  - `pnpm check:keyboard`: join and strike by keyboard alone; every stop has
    a visible ring
  - `pnpm probe`: two separate browsers, measured propagation of one strike
    to the other screen; fails any sample over 1000 ms
  - `pnpm check:tags`: at 390×844, a table of four with 24-character names
    plays a run of strikes, and no two name plates may intersect. It
    measures where things *land* (reduced motion), and it self-tests on
    planted boxes first.

  Run the viewport, keyboard and tag checks after any layout work, and the
  probe after any change to how state reaches the page.
- **The battle screen is assembled from parts that meet in one contract,
  `src/client/battle/api.ts`.** Effects (`src/client/battle/registry.ts`) talk
  to the scene, the strip and the audio only through its methods. That keeps
  the registry importable without a DOM, and lets `spec/effects.test.ts` run
  every reduced variant against a recording stand-in. A new visual idea
  becomes a method there (state or motion, and say which) before it becomes
  code anywhere else.
- **Assets go in through CREDITS.md, not past it** (rule 12). Write the row,
  then copy the file. `pnpm assets` rebuilds everything derived (the down
  frames, `sprites.json`, the Orrery) from `scripts/assets/`, and the source
  sheets are pinned to an upstream commit. Never edit a derived file by hand;
  change its script.
- **Server code is erasable TypeScript only** (`erasableSyntaxOnly`): no
  `enum`, `namespace` or parameter properties, and relative imports carry
  `.ts`. tsc refuses them first, so Node never meets them.
