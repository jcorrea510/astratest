/**
 * Highway layout as pure functions of arclength `s` (metres along the median centre line).
 * The road is infinite: the centre line is integrated lazily from a smooth curvature function and kept in a growing table.
 * Lateral coordinate `u` is measured to the RIGHT of the direction of travel of the player's carriageway (+s):
 *   u > 0  the player's carriageway (traffic flows +s), u < 0 the oncoming carriageway (flows -s).
 * Lane k (0 = next to the median / fast lane .. NL-1 = right lane) has its centre at +-laneU(k).
 */
export const NL = 4; // lanes per direction
export const LANE_W = 3.65;
export const MEDIAN_HALF = 0.45; // jersey barrier half width
export const INNER = 1.8; // u of the first lane edge
export const OUTER = INNER + NL * LANE_W; // 16.4: right edge of the last lane
export const SHOULDER = OUTER + 3.2; // 19.6: edge of the paved breakdown lane
export const RAIL_U = SHOULDER + 0.7; // guardrail line
export const STEP = 4;

export const laneU = (k: number): number => INNER + (k + 0.5) * LANE_W;

const X: number[] = [0], Z: number[] = [0], TH: number[] = [0];
const sm = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Signed curvature (1/m): gentle sweepers with straights between them; the first 300 m are straight. */
export function curvature(s: number): number {
  const gate = sm(-0.15, 0.55, Math.sin(s / 1370 + 0.8)) * sm(300, 900, s);
  return gate * (0.00085 * Math.sin(s / 310 + 1.1) + 0.00055 * Math.sin(s / 137 + 0.3) + 0.0006 * Math.sin(s / 673));
}
/** Road surface height. Rolling hills, grades stay under ~3.5%. */
export function heightAt(s: number): number {
  return 4.2 * Math.sin(s / 540 + 0.6) + 2.4 * Math.sin(s / 233 + 2.0) + 0.9 * Math.sin(s / 150 + 0.5) - 4.2 * Math.sin(0.6) - 2.4 * Math.sin(2.0) - 0.9 * Math.sin(0.5);
}
function ensure(i: number) {
  while (X.length <= i) {
    const k = X.length - 1, sMid = (k + 0.5) * STEP;
    const th = TH[k] + curvature(sMid) * STEP * 0.5;
    X.push(X[k] + Math.sin(th) * STEP); Z.push(Z[k] - Math.cos(th) * STEP); TH.push(TH[k] + curvature(sMid) * STEP);
  }
}
export interface RoadPoint { x: number; y: number; z: number; theta: number; slope: number }
export function roadAt(s: number, out: RoadPoint = { x: 0, y: 0, z: 0, theta: 0, slope: 0 }): RoadPoint {
  const f = Math.max(0, s) / STEP, i = Math.floor(f), t = f - i;
  ensure(i + 2);
  out.theta = TH[i] + (TH[i + 1] - TH[i]) * t;
  out.x = X[i] + (X[i + 1] - X[i]) * t; out.z = Z[i] + (Z[i + 1] - Z[i]) * t;
  out.y = heightAt(s);
  out.slope = (heightAt(s + 1) - heightAt(s - 1)) / 2;
  return out;
}
/** World position of road coordinates (s, u) and the surface height there (flat cross section). */
export function worldAt(s: number, u: number, out: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }) {
  const p = roadAt(s);
  out.x = p.x + Math.cos(p.theta) * u; out.z = p.z + Math.sin(p.theta) * u; out.y = p.y;
  return out;
}

/** Deterministic hash in [0,1) for chunk-level decisions (sound walls, gantries, overpasses...). */
export function hash(n: number, salt = 0): number {
  let x = (Math.imul(n | 0, 0x27d4eb2d) ^ Math.imul(salt + 0x165667b1, 0x9e3779b1)) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x85ebca6b) >>> 0; x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

/** Terrain beside the road: height offset relative to the road surface at lateral distance |u| beyond the shoulder. */
export function terrainOffset(s: number, u: number): number {
  const a = Math.abs(u), far = sm(24, 140, a);
  const bump = Math.sin(s / 310 + Math.sin(u / 71) * 2) * 6 + Math.sin(s / 131 + u / 53 + 1) * 3.2 + Math.sin(s / 59 - u / 37) * 0.9;
  const base = -0.15 - sm(19.6, 30, a) * 1.1; // drainage ditch next to the shoulder
  return base + far * (bump * (0.6 + 0.4 * far) + 2.5);
}
