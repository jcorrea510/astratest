/** Pure spatial-audio math (distance culling, air absorption, echo send, Doppler). Unit-testable. */
import type { Vec3Like } from '../ui/contracts';
import { clamp } from './theory';

/** Positional sounds farther than this from the listener are not started at all. */
export const CULL_DISTANCE = 250;
export const REF_DISTANCE = 6;
export const MAX_DISTANCE = 200;
export const ROLLOFF = 1.1;
export const SPEED_OF_SOUND = 343;

export function distance(a: Vec3Like, b: Vec3Like): number {
  const dx = a.x - b.x, dy = a.y - b.y, dz = a.z - b.z;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  return Number.isFinite(d) ? d : Infinity;
}

export function isFiniteVec(v: Vec3Like | undefined | null): v is Vec3Like {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

export function shouldCull(listener: Vec3Like, pos: Vec3Like, cull = CULL_DISTANCE): boolean {
  return !(distance(listener, pos) <= cull);
}

/** Same curve as the PannerNode 'inverse' model; used for estimates such as voice priority. */
export function inverseGain(d: number, ref = REF_DISTANCE, max = MAX_DISTANCE, rolloff = ROLLOFF): number {
  const dd = clamp(d, ref, max);
  return ref / (ref + rolloff * (dd - ref));
}

/** Low-pass cutoff simulating air absorption: full bandwidth up close, dull far away. */
export function airCutoff(d: number): number {
  const t = clamp(d / MAX_DISTANCE, 0, 1);
  return 18000 * Math.pow(2600 / 18000, Math.sqrt(t));
}

/** Echo/reverb send for a distant sound (gunshots get more slapback the farther they are). */
export function echoSend(d: number, base = 0.18): number {
  return clamp(base + 0.55 * clamp(d / 120, 0, 1), 0, 0.8);
}

/** Doppler pitch ratio for a source moving with radial velocity `vr` (m/s, positive = moving away). */
export function dopplerRatio(vr: number): number {
  const v = clamp(vr, -60, 60);
  return SPEED_OF_SOUND / (SPEED_OF_SOUND + v);
}
