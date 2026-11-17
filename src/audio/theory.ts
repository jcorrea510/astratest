/** Pure music-theory and small math helpers used by the procedural radio. No Web Audio here (unit-testable). */

export type ScaleName = 'major' | 'minor' | 'dorian' | 'mixolydian';
export const SCALES: Record<ScaleName, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
};

export function midiToFreq(midi: number): number { return 440 * Math.pow(2, (midi - 69) / 12); }

/** Pitch class (0..11) of a midi note. */
export function pitchClass(midi: number): number { return ((Math.round(midi) % 12) + 12) % 12; }

/** Midi note of a (possibly negative or > 6) scale degree. `root` is a midi note (e.g. 57 = A3). */
export function degreeToMidi(root: number, scale: ScaleName, degree: number): number {
  const s = SCALES[scale];
  const oct = Math.floor(degree / s.length);
  const idx = ((degree % s.length) + s.length) % s.length;
  return root + oct * 12 + s[idx];
}

/** Stacked-thirds diatonic chord on `degree` (size 3 = triad, 4 = seventh chord). */
export function chordFromDegree(root: number, scale: ScaleName, degree: number, size = 3): number[] {
  const out: number[] = [];
  for (let i = 0; i < size; i++) out.push(degreeToMidi(root, scale, degree + i * 2));
  return out;
}

export function inScale(midi: number, root: number, scale: ScaleName): boolean {
  const pc = pitchClass(midi - root);
  return SCALES[scale].includes(pc);
}

/** Move every note of a chord into the octave window [lo, lo+12) while keeping order of pitch classes sensible. */
export function voiceInRange(notes: readonly number[], lo: number): number[] {
  return notes.map(n => { let m = n; while (m < lo) m += 12; while (m >= lo + 12) m -= 12; return m; }).sort((a, b) => a - b);
}

/** Deterministic PRNG (mulberry32). Returns floats in [0, 1). */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(r: () => number, arr: readonly T[]): T { return arr[Math.floor(r() * arr.length) % arr.length]; }

export function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }

/** Finite-safe clamp: NaN/Infinity become `fallback`. */
export function safe(v: number, lo: number, hi: number, fallback: number): number { return Number.isFinite(v) ? clamp(v, lo, hi) : fallback; }

export function dbToGain(db: number): number { return Math.pow(10, db / 20); }
export function gainToDb(g: number): number { return 20 * Math.log10(Math.max(1e-12, g)); }
