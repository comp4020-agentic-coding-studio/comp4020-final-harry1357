// The few primitives every sound here is built from. Nothing is a file: each
// cue and every note of the loop is oscillators, filtered noise and gain
// envelopes, scheduled on an AudioContext's clock. They take a
// BaseAudioContext, so a live context and an OfflineAudioContext run exactly
// the same code.

/** What every voice needs from its context, made once per context. */
export interface Kit {
  ctx: BaseAudioContext;
  /** A second of white noise, looped wherever a voice needs hiss. */
  noise: AudioBuffer;
  /** The lead's voice: a 25% pulse, the square wave's thinner sibling. */
  pulse: PeriodicWave;
}

/** The quietest an exponential ramp aims for before the level is set to zero outright. */
const FLOOR = 0.0001;

export function makeKit(ctx: BaseAudioContext): Kit {
  return { ctx, noise: noiseBuffer(ctx), pulse: pulseWave(ctx, 0.25) };
}

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // xorshift32 with a fixed seed, so an offline render is the same every time
  let seed = 0x2545f491;
  for (let i = 0; i < data.length; i++) {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    data[i] = ((seed >>> 0) / 0xffffffff) * 2 - 1;
  }
  return buffer;
}

/** A pulse wave of the given duty cycle, from its Fourier series. */
function pulseWave(ctx: BaseAudioContext, duty: number): PeriodicWave {
  const harmonics = 48;
  const real = new Float32Array(harmonics);
  const imag = new Float32Array(harmonics);
  for (let k = 1; k < harmonics; k++) {
    real[k] = Math.sin(2 * Math.PI * k * duty) / (k * Math.PI);
    imag[k] = (1 - Math.cos(2 * Math.PI * k * duty)) / (k * Math.PI);
  }
  return ctx.createPeriodicWave(real, imag);
}

export function osc(kit: Kit, type: OscillatorType | "pulse", hz: number, t: number): OscillatorNode {
  const node = kit.ctx.createOscillator();
  if (type === "pulse") node.setPeriodicWave(kit.pulse);
  else node.type = type;
  node.frequency.setValueAtTime(hz, t);
  return node;
}

export function noise(kit: Kit): AudioBufferSourceNode {
  const node = kit.ctx.createBufferSource();
  node.buffer = kit.noise;
  node.loop = true;
  return node;
}

export function filter(kit: Kit, type: BiquadFilterType, hz: number, q = 0.7): BiquadFilterNode {
  const node = kit.ctx.createBiquadFilter();
  node.type = type;
  node.frequency.value = hz;
  node.Q.value = q;
  return node;
}

/** A gain stage that starts silent and feeds `out`. */
export function amp(kit: Kit, out: AudioNode): GainNode {
  const node = kit.ctx.createGain();
  node.gain.value = 0;
  node.connect(out);
  return node;
}

/** Start a source at `t` and stop it just after `end`. */
export function play(source: AudioScheduledSourceNode, t: number, end: number): void {
  if (source instanceof AudioBufferSourceNode) {
    // a different stretch of the noise each time, chosen by the clock so a render repeats
    source.start(t, (t * 7.31) % 0.9);
  } else {
    source.start(t);
  }
  source.stop(end + 0.02);
}

/** Struck: up to `peak` in `attack`, then an exponential fall to silence. Exactly zero after; returns when. */
export function pluck(param: AudioParam, t: number, peak: number, attack: number, decay: number): number {
  const end = t + attack + decay;
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.exponentialRampToValueAtTime(FLOOR, end);
  param.setValueAtTime(0, end);
  return end;
}

/** Held: a quick rise to `peak`, a short fall to `sustain`, held for `hold`, then released. Returns when it's silent. */
export function gate(param: AudioParam, t: number, peak: number, sustain: number, hold: number): number {
  const end = t + hold + 0.025;
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + 0.004);
  param.exponentialRampToValueAtTime(sustain, t + Math.min(0.07, hold * 0.6));
  param.setValueAtTime(sustain, t + hold);
  param.linearRampToValueAtTime(0, end);
  return end;
}
