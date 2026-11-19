/**
 * Broadway: a diagonal avenue cutting across the grid from the north-west toward the south-east, passing through four
 * intersections and slicing three blocks into triangular blocks (the Flatiron stands on the sharpest tip). Pure layout:
 * centreline legs, the triangle polygons, frontage lots, the Flatiron footprint and custom diagonal lane connectors.
 */
import { AVENUES, STREETS, SIDEWALK, LANE_WIDTH, halfWidth, lanesForAvenue, lanesForStreet, type V2, type Lot, type Lane, type Intersection, type PathRoad } from './citymap';
import type { Rng } from '../core/rng';

/** Blocks (i,i) for i in 1..3 are cut; the chain passes through intersections (1,1) .. (4,4). */
export const BROADWAY = { half: 4.4, channel: 4.5, first: 1, last: 4, name: 'Broadway' };
export const BW_U = { x: Math.SQRT1_2, z: Math.SQRT1_2 }; // travel direction north-west -> south-east
export const BW_N = { x: Math.SQRT1_2, z: -Math.SQRT1_2 }; // normal toward the north-east

export function isDiagBlock(i: number, j: number): boolean { return i === j && i >= BROADWAY.first && i < BROADWAY.last; }
/** Signed distance of (x,z) from Broadway's centreline (positive on the north-east side). */
export function bwSigned(x: number, z: number): number { return ((x - AVENUES[BROADWAY.first]) - (z - STREETS[BROADWAY.first])) * Math.SQRT1_2; }
/** Distance to the nearest Broadway leg (centreline between the first and last intersection). */
export function bwDist(x: number, z: number): number {
  const a = { x: AVENUES[BROADWAY.first], z: STREETS[BROADWAY.first] }, b = { x: AVENUES[BROADWAY.last], z: STREETS[BROADWAY.last] };
  const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz;
  const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
  return Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
}
export interface Tri { p: [V2, V2, V2] }
/** The two triangles of a cut block (north-east and south-west of the channel), counter-clockwise for the slab builder. */
export function diagTriangles(x0: number, z0: number, x1: number, z1: number): { ne: V2[]; sw: V2[] } {
  const k = BROADWAY.channel * Math.SQRT2;
  return {
    ne: [{ x: x0 + k, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 - k }],
    sw: [{ x: x0, z: z0 + k }, { x: x1 - k, z: z1 }, { x: x0, z: z1 }],
  };
}
/** The Flatiron's wedge footprint: apex at the sharp tip of the north-east triangle of the middle cut block. */
export function flatironFootprint(): { apex: V2; a: V2; b: V2; height: number } {
  const i = 2, x0 = AVENUES[i] + halfWidth(lanesForAvenue(i)), z0 = STREETS[i] + halfWidth(lanesForStreet(i));
  const zA = z0 + SIDEWALK, off = BROADWAY.channel + SIDEWALK; // inside the top sidewalk and the Broadway sidewalk
  const xA = (zA - (STREETS[BROADWAY.first] - AVENUES[BROADWAY.first])) + off * Math.SQRT2; // on the offset line, north-east of the centreline
  void x0;
  const L = 34;
  return { apex: { x: xA, z: zA }, a: { x: xA + L, z: zA }, b: { x: xA + L * Math.SQRT1_2, z: zA + L * Math.SQRT1_2 }, height: 78 };
}

function corners(l: Pick<Lot, 'x' | 'z' | 'w' | 'd' | 'rot'>): V2[] {
  const c = Math.cos(l.rot), s = Math.sin(l.rot), hw = l.w / 2, hd = l.d / 2;
  return [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]].map(([lx, lz]) => ({ x: l.x + lx * c + lz * s, z: l.z - lx * s + lz * c }));
}
function overlap(a: V2[], b: V2[], pad = 0.6): boolean {
  for (const poly of [a, b]) for (let i = 0; i < 4; i++) {
    const p = poly[i], q = poly[(i + 1) % 4], nx = -(q.z - p.z), nz = q.x - p.x, nl = Math.hypot(nx, nz) || 1;
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const v of a) { const d = (v.x * nx + v.z * nz) / nl; aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
    for (const v of b) { const d = (v.x * nx + v.z * nz) / nl; bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
    if (aMax + pad < bMin || bMax + pad < aMin) return false;
  }
  return true;
}
function triContains(t: V2[], x: number, z: number, pad: number): boolean {
  // inside the triangle and at least `pad` from each edge
  for (let i = 0; i < 3; i++) {
    const p = t[i], q = t[(i + 1) % 3], ex = q.x - p.x, ez = q.z - p.z, el = Math.hypot(ex, ez) || 1;
    const dist = ((x - p.x) * -ez + (z - p.z) * ex) / el; // positive on the left of p->q
    const sign = ((t[(i + 2) % 3].x - p.x) * -ez + (t[(i + 2) % 3].z - p.z) * ex) > 0 ? 1 : -1;
    if (dist * sign < pad) return false;
  }
  return true;
}
/** Keeps lots out of the Broadway channel and its sidewalks (called with the axis-aligned lots of a cut block). */
export function clearChannel(lots: Lot[]): Lot[] {
  const min = BROADWAY.channel + SIDEWALK + 0.4;
  return lots.filter(l => corners(l).every(c => Math.abs(bwSigned(c.x, c.z)) >= min));
}
/** Frontage lots along Broadway on both sides of one cut block, plus the Flatiron's reserved footprint test. */
export function broadwayLots(b: { x0: number; z0: number; x1: number; z1: number }, existing: Lot[], rng: Rng, startId: number, blockId: number): Lot[] {
  const out: Lot[] = [];
  const tris = diagTriangles(b.x0, b.z0, b.x1, b.z1);
  const fl = flatironFootprint(), flPoly = [fl.apex, fl.a, fl.b];
  const inner = (t: V2[]) => t.map(p => p); void inner;
  const L = (b.x1 - b.x0) * Math.SQRT2;
  for (const side of [1, -1]) {
    const tri = side > 0 ? tris.ne : tris.sw;
    let s = 8;
    while (s < L - 8) {
      const w = rng.pick([10, 11.5, 13, 14.5]);
      let placed = false;
      for (const d of [15, 13, 11, 9]) {
        const sc = s + w / 2, off = BROADWAY.channel + SIDEWALK + d / 2;
        const cx = b.x0 + BW_U.x * sc + BW_N.x * side * off, cz = b.z0 + BW_U.z * sc + BW_N.z * side * off;
        // front faces the road: local +z points toward the centreline
        const rot = Math.atan2(-BW_N.x * side, -BW_N.z * side);
        const lot: Lot = { id: startId + out.length, blockId, x: cx, z: cz, w, d, rot, kind: 'midrise', height: 0, seed: rng.int(0, 1e9) };
        const cs = corners(lot);
        if (!cs.every(c => triContains(tri, c.x, c.z, SIDEWALK))) continue;
        if (side > 0 && overlapPoly(cs, flPoly)) continue;
        if ([...existing, ...out].some(o => (o.blockId === blockId) && overlap(cs, corners(o)))) continue;
        out.push(lot); placed = true; break;
      }
      s += placed ? w : 6;
    }
  }
  return out;
}
function overlapPoly(a: V2[], tri: V2[]): boolean { return a.some(p => triContains(tri, p.x, p.z, -2)) || tri.some(p => { const c = a.reduce((m, q) => ({ x: m.x + q.x / 4, z: m.z + q.z / 4 }), { x: 0, z: 0 }); return Math.hypot(p.x - c.x, p.z - c.z) < 14; }); }

/** Diagonal lanes between the chain's intersections, the PathRoad that draws them, and the custom connectors. */
export function addBroadwayLanes(
  interGrid: Intersection[][], lanes: Lane[], paths: PathRoad[], push: (key: string, id: number) => void, polyLength: (p: V2[]) => { length: number; cum: number[] },
): void {
  const r0 = 11.5; // intersection centre to the corner where the channel starts
  for (let i = BROADWAY.first; i < BROADWAY.last; i++) {
    const A = interGrid[i][i], B = interGrid[i + 1][i + 1];
    const a = { x: A.x + BW_U.x * r0, y: 0, z: A.z + BW_U.z * r0 }, b = { x: B.x - BW_U.x * r0, y: 0, z: B.z - BW_U.z * r0 };
    paths.push({ id: paths.length, name: BROADWAY.name, kind: 'street', pts: [a, { x: (a.x + b.x) / 2, y: 0, z: (a.z + b.z) / 2 }, b], half: BROADWAY.half, lanes: 1, elevated: false, from: A.id, to: B.id });
    for (const dir of [1, -1]) {
      const off = 0.5 * LANE_WIDTH + 0.2;
      const sx = dir * BW_U.x, sz = dir * BW_U.z, rx = -sz, rz = sx; // right of travel
      const p0 = dir > 0 ? a : b, p1 = dir > 0 ? b : a;
      const lp: V2[] = [{ x: p0.x + rx * off, z: p0.z + rz * off }, { x: p1.x + rx * off, z: p1.z + rz * off }];
      const { length, cum } = polyLength(lp);
      const endI = dir > 0 ? B : A, startI = dir > 0 ? A : B;
      const lane: Lane = { id: lanes.length, points: lp, length, cum, next: [], connector: false, intersection: endI.id, axis: 'z', speed: 12, lane: 0, lanes: 1, roadId: -1, diag: true };
      lanes.push(lane);
      push(`${endI.id}:in`, lane.id); push(`${startI.id}:out`, lane.id);
    }
  }
}
/** Hermite connectors for turns between diagonal and axis-aligned lanes at one intersection. */
export function diagConnectors(inter: Intersection, ins: number[], outs: number[], lanes: Lane[], polyLength: (p: V2[]) => { length: number; cum: number[] }): void {
  const dirEnd = (l: Lane) => { const e = l.points[l.points.length - 1], p = l.points[l.points.length - 2], d = Math.hypot(e.x - p.x, e.z - p.z) || 1; return { x: (e.x - p.x) / d, z: (e.z - p.z) / d }; };
  const dirStart = (l: Lane) => { const s = l.points[0], n = l.points[1], d = Math.hypot(n.x - s.x, n.z - s.z) || 1; return { x: (n.x - s.x) / d, z: (n.z - s.z) / d }; };
  for (const li of ins) for (const lo of outs) {
    const a = lanes[li], b = lanes[lo];
    if (!a.diag && !b.diag) continue;
    if (a.connector || b.connector) continue;
    const ta = dirEnd(a), tb = dirStart(b);
    if (ta.x * tb.x + ta.z * tb.z < 0.3) continue; // straight or a 45 degree turn only
    const p0 = a.points[a.points.length - 1], p3 = b.points[0], k = Math.hypot(p3.x - p0.x, p3.z - p0.z) / 3;
    const p1 = { x: p0.x + ta.x * k, z: p0.z + ta.z * k }, p2 = { x: p3.x - tb.x * k, z: p3.z - tb.z * k };
    const pts: V2[] = [];
    for (let t = 0; t <= 8; t++) { const u = t / 8, v = 1 - u; pts.push({ x: v * v * v * p0.x + 3 * v * v * u * p1.x + 3 * v * u * u * p2.x + u * u * u * p3.x, z: v * v * v * p0.z + 3 * v * v * u * p1.z + 3 * v * u * u * p2.z + u * u * u * p3.z }); }
    const { length, cum } = polyLength(pts);
    const straight = ta.x * tb.x + ta.z * tb.z > 0.98;
    const c: Lane = { id: lanes.length, points: pts, length, cum, next: [lo], connector: true, intersection: inter.id, axis: a.axis, speed: straight ? a.speed : 7.5, lane: 0, lanes: 1, roadId: -1 };
    lanes.push(c); a.next.push(c.id);
  }
}
