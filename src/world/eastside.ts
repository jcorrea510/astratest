/**
 * Eastbank: the low-rise shore across the East River. Pure layout (no rendering): brick rowhouses and midrises in the
 * west half, corrugated warehouses toward the east and south, a green in the middle and piers along the river bank.
 * Streets come from the shared path network (see buildExpansion in citymap.ts); this only places lots.
 */
import type { Rng } from '../core/rng';
import type { Lot, LotKind, PathRoad } from './citymap';
import { EAST_SHORE } from './citymap';
import { distToPath } from './westside';

/** Eastbank Green (no lots inside). */
export const EAST_PARK = { x0: 790, x1: 900, z0: 272, z1: 378, name: 'Eastbank Green' };
/** Riverside park on the esplanade (no lots inside). */
export const EAST_RIVERPARK = { x0: 698, x1: 736, z0: 300, z1: 372, name: 'Brookhaven Landing' };
/** Piers into the river (z of each; they start at the bank and run west). */
export const EAST_PIERS = [-10, 170, 250, 550, 700, 850];

const industrial = (x: number, z: number) => x > 880 || z > 640;

export function genEastLots(paths: PathRoad[], startId: number, rng: Rng, sidewalk: number): Lot[] {
  const roads = paths.filter(p => p.pts.some(q => q.x > EAST_SHORE.x0 - 40 && q.z > EAST_SHORE.z0 - 120) && p.kind !== 'hill' && p.kind !== 'ramp');
  const streets = roads.filter(p => p.kind === 'street');
  const out: Lot[] = [];
  const placed: { x: number; z: number; r: number }[] = [];
  const X0 = 700, X1 = EAST_SHORE.x1 - 8, Z0 = EAST_SHORE.z0 + 26, Z1 = EAST_SHORE.z1 - 14;
  const ok = (x: number, z: number, rad: number, own: PathRoad | null, depth = 0) => {
    if (x < X0 || x > X1 || z < Z0 || z > Z1) return false;
    if (x > EAST_RIVERPARK.x0 - rad && x < EAST_RIVERPARK.x1 + rad && z > EAST_RIVERPARK.z0 - rad && z < EAST_RIVERPARK.z1 + rad) return false;
    if (x > EAST_PARK.x0 - rad && x < EAST_PARK.x1 + rad && z > EAST_PARK.z0 - rad && z < EAST_PARK.z1 + rad) return false;
    for (const pp of roads) { const dd = distToPath(pp, x, z); if (dd < pp.half + sidewalk + (pp === own ? depth * 0.5 * 0.85 : rad * 1.1) + 0.5) return false; }
    for (const o of placed) if (Math.hypot(x - o.x, z - o.z) < o.r + rad) return false;
    return true;
  };
  const make = (x: number, z: number, rot: number, w: number, d: number, kind: LotKind, height: number, street: boolean) => {
    out.push({ id: startId + out.length, blockId: -1, district: 'eastbank', street, x, z, w, d, rot, kind, height, seed: rng.int(0, 1e9) });
    placed.push({ x, z, r: Math.hypot(w, d) / 2 * 0.92 });
  };
  const pick = (x: number, z: number): { kind: LotKind; w: number; d: number; height: number } => {
    if (industrial(x, z)) return { kind: 'warehouse', w: rng.range(20, 32), d: rng.range(18, 28), height: rng.range(8.5, 12) };
    const t = rng.next();
    if (t < 0.6) return { kind: 'brownstone', w: rng.range(8.5, 12), d: rng.range(10, 13), height: rng.range(9, 16) };
    return { kind: 'midrise', w: rng.range(13, 19), d: rng.range(11, 15), height: rng.range(13, 22) };
  };
  // waterfront row: lofts, warehouses and midrises standing behind the esplanade, fronts to the river
  for (let z = Z0 + 4; z < Z1 - 12;) {
    const ind = industrial(710, z);
    const spec = ind || rng.chance(0.5) ? { kind: 'warehouse' as LotKind, w: rng.range(20, 30), d: rng.range(15, 21), height: rng.range(8.5, 13) } : { kind: 'midrise' as LotKind, w: rng.range(16, 24), d: rng.range(13, 17), height: rng.range(16, 30) };
    const x = 699.5 + spec.d / 2, zc = z + spec.w / 2;
    const rad = Math.hypot(spec.w, spec.d) / 2 * 0.92;
    z += spec.w + rng.range(2, 5);
    if (EAST_PIERS.some(pz => Math.abs(pz - zc) < spec.w / 2 + 8)) continue;
    if (!ok(x, zc, rad, null) || !ok(x, zc - spec.w * 0.4, 2, null) || !ok(x, zc + spec.w * 0.4, 2, null)) continue;
    make(x, zc, -Math.PI / 2, spec.w, spec.d, spec.kind, spec.height, false);
  }
  // frontage rows along the streets
  for (const pp of streets) {
    let acc = 0;
    for (let i = 1; i < pp.pts.length; i++) {
      const a = pp.pts[i - 1], b = pp.pts[i], seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 0.01) continue;
      acc += seg;
      if (acc < (industrial(b.x, b.z) ? 22 : 11.5)) continue;
      acc = 0;
      const tx = (b.x - a.x) / seg, tz = (b.z - a.z) / seg, nx = -tz, nz = tx;
      for (const side of [-1, 1]) {
        const spec = pick(b.x + nx * side * 12, b.z + nz * side * 12);
        const off = pp.half + sidewalk + spec.d / 2;
        const x = b.x + nx * side * off, z = b.z + nz * side * off;
        if (!ok(x, z, Math.hypot(spec.w, spec.d) / 2 * 0.92, pp, spec.d)) continue;
        if (rng.chance(0.06)) continue; // alley / yard
        make(x, z, Math.atan2(-nx * side, -nz * side), spec.w, spec.d, spec.kind, spec.height, true);
      }
    }
  }
  // infill behind the frontage, facing the nearest street
  for (let gx = X0 + 8; gx < X1; gx += 22) for (let gz = Z0 + 6; gz < Z1; gz += 22) {
    const x = gx + rng.range(-4, 4), z = gz + rng.range(-4, 4);
    const spec = pick(x, z);
    const rad = Math.hypot(spec.w, spec.d) / 2 * 0.92;
    if (!ok(x, z, rad, null)) continue;
    let best: PathRoad | null = null, bd = Infinity;
    for (const pp of streets) { const dd = distToPath(pp, x, z); if (dd < bd) { bd = dd; best = pp; } }
    if (!best || bd > 70) continue;
    let cx = 0, cz = 0, cd = Infinity;
    for (let i = 1; i < best.pts.length; i++) {
      const a = best.pts[i - 1], b = best.pts[i], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2)); const px = a.x + vx * t, pz = a.z + vz * t, dd = Math.hypot(x - px, z - pz);
      if (dd < cd) { cd = dd; cx = px; cz = pz; }
    }
    make(x, z, Math.atan2(cx - x, cz - z), spec.w, spec.d, spec.kind, spec.height, false);
  }
  return out;
}
