/** Layered, crossfading city ambience: hum, distant traffic, wind, sea, crickets and scheduled bird calls. */
import { type Kit, bq, gain, osc } from './dsp';
import { clamp, safe } from './theory';

/** `crowd` 0..1 = people murmuring around you (shops, bars); `altitude` 0..1 = high up (rooftop, helicopter): more wind. */
export interface AmbienceState { night: number; water: number; traffic: number; park: number; indoors?: number; crowd?: number; altitude?: number }

export interface AmbienceLevels { hum: number; traffic: number; wind: number; waves: number; crickets: number; birds: number; indoorsCut: number; crowd: number; city: number }

/** Pure mapping from game state to layer levels (unit-tested). */
export function ambienceLevels(a: AmbienceState): AmbienceLevels {
  const night = safe(a.night, 0, 1, 0), water = safe(a.water, 0, 1, 0), traffic = safe(a.traffic, 0, 1, 0.5), park = safe(a.park, 0, 1, 0), indoors = safe(a.indoors ?? 0, 0, 1, 0);
  const crowd = safe(a.crowd ?? 0, 0, 1, 0), alt = safe(a.altitude ?? 0, 0, 1, 0);
  const day = 1 - night; const out = 1 - indoors * 0.5;
  return {
    hum: (0.1 + 0.12 * traffic) * (1 - 0.35 * night) * (1 - 0.5 * park) * out,
    traffic: (0.04 + 0.32 * traffic) * (1 - 0.4 * night) * (1 - 0.4 * park) * out,
    wind: (0.07 + 0.06 * night + 0.07 * water + 0.3 * alt) * out,
    crowd: crowd * 0.5,
    // far-off horns and sirens: only where there is traffic, not in parks or high up
    city: Math.max(0, traffic - 0.15) * (1 - 0.6 * park) * (1 - 0.5 * alt) * out,
    waves: 0.32 * water * out,
    crickets: night * (0.2 + 0.8 * park) * (1 - 0.5 * traffic) * out,
    birds: day * (0.12 + 0.88 * park) * (1 - 0.4 * traffic) * out,
    indoorsCut: 18000 * Math.pow(500 / 18000, indoors),
  };
}

export class Ambience {
  private g: Record<'hum' | 'traffic' | 'wind' | 'waves' | 'crickets' | 'birds' | 'crowd' | 'city', GainNode>;
  private cut: BiquadFilterNode;
  private sources: AudioScheduledSourceNode[] = [];
  private birdLevel = 0; private nextBird = 0; private cityLevel = 0; private nextCity = 0; private windHi: BiquadFilterNode | null = null;
  constructor(private k: Kit, out: AudioNode, private later: (at: number, fn: () => void) => void) {
    const ctx = k.ctx; const now = ctx.currentTime;
    this.cut = bq(ctx, 'lowpass', 18000, 0.5); this.cut.connect(out);
    const mk = () => { const g = gain(ctx, 0); g.connect(this.cut); return g; };
    this.g = { hum: mk(), traffic: mk(), wind: mk(), waves: mk(), crickets: mk(), birds: mk(), crowd: mk(), city: mk() };
    const loop = (b: AudioBuffer, rate = 1) => { const s = ctx.createBufferSource(); s.buffer = b; s.loop = true; s.playbackRate.value = rate; s.start(now, k.rand() * b.duration); this.sources.push(s); return s; };
    const lfo = (f: number, depth: number, target: AudioParam, type: OscillatorType = 'sine') => { const o = osc(ctx, type, f, now, 1e7); const d = gain(ctx, depth); o.connect(d); d.connect(target); this.sources.push(o); return o; };

    // city hum: deep brown rumble
    { const s = loop(k.brown, 0.7); const lp = bq(ctx, 'lowpass', 150); s.connect(lp); lp.connect(this.g.hum); }
    // distant traffic: pink noise band with slow swells (cars passing far away)
    { const s = loop(k.pink, 0.9); const bp = bq(ctx, 'bandpass', 520, 0.6); const am = gain(ctx, 0.6); lfo(0.07, 0.25, am.gain); lfo(0.19, 0.12, am.gain); lfo(0.05, 140, bp.frequency); s.connect(bp); bp.connect(am); am.connect(this.g.traffic); }
    // wind: band-passed pink noise with wandering centre and gusts
    { const s = loop(k.pink, 1.1); const bp = bq(ctx, 'bandpass', 600, 0.9); lfo(0.043, 260, bp.frequency); const am = gain(ctx, 0.55); lfo(0.11, 0.3, am.gain); lfo(0.031, 0.15, am.gain); s.connect(bp); bp.connect(am); am.connect(this.g.wind); }
    // crowd murmur: pink noise through vowel formants, chopped at a syllable rate (8 Hz) by two slow, unsynchronised LFOs
    for (const [r, f1, f2, pan] of [[0.8, 520, 1500, -0.35], [1.1, 700, 1150, 0.4]] as const) {
      const s = loop(k.pink, r); const b1 = bq(ctx, 'bandpass', f1, 2.2), b2 = bq(ctx, 'bandpass', f2, 2.8); const am = gain(ctx, 0.5); lfo(3 + r * 4, 0.35, am.gain); lfo(0.4 + r * 0.3, 0.15, am.gain);
      const mix = gain(ctx, 1.4); const p = ctx.createStereoPanner(); p.pan.value = pan; s.connect(b1); s.connect(b2); b1.connect(am); b2.connect(am); am.connect(mix); mix.connect(p); p.connect(this.g.crowd);
    }
    // gusts at height: a thin, wandering whistle on top of the wind (only audible when altitude lifts the wind level)
    { const s = loop(k.white, 1); const hp = bq(ctx, 'bandpass', 1700, 1.6); lfo(0.09, 600, hp.frequency); const am = gain(ctx, 0.16); lfo(0.13, 0.12, am.gain); s.connect(hp); hp.connect(am); am.connect(this.g.wind); this.windHi = hp; }
    // sea: low wash swelling every ~9 s plus a fizzy top
    {
      const am = gain(ctx, 0.5); lfo(0.11, 0.42, am.gain); lfo(0.043, 0.1, am.gain);
      const lo = loop(k.brown, 1); const lp = bq(ctx, 'lowpass', 520); lfo(0.11, 180, lp.frequency); lo.connect(lp); lp.connect(am);
      const hi = loop(k.white, 1); const hp = bq(ctx, 'highpass', 2600); const hg = gain(ctx, 0.08); hi.connect(hp); hp.connect(hg); hg.connect(am);
      am.connect(this.g.waves);
    }
    // crickets: two chirping insects, gated sine carriers
    for (const [f, rate, gate, pan] of [[4300, 29, 1.45, -0.5], [4720, 33, 1.17, 0.45]] as const) {
      const c = osc(ctx, 'sine', f, now, 1e7); this.sources.push(c);
      const am1 = gain(ctx, 0.5); lfo(rate, 0.5, am1.gain, 'square');
      const am2 = gain(ctx, 0.5); lfo(gate, 0.5, am2.gain, 'square');
      const p = ctx.createStereoPanner(); p.pan.value = pan; const lvl = gain(ctx, 0.035);
      c.connect(am1); am1.connect(am2); am2.connect(lvl); lvl.connect(p); p.connect(this.g.crickets);
    }
  }

  set(a: AmbienceState, tc = 1.2): void {
    const L = ambienceLevels(a); const now = this.k.ctx.currentTime;
    this.g.hum.gain.setTargetAtTime(L.hum, now, tc); this.g.traffic.gain.setTargetAtTime(L.traffic, now, tc);
    this.g.wind.gain.setTargetAtTime(L.wind, now, tc); this.g.waves.gain.setTargetAtTime(L.waves, now, tc);
    this.g.crickets.gain.setTargetAtTime(L.crickets, now, tc); this.g.birds.gain.setTargetAtTime(1, now, tc);
    this.g.crowd.gain.setTargetAtTime(L.crowd, now, tc); this.g.city.gain.setTargetAtTime(1, now, tc);
    this.cut.frequency.setTargetAtTime(L.indoorsCut, now, 0.3);
    this.birdLevel = L.birds; this.cityLevel = L.city;
  }

  /** Schedules bird calls and far-off city noises ahead of time. */
  tick(now: number, ahead: number): void {
    this.tickCity(now, ahead);
    if (this.birdLevel < 0.03) { this.nextBird = Math.max(this.nextBird, now); return; }
    if (this.nextBird < now) this.nextBird = now + 0.2 + this.k.rand() * 1.5;
    let n = 0;
    while (this.nextBird < now + ahead && n++ < 4) {
      this.call(this.nextBird, this.birdLevel);
      this.nextBird += (0.6 + this.k.rand() * 2.8) / clamp(this.birdLevel * 1.4, 0.15, 1);
    }
  }

  /** A distant honk (two-tone, muffled) or a siren wailing several blocks away, at random intervals while there is traffic. */
  private tickCity(now: number, ahead: number): void {
    if (this.cityLevel < 0.05) { this.nextCity = Math.max(this.nextCity, now + 3); return; }
    if (this.nextCity < now) this.nextCity = now + 2 + this.k.rand() * 6;
    if (this.nextCity >= now + ahead) return;
    const t = this.nextCity; this.nextCity = t + (7 + this.k.rand() * 14) / clamp(this.cityLevel * 1.6, 0.2, 1);
    const k = this.k, ctx = k.ctx; const lp = bq(ctx, 'lowpass', 900 + k.rand() * 500, 0.6); const p = ctx.createStereoPanner(); p.pan.value = k.rand() * 1.6 - 0.8;
    const lvl = gain(ctx, 0); lp.connect(lvl); lvl.connect(p); p.connect(this.g.city);
    let end: number;
    if (k.rand() < 0.65) { // horn: one or two short blasts
      const base = 330 + k.rand() * 120; const blasts = k.rand() < 0.4 ? 2 : 1; let at = t;
      for (let b = 0; b < blasts; b++) { const dur = 0.18 + k.rand() * 0.35; for (const f of [base, base * 1.26]) { const o = osc(ctx, 'sawtooth', f, at, dur + 0.05); o.connect(lp); }
        lvl.gain.setValueAtTime(0, at); lvl.gain.linearRampToValueAtTime(0.05 * this.cityLevel, at + 0.02); lvl.gain.setValueAtTime(0.05 * this.cityLevel, at + dur); lvl.gain.linearRampToValueAtTime(0, at + dur + 0.04); at += dur + 0.14; }
      end = at + 0.1;
    } else { // siren: a slow wail swelling in and out as the vehicle passes a few blocks away
      const dur = 4 + k.rand() * 4; const o = osc(ctx, 'triangle', 800, t, dur + 0.1);
      for (let s = 0; s < dur; s += 1.2) { o.frequency.setValueAtTime(700, t + s); o.frequency.linearRampToValueAtTime(1050, t + s + 0.6); o.frequency.linearRampToValueAtTime(700, t + s + 1.2); }
      o.connect(lp); lvl.gain.setValueAtTime(0, t); lvl.gain.linearRampToValueAtTime(0.045 * this.cityLevel, t + dur * 0.45); lvl.gain.linearRampToValueAtTime(0, t + dur);
      end = t + dur + 0.1;
    }
    this.later(end + 0.2, () => { lp.disconnect(); lvl.disconnect(); p.disconnect(); });
  }

  private call(t: number, level: number): void {
    const k = this.k, ctx = k.ctx; const p = ctx.createStereoPanner(); p.pan.value = k.rand() * 1.6 - 0.8;
    const lvl = gain(ctx, (0.035 + 0.045 * k.rand()) * clamp(level, 0, 1)); lvl.connect(p); p.connect(this.g.birds);
    const notes = 2 + Math.floor(k.rand() * 5); const base = 2400 + k.rand() * 2200; const kind = Math.floor(k.rand() * 3);
    let at = t;
    for (let i = 0; i < notes; i++) {
      const d = 0.04 + k.rand() * 0.07; const f0 = base * (1 + (k.rand() - 0.5) * 0.25);
      const o = osc(ctx, 'sine', f0, at, d + 0.02);
      const f1 = kind === 0 ? f0 * 1.35 : kind === 1 ? f0 * 0.72 : f0 * (i % 2 ? 1.2 : 0.85);
      o.frequency.setValueAtTime(f0, at); o.frequency.exponentialRampToValueAtTime(f1, at + d);
      const g = gain(ctx, 0); g.gain.setValueAtTime(0, at); g.gain.linearRampToValueAtTime(1, at + d * 0.25); g.gain.linearRampToValueAtTime(0, at + d);
      o.connect(g); g.connect(lvl); at += d + 0.02 + k.rand() * 0.06;
    }
    const end = at + 0.1;
    this.later(end, () => { lvl.disconnect(); p.disconnect(); });
  }

  stop(): void { const now = this.k.ctx.currentTime; for (const s of this.sources) { try { s.stop(now + 0.1); } catch { /* ignore */ } } }
}
