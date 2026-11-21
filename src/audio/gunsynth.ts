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
/**
 * One gun's voice. Energy is deliberately placed where small (laptop / phone) speakers can reproduce it: the blast and
 * the body resonances sit at 150-1200 Hz and are saturated so their harmonics carry the "bang"; the sub thump adds weight
 * on headphones. Without that mid body a synthetic shot reads as a click ("tic-tac").
 */
export interface GunVoice {
  dur: number;
  /** transient: amplitude, decay (s), high-pass (Hz) */ crack: number; crackTau: number; crackHp: number;
  /** supersonic N-wave amplitude (0 = subsonic round) */ sonic: number;
  /** muzzle blast: band-passed noise burst */ blast: number; blastTau: number; blastHz: number; blastQ: number;
  /** body resonances [Hz, amplitude, decay s] (chamber, barrel, the "boom") */ modes: [number, number, number][];
  /** chest thump: pitch-dropping sine */ thump: number; thumpF0: number; thumpF1: number; thumpTau: number;
  /** near-field noise tail with a closing low-pass */ tail: number; tailTau: number; tailHz: number;
  /** transient emphasis: the first few ms are boosted by `pop` (x), decaying with `popTau` s: a sharp, loud pop instead of a wall of noise */ pop?: number; popTau?: number;
  /** rocket motor hiss (launchers) */ hiss?: number;
  drive: number;
}
export type GunSound = 'compact' | 'pistol' | 'heavyPistol' | 'revolver' | 'machinePistol' | 'compactSmg' | 'smg' | 'sawnoff' | 'shotgun' | 'autoShotgun'
  | 'carbine' | 'rifle' | 'battleRifle' | 'marksman' | 'sniper' | 'lmg' | 'launcher' | 'rpg';
/** @deprecated old name */
export type GunName = GunSound;
type M = [number, number, number][];
const V = (o: Partial<GunVoice> & { modes: M }): GunVoice => ({ dur: 0.7, crack: 1, crackTau: 0.0009, crackHp: 2500, sonic: 0, blast: 1, blastTau: 0.009, blastHz: 900, blastQ: 0.6, thump: 0.8, thumpF0: 150, thumpF1: 55, thumpTau: 0.06, tail: 0.3, tailTau: 0.18, tailHz: 2500, drive: 3, ...o });
export const GUNS: Record<GunSound, GunVoice> = {
  compact: V({ dur: 0.6, blastHz: 1200, blastTau: 0.008, modes: [[220, 0.5, 0.035], [410, 0.45, 0.025], [700, 0.3, 0.018]], thump: 0.55, thumpF0: 170, tail: 0.25, tailTau: 0.13, drive: 3.2 }),
  pistol: V({ modes: [[180, 0.6, 0.05], [330, 0.5, 0.035], [560, 0.35, 0.025]] }),
  heavyPistol: V({ dur: 0.8, blastHz: 750, blastTau: 0.011, modes: [[150, 0.7, 0.06], [290, 0.55, 0.04], [480, 0.35, 0.03]], thump: 1, thumpF0: 130, tail: 0.35, tailTau: 0.22, drive: 3.2 }),
  revolver: V({ dur: 1, crack: 1.2, blastHz: 650, blastTau: 0.013, modes: [[120, 0.8, 0.08], [240, 0.6, 0.05], [430, 0.4, 0.04]], thump: 1.15, thumpF0: 125, thumpTau: 0.08, tail: 0.45, tailTau: 0.3, drive: 3.5 }),
  machinePistol: V({ dur: 0.45, blastHz: 1100, blastTau: 0.006, modes: [[240, 0.45, 0.03], [460, 0.4, 0.02]], thump: 0.5, thumpF0: 180, thumpTau: 0.035, tail: 0.2, tailTau: 0.09, drive: 3.2 }),
  compactSmg: V({ dur: 0.5, blastHz: 1000, blastTau: 0.0065, modes: [[210, 0.5, 0.035], [420, 0.4, 0.022]], thump: 0.55, thumpF0: 170, thumpTau: 0.04, tail: 0.22, tailTau: 0.1, drive: 3.2 }),
  smg: V({ dur: 0.55, blastTau: 0.007, modes: [[190, 0.55, 0.04], [380, 0.45, 0.025], [650, 0.3, 0.018]], thump: 0.6, thumpTau: 0.045, tail: 0.24, tailTau: 0.12 }),
  sawnoff: V({ dur: 1.25, crack: 1.3, crackTau: 0.0015, crackHp: 1800, blastTau: 0.02, blastHz: 550, blastQ: 0.5, modes: [[95, 0.9, 0.1], [190, 0.7, 0.07], [340, 0.5, 0.05]], thump: 1.3, thumpF0: 110, thumpF1: 40, thumpTau: 0.1, tail: 0.55, tailTau: 0.38, tailHz: 1800, drive: 4 }),
  shotgun: V({ dur: 1.15, crack: 1.2, crackTau: 0.0014, crackHp: 1800, blastTau: 0.017, blastHz: 600, blastQ: 0.5, modes: [[100, 0.85, 0.09], [200, 0.65, 0.06], [360, 0.45, 0.045]], thump: 1.2, thumpF0: 115, thumpF1: 42, thumpTau: 0.09, tail: 0.5, tailTau: 0.34, tailHz: 2000, drive: 3.8 }),
  autoShotgun: V({ dur: 0.85, crack: 1.1, crackTau: 0.0012, crackHp: 2000, blastTau: 0.013, blastHz: 650, blastQ: 0.5, modes: [[110, 0.8, 0.07], [220, 0.6, 0.05], [380, 0.4, 0.035]], thump: 1.1, thumpF0: 120, thumpTau: 0.07, tail: 0.4, tailTau: 0.22, tailHz: 2200, drive: 3.6 }),
  carbine: V({ dur: 0.75, sonic: 0.8, crack: 1.25, crackTau: 0.0007, crackHp: 3500, blastHz: 1000, modes: [[160, 0.6, 0.05], [320, 0.5, 0.035], [600, 0.35, 0.025]], thump: 0.85, tail: 0.35, tailTau: 0.2, tailHz: 3500, drive: 3.3 }),
  rifle: V({ dur: 0.85, sonic: 0.9, crack: 1.25, crackTau: 0.0007, crackHp: 3200, blastTau: 0.01, modes: [[150, 0.65, 0.055], [300, 0.5, 0.04], [560, 0.35, 0.028]], thump: 0.95, thumpF0: 140, tail: 0.38, tailTau: 0.24, tailHz: 3200, drive: 3.4 }),
  battleRifle: V({ dur: 1, sonic: 1, crack: 1.3, crackTau: 0.0008, crackHp: 3000, blastTau: 0.013, blastHz: 750, modes: [[125, 0.8, 0.07], [260, 0.6, 0.05], [480, 0.4, 0.035]], thump: 1.15, thumpF0: 130, thumpTau: 0.085, tail: 0.45, tailTau: 0.3, tailHz: 3000, drive: 3.6 }),
  marksman: V({ dur: 1.1, sonic: 1, crack: 1.3, crackTau: 0.0008, crackHp: 3000, blastTau: 0.013, blastHz: 720, modes: [[120, 0.8, 0.075], [250, 0.6, 0.05], [470, 0.4, 0.035]], thump: 1.15, thumpF0: 125, thumpTau: 0.09, tail: 0.5, tailTau: 0.35, tailHz: 3000, drive: 3.6 }),
  sniper: V({ dur: 1.5, sonic: 1.2, crack: 1.4, crackTau: 0.0008, crackHp: 3000, blastTau: 0.016, blastHz: 650, modes: [[105, 0.9, 0.09], [220, 0.7, 0.06], [420, 0.45, 0.04]], thump: 1.3, thumpF0: 120, thumpF1: 38, thumpTau: 0.11, tail: 0.6, tailTau: 0.5, tailHz: 2800, drive: 4 }),
  lmg: V({ dur: 0.7, sonic: 0.9, crack: 1.2, crackTau: 0.0008, crackHp: 3000, blastTau: 0.011, blastHz: 820, modes: [[140, 0.7, 0.06], [280, 0.55, 0.04], [520, 0.35, 0.03]], thump: 1, thumpF0: 135, thumpTau: 0.07, tail: 0.3, tailTau: 0.16, tailHz: 3000, drive: 3.5 }),
  launcher: V({ dur: 0.7, crack: 0.3, crackHp: 1500, blast: 0.6, blastTau: 0.02, blastHz: 400, modes: [[90, 0.9, 0.12], [180, 0.6, 0.07], [520, 0.25, 0.03]], thump: 1.3, thumpF0: 140, thumpF1: 50, thumpTau: 0.12, tail: 0.25, tailTau: 0.2, tailHz: 900, drive: 2.5 }),
  rpg: V({ dur: 1.6, crack: 0.8, crackHp: 2000, blast: 1.2, blastTau: 0.03, blastHz: 500, modes: [[80, 0.9, 0.15], [160, 0.7, 0.1], [300, 0.4, 0.06]], thump: 1.4, thumpF0: 110, thumpF1: 40, thumpTau: 0.14, tail: 0.7, tailTau: 0.6, tailHz: 2500, hiss: 0.5, drive: 3.5 }),
};

/** Transient character per weapon: pistols snap, rifles crack, shotguns and snipers thump (less spike, longer body). */
const POP: Record<GunSound, [number, number]> = {
  compact: [1.7, 0.0035], pistol: [1.7, 0.004], heavyPistol: [1.5, 0.0045], revolver: [1.3, 0.006], machinePistol: [1.5, 0.003], compactSmg: [1.5, 0.003], smg: [1.4, 0.0035],
  sawnoff: [0.8, 0.01], shotgun: [0.9, 0.009], autoShotgun: [1, 0.007], carbine: [1.6, 0.003], rifle: [1.7, 0.003], battleRifle: [1.4, 0.004], marksman: [1.4, 0.004],
  sniper: [1.2, 0.006], lmg: [1.4, 0.0035], launcher: [0.4, 0.015], rpg: [0.4, 0.02],
};
for (const g of Object.keys(POP) as GunSound[]) { GUNS[g].pop = POP[g][0]; GUNS[g].popTau = POP[g][1]; }

/**
 * Renders one gunshot variant (mono). `far` renders the distant version: no near crack (except the supersonic snap,
 * which arrives first), a dull low-passed report and a long rolling tail, for shots heard across the city.
 */
export function renderGun(v0: GunVoice, sr: number, r: Rand, far = false): Float32Array {
  const v: GunVoice = { ...v0, blastTau: vary(r, v0.blastTau, 0.12), blastHz: vary(r, v0.blastHz, 0.1), thumpF0: vary(r, v0.thumpF0, 0.06), thumpTau: vary(r, v0.thumpTau, 0.1), tailTau: vary(r, v0.tailTau, 0.12), tailHz: vary(r, v0.tailHz, 0.15),
    modes: v0.modes.map(([f, a, tau]) => [vary(r, f, 0.05), vary(r, a, 0.1), vary(r, tau, 0.1)] as [number, number, number]) };
  const dur = far ? Math.max(1.6, v.dur * 1.8) : v.dur;
  const n = Math.floor(dur * sr); const out = new Float32Array(n);
  const delay = far && v.sonic > 0 ? Math.floor(0.07 * sr) : 0; // the bullet's shock wave beats the muzzle report
  const crackHp = new Biquad(sr, 'hp', v.crackHp, 0.6), crackHp2 = new Biquad(sr, 'hp', v.crackHp * 0.8, 0.6);
  const bp = new Biquad(sr, 'bp', v.blastHz, v.blastQ), blLp = new Biquad(sr, 'lp', v.blastHz * 4, 0.7), blHp = new Biquad(sr, 'hp', 120, 0.7);
  const modes = v.modes.map(([f]) => new Biquad(sr, 'bp', f, 9));
  const tailLp = new Biquad(sr, 'lp', v.tailHz, 0.6), tailLp2 = new Biquad(sr, 'lp', v.tailHz, 0.6), tailHp = new Biquad(sr, 'hp', 70, 0.7);
  const hissBp = new Biquad(sr, 'bp', 3200, 0.8);
  const rumbleLp = new Biquad(sr, 'lp', 500, 0.7), rumbleLp2 = new Biquad(sr, 'lp', 700, 0.7);
  let ph = Math.PI / 2, brown = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    brown = (brown + 0.05 * w) / 1.05;
    let x = 0;
    // supersonic snap (also in the far version, undelayed)
    const ts = i / sr;
    if (v.sonic > 0) { const nw = 0.0004; if (ts < nw) x += v.sonic * (far ? 0.7 : 1) * (1 - 2 * ts / nw); }
    const j = i - delay;
    if (j >= 0) {
      const t = j / sr;
      if (!far) x += crackHp2.run(crackHp.run(w * v.crack * 3 * env(t, 0.00003, v.crackTau)));
      // blast: a fast burst plus a slower "boom" decay
      const b = blLp.run(blHp.run(bp.run(w)));
      x += b * v.blast * 4.2 * (env(t, 0.00015, v.blastTau) + 0.22 * env(t, 0.001, v.blastTau * 4));
      // body resonances (noise-excited, so every shot rings slightly differently)
      for (let k = 0; k < modes.length; k++) { const [, a, tau] = v.modes[k]; x += modes[k].run(w) * a * 16 * env(t, 0.0006, tau); }
      // chest thump
      const f = Math.max(62, v.thumpF1) + (v.thumpF0 - v.thumpF1) * Math.exp(-t / (v.thumpTau * 0.35));
      ph += 2 * Math.PI * f / sr;
      x += Math.sin(ph) * v.thump * 0.32 * env(t, 0.0005, v.thumpTau);
      // tail with a closing low-pass
      if (i % 16 === 0) { const fc = 300 + (v.tailHz - 300) * Math.exp(-t / (v.tailTau * 0.5)); tailLp.set(fc, 0.6); tailLp2.set(fc, 0.6); }
      x += tailHp.run(tailLp2.run(tailLp.run(w))) * v.tail * 1.6 * env(t, 0.002, v.tailTau);
      if (v.hiss) x += hissBp.run(w) * v.hiss * env(t, 0.03, 0.35) * (0.7 + 0.3 * Math.sin(t * 90));
      if (far) {
        // distance: the near layers get dull (handled below), plus a long rolling rumble off the city
        x += rumbleLp2.run(rumbleLp.run(brown * 6)) * (0.5 + 0.5 * Math.sin(t * 7 + 1.3) * Math.sin(t * 2.3)) * v.tail * 2.2 * env(t, 0.04, v.tailTau * 2.5 + 0.4);
      }
    }
    out[i] = x;
  }
  if (far) {
    // air absorption: two-pole low-pass on everything after the snap
    const a1 = new Biquad(sr, 'lp', 1400, 0.6), a2 = new Biquad(sr, 'lp', 1800, 0.6);
    for (let i = delay; i < n; i++) out[i] = a2.run(a1.run(out[i]));
  } else {
    // ground bounce ~4 ms behind the direct sound thickens the report like a real recording at head height
    const g = Math.floor(0.0042 * sr), g2 = Math.floor(0.013 * sr);
    for (let i = n - 1; i >= g2; i--) out[i] += out[i - g] * 0.42 + out[i - g2] * 0.18;
  }
  if (!far && v.pop) {
    // transient shaper: a gunshot is a sharp, loud spike that falls away fast; a dense wall of noise reads as a hiss
    const k = v.pop, tau = v.popTau ?? 0.004;
    for (let i = 0; i < n; i++) out[i] *= 1 + k * Math.exp(-i / sr / tau);
  }
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * v.drive * 0.5) / Math.tanh(v.drive * 0.5);
  return finish(out, sr, 0.95);
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
  | 'hitBody' | 'hitMetal' | 'hitConcrete' | 'hitWood' | 'hitDirt' | 'hitWater' | 'hitGlass' | 'whizz' | 'crackBy' | 'ricochet'
  | 'pinPull' | 'grenadeBounce' | 'glassShatter' | 'cylinderOpen';

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
    case 'pinPull': // ring pin scraping out + spoon flick
      d = mk(0.35); addSwish(d, sr, 0, 0.08, r, { amp: 0.3, f0: 3500, f1: 5000, q: 2 }); addClack(d, sr, 0.08, r, { amp: 0.6, modes: METAL(R(3800, 4400)), click: 0.6 });
      addClack(d, sr, R(0.2, 0.24), r, { amp: 0.8, modes: [{ f: R(2600, 3000), a: 0.5, tau: 0.05 }, { f: R(6100, 6600), a: 0.3, tau: 0.03 }], click: 0.8 }); break;
    case 'grenadeBounce': // heavy steel body knocking on pavement
      d = mk(0.3); addClack(d, sr, 0, r, { amp: 0.9, click: 0.9, clickHp: 1200, modes: [{ f: R(700, 900), a: 0.5, tau: 0.03 }, { f: R(1900, 2300), a: 0.3, tau: 0.02 }] }); addThunk(d, sr, 0, r, { amp: 0.5, f0: 260, f1: 140, tau: 0.03 }); break;
    case 'glassShatter': { // tempered car glass: a crack then a shower of tiny cubes
      d = mk(1.1); addClack(d, sr, 0, r, { amp: 1, click: 1.6, clickHp: 2500, clickTau: 0.002, modes: [{ f: R(2400, 3000), a: 0.4, tau: 0.05 }, { f: R(4800, 5600), a: 0.3, tau: 0.04 }] });
      addSwish(d, sr, 0.005, 0.5, r, { amp: 0.35, f0: 6000, f1: 3500, q: 0.6, attack: 0.05 });
      for (let i = 0; i < 40; i++) addClack(d, sr, Math.pow(r(), 1.7) * 0.9, r, { amp: R(0.05, 0.2), click: 0.6, clickHp: 4500, modes: [{ f: R(3500, 9000), a: 0.4, tau: R(0.01, 0.04) }] });
      break;
    }
    case 'cylinderOpen': // revolver cylinder swings out, ejector rod, spin
      d = mk(0.45); addClack(d, sr, 0, r, { amp: 0.7, modes: METAL(R(2200, 2500)), click: 0.7 }); addSwish(d, sr, 0.05, 0.12, r, { amp: 0.2, f0: 2000, f1: 3000, q: 2 });
      for (let i = 0; i < 6; i++) addClack(d, sr, 0.18 + i * 0.022, r, { amp: 0.25, modes: METAL(R(3000, 3600)), click: 0.3 }); break;
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
