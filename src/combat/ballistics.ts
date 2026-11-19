/** Pure ballistics helpers: bullet drop, time of flight, penetration of thin materials and ricochet geometry. */
import type { WeaponDef } from './weapons';

export type PenSurface = 'concrete' | 'metal' | 'body' | 'water' | 'wood' | 'dirt' | 'glass' | 'vehicle';
const G = 9.81;

/** Muzzle velocity (m/s) for rifles and snipers; 0 = effectively hitscan (pistols, SMGs, shotguns, near range). */
export function muzzleVelocity(w: Pick<WeaponDef, 'cat' | 'id' | 'melee' | 'projectile'>): number {
  if (w.melee || w.projectile !== 'none' || w.cat !== 'rifle') return 0;
  return w.id === 'sniper' ? 880 : w.id === 'marksman' ? 800 : 720;
}
/** Vertical drop (m) of a round after flying `dist` metres; nothing inside 60 m. */
export function bulletDrop(v0: number, dist: number): number {
  if (v0 <= 0 || dist <= 60) return 0;
  const t = dist / v0; return 0.5 * G * t * t;
}
export function flightTime(v0: number, dist: number): number { return v0 > 0 ? dist / v0 : 0; }

/** Stopping power of a round: heavier calibres and armour-piercing rounds punch through more; shotgun pellets barely do. */
export function roundPower(w: Pick<WeaponDef, 'damage' | 'pierce' | 'pellets'>): number {
  return w.damage * (w.pierce ? 1.5 : 1) * (w.pellets > 1 ? 0.25 : 1);
}
export interface Penetration { pass: boolean; mul: number; thickness: number }
const NO: Penetration = { pass: false, mul: 0, thickness: 0 };
/** Whether a round of `power` passes through `surface`, the fraction of damage it keeps, and the wall thickness to skip. Masonry never. */
export function penetration(surface: PenSurface, power: number): Penetration {
  switch (surface) {
    case 'glass': return { pass: true, mul: 0.9, thickness: 0.02 };
    case 'wood': return power >= 20 ? { pass: true, mul: Math.min(0.8, 0.35 + power / 400), thickness: 0.3 } : NO;   // drywall, plywood, fences
    case 'vehicle': return power >= 40 ? { pass: true, mul: Math.min(0.6, 0.15 + power / 300), thickness: 0.05 } : NO; // door / body panel
    default: return NO; // concrete, brick, dirt, heavy metal, bodies, water
  }
}
/** A graze: the round meets the surface at less than ~15 degrees, so it can skip off hard materials. */
export function isShallow(dx: number, dy: number, dz: number, nx: number, ny: number, nz: number): boolean {
  return Math.abs(dx * nx + dy * ny + dz * nz) < 0.26;
}
/** Mirror reflection of direction d about normal n. */
export function reflect(d: { x: number; y: number; z: number }, n: { x: number; y: number; z: number }, out: { x: number; y: number; z: number }) {
  const k = 2 * (d.x * n.x + d.y * n.y + d.z * n.z); out.x = d.x - k * n.x; out.y = d.y - k * n.y; out.z = d.z - k * n.z; return out;
}
