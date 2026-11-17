/**
 * Port Meridian city layout: pure data, no rendering. Everything is in meters.
 * x grows east, z grows south (three.js convention, north is -z).
 */
import { Rng } from '../core/rng';

export type District = 'brickline' | 'heights' | 'juniper' | 'hillside' | 'cannery' | 'strand' | 'midtown';
export const DISTRICT_INFO: Record<District, { name: string; color: string; pedDensity: number; trafficDensity: number }> = {
  brickline: { name: 'Brickline', color: '#b8674d', pedDensity: 1, trafficDensity: 0.8 },
  heights: { name: 'Meridian Heights', color: '#4f7f8f', pedDensity: 1.2, trafficDensity: 1.2 },
  juniper: { name: 'Juniper Park', color: '#5f8f4f', pedDensity: 0.8, trafficDensity: 0.6 },
  hillside: { name: 'Hillside', color: '#c79a5b', pedDensity: 0.6, trafficDensity: 0.6 },
  cannery: { name: 'Cannery Docks', color: '#7a7268', pedDensity: 0.3, trafficDensity: 0.7 },
  strand: { name: 'Saltwater Strand', color: '#e0b48a', pedDensity: 1, trafficDensity: 0.9 },
  midtown: { name: 'Midtown', color: '#9a7f6a', pedDensity: 0.9, trafficDensity: 1 },
};

export const LANE_WIDTH = 3.6;
export const SIDEWALK = 4.5;
export const CURB_HEIGHT = 0.18;
export const AVENUES = [-450, -350, -250, -150, -50, 50, 150, 250, 350, 450];
export const STREETS = [-400, -300, -200, -100, 0, 100, 200, 300, 400];
export const WATER_LEVEL = -1.2;
export const COAST_Z = 452; // beach ends and the sea begins south of this line
export const HARBOR_X = 492; // quay edge on the east side
export const MAP_BOUNDS = { minX: -520, maxX: 620, minZ: -470, maxZ: 620 };

export const AVENUE_NAMES = ['Ridge Ave', 'Lantern Ave', 'Cooper Ave', 'Marrow Ave', 'Meridian Blvd', 'Solace Ave', 'Fennel Ave', 'Tidewell Ave', 'Ashby Ave', 'Harbor Way'];
export const STREET_NAMES = ['North Crest St', '1st St', '2nd St', '3rd St', 'Sunset Blvd', '5th St', '6th St', 'Boardwalk St', 'Coastal Dr'];

export function lanesForAvenue(i: number): 1 | 2 { return i === 4 || i === 9 ? 2 : 1; }
export function lanesForStreet(j: number): 1 | 2 { return j === 4 || j === 8 ? 2 : 1; }
export function halfWidth(lanes: number): number { return lanes * LANE_WIDTH + 0.8; }

export interface V2 { x: number; z: number }
export interface Road { id: number; axis: 'x' | 'z'; index: number; coord: number; from: number; to: number; lanes: 1 | 2; half: number; name: string }
export interface Intersection { id: number; ix: number; iz: number; x: number; z: number; halfX: number; halfZ: number; offset: number; signalized: boolean }
export interface Block { id: number; ix: number; iz: number; x0: number; x1: number; z0: number; z1: number; district: District; kind: 'buildings' | 'park' | 'plaza' | 'docks' }
export type LotKind = 'brownstone' | 'pastel' | 'tower' | 'midrise' | 'warehouse' | 'house';
export interface Lot { id: number; blockId: number; x: number; z: number; w: number; d: number; rot: number; kind: LotKind; height: number; seed: number }
export interface Lane {
  id: number; points: V2[]; length: number; cum: number[]; next: number[]; connector: boolean;
  intersection: number; axis: 'x' | 'z'; speed: number; lane: number; lanes: number; roadId: number;
}
export interface PedNode { id: number; x: number; z: number; blockId: number; edges: { to: number; crossing: null | { intersection: number; axis: 'x' | 'z' } }[] }

export interface CityMap {
  roads: Road[]; intersections: Intersection[]; blocks: Block[]; lots: Lot[]; lanes: Lane[]; pedNodes: PedNode[];
  intersectionAt: (ix: number, iz: number) => Intersection | undefined;
}

export function districtFor(ix: number, iz: number): District {
  if (iz >= 7) return 'strand';
  if (ix === 8 && iz >= 3) return 'cannery';
  if ((ix === 4 || ix === 5) && iz === 0) return 'juniper';
  if (ix >= 7 && iz <= 2) return 'hillside';
  if (ix >= 4 && ix <= 6 && iz >= 1 && iz <= 4) return 'heights';
  if (ix <= 3 && iz <= 3) return 'brickline';
  return 'midtown';
}

export const SIGNAL_CYCLE = [13, 3, 1.5, 13, 3, 1.5];
export const SIGNAL_PERIOD = SIGNAL_CYCLE.reduce((a, b) => a + b, 0);
/** State of the traffic signal for vehicles travelling along `axis` ('z' = north/south road). */
export function signalState(inter: Intersection, axis: 'x' | 'z', time: number): 'green' | 'yellow' | 'red' {
  if (!inter.signalized) return 'green';
  let t = (((time + inter.offset) % SIGNAL_PERIOD) + SIGNAL_PERIOD) % SIGNAL_PERIOD;
  let phase = 0;
  while (t >= SIGNAL_CYCLE[phase]) { t -= SIGNAL_CYCLE[phase]; phase++; }
  const nsPhase = phase < 3;
  const mine = axis === 'z' ? nsPhase : !nsPhase;
  const p = phase % 3;
  if (!mine || p === 2) return 'red';
  return p === 0 ? 'green' : 'yellow';
}
/** Pedestrians may cross a road running along `roadAxis` when traffic on that road is red. */
export function pedestrianMayCross(inter: Intersection, roadAxis: 'x' | 'z', time: number): boolean {
  if (!inter.signalized) return true;
  const other = roadAxis === 'x' ? 'z' : 'x';
  return signalState(inter, roadAxis, time) === 'red' && signalState(inter, other, time) === 'green';
}

function polyLength(points: V2[]): { length: number; cum: number[] } {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  return { length: cum[cum.length - 1], cum };
}
export function samplePath(lane: { points: V2[]; cum: number[]; length: number }, s: number, out: { x: number; z: number; dx: number; dz: number }) {
  const pts = lane.points, cum = lane.cum;
  if (s <= 0) s = 0; if (s >= lane.length) s = lane.length - 1e-6;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
  out.dx = (b.x - a.x) / seg; out.dz = (b.z - a.z) / seg;
  return out;
}

export function generateCity(seed = 1977): CityMap {
  const rng = new Rng(seed);
  const roads: Road[] = [];
  const intersections: Intersection[] = [];
  const blocks: Block[] = [];
  const lots: Lot[] = [];
  const lanes: Lane[] = [];
  const pedNodes: PedNode[] = [];
  const nx = AVENUES.length, nz = STREETS.length;

  // Intersections
  const interGrid: Intersection[][] = [];
  for (let i = 0; i < nx; i++) {
    interGrid[i] = [];
    for (let j = 0; j < nz; j++) {
      const inter: Intersection = {
        id: intersections.length, ix: i, iz: j, x: AVENUES[i], z: STREETS[j],
        halfX: halfWidth(lanesForAvenue(i)), halfZ: halfWidth(lanesForStreet(j)),
        offset: (i * 5.3 + j * 9.1) % SIGNAL_PERIOD,
        signalized: !((i === 0 || i === nx - 1) && (j === 0 || j === nz - 1)),
      };
      intersections.push(inter); interGrid[i][j] = inter;
    }
  }
  // Roads: one entry per segment between adjacent intersections
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz - 1; j++) {
    const a = interGrid[i][j], b = interGrid[i][j + 1];
    roads.push({ id: roads.length, axis: 'z', index: i, coord: AVENUES[i], from: a.z + a.halfZ, to: b.z - b.halfZ, lanes: lanesForAvenue(i), half: halfWidth(lanesForAvenue(i)), name: AVENUE_NAMES[i] });
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx - 1; i++) {
    const a = interGrid[i][j], b = interGrid[i + 1][j];
    roads.push({ id: roads.length, axis: 'x', index: j, coord: STREETS[j], from: a.x + a.halfX, to: b.x - b.halfX, lanes: lanesForStreet(j), half: halfWidth(lanesForStreet(j)), name: STREET_NAMES[j] });
  }

  // Blocks
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < nz - 1; j++) {
    const district = districtFor(i, j);
    const x0 = AVENUES[i] + halfWidth(lanesForAvenue(i)), x1 = AVENUES[i + 1] - halfWidth(lanesForAvenue(i + 1));
    const z0 = STREETS[j] + halfWidth(lanesForStreet(j)), z1 = STREETS[j + 1] - halfWidth(lanesForStreet(j + 1));
    let kind: Block['kind'] = 'buildings';
    if (district === 'juniper') kind = 'park';
    else if (district === 'cannery') kind = 'docks';
    else if ((i === 5 && j === 2) || (i === 2 && j === 5)) kind = 'plaza';
    blocks.push({ id: blocks.length, ix: i, iz: j, x0, x1, z0, z1, district, kind });
  }

  // Lots along block perimeters (inside the sidewalk ring)
  for (const b of blocks) {
    if (b.kind !== 'buildings') continue;
    const ix0 = b.x0 + SIDEWALK, ix1 = b.x1 - SIDEWALK, iz0 = b.z0 + SIDEWALK, iz1 = b.z1 - SIDEWALK;
    const w = ix1 - ix0, d = iz1 - iz0;
    if (b.district === 'heights') {
      // 2x2 towers with a plaza gap
      const cols = 2, rows = 2;
      for (let a = 0; a < cols; a++) for (let c = 0; c < rows; c++) {
        if (rng.chance(0.12)) continue;
        const cw = w / cols, cd = d / rows;
        const fw = cw * rng.range(0.62, 0.82), fd = cd * rng.range(0.62, 0.82);
        const cx = ix0 + cw * (a + 0.5), cz = iz0 + cd * (c + 0.5);
        const ox = (a === 0 ? -1 : 1) * (cw - fw) * 0.45, oz = (c === 0 ? -1 : 1) * (cd - fd) * 0.45;
        lots.push({ id: lots.length, blockId: b.id, x: cx + ox, z: cz + oz, w: fw, d: fd, rot: 0, kind: 'tower', height: rng.range(34, 96) * (b.ix === 5 && b.iz === 3 ? 1.35 : 1), seed: rng.int(0, 1e9) });
      }
      continue;
    }
    const kind: LotKind = b.district === 'brickline' ? 'brownstone' : b.district === 'strand' || b.district === 'hillside' ? 'pastel' : rng.chance(0.5) ? 'midrise' : 'brownstone';
    const frontage = 10.5;
    // sides: north (faces -z), south (+z), west (-x), east (+x). rot = yaw so model front (+z) faces the street.
    const sides: { ax: 'x' | 'z'; fixed: number; from: number; to: number; rot: number }[] = [
      { ax: 'x', fixed: iz0, from: ix0, to: ix1, rot: Math.PI },
      { ax: 'x', fixed: iz1, from: ix0, to: ix1, rot: 0 },
      { ax: 'z', fixed: ix0, from: iz0 + 11, to: iz1 - 11, rot: -Math.PI / 2 },
      { ax: 'z', fixed: ix1, from: iz0 + 11, to: iz1 - 11, rot: Math.PI / 2 },
    ];
    for (const s of sides) {
      const len = s.to - s.from;
      const n = Math.floor(len / frontage);
      const pad = (len - n * frontage) / 2;
      const gap = rng.int(0, n - 1); // one driveway / alley per side
      for (let k = 0; k < n; k++) {
        if (k === gap && n > 3) continue;
        const t = s.from + pad + frontage * (k + 0.5);
        const depth = 10;
        const inward = s.ax === 'x' ? (s.rot === 0 ? -1 : 1) : (s.rot === Math.PI / 2 ? -1 : 1);
        const x = s.ax === 'x' ? t : s.fixed + inward * depth / 2;
        const z = s.ax === 'x' ? s.fixed + inward * depth / 2 : t;
        const lk: LotKind = kind === 'midrise' && rng.chance(0.4) ? 'brownstone' : kind;
        lots.push({ id: lots.length, blockId: b.id, x, z, w: frontage, d: depth, rot: s.rot, kind: lk, height: 0, seed: rng.int(0, 1e9) });
      }
    }
  }

  // Lanes: road lanes then intersection connectors
  const laneEnds = new Map<string, number[]>(); // key "interId:in" -> lane ids entering, "interId:out" -> lanes leaving
  const push = (key: string, id: number) => { const l = laneEnds.get(key); if (l) l.push(id); else laneEnds.set(key, [id]); };
  const roadSpeed = (lanesN: number) => (lanesN === 2 ? 17 : 13);
  for (const road of roads) {
    const dirs = [1, -1];
    for (const dsign of dirs) {
      for (let k = 0; k < road.lanes; k++) {
        const off = (k + 0.5) * LANE_WIDTH + 0.2;
        const pts: V2[] = [];
        const s0 = dsign > 0 ? road.from : road.to, s1 = dsign > 0 ? road.to : road.from;
        // direction d: along axis; right = (-dz, dx)
        const dx = road.axis === 'x' ? dsign : 0, dz = road.axis === 'z' ? dsign : 0;
        const rx = -dz, rz = dx;
        for (const s of [s0, s1]) {
          const px = road.axis === 'x' ? s : road.coord, pz = road.axis === 'x' ? road.coord : s;
          pts.push({ x: px + rx * off, z: pz + rz * off });
        }
        const { length, cum } = polyLength(pts);
        const startInter = road.axis === 'x' ? interGrid[AVENUES.indexOf(nearestCoord(AVENUES, s0))][road.index] : interGrid[road.index][STREETS.indexOf(nearestCoord(STREETS, s0))];
        const endInter = road.axis === 'x' ? interGrid[AVENUES.indexOf(nearestCoord(AVENUES, s1))][road.index] : interGrid[road.index][STREETS.indexOf(nearestCoord(STREETS, s1))];
        const lane: Lane = { id: lanes.length, points: pts, length, cum, next: [], connector: false, intersection: endInter.id, axis: road.axis, speed: roadSpeed(road.lanes), lane: k, lanes: road.lanes, roadId: road.id };
        lanes.push(lane);
        push(`${endInter.id}:in`, lane.id);
        push(`${startInter.id}:out`, lane.id);
      }
    }
  }
  // connectors
  for (const inter of intersections) {
    const ins = laneEnds.get(`${inter.id}:in`) ?? [];
    const outs = laneEnds.get(`${inter.id}:out`) ?? [];
    for (let pass = 0; pass < 2; pass++) for (const li of ins) {
      const a = lanes[li];
      if (pass === 1 && a.next.length > 0) continue;
      const relaxed = pass === 1;
      const ae = a.points[a.points.length - 1], ap = a.points[a.points.length - 2];
      const adx = Math.sign(ae.x - ap.x), adz = Math.sign(ae.z - ap.z);
      for (const lo of outs) {
        const b = lanes[lo];
        const bs = b.points[0], bn = b.points[1];
        const bdx = Math.sign(bn.x - bs.x), bdz = Math.sign(bn.z - bs.z);
        if (adx === -bdx && adz === -bdz) continue; // no U-turns
        const straight = adx === bdx && adz === bdz;
        // turn direction: cross product (a x b).y ; right turn when b = right of a
        const cross = adx * bdz - adz * bdx; // >0 -> b is to the right of a (x east, z south)
        if (relaxed) { if (b.lane !== (cross > 0 ? b.lanes - 1 : 0) && !straight) continue; }
        else if (straight) { if (b.lane !== Math.min(a.lane, b.lanes - 1)) continue; }
        else if (cross > 0) { if (a.lane !== a.lanes - 1 || b.lane !== b.lanes - 1) continue; }
        else { if (a.lane !== 0 || b.lane !== 0) continue; }
        const pts: V2[] = [];
        if (straight) pts.push(ae, bs);
        else {
          // control point: intersection of the two lane lines
          const cx = adx !== 0 ? bs.x : ae.x;
          const cz = adz !== 0 ? bs.z : ae.z;
          const N = 8;
          for (let t = 0; t <= N; t++) {
            const u = t / N;
            pts.push({ x: (1 - u) * (1 - u) * ae.x + 2 * (1 - u) * u * cx + u * u * bs.x, z: (1 - u) * (1 - u) * ae.z + 2 * (1 - u) * u * cz + u * u * bs.z });
          }
        }
        const { length, cum } = polyLength(pts);
        const c: Lane = { id: lanes.length, points: pts, length, cum, next: [lo], connector: true, intersection: inter.id, axis: a.axis, speed: straight ? a.speed : 7.5, lane: 0, lanes: 1, roadId: -1 };
        lanes.push(c);
        a.next.push(c.id);
      }
    }
  }

  // Pedestrian graph: 4 corner nodes per block, edges along sidewalks and crosswalks
  const cornerId = new Map<string, number>();
  const inset = 2.2;
  for (const b of blocks) {
    const corners: [number, number, string][] = [[b.x0 + inset, b.z0 + inset, 'nw'], [b.x1 - inset, b.z0 + inset, 'ne'], [b.x1 - inset, b.z1 - inset, 'se'], [b.x0 + inset, b.z1 - inset, 'sw']];
    for (const [x, z, tag] of corners) { cornerId.set(`${b.ix},${b.iz},${tag}`, pedNodes.length); pedNodes.push({ id: pedNodes.length, x, z, blockId: b.id, edges: [] }); }
    const ids = ['nw', 'ne', 'se', 'sw'].map(t => cornerId.get(`${b.ix},${b.iz},${t}`)!);
    for (let k = 0; k < 4; k++) { const a = ids[k], c = ids[(k + 1) % 4]; pedNodes[a].edges.push({ to: c, crossing: null }); pedNodes[c].edges.push({ to: a, crossing: null }); }
  }
  const link = (a: string, c: string, inter: Intersection, axis: 'x' | 'z') => {
    const ia = cornerId.get(a), ic = cornerId.get(c);
    if (ia === undefined || ic === undefined) return;
    pedNodes[ia].edges.push({ to: ic, crossing: { intersection: inter.id, axis } });
    pedNodes[ic].edges.push({ to: ia, crossing: { intersection: inter.id, axis } });
  };
  for (let i = 0; i < nx - 2; i++) for (let j = 0; j < nz - 1; j++) {
    // crossing avenue i+1 (a road along z) between block (i,j) and (i+1,j)
    link(`${i},${j},ne`, `${i + 1},${j},nw`, interGrid[i + 1][j], 'z');
    link(`${i},${j},se`, `${i + 1},${j},sw`, interGrid[i + 1][j + 1], 'z');
  }
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < nz - 2; j++) {
    link(`${i},${j},sw`, `${i},${j + 1},nw`, interGrid[i][j + 1], 'x');
    link(`${i},${j},se`, `${i},${j + 1},ne`, interGrid[i + 1][j + 1], 'x');
  }

  return { roads, intersections, blocks, lots, lanes, pedNodes, intersectionAt: (ix, iz) => interGrid[ix]?.[iz] };
}

function nearestCoord(arr: number[], v: number): number {
  let best = arr[0];
  for (const a of arr) if (Math.abs(a - v) < Math.abs(best - v)) best = a;
  return best;
}

export type Surface = 'road' | 'sidewalk' | 'lot' | 'park' | 'beach' | 'water' | 'quay' | 'offmap';
/** Classifies a point on the ground plane. */
export function surfaceAt(city: CityMap, x: number, z: number): Surface {
  if (z > COAST_Z || x > HARBOR_X + 40) return 'water';
  if (x > HARBOR_X && z > -60) return 'water';
  if (x < AVENUES[0] - 30 || z < STREETS[0] - 30) return 'offmap';
  if (x > AVENUES[AVENUES.length - 1] + 9 && x <= HARBOR_X) return 'quay';
  if (z > STREETS[STREETS.length - 1] + 9) return 'beach';
  for (let i = 0; i < AVENUES.length; i++) if (Math.abs(x - AVENUES[i]) < halfWidth(lanesForAvenue(i)) && z > STREETS[0] - 9 && z < STREETS[STREETS.length - 1] + 9) return 'road';
  for (let j = 0; j < STREETS.length; j++) if (Math.abs(z - STREETS[j]) < halfWidth(lanesForStreet(j)) && x > AVENUES[0] - 9 && x < AVENUES[AVENUES.length - 1] + 9) return 'road';
  const b = blockAt(city, x, z);
  if (!b) return 'sidewalk';
  if (x < b.x0 + SIDEWALK || x > b.x1 - SIDEWALK || z < b.z0 + SIDEWALK || z > b.z1 - SIDEWALK) return 'sidewalk';
  return b.kind === 'park' ? 'park' : 'lot';
}
export function blockAt(city: CityMap, x: number, z: number): Block | undefined {
  for (const b of city.blocks) if (x >= b.x0 && x <= b.x1 && z >= b.z0 && z <= b.z1) return b;
  return undefined;
}
export function districtAt(city: CityMap, x: number, z: number): District {
  const b = blockAt(city, x, z);
  if (b) return b.district;
  if (z > STREETS[STREETS.length - 1]) return 'strand';
  if (x > AVENUES[AVENUES.length - 1]) return 'cannery';
  let bi = 0, bj = 0;
  for (let i = 0; i < AVENUES.length - 1; i++) if (x > AVENUES[i]) bi = i;
  for (let j = 0; j < STREETS.length - 1; j++) if (z > STREETS[j]) bj = j;
  return districtFor(bi, bj);
}
export function nearestLane(city: CityMap, x: number, z: number, roadOnly = true): { lane: Lane; s: number; dist: number } | null {
  let best: { lane: Lane; s: number; dist: number } | null = null;
  for (const lane of city.lanes) {
    if (roadOnly && lane.connector) continue;
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1], b = lane.points[i];
      const vx = b.x - a.x, vz = b.z - a.z; const l2 = vx * vx + vz * vz || 1;
      let t = ((x - a.x) * vx + (z - a.z) * vz) / l2; t = Math.max(0, Math.min(1, t));
      const px = a.x + vx * t, pz = a.z + vz * t; const d = Math.hypot(x - px, z - pz);
      if (!best || d < best.dist) best = { lane, s: lane.cum[i - 1] + Math.sqrt(l2) * t, dist: d };
    }
  }
  return best;
}
