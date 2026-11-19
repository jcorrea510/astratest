/** Pure placement of mast-arm traffic signals: one per approach, post on the far-right corner (sidewalk), arm over the lanes. */
import { type CityMap, LANE_WIDTH, surfaceAt } from './citymap';

const clear = (city: CityMap, x: number, z: number) => [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5]].every(([ox, oz]) => surfaceAt(city, x + ox, z + oz) !== 'road');

export interface SignalPost { inter: number; axis: 'x' | 'z'; x: number; z: number; yaw: number; arm: number; /** travel direction of the controlled approach */ dx: number; dz: number }

/** Distance beyond the cross street's kerb / the road's kerb where the post stands (on the sidewalk). */
export const POST_SETBACK_ALONG = 1.8;
export const POST_SETBACK_ACROSS = 1.2;

export function signalPosts(city: CityMap): SignalPost[] {
  const out: SignalPost[] = [];
  for (const inter of city.intersections) {
    if (!inter.signalized) continue;
    const approaches: { axis: 'x' | 'z'; dx: number; dz: number }[] = [{ axis: 'z', dx: 0, dz: -1 }, { axis: 'z', dx: 0, dz: 1 }, { axis: 'x', dx: 1, dz: 0 }, { axis: 'x', dx: -1, dz: 0 }];
    for (const ap of approaches) {
      const exists = ap.axis === 'z' ? city.intersectionAt(inter.ix, inter.iz - ap.dz) : city.intersectionAt(inter.ix - ap.dx, inter.iz);
      if (!exists) continue;
      const rx = -ap.dz, rz = ap.dx;
      const along = ap.axis === 'z' ? inter.halfZ : inter.halfX;
      const across = ap.axis === 'z' ? inter.halfX : inter.halfZ;
      // far side of the junction, right-hand kerb: head hangs over the approach lanes facing back at traffic
      // Broadway cuts diagonally through a few junctions: fall back to the near-side corner, else skip the approach
      let x = 0, z = 0, ok = false;
      for (const side of [1, -1]) {
        x = inter.x + side * ap.dx * (along + POST_SETBACK_ALONG) + rx * (across + POST_SETBACK_ACROSS);
        z = inter.z + side * ap.dz * (along + POST_SETBACK_ALONG) + rz * (across + POST_SETBACK_ACROSS);
        if (clear(city, x, z)) { ok = true; break; }
      }
      if (!ok) continue;
      const yaw = Math.atan2(-ap.dx, -ap.dz);
      const arm = Math.round(Math.min(9, across + POST_SETBACK_ACROSS - LANE_WIDTH * 0.4));
      out.push({ inter: inter.id, axis: ap.axis, x, z, yaw, arm, dx: ap.dx, dz: ap.dz });
    }
  }
  return out;
}
