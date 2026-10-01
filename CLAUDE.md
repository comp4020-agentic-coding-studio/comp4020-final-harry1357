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

## Design: final project — the rail

The subject is a turn-order rail on a games table: a brass bar with a strike
plate at one end, and a token for everyone in the fight sliding toward the
plate one notch per tick. Whoever reaches the plate acts; everyone else waits
where they stand. That is the CTB queue made into a thing you could pick up,
and it is the right picture for this app specifically, because there is only
one rail. The server owns it, and every screen in the room is a window onto the
same bar.

**Original, all of it.** The roles (Bulwark, Lancer, Mender, Herald), the enemy
(The Orrery) and every sigil are drawn for this app as inline SVG built from
basic shapes. No sprites, portraits, icons, fonts, sounds, names or UI from any
existing game. Final Fantasy X supplies the arithmetic, cited in A1, and
nothing visible. The Mender's sigil is a ringed circle, not a cross: a red
cross is a protected emblem, and a green one is still somebody's first-aid
icon.

**Palette**: six tokens, five roles.

| token | hex | role |
| --- | --- | --- |
| `--felt` | `#1d2a24` | background: the table the rail is bolted to |
| `--card` | `#f1ead9` | surface: the panels, and the ground all body text sits on |
| `--ink` | `#1a1814` | text |
| `--ink-quiet` | `#5b5446` | text, quiet: labels, the log's tick column |
| `--brass` | `#b58a3a` | accent: the rail, its notches, the strike plate — the queue and nothing else |
| `--ember` | `#b3341f` | highlight: harm — the Orrery's turn, damage, a downed token |

`--brass` is reserved for the queue. The moment a button or a heading is
brass, the rail stops being the one thing on the table made of metal.
`--brass` on `--card` is about 2.6:1, too low for text, so a link on a card is
`--ink` with a brass underline, never brass letters.

**Type pairing**, replacing the browser default (Times, which is what the
placeholder rendered in):

- display: `Copperplate, "Copperplate Gothic Light", "Engravers MT", "Iowan Old
  Style", serif`, the lettering engraved on a brass name plate
- body: `"Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua",
  Georgia, serif`, because a raid is read like a rulebook
- mono: `ui-monospace, "SF Mono", Menlo, Consolas, monospace`, for **counters,
  HP and tick numbers only**. Mono means "the server computed this number";
  spending it on labels spends that meaning.

No web fonts. Nothing is fetched from a third party, and the first paint of a
turn-based game should not wait on a typeface. stylelint's `value-keyword-case`
lowercases unquoted family names, so the served stack reads `copperplate`.
Font matching ignores case, so that changes nothing. Don't "fix" it back.

**Signature element: the turn queue as a physical rail.** A notched brass bar
with the strike plate at its leading end. Each combatant is a disc token
stamped with its sigil, the name on a tag beneath, placed at the notch its
counter says. Tokens on the same notch stack in seat order. The token on the
plate is the active one, and only the server puts it there. Between two server
states a token may *slide* (CSS transition, off under
`prefers-reduced-motion`), but it always lands exactly where the latest state
says. The rail renders the queue; it never computes it. At 390px the rail
stands up vertically, plate at the top, rather than shrinking its notches to
nothing.

**What the starter's defaults are being replaced with**, since there is no
keep-the-starter option:

- Times, the browser default → the three faces above
- default link blue and visited purple → `--ink` text, `--brass` underline
- white page and a single centred column → `--felt` table carrying the rail
  across the top, with the action panel beside the log beneath it (two
  columns that collapse to one), all body text on `--card` panels
- unstyled form controls → square-cornered fields and buttons on `--card`,
  with a visible `--ink` focus ring

**Lifted, by name: the radius ban, for token discs only.** A token is a
counter on a rail, and a counter is round. Drawing it square to satisfy a rule
written against framework defaults would make the signature element worse in
order to obey a gate that was never about it. The lift covers `.token-disc`
(and its pseudo-elements, which draw the active ring). It does **not** cover
the `.token` box, which also holds the name tag; the tag is a card and stays
square. Everything else keeps the 2px ceiling.

- **Where it's lifted:** in `.stylelintrc.json`, as the gate says. That file is
  strict JSON and can't hold a comment, so the plugin's `allowSelectors`
  option *requires* a `lifted` string naming this block and the reason. A lift
  without one is a config error, and nothing is lifted.
- **How it's held:** `spec/gates.test.ts` runs the real config. A disc may be
  round; a tag, a button or the token box may not; a lifted selector can't
  carry an unlifted one in through a selector list; and a lift that doesn't
  say why is refused.
- **Tokens are still drawn as SVG `<circle>`s,** because SVG is the better tool
  for a stamped disc with a sigil inside it. That's a drawing choice, not a way
  round the gate; the lift is what makes the disc legitimate.

No other gate is lifted. A hard-edged token shadow (`2px 2px 0`) is the only
shadow in the design.

**How the gate's design test works on this template.** The starter here
shipped no stylesheet at all (the placeholder rendered in browser defaults),
so there is no starter theme in git to compare against. `spec/design.test.ts`
instead holds the served CSS to **the palette table above**, parsed out of
this file at test time. Change a hex here without changing the stylesheet, or
the other way round, and the spec goes red. `spec/contrast.test.ts` does the
WCAG arithmetic on the pairs this block claims, plus a floor of 2:1 between
`--ink` and `--ink-quiet` so the two inks can't collapse into one. WCAG has no
figure for that gap, so 2:1 is my number; the palette sits at about 2.4.

## What the app must never do

These are the claims the raid stands on, written as prohibitions. Each one says
where it is held: a `spec/` test, or *judged* when only reading the code can
catch it. If a change needs one of these broken, stop and say so. Don't route
around it.

1. **No client ever decides turn order.** The server is the only authority on
   whose turn it is. Client code never sorts the queue, never decrements a
   counter, never predicts the next actor, and never enables an action because
   *it* thinks a counter reached zero. It renders the `queue` and `activeId`
   the server sent, in the order sent. Animating a token between two server
   states is drawing, not deciding. *Spec: two clients in one battle receive
   identical queues. Judged in `src/client/`.*
2. **An action is never queued.** An action arriving while the actor's counter
   isn't zero is rejected (409) and dropped. It is not buffered, not deferred to
   their next turn, and not retried by the client. The client holds no pending
   action either: the action panel stays disabled until the server says it is
   your turn. *Spec: an early action is rejected, and nothing fires when the
   turn comes.*
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

## How to work in here

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
  (20000).
- **`pnpm check` needs the app running**, because every spec runs over HTTP.
  The exception is `spec/restart.test.ts`, which boots and SIGKILLs its own
  server from source on a temp database, because a restart can't be done to
  somebody else's process.
- **Off the roster, run by hand** (they need Chrome; a roster that goes red
  because a browser didn't launch teaches you to ignore it). Each takes
  `APP_URL`:
  - `pnpm check:viewports`: 1920×1080 and 390×844, clientWidth then
    innerWidth, on `/readme/`, `/` and `/` with a full table of 24-character
    names
  - `pnpm check:keyboard`: join and strike by keyboard alone; every stop has
    a visible ring
  - `pnpm probe`: two separate browsers, measured propagation of one strike
    to the other screen; fails any sample over 1000 ms

  Run the first two after any layout work and the probe after any change to
  how state reaches the page.
- **Server code is erasable TypeScript only** (`erasableSyntaxOnly`): no
  `enum`, `namespace` or parameter properties, and relative imports carry
  `.ts`. tsc refuses them first, so Node never meets them.
