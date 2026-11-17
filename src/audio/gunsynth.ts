/**
 * Offline sample synthesis for weapons and impacts. Everything here is plain JS math on Float32Arrays (no Web Audio),
 * so it is unit-testable in Node and deterministic for a given random source. The engine renders a few variants of
 * each sound once per AudioContext (see `bank` in sfx.ts) and plays them back round-robin with small pitch / level /
 * EQ changes, the way recorded-sample engines avoid the "machine-gun" effect.
 *
 * A gunshot is layered like a recording of the real thing:
 *   crack  – sub-millisecond broadband transient (plus an N-wave for supersonic rounds)
 *   blast  – band-limited noise burst, the "bang" (a few ms)
 *   body   – sine punch with a fast pitch drop (≈180 → 50 Hz), the chest thump
 *   sub    – low-passed noise thump under 150 Hz
 *   boom   – short resonant mid ring (gas / chamber), gives each gun its colour
 *   tail   – noise whose low-pass closes over a few hundred ms (the near-field tail; room / street reflections are
 *            added live by the mix engine from the actual surroundings)
 * then soft-saturated and normalised.
 */
export type Rand = () => number;

// ---------------- tiny DSP kit ----------------
/** RBJ biquad, transposed direct form II. Coefficients can be changed per sample (cheap enough offline). */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0; private z1 = 0; private z2 = 0;
  constructor(private sr: number, private type: 'lp' | 'hp' | 'bp' | 'peak', f: number, q = 0.707, gainDb = 0) { this.set(f, q, gainDb); }
  set(f: number, q = 0.707, gainDb = 0): this {
    const w = 2 * Math.PI * Math.min(Math.max(f, 10), this.sr * 0.45) / this.sr, cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * Math.max(0.05, q));
    let b0 = 0, b1 = 0, b2 = 0, a0 = 1, a1 = 0, a2 = 0;
    if (this.type === 'lp') { b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (this.type === 'hp') { b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else if (this.type === 'bp') { b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; }
    else { const A = Math.pow(10, gainDb / 40); b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
    return this;
  }
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}
/** exp(-t / tau) with a linear attack of `att` seconds. */
const env = (t: number, att: number, tau: number) => (t < att ? t / att : Math.exp(-(t - att) / tau));
const vary = (r: Rand, v: number, amt: number) => v * (1 + (r() * 2 - 1) * amt);

/** Normalise to `peak`, fade the last few ms and strip DC. */
export function finish(d: Float32Array, sr: number, peak = 0.9): Float32Array {
  let dc = 0; const hp = 1 - 2 * Math.PI * 20 / sr;
  for (let i = 0; i < d.length; i++) { const x = d[i]; const y = x - dc; dc = dc + (1 - hp) * y; d[i] = y; }
  let m = 0; for (let i = 0; i < d.length; i++) m = Math.max(m, Math.abs(d[i]));
  const g = m > 1e-9 ? peak / m : 0; const fade = Math.min(d.length, Math.floor(sr * 0.012));
  for (let i = 0; i < d.length; i++) d[i] *= g;
  for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
  return d;
}

// ---------------- gunshots ----------------
export interface GunVoice {
  dur: number;
  crackAmp: number; crackTau: number; crackHp: number; nAmp: number; nWidth: number;
  blastAmp: number; blastTau: number; blastLo: number; blastHi: number;
  bodyAmp: number; bodyF0: number; bodyF1: number; bodyPitchTau: number; bodyTau: number;
  subAmp: number; subTau: number; subHz: number;
  boomAmp: number; boomHz: number; boomQ: number; boomTau: number;
  tailAmp: number; tailTau: number; tailHz0: number; tailHz1: number; tailClose: number;
  drive: number;
}
export type GunName = 'pistol' | 'smg' | 'shotgun' | 'rifle';
export const GUNS: Record<GunName, GunVoice> = {
  // 9 mm: sharp snap, firm mid punch, medium tail
  pistol: { dur: 0.65, crackAmp: 1.0, crackTau: 0.0011, crackHp: 1800, nAmp: 0, nWidth: 0, blastAmp: 0.95, blastTau: 0.0065, blastLo: 280, blastHi: 3200, bodyAmp: 1.05, bodyF0: 190, bodyF1: 62, bodyPitchTau: 0.013, bodyTau: 0.05, subAmp: 0.75, subTau: 0.055, subHz: 120, boomAmp: 0.45, boomHz: 620, boomQ: 3, boomTau: 0.035, tailAmp: 0.26, tailTau: 0.16, tailHz0: 4800, tailHz1: 650, tailClose: 0.05, drive: 2.1 },
  // compact SMG: tighter, brighter, less low end, short tail so bursts stay articulate
  smg: { dur: 0.48, crackAmp: 1.0, crackTau: 0.0009, crackHp: 2400, nAmp: 0, nWidth: 0, blastAmp: 0.85, blastTau: 0.0045, blastLo: 380, blastHi: 4000, bodyAmp: 0.8, bodyF0: 230, bodyF1: 88, bodyPitchTau: 0.009, bodyTau: 0.032, subAmp: 0.5, subTau: 0.035, subHz: 135, boomAmp: 0.45, boomHz: 820, boomQ: 3.5, boomTau: 0.025, tailAmp: 0.2, tailTau: 0.085, tailHz0: 5200, tailHz1: 900, tailClose: 0.04, drive: 2.3 },
  // 12 gauge: huge low boom, long rolling tail
  shotgun: { dur: 1.05, crackAmp: 1.25, crackTau: 0.0018, crackHp: 1200, nAmp: 0, nWidth: 0, blastAmp: 1.35, blastTau: 0.012, blastLo: 220, blastHi: 3600, bodyAmp: 1.15, bodyF0: 150, bodyF1: 44, bodyPitchTau: 0.02, bodyTau: 0.075, subAmp: 0.7, subTau: 0.15, subHz: 95, boomAmp: 0.45, boomHz: 640, boomQ: 2.5, boomTau: 0.07, tailAmp: 0.36, tailTau: 0.27, tailHz0: 3200, tailHz1: 330, tailClose: 0.12, drive: 3 },
  // supersonic carbine: N-wave crack on top of a heavy body
  rifle: { dur: 0.85, crackAmp: 1.25, crackTau: 0.0008, crackHp: 3000, nAmp: 0.85, nWidth: 0.00035, blastAmp: 1.15, blastTau: 0.007, blastLo: 300, blastHi: 4200, bodyAmp: 1.05, bodyF0: 170, bodyF1: 52, bodyPitchTau: 0.016, bodyTau: 0.065, subAmp: 0.85, subTau: 0.085, subHz: 105, boomAmp: 0.42, boomHz: 560, boomQ: 2.5, boomTau: 0.045, tailAmp: 0.3, tailTau: 0.2, tailHz0: 6000, tailHz1: 480, tailClose: 0.08, drive: 2.4 },
};

/** Renders one gunshot variant (mono). */
export function renderGun(v0: GunVoice, sr: number, r: Rand): Float32Array {
  // per-variant humanisation
  const v: GunVoice = { ...v0, blastTau: vary(r, v0.blastTau, 0.12), bodyF0: vary(r, v0.bodyF0, 0.06), bodyF1: vary(r, v0.bodyF1, 0.06), bodyTau: vary(r, v0.bodyTau, 0.1), boomHz: vary(r, v0.boomHz, 0.08), tailTau: vary(r, v0.tailTau, 0.12), tailHz0: vary(r, v0.tailHz0, 0.15), subAmp: vary(r, v0.subAmp, 0.1) };
  const n = Math.floor(v.dur * sr); const out = new Float32Array(n);
  const crackHp = new Biquad(sr, 'hp', v.crackHp, 0.6), crackHp2 = new Biquad(sr, 'hp', v.crackHp * 0.7, 0.6);
  const blHp = new Biquad(sr, 'hp', v.blastLo, 0.7), blLp = new Biquad(sr, 'lp', v.blastHi, 0.7);
  const subLp = new Biquad(sr, 'lp', v.subHz, 0.9), subLp2 = new Biquad(sr, 'lp', v.subHz * 1.3, 0.7);
  const boom = new Biquad(sr, 'bp', v.boomHz, v.boomQ);
  const tailLp = new Biquad(sr, 'lp', v.tailHz0, 0.6), tailLp2 = new Biquad(sr, 'lp', v.tailHz0, 0.6), tailHp = new Biquad(sr, 'hp', 90, 0.7);
  let ph = Math.PI / 2, brown = 0; // cosine start: the body is at full pressure on the first sample
  for (let i = 0; i < n; i++) {
    const t = i / sr; const w = r() * 2 - 1;
    brown = (brown + 0.04 * w) / 1.04;
    // crack (+ N-wave)
    let x = crackHp2.run(crackHp.run(w * v.crackAmp * 3 * env(t, 0.00004, v.crackTau)));
    if (v.nAmp > 0 && t < v.nWidth) x += v.nAmp * (1 - 2 * t / v.nWidth);
    // blast
    x += blLp.run(blHp.run(w)) * v.blastAmp * 3.6 * env(t, 0.00012, v.blastTau * 1.6);
    // body: pitch-dropping sine, with a touch of 2nd harmonic
    const f = v.bodyF1 + (v.bodyF0 - v.bodyF1) * Math.exp(-t / v.bodyPitchTau);
    ph += 2 * Math.PI * f / sr;
    x += (Math.sin(ph) + 0.18 * Math.sin(2 * ph)) * v.bodyAmp * 0.55 * env(t, 0.0004, v.bodyTau);
    // sub thump
    x += subLp2.run(subLp.run(brown * 9)) * v.subAmp * 0.5 * env(t, 0.0015, v.subTau);
    // boom ring (slight downward sweep)
    if (i % 32 === 0) boom.set(v.boomHz * (0.85 + 0.15 * Math.exp(-t / 0.02)), v.boomQ);
    x += boom.run(w) * v.boomAmp * 4 * env(t, 0.0003, v.boomTau);
    // closing noise tail
    if (i % 16 === 0) { const fc = v.tailHz1 + (v.tailHz0 - v.tailHz1) * Math.exp(-t / v.tailClose); tailLp.set(fc, 0.6); tailLp2.set(fc, 0.6); }
    x += tailHp.run(tailLp2.run(tailLp.run(w))) * v.tailAmp * 1.4 * env(t, 0.003, v.tailTau);
    out[i] = Math.tanh(x * v.drive) / Math.tanh(v.drive);
  }
  return finish(out, sr);
}

// ---------------- mechanical / foley ----------------
/** Modal "clack": a broadband click exciting a few damped inharmonic modes (metal parts, latches, casings). */
export interface Mode { f: number; a: number; tau: number }
export function addClack(d: Float32Array, sr: number, at: number, r: Rand, o: { amp: number; modes: Mode[]; click?: number; clickHp?: number; clickTau?: number; detune?: number }): void {
  const i0 = Math.floor(at * sr); const det = 1 + (r() * 2 - 1) * (o.detune ?? 0.04);
  const longest = Math.max(o.clickTau ?? 0.002, ...o.modes.map(m => m.tau)) * 6;
  const n = Math.min(d.length - i0, Math.floor(longest * sr)); if (n <= 0) return;
  const hp = new Biquad(sr, 'hp', o.clickHp ?? 2500, 0.7); const ct = o.clickTau ?? 0.0015;
  const ph = o.modes.map(() => r() * Math.PI * 2);
  for (let i = 0; i < n; i++) {
    const t = i / sr; let x = hp.run((r() * 2 - 1) * (o.click ?? 0.6) * env(t, 0.00005, ct));
    for (let k = 0; k < o.modes.length; k++) { const m = o.modes[k]; x += Math.sin(ph[k] + 2 * Math.PI * m.f * det * t) * m.a * env(t, 0.0002, m.tau); }
    d[i0 + i] += x * o.amp;
  }
}
/** Filtered noise "swish" (sliding parts, cloth, magazines). */
export function addSwish(d: Float32Array, sr: number, at: number, dur: number, r: Rand, o: { amp: number; f0: number; f1: number; q?: number; attack?: number }): void {
  const i0 = Math.floor(at * sr); const n = Math.min(d.length - i0, Math.floor(dur * sr)); if (n <= 0) return;
  const bp = new Biquad(sr, 'bp', o.f0, o.q ?? 1.2); const a = o.attack ?? 0.3;
  for (let i = 0; i < n; i++) {
    const u = i / n; if (i % 16 === 0) bp.set(o.f0 + (o.f1 - o.f0) * u, o.q ?? 1.2);
    const e = u < a ? u / a : Math.pow(1 - (u - a) / (1 - a), 1.5);
    d[i0 + i] += bp.run(r() * 2 - 1) * e * o.amp * (0.8 + 0.4 * r());
  }
}
/** Low thunk (magazine seating, body hits): pitch-dropping sine + low-passed noise. */
export function addThunk(d: Float32Array, sr: number, at: number, r: Rand, o: { amp: number; f0: number; f1: number; tau: number; noise?: number; lp?: number }): void {
  const i0 = Math.floor(at * sr); const n = Math.min(d.length - i0, Math.floor(o.tau * 7 * sr)); if (n <= 0) return;
  const lp = new Biquad(sr, 'lp', o.lp ?? 900, 0.7); let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr; const f = o.f1 + (o.f0 - o.f1) * Math.exp(-t / (o.tau * 0.4)); ph += 2 * Math.PI * f / sr;
    d[i0 + i] += (Math.sin(ph) + lp.run(r() * 2 - 1) * (o.noise ?? 0.6)) * o.amp * env(t, 0.0006, o.tau);
  }
}
const METAL = (base: number): Mode[] => [{ f: base, a: 0.5, tau: 0.018 }, { f: base * 1.73, a: 0.35, tau: 0.012 }, { f: base * 2.61, a: 0.22, tau: 0.009 }, { f: base * 3.9, a: 0.12, tau: 0.006 }];
const BRASS = (base: number): Mode[] => [{ f: base, a: 0.5, tau: 0.09 }, { f: base * 2.76, a: 0.3, tau: 0.05 }, { f: base * 5.4, a: 0.15, tau: 0.03 }];

export type FoleyName =
  | 'mechPistol' | 'mechSmg' | 'mechRifle' | 'pump' | 'magOut' | 'magIn' | 'slideRelease' | 'boltRack' | 'shellInsert'
  | 'casingBrass' | 'casingHull' | 'dryFire' | 'equip'
  | 'hitBody' | 'hitMetal' | 'hitConcrete' | 'hitWood' | 'hitDirt' | 'hitWater' | 'hitGlass' | 'whizz' | 'crackBy' | 'ricochet';

/** Renders one variant of a foley / impact sound (mono). */
export function renderFoley(name: FoleyName, sr: number, r: Rand): Float32Array {
  const R = (lo: number, hi: number) => lo + (hi - lo) * r();
  const mk = (dur: number) => new Float32Array(Math.floor(dur * sr));
  let d: Float32Array;
  switch (name) {
    case 'mechPistol': // slide slams back and returns: two quick clacks + spring zing
      d = mk(0.12); addClack(d, sr, 0.004, r, { amp: 0.6, modes: METAL(R(2300, 2700)) }); addClack(d, sr, R(0.03, 0.038), r, { amp: 0.8, modes: METAL(R(1900, 2200)), click: 0.8 });
      addSwish(d, sr, 0.008, 0.03, r, { amp: 0.12, f0: 4200, f1: 3000, q: 3 }); break;
    case 'mechSmg': // open bolt hammering
      d = mk(0.08); addClack(d, sr, R(0.012, 0.018), r, { amp: 0.8, modes: METAL(R(1500, 1750)), click: 0.7, clickHp: 1800 }); break;
    case 'mechRifle': // bolt carrier + buffer spring "boing"
      d = mk(0.14); addClack(d, sr, R(0.015, 0.02), r, { amp: 0.75, modes: METAL(R(1700, 2000)) }); addClack(d, sr, R(0.045, 0.05), r, { amp: 0.25, modes: [{ f: R(820, 900), a: 0.5, tau: 0.04 }, { f: 2400, a: 0.2, tau: 0.02 }], click: 0.2 }); break;
    case 'pump': // rack back (slide + clack), forward (clack)
      d = mk(0.36); addSwish(d, sr, 0, 0.09, r, { amp: 0.35, f0: 1400, f1: 2400, q: 1.5 }); addClack(d, sr, 0.085, r, { amp: 0.9, modes: METAL(R(1250, 1450)), click: 0.9, clickHp: 1500 });
      addSwish(d, sr, 0.16, 0.07, r, { amp: 0.3, f0: 2400, f1: 1500, q: 1.5 }); addClack(d, sr, 0.225, r, { amp: 1, modes: METAL(R(1050, 1200)), click: 1, clickHp: 1200 }); addThunk(d, sr, 0.225, r, { amp: 0.35, f0: 260, f1: 140, tau: 0.03 }); break;
    case 'magOut': // release click, magazine slides out
      d = mk(0.3); addClack(d, sr, 0.005, r, { amp: 0.6, modes: METAL(R(2800, 3300)), click: 0.6 }); addSwish(d, sr, 0.04, 0.16, r, { amp: 0.35, f0: 1800, f1: 900, q: 1.1, attack: 0.2 }); addClack(d, sr, 0.19, r, { amp: 0.22, modes: METAL(R(1200, 1500)), click: 0.3 }); break;
    case 'magIn': // slide in + seat thunk + latch click
      d = mk(0.25); addSwish(d, sr, 0, 0.07, r, { amp: 0.3, f0: 900, f1: 1800, q: 1.1, attack: 0.6 }); addThunk(d, sr, 0.07, r, { amp: 0.7, f0: 240, f1: 120, tau: 0.035 }); addClack(d, sr, 0.072, r, { amp: 0.9, modes: METAL(R(2200, 2600)), click: 1 }); break;
    case 'slideRelease': // slide slams home
      d = mk(0.2); addClack(d, sr, 0.004, r, { amp: 1, modes: METAL(R(1800, 2100)), click: 1.1 }); addThunk(d, sr, 0.004, r, { amp: 0.35, f0: 300, f1: 160, tau: 0.025 }); addSwish(d, sr, 0, 0.012, r, { amp: 0.2, f0: 3500, f1: 2500, q: 2 }); break;
    case 'boltRack': // charging handle back and released
      d = mk(0.38); addSwish(d, sr, 0, 0.1, r, { amp: 0.3, f0: 1600, f1: 2600, q: 1.4 }); addClack(d, sr, 0.1, r, { amp: 0.7, modes: METAL(R(1500, 1700)), click: 0.8 });
      addClack(d, sr, 0.24, r, { amp: 1, modes: METAL(R(1700, 1900)), click: 1.1 }); addThunk(d, sr, 0.24, r, { amp: 0.3, f0: 280, f1: 150, tau: 0.03 }); break;
    case 'shellInsert': // plastic hull pushed into the tube + spring click
      d = mk(0.2); addThunk(d, sr, 0, r, { amp: 0.55, f0: R(520, 600), f1: 300, tau: 0.02, noise: 0.8, lp: 2500 }); addSwish(d, sr, 0.005, 0.05, r, { amp: 0.2, f0: 2000, f1: 1200, q: 1.5 }); addClack(d, sr, R(0.055, 0.065), r, { amp: 0.5, modes: METAL(R(2600, 3000)), click: 0.6 }); break;
    case 'casingBrass': { // a few bounces of a small brass tube on pavement
      d = mk(0.55); let at = 0, a = 1;
      for (let i = 0; i < 4; i++) { addClack(d, sr, at, r, { amp: 0.6 * a, modes: BRASS(R(4600, 6400)), click: 0.5, clickHp: 3500 }); at += R(0.06, 0.11) * Math.pow(0.75, i); a *= R(0.4, 0.6); }
      addSwish(d, sr, at, 0.12, r, { amp: 0.04, f0: 5000, f1: 4000, q: 2 }); break;
    }
    case 'casingHull': { // plastic shotgun hull: dull and woody
      d = mk(0.4); let at = 0, a = 1;
      for (let i = 0; i < 3; i++) { addClack(d, sr, at, r, { amp: 0.6 * a, modes: [{ f: R(900, 1200), a: 0.5, tau: 0.015 }, { f: R(2100, 2500), a: 0.2, tau: 0.008 }], click: 0.5, clickHp: 1200 }); at += R(0.07, 0.12) * Math.pow(0.7, i); a *= 0.45; }
      break;
    }
    case 'dryFire': // hammer falls on nothing
      d = mk(0.08); addClack(d, sr, 0.002, r, { amp: 0.9, modes: METAL(R(3000, 3500)), click: 0.9, clickHp: 3000 }); addThunk(d, sr, 0.002, r, { amp: 0.1, f0: 500, f1: 300, tau: 0.01 }); break;
    case 'equip': // cloth + handling clicks
      d = mk(0.3); addSwish(d, sr, 0, 0.14, r, { amp: 0.3, f0: 700, f1: 1500, q: 0.9, attack: 0.5 }); addClack(d, sr, 0.13, r, { amp: 0.55, modes: METAL(R(2600, 3100)) }); addClack(d, sr, 0.17, r, { amp: 0.35, modes: METAL(R(1900, 2200)) }); break;
    case 'hitBody': // muted, cloth-covered thud (no wet layers: Teen rating)
      d = mk(0.22); addThunk(d, sr, 0, r, { amp: 1, f0: R(150, 175), f1: R(55, 70), tau: 0.035, noise: 1.1, lp: 700 }); addSwish(d, sr, 0, 0.03, r, { amp: 0.25, f0: 1400, f1: 900, q: 0.8, attack: 0.05 }); break;
    case 'hitMetal': { // sharp tick + ringing panel/pole
      d = mk(0.5); const f0 = R(900, 1500);
      addClack(d, sr, 0, r, { amp: 0.9, click: 1.2, clickHp: 3000, clickTau: 0.0012, modes: [{ f: f0, a: 0.4, tau: R(0.08, 0.14) }, { f: f0 * 2.32, a: 0.3, tau: R(0.05, 0.1) }, { f: f0 * 4.25, a: 0.18, tau: 0.04 }, { f: f0 * 6.63, a: 0.1, tau: 0.025 }] });
      addThunk(d, sr, 0, r, { amp: 0.35, f0: R(380, 480), f1: 250, tau: 0.03, noise: 0.3 }); break;
    }
    case 'hitConcrete': { // crack + gritty debris + dull thump
      d = mk(0.3); addClack(d, sr, 0, r, { amp: 0.9, click: 1.4, clickHp: 1500, clickTau: 0.0025, modes: [{ f: R(1800, 2400), a: 0.15, tau: 0.008 }] });
      addThunk(d, sr, 0, r, { amp: 0.4, f0: 200, f1: 110, tau: 0.02, noise: 0.8, lp: 600 });
      addSwish(d, sr, 0.002, 0.09, r, { amp: 0.25, f0: 3500, f1: 2000, q: 0.7, attack: 0.05 });
      for (let i = 0; i < 6; i++) addClack(d, sr, R(0.02, 0.22), r, { amp: R(0.05, 0.14), click: 1, clickHp: R(3000, 6000), clickTau: 0.0006, modes: [] });
      break;
    }
    case 'hitWood':
      d = mk(0.25); addClack(d, sr, 0, r, { amp: 0.8, click: 1, clickHp: 1800, modes: [{ f: R(380, 460), a: 0.5, tau: 0.03 }, { f: R(900, 1100), a: 0.3, tau: 0.02 }, { f: R(1600, 1900), a: 0.15, tau: 0.012 }] });
      addSwish(d, sr, 0.005, 0.06, r, { amp: 0.15, f0: 2500, f1: 1500, q: 0.8, attack: 0.05 }); break;
    case 'hitDirt':
      d = mk(0.25); addThunk(d, sr, 0, r, { amp: 0.6, f0: 160, f1: 80, tau: 0.03, noise: 1.2, lp: 500 }); addSwish(d, sr, 0.004, 0.16, r, { amp: 0.3, f0: 1600, f1: 900, q: 0.6, attack: 0.04 }); break;
    case 'hitWater': { // plip + bubble chirp + spray
      d = mk(0.4); addSwish(d, sr, 0, 0.25, r, { amp: 0.4, f0: 4000, f1: 2500, q: 0.6, attack: 0.03 });
      const i0 = Math.floor(0.01 * sr), n = Math.floor(0.06 * sr); const f0 = R(500, 700); let ph = 0;
      for (let i = 0; i < n && i0 + i < d.length; i++) { const t = i / sr; ph += 2 * Math.PI * f0 * (1 + 2.2 * t / 0.06) / sr; d[i0 + i] += Math.sin(ph) * 0.45 * env(t, 0.002, 0.018); }
      addThunk(d, sr, 0, r, { amp: 0.3, f0: 140, f1: 70, tau: 0.03, noise: 0.5 }); break;
    }
    case 'hitGlass':
      d = mk(0.5); addClack(d, sr, 0, r, { amp: 0.8, click: 1, clickHp: 3500, modes: [{ f: R(3200, 4000), a: 0.3, tau: 0.06 }, { f: R(5200, 6100), a: 0.2, tau: 0.04 }] });
      for (let i = 0; i < 8; i++) addClack(d, sr, R(0.02, 0.35), r, { amp: R(0.05, 0.15), click: 0.4, clickHp: 4000, modes: [{ f: R(3000, 7000), a: 0.4, tau: 0.03 }] });
      break;
    case 'whizz': { // a round passing close by: band-passed noise swept down (Doppler) + faint whine
      const dur = R(0.16, 0.24); d = mk(dur + 0.02); const n = Math.floor(dur * sr);
      const bp = new Biquad(sr, 'bp', 4000, 2.2); const f0 = R(3400, 4400), f1 = f0 * R(0.45, 0.55); let ph = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n; const f = f0 + (f1 - f0) / (1 + Math.exp(-(u - 0.42) * 14));
        if (i % 16 === 0) bp.set(f, 2.2);
        const e = u < 0.42 ? Math.pow(u / 0.42, 2.2) : Math.pow(1 - (u - 0.42) / 0.58, 1.6);
        ph += 2 * Math.PI * f * 0.55 / sr;
        d[i] = (bp.run(r() * 2 - 1) * 1.4 + Math.sin(ph) * 0.12) * e;
      }
      break;
    }
    case 'crackBy': // supersonic snap overhead
      d = mk(0.12); addClack(d, sr, 0, r, { amp: 1, click: 1.6, clickHp: 2500, clickTau: 0.0008, modes: [] }); addSwish(d, sr, 0.001, 0.08, r, { amp: 0.25, f0: 5000, f1: 2500, q: 0.8, attack: 0.05 }); break;
    case 'ricochet': { // tick + descending whine with flutter
      const dur = R(0.3, 0.45); d = mk(dur + 0.02); addClack(d, sr, 0, r, { amp: 0.7, click: 1, clickHp: 2500, modes: [] });
      const f0 = R(2800, 3800); let ph = 0; const fl = R(28, 45);
      for (let i = 0; i < Math.floor(dur * sr); i++) { const t = i / sr; const f = f0 * Math.pow(0.4, t / dur) * (1 + 0.03 * Math.sin(2 * Math.PI * fl * t)); ph += 2 * Math.PI * f / sr; d[i] += Math.sin(ph) * 0.4 * env(t, 0.004, dur / 3.5); }
      break;
    }
  }
  return finish(d, sr, name.startsWith('casing') || name === 'whizz' ? 0.6 : 0.85);
}

// ---------------- analysis helpers (tests / tuning) ----------------
export interface Analysis { peak: number; peakAtMs: number; attackMs: number; durMs40: number; lowFrac: number; centroid: number }
/** Peak, attack (to 90 % of peak), time until the 10 ms RMS envelope stays 40 dB below its max, energy share under 200 Hz, spectral centroid. */
export function analyse(d: Float32Array, sr: number): Analysis {
  let peak = 0, pi = 0; for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > peak) { peak = a; pi = i; } }
  let att = 0; for (let i = 0; i < d.length; i++) if (Math.abs(d[i]) >= 0.9 * peak) { att = i; break; }
  const win = Math.floor(sr * 0.01); const rms: number[] = [];
  for (let i = 0; i + win <= d.length; i += win) { let s = 0; for (let j = 0; j < win; j++) s += d[i + j] * d[i + j]; rms.push(Math.sqrt(s / win)); }
  const mr = Math.max(...rms); let last = 0; for (let i = 0; i < rms.length; i++) if (rms[i] > mr * 0.01) last = i + 1;
  // crude spectrum via a bank of one-pole splits: energy below 200 Hz vs total, and a zero-crossing based centroid
  const lp = new Biquad(sr, 'lp', 200, 0.707); let lo = 0, tot = 0, zc = 0;
  for (let i = 0; i < d.length; i++) { const y = lp.run(d[i]); lo += y * y; tot += d[i] * d[i]; if (i && (d[i] >= 0) !== (d[i - 1] >= 0)) zc++; }
  return { peak, peakAtMs: pi / sr * 1000, attackMs: att / sr * 1000, durMs40: last * 10, lowFrac: tot > 0 ? lo / tot : 0, centroid: zc / 2 / (d.length / sr) };
}
