// The conductor: every message from the server comes through here, and here is
// where CLAUDE.md rule 11 is kept. The turn strip is drawn at once, on every
// message, because it is the legibility claim and must never lag. The events
// that came with the message play in order, each through its renderer, and an
// event's log line is written only after its renderer has shown it. The log is
// derivative. While nothing is playing, the field is reconciled to the latest
// state, so whatever an effect left behind ends up exactly where the server
// says.
import type { BattleEvent, BattleState, LogEntry, ServerMessage } from "../../shared/protocol.ts";
import type { AudioApi, EffectContext, Registry, Scene, Strip } from "./api.ts";
import type { LogWindow } from "./log.ts";

/** No effect holds the table up longer than this. */
const CAP_MS = 2_400;
/** Past this many waiting events, play the reduced variants to catch up. */
const BACKLOG = 4;

export interface Conductor {
  receive(msg: ServerMessage): void;
  /** Who this page is, once known. */
  setMe(id: string | null): void;
  /** The socket was replaced: the next message is the whole truth again. */
  resync(): void;
}

export interface ConductorOptions {
  scene: Scene;
  strip: Strip;
  audio: AudioApi;
  log: LogWindow;
  registry: Partial<Registry>;
  /** Every state, as it arrives, for the rest of the page (command window, phase). */
  onState(state: BattleState): void;
}

export function createConductor(opts: ConductorOptions): Conductor {
  const reducedQuery = matchMedia("(prefers-reduced-motion: reduce)");
  const lines = new Map<number, LogEntry>();
  const queue: BattleEvent[] = [];
  let latest: BattleState | null = null;
  let me: string | null = null;
  let fresh = true;
  let playing = false;

  const wait = (ms: number): Promise<void> =>
    new Promise((resolve) => setTimeout(resolve, reducedQuery.matches ? Math.min(ms, 120) : ms));

  function capped(work: Promise<void> | void): Promise<void> {
    return Promise.race([Promise.resolve(work), new Promise<void>((resolve) => setTimeout(resolve, CAP_MS))]);
  }

  async function play(): Promise<void> {
    playing = true;
    while (queue.length > 0) {
      const event = queue.shift() as BattleEvent;
      const renderer = opts.registry[event.kind] as
        | { full: (ctx: EffectContext, e: BattleEvent) => Promise<void> | void; reduced: (ctx: EffectContext, e: BattleEvent) => Promise<void> | void }
        | undefined;
      if (renderer && latest) {
        const reduced = reducedQuery.matches || queue.length >= BACKLOG;
        const ctx: EffectContext = { scene: opts.scene, strip: opts.strip, audio: opts.audio, reduced, wait, state: latest };
        try {
          await capped((reduced ? renderer.reduced : renderer.full)(ctx, event));
        } catch (err) {
          console.error(`the ${event.kind} renderer failed`, err);
        }
      } else if (!renderer) {
        console.error(`no renderer for "${event.kind}": rule 11 says this event shouldn't have shipped`);
      }
      // Shown; now it may be written down.
      if (event.seq !== undefined) {
        const line = lines.get(event.seq);
        if (line) opts.log.append(line);
      }
    }
    playing = false;
    if (latest) opts.scene.reconcile(latest, me);
  }

  return {
    receive(msg) {
      latest = msg.battle;
      for (const line of latest.log) lines.set(line.seq, line);
      opts.strip.render(latest, me);
      opts.onState(latest);
      if (fresh) {
        // A first message (or the first after a reconnect) is the whole truth:
        // the log as it stands, the field as it is. Nothing to replay.
        fresh = false;
        queue.length = 0;
        opts.log.history(latest.log);
        opts.scene.reconcile(latest, me);
        return;
      }
      queue.push(...msg.events);
      if (playing) return;
      if (queue.length > 0) void play();
      else opts.scene.reconcile(latest, me);
    },
    setMe(id) {
      me = id;
      if (latest && !playing) {
        opts.strip.render(latest, me);
        opts.scene.reconcile(latest, me);
      }
    },
    resync() {
      fresh = true;
    },
  };
}
