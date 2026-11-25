/**
 * Pure mixer maths (no Web Audio): channel gains, ducking envelope bookkeeping, UI sound recipes.
 * Kept free of nodes so it is unit tested and allocation-free on the audio path.
 */
export const CHANNELS = ['music', 'sfx', 'ambience', 'voice', 'ui'] as const;
export type Channel = (typeof CHANNELS)[number];
export type ChannelVolumes = Record<Channel, number>;
export const defaultChannels = (): ChannelVolumes => ({ music: 1, sfx: 1, ambience: 1, voice: 1, ui: 1 });

const finite = (x: unknown, d: number) => (typeof x === 'number' && Number.isFinite(x) ? x : d);
/** Slider 0..1 to a perceptual (squared) gain. */
export const sliderGain = (v: unknown): number => { const c = Math.min(1, Math.max(0, finite(v, 1))); return c * c; };
export const dbToLin = (db: number): number => Math.pow(10, db / 20);

/** Read per-channel volumes defensively from a settings-like object (fields may not exist yet). */
export function channelsFromSettings(s: unknown): ChannelVolumes {
  const o = (s ?? {}) as Record<string, unknown>;
  return {
    music: finite(o.musicVolume, 1), sfx: finite(o.sfxVolume, 1), ambience: finite(o.ambienceVolume, 1),
    voice: finite(o.voiceVolume, 1), ui: finite(o.uiVolume, 1),
  };
}

export interface BusGains { master: number; music: number; sfx: number; ambience: number; voice: number; ui: number }
/** Combine the legacy master/music/sfx sliders with the channel sliders into node gains (before the fixed trims). */
export function busGains(legacy: { master: number; music: number; sfx: number }, ch: ChannelVolumes): BusGains {
  const sfxLegacy = sliderGain(legacy.sfx);
  return {
    master: sliderGain(legacy.master),
    music: sliderGain(legacy.music) * sliderGain(ch.music),
    sfx: sfxLegacy * sliderGain(ch.sfx),
    ambience: sfxLegacy * sliderGain(ch.ambience),
    voice: sfxLegacy * sliderGain(ch.voice),
    ui: sfxLegacy * sliderGain(ch.ui),
  };
}

// ---------------- ducking ----------------
export const DUCK_GUN_DB = -4, DUCK_BLAST_DB = -6, DUCK_HOLD = 0.35, DUCK_ATTACK_TC = 0.015, DUCK_RELEASE_TC = 0.4;
/** Duck depth in dB for a sound (0 = none): explosions / heavy crashes -6, gunshots -4. */
export function duckDepthDb(key: string, priority: number, env: number): number {
  if (key === 'explosion' || key === 'crashHeavy') return DUCK_BLAST_DB;
  if (key.startsWith('gun_') || key.startsWith('gunFar_') || (env >= 0.8 && priority >= 6)) return DUCK_GUN_DB;
  return 0;
}
/** Tracks the current duck so repeated shots do not respam automation: only deeper or expired ducks re-trigger. */
export class DuckState {
  private until = -1; private depth = 0;
  /** Returns the linear gain to duck to when automation must be (re)scheduled, else 0. */
  hit(now: number, depthDb: number): number {
    if (depthDb >= 0) return 0;
    if (now < this.until && depthDb >= this.depth - 1e-6) { this.until = Math.max(this.until, now + DUCK_HOLD); return 0; }
    this.depth = depthDb; this.until = now + DUCK_HOLD; return dbToLin(depthDb);
  }
}

// ---------------- UI sounds ----------------
export type UiSoundName = 'hover' | 'select' | 'back' | 'purchase' | 'error' | 'notification';
export interface UiNote { f: number; f2?: number; at: number; dec: number; peak: number; type: OscillatorType }
export const UI_SOUNDS: Record<UiSoundName, { notes: UiNote[]; minInterval: number }> = {
  hover: { minInterval: 0.05, notes: [{ f: 1760, at: 0, dec: 0.035, peak: 0.05, type: 'sine' }] },
  select: { minInterval: 0.05, notes: [{ f: 880, at: 0, dec: 0.07, peak: 0.12, type: 'triangle' }, { f: 1320, at: 0.045, dec: 0.1, peak: 0.1, type: 'sine' }] },
  back: { minInterval: 0.05, notes: [{ f: 990, f2: 660, at: 0, dec: 0.1, peak: 0.1, type: 'triangle' }] },
  purchase: { minInterval: 0.1, notes: [{ f: 1046, at: 0, dec: 0.08, peak: 0.1, type: 'sine' }, { f: 1568, at: 0.07, dec: 0.12, peak: 0.1, type: 'sine' }, { f: 2093, at: 0.14, dec: 0.22, peak: 0.07, type: 'sine' }] },
  error: { minInterval: 0.15, notes: [{ f: 196, f2: 150, at: 0, dec: 0.16, peak: 0.1, type: 'square' }, { f: 185, f2: 140, at: 0.11, dec: 0.18, peak: 0.08, type: 'square' }] },
  notification: { minInterval: 0.2, notes: [{ f: 1175, at: 0, dec: 0.09, peak: 0.09, type: 'sine' }, { f: 1568, at: 0.1, dec: 0.18, peak: 0.09, type: 'sine' }] },
};
export const isUiSound = (n: unknown): n is UiSoundName => typeof n === 'string' && Object.hasOwn(UI_SOUNDS, n);
