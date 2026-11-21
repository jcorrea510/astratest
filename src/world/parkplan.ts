/** Park layout: the Juniper Park lake (real water in a stone kerb) and everything around it that must stay off the water. Pure (unit tested). */
import type { Rng } from '../core/rng';
import type { Block } from './citymap';
import { SIDEWALK } from './citymap';

/** The three overlapping pools of the lake, relative to the park centre: [dx, dz, radius]. */
export const LAKE_POOLS: readonly (readonly [number, number, number])[] = [[0, 0, 24], [16, 12, 15], [-17, -9, 14]];
export const isLakeBlock = (b: Pick<Block, 'ix' | 'iz' | 'kind'>) => b.kind === 'park' && b.ix === 4 && b.iz === 1;

export interface ParkPlan {
  cx: number; cz: number; lake: boolean;
  benches: { x: number; z: number }[]; lights: { x: number; z: number }[]; shrubs: { x: number; z: number; k: number; yaw: number; s: number }[];
  /** Path pieces as [from, to] along their axis: the east-west path at z = cz, the north-south path at x = cx. */
  pathsX: [number, number][]; pathsZ: [number, number][];
}
/** True when (x,z) is on or within `pad` metres of the lake water. */
export function onLake(cx: number, cz: number, x: number, z: number, pad = 0): boolean {
  return LAKE_POOLS.some(([dx, dz, r]) => Math.hypot(x - (cx + dx), z - (cz + dz)) < r + pad);
}
/** Splits [lo,hi] along one axis into the stretches that stay `pad` metres clear of the water. */
export function dryStretches(lo: number, hi: number, at: (t: number) => boolean, step = 0.5): [number, number][] {
  const out: [number, number][] = []; let start: number | null = null;
  for (let t = lo; t <= hi + 1e-6; t += step) {
    const wet = at(t);
    if (!wet && start === null) start = t;
    if (wet && start !== null) { if (t - step - start > 1) out.push([start, t - step]); start = null; }
  }
  if (start !== null && hi - start > 1) out.push([start, hi]);
  return out;
}
/** Benches, lamps, shrubs and paths for a park block; with a lake none of them lands on (or touching) the water. */
export function planPark(b: Block, r: Rng): ParkPlan {
  const ix0 = b.x0 + SIDEWALK, ix1 = b.x1 - SIDEWALK, iz0 = b.z0 + SIDEWALK, iz1 = b.z1 - SIDEWALK, cx = (ix0 + ix1) / 2, cz = (iz0 + iz1) / 2, lake = isLakeBlock(b);
  const wet = (x: number, z: number, pad: number) => lake && onLake(cx, cz, x, z, pad);
  const benches: ParkPlan['benches'] = [], lights: ParkPlan['lights'] = [], shrubs: ParkPlan['shrubs'] = [];
  for (let i = 0; i < 10; i++) { const x = r.range(ix0 + 4, ix1 - 4); if (!wet(x, cz + 3.6, 3)) benches.push({ x, z: cz + 3.6 }); }
  if (lake) { // a ring of benches facing the water along its northern and southern shore
    for (const [dx, dz, rad, a] of [[0, 0, 24, -Math.PI / 2 - 0.5], [0, 0, 24, -Math.PI / 2 + 0.5], [0, 0, 24, Math.PI / 2 + 0.7], [-17, -9, 14, Math.PI * 1.1]] as const) {
      const x = cx + dx + Math.cos(a) * (rad + 3.2), z = cz + dz + Math.sin(a) * (rad + 3.2);
      if (!wet(x, z, 2.5) && Math.abs(x - cx) > 3 && Math.abs(z - cz) > 3) benches.push({ x, z });
    }
  }
  for (let i = 0; i < 26; i++) {
    const x = r.range(ix0 + 2, ix1 - 2), z = r.range(iz0 + 2, iz1 - 2), k = r.int(0, 1), yaw = r.range(0, 6), s = r.range(0.8, 1.5);
    if (!wet(x, z, 1.5)) shrubs.push({ x, z, k, yaw, s });
  }
  for (let i = 0; i < 8; i++) { const x = ix0 + (ix1 - ix0) * (i + 0.5) / 8, z = cz - 2.8; if (!wet(x, z, 2)) lights.push({ x, z }); }
  const pathsX = lake ? dryStretches(ix0, ix1, x => onLake(cx, cz, x, cz, 2.6)) : [[ix0, ix1] as [number, number]];
  const pathsZ = lake ? dryStretches(iz0, iz1, z => onLake(cx, cz, cx, z, 2.6)) : [[iz0, iz1] as [number, number]];
  return { cx, cz, lake, benches, lights, shrubs, pathsX, pathsZ };
}
