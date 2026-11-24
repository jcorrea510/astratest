/**
 * Port Meridian city layout: pure data, no rendering. Everything is in meters.
 * x grows east, z grows south (three.js convention, north is -z).
 */
import { Rng } from '../core/rng';
import { buildWestRoads, genWestLots, genWestPeds, WEST } from './westside';
import { genEastLots } from './eastside';
import { genStores, snapHandmadeStores } from './storegen';
import { isDiagBlock, clearChannel, broadwayLots, addBroadwayLanes, diagConnectors, bwDist, BROADWAY } from './broadway';
import { setGeneratedStores } from '../game/places';

export type District = 'eastbank' | 'financial' | 'brickline' | 'heights' | 'juniper' | 'hillside' | 'cannery' | 'strand' | 'midtown' | 'vista' | 'airfield' | 'oldtown' | 'seacliff';
export const DISTRICT_INFO: Record<District, { name: string; color: string; pedDensity: number; trafficDensity: number }> = {
  financial: { name: 'Anchor Row (Financial)', color: '#8a8f99', pedDensity: 1.1, trafficDensity: 0.9 },
  brickline: { name: 'Brickline', color: '#b8674d', pedDensity: 1, trafficDensity: 0.8 },
  heights: { name: 'Meridian Heights', color: '#4f7f8f', pedDensity: 1.2, trafficDensity: 1.2 },
  juniper: { name: 'Juniper Park', color: '#5f8f4f', pedDensity: 0.8, trafficDensity: 0.6 },
  hillside: { name: 'Hillside', color: '#c79a5b', pedDensity: 0.6, trafficDensity: 0.6 },
  cannery: { name: 'Cannery Docks', color: '#7a7268', pedDensity: 0.3, trafficDensity: 0.7 },
  strand: { name: 'Saltwater Strand', color: '#e0b48a', pedDensity: 1, trafficDensity: 0.9 },
  midtown: { name: 'Midtown', color: '#9a7f6a', pedDensity: 0.9, trafficDensity: 1 },
  vista: { name: 'Vista Hills', color: '#6f8a4f', pedDensity: 0.1, trafficDensity: 0.4 },
  oldtown: { name: 'Old Town', color: '#a07a5a', pedDensity: 1.1, trafficDensity: 0.8 },
  seacliff: { name: 'Seacliff', color: '#d79a8a', pedDensity: 0.9, trafficDensity: 0.7 },
  eastbank: { name: 'Eastbank', color: '#9a8a6e', pedDensity: 0.7, trafficDensity: 0.7 },
  airfield: { name: 'Meridian Airfield', color: '#8a8a86', pedDensity: 0.05, trafficDensity: 0.3 },
};

export const LANE_WIDTH = 3.6;
export const SIDEWALK = 4.5;
export const CURB_HEIGHT = 0.18;
export const AVENUES = [-450, -350, -250, -150, -50, 50, 150, 250, 350, 450];
export const STREETS = [-400, -300, -200, -100, 0, 100, 200, 300, 400, 500, 600, 700, 780, 850, 910];
export const WATER_LEVEL = -1.2;
export const COAST_Z = 962; // beach ends and the sea begins south of this line
export const HARBOR_X = 560; // quay edge on the east side
export const SEABED_Y = -7; // open water south of the beach and east of the quay
export const SEA_EDGE_Z = 1150; // swimmable sea ends here (invisible wall)
export const SEA_EDGE_X = 1075;
/** The East River between the island's quay (HARBOR_X) and the eastern shore, crossed by two suspension bridges. */
export const EAST_RIVER = { x0: HARBOR_X, x1: 690, z0: -62 };
/** The eastern shore strip (low-rise Eastbank): streets, lots, piers and a park; joined north to Fort Calder and the airfield. */
export const EAST_SHORE = { x0: 690, x1: 1060, z0: -62, z1: COAST_Z };
export const EAST_BRIDGE_ZS = [100, 400];
export const EAST_GRID = { xs: [760, 930], zs: [-20, 100, 250, 400, 550, 700, 850] };
/** Suspension towers (x) and deck height of the two East River bridges. */
export const EAST_BRIDGE_TOWERS = [585, 665];
export const EAST_DECK_Y = 5.5;
/**
 * Manhattan-style island: per block row (between STREETS[j] and STREETS[j+1]) the first kept avenue column. The grid
 * tapers toward the south tip (Financial District); everything west of it is the Hudson-like river, and the old
 * west districts are the mainland across it (joined by bridges).
 */
export const ISLAND_LEFT = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 2, 3, 3];
/** The western river between the island and the mainland (bridged by the four west streets). */
export const WEST_RIVER = { x0: -526, x1: -464, z0: -700 };
/** The mainland's southern coast (water beyond). */
export const MAINLAND_Z1 = 440;
export function blockKept(i: number, j: number): boolean { return j >= 0 && j < ISLAND_LEFT.length && i >= ISLAND_LEFT[j] && i <= AVENUES.length - 2; }
/** West edge (x) of the island's ground at depth z (strips overlap by a street half width). Infinity outside the island rows. */
export function islandLeftEdge(z: number): number {
  let best = Infinity;
  for (let j = 0; j < ISLAND_LEFT.length; j++) {
    const z0 = STREETS[j] - 8, z1 = STREETS[j + 1] + 8;
    if (z >= z0 && z <= z1) best = Math.min(best, AVENUES[ISLAND_LEFT[j]] - 14);
  }
  if (z > STREETS[STREETS.length - 1] + 8) best = AVENUES[ISLAND_LEFT[ISLAND_LEFT.length - 1]] - 14;
  return best;
}
export interface ShoreSeg { x0: number; z0: number; x1: number; z1: number }
/** The island's shoreline as axis-aligned wall segments (west side of the grid; the taper steps toward the south tip). */
export function islandShore(northEdge: number, southEdge: number): ShoreSeg[] {
  const segs: ShoreSeg[] = [];
  let r0 = 0;
  while (r0 < ISLAND_LEFT.length) {
    let r1 = r0; while (r1 + 1 < ISLAND_LEFT.length && ISLAND_LEFT[r1 + 1] === ISLAND_LEFT[r0]) r1++;
    const x = AVENUES[ISLAND_LEFT[r0]] - 14;
    const zA = r0 === 0 ? northEdge : STREETS[r0] + 8, zB = r1 === ISLAND_LEFT.length - 1 ? southEdge : STREETS[r1 + 1] + 8;
    segs.push({ x0: x, z0: zA, x1: x, z1: zB });
    if (r1 < ISLAND_LEFT.length - 1) segs.push({ x0: x, z0: zB, x1: AVENUES[ISLAND_LEFT[r1 + 1]] - 14, z1: zB });
    r0 = r1 + 1;
  }
  return segs;
}

export function islandWater(x: number, z: number): boolean {
  if (x > WEST_RIVER.x0 && x < WEST_RIVER.x1 && z > WEST_RIVER.z0) return true;
  if (x <= WEST_RIVER.x0 && z > MAINLAND_Z1) return true;
  if (x >= WEST_RIVER.x1 && z > STREETS[0] - 10 && x < AVENUES[AVENUES.length - 1] && x < islandLeftEdge(z)) return true;
  if (z > EAST_RIVER.z0 && x > EAST_RIVER.x0 && x < EAST_RIVER.x1) return true; // the East River
  if (x >= EAST_SHORE.x0 && (z > EAST_SHORE.z1 || x > EAST_SHORE.x1) && z > EAST_RIVER.z0) return true; // sea around the eastern shore
  return false;
}
export const MAP_BOUNDS = { minX: -1080, maxX: 1110, minZ: -470, maxZ: 1100 };

export const AVENUE_NAMES = ['Ridge Ave', 'Lantern Ave', 'Cooper Ave', 'Marrow Ave', 'Meridian Blvd', 'Solace Ave', 'Fennel Ave', 'Tidewell Ave', 'Ashby Ave', 'Harbor Way'];
export const STREET_NAMES = ['North Crest St', '1st St', '2nd St', '3rd St', 'Sunset Blvd', '5th St', '6th St', 'Boardwalk St', 'Coastal Dr', 'Park Row', 'Bleecker Row', 'Union Row', 'Wharf St', 'Stone St', 'Battery Dr'];

export function lanesForAvenue(_i: number): 1 | 2 { return 2; } // two lanes each way everywhere (Manhattan-style)
export function lanesForStreet(j: number): 1 | 2 { return j >= 12 ? 1 : 2; } // the old Financial District streets are narrow
export function halfWidth(lanes: number): number { return lanes * LANE_WIDTH + 0.8; }

export interface V2 { x: number; z: number }
export interface Road { id: number; axis: 'x' | 'z'; index: number; coord: number; from: number; to: number; lanes: 1 | 2; half: number; name: string }
export interface Intersection { id: number; ix: number; iz: number; x: number; z: number; halfX: number; halfZ: number; offset: number; signalized: boolean; /** Round 9: Broadway crosses here: a third signal phase for the diagonal */ diag?: boolean }
/** Signal group: 'z' north/south road, 'x' east/west road, 'd' Broadway's diagonal (only at diag junctions). */
export type SigAxis = 'x' | 'z' | 'd';
/** The signal group a lane is controlled by. */
export function laneSigAxis(lane: { axis: 'x' | 'z'; diag?: boolean }): SigAxis { return lane.diag ? 'd' : lane.axis; }
export interface Block { id: number; ix: number; iz: number; x0: number; x1: number; z0: number; z1: number; district: District; kind: 'buildings' | 'park' | 'plaza' | 'docks'; /** cut diagonally by Broadway into two triangles */ diag?: boolean }
export type LotKind = 'brownstone' | 'pastel' | 'tower' | 'midrise' | 'warehouse' | 'house';
export interface Lot { id: number; blockId: number; /** lots outside the grid (blockId -1) carry their own district; street=false means no street frontage */ district?: District; street?: boolean; x: number; z: number; w: number; d: number; rot: number; kind: LotKind; height: number; seed: number }
export interface Lane {
  id: number; points: V2[]; length: number; cum: number[]; next: number[]; connector: boolean;
  intersection: number; axis: 'x' | 'z'; speed: number; lane: number; lanes: number; roadId: number;
  /** same-direction neighbour lanes a driver may change into (road lanes only; lane 0 is nearest the centre line) */
  leftLane?: number; rightLane?: number;
  /** surface height per point (absent = street level); freeway, ramps and hill roads carry it */
  ys?: number[];
  /** Broadway's diagonal lanes (connectors to them are built separately) */
  diag?: boolean;
}
export interface P3 { x: number; y: number; z: number }
/** A free-form road outside the grid (freeway, ramps, hill road, airfield road): centreline with heights. */
export interface PathRoad {
  id: number; name: string; kind: 'freeway' | 'ramp' | 'hill' | 'service' | 'street'; pts: P3[]; half: number; lanes: 1 | 2;
  elevated: boolean; from: number; to: number;
}
export interface PedNode { id: number; x: number; z: number; /** surface height (bridge walkways); absent = street level */ y?: number; blockId: number; edges: { to: number; crossing: null | { intersection: number; axis: 'x' | 'z' } }[] }

export interface CityMap {
  roads: Road[]; intersections: Intersection[]; blocks: Block[]; lots: Lot[]; lanes: Lane[]; pedNodes: PedNode[];
  paths: PathRoad[];
  intersectionAt: (ix: number, iz: number) => Intersection | undefined;
}

export function districtFor(ix: number, iz: number): District {
  if (iz >= 11) return ix === 8 ? 'cannery' : 'financial';
  if (ix === 8 && iz >= 3) return 'cannery';
  if ((ix === 4 || ix === 5) && iz <= 2) return 'juniper'; // the big central park (2 x 3 blocks)
  if (ix >= 7 && iz <= 2) return 'hillside';
  if (ix >= 4 && ix <= 6 && iz >= 3 && iz <= 4) return 'heights';
  if (ix <= 3 && iz <= 3) return 'brickline';
  if (iz >= 9 && ix <= 1) return 'oldtown';
  return 'midtown';
}

/**
 * Round 9 (owner: AI cars turned "crazy recklessly and quickly"): speed through a turn of radius R (m) at a calm ~2.4 m/s²
 * of lateral acceleration, like a real driver in town: a tight right turn ~4 m/s (9 mph), a wide left ~6 m/s. Pure.
 */
export function turnSpeed(R: number): number { return Math.max(3.6, Math.min(8, Math.sqrt(2.4 * Math.max(0, R)))); }
export const SIGNAL_CYCLE = [13, 3, 2.2, 13, 3, 2.2]; // Round 9: 2.2 s all-red (1.5 let late-amber cars meet the next green in wide junctions)
export const SIGNAL_PERIOD = SIGNAL_CYCLE.reduce((a, b) => a + b, 0);
/** Round 9: junctions Broadway cuts through get a third phase (the diagonal goes while both grid roads hold at red). */
export const DIAG_CYCLE = [13, 3, 2.2, 13, 3, 2.2, 10, 3, 2.2];
export const DIAG_PERIOD = DIAG_CYCLE.reduce((a, b) => a + b, 0);
/** Current signal group (0 = z, 1 = x, 2 = diagonal), step in it (0 green, 1 amber, 2 all-red) and seconds left in that step. */
export function signalPhase(inter: Intersection, time: number): { group: number; step: number; left: number } {
  const cyc = inter.diag ? DIAG_CYCLE : SIGNAL_CYCLE, per = inter.diag ? DIAG_PERIOD : SIGNAL_PERIOD;
  let t = (((time + inter.offset) % per) + per) % per, phase = 0;
  while (phase < cyc.length - 1 && t >= cyc[phase]) { t -= cyc[phase]; phase++; }
  return { group: Math.floor(phase / 3), step: phase % 3, left: cyc[phase] - t };
}
const groupOf = (axis: SigAxis) => axis === 'z' ? 0 : axis === 'x' ? 1 : 2;
/** State of the traffic signal for vehicles travelling along `axis` ('z' = north/south road, 'd' = Broadway). */
export function signalState(inter: Intersection, axis: SigAxis, time: number): 'green' | 'yellow' | 'red' {
  if (!inter.signalized) return 'green';
  if (axis === 'd' && !inter.diag) axis = 'z';
  const ph = signalPhase(inter, time);
  if (ph.group !== groupOf(axis) || ph.step === 2) return 'red';
  return ph.step === 0 ? 'green' : 'yellow';
}
/** Seconds until the amber for `axis` ends (Infinity unless it is amber now). */
export function yellowLeft(inter: Intersection, axis: SigAxis, time: number): number {
  if (!inter.signalized) return Infinity;
  if (axis === 'd' && !inter.diag) axis = 'z';
  const ph = signalPhase(inter, time);
  return ph.group === groupOf(axis) && ph.step === 1 ? ph.left : Infinity;
}
/** Seconds of each green phase during which the walking person shows (nobody should start crossing after that). */
export const PED_WALK_TIME = 5;
export type PedSignal = 'walk' | 'flash' | 'dont';
/**
 * Pedestrian signal for a crosswalk over the road running along `roadAxis`: WALK for the first PED_WALK_TIME seconds of the
 * cross street's green, then a flashing hand (finish crossing, do not start) through the rest of that green and the yellow,
 * then a solid hand while the crossed road has (or is about to get) its green.
 */
export function pedSignal(inter: Intersection, roadAxis: 'x' | 'z', time: number): PedSignal {
  if (!inter.signalized) return 'walk';
  const ph = signalPhase(inter, time), other = roadAxis === 'x' ? 0 : 1; // walk with the cross street's green
  if (ph.group !== other || ph.step === 2) return 'dont';
  const cyc = inter.diag ? DIAG_CYCLE : SIGNAL_CYCLE, intoGreen = cyc[other * 3] - (ph.step === 0 ? ph.left : 0);
  return ph.step === 0 && intoGreen < PED_WALK_TIME ? 'walk' : 'flash';
}
/** Pedestrians may START crossing a road running along `roadAxis` only while the walk sign shows. */
export function pedestrianMayCross(inter: Intersection, roadAxis: 'x' | 'z', time: number): boolean {
  return pedSignal(inter, roadAxis, time) === 'walk';
}

function polyLength(points: V2[]): { length: number; cum: number[] } {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
  return { length: cum[cum.length - 1], cum };
}
export function samplePath(lane: { points: V2[]; cum: number[]; length: number; ys?: number[] }, s: number, out: { x: number; z: number; dx: number; dz: number; y?: number }) {
  const pts = lane.points, cum = lane.cum;
  if (s <= 0) s = 0; if (s >= lane.length) s = lane.length - 1e-6;
  let i = 1;
  while (i < cum.length - 1 && cum[i] < s) i++;
  const a = pts[i - 1], b = pts[i];
  const seg = cum[i] - cum[i - 1] || 1;
  const t = (s - cum[i - 1]) / seg;
  out.x = a.x + (b.x - a.x) * t; out.z = a.z + (b.z - a.z) * t;
  out.dx = (b.x - a.x) / seg; out.dz = (b.z - a.z) / seg;
  if (lane.ys) out.y = lane.ys[i - 1] + (lane.ys[i] - lane.ys[i - 1]) * t; else if (out.y !== undefined) out.y = 0;
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
      if (!(blockKept(i - 1, j - 1) || blockKept(i, j - 1) || blockKept(i - 1, j) || blockKept(i, j))) continue;
      const inter: Intersection = {
        id: intersections.length, ix: i, iz: j, x: AVENUES[i], z: STREETS[j],
        halfX: halfWidth(lanesForAvenue(i)), halfZ: halfWidth(lanesForStreet(j)),
        // progressive timing (swept offline for real city speeds, 9-13 m/s): 4 s per grid step cuts red waiting by about a third versus random offsets, both ways
        offset: ((i + j) * 4) % SIGNAL_PERIOD,
        signalized: !((i === 0 || i === nx - 1) && (j === 0 || j === nz - 1)),
      };
      intersections.push(inter); interGrid[i][j] = inter;
    }
  }
  // Roads: one entry per segment between adjacent intersections
  for (let i = 0; i < nx; i++) for (let j = 0; j < nz - 1; j++) {
    if (!(blockKept(i - 1, j) || blockKept(i, j))) continue;
    const a = interGrid[i][j], b = interGrid[i][j + 1];
    roads.push({ id: roads.length, axis: 'z', index: i, coord: AVENUES[i], from: a.z + a.halfZ, to: b.z - b.halfZ, lanes: lanesForAvenue(i), half: halfWidth(lanesForAvenue(i)), name: AVENUE_NAMES[i] });
  }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx - 1; i++) {
    if (!(blockKept(i, j - 1) || blockKept(i, j))) continue;
    const a = interGrid[i][j], b = interGrid[i + 1][j];
    roads.push({ id: roads.length, axis: 'x', index: j, coord: STREETS[j], from: a.x + a.halfX, to: b.x - b.halfX, lanes: lanesForStreet(j), half: halfWidth(lanesForStreet(j)), name: STREET_NAMES[j] });
  }

  // Blocks
  for (let i = 0; i < nx - 1; i++) for (let j = 0; j < nz - 1; j++) {
    if (!blockKept(i, j)) continue;
    const district = districtFor(i, j);
    const x0 = AVENUES[i] + halfWidth(lanesForAvenue(i)), x1 = AVENUES[i + 1] - halfWidth(lanesForAvenue(i + 1));
    const z0 = STREETS[j] + halfWidth(lanesForStreet(j)), z1 = STREETS[j + 1] - halfWidth(lanesForStreet(j + 1));
    let kind: Block['kind'] = 'buildings';
    if (district === 'juniper') kind = 'park';
    else if (district === 'cannery') kind = 'docks';
    else if ((i === 3 && j === 1) || (i === 2 && j === 5) || (i === 6 && j === 7) || (i === 3 && j === 10)) kind = 'plaza';
    blocks.push({ id: blocks.length, ix: i, iz: j, x0, x1, z0, z1, district, kind, ...(isDiagBlock(i, j) ? { diag: true } : {}) });
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
    const kind: LotKind = b.district === 'brickline' || b.district === 'financial' ? 'brownstone' : b.district === 'strand' || b.district === 'hillside' ? 'pastel' : rng.chance(0.5) ? 'midrise' : 'brownstone';
    // Manhattan-style lots: varied frontages and depths, a height per lot, the odd tower, corner buildings first
    const WIDTHS = [6.5, 7.5, 7.5, 9, 10.5, 10.5, 12, 14, 17];
    const pickHeight = (lk: LotKind): number => {
      const d = b.district;
      if (d === 'financial') return rng.chance(0.45) ? rng.range(52, 88) : rng.range(26, 46);
      if (d === 'strand' || d === 'seacliff') return rng.range(7, 14);
      if (d === 'hillside') return 0;
      if (d === 'brickline' || lk === 'brownstone') return rng.chance(0.12) ? rng.range(26, 34) : rng.range(14, 24);
      if (d === 'oldtown') return rng.range(14, 28);
      // midtown / other grid blocks: mid-rise slabs with taller landmark-ish buildings
      return rng.chance(0.2) ? rng.range(46, 78) : rng.range(22, 42);
    };
    type Side = { ax: 'x' | 'z'; fixed: number; from: number; to: number; rot: number };
    const cornerDepth: Record<string, number> = {};
    const place = (s: Side, name: string) => {
      const inward = s.ax === 'x' ? (s.rot === 0 ? -1 : 1) : (s.rot === Math.PI / 2 ? -1 : 1);
      let t = s.from; let first = true; let lastDepth = 10;
      while (s.to - t > 5.5) {
        const rem = s.to - t;
        let wdt = rng.pick(WIDTHS);
        if (rem - wdt < 6.5) wdt = rem;
        if (wdt > 20) wdt = rem / 2;
        const depth = Math.min(rng.range(11, 17.5), wdt < 8 ? 14 : 17.5);
        const tc = t + wdt / 2;
        const x = s.ax === 'x' ? tc : s.fixed + inward * depth / 2;
        const z = s.ax === 'x' ? s.fixed + inward * depth / 2 : tc;
        let lk: LotKind = kind === 'midrise' && rng.chance(0.4) ? 'brownstone' : kind;
        let height = pickHeight(lk);
        if (b.district === 'financial' && wdt >= 9 && height > 50) { lk = 'tower'; height = height / 1.45; }
        if (b.district === 'midtown' && wdt >= 12 && rng.chance(0.2)) { lk = 'tower'; height = rng.range(40, 78) / 1.45; }
        if (first) cornerDepth[name + 'a'] = depth;
        lastDepth = depth; first = false;
        lots.push({ id: lots.length, blockId: b.id, x, z, w: wdt, d: depth, rot: s.rot, kind: lk, height, seed: rng.int(0, 1e9) });
        t += wdt;
        if (rng.chance(0.06) && s.to - t > 14) t += 3; // a narrow alley
      }
      cornerDepth[name + 'b'] = lastDepth;
    };
    // sides: north (faces -z), south (+z), west (-x), east (+x). rot = yaw so model front (+z) faces the street.
    const lotStart = lots.length;
    place({ ax: 'x', fixed: iz0, from: ix0, to: ix1, rot: Math.PI }, 'N');
    place({ ax: 'x', fixed: iz1, from: ix0, to: ix1, rot: 0 }, 'S');
    place({ ax: 'z', fixed: ix0, from: iz0 + cornerDepth.Na, to: iz1 - cornerDepth.Sa, rot: -Math.PI / 2 }, 'W');
    place({ ax: 'z', fixed: ix1, from: iz0 + cornerDepth.Nb, to: iz1 - cornerDepth.Sb, rot: Math.PI / 2 }, 'E');
    if (b.diag) { // Broadway cuts this block into two triangles: drop lots that hit the channel, then add frontage lots along it
      const kept = clearChannel(lots.splice(lotStart));
      for (const l of kept) lots.push({ ...l, id: lots.length });
      lots.push(...broadwayLots(b, lots, rng, lots.length, b.id));
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
        if (k > 0) { lane.leftLane = lane.id - 1; lanes[lane.id - 1].rightLane = lane.id; }
      }
    }
  }
  const paths = buildExpansion(intersections, interGrid, lanes, push);
  addBroadwayLanes(interGrid, lanes, paths, push, polyLength);
  for (let i = BROADWAY.first; i <= BROADWAY.last; i++) { const I = interGrid[i]?.[i]; if (I) I.diag = true; }
  // connectors
  for (const inter of intersections) {
    const ins = laneEnds.get(`${inter.id}:in`) ?? [];
    const outs = laneEnds.get(`${inter.id}:out`) ?? [];
    for (let pass = 0; pass < 2; pass++) for (const li of ins) {
      const a = lanes[li];
      if (a.diag) continue;
      if (pass === 1 && a.next.length > 0) continue;
      const relaxed = pass === 1;
      const ae = a.points[a.points.length - 1], ap = a.points[a.points.length - 2];
      const adx = Math.sign(ae.x - ap.x), adz = Math.sign(ae.z - ap.z);
      for (const lo of outs) {
        const b = lanes[lo];
        if (b.diag) continue;
        const bs = b.points[0], bn = b.points[1];
        const bdx = Math.sign(bn.x - bs.x), bdz = Math.sign(bn.z - bs.z);
        if (adx === -bdx && adz === -bdz) continue; // no U-turns
        const straight = adx === bdx && adz === bdz;
        // turn direction: cross product (a x b).y ; right turn when b = right of a
        const cross = adx * bdz - adz * bdx; // >0 -> b is to the right of a (x east, z south)
        if (relaxed) { if (b.lane !== (cross > 0 ? b.lanes - 1 : 0) && !straight) continue; }
        else if (straight) { if (b.lane !== Math.min(a.lane, b.lanes - 1) && !(inter.ix < 0 && a.lanes < b.lanes)) continue; }
        // Round 7: right turns only from the kerb lane into the kerb lane, left turns only from the inner lane into the inner
        // lane (turning from the other lane cut across straight-on traffic: the owner's main crash source)
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
        const R = straight ? Infinity : Math.min(Math.hypot(ae.x - pts[4].x, ae.z - pts[4].z), Math.hypot(bs.x - pts[4].x, bs.z - pts[4].z)) * 1.2;
        const c: Lane = { id: lanes.length, points: pts, length, cum, next: [lo], connector: true, intersection: inter.id, axis: a.axis, speed: straight ? a.speed : turnSpeed(R), lane: 0, lanes: 1, roadId: -1 };
        if (a.ys || b.ys) { const y0 = a.ys ? a.ys[a.ys.length - 1] : 0, y1 = b.ys ? b.ys[0] : 0; c.ys = pts.map((_, k) => y0 + (y1 - y0) * (k / Math.max(1, pts.length - 1))); }
        lanes.push(c);
        a.next.push(c.id);
      }
    }
    diagConnectors(inter, ins, outs, lanes, polyLength);
  }

  deadEndLoops(paths, intersections, lanes, laneEnds);
  // Pedestrian graph: 4 corner nodes per block, edges along sidewalks and crosswalks
  const cornerId = new Map<string, number>();
  const inset = 2.2;
  const diagTips: { b: Block; A: number; D: number; Cn: number; E: number }[] = [];
  for (const b of blocks) {
    if (b.diag) {
      // Round 7: a block cut by Broadway is two triangular sidewalks; its north-west and south-east corners lie in Broadway's
      // roadway, so peds used to walk diagonally through traffic. Each triangle gets its own loop, and the cut corners
      // hand the north / south crossings to one triangle and the west / east crossings to the other.
      const k = BROADWAY.channel * Math.SQRT2, add = (x: number, z: number) => { pedNodes.push({ id: pedNodes.length, x, z, blockId: b.id, edges: [] }); return pedNodes.length - 1; };
      const A = add(b.x0 + k + inset * 1.6, b.z0 + inset), B = add(b.x1 - inset, b.z0 + inset), Cn = add(b.x1 - inset, b.z1 - k - inset * 1.6);
      const D = add(b.x0 + inset, b.z0 + k + inset * 1.6), E = add(b.x1 - k - inset * 1.6, b.z1 - inset), F = add(b.x0 + inset, b.z1 - inset);
      for (const [a, c] of [[A, B], [B, Cn], [Cn, A], [D, F], [F, E], [E, D]]) { pedNodes[a].edges.push({ to: c, crossing: null }); pedNodes[c].edges.push({ to: a, crossing: null }); }
      const key = (t: string) => `${b.ix},${b.iz},${t}`;
      cornerId.set(key('ne'), B); cornerId.set(key('sw'), F);
      diagTips.push({ b, A, D, Cn, E });
      continue;
    }
    const corners: [number, number, string][] = [[b.x0 + inset, b.z0 + inset, 'nw'], [b.x1 - inset, b.z0 + inset, 'ne'], [b.x1 - inset, b.z1 - inset, 'se'], [b.x0 + inset, b.z1 - inset, 'sw']];
    for (const [x, z, tag] of corners) { cornerId.set(`${b.ix},${b.iz},${tag}`, pedNodes.length); pedNodes.push({ id: pedNodes.length, x, z, blockId: b.id, edges: [] }); }
    const ids = ['nw', 'ne', 'se', 'sw'].map(t => cornerId.get(`${b.ix},${b.iz},${t}`)!);
    for (let k = 0; k < 4; k++) { const a = ids[k], c = ids[(k + 1) % 4]; pedNodes[a].edges.push({ to: c, crossing: null }); pedNodes[c].edges.push({ to: a, crossing: null }); }
  }
  const link = (a: string, c: string, inter: Intersection, axis: 'x' | 'z') => {
    const ia = cornerId.get(`${a}:${axis}`) ?? cornerId.get(a), ic = cornerId.get(`${c}:${axis}`) ?? cornerId.get(c);
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
  // the triangles' tips cross straight over to a point on the neighbouring block's facing sidewalk (that edge is split)
  const splitEdge = (u: number | undefined, v: number | undefined, x: number, z: number, blockId: number): number | null => {
    if (u === undefined || v === undefined) return null;
    pedNodes[u].edges = pedNodes[u].edges.filter(e => e.to !== v); pedNodes[v].edges = pedNodes[v].edges.filter(e => e.to !== u);
    const P = pedNodes.length; pedNodes.push({ id: P, x, z, blockId, edges: [{ to: u, crossing: null }, { to: v, crossing: null }] });
    pedNodes[u].edges.push({ to: P, crossing: null }); pedNodes[v].edges.push({ to: P, crossing: null });
    return P;
  };
  const cross = (a: number, c: number | null, inter: Intersection, axis: 'x' | 'z') => { if (c === null) return; pedNodes[a].edges.push({ to: c, crossing: { intersection: inter.id, axis } }); pedNodes[c].edges.push({ to: a, crossing: { intersection: inter.id, axis } }); };
  const blockAt = (i: number, j: number) => blocks.find(q => q.ix === i && q.iz === j);
  for (const { b, A, D, Cn, E } of diagTips) {
    const i = b.ix, j = b.iz, up = blockAt(i, j - 1), left = blockAt(i - 1, j), right = blockAt(i + 1, j), down = blockAt(i, j + 1);
    if (up) cross(A, splitEdge(cornerId.get(`${i},${j - 1},sw`), cornerId.get(`${i},${j - 1},se`), pedNodes[A].x, up.z1 - inset, up.id), interGrid[i][j], 'x');
    if (left) cross(D, splitEdge(cornerId.get(`${i - 1},${j},ne`), cornerId.get(`${i - 1},${j},se`), left.x1 - inset, pedNodes[D].z, left.id), interGrid[i][j], 'z');
    if (right) cross(Cn, splitEdge(cornerId.get(`${i + 1},${j},nw`), cornerId.get(`${i + 1},${j},sw`), right.x0 + inset, pedNodes[Cn].z, right.id), interGrid[i + 1][j + 1], 'z');
    if (down) cross(E, splitEdge(cornerId.get(`${i},${j + 1},nw`), cornerId.get(`${i},${j + 1},ne`), pedNodes[E].x, down.z0 + inset, down.id), interGrid[i + 1][j + 1], 'x');
  }

  // West extension: lots along the curved frontages, sidewalks for pedestrians
  lots.push(...genWestLots(paths, lots.length, new Rng(seed + 31), SIDEWALK).filter(l => {
    const r = Math.max(l.w, l.d) / 2 + 3;
    return !(l.x + r > WEST_RIVER.x0 && l.x - r < WEST_RIVER.x1) && l.z + r < MAINLAND_Z1;
  }).map((l, k) => ({ ...l, id: lots.length + k })));
  genWestPeds(paths, pedNodes, SIDEWALK);
  lots.push(...genEastLots(paths, lots.length, new Rng(seed + 53), SIDEWALK));
  genWestPeds(paths, pedNodes, SIDEWALK, true);
  addBridgeWalkways(paths, pedNodes, { intersections });
  // ~50 walk-in stores: picked from the street-facing lots (grid and west), resized to the shop footprint
  snapHandmadeStores(lots);
  setGeneratedStores(genStores(lots, blocks, new Rng(seed + 77)));

  return { roads, intersections, blocks, lots, lanes, pedNodes, paths, intersectionAt: (ix, iz) => interGrid[ix]?.[iz] };
}

function nearestCoord(arr: number[], v: number): number {
  let best = arr[0];
  for (const a of arr) if (Math.abs(a - v) < Math.abs(best - v)) best = a;
  return best;
}

/**
 * Round 8: true when a ground-level carriageway passes within `margin` of (x, z): grid avenues/streets, Broadway, the
 * non-elevated paths and their junction pads. Elevated decks above the point don't count (used to keep freeway pillars
 * off the roads underneath).
 */
export function groundRoadAt(city: CityMap, x: number, z: number, groundY: number, margin = 1.5): boolean {
  for (const p of city.paths) {
    const h = pathHeightAt(p, x, z);
    if (h.d < p.half + margin && h.y - groundY < 2.5) return true;
  }
  for (const i of city.intersections) {
    if (i.ix >= 0) continue;
    if (Math.hypot(x - i.x, z - i.z) < Math.max(i.halfX, i.halfZ) * 1.42 + margin && Math.abs(groundY) < 50) {
      const deck = city.paths.some(p => (p.from === i.id || p.to === i.id) && p.elevated && pathHeightAt(p, i.x, i.z).y - groundY > 2.5);
      if (!deck) return true;
    }
  }
  const inGrid = z > STREETS[0] - 9 - margin && z < STREETS[STREETS.length - 1] + 9 + margin && x > AVENUES[0] - 9 - margin && x < AVENUES[AVENUES.length - 1] + 9 + margin;
  if (inGrid) {
    for (let i = 0; i < AVENUES.length; i++) if (Math.abs(x - AVENUES[i]) < halfWidth(lanesForAvenue(i)) + margin) return true;
    for (let j = 0; j < STREETS.length; j++) if (Math.abs(z - STREETS[j]) < halfWidth(lanesForStreet(j)) + margin) return true;
    if (bwDist(x, z) < BROADWAY.channel + margin) return true;
  }
  return false;
}

/** Tidewell Ave elevated rail: the column positions (one each side every 30 m, kerb-side), skipping any that would stand in a
 * cross street or Broadway (Round 8: some stood in Broadway's carriageway). Pure: citybuild builds them, tests check them. */
export const RAIL = { x: AVENUES[7], y: 7.4, z0: STREETS[3], z1: STREETS[12] };
export function railColumns(): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  const blocked = (x: number, z: number) => STREETS.some((sz, j) => Math.abs(z - sz) < halfWidth(lanesForStreet(j)) + 1.4) || bwDist(x, z) < BROADWAY.channel + 1.4;
  for (let z = RAIL.z0 + 6; z < RAIL.z1; z += 30) for (const sg of [-1, 1]) {
    const cz = z + 6, cx = RAIL.x + sg * (halfWidth(2) + 0.7);
    if (blocked(cx, cz) || blocked(cx, cz + 2) || blocked(cx, cz - 2)) continue;
    out.push({ x: cx, z: cz });
  }
  return out;
}

export type Surface = 'road' | 'sidewalk' | 'lot' | 'park' | 'beach' | 'water' | 'quay' | 'offmap';
/** Classifies a point on the ground plane. */
export function surfaceAt(city: CityMap, x: number, z: number): Surface {
  if (z < STREETS[0] - 9 || x > AVENUES[AVENUES.length - 1] + 9 || x < AVENUES[0] - 4) {
    for (const p of city.paths) { const h = pathHeightAt(p, x, z); if (h.d < p.half) return 'road'; }
    for (const i of city.intersections) {
      if (i.ix >= 0) continue;
      const dead = city.paths.filter(p => p.from === i.id || p.to === i.id).length === 1;
      if (Math.hypot(x - i.x, z - i.z) < (dead ? CUL_DE_SAC_R : Math.max(i.halfX, i.halfZ) * 1.42)) return 'road';
    }
  }
  if (islandWater(x, z)) {
    if (x > WEST_RIVER.x0 - 12 && x < WEST_RIVER.x1 + 12) for (const p of city.paths) if (p.kind === 'street' && pathHeightAt(p, x, z).d < p.half + SIDEWALK) return 'sidewalk';
    return 'water';
  }
  if (z > COAST_Z) return 'water';
  if (x >= EAST_SHORE.x0 && x <= EAST_SHORE.x1 && z > EAST_SHORE.z0 && z <= EAST_SHORE.z1) {
    for (const p of city.paths) if (p.kind === 'street' && pathHeightAt(p, x, z).d < p.half + SIDEWALK) return 'sidewalk';
    return 'lot';
  }
  if (x > HARBOR_X && z > -60 && x < SEA_EDGE_X + 40) return 'water';
  if (x > CHANNEL.x0 && x < CHANNEL.x1 && z <= -60) return 'water';
  if (x < WEST.x0 || z < STREETS[0] - 30 || x > SEA_EDGE_X + 40) return 'offmap';
  if (x < AVENUES[0] - 9) {
    for (const p of city.paths) if (p.kind === 'street' && pathHeightAt(p, x, z).d < p.half + SIDEWALK) return 'sidewalk';
    return 'park';
  }
  if (x > AVENUES[AVENUES.length - 1] + 9 && x <= HARBOR_X) return 'quay';
  if (z > STREETS[STREETS.length - 1] + 9) return 'beach';
  for (let i = 0; i < AVENUES.length; i++) if (Math.abs(x - AVENUES[i]) < halfWidth(lanesForAvenue(i)) && z > STREETS[0] - 9 && z < STREETS[STREETS.length - 1] + 9) return 'road';
  for (let j = 0; j < STREETS.length; j++) if (Math.abs(z - STREETS[j]) < halfWidth(lanesForStreet(j)) && x > AVENUES[0] - 9 && x < AVENUES[AVENUES.length - 1] + 9) return 'road';
  if (x > CHANNEL.x1) return 'offmap';
  { const bw = bwDist(x, z); if (bw < BROADWAY.channel) return 'road'; if (bw < BROADWAY.channel + SIDEWALK && x > AVENUES[1] && x < AVENUES[4]) return 'sidewalk'; }
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
  if (x > CHANNEL.x1 && z < -62) return 'airfield';
  if (x >= EAST_SHORE.x0 - 30 && x <= EAST_SHORE.x1 && z >= EAST_SHORE.z0 && z <= EAST_SHORE.z1) return 'eastbank';
  if (z < STREETS[0] - 20) return 'vista';
  if (z > STREETS[STREETS.length - 1]) return 'strand';
  if (x < AVENUES[0] - 4) return z > 150 ? 'seacliff' : 'oldtown';
  if (x > AVENUES[AVENUES.length - 1]) return 'cannery';
  let bi = 0, bj = 0;
  for (let i = 0; i < AVENUES.length - 1; i++) if (x > AVENUES[i]) bi = i;
  for (let j = 0; j < STREETS.length - 1; j++) if (z > STREETS[j]) bj = j;
  return districtFor(bi, bj);
}
/** Round 11 perf: lane segments bucketed in a 40 m grid (nearestLane was a full scan of every lane, ~5% of a frame). */
const LANE_CELL = 40;
interface LaneGrid { cells: Map<number, number[]>; minX: number; minZ: number; segs: { li: number; si: number }[] }
const laneGrids = new WeakMap<CityMap, LaneGrid>();
const cellKey = (i: number, j: number) => i * 4096 + j;
function laneGrid(city: CityMap): LaneGrid {
  let g = laneGrids.get(city);
  if (g) return g;
  let minX = Infinity, minZ = Infinity;
  for (const l of city.lanes) for (const p of l.points) { minX = Math.min(minX, p.x); minZ = Math.min(minZ, p.z); }
  g = { cells: new Map(), minX: minX - 1, minZ: minZ - 1, segs: [] };
  city.lanes.forEach((l, li) => {
    for (let i = 1; i < l.points.length; i++) {
      const a = l.points[i - 1], b = l.points[i], k = g!.segs.push({ li, si: i }) - 1;
      const i0 = Math.floor((Math.min(a.x, b.x) - g!.minX) / LANE_CELL), i1 = Math.floor((Math.max(a.x, b.x) - g!.minX) / LANE_CELL);
      const j0 = Math.floor((Math.min(a.z, b.z) - g!.minZ) / LANE_CELL), j1 = Math.floor((Math.max(a.z, b.z) - g!.minZ) / LANE_CELL);
      for (let ci = i0; ci <= i1; ci++) for (let cj = j0; cj <= j1; cj++) { const key = cellKey(ci, cj); let c = g!.cells.get(key); if (!c) g!.cells.set(key, c = []); c.push(k); }
    }
  });
  laneGrids.set(city, g);
  return g;
}
/** Nearest point on any lane (roadOnly: skip junction connectors). Same answer (ties included) as a scan of every lane. */
export function nearestLane(city: CityMap, x: number, z: number, roadOnly = true): { lane: Lane; s: number; dist: number } | null {
  const g = laneGrid(city);
  let best = null as { lane: Lane; s: number; dist: number } | null, bLi = 0, bSi = 0;
  const ci = Math.floor((x - g.minX) / LANE_CELL), cj = Math.floor((z - g.minZ) / LANE_CELL);
  const seen = new Set<number>();
  for (let r = 0; r < 64; r++) {
    for (let di = -r; di <= r; di++) for (let dj = -r; dj <= r; dj++) {
      if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
      const cell = g.cells.get(cellKey(ci + di, cj + dj)); if (!cell) continue;
      for (const k of cell) {
        if (seen.has(k)) continue; seen.add(k);
        const { li, si } = g.segs[k], lane = city.lanes[li];
        if (roadOnly && lane.connector) continue;
        const a = lane.points[si - 1], b = lane.points[si];
        const vx = b.x - a.x, vz = b.z - a.z; const l2 = vx * vx + vz * vz || 1;
        let t = ((x - a.x) * vx + (z - a.z) * vz) / l2; t = Math.max(0, Math.min(1, t));
        const d = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
        if (!best || d < best.dist || (d === best.dist && (li < bLi || (li === bLi && si < bSi)))) { best = { lane, s: lane.cum[si - 1] + Math.sqrt(l2) * t, dist: d }; bLi = li; bSi = si; }
      }
    }
    // everything within r cells of the query cell has been seen: an answer closer than that ring's inner edge is final
    if (best && best.dist <= r * LANE_CELL) return best;
  }
  return best ?? nearestLaneScan(city, x, z, roadOnly);
}
/** The reference full scan (kept for tests and as a fallback far outside the map). */
export function nearestLaneScan(city: CityMap, x: number, z: number, roadOnly = true): { lane: Lane; s: number; dist: number } | null {
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

const routeCache = new WeakMap<CityMap, { prev: number[][]; chg: number[][]; fields: Map<string, Float32Array> }>();
/**
 * Driving distance from the start of every lane to a target point, following the lane graph
 * (reverse Dijkstra seeded by the lanes that pass near the target). Quantised and cached per 10 m cell.
 */
/**
 * One step along a route field from `lane`: the next connector to take, or the neighbouring lane to change into
 * (`change` true), or null when the target lies on this lane (or cannot be reached).
 */
export function routeStep(city: CityMap, field: Float32Array, lane: Lane): { id: number; change: boolean } | null {
  let id = -1, best = Infinity, change = false;
  for (const n of lane.next) { const c = lane.length + field[n]; if (c < best) { best = c; id = n; } }
  for (const q of [lane.leftLane, lane.rightLane]) if (q !== undefined) { const c = field[q] + LANE_CHANGE_COST; if (c < best - 0.5) { best = c; id = q; change = true; } }
  if (id < 0 || !Number.isFinite(best) || best > field[lane.id] + 0.5) return null;
  return { id, change };
}
/** Route cost (m) of moving over to the neighbouring lane. */
export const LANE_CHANGE_COST = 25;
export function routeField(city: CityMap, x: number, z: number): Float32Array {
  let c = routeCache.get(city);
  if (!c) {
    const prev: number[][] = city.lanes.map(() => []), chg: number[][] = city.lanes.map(() => []);
    for (const l of city.lanes) { for (const n of l.next) prev[n].push(l.id); for (const q of [l.leftLane, l.rightLane]) if (q !== undefined) chg[q].push(l.id); }
    c = { prev, chg, fields: new Map() }; routeCache.set(city, c);
  }
  const key = `${Math.round(x / 10)},${Math.round(z / 10)}`;
  const hit = c.fields.get(key); if (hit) return hit;
  const n = city.lanes.length, D = new Float32Array(n).fill(Infinity);
  // seeds: lanes passing within 14 m of the target, costed by the distance along the lane to its closest point
  let bestLane = -1, bestD = Infinity, bestS = 0;
  for (const lane of city.lanes) {
    let ld = Infinity, ls = 0;
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1], b = lane.points[i];
      const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
      const d = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
      if (d < ld) { ld = d; ls = lane.cum[i - 1] + Math.sqrt(l2) * t; }
    }
    if (ld < 14) D[lane.id] = ls + ld * 2;
    if (ld < bestD) { bestD = ld; bestLane = lane.id; bestS = ls; }
  }
  if (bestLane >= 0 && !Number.isFinite(D[bestLane])) D[bestLane] = bestS;
  // target off the roads (sea, building): also seed every lane about as close as the nearest one, so a lane that is hard to reach does not isolate it
  if (bestD >= 14) for (const lane of city.lanes) {
    if (lane.connector || Number.isFinite(D[lane.id])) continue;
    let ld = Infinity, ls = 0;
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1], b = lane.points[i], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
      const d = Math.hypot(x - (a.x + vx * t), z - (a.z + vz * t));
      if (d < ld) { ld = d; ls = lane.cum[i - 1] + Math.sqrt(l2) * t; }
    }
    if (ld < bestD + 12) D[lane.id] = ls + (ld - bestD) * 2;
  }
  // binary-heap Dijkstra over reversed edges: D[p] = p.length + D[next]
  const heap: number[] = [];
  const push = (id: number) => { heap.push(id); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (D[heap[p]] <= D[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop()!; if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && D[heap[l]] < D[heap[m]]) m = l; if (r < heap.length && D[heap[r]] < D[heap[m]]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  const done = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (Number.isFinite(D[i])) push(i);
  while (heap.length) {
    const id = pop(); if (done[id]) continue; done[id] = 1;
    for (const p of c.prev[id]) { const cand = city.lanes[p].length + D[id]; if (cand < D[p]) { D[p] = cand; push(p); } }
    // a lane change to the neighbouring lane (turns leave from one lane only, so routes need them)
    for (const p of c.chg[id]) { const cand = D[id] + LANE_CHANGE_COST; if (cand < D[p]) { D[p] = cand; push(p); } }
  }
  if (c.fields.size > 48) c.fields.clear();
  c.fields.set(key, D);
  return D;
}

// ---------------- Expansion: freeway, ramps, bridge, hill road, airfield road ----------------
export const FREEWAY_Z = -480;
export const DECK_Y = 7;
/** Radius of the paved turning circle at dead-end junctions. */
export const CUL_DE_SAC_R = 22;
export const CHANNEL = { x0: 492, x1: 560, z1: -62 };
export const LOOKOUT = { x: -40, z: -860 };
export const AIRFIELD = { x0: 775, x1: 985, z0: -760, z1: -130, runwayX: 930, apronX: 840, gateZ: -230 };
/** Fort Calder: far north-east of the city on the flat plain, off the north end of Fort Calder Rd (gate on the east side). */
export const ARMY_BASE = { x0: 595, x1: 735, z0: -740, z1: -560, gateZ: -650, name: 'Fort Calder' };
/** Where Fort Calder Rd ends outside the gate. */
export const ARMY_ROAD_END = { x: 760, z: -650 };

function catmull(ctrl: P3[], step: number): P3[] {
  const out: P3[] = [];
  for (let i = 0; i < ctrl.length - 1; i++) {
    const p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
    const n = Math.max(1, Math.ceil(Math.hypot(p2.x - p1.x, p2.z - p1.z) / step));
    for (let k = 0; k < n; k++) {
      const t = k / n, t2 = t * t, t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) => 0.5 * ((2 * b) + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y), z: f(p0.z, p1.z, p2.z, p3.z) });
    }
  }
  out.push({ ...ctrl[ctrl.length - 1] });
  return out;
}
/** Height of a path centreline at the closest point to (x,z); returns distance too. */
/**
 * Pedestrian paths along the outboard walkways of the two East River suspension bridges (see eastbuild suspension()):
 * a node every 20 m at the deck height, joined at each end to the nearest sidewalk node of its shore.
 */
function addBridgeWalkways(paths: PathRoad[], nodes: PedNode[], city: { intersections: Intersection[] }) {
  const ground = nodes.length;
  for (const bz of EAST_BRIDGE_ZS) {
    const path = paths.find(p => p.kind === 'freeway' && p.pts[0].x > 500 && p.pts[0].x < 540 && Math.abs(p.pts[0].z - bz) < 2 && p.pts[p.pts.length - 1].x > 700);
    if (!path) continue;
    for (const sg of [-1, 1]) {
      const z = bz + sg * (path.half + 5.1);
      const ids: number[] = [];
      for (let x = 535; x <= 735; x += 20) {
        const id = nodes.length; nodes.push({ id, x, z, y: pathHeightAt(path, x, bz).y + 0.15, blockId: -1, edges: [] });
        if (ids.length) { const p = ids[ids.length - 1]; nodes[p].edges.push({ to: id, crossing: null }); nodes[id].edges.push({ to: p, crossing: null }); }
        ids.push(id);
      }
      // approach along the ramp side from the Harbor Way sidewalk (x = 439) up to the walkway
      let prevId = ids[0];
      for (let x = 510; x >= 460; x -= 25) {
        const id = nodes.length; nodes.push({ id, x, z: z - sg * 3, blockId: -1, edges: [{ to: prevId, crossing: null }] }); nodes[prevId].edges.push({ to: id, crossing: null }); prevId = id;
      }
      ids.unshift(prevId);
      // the approach crosses the Harbor Way drive at its junction with the ramp: mark that leg as a crossing (cars brake for people on it)
      const jn = city.intersections.reduce((b, i) => Math.hypot(i.x - 522, i.z - bz) < Math.hypot(b.x - 522, b.z - bz) ? i : b, city.intersections[0]);
      const n510 = nodes.findIndex(n => n.x === 510 && n.z === z - sg * 3);
      for (const [from, to] of [[ids[1], n510], [n510, ids[1]]]) { const e = nodes[from]?.edges.find(x => x.to === to); if (e) e.crossing = { intersection: jn.id, axis: 'z' }; }
      for (const [end, west] of [[ids[0], true], [ids[ids.length - 1], false]] as [number, boolean][]) {
        let best = -1, bd = west ? 40 : 90;
        for (let k = 0; k < ground; k++) { const n = nodes[k]; if ((n.y ?? 0) > 0.3 || (west ? n.x > 600 : n.x < 600)) continue; const d = Math.hypot(n.x - nodes[end].x, n.z - nodes[end].z); if (d < bd) { bd = d; best = k; } }
        if (best >= 0) { nodes[best].edges.push({ to: end, crossing: null }); nodes[end].edges.push({ to: best, crossing: null }); }
      }
    }
  }
}
export function pathHeightAt(path: PathRoad, x: number, z: number): { y: number; d: number; t: number } {
  let best = { y: 0, d: Infinity, t: 0 };
  const p = path.pts;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1], b = p[i], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
    const t = Math.max(0, Math.min(1, ((x - a.x) * vx + (z - a.z) * vz) / l2));
    const d = Math.hypot(x - a.x - vx * t, z - a.z - vz * t);
    if (d < best.d) best = { y: a.y + (b.y - a.y) * t, d, t: (i - 1 + t) / (p.length - 1) };
  }
  return best;
}

function buildExpansion(intersections: Intersection[], interGrid: Intersection[][], lanes: Lane[], push: (key: string, id: number) => void): PathRoad[] {
  const paths: PathRoad[] = [];
  const junction = (x: number, z: number, half: number): Intersection => {
    const j: Intersection = { id: intersections.length, ix: -1, iz: -1, x, z, halfX: half, halfZ: half, offset: 0, signalized: false };
    intersections.push(j); return j;
  };
  const fwHalf = halfWidth(2), rampHalf = halfWidth(1);
  const JW = junction(-450, FREEWAY_Z, fwHalf), JT = junction(250, FREEWAY_Z, fwHalf), JA = junction(760, FREEWAY_Z, rampHalf);
  const JL = junction(LOOKOUT.x, LOOKOUT.z, rampHalf), JS = junction(760, -170, rampHalf), JB = junction(ARMY_ROAD_END.x, ARMY_ROAD_END.z, rampHalf);
  const g00 = interGrid[0][0], g40 = interGrid[4][0], g70 = interGrid[7][0];
  /** Adds a path between two intersections; ctrl excludes the ends, which are derived from the junction edges. */
  const add = (name: string, kind: PathRoad['kind'], from: Intersection, fromDir: [number, number], to: Intersection, toDir: [number, number], ctrl: P3[], lanesN: 1 | 2, y0: number, y1: number, elevated: boolean, step = 6) => {
    const half = halfWidth(lanesN);
    const fe = { x: from.x + fromDir[0] * from.halfX, y: y0, z: from.z + fromDir[1] * from.halfZ };
    const te = { x: to.x + toDir[0] * to.halfX, y: y1, z: to.z + toDir[1] * to.halfZ };
    const lead = { x: fe.x + fromDir[0] * 4, y: y0, z: fe.z + fromDir[1] * 4 }, tail = { x: te.x + toDir[0] * 4, y: y1, z: te.z + toDir[1] * 4 };
    const pts = catmull([fe, lead, ...ctrl, tail, te], step);
    const path: PathRoad = { id: paths.length, name, kind, pts, half, lanes: lanesN, elevated, from: from.id, to: to.id };
    paths.push(path);
    // lanes in both directions, offset to the right of travel
    const speed = kind === 'freeway' ? 24 : kind === 'hill' ? 12 : kind === 'street' ? 12 : 15;
    for (const dir of [1, -1]) {
      const seq = dir > 0 ? pts : [...pts].reverse();
      const endI = dir > 0 ? to : from, startI = dir > 0 ? from : to;
      for (let k = 0; k < lanesN; k++) {
        const off = (k + 0.5) * LANE_WIDTH + 0.2;
        const lp: V2[] = [], ys: number[] = [];
        for (let i = 0; i < seq.length; i++) {
          const a = seq[Math.max(0, i - 1)], b = seq[Math.min(seq.length - 1, i + 1)];
          const tx = b.x - a.x, tz = b.z - a.z, tl = Math.hypot(tx, tz) || 1;
          lp.push({ x: seq[i].x + (-tz / tl) * off, z: seq[i].z + (tx / tl) * off }); ys.push(seq[i].y);
        }
        // exact axis-aligned first/last segments for the junction connector logic
        const sd = dir > 0 ? fromDir : toDir, ed = dir > 0 ? toDir : fromDir;
        const s0 = seq[0], e0 = seq[seq.length - 1];
        const right = (dx: number, dz: number) => ({ x: -dz, z: dx });
        const r0 = right(sd[0], sd[1]); lp[0] = { x: s0.x + r0.x * off, z: s0.z + r0.z * off };
        lp.splice(1, 0, { x: lp[0].x + sd[0] * 3, z: lp[0].z + sd[1] * 3 }); ys.splice(1, 0, ys[0]);
        const r1 = right(-ed[0], -ed[1]); const last = { x: e0.x + r1.x * off, z: e0.z + r1.z * off };
        lp[lp.length - 1] = last;
        lp.splice(lp.length - 1, 0, { x: last.x + ed[0] * 3, z: last.z + ed[1] * 3 }); ys.splice(ys.length - 1, 0, ys[ys.length - 1]);
        const { length, cum } = polyLength(lp);
        const axis: 'x' | 'z' = ed[0] !== 0 ? 'x' : 'z';
        const lane: Lane = { id: lanes.length, points: lp, length, cum, next: [], connector: false, intersection: endI.id, axis, speed, lane: k, lanes: lanesN, roadId: -1, ys };
        lanes.push(lane);
        if (k > 0) { lane.leftLane = lane.id - 1; lanes[lane.id - 1].rightLane = lane.id; } // lane changes (turns leave from one lane only)
        push(`${endI.id}:in`, lane.id); push(`${startI.id}:out`, lane.id);
      }
    }
    return path;
  };
  // Ridge Ave ramp: grid (0,0) north edge up to the freeway's west end
  add('Ridge Ave Ramp', 'ramp', g00, [0, -1], JW, [0, 1], [{ x: -450, y: 3.5, z: -442 }], 1, 0, DECK_Y, true);
  // Harbor Freeway: west end -> Tidewell junction -> bridge over the channel -> down to the airfield junction
  add('Harbor Freeway', 'freeway', JW, [1, 0], JT, [-1, 0], [{ x: -100, y: DECK_Y, z: FREEWAY_Z }], 2, DECK_Y, DECK_Y, true, 10);
  add('Harbor Freeway', 'freeway', JT, [1, 0], JA, [-1, 0], [{ x: 450, y: DECK_Y, z: FREEWAY_Z }, { x: 600, y: DECK_Y, z: FREEWAY_Z }, { x: 690, y: 1.5, z: FREEWAY_Z }], 2, DECK_Y, 0, true, 10);
  // Tidewell Ave ramp down to grid (7,0)
  add('Tidewell Ramp', 'ramp', g70, [0, -1], JT, [0, 1], [{ x: 250, y: 3.5, z: -442 }], 1, 0, DECK_Y, true);
  // Vista Drive: Meridian Blvd north under the freeway (overpass) winding up to the lookout
  add('Vista Dr', 'hill', g40, [0, -1], JL, [0, 1], [
    { x: -50, y: 0, z: -470 }, { x: -50, y: 0.5, z: -525 }, { x: -15, y: 5, z: -585 }, { x: -85, y: 13, z: -650 }, { x: -20, y: 22, z: -715 },
    { x: -95, y: 31, z: -780 }, { x: -40, y: 37, z: -830 },
  ], 1, 0, 40, false, 5);
  // Airfield Road: from the freeway's east end south past Fort Calder's gate to the hangars
  add('Airfield Rd', 'service', JA, [0, 1], JS, [0, -1], [{ x: 760, y: 0, z: -330 }], 1, 0, 0, false, 10);
  // Fort Calder Rd (north spur): from the airfield junction up to the army base gate
  add('Fort Calder Access Rd', 'service', JA, [0, -1], JB, [0, 1], [{ x: 760, y: 0, z: -560 }], 1, 0, 0, false, 10);
  // Old Town + Seacliff: curving streets, a roundabout and a winding coast road west of the grid
  buildWestRoads({ junction, add, grid: (i, j) => interGrid[i][j] });
  // Harbor Drive: the waterfront highway along the quay (two lanes each way, ramps into the avenue ends)
  {
    const HW = 522, fwH = fwHalf, Y = 0.2;
    const zs = [-20, 100, 400, 700, 880];
    const J = zs.map((z, k) => junction(HW, z, k === 0 || k === zs.length - 1 ? rampHalf : fwH));
    for (let k = 0; k < J.length - 1; k++) add('Harbor Drive', 'freeway', J[k], [0, 1], J[k + 1], [0, -1], [], 2, Y, Y, false, 10);
    for (const [jz, k] of [[5, 1], [8, 2], [11, 3]] as const) add('Harbor Drive Ramp', 'ramp', interGrid[AVENUES.length - 1][jz], [1, 0], J[k], [-1, 0], [], 1, Y, Y, false, 8);
    // East River: two suspension bridges carry Harbor Drive over to Eastbank, whose street grid also joins Airfield Road
    const H = rampHalf;
    const E = EAST_GRID.xs.map(x => EAST_GRID.zs.map(z => junction(x, z, x === EAST_GRID.xs[0] && EAST_BRIDGE_ZS.includes(z) ? fwHalf : H)));
    const bridgeNames = ['Brookhaven Bridge', 'Eastgate Bridge'];
    EAST_BRIDGE_ZS.forEach((bz, k) => {
      const hz = J[zs.indexOf(bz)], ez = E[0][EAST_GRID.zs.indexOf(bz)];
      add(bridgeNames[k], 'freeway', hz, [1, 0], ez, [-1, 0], [{ x: EAST_BRIDGE_TOWERS[0], y: EAST_DECK_Y, z: bz }, { x: EAST_BRIDGE_TOWERS[1], y: EAST_DECK_Y, z: bz }], 2, Y, 0, true, 10);
    });
    const colNames = ['Shore Road', 'Foundry Row'], rowNames = ['Mill St', 'Brookhaven Way', 'Rope Walk', 'Eastgate Way', 'Cooperage St', 'Dockside Ave', 'Tanner Quay'];
    EAST_GRID.xs.forEach((_x, c) => { for (let r = 0; r < EAST_GRID.zs.length - 1; r++) add(colNames[c], 'street', E[c][r], [0, 1], E[c][r + 1], [0, -1], [], 1, 0, 0, false, 10); });
    EAST_GRID.zs.forEach((_z, r) => add(rowNames[r], 'street', E[0][r], [1, 0], E[1][r], [-1, 0], [], 1, 0, 0, false, 10));
    // signals at the Eastbank grid junctions that meet three or more streets (phases come from signalState like downtown)
    E.forEach((col, c) => col.forEach((j, r) => { if (paths.filter(p => p.from === j.id || p.to === j.id).length >= 3) { j.signalized = true; j.offset = (c * 5.3 + r * 9.1) % SIGNAL_PERIOD; } }));
    add('Fort Calder Rd', 'service', JS, [0, 1], E[0][0], [0, -1], [], 1, 0, 0, false, 10);
  }
  return paths;
}

/** Cul-de-sac loops at dead-end junctions (one path only) so traffic can turn around. */
function deadEndLoops(paths: PathRoad[], intersections: Intersection[], lanes: Lane[], laneEnds: Map<string, number[]>) {
  for (const inter of intersections) {
    if (inter.ix >= 0) continue;
    const touching = paths.filter(p => p.from === inter.id || p.to === inter.id);
    if (touching.length !== 1) continue;
    const ins = laneEnds.get(`${inter.id}:in`) ?? [], outs = laneEnds.get(`${inter.id}:out`) ?? [];
    for (let ii = 0; ii < ins.length; ii++) {
      const li = ins[ii];
      const a = lanes[li]; const b = lanes[outs[ii % Math.max(1, outs.length)]]; if (!b) continue;
      const ae = a.points[a.points.length - 1], ap = a.points[a.points.length - 2], bs = b.points[0];
      const dx = Math.sign(ae.x - ap.x), dz = Math.sign(ae.z - ap.z);
      const cx = (ae.x + bs.x) / 2 + dx * 8, cz = (ae.z + bs.z) / 2 + dz * 8, R = 9;
      const pts: V2[] = [ae];
      const a0 = Math.atan2(ae.z - cz, ae.x - cx);
      for (let k = 1; k < 16; k++) { const ang = a0 - (k / 16) * Math.PI * 2 * 0.92; pts.push({ x: cx + Math.cos(ang) * R, z: cz + Math.sin(ang) * R }); }
      pts.push(bs);
      const { length, cum } = polyLength(pts);
      const y = a.ys ? a.ys[a.ys.length - 1] : 0;
      const c: Lane = { id: lanes.length, points: pts, length, cum, next: [b.id], connector: true, intersection: inter.id, axis: a.axis, speed: 6, lane: 0, lanes: 1, roadId: -1, ys: pts.map(() => y) };
      lanes.push(c); a.next.push(c.id);
    }
  }
}
