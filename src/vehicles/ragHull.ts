/** Hood / cabin shaped convex hulls (body space) that ragdolls collide with; the plain box hull of a car is too tall at the nose. */
import type { CarShape } from './shapes';
import { GROUND, bodyEnds } from './shapes';
import type { VehicleLayout } from './vehiclePhysics';

function deckY(s: CarShape, z: number): number {
  const t = s.top;
  if (z <= t[0][0]) return t[0][1];
  for (let i = 1; i < t.length; i++) if (z <= t[i][0]) { const a = t[i - 1], b = t[i], k = (z - a[0]) / (b[0] - a[0] || 1); return a[1] + (b[1] - a[1]) * k; }
  return t[t.length - 1][1];
}
const cache = new Map<string, Float32Array[]>();
export function ragHulls(key: string, s: CarShape, layout: VehicleLayout): Float32Array[] {
  const hit = cache.get(key); if (hit) return hit;
  const out: Float32Array[] = [];
  const hw = layout.half[0];
  const bottom = layout.centerY - layout.half[1];
  const top = layout.centerY + layout.half[1];
  const box = (): Float32Array => {
    const zc = layout.zCenter ?? 0, hz = layout.half[2], pts: number[] = [];
    for (const sx of [-1, 1]) for (const y of [bottom, top]) for (const sz of [-1, 1]) pts.push(sx * hw, y, zc + sz * hz);
    return new Float32Array(pts);
  };
  if (!s.gh || s.type === 'tank' || s.type === 'boxvan' || s.type === 'truck') { out.push(box()); }
  else {
    const [zr, zf] = bodyEnds(s);
    const pts: number[] = [];
    const zs = new Set<number>([zr, zf]); for (const [z] of s.top) if (z > zr && z < zf) zs.add(z);
    for (const z of zs) { const y = GROUND + deckY(s, z) * 0.97; for (const sx of [-1, 1]) { pts.push(sx * hw * 0.97, y, z, sx * hw * 0.97, bottom, z); } }
    if (s.cargo) { const c = s.cargo; for (const sx of [-1, 1]) for (const z of [c.z0, c.z1]) pts.push(sx * c.hw, GROUND + c.y1, z, sx * c.hw, GROUND + c.y0, z); }
    out.push(new Float32Array(pts));
    const g = s.gh, ya = GROUND + deckY(s, g.zA) * 0.97, yc = GROUND + deckY(s, g.zC) * 0.97, roof = GROUND + g.roof * 0.97;
    const cab: number[] = [];
    for (const sx of [-1, 1]) {
      cab.push(sx * hw * 0.85, ya - 0.1, g.zA, sx * hw * 0.85, yc - 0.1, g.zC, sx * g.roofW, roof, g.zR1, sx * g.roofW, roof, g.zR2);
      cab.push(sx * hw * 0.85, ya, g.zA, sx * hw * 0.85, yc, g.zC);
    }
    out.push(new Float32Array(cab));
  }
  cache.set(key, out);
  return out;
}
