# ADR-001: One process, one tick, one volume

- **Status:** accepted
- **Date:** 2026-10-01
- **Supersedes:** nothing. This is the first decision in this repo.
- **Amended by:** ADR-003. The machine no longer stops when idle, so an idle
  stop is no longer one of the restarts that end a fight.

## Context

The final project is a raid: a few people, each in their own browser, fighting
one enemy on a conditional-turn-based (CTB) queue. The queue uses A1's model.
Every counter drops by exactly 1 per tick. Whoever reaches zero acts, and their
counter then resets to `tickSpeed × rank × hasteMultiplier`.

The brief fixes three requirements: multi-user, real-time (other sessions see a
change within about a second, with no reload) and persistent (state survives
sessions, restarts and redeploys). The course platform fixes the box:

- one `shared-cpu-1x` Fly machine with 256 MB of memory
- one volume at `/data`, which is the only storage that survives a restart
- no other service beside the app
- `auto_stop_machines = "stop"`, so the machine stops when nobody is connected

The game adds a constraint of its own. Turn order needs **exactly one
authority** and **one clock**. If two places can each decide whose turn it is,
then sooner or later they disagree, and each player is in a different fight
without knowing it.

## Options considered

### 1. Astro with a backend, as in crit 7

This is the stack I already know works here: Astro in server output with the
Node adapter, Drizzle over `better-sqlite3`, and the starter's SSE guestbook
for live updates. The harness and my crit-7 notes carry straight over.

The problem is that the raid is a single page whose content is entirely live
state. Astro's model is a page rendered per request, and it has nowhere to put
a loop that keeps running between requests. The tick would live in a module
beside Astro, giving two programming models in one process, and the framework
would be rendering one mostly empty shell. I'd be paying Astro's build and its
CSRF and adapter quirks (all recorded in crit 7) for a router I barely need.

### 2. Phoenix LiveView

This is the best structural fit on paper. A process per battle, PubSub, and
the server owns all state while pushing diffs, which is server authority as
the default. The BEAM fits in 256 MB, and `ecto_sqlite3` puts SQLite on the
volume.

Against it: it's a new language and framework for the last five weeks. A1's
CTB engine is TypeScript and would have to be rewritten rather than reused. And
I would be directing an agent in a stack where I can't yet tell good output
from plausible output, which is the exact failure the process mark is about.

### 3. A managed realtime service (Supabase Realtime, Ably, Liveblocks, PartyKit)

This would make the real-time requirement someone else's problem. But
`fly.toml` puts another service outside the course setup. More importantly, it
moves or splits the authority: a broadcast channel that clients publish to is
an invitation for clients to compute state, which is the first thing CLAUDE.md
forbids. It also adds an API key, a network dependency and a second place where
the truth lives.

### 4. A single Node process (chosen)

One Node process owns everything: the HTTP routes, the WebSocket endpoint, one
tick loop, and every live battle held in memory. Each turn is written through
to SQLite on the volume.

## Decision

- **Runtime:** Node 24, running the server's TypeScript directly with Node's
  built-in type stripping, so the server has no build step. Only the client is
  bundled, with esbuild. The cost is that server code is limited to erasable
  syntax: no `enum`, `namespace` or parameter properties.
- **HTTP:** Hono on `@hono/node-server`. I picked Hono over Fastify because
  Hono is small, works with standard `Request` and `Response` objects, and
  `@hono/node-server` 2 upgrades WebSockets on the same server itself (over
  `ws`), with no separate adapter. Fastify's plugin
  encapsulation and schema compilation solve problems that one page and a
  handful of routes don't have. Either fits in 256 MB.
- **Real-time:** a WebSocket endpoint (`upgradeWebSocket` from `@hono/node-server`) that pushes the full
  battle state after every tick and every action. Actions go over HTTP POST,
  so a refusal is a real status code (409) that a test can assert with plain
  `fetch`. The socket only carries state from the server to clients. SSE would
  carry that one-way channel equally well. The socket wins because crit 9 ("All
  at once") asks how the app behaves with several people, and a socket's close
  event gives a presence signal (who is still at the table) for free. Polling at 500 ms is the fallback if the socket fights me this
  week.
- **The tick:** one `setInterval` per process (`TICK_MS`, 150 ms by default).
  Each tick decrements every standing counter by 1, but only while nobody is
  on zero. When someone reaches zero the clock stops until they act, which is
  how CTB works. CTB is ordinal, so timer drift changes how fast the rail
  moves and never the order.
- **State:** live battles are plain objects in memory. SQLite (Drizzle over
  `better-sqlite3`, `DATABASE_PATH` on `/data`) holds characters, battles and
  the battle log. It is written **after every turn and before the broadcast**,
  and it is never read to decide a move.

## Consequences

**The restart trade-off.** A fight lives only in memory, so it ends on any
restart: a redeploy, a crash, or Fly stopping the idle machine once the last
socket closes. Characters and battle logs survive all of those, because they
were written through turn by turn. On boot, any battle still marked live is
closed as *abandoned*, with a log line saying so. I rejected the alternative,
persisting every counter on every tick so fights could resume, for two
reasons. It writes to one small volume six or seven times a second. And
resuming a turn-based fight hours later, with half the party gone, is worse
than ending it honestly.

What that means in practice:

- **Don't deploy during the showcase.** Once the repo is public, every push to
  `main` deploys, and every deploy ends every fight in progress.
- **One authority, so no consensus.** There is nothing to reconcile, and also
  no horizontal scaling. One shared CPU comfortably handles a showcase table
  or two, and the brief asks for nothing more.
- **Write-through cost is per turn, not per tick.** A synchronous
  `better-sqlite3` insert takes well under a millisecond, and turns are
  seconds apart.
- **Testing restarts.** The spec harness runs against an app somebody else
  started, and CI gives that container a `tmpfs` `/data` that any restart
  wipes. So the two restart claims are tested by a spec file that spawns its
  own server from source against a temporary database, kills it with SIGKILL,
  and boots it again. Those two tests exercise the source rather than the
  image. Everything else runs against the image, as the harness intends.
- **Native module.** `better-sqlite3` needs its prebuilt binary, or a
  toolchain in the image's build stage to compile one. The Dockerfile carries
  the toolchain in the build stage only.
- **Logging (crit 10)** has one place to come from. A single process writes to
  stdout, and `fly logs` reads it.

If the single process stops being enough, the next ADR supersedes this one. It
won't be quietly edited.
