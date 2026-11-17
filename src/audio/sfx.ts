/**
 * Synthesised one-shot sound effects. Each recipe renders into `out` starting at time `t` and returns its end time.
 * Recipes only use scheduled, self-stopping sources, so they work identically in an OfflineAudioContext.
 */
import type { SfxName } from '../ui/contracts';
import { type Kit, bq, gain, noise, osc, perc, ahr, glide, sample } from './dsp';

export interface SfxArgs { kit: Kit; out: AudioNode; t: number; /** pitch multiplier */ p: number }
type Recipe = (a: SfxArgs) => number;

export type SfxCategory = 'world' | 'ui';
export interface SfxMeta {
  cat: SfxCategory; // 'ui' = 2D, bypasses slow-mo and pause muffle
  priority: number; // voice stealing priority (higher survives)
  perKey: number; // max simultaneous voices of this sound
  minInterval: number; // seconds; same sound restarted faster than this is dropped
  echo: number; // base echo/reverb send
  gain: number; // trim
  jitter: number; // random pitch spread (fraction)
}
const W = (priority: number, perKey: number, minInterval: number, echo: number, g = 1, jitter = 0.04): SfxMeta => ({ cat: 'world', priority, perKey, minInterval, echo, gain: g, jitter });
const U = (g = 1, perKey = 2, minInterval = 0.03): SfxMeta => ({ cat: 'ui', priority: 9, perKey, minInterval, echo: 0, gain: g, jitter: 0 });

export const SFX_META: Record<SfxName, SfxMeta> = {
  pistol: W(6, 5, 0.03, 0.3, 1, 0.05), smg: W(6, 6, 0.025, 0.25, 0.85, 0.06), shotgun: W(7, 3, 0.08, 0.35, 1, 0.04), rifle: W(6, 5, 0.03, 0.35, 1, 0.05),
  punch: W(3, 2, 0.05, 0.05, 0.7), punchHit: W(5, 3, 0.04, 0.1, 0.9), hitBody: W(4, 3, 0.03, 0.05, 0.8), hitMetal: W(4, 4, 0.03, 0.15, 0.7),
  hitConcrete: W(3, 4, 0.025, 0.12, 0.6), ricochet: W(3, 3, 0.05, 0.2, 0.5), reload: W(5, 1, 0.2, 0.05, 0.7), empty: W(4, 1, 0.08, 0.02, 0.7),
  equip: W(4, 1, 0.08, 0.03, 0.6), pickup: W(7, 2, 0.05, 0.05, 0.6, 0), money: W(7, 2, 0.05, 0.05, 0.55, 0), footstep: W(1, 4, 0.06, 0.02, 0.5, 0.08),
  jump: W(2, 1, 0.1, 0.03, 0.5), land: W(2, 2, 0.08, 0.05, 0.7), doorOpen: W(4, 2, 0.08, 0.05, 0.7), doorClose: W(4, 2, 0.08, 0.08, 0.8),
  horn: W(5, 2, 0.15, 0.25, 0.6, 0.01), glass: W(5, 3, 0.05, 0.2, 0.7), crash: W(8, 3, 0.08, 0.3, 1), explosion: W(9, 3, 0.1, 0.6, 1, 0.06), splash: W(4, 2, 0.06, 0.1, 0.7),
  uiClick: U(0.5), uiHover: U(0.35, 2, 0.04), uiBack: U(0.5), missionStart: U(0.7, 1, 0.3), missionPass: U(0.7, 1, 0.3), missionFail: U(0.7, 1, 0.3),
  down: U(0.8, 1, 0.5), checkpoint: U(0.55, 2, 0.08), wheelOpen: U(0.45, 1, 0.08), wheelClose: U(0.45, 1, 0.08), heatUp: U(0.55, 1, 0.2), heatLost: U(0.55, 1, 0.3),
  purchase: U(0.6, 1, 0.1), whoosh: W(3, 3, 0.05, 0.05, 0.6), tireScreech: W(4, 2, 0.1, 0.1, 0.55, 0.05), engineStart: W(6, 2, 0.3, 0.05, 0.8, 0.02),
  shellCasing: W(1, 4, 0.03, 0.03, 0.35, 0.12),
};

// ---------- building blocks ----------
interface BurstOpts { type: BiquadFilterType; f: number; f2?: number; glideDur?: number; q?: number; a?: number; peak: number; dec: number; color?: 'white' | 'pink' | 'brown'; shape?: Float32Array<ArrayBuffer> }
function burst(k: Kit, out: AudioNode, t: number, o: BurstOpts): number {
  const ctx = k.ctx; const end = t + (o.a ?? 0.001) + o.dec;
  const n = noise(k, t, end - t + 0.02, o.color ?? 'white');
  const f = bq(ctx, o.type, o.f, o.q ?? 0.707);
  if (o.f2 !== undefined) glide(f.frequency, t, o.f, o.f2, o.glideDur ?? o.dec);
  const g = gain(ctx, 0); perc(g.gain, t, o.a ?? 0.001, o.peak, o.dec);
  n.connect(f);
  if (o.shape) { const ws = ctx.createWaveShaper(); ws.curve = o.shape; f.connect(ws); ws.connect(g); } else f.connect(g);
  g.connect(out); return end;
}
interface ToneOpts { type?: OscillatorType; f: number; f2?: number; glideDur?: number; a?: number; peak: number; dec: number; detune?: number }
function tone(k: Kit, out: AudioNode, t: number, o: ToneOpts): number {
  const ctx = k.ctx; const end = t + (o.a ?? 0.002) + o.dec;
  const s = osc(ctx, o.type ?? 'sine', o.f, t, end - t + 0.02);
  if (o.detune) s.detune.value = o.detune;
  if (o.f2 !== undefined) glide(s.frequency, t, o.f, o.f2, o.glideDur ?? o.dec);
  const g = gain(ctx, 0); perc(g.gain, t, o.a ?? 0.002, o.peak, o.dec);
  s.connect(g); g.connect(out); return end;
}
/** Sustained note with attack/hold/release (for stings). */
function note(k: Kit, out: AudioNode, t: number, f: number, type: OscillatorType, peak: number, a: number, hold: number, rel: number, detune = 0): number {
  const s = osc(k.ctx, type, f, t, a + hold + rel + 0.03); s.detune.value = detune;
  const g = gain(k.ctx, 0); const end = ahr(g.gain, t, a, peak, hold, rel); s.connect(g); g.connect(out); return end;
}
function saturator(k: Kit, out: AudioNode, drive: number, curve: Float32Array<ArrayBuffer>, trim: number): AudioNode {
  const pre = gain(k.ctx, drive); const ws = k.ctx.createWaveShaper(); ws.curve = curve; const post = gain(k.ctx, trim);
  pre.connect(ws); ws.connect(post); post.connect(out); return pre;
}
const mx = (...e: number[]) => Math.max(...e);
const R = (k: Kit, lo: number, hi: number) => lo + (hi - lo) * k.rand();
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

interface GunOpts { crackHz: number; crackDur: number; crackAmp: number; bodyHz: number; bodyQ: number; bodyDec: number; bodyAmp: number; thumpFrom: number; thumpTo: number; thumpDec: number; thumpAmp: number; tailHz?: number; tailDec?: number; tailAmp?: number; drive: number }
function gun({ kit: k, out, t, p }: SfxArgs, o: GunOpts): number {
  const bus = saturator(k, out, o.drive, k.soft, 0.62);
  let end = burst(k, bus, t, { type: 'highpass', f: o.crackHz * p, peak: o.crackAmp, a: 0.0004, dec: o.crackDur });
  end = mx(end, burst(k, bus, t, { type: 'bandpass', f: o.bodyHz * p, f2: o.bodyHz * 0.6 * p, q: o.bodyQ, peak: o.bodyAmp, a: 0.0008, dec: o.bodyDec }));
  end = mx(end, tone(k, bus, t, { f: o.thumpFrom * p, f2: o.thumpTo * p, glideDur: o.thumpDec * 0.7, peak: o.thumpAmp, a: 0.001, dec: o.thumpDec }));
  if (o.tailHz && o.tailDec && o.tailAmp) end = mx(end, burst(k, out, t + 0.004, { type: 'lowpass', f: o.tailHz * p, f2: o.tailHz * 0.4, q: 0.5, a: 0.004, peak: o.tailAmp, dec: o.tailDec, color: 'pink' }));
  return end;
}
function click(k: Kit, out: AudioNode, t: number, f: number, amp: number, dec = 0.018): number {
  return mx(burst(k, out, t, { type: 'bandpass', f, q: 3, peak: amp, a: 0.0004, dec }), tone(k, out, t, { f: f * 0.45, peak: amp * 0.25, a: 0.0005, dec: dec * 0.8 }));
}
function tinkles(k: Kit, out: AudioNode, t: number, n: number, spread: number, amp: number, lo = 2500, hi = 7500): number {
  let end = t;
  for (let i = 0; i < n; i++) {
    const at = t + Math.pow(k.rand(), 1.6) * spread; const f = R(k, lo, hi);
    end = mx(end, tone(k, out, at, { f, peak: amp * R(k, 0.4, 1) * (1 - (at - t) / (spread * 1.5)), a: 0.0006, dec: R(k, 0.05, 0.18) }));
  }
  return end;
}

// ---------- recipes ----------
export const RECIPES: Record<SfxName, Recipe> = {
  pistol: a => mx(gun(a, { crackHz: 2600, crackDur: 0.016, crackAmp: 1.1, bodyHz: 1150, bodyQ: 1.0, bodyDec: 0.085, bodyAmp: 1.2, thumpFrom: 180, thumpTo: 60, thumpDec: 0.1, thumpAmp: 0.85, tailHz: 1600, tailDec: 0.22, tailAmp: 0.18, drive: 2.2 }),
    click(a.kit, a.out, a.t + 0.045, 3800 * a.p, 0.12)),
  smg: a => gun(a, { crackHz: 3200, crackDur: 0.009, crackAmp: 0.85, bodyHz: 1800, bodyQ: 1.3, bodyDec: 0.045, bodyAmp: 0.9, thumpFrom: 240, thumpTo: 100, thumpDec: 0.055, thumpAmp: 0.45, tailHz: 2200, tailDec: 0.12, tailAmp: 0.1, drive: 1.8 }),
  shotgun: a => {
    const { kit: k, out, t, p } = a;
    let end = gun(a, { crackHz: 1700, crackDur: 0.024, crackAmp: 1.0, bodyHz: 650, bodyQ: 0.6, bodyDec: 0.26, bodyAmp: 1.3, thumpFrom: 120, thumpTo: 34, thumpDec: 0.36, thumpAmp: 1.5, tailHz: 900, tailDec: 0.6, tailAmp: 0.35, drive: 2.6 });
    end = mx(end, burst(k, out, t, { type: 'lowpass', f: 260 * p, q: 0.9, a: 0.003, peak: 0.9, dec: 0.32, color: 'brown' }));
    // pump action
    end = mx(end, click(k, out, t + 0.42, 2200 * p, 0.16, 0.03), burst(k, out, t + 0.45, { type: 'bandpass', f: 1400 * p, q: 1.2, a: 0.02, peak: 0.08, dec: 0.08 }), click(k, out, t + 0.56, 1700 * p, 0.2, 0.035));
    return end;
  },
  rifle: a => {
    const end = gun(a, { crackHz: 3600, crackDur: 0.011, crackAmp: 1.35, bodyHz: 950, bodyQ: 1.2, bodyDec: 0.13, bodyAmp: 1.1, thumpFrom: 150, thumpTo: 48, thumpDec: 0.14, thumpAmp: 0.9, tailHz: 1300, tailDec: 0.55, tailAmp: 0.32, drive: 2.8 });
    return mx(end, burst(a.kit, a.out, a.t + 0.002, { type: 'bandpass', f: 5200 * a.p, q: 2, peak: 0.25, a: 0.0003, dec: 0.02 }));
  },
  punch: ({ kit: k, out, t, p }) => burst(k, out, t, { type: 'bandpass', f: 420 * p, f2: 1900 * p, glideDur: 0.11, q: 1.6, a: 0.05, peak: 0.9, dec: 0.12, color: 'pink' }),
  punchHit: ({ kit: k, out, t, p }) => {
    let end = tone(k, out, t, { f: 135 * p, f2: 52 * p, glideDur: 0.08, peak: 0.95, a: 0.001, dec: 0.13 });
    end = mx(end, burst(k, out, t, { type: 'lowpass', f: 1300 * p, peak: 0.55, a: 0.0008, dec: 0.05 }));
    const s = sample(k, 'impact', t, 1.7 * p, 0, 0.16);
    if (s) { const f = bq(k.ctx, 'lowpass', 2400); const g = gain(k.ctx, 0); perc(g.gain, t, 0.001, 0.32, 0.15); s.connect(f); f.connect(g); g.connect(out); end = mx(end, t + 0.17); }
    return end;
  },
  hitBody: ({ kit: k, out, t, p }) => mx(
    tone(k, out, t, { f: 98 * p, f2: 50 * p, glideDur: 0.1, peak: 0.75, a: 0.002, dec: 0.15 }),
    burst(k, out, t, { type: 'lowpass', f: 480 * p, peak: 0.7, a: 0.002, dec: 0.08, color: 'pink' }),
    burst(k, out, t, { type: 'bandpass', f: 2300 * p, q: 1, peak: 0.06, a: 0.001, dec: 0.03 })),
  hitMetal: ({ kit: k, out, t, p }) => {
    const f0 = R(k, 430, 560) * p; const parts: [number, number, number][] = [[1, 0.32, 0.5], [2.76, 0.22, 0.34], [5.4, 0.13, 0.2], [8.93, 0.07, 0.11]];
    let end = burst(k, out, t, { type: 'highpass', f: 3000, peak: 0.55, a: 0.0004, dec: 0.012 });
    for (const [m, amp, dec] of parts) end = mx(end, tone(k, out, t, { f: f0 * m, peak: amp, a: 0.0006, dec }));
    return end;
  },
  hitConcrete: ({ kit: k, out, t, p }) => {
    let end = burst(k, out, t, { type: 'bandpass', f: 1900 * p, q: 0.8, peak: 0.7, a: 0.0005, dec: 0.06 });
    end = mx(end, burst(k, out, t, { type: 'lowpass', f: 420 * p, peak: 0.5, a: 0.001, dec: 0.08, color: 'pink' }));
    for (let i = 0; i < 4; i++) end = mx(end, burst(k, out, t + R(k, 0.02, 0.2), { type: 'bandpass', f: R(k, 3000, 6000), q: 2, peak: R(k, 0.06, 0.14), a: 0.0004, dec: 0.012 }));
    return end;
  },
  ricochet: ({ kit: k, out, t, p }) => {
    const ctx = k.ctx; const f0 = R(k, 3300, 4300) * p; const dur = R(k, 0.32, 0.45);
    const s = osc(ctx, 'sine', f0, t, dur + 0.03); glide(s.frequency, t, f0, f0 * 0.34, dur);
    const lfo = osc(ctx, 'sine', R(k, 30, 45), t, dur + 0.03); const lg = gain(ctx, 90); lfo.connect(lg); lg.connect(s.frequency);
    const g = gain(ctx, 0); perc(g.gain, t, 0.004, 0.3, dur); s.connect(g); g.connect(out);
    return mx(t + dur, burst(k, out, t, { type: 'highpass', f: 2500, peak: 0.45, a: 0.0004, dec: 0.01 }));
  },
  reload: ({ kit: k, out, t, p }) => mx(
    click(k, out, t, 3500 * p, 0.4, 0.02),
    burst(k, out, t + 0.1, { type: 'bandpass', f: 1500 * p, q: 1, a: 0.03, peak: 0.12, dec: 0.08 }),
    tone(k, out, t + 0.4, { f: 260 * p, f2: 170 * p, peak: 0.4, a: 0.001, dec: 0.06 }),
    click(k, out, t + 0.4, 2200 * p, 0.5, 0.03),
    click(k, out, t + 0.62, 2800 * p, 0.42, 0.025),
    click(k, out, t + 0.71, 3900 * p, 0.5, 0.03)),
  empty: ({ kit: k, out, t, p }) => mx(burst(k, out, t, { type: 'bandpass', f: 5000 * p, q: 4, peak: 0.55, a: 0.0003, dec: 0.012 }), tone(k, out, t, { f: 2400 * p, peak: 0.12, a: 0.0005, dec: 0.02 })),
  equip: ({ kit: k, out, t, p }) => mx(burst(k, out, t, { type: 'bandpass', f: 900 * p, f2: 1500 * p, q: 1.2, a: 0.04, peak: 0.2, dec: 0.1, color: 'pink' }), click(k, out, t + 0.12, 3200 * p, 0.4, 0.02), click(k, out, t + 0.16, 2100 * p, 0.25, 0.02)),
  pickup: ({ kit: k, out, t }) => {
    const lp = bq(k.ctx, 'lowpass', 6000); lp.connect(out);
    return mx(tone(k, lp, t, { type: 'triangle', f: hz(81), peak: 0.32, a: 0.003, dec: 0.16 }), tone(k, lp, t + 0.075, { type: 'triangle', f: hz(88), peak: 0.32, a: 0.003, dec: 0.28 }), tone(k, lp, t + 0.075, { f: hz(100), peak: 0.08, a: 0.003, dec: 0.25 }));
  },
  money: ({ kit: k, out, t }) => {
    const notes = [96, 100, 103, 108]; let end = tone(k, out, t, { type: 'triangle', f: hz(84), peak: 0.15, a: 0.002, dec: 0.25 });
    notes.forEach((m, i) => { const at = t + i * 0.045 + R(k, 0, 0.012); end = mx(end, tone(k, out, at, { f: hz(m), peak: 0.16, a: 0.001, dec: 0.3 }), tone(k, out, at, { f: hz(m) * 2.4, peak: 0.05, a: 0.001, dec: 0.12 })); });
    return end;
  },
  footstep: ({ kit: k, out, t, p }) => mx(
    burst(k, out, t, { type: 'lowpass', f: R(k, 550, 900) * p, peak: 0.42, a: 0.003, dec: R(k, 0.05, 0.08), color: 'pink' }),
    burst(k, out, t + 0.004, { type: 'bandpass', f: R(k, 2000, 3200), q: 1.5, peak: 0.07, a: 0.001, dec: 0.018 }),
    tone(k, out, t, { f: 85 * p, f2: 55, peak: 0.18, a: 0.002, dec: 0.05 })),
  jump: ({ kit: k, out, t, p }) => mx(burst(k, out, t, { type: 'bandpass', f: 800 * p, f2: 1700 * p, q: 1.0, a: 0.04, peak: 0.6, dec: 0.16, color: 'pink' }), burst(k, out, t, { type: 'lowpass', f: 600, peak: 0.45, a: 0.002, dec: 0.06, color: 'pink' }), tone(k, out, t, { f: 120 * p, f2: 70, peak: 0.25, a: 0.003, dec: 0.06 })),
  land: ({ kit: k, out, t, p }) => mx(
    tone(k, out, t, { f: 92 * p, f2: 45, peak: 0.6, a: 0.002, dec: 0.12 }),
    burst(k, out, t, { type: 'lowpass', f: 620 * p, peak: 0.55, a: 0.002, dec: 0.1, color: 'pink' }),
    burst(k, out, t + 0.01, { type: 'bandpass', f: 1800, q: 1, peak: 0.12, a: 0.005, dec: 0.08 })),
  doorOpen: ({ kit: k, out, t, p }) => mx(click(k, out, t, 2800 * p, 0.45, 0.025), tone(k, out, t + 0.05, { f: 150 * p, f2: 92 * p, peak: 0.3, a: 0.002, dec: 0.09 }), burst(k, out, t + 0.05, { type: 'lowpass', f: 900, peak: 0.25, a: 0.002, dec: 0.06 })),
  doorClose: ({ kit: k, out, t, p }) => mx(
    tone(k, out, t, { f: 112 * p, f2: 52 * p, peak: 0.95, a: 0.002, dec: 0.2 }),
    burst(k, out, t, { type: 'lowpass', f: 720 * p, peak: 0.75, a: 0.001, dec: 0.13, color: 'pink' }),
    burst(k, out, t + 0.004, { type: 'bandpass', f: 1600, q: 1.5, peak: 0.16, a: 0.001, dec: 0.07 }),
    click(k, out, t + 0.016, 3000 * p, 0.3, 0.02)),
  horn: ({ kit: k, out, t, p }) => {
    const bp = bq(k.ctx, 'bandpass', 1000, 0.7); const sat = saturator(k, bp, 1.6, k.soft, 0.5); bp.connect(out);
    return mx(note(k, sat, t, 352 * p, 'sawtooth', 0.42, 0.012, 0.36, 0.07, 4), note(k, sat, t, 443 * p, 'sawtooth', 0.38, 0.012, 0.36, 0.07, -3), note(k, sat, t, 176 * p, 'square', 0.1, 0.012, 0.36, 0.07));
  },
  glass: ({ kit: k, out, t, p }) => mx(
    burst(k, out, t, { type: 'bandpass', f: 1300 * p, q: 1, peak: 0.45, a: 0.0005, dec: 0.04 }),
    burst(k, out, t, { type: 'highpass', f: 2800 * p, peak: 0.5, a: 0.0008, dec: 0.38 }),
    tinkles(k, out, t + 0.01, 16, 0.5, 0.16)),
  crash: ({ kit: k, out, t, p }) => {
    let end = tone(k, out, t, { f: 82 * p, f2: 34, glideDur: 0.2, peak: 1.0, a: 0.002, dec: 0.32 });
    const s = sample(k, 'impact', t, R(k, 0.78, 0.95) * p);
    const crunchAmp = s ? 0.4 : 0.75;
    if (s) { const g = gain(k.ctx, 0.95); s.connect(g); g.connect(out); end = mx(end, t + (s.buffer?.duration ?? 0.5) / 0.78); }
    const sat = saturator(k, out, 3, k.hard, 0.4);
    end = mx(end, burst(k, sat, t, { type: 'bandpass', f: 700 * p, q: 0.7, peak: crunchAmp, a: 0.002, dec: 0.38 }));
    end = mx(end, burst(k, out, t + 0.02, { type: 'bandpass', f: 2600 * p, q: 0.9, peak: 0.22, a: 0.002, dec: 0.18 }));
    end = mx(end, tinkles(k, out, t + 0.04, 7, 0.45, 0.07, 1800, 5500));
    return end;
  },
  explosion: ({ kit: k, out, t, p }) => {
    let end = burst(k, saturator(k, out, 1.8, k.soft, 0.7), t, { type: 'lowpass', f: 6500 * p, f2: 260 * p, glideDur: 1.1, q: 0.6, peak: 1.0, a: 0.003, dec: 2.2 });
    end = mx(end, tone(k, out, t, { f: 72 * p, f2: 24, glideDur: 0.8, peak: 1.25, a: 0.003, dec: 1.05 }));
    const rum = bq(k.ctx, 'lowpass', 190); rum.connect(out);
    const n = noise(k, t, 2.7, 'brown'); const g = gain(k.ctx, 0); end = mx(end, ahr(g.gain, t, 0.05, 0.75, 0.35, 2.1)); n.connect(g); g.connect(rum);
    for (let i = 0; i < 24; i++) { const at = t + 0.12 + Math.pow(k.rand(), 1.4) * 1.5; end = mx(end, burst(k, out, at, { type: 'bandpass', f: R(k, 1800, 5000), q: 2, peak: R(k, 0.05, 0.16) * (1 - (at - t) / 2), a: 0.0004, dec: 0.015 })); }
    return end;
  },
  splash: ({ kit: k, out, t, p }) => {
    let end = burst(k, out, t, { type: 'bandpass', f: 1100 * p, f2: 550 * p, q: 0.8, a: 0.006, peak: 0.75, dec: 0.38, color: 'pink' });
    end = mx(end, burst(k, out, t + 0.01, { type: 'highpass', f: 3200, a: 0.004, peak: 0.25, dec: 0.28 }));
    for (let i = 0; i < 8; i++) { const f = R(k, 320, 950) * p; end = mx(end, tone(k, out, t + 0.05 + k.rand() * 0.5, { f, f2: f * 1.9, glideDur: 0.05, peak: R(k, 0.05, 0.12), a: 0.002, dec: 0.06 })); }
    return end;
  },
  uiClick: ({ kit: k, out, t }) => mx(tone(k, out, t, { f: 2100, peak: 0.14, a: 0.001, dec: 0.035 }), tone(k, out, t, { type: 'triangle', f: 1050, peak: 0.08, a: 0.001, dec: 0.05 })),
  uiHover: ({ kit: k, out, t }) => tone(k, out, t, { f: 2800, peak: 0.08, a: 0.003, dec: 0.03 }),
  uiBack: ({ kit: k, out, t }) => mx(tone(k, out, t, { type: 'triangle', f: 1400, peak: 0.12, a: 0.002, dec: 0.05 }), tone(k, out, t + 0.05, { type: 'triangle', f: 1050, peak: 0.12, a: 0.002, dec: 0.07 })),
  missionStart: ({ kit: k, out, t }) => {
    const ctx = k.ctx; let end = burst(k, out, t, { type: 'bandpass', f: 400, f2: 4500, glideDur: 0.5, q: 1.5, a: 0.45, peak: 0.18, dec: 0.08 });
    const lp = bq(ctx, 'lowpass', 400, 2); glide(lp.frequency, t + 0.5, 400, 3800, 0.5); lp.connect(out);
    for (const [m, d] of [[45, 0], [57, 6], [60, -6], [64, 5], [71, -4]] as const) end = mx(end, note(k, lp, t + 0.5, hz(m), 'sawtooth', m === 45 ? 0.2 : 0.09, 0.04, 0.35, 0.9, d));
    end = mx(end, tone(k, out, t + 0.5, { f: 110, f2: 40, peak: 0.6, a: 0.002, dec: 0.4 }), tone(k, out, t + 0.5, { f: hz(88), peak: 0.06, a: 0.002, dec: 0.6 }));
    return end;
  },
  missionPass: ({ kit: k, out, t }) => {
    const ctx = k.ctx; const lp = bq(ctx, 'lowpass', 2600, 0.8); lp.connect(out); let end = t;
    const chords: [number, number[], number][] = [[0, [53, 65, 69, 72], 0.3], [0.32, [55, 67, 71, 74], 0.3], [0.64, [48, 64, 67, 72, 76], 1.1]];
    for (const [at, ns, hold] of chords) for (const m of ns) { end = mx(end, note(k, lp, t + at, hz(m), 'sawtooth', m < 60 ? 0.14 : 0.06, 0.02, hold, 0.5, 6), note(k, lp, t + at, hz(m), 'sawtooth', m < 60 ? 0 : 0.05, 0.02, hold, 0.5, -6)); }
    const mel = [[0, 84], [0.32, 86], [0.64, 88], [0.8, 91]] as const;
    for (const [at, m] of mel) end = mx(end, tone(k, out, t + at, { type: 'triangle', f: hz(m), peak: 0.16, a: 0.003, dec: at > 0.7 ? 0.9 : 0.3 }), tone(k, out, t + at, { f: hz(m + 12), peak: 0.04, a: 0.003, dec: 0.4 }));
    return end;
  },
  missionFail: ({ kit: k, out, t }) => {
    const ctx = k.ctx; const lp = bq(ctx, 'lowpass', 2200, 1); glide(lp.frequency, t + 0.6, 2200, 280, 1.4); lp.connect(out); let end = t;
    const mel = [76, 74, 72, 69]; mel.forEach((m, i) => { end = mx(end, note(k, lp, t + i * 0.2, hz(m), 'triangle', 0.18, 0.01, 0.12, 0.25), note(k, lp, t + i * 0.2, hz(m - 12), 'sawtooth', 0.05, 0.01, 0.12, 0.2)); });
    for (const m of [45, 57, 60, 64]) {
      const s = osc(ctx, 'sawtooth', hz(m), t + 0.8, 1.6); s.detune.setValueAtTime(0, t + 1.2); s.detune.linearRampToValueAtTime(-90, t + 2.3);
      const g = gain(ctx, 0); end = mx(end, ahr(g.gain, t + 0.8, 0.03, m === 45 ? 0.16 : 0.07, 0.4, 1.1)); s.connect(g); g.connect(lp);
    }
    return end;
  },
  down: ({ kit: k, out, t }) => {
    const ctx = k.ctx; const lp = bq(ctx, 'lowpass', 320, 0.7); lp.connect(out); let end = t;
    for (const at of [0, 0.95, 2.05]) {
      const amp = at === 0 ? 1 : at < 1 ? 0.8 : 0.6;
      end = mx(end, tone(k, lp, t + at, { f: 62, f2: 38, peak: 0.95 * amp, a: 0.004, dec: 0.15 }), burst(k, lp, t + at, { type: 'lowpass', f: 160, peak: 0.45 * amp, a: 0.003, dec: 0.08, color: 'pink' }));
      end = mx(end, tone(k, lp, t + at + 0.22, { f: 58, f2: 36, peak: 0.65 * amp, a: 0.004, dec: 0.14 }));
    }
    for (const m of [33, 40, 45]) end = mx(end, note(k, lp, t, hz(m), 'triangle', 0.12, 0.25, 0.8, 1.9));
    return end;
  },
  checkpoint: ({ kit: k, out, t }) => mx(
    tone(k, out, t, { f: hz(88), peak: 0.22, a: 0.002, dec: 0.5 }), tone(k, out, t, { f: hz(88) * 2.01, peak: 0.05, a: 0.002, dec: 0.25 }),
    tone(k, out, t + 0.085, { f: hz(93), peak: 0.22, a: 0.002, dec: 0.65 }), tone(k, out, t + 0.085, { f: hz(93) * 2.01, peak: 0.05, a: 0.002, dec: 0.3 })),
  wheelOpen: ({ kit: k, out, t }) => mx(burst(k, out, t, { type: 'bandpass', f: 320, f2: 2400, glideDur: 0.15, q: 1.6, a: 0.12, peak: 0.25, dec: 0.12, color: 'pink' }), tone(k, out, t, { f: 220, f2: 330, glideDur: 0.15, peak: 0.07, a: 0.05, dec: 0.15 })),
  wheelClose: ({ kit: k, out, t }) => mx(burst(k, out, t, { type: 'bandpass', f: 2400, f2: 380, glideDur: 0.14, q: 1.6, a: 0.02, peak: 0.25, dec: 0.15, color: 'pink' }), tone(k, out, t, { f: 330, f2: 220, glideDur: 0.12, peak: 0.07, a: 0.01, dec: 0.13 })),
  heatUp: ({ kit: k, out, t }) => {
    const lp = bq(k.ctx, 'lowpass', 2200, 1.5); lp.connect(out); let end = tone(k, out, t, { f: 90, f2: 45, peak: 0.45, a: 0.002, dec: 0.18 });
    [74, 77, 81].forEach((m, i) => { end = mx(end, note(k, lp, t + i * 0.085, hz(m), 'square', 0.1, 0.004, 0.05, 0.1), note(k, lp, t + i * 0.085, hz(m - 12), 'sawtooth', 0.07, 0.004, 0.05, 0.1)); });
    return end;
  },
  heatLost: ({ kit: k, out, t }) => {
    let end = t; [88, 84, 79, 76].forEach((m, i) => { end = mx(end, tone(k, out, t + i * 0.11, { type: 'triangle', f: hz(m), peak: 0.16, a: 0.004, dec: 0.5 })); });
    const lp = bq(k.ctx, 'lowpass', 1400); lp.connect(out);
    for (const m of [60, 64, 67]) end = mx(end, note(k, lp, t, hz(m), 'sawtooth', 0.035, 0.25, 0.35, 0.7));
    return end;
  },
  purchase: ({ kit: k, out, t }) => mx(
    click(k, out, t, 3000, 0.35, 0.02), burst(k, out, t + 0.02, { type: 'bandpass', f: 900, q: 1, a: 0.03, peak: 0.12, dec: 0.12 }),
    tone(k, out, t + 0.06, { f: hz(91), peak: 0.2, a: 0.001, dec: 0.45 }), tone(k, out, t + 0.06, { f: hz(91) * 2.76, peak: 0.04, a: 0.001, dec: 0.15 }),
    tone(k, out, t + 0.13, { f: hz(96), peak: 0.2, a: 0.001, dec: 0.6 }), tone(k, out, t + 0.13, { f: hz(96) * 2.76, peak: 0.04, a: 0.001, dec: 0.2 })),
  whoosh: ({ kit: k, out, t, p }) => {
    const n = noise(k, t, 0.6, 'pink'); const f = bq(k.ctx, 'bandpass', 300 * p, 1.2);
    f.frequency.setValueAtTime(300 * p, t); f.frequency.exponentialRampToValueAtTime(1800 * p, t + 0.2); f.frequency.exponentialRampToValueAtTime(500 * p, t + 0.55);
    const g = gain(k.ctx, 0); const end = ahr(g.gain, t, 0.16, 0.6, 0.06, 0.3); n.connect(f); f.connect(g); g.connect(out); return end;
  },
  tireScreech: ({ kit: k, out, t, p }) => {
    const g = gain(k.ctx, 0); const end = ahr(g.gain, t, 0.03, 0.75, 0.32, 0.28); g.connect(out);
    const b = k.samples.skid;
    if (b) { const s = sample(k, 'skid', t, p, k.rand() * Math.max(0, b.duration - 0.8), 0.7); s?.connect(g); return end; }
    const ctx = k.ctx; const s = osc(ctx, 'sawtooth', 950 * p, t, 0.7); const lfo = osc(ctx, 'sine', 7, t, 0.7); const lg = gain(ctx, 40); lfo.connect(lg); lg.connect(s.frequency);
    const f = bq(ctx, 'bandpass', 1900, 3); const sat = saturator(k, f, 1.5, k.soft, 0.3); s.connect(sat);
    const n = noise(k, t, 0.7); const nf = bq(ctx, 'bandpass', 2400, 5); n.connect(nf); nf.connect(g); f.connect(g); return end;
  },
  engineStart: ({ kit: k, out, t, p }) => {
    const ctx = k.ctx; const crank = osc(ctx, 'sawtooth', 62 * p, t, 0.75); const lp = bq(ctx, 'lowpass', 650);
    const am = gain(ctx, 0.5); const lfo = osc(ctx, 'square', 9, t, 0.75); const lg = gain(ctx, 0.45); lfo.connect(lg); lg.connect(am.gain);
    const env = gain(ctx, 0); ahr(env.gain, t, 0.03, 0.5, 0.55, 0.1); crank.connect(lp); lp.connect(am); am.connect(env); env.connect(out);
    let end = t + 0.7;
    const s = sample(k, 'engine', t + 0.62, 0.55 * p, 0, 1.0);
    const eg = gain(ctx, 0); end = mx(end, ahr(eg.gain, t + 0.62, 0.06, 0.8, 0.35, 0.5)); eg.connect(out);
    if (s) { s.playbackRate.setValueAtTime(0.55 * p, t + 0.62); s.playbackRate.linearRampToValueAtTime(0.95 * p, t + 0.8); s.playbackRate.linearRampToValueAtTime(0.6 * p, t + 1.3); s.connect(eg); }
    const r = osc(ctx, 'sawtooth', 40 * p, t + 0.62, 1.0); r.frequency.linearRampToValueAtTime(75 * p, t + 0.8); r.frequency.linearRampToValueAtTime(45 * p, t + 1.3);
    const rl = bq(ctx, 'lowpass', 260); const rg = gain(ctx, s ? 0.5 : 1); r.connect(rl); rl.connect(rg); rg.connect(eg);
    return end;
  },
  shellCasing: ({ kit: k, out, t, p }) => {
    const hp = bq(k.ctx, 'highpass', 2800); hp.connect(out); let end = t; let at = t + R(k, 0.25, 0.4);
    for (let i = 0; i < 3; i++) { const f = R(k, 5200, 6800) * p; const amp = 0.12 * Math.pow(0.55, i); end = mx(end, tone(k, hp, at, { f, peak: amp, a: 0.0005, dec: 0.07 }), tone(k, hp, at, { f: f * 1.51, peak: amp * 0.4, a: 0.0005, dec: 0.04 })); at += R(k, 0.06, 0.1) * Math.pow(0.7, i); }
    return end;
  },
};

export function renderSfx(name: SfxName, args: SfxArgs): number { return RECIPES[name](args); }
