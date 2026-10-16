# ADR-003: Always on

- **Status:** accepted. Revisit after the showcase (11 November 2026).
- **Date:** 2026-10-01
- **Amends:** ADR-001's consequences. The machine no longer stops when idle.

## Context

The template ships `auto_stop_machines = "stop"` with
`min_machines_running = 0`. Fly stops the one machine a few minutes after the
last connection closes and starts it again on the next request. `fly.toml`
says plainly that this is "most of why the app costs cents, not dollars".

Measured on this app on 2026-10-01: the first request after an idle stop took
**4.6 s** to answer `/`. Every request after that answered in about 50 ms.

The brief's top band asks for an app that is robust to "resuming the next
day". A marker who opens it the next morning, and a crit pod or a showcase
visitor arriving at an idle table, all meet the cold start first. For this app
the cost is worse than a slow page:

- the page loads, then opens its WebSocket, and the rail is blank until the
  machine is up
- the first impression of a real-time app is several seconds of nothing
  happening in real time
- under ADR-001, an idle stop also ended any fight still in memory, so a table
  that went quiet for a few minutes lost its fight to the infrastructure, not
  to the rules

`fly.toml`'s fixed shape is one `shared-cpu-1x` machine with 256 MB, one
volume at `/data`, and HTTP on `0.0.0.0:$PORT`. `min_machines_running` isn't
part of that list, so changing it doesn't change the shape the course watches.
It does change the bill.

## Options considered

1. **Keep auto-stop (template default).** Costs cents. Every cold visit pays
   4.6 s, and idle tables lose their fights.
2. **Keep auto-stop and hide the wait.** Show a "waking the table" state while
   the socket retries. Kinder, but the 4.6 s is still there, and a marker
   timing the first load still sees it.
3. **A cron or uptime pinger** that keeps the machine warm by hitting it every
   few minutes. Same bill as always-on, plus an external dependency the course
   setup doesn't include, plus fake traffic in the logs that crit 10's logging
   work would have to filter out.
4. **`min_machines_running = 1` (chosen).** Fly keeps the one machine running.
   `auto_stop_machines` stays as it is; with one machine and a minimum of one,
   it never has a machine it may stop.

## Decision

Set `min_machines_running = 1` in `fly.toml`. Everything else in the file
stays as shipped. The machine is still one `shared-cpu-1x` at 256 MB with one
volume.

## Cost

- **Money:** Fly's calculator prices a running `shared-cpu-1x` with 256 MB at
  $0.00000075 per vCPU-second, times Sydney's 1.27 regional markup. That's
  **about US$0.0034 an hour, or about US$2.47 for a 30-day month**, against
  close to nothing for compute while auto-stop has it stopped. The volume
  ($0.15/GB-month for 1 GB) and a stopped machine's rootfs (a 90 MB image) are
  billed either way. From today to the showcase is about six weeks, so roughly
  **US$3.50 in total**. The app runs in the course's Fly organisation, so the
  course pays it, not me. That's why it is written down here rather than just
  flipped.
- **Not a guarantee of uptime.** Fly can still restart the machine for host
  maintenance, and every deploy restarts it. Fights still end on any restart
  (ADR-001). This removes the *idle* stop, not every stop.
- **Fights now outlive a quiet table.** That is a behaviour change, and mostly
  a good one. It does mean a battle with nobody watching keeps its turn timers
  running: its absent players' seats Brace and then become Echoes the server
  plays (ADR-006, superseding ADR-002's holds, which sent them away), instead
  of the whole fight vanishing at idle stop.
- **Revisit after the showcase.** Once the app is marked and the showcase is
  done, there is no reason to keep paying for an always-warm table. Set it
  back to 0 then.
