/**
 * Old Town + Seacliff: the western extension of Port Meridian. Pure layout (no rendering): a hand-placed network of
 * curving avenues, a roundabout and a winding coastal road, joined to the grid's west edge; lots along the curved
 * frontages; plazas, a park and landmarks. Everything feeds the same lane graph / ped graph as the grid.
 */
import { Rng } from './../core/rng';
import type { Intersection, Lot, LotKind, P3, PathRoad, PedNode } from './citymap';

export const WEST = { x0: -1060, x1: -470, z0: -392, z1: 405 };
export interface Plaza { x: number; z: number; r: number; kind: 'plaza' | 'park' | 'island'; name: string }
export interface Landmark { kind: 'clock' | 'lighthouse' | 'cathedral' | 'watertower'; x: number; z: number; yaw: number; name: string }
export const WEST_ROUNDABOUT = { x: -760, z: 0, r: 34 };

export const WEST_PLAZAS: Plaza[] = [
  { x: WEST_ROUNDABOUT.x, z: WEST_ROUNDABOUT.z, r: 25, kind: 'island', name: 'Clockwork Circle' },
  { x: -835, z: 118, r: 30, kind: 'plaza', name: 'Saint Ember Square' },
  { x: -640, z: 105, r: 46, kind: 'park', name: 'Cliffside Green' },
  { x: -830, z: -90, r: 24, kind: 'plaza', name: 'Old Market' },
];
export const WEST_LANDMARKS: Landmark[] = [
  { kind: 'clock', x: WEST_ROUNDABOUT.x, z: WEST_ROUNDABOUT.z, yaw: 0, name: 'Clockwork Tower' },
  { kind: 'cathedral', x: -835, z: 160, yaw: Math.PI, name: 'Saint Ember Cathedral' },
  { kind: 'lighthouse', x: -985, z: 392, yaw: 0, name: 'Seacliff Light' },
  { kind: 'watertower', x: -990, z: -330, yaw: 0, name: 'Old Quarter water tower' },
];

export interface WestApi {
  junction(x: number, z: number, half: number): Intersection;
  add(name: string, kind: PathRoad['kind'], from: Intersection, fromDir: [number, number], to: Intersection, toDir: [number, number], ctrl: P3[], lanes: 1 | 2, y0: number, y1: number, elevated: boolean, step?: number): PathRoad;
  grid(i: number, j: number): Intersection;
}
const p = (x: number, z: number): P3 => ({ x, y: 0, z });

export function buildWestRoads(a: WestApi) {
  const H = 4.4, R = WEST_ROUNDABOUT;
  const RN = a.junction(R.x, R.z - R.r, H), RE = a.junction(R.x + R.r, R.z, H), RS = a.junction(R.x, R.z + R.r, H), RW = a.junction(R.x - R.r, R.z, H);
  const JNm = a.junction(-740, -180, H), JNW = a.junction(-930, -140, H), JW = a.junction(-930, 20, H);
  const JS1 = a.junction(-900, 230, H), JS2 = a.junction(-740, 240, H), JC = a.junction(-730, 385, H), JC2 = a.junction(-900, 395, H);
  const JA = a.junction(-700, -300, H), JNW2 = a.junction(-900, -300, H);
  const st = (name: string, f: Intersection, fd: [number, number], t: Intersection, td: [number, number], ctrl: P3[], step = 6) => a.add(name, 'street', f, fd, t, td, ctrl, 1, 0, 0, false, step);
  const d = R.r * 0.7071;
  // roundabout ring (one carriageway each way around the island)
  st('Clockwork Circle', RN, [1, 0], RE, [0, -1], [p(R.x + d, R.z - d)], 5);
  st('Clockwork Circle', RE, [0, 1], RS, [1, 0], [p(R.x + d, R.z + d)], 5);
  st('Clockwork Circle', RS, [-1, 0], RW, [0, 1], [p(R.x - d, R.z + d)], 5);
  st('Clockwork Circle', RW, [0, -1], RN, [-1, 0], [p(R.x - d, R.z - d)], 5);
  st('Sunset Boulevard West', a.grid(0, 4), [-1, 0], RE, [1, 0], [p(-540, -14), p(-610, 12), p(-675, -10)]);
  st('Lamplighter Way', RN, [0, -1], JNm, [0, 1], [p(-782, -80), p(-750, -128)]);
  st('Curve Avenue', JNm, [1, 0], a.grid(0, 2), [-1, 0], [p(-690, -172), p(-622, -208), p(-540, -188)]);
  st('Quarry Road', JNm, [-1, 0], JNW, [1, 0], [p(-800, -192), p(-862, -158)]);
  st('Old Market Row', JNW, [0, 1], JW, [0, -1], [p(-948, -70), p(-920, -22)]);
  st('Weaver Street', RW, [-1, 0], JW, [1, 0], [p(-830, 12), p(-880, -8)]);
  st('Old Town Road', JW, [0, 1], JS1, [0, -1], [p(-925, 100), p(-890, 160)]);
  st('Bell Lane', RS, [0, 1], JS2, [0, -1], [p(-774, 100), p(-735, 175)]);
  st('Millrace Lane', JS1, [1, 0], JS2, [-1, 0], [p(-855, 252), p(-800, 224)]);
  st('Cooper Hill Road', JS2, [1, 0], a.grid(0, 6), [-1, 0], [p(-690, 254), p(-612, 216), p(-532, 204)]);
  st('Gull Road', JS2, [0, 1], JC, [0, -1], [p(-714, 300), p(-748, 348)]);
  st('Seacliff Road', JC, [1, 0], a.grid(0, 8), [-1, 0], [p(-680, 368), p(-622, 398), p(-566, 378), p(-506, 404)]);
  st('Harbor Bend', JC, [-1, 0], JC2, [1, 0], [p(-790, 404), p(-850, 378)]);
  st('Foghorn Road', JS1, [0, 1], JC2, [0, -1], [p(-915, 290), p(-888, 345)]);
  st('Ropewalk Avenue', JNm, [0, -1], JA, [0, 1], [p(-720, -240)]);
  st('Ridge Link', JA, [1, 0], a.grid(0, 1), [-1, 0], [p(-640, -312), p(-540, -288)]);
  st('Tanner Street', JA, [-1, 0], JNW2, [1, 0], [p(-770, -318), p(-840, -284)]);
  st('Windlass Road', JNW2, [0, 1], JNW, [0, -1], [p(-925, -240), p(-905, -190)]);
}

type Rect = { x: number; z: number; r: number };
const segDist = (a: P3, b: P3, x: number, z: number) => {
  const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
  const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
  return Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
};
export function distToPath(path: PathRoad, x: number, z: number): number {
  let d = Infinity; for (let i = 1; i < path.pts.length; i++) d = Math.min(d, segDist(path.pts[i - 1], path.pts[i], x, z)); return d;
}

/** Lots along the curved frontages plus a second row of infill, rotated to face the street. */
export function genWestLots(paths: PathRoad[], startId: number, rng: Rng, sidewalk: number): Lot[] {
  const west = paths.filter(pp => pp.kind === 'street');
  const out: Lot[] = [];
  const placed: Rect[] = [];
  const inRegion = (x: number, z: number) => x > WEST.x0 + 12 && x < WEST.x1 - 6 && z > WEST.z0 + 10 && z < WEST.z1 - 12;
  const ok = (x: number, z: number, rad: number, own: PathRoad | null, depth = 0) => {
    if (!inRegion(x, z)) return false;
    for (const pp of west) { const dd = distToPath(pp, x, z); if (dd < pp.half + sidewalk + (pp === own ? depth * 0.5 * 0.85 : rad * 1.15) + 0.5) return false; }
    for (const pl of WEST_PLAZAS) if (Math.hypot(x - pl.x, z - pl.z) < pl.r + rad + 3) return false;
    for (const lm of WEST_LANDMARKS) if (lm.kind !== 'clock' && Math.hypot(x - lm.x, z - lm.z) < rad + 16) return false;
    for (const o of placed) if (Math.hypot(x - o.x, z - o.z) < o.r + rad) return false;
    return true;
  };
  const make = (x: number, z: number, rot: number, district: Lot['district'], w: number, d: number, kind: LotKind, height: number, street = true) => {
    out.push({ id: startId + out.length, blockId: -1, district, street, x, z, w, d, rot, kind, height, seed: rng.int(0, 1e9) });
    placed.push({ x, z, r: Math.hypot(w, d) / 2 * 0.92 });
  };
  const pickKind = (district: 'oldtown' | 'seacliff'): { kind: LotKind; w: number; d: number; height: number } => {
    if (district === 'seacliff') return { kind: 'pastel', w: rng.range(9.5, 13), d: rng.range(10, 12.5), height: 0 };
    const t = rng.next();
    if (t < 0.55) return { kind: 'brownstone', w: rng.range(8.5, 13), d: rng.range(9.5, 13), height: 0 };
    if (t < 0.9) return { kind: 'midrise', w: rng.range(13, 21), d: rng.range(11, 16), height: 0 };
    return { kind: 'tower', w: rng.range(16, 24), d: rng.range(16, 24), height: rng.range(30, 62) };
  };
  // frontage rows: walk each centreline, place a lot every ~frontage on each side
  for (const pp of west) {
    let acc = 0;
    for (let i = 1; i < pp.pts.length; i++) {
      const a = pp.pts[i - 1], b = pp.pts[i], seg = Math.hypot(b.x - a.x, b.z - a.z);
      if (seg < 0.01) continue;
      acc += seg;
      const need = 11.5;
      if (acc < need) continue;
      acc = 0;
      const tx = (b.x - a.x) / seg, tz = (b.z - a.z) / seg, nx = -tz, nz = tx;
      for (const side of [-1, 1]) {
        const mid = b.z > 120 ? 'seacliff' as const : 'oldtown' as const;
        const spec = pickKind(mid);
        const off = pp.half + sidewalk + spec.d / 2;
        const x = b.x + nx * side * off, z = b.z + nz * side * off;
        if (!ok(x, z, Math.hypot(spec.w, spec.d) / 2 * 0.92, pp, spec.d)) continue;
        if (rng.chance(0.07)) continue; // a gap: alley / yard
        make(x, z, Math.atan2(-nx * side, -nz * side), mid, spec.w, spec.d, spec.kind, spec.height);
      }
    }
  }
  // infill: jittered grid of buildings behind the frontage, turned to face the nearest street
  for (let gx = WEST.x0 + 20; gx < WEST.x1 - 10; gx += 21) for (let gz = WEST.z0 + 20; gz < WEST.z1 - 20; gz += 21) {
    const x = gx + rng.range(-5, 5), z = gz + rng.range(-5, 5);
    const mid = z > 150 ? 'seacliff' as const : 'oldtown' as const;
    const spec = pickKind(mid);
    if (spec.kind === 'tower' && rng.chance(0.75)) continue;
    const rad = Math.hypot(spec.w, spec.d) / 2 * 0.92;
    if (!ok(x, z, rad, null)) continue;
    let best: PathRoad | null = null, bd = Infinity;
    for (const pp of west) { const dd = distToPath(pp, x, z); if (dd < bd) { bd = dd; best = pp; } }
    if (!best || bd > 90) continue;
    // face the nearest centreline point
    let cx = 0, cz = 0, cd = Infinity;
    for (let i = 1; i < best.pts.length; i++) {
      const a = best.pts[i - 1], b = best.pts[i], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2)); const px = a.x + vx * t, pz = a.z + vz * t, dd = Math.hypot(x - px, z - pz);
      if (dd < cd) { cd = dd; cx = px; cz = pz; }
    }
    make(x, z, Math.atan2(cx - x, cz - z), mid, spec.w, spec.d, spec.kind, spec.height, false);
  }
  return out;
}

/** Sidewalk pedestrian nodes along both sides of every west street, joined into the existing graph. */
export function genWestPeds(paths: PathRoad[], nodes: PedNode[], sidewalk: number) {
  const west = paths.filter(pp => pp.kind === 'street');
  const firstWest = nodes.length;
  const chains: number[][] = [];
  const link = (a: number, b: number) => { nodes[a].edges.push({ to: b, crossing: null }); nodes[b].edges.push({ to: a, crossing: null }); };
  for (const pp of west) for (const side of [-1, 1]) {
    const chain: number[] = []; let acc = 1e9;
    for (let i = 1; i < pp.pts.length; i++) {
      const a = pp.pts[i - 1], b = pp.pts[i], seg = Math.hypot(b.x - a.x, b.z - a.z); if (seg < 0.01) continue;
      acc += seg; if (acc < 22 && i < pp.pts.length - 1) continue; acc = 0;
      const nx = -(b.z - a.z) / seg, nz = (b.x - a.x) / seg, off = pp.half + sidewalk * 0.5;
      const id = nodes.length; nodes.push({ id, x: b.x + nx * side * off, z: b.z + nz * side * off, blockId: -1, edges: [] });
      if (chain.length) link(chain[chain.length - 1], id);
      chain.push(id);
    }
    chains.push(chain);
  }
  // join nodes that sit close together (junction corners, and the west edge of the grid)
  for (let i = firstWest; i < nodes.length; i++) for (let j = 0; j < nodes.length; j++) {
    if (j === i || (j >= firstWest && j < i)) continue;
    const dd = Math.hypot(nodes[i].x - nodes[j].x, nodes[i].z - nodes[j].z);
    if (dd < (j >= firstWest ? 26 : 34) && !nodes[i].edges.some(e => e.to === j)) link(i, j);
  }
  // any stragglers: connect to the nearest node of the main component
  const comp = new Int32Array(nodes.length).fill(-1);
  const flood = (s: number, c: number) => { const st = [s]; comp[s] = c; while (st.length) { const n = st.pop()!; for (const e of nodes[n].edges) if (comp[e.to] < 0) { comp[e.to] = c; st.push(e.to); } } };
  flood(0, 0); let nc = 1;
  for (let i = 0; i < nodes.length; i++) if (comp[i] < 0) {
    flood(i, nc);
    let bi = -1, bj = -1, bd = Infinity;
    for (let a = 0; a < nodes.length; a++) if (comp[a] === nc) for (let b = 0; b < nodes.length; b++) if (comp[b] >= 0 && comp[b] !== nc) { const dd = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z); if (dd < bd) { bd = dd; bi = a; bj = b; } }
    if (bi >= 0) { link(bi, bj); for (let k = 0; k < nodes.length; k++) if (comp[k] === nc) comp[k] = 0; }
    nc++;
  }
  void chains;
}
