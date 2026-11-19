/**
 * City buses: fixed loop routes round main avenues and streets, bus stops (shelter, bench, sign) on the pavement, and AI buses
 * that stop at the kerb, open the door, kneel, let a passenger off and pull away again. The buses are ordinary traffic cars
 * (mode 'goto'), so they obey signals, queue, and can be carjacked and driven like any other vehicle.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CityMap, Lane } from '../world/citymap';
import { samplePath, routeField } from '../world/citymap';
import type { Traffic, AiCar } from './traffic';
import type { Population } from './population';

export interface BusStop { x: number; z: number; /** travel direction */ dx: number; dz: number; lane: number; s: number; /** shelter position on the pavement */ px: number; pz: number }
export interface BusRoute { id: number; stops: BusStop[] }

const sp = { x: 0, z: 0, dx: 0, dz: 0 };
/** Kerb-lane stop point of the first road segment of a street/avenue, travelling `dir` (+1/-1) along its axis. */
function stopOn(city: CityMap, axis: 'x' | 'z', index: number, seg: number, dir: 1 | -1): BusStop | null {
  const roads = city.roads.filter(r => r.axis === (axis === 'z' ? 'z' : 'x') && r.index === index).sort((a, b) => a.from - b.from);
  const road = roads[seg]; if (!road) return null;
  let lane: Lane | null = null;
  for (const l of city.lanes) {
    if (l.roadId !== road.id || l.connector || l.lane !== road.lanes - 1) continue;
    const a = l.points[0], b = l.points[l.points.length - 1];
    if ((axis === 'z' ? b.z - a.z : b.x - a.x) * dir > 0) { lane = l; break; }
  }
  if (!lane || lane.length < 50) return null;
  const s = lane.length * 0.55; samplePath(lane, s, sp);
  const rx = -sp.dz, rz = sp.dx; // right of travel
  return { x: sp.x + rx * 0.5, z: sp.z + rz * 0.5, dx: sp.dx, dz: sp.dz, lane: lane.id, s, px: sp.x + rx * 3.7, pz: sp.z + rz * 3.7 };
}
/** Closed loops (down one avenue, across a street, back up the next avenue and street), spread over the city. Pure: used by tests. */
export function buildBusRoutes(city: CityMap, count = 3): BusRoute[] {
  const cands: { stops: BusStop[]; cx: number; cz: number }[] = [];
  const maxA = Math.max(...city.roads.filter(r => r.axis === 'z').map(r => r.index)), maxS = Math.max(...city.roads.filter(r => r.axis === 'x').map(r => r.index));
  for (let ia = 0; ia + 2 <= maxA; ia += 1) for (let ja = 0; ja + 2 <= maxS; ja += 1) {
    const ib = ia + 2, jb = ja + 2;
    const stops = [stopOn(city, 'z', ia, ja, 1), stopOn(city, 'x', jb, ia + 1, 1), stopOn(city, 'z', ib, ja, -1), stopOn(city, 'x', ja, ia, -1)];
    if (stops.some(s => !s)) continue;
    const st = stops as BusStop[];
    // every leg must be drivable along the one-way lane graph
    let ok = true;
    for (let i = 0; i < 4 && ok; i++) { const nx = st[(i + 1) % 4], f = routeField(city, nx.x, nx.z); ok = Number.isFinite(f[st[i].lane]) && f[st[i].lane] < 900; }
    if (!ok) continue;
    cands.push({ stops: st, cx: st.reduce((a, s) => a + s.x, 0) / 4, cz: st.reduce((a, s) => a + s.z, 0) / 4 });
  }
  const out: BusRoute[] = [];
  const chosen: typeof cands = [];
  while (chosen.length < count && cands.length) {
    let best = 0, bd = -1;
    cands.forEach((c, i) => { const d = chosen.length ? Math.min(...chosen.map(o => Math.hypot(o.cx - c.cx, o.cz - c.cz))) : -Math.hypot(c.cx, c.cz + 100); if (d > bd) { bd = d; best = i; } });
    chosen.push(cands.splice(best, 1)[0]);
  }
  chosen.forEach((c, i) => out.push({ id: i, stops: c.stops }));
  return out;
}

/** One merged mesh per material (metal, glass, blue sign) for every bus stop. */
export function buildStopProps(stops: BusStop[]): { metal: THREE.BufferGeometry; glass: THREE.BufferGeometry; sign: THREE.BufferGeometry } {
  const metal: THREE.BufferGeometry[] = [], glass: THREE.BufferGeometry[] = [], sign: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4(), r = new THREE.Matrix4();
  const box = (arr: THREE.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, M: THREE.Matrix4) => {
    const g = new THREE.BoxGeometry(w, h, d); m.makeTranslation(x, y, z); g.applyMatrix4(m.premultiply(M)); arr.push(g.toNonIndexed());
  };
  for (const s of stops) {
    // local frame: +z along travel, +x toward the road (left of travel), origin on the pavement
    r.makeRotationY(Math.atan2(s.dx, s.dz)); r.setPosition(s.px, 0, s.pz);
    box(metal, 3.0, 0.07, 1.5, 0, 2.55, 0, r);
    for (const z of [-1.4, 1.4]) for (const x of [-0.65, 0.65]) box(metal, 0.07, 2.5, 0.07, x, 1.25, z, r);
    box(metal, 1.7, 0.06, 0.45, -0.3, 0.46, 0, r); box(metal, 1.7, 0.4, 0.05, -0.55, 0.7, 0, r);
    box(metal, 0.07, 3.0, 0.07, 0.9, 1.5, 2.2, r);
    box(glass, 3.0, 1.9, 0.03, -0.72, 1.35, 0, r);
    box(sign, 0.06, 0.55, 0.55, 0.9, 2.85, 2.2, r);
  }
  const mk = (a: THREE.BufferGeometry[]) => a.length ? mergeGeometries(a, false)! : new THREE.BufferGeometry();
  return { metal: mk(metal), glass: mk(glass), sign: mk(sign) };
}

interface BusRun { route: BusRoute; car: AiCar | null; idx: number; dwell: number; waiting: boolean }
export class BusService {
  routes: BusRoute[]; runs: BusRun[] = []; private scene: THREE.Scene; private meshes: THREE.Mesh[] = []; private spawnT = 0;
  /** stats for tests */
  stats = { stops: 0, spawned: 0 };
  constructor(scene: THREE.Scene, private city: CityMap, private traffic: Traffic, private pop: Population, private time: () => number, count = 3) {
    this.scene = scene;
    this.routes = buildBusRoutes(city, count);
    for (const r of this.routes) { this.runs.push({ route: r, car: null, idx: 0, dwell: 0, waiting: false }); if (r.id === 0) this.runs.push({ route: r, car: null, idx: 2, dwell: 0, waiting: false }); }
    const all = this.routes.flatMap(r => r.stops), g = buildStopProps(all);
    const metal = new THREE.MeshStandardMaterial({ color: 0x4a4f55, roughness: 0.55, metalness: 0.6 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fc4d4, roughness: 0.1, metalness: 0.1, transparent: true, opacity: 0.28, depthWrite: false });
    const sign = new THREE.MeshStandardMaterial({ color: 0x1f5fb0, roughness: 0.5, emissive: 0x0a2550, emissiveIntensity: 0.5 });
    for (const [geo, mat] of [[g.metal, metal], [g.glass, glass], [g.sign, sign]] as [THREE.BufferGeometry, THREE.Material][]) {
      const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = mat !== glass; mesh.frustumCulled = false; scene.add(mesh); this.meshes.push(mesh);
    }
  }
  dispose() { for (const m of this.meshes) { this.scene.remove(m); m.geometry.dispose(); } this.meshes.length = 0; }
  private target(stop: BusStop) { return new THREE.Vector3(stop.x, 0.8, stop.z); }
  private head(run: BusRun, car: AiCar) {
    const stop = run.route.stops[run.idx % run.route.stops.length];
    car.mode = 'goto'; car.target = this.target(stop); car.arriveDist = 3.2; car.maxSpeed = 11; run.waiting = false;
    car.onArrive = () => this.arrive(run, car);
  }
  private arrive(run: BusRun, car: AiCar) {
    const v = car.v; run.waiting = true; run.dwell = 7 + Math.random() * 5; car.maxSpeed = 0; this.stats.stops++;
    const di = v.doorIndex('right', 0); if (di >= 0) v.setDoor(di, 1);
    v.kneel = 1;
    // a passenger gets off
    if (Math.random() < 0.8) {
      const p = v.doorPoint(-1), n = this.pop.spawn('civilian', p.x, p.z, Math.max(0.2, v.position.y), undefined);
      n.node = -1; n.nextNode = -1; n.char.yaw = v.yaw; n.char.human.playAction('exit_car');
    }
  }
  private depart(run: BusRun, car: AiCar) {
    const v = car.v; const di = v.doorIndex('right', 0); if (di >= 0) v.setDoor(di, 0);
    v.kneel = 0; run.idx = (run.idx + 1) % run.route.stops.length; this.head(run, car);
  }
  update(dt: number, focus: THREE.Vector3) {
    this.spawnT -= dt;
    for (const run of this.runs) {
      const car = run.car;
      if (car) {
        if (!this.traffic.cars.includes(car)) { // stolen, destroyed or despawned
          if (!car.v.destroyed) { const di = car.v.doorIndex('right', 0); if (di >= 0) car.v.setDoor(di, 0); car.v.kneel = 0; }
          run.car = null; continue;
        }
        if (run.waiting) { run.dwell -= dt; if (run.dwell <= 0) this.depart(run, car); }
        continue;
      }
      if (this.spawnT > 0) continue;
      this.spawnT = 1.5;
      // appear at a stop's approach, unseen and not too close
      const n = run.route.stops.length;
      for (let k = 0; k < n; k++) {
        const idx = (run.idx + k) % n, stop = run.route.stops[idx], lane = this.city.lanes[stop.lane];
        const s = Math.max(4, stop.s - 38); samplePath(lane, s, sp);
        const p = new THREE.Vector3(sp.x, 1, sp.z), d = p.distanceTo(focus);
        if (d < 70 || d > 140 || this.traffic.seen(p)) continue;
        if (this.traffic.vehicles.list.some(o => o.position.distanceTo(p) < 16)) continue;
        const bus = this.traffic.spawnOnLane('bus', lane, s, 'goto'); run.car = bus; run.idx = idx; this.stats.spawned++;
        this.head(run, bus); break;
      }
    }
  }
}
