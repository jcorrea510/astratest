/** Shared low-level Web Audio building blocks. Everything takes a BaseAudioContext so it renders offline too. */

export type SampleName = 'engine' | 'engineBike' | 'impact' | 'skid';

/** Per-context shared resources: noise buffers, impulse responses, shaper curves and decoded samples. */
export interface Kit {
  ctx: BaseAudioContext;
  white: AudioBuffer;
  pink: AudioBuffer;
  brown: AudioBuffer;
  crackle: AudioBuffer;
  soft: Float32Array<ArrayBuffer>;
  hard: Float32Array<ArrayBuffer>;
  samples: Partial<Record<SampleName, AudioBuffer>>;
  rand: () => number;
}

export function makeKit(ctx: BaseAudioContext, rand: () => number = Math.random): Kit {
  return {
    ctx,
    white: noiseBuffer(ctx, 2, 'white', rand),
    pink: noiseBuffer(ctx, 3, 'pink', rand),
    brown: noiseBuffer(ctx, 3, 'brown', rand),
    crackle: crackleBuffer(ctx, 4, rand),
    soft: shaperCurve(2.2),
    hard: shaperCurve(7),
    samples: {},
    rand,
  };
}

export function noiseBuffer(ctx: BaseAudioContext, seconds: number, color: 'white' | 'pink' | 'brown', rand: () => number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
  for (let i = 0; i < len; i++) {
    const w = rand() * 2 - 1;
    if (color === 'white') d[i] = w * 0.9;
    else if (color === 'pink') {
      // Paul Kellet's refined pink filter
      b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
      d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11; b6 = w * 0.115926;
    } else { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.2; }
  }
  // crossfade the loop seam so looping noise never clicks
  const fade = Math.min(2048, len >> 4);
  for (let i = 0; i < fade; i++) { const a = i / fade; d[len - fade + i] = d[len - fade + i] * (1 - a) + d[i] * a; }
  return buf;
}

/** Vinyl crackle: sparse random clicks over a faint hiss. */
function crackleBuffer(ctx: BaseAudioContext, seconds: number, rand: () => number): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * 0.012;
  const clicks = Math.floor(seconds * 22);
  for (let c = 0; c < clicks; c++) {
    const at = Math.floor(rand() * (len - 200)); const amp = (0.15 + rand() * 0.6) * (rand() < 0.5 ? -1 : 1); const w = 4 + Math.floor(rand() * 30);
    for (let i = 0; i < w; i++) d[at + i] += amp * Math.exp(-i / (w * 0.3)) * (i % 2 ? -0.5 : 1);
  }
  return buf;
}

/** Copy of `b` whose tail is crossfaded into its head so it loops without a click. */
export function makeLoopable(ctx: BaseAudioContext, b: AudioBuffer, fadeSec = 0.08): AudioBuffer {
  const fade = Math.min(Math.floor(fadeSec * b.sampleRate), Math.floor(b.length / 4));
  if (fade < 16) return b;
  const len = b.length - fade; const out = ctx.createBuffer(b.numberOfChannels, len, b.sampleRate);
  for (let c = 0; c < b.numberOfChannels; c++) {
    const src = b.getChannelData(c); const dst = out.getChannelData(c);
    dst.set(src.subarray(0, len));
    for (let i = 0; i < fade; i++) { const a = i / fade; const w1 = Math.sin(a * Math.PI / 2), w0 = Math.cos(a * Math.PI / 2); dst[i] = src[i] * w1 + src[len + i] * w0; }
  }
  return out;
}

/** Store a decoded sample in the kit (looped samples get a seamless loop point). */
export function registerSample(k: Kit, name: SampleName, b: AudioBuffer): void {
  k.samples[name] = name === 'impact' ? b : makeLoopable(k.ctx, b);
}

/** Normalised tanh shaper curve. */
export function shaperCurve(drive: number, n = 2048): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n); const norm = Math.tanh(drive);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(drive * x) / norm; }
  return c;
}

/**
 * Transparent below `knee`, smooth tanh knee up to `ceiling` (never exceeded). The shaper maps input [-1, 1] → curve,
 * so a pre-gain of 1/`range` lets inputs up to ±`range` be shaped smoothly.
 */
export function ceilingCurve(knee = 0.72, ceiling = 0.95, range = 4, n = 8192): Float32Array<ArrayBuffer> {
  const c = new Float32Array(n); const span = ceiling - knee;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * range; const a = Math.abs(x);
    const y = a <= knee ? a : knee + span * Math.tanh((a - knee) / span);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

/**
 * Generated stereo impulse response: decaying, progressively darker noise plus optional discrete reflections
 * (slapback off buildings).
 */
export function impulseResponse(ctx: BaseAudioContext, seconds: number, decay: number, reflections: [number, number][], rand: () => number, damp = 0.5): AudioBuffer {
  const sr = ctx.sampleRate; const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch); let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / sr; const env = Math.pow(1 - t / seconds, decay) * Math.exp(-t * 3);
      const k = 0.92 - damp * 0.8 * (t / seconds); // one-pole low-pass that closes over time
      lp = lp * (1 - k) + (rand() * 2 - 1) * k;
      d[i] = lp * env * 0.6;
    }
    for (const [time, g] of reflections) {
      const at = Math.floor((time + (ch ? 0.007 : 0) + rand() * 0.004) * sr);
      for (let j = 0; j < 220 && at + j < len; j++) d[at + j] += (rand() * 2 - 1) * g * Math.exp(-j / 60);
    }
  }
  return buf;
}

// ---------- tiny node helpers (all scheduled, all self-stopping) ----------

export function gain(ctx: BaseAudioContext, v = 1): GainNode { const g = ctx.createGain(); g.gain.value = v; return g; }

export function bq(ctx: BaseAudioContext, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q; return f;
}

export function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}

export function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, t: number, dur: number): OscillatorNode {
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t); o.start(t); o.stop(t + dur); return o;
}

export function noise(k: Kit, t: number, dur: number, color: 'white' | 'pink' | 'brown' = 'white', rate = 1): AudioBufferSourceNode {
  const s = k.ctx.createBufferSource(); const b = k[color]; s.buffer = b; s.loop = true; s.playbackRate.value = rate;
  s.start(t, k.rand() * b.duration * 0.9); s.stop(t + dur); return s;
}

export function sample(k: Kit, name: SampleName, t: number, rate = 1, offset = 0, dur?: number): AudioBufferSourceNode | null {
  const b = k.samples[name]; if (!b) return null;
  const s = k.ctx.createBufferSource(); s.buffer = b; s.playbackRate.value = rate;
  const off = Math.min(Math.max(0, offset), Math.max(0, b.duration - 0.01));
  s.start(t, off); s.stop(t + (dur ?? (b.duration - off) / rate) + 0.01); return s;
}

/** Percussive envelope: linear attack to `peak`, exponential-ish decay to silence within `dec` seconds. Returns end time. */
export function perc(p: AudioParam, t: number, a: number, peak: number, dec: number): number {
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + Math.max(0.0005, a));
  p.setTargetAtTime(0, t + a, Math.max(0.001, dec / 5));
  p.setValueAtTime(0, t + a + dec);
  return t + a + dec;
}

/** Attack / hold / release envelope. Returns end time. */
export function ahr(p: AudioParam, t: number, a: number, peak: number, hold: number, rel: number): number {
  p.setValueAtTime(0, t); p.linearRampToValueAtTime(peak, t + Math.max(0.0005, a));
  p.setValueAtTime(peak, t + a + hold); p.setTargetAtTime(0, t + a + hold, Math.max(0.001, rel / 5));
  p.setValueAtTime(0, t + a + hold + rel);
  return t + a + hold + rel;
}

/** Exponential glide of a frequency param (guards against non-positive values). */
export function glide(p: AudioParam, t: number, from: number, to: number, dur: number): void {
  p.setValueAtTime(Math.max(1, from), t); p.exponentialRampToValueAtTime(Math.max(1, to), t + Math.max(0.001, dur));
}

/** Disconnect a node graph once the final source ends (sources stopped earlier just end silently). */
export function onEnd(src: AudioScheduledSourceNode, fn: () => void): void {
  src.addEventListener('ended', fn, { once: true });
}
