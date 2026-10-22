// The six cues the battle screen asks for (api.ts, Cue). Each is a few
// oscillators and some filtered noise, made fresh at the moment it's played
// and gone in under a second and a half.
import type { Cue } from "../battle/api.ts";
import { amp, filter, noise, osc, play, pluck, type Kit } from "./synth.ts";

type Voice = (kit: Kit, out: AudioNode, t: number) => void;

/** A bell's partials over its fundamental: [ratio, level, seconds to die]. Inharmonic, the high ones going first. */
const BELL: readonly (readonly [number, number, number])[] = [
  [1, 0.33, 1.5],
  [2, 0.1, 0.9],
  [2.76, 0.15, 0.6],
  [5.4, 0.075, 0.3],
  [8.93, 0.04, 0.15],
];

const CUES: Record<Cue, Voice> = {
  /** A blade lands: a short burst of bright noise with a square blip on top for the glint. */
  strike(kit, out, t) {
    const hiss = noise(kit);
    const bright = filter(kit, "highpass", 2800, 0.8);
    const level = amp(kit, out);
    hiss.connect(bright).connect(level);
    play(hiss, t, pluck(level.gain, t, 1.5, 0.002, 0.11));

    const blip = osc(kit, "square", 1760, t);
    blip.frequency.exponentialRampToValueAtTime(1175, t + 0.06);
    const blipLevel = amp(kit, out);
    blip.connect(blipLevel);
    play(blip, t, pluck(blipLevel.gain, t, 0.4, 0.001, 0.07));
  },

  /** Someone takes damage: a low thud, a sine falling through the floor, a triangle an octave up so a
   *  laptop speaker carries it, and a muffled knock of noise on the front. */
  hit(kit, out, t) {
    for (const [type, from, to, peak] of [
      ["sine", 150, 40, 0.8],
      ["triangle", 300, 80, 0.35],
    ] as const) {
      const body = osc(kit, type, from, t);
      body.frequency.exponentialRampToValueAtTime(to, t + 0.25);
      const level = amp(kit, out);
      body.connect(level);
      play(body, t, pluck(level.gain, t, peak, 0.004, 0.3));
    }
    const knock = noise(kit);
    const muffle = filter(kit, "lowpass", 380, 1);
    const level = amp(kit, out);
    knock.connect(muffle).connect(level);
    play(knock, t, pluck(level.gain, t, 0.45, 0.002, 0.09));
  },

  /** Revolution: the rings spin up. Two saws a hair apart grind against each other as they climb three
   *  octaves, a resonant filter opens behind them, and a square LFO chops the level like a ratchet that
   *  ticks faster as the rings gather speed. */
  revolution(kit, out, t) {
    const length = 1.4;
    const climb = t + length - 0.1;
    const level = amp(kit, out);
    level.gain.setValueAtTime(0, t);
    level.gain.linearRampToValueAtTime(0.18, t + 0.18);
    level.gain.setValueAtTime(0.18, t + length - 0.3);
    level.gain.linearRampToValueAtTime(0, t + length);

    const ratchet = kit.ctx.createGain();
    ratchet.gain.value = 0.6;
    const lfo = osc(kit, "square", 8, t);
    lfo.frequency.exponentialRampToValueAtTime(34, t + length);
    const depth = kit.ctx.createGain();
    depth.gain.value = 0.4;
    lfo.connect(depth).connect(ratchet.gain);
    play(lfo, t, t + length);

    const sweep = filter(kit, "lowpass", 350, 7);
    sweep.frequency.setValueAtTime(350, t);
    sweep.frequency.exponentialRampToValueAtTime(4200, climb);
    sweep.connect(ratchet).connect(level);
    for (const spread of [1, 1.013]) {
      const saw = osc(kit, "sawtooth", 65 * spread, t);
      saw.frequency.exponentialRampToValueAtTime(520 * spread, climb);
      saw.connect(sweep);
      play(saw, t, t + length);
    }
  },

  /** Someone reaches the strike plate: a clear ding, a struck bell on C6 (the loop's tonic, so it sits in key). */
  plate(kit, out, t) {
    const fundamental = 1046.5;
    for (const [ratio, peak, decay] of BELL) {
      const partial = osc(kit, "sine", fundamental * ratio, t);
      const level = amp(kit, out);
      partial.connect(level);
      play(partial, t, pluck(level.gain, t, peak, 0.002, decay));
    }
  },

  /** A phase line crossed (ADR-010): the rings lock into a new figure. Three struck bells falling a fifth
   *  then a fourth, C5, F4, C4, each the plate's bell an octave or more down, over a low noise
   *  knock as the gears catch. Heavier than the plate's ding, so the two are never mistaken. */
  phase(kit, out, t) {
    const knock = noise(kit);
    const thump = filter(kit, "lowpass", 220, 1.2);
    const knockLevel = amp(kit, out);
    knock.connect(thump).connect(knockLevel);
    play(knock, t, pluck(knockLevel.gain, t, 0.6, 0.003, 0.18));
    for (const [hz, at] of [
      [523.25, 0],
      [349.23, 0.22],
      [261.63, 0.44],
    ] as const) {
      for (const [ratio, peak, decay] of BELL) {
        const partial = osc(kit, "sine", hz * ratio, t + at);
        const level = amp(kit, out);
        partial.connect(level);
        play(partial, t + at, pluck(level.gain, t + at, peak * 0.9, 0.002, decay * 1.1));
      }
    }
  },

  /** Your turn is running out: two square notes falling a tritone, C6 to F♯5, left unresolved so it nags. */
  hold(kit, out, t) {
    const soften = filter(kit, "lowpass", 3200);
    soften.connect(out);
    for (const [hz, at, length] of [
      [1046.5, 0, 0.12],
      [740, 0.16, 0.2],
    ] as const) {
      const start = t + at;
      const note = osc(kit, "square", hz, start);
      const level = amp(kit, soften);
      note.connect(level);
      level.gain.setValueAtTime(0, start);
      level.gain.linearRampToValueAtTime(0.15, start + 0.004);
      level.gain.setValueAtTime(0.15, start + length);
      level.gain.linearRampToValueAtTime(0, start + length + 0.02);
      play(note, start, start + length + 0.02);
    }
  },
};

export const CUE_NAMES = Object.keys(CUES) as Cue[];

export function isCue(value: unknown): value is Cue {
  return typeof value === "string" && Object.hasOwn(CUES, value);
}

export function playCue(kit: Kit, out: AudioNode, cue: Cue, t: number): void {
  CUES[cue](kit, out, t);
}
