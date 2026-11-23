/**
 * Recorded gunshots (CC0 field recordings, see CREDITS.md / docs/ASSETS.md) for every gun voice in gunsynth.ts.
 * Files live in public/assets/audio/guns/*.mp3 (mono, ~80 kbps; mp3 decodes everywhere incl. Safari and headless Chromium).
 * All of them are fetched and decoded once when the audio context starts (no decode while playing); `gunSampleBuf`
 * returns null until a set is loaded and sfx.ts then keeps using the synthesised shot as a fallback.
 * Voice limiting (cap + steal for SMG / minigun spam, NPC gunfire included) is the shared VoicePool in core.ts.
 */
import type { Kit } from './dsp';
import type { GunSound } from './gunsynth';

/** One playable set: take files, playback-rate multiplier (class character) and gain trim. */
export interface GunSet { files: readonly string[]; rate: number; gain: number }
export interface GunSetPair { near: GunSet; far: GunSet }

const n = (base: string, count: number): string[] => Array.from({ length: count }, (_, i) => `${base}_${i + 1}`);
const PISTOL = n('pistol', 4), MAGNUM = n('magnum', 3), SMG = n('smg', 7), AR = n('ar', 5), AK = n('ak', 5), SHOTGUN = n('shotgun', 4), DB = n('dbshotgun', 3);
const SNIPER = [...n('sniper', 3), 'heavy_1'], FAR = n('far', 6), ROCKET = ['rocket_1'];
const S = (files: readonly string[], rate: number, gain: number): GunSet => ({ files, rate, gain });
/** Distant report (recorded at range): the same take pool for everything, re-pitched to suit the class. */
const far = (rate: number, gain = 1): GunSet => S(FAR, rate, gain);

export const GUN_SETS: Record<GunSound, GunSetPair> = {
  compact: { near: S(PISTOL, 1.14, 0.85), far: far(1.12) },
  pistol: { near: S(PISTOL, 1, 1), far: far(1.08) },
  heavyPistol: { near: S(MAGNUM, 1.08, 1), far: far(1) },
  revolver: { near: S(MAGNUM, 0.95, 1.1), far: far(0.95) },
  machinePistol: { near: S(SMG, 1.12, 0.85), far: far(1.1) },
  compactSmg: { near: S(SMG, 1.06, 0.9), far: far(1.06) },
  smg: { near: S(SMG, 1, 1), far: far(1.02) },
  sawnoff: { near: S(DB, 1, 1.1), far: far(0.88) },
  shotgun: { near: S(SHOTGUN, 1, 1), far: far(0.9) },
  autoShotgun: { near: S(SHOTGUN, 1.1, 0.95), far: far(0.94) },
  carbine: { near: S(AR, 1.05, 0.95), far: far(1) },
  rifle: { near: S(AK, 1, 1), far: far(0.97) },
  battleRifle: { near: S(AK, 0.88, 1.05), far: far(0.9) },
  marksman: { near: S(SNIPER, 1.12, 0.9), far: far(0.9) },
  sniper: { near: S(SNIPER, 1, 1.05), far: far(0.82, 1.1) },
  lmg: { near: S(AR, 0.9, 1), far: far(0.92) },
  launcher: { near: S(ROCKET, 1, 1), far: far(0.8) },
  rpg: { near: S(ROCKET, 0.85, 1.05), far: far(0.78, 1.1) },
};

/** Every distinct file name (without extension) the sets use. */
export const GUN_SAMPLE_NAMES: readonly string[] = [...new Set(Object.values(GUN_SETS).flatMap(p => [...p.near.files, ...p.far.files]))].sort();
export const GUN_SAMPLE_DIR = 'assets/audio/guns/';

/** Fetches every sample file (compressed bytes); failures just leave that file out (the synth covers missing sets). */
export async function fetchGunSampleBytes(baseUrl: string): Promise<Record<string, ArrayBuffer>> {
  const out: Record<string, ArrayBuffer> = {};
  await Promise.all(GUN_SAMPLE_NAMES.map(async name => {
    try { const r = await fetch(baseUrl + GUN_SAMPLE_DIR + name + '.mp3'); if (r.ok) out[name] = await r.arrayBuffer(); } catch { /* offline: synth fallback */ }
  }));
  return out;
}

interface Loaded { bufs: Map<string, AudioBuffer>; last: Map<string, number>; played: number }
const LOADED = new WeakMap<Kit, Loaded>();
const loadedFor = (k: Kit): Loaded => { let l = LOADED.get(k); if (!l) { l = { bufs: new Map(), last: new Map(), played: 0 }; LOADED.set(k, l); } return l; };

/** Registers one decoded take for a kit. */
export function registerGunSample(k: Kit, name: string, b: AudioBuffer): void { loadedFor(k).bufs.set(name, b); }
/** Number of decoded takes for this kit. */
export function gunSampleCount(k: Kit): number { return LOADED.get(k)?.bufs.size ?? 0; }
/** How many shots played a recorded take (diagnostics / tests). */
export function gunSamplesPlayed(k: Kit): number { return LOADED.get(k)?.played ?? 0; }

/** Decodes all fetched takes into the kit (callback form: works in old Safari, never rejects). Resolves with the number decoded. */
export function decodeGunSamples(ctx: BaseAudioContext, k: Kit, bytes: Record<string, ArrayBuffer>): Promise<number> {
  let ok = 0;
  return Promise.all(Object.entries(bytes).map(([name, ab]) => new Promise<void>(res => {
    try {
      const pr = ctx.decodeAudioData(ab.slice(0), b => { registerGunSample(k, name, b); ok++; res(); }, () => res());
      if (pr && typeof pr.catch === 'function') pr.catch(() => res());
    } catch { res(); }
  }))).then(() => ok);
}

/** A round-robin pick (never the same take twice in a row) for gun `g`, or null when none of its takes are decoded. */
export function gunSampleBuf(k: Kit, g: GunSound, far: boolean): { buf: AudioBuffer; rate: number; gain: number } | null {
  const l = LOADED.get(k); if (!l || !l.bufs.size) return null;
  const set = far ? GUN_SETS[g].far : GUN_SETS[g].near;
  const have = set.files.filter(f => l.bufs.has(f)); if (!have.length) return null;
  const key = (far ? 'F' : 'N') + g;
  let i = Math.floor(k.rand() * have.length); const last = l.last.get(key);
  if (have.length > 1 && i === last) i = (i + 1 + Math.floor(k.rand() * (have.length - 1))) % have.length;
  l.last.set(key, i); l.played++;
  return { buf: l.bufs.get(have[i])!, rate: set.rate, gain: set.gain };
}
