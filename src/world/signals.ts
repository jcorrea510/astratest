/** Pure placement of mast-arm traffic signals: one per approach, post on the far-right corner (sidewalk), arm over the lanes. */
import { type CityMap, type SigAxis, LANE_WIDTH, surfaceAt } from './citymap';
import { BROADWAY } from './broadway';

const clear = (city: CityMap, x: number, z: number) => [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].every(([ox, oz]) => surfaceAt(city, x + ox, z + oz) !== 'road');

export interface SignalPost { inter: number; axis: SigAxis; x: number; z: number; yaw: number; arm: number; /** travel direction of the controlled approach */ dx: number; dz: number }

/** Distance beyond the cross street's kerb / the road's kerb where the post stands (on the sidewalk). */
export const POST_SETBACK_ALONG = 1.8;
export const POST_SETBACK_ACROSS = 1.2;

export function signalPosts(city: CityMap): SignalPost[] {
  const out: SignalPost[] = [];
  for (const inter of city.intersections) {
    if (!inter.signalized) continue;
    let approaches: { axis: SigAxis; dx: number; dz: number }[];
    if (inter.ix >= 0) {
      const all: { axis: 'x' | 'z'; dx: number; dz: number }[] = [{ axis: 'z', dx: 0, dz: -1 }, { axis: 'z', dx: 0, dz: 1 }, { axis: 'x', dx: 1, dz: 0 }, { axis: 'x', dx: -1, dz: 0 }];
      approaches = all.filter(ap => !!(ap.axis === 'z' ? city.intersectionAt(inter.ix, inter.iz - ap.dz) : city.intersectionAt(inter.ix - ap.dx, inter.iz)));
      // Round 9: Broadway's diagonal approaches get their own heads (and phase)
      if (inter.diag) for (const l of city.lanes) if (l.diag && l.intersection === inter.id) {
        const e = l.points[l.points.length - 1], q = l.points[l.points.length - 2], d = Math.hypot(e.x - q.x, e.z - q.z) || 1;
        approaches.push({ axis: 'd', dx: (e.x - q.x) / d, dz: (e.z - q.z) / d });
      }
    } else {
      // free-form junctions (Eastbank): an approach exists wherever a path ends here; its travel direction is the last segment toward the junction
      approaches = [];
      for (const p of city.paths) {
        if (p.kind === 'ramp' || p.kind === 'hill') continue;
        const end = p.to === inter.id, start = p.from === inter.id; if (!end && !start) continue;
        const a = end ? p.pts[p.pts.length - 2] : p.pts[1], b = end ? p.pts[p.pts.length - 1] : p.pts[0];
        const dx = Math.sign(Math.round(b.x - a.x)), dz = Math.sign(Math.round(b.z - a.z));
        if ((dx === 0) === (dz === 0)) continue;
        if (!approaches.some(q => q.dx === dx && q.dz === dz)) approaches.push({ axis: dx !== 0 ? 'x' : 'z', dx, dz });
      }
    }
    for (const ap of approaches) {
      const rx = -ap.dz, rz = ap.dx;
      const along = ap.axis === 'd' ? 11.5 : ap.axis === 'z' ? inter.halfZ : inter.halfX;
      const across = ap.axis === 'd' ? BROADWAY.half : ap.axis === 'z' ? inter.halfX : inter.halfZ;
      // far side of the junction, right-hand kerb: head hangs over the approach lanes facing back at traffic
      // Broadway cuts diagonally through a few junctions: fall back to the near-side corner, else skip the approach
      let x = 0, z = 0, ok = false;
      const extra = ap.axis === 'd' ? [0, 2, 4, 6, -3] : [0];
      for (const side of [1, -1]) for (const ex of extra) {
        if (ok) break;
        x = inter.x + side * ap.dx * (along + POST_SETBACK_ALONG + ex) + rx * (across + POST_SETBACK_ACROSS);
        z = inter.z + side * ap.dz * (along + POST_SETBACK_ALONG + ex) + rz * (across + POST_SETBACK_ACROSS);
        if (clear(city, x, z)) ok = true;
      }
      if (!ok) continue;
      const yaw = Math.atan2(-ap.dx, -ap.dz);
      const arm = Math.round(Math.min(9, across + POST_SETBACK_ACROSS - LANE_WIDTH * 0.4));
      out.push({ inter: inter.id, axis: ap.axis, x, z, yaw, arm, dx: ap.dx, dz: ap.dz });
    }
  }
  return out;
}
