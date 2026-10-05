// Everything that makes sound, on any BaseAudioContext: the live one in the
// page, or an OfflineAudioContext in a test, with no difference in the code.
// audio.ts decides *when* it may sound (after a gesture, unmuted, visible);
// this decides *what* sounds and how loud.
//
// The mix: music and cues each have a bus, both feed a master, and the master
// feeds a limiter on the way out. The levels are modest, with the music well
// under the cues, and the limiter only catches a pile-up of cues. Every
// `start` builds a fresh master; `stop` fades that one to exactly zero and
// never reuses it, so nothing scheduled before a mute (a note already queued
// a beat ahead, a bell still ringing) can come back when the sound does.
import type { Cue } from "../battle/api.ts";
import { isCue, playCue } from "./cues.ts";
import { createSequencer, type Sequencer } from "./music.ts";
import { makeKit } from "./synth.ts";

/** The whole mix's level, before the limiter. */
const MASTER = 0.5;
/** The music, relative to the cues. */
const MUSIC = 0.35;
const CUES = 1;
/** Seconds a stop takes to reach silence: long enough not to click, short enough to be immediate. */
const FADE = 0.015;

export interface Engine {
  /** Started and not stopped. */
  readonly running: boolean;
  /** Start sounding: a fresh master, and the loop from its first step at `at`. */
  start(at: number): void;
  /** Total silence from `at` (after a fade of a few milliseconds). Cues and `fill` do nothing until the next start. */
  stop(at: number): void;
  /** Schedule the loop up to `until`. The live scheduler calls this on every wake; an offline render calls it once. */
  fill(until: number, now: number): void;
  /** Play a cue at `at`. Nothing while stopped, and nothing for a name that isn't a cue. */
  cue(cue: Cue, at: number): void;
  dispose(): void;
}

interface Live {
  master: GainNode;
  music: GainNode;
  cues: GainNode;
  loop: Sequencer;
}

export function createEngine(ctx: BaseAudioContext, out: AudioNode = ctx.destination): Engine {
  const kit = makeKit(ctx);
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -10;
  limiter.knee.value = 6;
  limiter.ratio.value = 8;
  limiter.attack.value = 0.003;
  limiter.release.value = 0.2;
  limiter.connect(out);

  let live: Live | null = null;
  /** Masters that have been stopped; disconnected at the next start, long after their fade. */
  let spent: GainNode[] = [];

  function retire(): void {
    for (const master of spent) master.disconnect();
    spent = [];
  }

  function stop(at: number): void {
    if (!live) return;
    const level = live.master.gain;
    level.cancelScheduledValues(at);
    level.setValueAtTime(MASTER, at);
    level.linearRampToValueAtTime(0, at + FADE);
    spent.push(live.master);
    live = null;
  }

  return {
    get running() {
      return live !== null;
    },

    start(at) {
      if (live) return;
      retire();
      const master = ctx.createGain();
      master.gain.value = MASTER;
      master.connect(limiter);
      const music = ctx.createGain();
      music.gain.value = MUSIC;
      music.connect(master);
      const cues = ctx.createGain();
      cues.gain.value = CUES;
      cues.connect(master);
      live = { master, music, cues, loop: createSequencer(kit, music, at) };
    },

    stop,

    fill(until, now) {
      live?.loop.fill(until, now);
    },

    cue(cue, at) {
      if (live && isCue(cue)) playCue(kit, live.cues, cue, at);
    },

    dispose() {
      stop(ctx.currentTime);
      retire();
      limiter.disconnect();
    },
  };
}
