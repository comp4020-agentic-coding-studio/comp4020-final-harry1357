// The battle loop: four bars, bass and lead, written for the Orrery. The notes
// are ours and resemble no game's battle theme. Everything here is the score
// plus a sequencer that schedules each sixteenth at an AudioContext time; the
// live scheduler (audio.ts wakes it) and an offline render call the same
// `fill`, so what a test renders is what a player hears.
//
// Key: C minor. Tempo: 144 bpm. One chord a bar:
//
//   | Cm (i) | A♭ (♭VI) | Fm (iv) | G (V) |
//
// The G is the harmonic minor's major V, so the lead's last note, B♮, leans
// back up into the C that opens the loop again. The lead states a motif in
// bar 1 (a leap from C to a held E♭ that falls back by step), answers it
// from the top of the A♭ chord in bar 2, repeats the motif a fourth higher
// over Fm in bar 3 (F to a held A♭), and climbs the dominant in bar 4. The
// bass is root-and-octave eighths with a passing note at the end of each bar
// into the next root, and a quiet tick of noise on the off-beats is the
// Orrery's escapement.
//
// Voices: the lead is a 25% pulse (a narrow square), the bass a sawtooth
// through a lowpass that closes on every note.
import { amp, filter, gate, noise, osc, play, pluck, type Kit } from "./synth.ts";

export const BPM = 144;
/** A sixteenth, in seconds. */
export const STEP = 60 / BPM / 4;
const BAR = 16;
export const STEPS = BAR * 4;
export const LOOP_SECONDS = STEP * STEPS;

interface Note {
  hz: number;
  /** How long, in seconds. */
  length: number;
}

const SEMITONES: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function hz(name: string): number {
  const m = /^([A-G])(b|#)?(\d)$/.exec(name);
  if (!m) throw new Error(`not a note: ${name}`);
  const midi = 12 * (Number(m[3]) + 1) + SEMITONES[m[1]] + (m[2] === "b" ? -1 : m[2] === "#" ? 1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}

/** Bars of notation to a sparse array of notes by step. A bar that doesn't fill sixteen steps is a typo, and throws. */
function phrase(...bars: string[]): (Note | undefined)[] {
  const notes: (Note | undefined)[] = new Array(STEPS);
  bars.forEach((bar, index) => {
    let step = index * BAR;
    for (const token of bar.trim().split(/\s+/)) {
      const [name, count = "1"] = token.split(":");
      const steps = Number(count);
      if (name !== "-") notes[step] = { hz: hz(name), length: steps * STEP };
      step += steps;
    }
    if (step !== (index + 1) * BAR) throw new Error(`bar ${index + 1} is ${step - index * BAR} sixteenths, not ${BAR}`);
  });
  return notes;
}

// One bar per string. A note is its name and octave, then `:steps` in
// sixteenths when it's longer than one; `-` is a sixteenth's rest.
const LEAD = phrase(
  "C5:2 G4 C5 Eb5:3 D5 C5:2 Bb4:2 C5 D5 Eb5:2", // Cm: the motif
  "Ab5:3 G5 Eb5:2 C5:2 Eb5 F5 G5:2 F5:2 Eb5:2", // A♭: the answer, from the top
  "F5:2 C5 F5 Ab5:3 G5 F5:2 Eb5:2 C5:2 Eb5:2", // Fm: the motif a fourth up
  "D5:3 B4 D5:2 F5:2 G5:3 F5 Eb5 D5 B4:2", // G: up the dominant, B♮ leading home
);
const BASS = phrase(
  "C2:2 C3:2 C2:2 G2:2 C2:2 C3:2 Bb2:2 G2:2",
  "Ab2:2 Ab3:2 Ab2:2 Eb3:2 Ab2:2 Ab3:2 G3:2 Eb3:2",
  "F2:2 F3:2 F2:2 C3:2 F2:2 F3:2 Eb3:2 C3:2",
  "G2:2 G3:2 G2:2 D3:2 B2:2 D3:2 F3:2 G3:2",
);

/** What starts on each of the 64 sixteenths. */
const SCORE: { lead?: Note; bass?: Note; tick: boolean }[] = Array.from({ length: STEPS }, (_, step) => ({
  lead: LEAD[step],
  bass: BASS[step],
  tick: step % 4 === 2,
}));

function lead(kit: Kit, out: AudioNode, note: Note, t: number): void {
  const voice = osc(kit, "pulse", note.hz, t);
  const level = amp(kit, out);
  voice.connect(level);
  play(voice, t, gate(level.gain, t, 0.2, 0.12, note.length * 0.82));
}

function bass(kit: Kit, out: AudioNode, note: Note, t: number): void {
  const voice = osc(kit, "sawtooth", note.hz, t);
  const tone = filter(kit, "lowpass", 1600, 2);
  tone.frequency.setValueAtTime(1600, t);
  tone.frequency.exponentialRampToValueAtTime(420, t + note.length);
  const level = amp(kit, out);
  voice.connect(tone).connect(level);
  play(voice, t, gate(level.gain, t, 0.3, 0.22, note.length * 0.78));
}

function tick(kit: Kit, out: AudioNode, t: number): void {
  const hiss = noise(kit);
  const thin = filter(kit, "highpass", 7500);
  const level = amp(kit, out);
  hiss.connect(thin).connect(level);
  play(hiss, t, pluck(level.gain, t, 0.07, 0.001, 0.035));
}

export interface Sequencer {
  /** Schedule every step that starts before `until` (context seconds). A step `now` has already left behind is
   *  skipped, not played late, so a stalled tab doesn't come back with a pile of notes at once. */
  fill(until: number, now: number): void;
}

/** The loop, from its first step at `startAt`, into `out`, for as long as something keeps calling `fill`. */
export function createSequencer(kit: Kit, out: AudioNode, startAt: number): Sequencer {
  let n = 0;
  // computed from the start each time, not accumulated, so the loop never drifts
  const time = (i: number): number => startAt + i * STEP;
  return {
    fill(until, now) {
      if (time(n) < now - STEP / 2) n = Math.ceil((now - startAt) / STEP);
      for (; time(n) < until; n++) {
        const at = time(n);
        const step = SCORE[n % STEPS];
        if (step.lead) lead(kit, out, step.lead, at);
        if (step.bass) bass(kit, out, step.bass, at);
        if (step.tick) tick(kit, out, at);
      }
    },
  };
}
