// The battle's sound: five cues and a four-bar battle loop, all synthesised
// with the Web Audio API (no audio files; engine.ts, cues.ts, music.ts). This
// file decides when anything may sound:
//
// - Nothing before the first gesture. Browsers block autoplay, and the loop
//   starts on the first pointerdown or keydown anywhere on the page, which
//   creates (or resumes) the AudioContext.
// - Muted is total silence, cues included, and muting before that first
//   gesture holds: while muted no context is even created, and muting a
//   running one fades it to zero and then suspends it.
// - A hidden page is suspended, and the loop starts again when it's back.
// - play() is a silent no-op whenever it can't sound (no context yet, muted,
//   hidden, disposed), and never throws: effects call it freely.
import type { Audio, Cue } from "../battle/api.ts";
import { createEngine, type Engine } from "./engine.ts";
import { drawMute, readMuted, writeMuted } from "./mute.ts";

/** How far ahead of the context's clock the loop is scheduled, in seconds. */
const LOOKAHEAD = 0.12;
/** How often the scheduler wakes to top that up. Only a wake-up call: every note's time comes from the AudioContext clock. */
const WAKE_MS = 25;
/** How long after a stop to suspend the context, so the fade finishes instead of clicking. */
const SETTLE_MS = 60;

interface Live {
  ctx: AudioContext;
  engine: Engine;
}

export function createAudio({ muteButton }: { muteButton: HTMLButtonElement }): Audio {
  let muted = readMuted();
  let gestured = false;
  let disposed = false;
  let live: Live | null = null;
  let timer: ReturnType<typeof setInterval> | undefined;
  let settle: ReturnType<typeof setTimeout> | undefined;

  const show = drawMute(muteButton);
  show(muted);

  const audible = (): boolean => gestured && !muted && !disposed && document.visibilityState !== "hidden";

  function wake(): void {
    if (live) live.engine.fill(live.ctx.currentTime + LOOKAHEAD, live.ctx.currentTime);
  }

  function open(): Live | null {
    if (live) return live;
    if (typeof AudioContext === "undefined") return null;
    try {
      const ctx = new AudioContext({ latencyHint: "interactive" });
      live = { ctx, engine: createEngine(ctx) };
    } catch {
      return null;
    }
    return live;
  }

  /** Bring the sound into line with the gesture, the mute and the page's visibility. Idempotent. */
  function sync(): void {
    if (audible()) {
      const now = open();
      if (!now) return;
      clearTimeout(settle);
      if (now.ctx.state !== "running") now.ctx.resume().catch(() => {});
      if (!now.engine.running) {
        now.engine.start(now.ctx.currentTime + 0.05);
        wake();
        timer = setInterval(wake, WAKE_MS);
      }
    } else if (live?.engine.running) {
      const { ctx, engine } = live;
      clearInterval(timer);
      engine.stop(ctx.currentTime);
      settle = setTimeout(() => {
        if (!audible() && ctx.state === "running") ctx.suspend().catch(() => {});
      }, SETTLE_MS);
    }
  }

  function onGesture(event: Event): void {
    // A press on the mute button is left to its click, so muting first never lets a blip of music out.
    if (event.target instanceof Node && muteButton.contains(event.target)) return;
    gestured = true;
    // Until the context is running, every gesture tries again: a first key the browser doesn't count as
    // activation (Escape) leaves it suspended, and the next real one should still start the loop.
    if (!live || live.ctx.state !== "running") sync();
  }

  function onToggle(): void {
    muted = !muted;
    writeMuted(muted);
    show(muted);
    gestured = true;
    sync();
  }

  const listen = { capture: true, passive: true } as const;
  document.addEventListener("pointerdown", onGesture, listen);
  document.addEventListener("keydown", onGesture, listen);
  document.addEventListener("visibilitychange", sync);
  muteButton.addEventListener("click", onToggle);

  return {
    play(cue: Cue): void {
      try {
        if (live && audible() && live.ctx.state === "running") live.engine.cue(cue, live.ctx.currentTime + 0.005);
      } catch {
        // a sound is never worth an exception in the effect that asked for it
      }
    },

    dispose(): void {
      if (disposed) return;
      disposed = true;
      document.removeEventListener("pointerdown", onGesture, listen);
      document.removeEventListener("keydown", onGesture, listen);
      document.removeEventListener("visibilitychange", sync);
      muteButton.removeEventListener("click", onToggle);
      clearInterval(timer);
      clearTimeout(settle);
      if (live) {
        live.engine.dispose();
        live.ctx.close().catch(() => {});
        live = null;
      }
    },
  };
}
