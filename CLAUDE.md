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
