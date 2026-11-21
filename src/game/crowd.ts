/**
 * Cheap far crowds: instanced pedestrians (the real body, decimated and vertex-animated, dressed from each person's look)
 * walking the sidewalk graph, instanced cars (each kind's real far model and paint) following the lane graph (queue at
 * lights and behind real traffic, no physics), and curbside parked cars that turn into real stealable vehicles up close.
 * One draw call per car kind in use and per sex. Real (skinned/physics) actors live in Population/Traffic near the player:
 * a far car/person coming within PROMOTE_R is handed over to a real one (same kind/paint or same person), far real ones are
 * handed back (demoted) so the real budgets stay near the player, and nothing in view is ever just removed.
 */
import * as THREE from 'three';
import type { CityMap, Lane } from '../world/citymap';
import { samplePath, signalState, yellowLeft, pedestrianMayCross, districtAt, DISTRICT_INFO, nearestLane, CURB_HEIGHT } from '../world/citymap';
import { CrowdPeople, type CrowdLook } from '../actors/crowdBody';
import { randomLook, type FullLook } from '../actors/look';
import type { VehicleManager } from './vehicles';
import type { Traffic, AiCar } from './traffic';
import type { Npc } from '../actors/npc';
import type { Population } from './population';
import type { Vehicle } from '../vehicles/vehicle';
import { PARKED_MIX, TRAFFIC_MIX, type VehicleKind } from '../vehicles/specs';
import { FarCars, kindPaint } from '../vehicles/farCars';
import { hasTemplate } from '../vehicles/models/build';
import { yieldsToSiren, signalCap, stopSignCap, spawnSafeAtSignal, spawnGapClear } from './trafficRules';
import { Rng } from '../core/rng';
import { carActivity, pedActivity, districtNightFactor } from './schedule';

export interface CrowdCaps { farCars: number; farPeds: number; parked: number }

const CAR_PAINT = [0xb8bcc2, 0x1d1f24, 0xe8e8e8, 0x7a1f26, 0x24406b, 0x6b7a86, 0xc9a227, 0x3d5a3a, 0x8a8f95, 0xd8d0c0, 0x2f2f33];
const SHIRTS = [0x2b4a7a, 0xb23a3a, 0x3a7a4a, 0xd8d8d0, 0x1d1d22, 0x8a5a9a, 0xd89a2b, 0x5a6a7a, 0x9a3a1a, 0x4aa0b0, 0xe0c8c0];
const PANTS = [0x23262f, 0x3a4a6a, 0x4a3a2a, 0x1a1a1a, 0x6a6a70, 0x2f3a2f];
const SKIN = [0xf0c8a0, 0xd9a577, 0xb07a4f, 0x7a4a2f, 0x4f2f20, 0xe8b890];

interface GCar { lane: Lane; s: number; v: number; paint: number; len: number; x: number; z: number; yaw: number; id: number;
  /** vehicle kind and paint index: drawn with that kind's real far model, and promoted into exactly that car */ kind: VehicleKind; pc: THREE.Color;
  /** lateral blend left over from a lane change (decays) */ ox: number; oz: number; lcCool: number;
  bus: boolean; /** seconds left standing at a stop (buses) */ dwell: number; stopS: number; planLane: number; ssLane?: number; ssWait?: number; /** lateral offset held inside the lane (+ left): clears kerbside parked cars, tucks right for sirens */ ks?: number }
interface GPed { from: number; to: number; t: number; speed: number; wait: number; off: number; look: number; x: number; z: number; /** height on a bridge walkway */ y?: number; yaw: number; tint: number; tint2: number; skin: number; phase: number; leader?: GPed; dead?: boolean;
  /** who this is: the same look is used by the real person it turns into up close */ lk?: FullLook; data?: CrowdLook; seed?: number; road?: boolean }
interface Slot { x: number; z: number; yaw: number; paint: number; kind: number; taken: boolean; real: Vehicle | null; /** health fraction when last put away: a damaged car stays damaged */ hp?: number }
const sp = { x: 0, z: 0, dx: 0, dz: 0, y: 0 as number | undefined };
const col = new THREE.Color();

/** Cheap crowd members are only removed this close to the player (behind the camera lens); real ones take over from PROMOTE_R. */
const NEAR_KILL = 9, PROMOTE_R = 60;
/** Real cars / people allowed over the preset cap for hand-overs (far real ones are demoted back to the crowd meanwhile). */
const PROMOTE_SLACK = 10, PROMOTE_SLACK_PEDS = 16;
/** Far-model cars / people never stay this close: over the cap a real one is demoted for them (or the cap stretches a little). */
const NEAR_PROMOTE_CAR = 25, NEAR_PROMOTE_PED = 22, NEAR_OVERFLOW = 8;
/** Real cars / people this far away (and out of view, or much further) go back to the cheap crowd. */
const DEMOTE_R = 128, DEMOTE_PED_R = 82; // cars: just beyond Traffic's own spawn ring (no spawn/demote churn)
/** Look seeds for far people (distinct from Population's). */
let LOOK_SEED = 500000;
/** Instance capacity of the far-car meshes (R6-T: raised from 400 for denser city traffic). */
const MAX_FAR_CARS = 600;
export class Crowd {
  private nearLaneIdx: number[] = []; private nearT = 0;
  readonly cars: GCar[] = []; readonly peds: GPed[] = [];
  /** siren vehicles (set by the game from Traffic.sirenSources): far cars pull over for them */
  sirens: { x: number; z: number; fx: number; fz: number; speed: number }[] = [];
  caps: CrowdCaps = { farCars: 0, farPeds: 0, parked: 0 };
  hour = 17; busCount = 0;
  /** far cars (driving + parked) drawn with each kind's real far model */ readonly far: FarCars;
  /** far pedestrians: the real body, decimated and vertex-animated, dressed from each person's look */ people: CrowdPeople | null = null;
  /** the render camera (set by the game): far crowds are culled per instance and never removed while in view */
  camera: THREE.Camera | null = null;
  private frustum = new THREE.Frustum(); private pm = new THREE.Matrix4(); private sph = new THREE.Sphere(); private v3 = new THREE.Vector3();
  private traffic: Traffic | null = null; private pop: Population | null = null; private demoteT = 0;
  /** hand-over bookkeeping for tests / debugging */
  stats = { promotedCars: 0, promotedPeds: 0, demotedCars: 0, demotedPeds: 0, heldCars: 0, heldPeds: 0, removedInView: 0, failCap: 0, failOverlap: 0 };
  private slots: Slot[] = []; private visSlots: Slot[] = [];
  private rng = new Rng(4242); private nextId = 1; private t = 0; private slowT = 0; private parkT = 0; private slowIdx = 0;
  private carLaneIdx: number[] = [];
  prewarming = false;
  /** tests: hold every far car/person where it is (still drawn) */
  freeze = false;
  /** tests: when set, removals of far cars are logged here */
  debug: { x: number; z: number; why: string; d: number; inView: boolean }[] | null = null;
  /**
   * Hand-over hooks (wired by the game): a far-crowd car/pedestrian that comes within PROMOTE_R of the player is replaced
   * in place by a real, fully simulated one (return true) instead of vanishing. When the hook declines (real caps full)
   * the cheap one keeps walking/driving until it is almost beside the camera, so nobody blinks out at mid range.
   */
  promoteCar: ((lane: Lane, s: number, bus: boolean, speed: number, kind: VehicleKind, paint: THREE.Color, near?: boolean) => boolean) | null = null;
  promotePed: ((x: number, z: number, from: number, to: number, yaw: number, look?: FullLook, near?: boolean) => boolean) | null = null;
  private focus = new THREE.Vector3();
  /** why the last car hand-over was refused (tests) */ failWhy = '';
  /** test hook: overlap refusals */ debugOverlap: Record<string, unknown>[] | null = null;
  /** pose of the far car being handed over (the real car spawns exactly there) */ private pose: { x: number; z: number; yaw: number } | null = null;
  /** Connects the hand-over hooks to the real traffic / pedestrian systems; `caps` returns the current real-population caps. */
  wire(traffic: Traffic, pop: Population, caps: () => { traffic: number; peds: number }) {
    this.traffic = traffic; this.pop = pop;
    this.promoteCar = (lane, s, bus, speed, kind, paint, near) => {
      // soft cap: a car about to be seen up close is always handed over (far real cars are demoted to make room); within
      // NEAR_PROMOTE_CAR the least important real car is demoted on the spot, or the cap stretches by NEAR_OVERFLOW
      if (traffic.cars.length >= caps().traffic + PROMOTE_SLACK && !(near && (this.evictCar() || traffic.cars.length < caps().traffic + PROMOTE_SLACK + NEAR_OVERFLOW))) { this.stats.failCap++; this.failWhy = 'cap'; return false; }
      samplePath(lane, s, sp);
      if (this.pose) { sp.x = this.pose.x; sp.z = this.pose.z; } // test the spot the car is actually drawn at (kerb-lane offset included)
      // never spawn inside a real car: footprint overlap only (a car queued 2 m behind another is fine)
      const len = bus ? 12.5 : 5.2;
      for (const o of this.vehicles.list) {
        const dx = o.position.x - sp.x, dz = o.position.z - sp.z, along = dx * sp.dx + dz * sp.dz, side = dx * sp.dz - dz * sp.dx;
        if (Math.abs(along) < len * 0.5 + Math.max(2.4, o.tpl.front - o.tpl.rear) * 0.5 && Math.abs(side) < o.phys.layout.half[0] + (bus ? 1.45 : 1.05)) { this.stats.failOverlap++; this.failWhy = 'overlap'; if (this.debugOverlap && this.debugOverlap.length < 20) this.debugOverlap.push({ kind: o.kind, parked: o.parked, drv: !!o.driver, spd: +o.speed.toFixed(1), along: +along.toFixed(1), side: +side.toFixed(1), near: !!near }); return false; } // held (still drawn) until the space is clear: dropping it here made cars vanish in front of the player
      }
      // nor on a person (a crossing pedestrian, a body in the road): depenetrating from a capsule launched cars onto their roof
      for (const n of pop.npcs) { if (n.char.inVehicle) continue; const p = n.char.pos; if (Math.abs(p.x - sp.x) < len * 0.5 + 1 && Math.abs(p.z - sp.z) < len * 0.5 + 1 && Math.hypot(p.x - sp.x, p.z - sp.z) < len * 0.5 + 0.8) { this.failWhy = 'person'; return false; } }
      const car = traffic.spawnOnLane(bus ? 'bus' : kind, lane, s, 'cruise', 'civilian', undefined, speed, this.pose ?? undefined); // keeps its speed and exact drawn pose: a seamless swap
      car.v.respray(col.copy(paint).convertLinearToSRGB());
      this.stats.promotedCars++;
      return true;
    };
    pop.reserve = 10; pop.spawnMax = DEMOTE_PED_R - 6; // real people are spawned only where they would stay real
    try { this.people = new CrowdPeople(this.scene, pop.tpl); } catch (e) { console.warn('far crowd bodies unavailable', e); this.people = null; }
    this.promotePed = (x, z, from, to, yaw, look, near) => {
      // soft cap (far real people are demoted to make room); within NEAR_PROMOTE_PED the farthest unseen real walker is demoted
      // on the spot, or the cap stretches by NEAR_OVERFLOW
      const civ = () => pop.npcs.filter(n => n.role === 'civilian' && !n.persistent).length, cap = caps().peds + PROMOTE_SLACK_PEDS;
      if (civ() >= cap && !(near && (this.evictPed() || civ() < cap + NEAR_OVERFLOW))) return false;
      const n = pop.spawn('civilian', x, z, 0.2, look);
      n.node = from; n.nextNode = to; n.char.yaw = yaw;
      this.stats.promotedPeds++;
      return true;
    };
  }
  constructor(private scene: THREE.Scene, private city: CityMap, private vehicles: VehicleManager, private time: () => number) {
    this.far = new FarCars(scene);
    this.carLaneIdx = city.lanes.filter(l => !l.connector && l.length > 30).map(l => l.id);
    this.buildSlots();
  }
  /** Curbside slots along every street between intersections. */
  private buildSlots() {
    const r = new Rng(99);
    for (const road of this.city.roads) {
      {
        const a = road.from + 8, b = road.to - 8;
        for (const side of [1, -1]) {
          for (let s = a; s <= b; s += 6.4) {
            if (!r.chance(0.3)) continue; // R6-T: fewer kerbside slots so moving cars outnumber parked ones
            const off = side * (road.half - 1.0), along = s + r.range(-0.5, 0.5);
            const x = road.axis === 'x' ? along : road.coord + off, z = road.axis === 'x' ? road.coord + off : along;
            r.chance(0.5); // (keeps the seeded colours / kinds below unchanged)
            // nose with the traffic on this side of the street: heading of the nearest driving lane (right-hand traffic)
            const nl = nearestLane(this.city, x, z);
            if (nl) samplePath(nl.lane, nl.s, sp);
            const yaw = nl ? Math.atan2(sp.dx, sp.dz) : (road.axis === 'x' ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? 0 : Math.PI));
            this.slots.push({ x, z, yaw, paint: r.int(0, CAR_PAINT.length - 1), kind: r.int(0, PARKED_MIX.length - 1), taken: false, real: null });
          }
        }
      }
    }
  }
  /** No parking here (bus stops): the curbside slots within r metres stay empty. */
  clearSlotsNear(x: number, z: number, r: number) { for (const s of this.slots) if ((s.x - x) ** 2 + (s.z - z) ** 2 < r * r) s.taken = true; }
  /** Ghost + real counts within r metres of a point (for tests and HUD debugging). */
  countNear(x: number, z: number, r: number) {
    let cars = 0, peds = 0, parked = 0; const r2 = r * r;
    for (const c of this.cars) if ((c.x - x) ** 2 + (c.z - z) ** 2 < r2) cars++;
    for (const p of this.peds) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r2) peds++;
    for (const s of this.visSlots) if (!s.taken && (s.x - x) ** 2 + (s.z - z) ** 2 < r2) parked++;
    return { cars, peds, parked };
  }
  clear() { this.cars.length = 0; this.peds.length = 0; }
  /** Bounding-sphere test against the render camera's view (last frame's; the margin grows with distance for fast turns). */
  private seen(x: number, y: number, z: number, r: number) {
    if (!this.camera) return true;
    const c = this.camera.position, d = Math.hypot(x - c.x, z - c.z);
    return this.frustum.intersectsSphere(this.sph.set(this.v3.set(x, y, z), r + d * 0.08 + 1));
  }

  update(dt: number, focus: THREE.Vector3, caps: CrowdCaps) {
    this.focus.copy(focus);
    caps = { farCars: Math.round(caps.farCars * carActivity(this.hour)), farPeds: Math.round(caps.farPeds * pedActivity(this.hour)), parked: caps.parked };
    this.caps = caps; this.t += dt;
    if (!this.camera && this.pop?.camera) this.camera = this.pop.camera;
    if (this.camera) { this.camera.updateMatrixWorld(); this.pm.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.pm); }
    this.far.begin(this.camera ?? new THREE.PerspectiveCamera());
    const nowT = this.time();
    this.people?.begin(this.camera, this.t);
    if (!this.freeze) {
      this.updateCars(dt, nowT, focus);
      this.updatePeds(dt, nowT, focus);
      this.parkT -= dt; if (this.parkT <= 0) { this.parkT = 0.6; this.updateParked(focus); }
      this.demoteT -= dt; if (this.demoteT <= 0 && !this.prewarming) { this.demoteT = 0.5; this.demote(focus); }
    }
    this.drawCars(); this.drawPeds(); this.drawParked();
    const h = this.hour, night = h >= 19.5 || h < 5.5 ? 1 : h >= 18.3 ? (h - 18.3) / 1.2 : h < 6.7 ? (6.7 - h) / 1.2 : 0;
    this.far.end(night); this.people?.end();
  }
  /** The person a far pedestrian is (built on first use and kept, so they look the same when they turn real). */
  private lookOf(p: GPed): FullLook {
    if (!p.lk) p.lk = randomLook(p.seed ?? LOOK_SEED++);
    if (!p.data) p.data = this.people?.pack(p.lk);
    return p.lk;
  }
  /** Kind for a new far car: the traffic mix, restricted to kinds whose model is already built (never a build hitch). */
  private pickKind(): VehicleKind {
    const total = TRAFFIC_MIX.reduce((a, b) => a + b.weight, 0); let r = Math.random() * total;
    for (const m of TRAFFIC_MIX) { r -= m.weight; if (r <= 0) return hasTemplate(m.kind) ? m.kind : 'sedan'; }
    return 'sedan';
  }
  /**
   * Hands far-away real traffic back to the cheap crowd (same kind, paint, lane, speed) so the real-car budget is spent
   * where the player is: promotion of the cars ahead never runs out of slots.
   */
  /** A plain civilian car cruising its lane (no police, player car, chase, damage or scripted stop): it may go back to the crowd. */
  private demotableCar(car: AiCar): boolean {
    const v = car.v;
    if (car.persistent || car.mode !== 'cruise' || car.patrol || car.driver.role !== 'civilian' || !car.driver.alive || v.destroyed || car.stopPlan || car.passengers?.some(p => !p.alive)) return false;
    return !(v.health < v.spec.health * 0.97 || v.lastDamagedBy || Math.abs(v.speed) > 22 || this.cars.length >= MAX_FAR_CARS - 1 || !car.lane);
  }
  /** Demotes the real car that matters least (farthest, out of view) to make room for one up close. */
  private evictCar(): boolean {
    const tr = this.traffic; if (!tr) return false;
    let best: AiCar | null = null, bd = 30;
    for (const car of tr.cars) {
      const p = car.v.position, d = Math.hypot(p.x - this.focus.x, p.z - this.focus.z);
      if (d > bd && this.demotableCar(car) && !this.seen(p.x, p.y + 1, p.z, 3)) { best = car; bd = d; }
    }
    if (best) this.demoteCar(best);
    return !!best;
  }
  /** Demotes the farthest unseen real walker to make room for one up close. */
  private evictPed(): boolean {
    const pop = this.pop; if (!pop || !this.people) return false;
    let best: Npc | null = null, bd = 25;
    for (const n of pop.npcs) {
      const p = n.char.pos, d = Math.hypot(p.x - this.focus.x, p.z - this.focus.z);
      if (d > bd && this.demotablePed(n) && !this.seen(p.x, p.y + 1, p.z, 1.2)) { best = n; bd = d; }
    }
    return !!best && this.demotePed(best);
  }
  private demote(focus: THREE.Vector3) {
    const tr = this.traffic; if (!tr) return;
    for (const car of [...tr.cars]) {
      const v = car.v, d = Math.hypot(v.position.x - focus.x, v.position.z - focus.z);
      if (d < DEMOTE_R || !this.demotableCar(car)) continue;
      if (d < DEMOTE_R + 30 && this.seen(v.position.x, v.position.y + 1, v.position.z, 3)) continue; // in plain view: keep the real one a while longer
      this.demoteCar(car);
    }
    // far real pedestrians who are just walking go back to the crowd (same person, same route)
    const pop = this.pop; if (!pop || !this.people) return;
    for (const n of [...pop.npcs]) {
      if (!this.demotablePed(n)) continue;
      const c = n.char, d = Math.hypot(c.pos.x - focus.x, c.pos.z - focus.z);
      if (d < DEMOTE_PED_R) continue;
      if (d < DEMOTE_PED_R + 30 && this.seen(c.pos.x, c.pos.y + 1, c.pos.z, 1.2)) continue;
      this.demotePed(n);
    }
  }
  private demotablePed(n: Npc): boolean {
    return !(n.role !== 'civilian' || n.persistent || !n.alive || n.brain !== 'wander' || n.activity || n.buddy || n.char.inVehicle || n.node < 0 || n.nextNode < 0 || n.alertT > 0 || this.peds.length >= 899);
  }
  private demoteCar(car: AiCar) {
    const tr = this.traffic!, v = car.v, lane = car.lane;
    tr.cars.splice(tr.cars.indexOf(car), 1);
      this.pop?.remove(car.driver); for (const p of car.passengers ?? []) this.pop?.remove(p);
      const pc = v.paint.clone(), bus = v.kind === 'bus';
      this.vehicles.remove(v);
      samplePath(lane, Math.min(car.s, lane.length - 0.01), sp);
      this.cars.push({ lane, s: Math.min(car.s, lane.length - 0.01), v: Math.max(0, Math.abs(v.speed)), paint: 0, len: bus ? 11.6 : 4.5, x: sp.x, z: sp.z, yaw: Math.atan2(sp.dx, sp.dz), id: this.nextId++, ox: 0, oz: 0, lcCool: 6, bus, dwell: 0, stopS: -1, planLane: lane.id, kind: v.kind, pc });
      this.stats.demotedCars++;
  }
  private demotePed(n: Npc): boolean {
    const pop = this.pop!, nodes = this.city.pedNodes, c = n.char;
    {
      const a = nodes[n.node], b = nodes[n.nextNode]; if (!a || !b || !a.edges.some(e => e.to === b.id)) return false;
      const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz || 1;
      const t = THREE.MathUtils.clamp(((c.pos.x - a.x) * dx + (c.pos.z - a.z) * dz) / L2, 0, 1);
      const L = Math.sqrt(L2), off = THREE.MathUtils.clamp(((c.pos.x - a.x) * dz - (c.pos.z - a.z) * dx) / L * -1, -0.9, 0.9);
      const lk = c.human.look;
      this.peds.push({ from: a.id, to: b.id, t, speed: Math.max(1, Math.min(1.8, c.speed || 1.3)), wait: 0, off, look: 0, x: c.pos.x, z: c.pos.z, yaw: c.yaw, tint: 0, tint2: 0, skin: 0, phase: Math.random(), lk, data: this.people!.pack(lk) });
      pop.remove(n);
      this.stats.demotedPeds++;
    }
    return true;
  }

  // ---------------------------------------------------------------- cars
  private spawnCar(focus: THREE.Vector3, bus = false) {
    for (let tries = 0; tries < 10; tries++) {
      const pool = this.nearLaneIdx.length > 20 && !bus ? this.nearLaneIdx : this.carLaneIdx; // R6-T: pick lanes near the player, not city-wide
      const lane = this.city.lanes[pool[Math.floor(Math.random() * pool.length)]];
      if (bus && lane.length < 70) continue;
      const s = 6 + Math.random() * (lane.length - 12);
      samplePath(lane, s, sp);
      const d = Math.hypot(sp.x - focus.x, sp.z - focus.z);
      if (d < (this.prewarming ? 40 : 65) || d > 190) continue; // R6-T: denser ring (was 70-230) so moving cars outnumber parked ones in view
      if (Math.random() > DISTRICT_INFO[districtAt(this.city, sp.x, sp.z)].trafficDensity) continue;
      if (this.cars.some(c => c.lane === lane && Math.abs(c.s - s) < (bus ? 20 : 11))) continue;
      { // R6-Z1: >= 8 m bumper gap to far cars and to real (possibly stopped) cars on this lane
        const others: { s: number; len: number }[] = [];
        for (const c of this.cars) if (c.lane === lane) others.push({ s: c.s, len: c.len });
        for (const rc of this.traffic?.cars ?? []) if (rc.lane.id === lane.id) others.push({ s: rc.s, len: 4.6 });
        if (!spawnGapClear(s, bus ? 11.6 : 4.5, others)) continue;
      }
      if (this.vehicles.list.some(o => Math.abs(o.position.x - sp.x) < 10 && Math.abs(o.position.z - sp.z) < 10)) continue;
      // never appear already doing 40 km/h towards a red line it cannot stop at (R6-T)
      if (!lane.connector && !spawnSafeAtSignal(signalState(this.city.intersections[lane.intersection], lane.axis, this.time()), signalState(this.city.intersections[lane.intersection], lane.axis, this.time() + 5), lane.length - s - 5.4)) continue;
      const sInter = this.city.intersections[lane.intersection], v0 = lane.connector ? lane.speed * 0.8 : Math.min(lane.speed * 0.8, signalCap(signalState(sInter, lane.axis, this.time()), lane.length - s - 5.4, lane.speed * 0.8));
      const kind: VehicleKind = bus ? 'bus' : this.pickKind(), paint = Math.floor(Math.random() * 64);
      if (bus && !hasTemplate('bus')) return false;
      this.cars.push({ lane, s, v: v0, paint, len: bus ? 11.6 : 4.5, x: sp.x, z: sp.z, yaw: Math.atan2(sp.dx, sp.dz), id: this.nextId++, ox: 0, oz: 0, lcCool: Math.random() * 8, bus, dwell: 0, stopS: -1, planLane: -1, kind, pc: kindPaint(kind, paint) });
      return true;
    }
    return false;
  }
  private updateCars(dt: number, t: number, focus: THREE.Vector3) {
    const cars = this.cars, cap = Math.min(this.caps.farCars, MAX_FAR_CARS);
    this.nearT -= dt;
    if (this.nearT <= 0 || this.prewarming) {
      this.nearT = 1; this.nearLaneIdx.length = 0;
      for (const id of this.carLaneIdx) { const l = this.city.lanes[id], a = l.points[0], b = l.points[l.points.length - 1]; if (Math.hypot((a.x + b.x) / 2 - focus.x, (a.z + b.z) / 2 - focus.z) < 200 + l.length / 2) this.nearLaneIdx.push(id); }
    }
    // recycle: too close (the real traffic takes over), too far, or on top of a real vehicle
    this.slowT -= dt;
    const checkReal = this.slowT <= 0; if (checkReal) this.slowT = 0.4;
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i], d = Math.hypot(c.x - focus.x, c.z - focus.z);
      // never removed while it can be seen up close: over the cap / on top of a real car it waits until it is out of view
      const inView = d < 120 && this.seen(c.x, 1.2, c.z, c.bus ? 7 : 3.5);
      let kill = d > 215 || (i >= cap && !inView);
      if (!kill && d < PROMOTE_R && !this.prewarming) { this.pose = c; const ok = this.promoteCar?.(c.lane, c.s, c.bus, c.v, c.kind, c.pc, d < NEAR_PROMOTE_CAR); this.pose = null; if (ok) kill = true; else this.stats.heldCars++; }
      if (!kill && d < NEAR_KILL && !inView) kill = true; // beside / behind the camera and still not handed over
      let why = kill ? 'promoted' : '';
      if (!kill && checkReal && d < 140 && !inView) for (const o of this.vehicles.list) if (Math.abs(o.position.x - c.x) < 4 && Math.abs(o.position.z - c.z) < 4) { kill = true; why = 'real'; break; }
      if (kill) { if (this.debug) this.debug.push({ x: c.x, z: c.z, why: why || (d > 215 ? 'far' : i >= cap ? 'cap' : 'near'), d, inView }); cars.splice(i, 1); }
    }
    let spawns = this.prewarming ? 60 : 4;
    while (cars.length < cap && spawns-- > 0) if (!this.spawnCar(focus)) break;
    // a few city buses on the long avenue lanes
    this.busCount = 0; for (const c of cars) if (c.bus) this.busCount++;
    const busCap = Math.min(14, Math.round(cap / 28));
    if (this.busCount < busCap && cars.length < MAX_FAR_CARS - 1 && (this.prewarming || Math.random() < 0.08)) for (let k = 0; k < (this.prewarming ? 6 : 1); k++) if (this.spawnCar(focus, true)) this.busCount++;
    // per-lane ordering for leader lookup
    const byLane = new Map<number, GCar[]>();
    for (const c of cars) { const l = byLane.get(c.lane.id); if (l) l.push(c); else byLane.set(c.lane.id, [c]); }
    // real traffic on the same lanes: far cars queue behind it instead of driving into it (and being culled for it)
    const realOn = new Map<number, number[]>();
    for (const rc of this.traffic?.cars ?? []) { const l = realOn.get(rc.lane.id); if (l) l.push(rc.s); else realOn.set(rc.lane.id, [rc.s]); }
    if (this.traffic) { const fo = this.traffic.farObs; fo.length = 0; for (const c of cars) if (Math.abs(c.x - focus.x) < 160 && Math.abs(c.z - focus.z) < 160) fo.push(c); }
    const near: { x: number; z: number }[] = [];
    for (const v of this.vehicles.list) { if (v.parked) continue; const p = v.position; if (Math.abs(p.x - focus.x) < 240 && Math.abs(p.z - focus.z) < 240) near.push({ x: p.x, z: p.z }); } // kerbside parked cars are passed (lane offset), not queued behind
    for (const c of cars) {
      const lane = c.lane;
      let target = lane.speed * (c.bus ? 0.7 : 0.85);
      c.lcCool -= dt;
      if (c.ox !== 0 || c.oz !== 0) { const k = Math.exp(-dt * 1.1); c.ox *= k; c.oz *= k; if (Math.abs(c.ox) + Math.abs(c.oz) < 0.02) { c.ox = 0; c.oz = 0; } }
      // bus stop: roll once per lane, brake to a halt at the kerb, stand a while, then pull away
      if (c.bus && !lane.connector) {
        if (c.planLane !== lane.id) { c.planLane = lane.id; c.stopS = c.s < lane.length * 0.4 && Math.random() < 0.6 ? c.s + 12 + Math.random() * Math.max(2, lane.length - c.s - 40) : -1; }
        if (c.dwell > 0) { c.dwell -= dt; target = 0; if (c.dwell <= 0) c.stopS = -1; }
        else if (c.stopS > 0) {
          const dStop = c.stopS - c.s;
          if (dStop < -2) c.stopS = -1;
          else { target = Math.min(target, Math.max(0, dStop - 0.5) * 0.7); if (dStop < 1.5 && c.v < 0.5) c.dwell = 7 + Math.random() * 7; }
        }
      }
      if (!lane.connector) {
        const inter = this.city.intersections[lane.intersection];
        const dStop = lane.length - c.s - 5.4;
        if (inter.signalized) target = Math.min(target, signalCap(signalState(inter, lane.axis, t), dStop, c.v, yellowLeft(inter, lane.axis, t)));
        else if (dStop > -1) { // stop sign: halt, wait a beat, go once nobody else is in the junction (R6-T)
          if (c.ssLane !== lane.id) { c.ssLane = lane.id; c.ssWait = 0; }
          if (dStop < 1.8 && c.v < 0.4) c.ssWait = (c.ssWait ?? 0) + dt;
          let clear = true;
          if (dStop < 14) for (const o of cars) if (o !== c && o.lane.intersection === lane.intersection && o.lane.connector && o.v > 0.3) { clear = false; break; }
          target = Math.min(target, stopSignCap(dStop, c.v, c.ssWait ?? 0, clear));
        }
      } else target = Math.min(target, 8);
      // kerb lane: hold clear of kerbside parked cars; a siren behind / oncoming: tuck to the kerb and slow down
      let wantKs = !lane.connector && lane.lane === lane.lanes - 1 ? 0.75 : 0; // kerb lane keeps clear of the parked row
      for (const sv of this.sirens) if (yieldsToSiren(c.x, c.z, Math.sin(c.yaw), Math.cos(c.yaw), sv.x, sv.z, sv.fx, sv.fz, sv.speed)) { wantKs = -1.3; target = Math.min(target, 3); break; }
      c.ks = (c.ks ?? 0) + (wantKs - (c.ks ?? 0)) * Math.min(1, dt * 2.5);
      const same = byLane.get(lane.id);
      let lead: GCar | null = null, leadGap = 99;
      if (same && same.length > 1) for (const o of same) {
        if (o === c) continue; const gap = o.s - c.s - (o.len + c.len) * 0.5 - 0.5;
        if (gap > -2 && gap < 40) { target = Math.min(target, Math.max(0, gap - 2.5) * 0.9); if (gap < leadGap) { leadGap = gap; lead = o; } }
      }
      // any real vehicle in the path (the player, a car turning in from another lane, a crash): brake behind it
      if (near.length) {
        const fx = Math.sin(c.yaw), fz = Math.cos(c.yaw);
        for (const o of near) {
          const dx = o.x - c.x, dz = o.z - c.z, along = dx * fx + dz * fz;
          if (along < 0 || along > 18) continue;
          if (Math.abs(dx * fz - dz * fx) > 1.5) continue;
          target = Math.min(target, Math.max(0, along - (c.len * 0.5 + 4)) * 0.9);
        }
      }
      const reals = realOn.get(lane.id);
      if (reals) for (const rs of reals) { const gap = rs - c.s - (4.6 + c.len) * 0.5 - 0.5; if (gap > -2 && gap < 40) target = Math.min(target, Math.max(0, gap - 2.5) * 0.9); }
      // overtake / even out: move to the neighbouring lane when it is free (a stopped bus ahead makes it likely)
      if (!lane.connector && c.lcCool <= 0 && c.v > 3 && c.s > 12 && lane.length - c.s > 32 && !c.bus) {
        const stuck = lead !== null && (lead as GCar).dwell > 0 && leadGap < 24;
        if (stuck || Math.random() < dt * 0.012) {
          const toId = lane.lane > 0 ? lane.leftLane : lane.rightLane;
          if (toId !== undefined) {
            const tl = this.city.lanes[toId], other = byLane.get(toId);
            if (!other || !other.some(o => Math.abs(o.s - c.s) < 16 + o.v * 0.4)) {
              samplePath(tl, Math.min(c.s, tl.length - 0.1), sp);
              c.ox = c.x - sp.x; c.oz = c.z - sp.z; c.lane = tl; c.lcCool = 8 + Math.random() * 10;
              (other ?? byLane.set(toId, []).get(toId)!).push(c);
              (same as GCar[]).splice((same as GCar[]).indexOf(c), 1);
            } else c.lcCool = 1.5;
          } else c.lcCool = 6;
        }
      }
      c.v += THREE.MathUtils.clamp(target - c.v, -7 * dt, 2.6 * dt);
      if (c.v < 0) c.v = 0;
      c.s += c.v * dt;
      if (c.s >= lane.length) {
        if (!lane.next.length) { c.s = lane.length - 0.01; c.v = 0; continue; }
        c.s -= lane.length; c.lane = this.city.lanes[lane.next[Math.floor(Math.random() * lane.next.length)]];
        if (c.s > c.lane.length) c.s = 0;
      }
      samplePath(c.lane, c.s, sp);
      const ks = c.ks ?? 0; c.x = sp.x + c.ox + sp.dz * ks; c.z = sp.z + c.oz - sp.dx * ks; const yaw = Math.atan2(sp.dx, sp.dz); c.yaw = c.yaw + Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw)) * Math.min(1, dt * 8);
    }
  }
  private drawCars() {
    for (const c of this.cars) {
      samplePath(c.lane, c.s, sp); const y = c.lane.ys ? (sp.y ?? 0) : 0;
      this.far.add(c.kind, c.x, y, c.z, c.yaw, c.pc, true);
    }
  }

  // ---------------------------------------------------------------- pedestrians
  private spawnPed(focus: THREE.Vector3) {
    const nodes = this.city.pedNodes;
    for (let tries = 0; tries < 12; tries++) {
      const nd = nodes[Math.floor(Math.random() * nodes.length)];
      const e = nd.edges[Math.floor(Math.random() * nd.edges.length)];
      if (e.crossing) continue;
      const to = nodes[e.to], t = Math.random();
      const x = nd.x + (to.x - nd.x) * t, z = nd.z + (to.z - nd.z) * t;
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (d < (this.prewarming ? 30 : 66) || d > 210) continue;
      const dist = districtAt(this.city, x, z);
      if (Math.random() > Math.min(1, DISTRICT_INFO[dist].pedDensity * districtNightFactor(dist, this.hour))) continue;
      const rnd = (n: number) => Math.floor(Math.random() * n);
      const lead: GPed = { from: nd.id, to: e.to, t, speed: 1.1 + Math.random() * 0.7, wait: 0, off: (Math.random() - 0.5) * 1.6, look: 0, x, z, yaw: 0, tint: SHIRTS[rnd(SHIRTS.length)], tint2: PANTS[rnd(PANTS.length)], skin: SKIN[rnd(SKIN.length)], phase: Math.random(), seed: LOOK_SEED++ };
      this.peds.push(lead);
      // friends walk side by side: pairs and the odd trio
      if (Math.random() < 0.3) for (let k = 1, cnt = Math.random() < 0.25 ? 2 : 1; k <= cnt; k++) {
        this.peds.push({ ...lead, leader: lead, off: lead.off + 0.72 * k, phase: (lead.phase + k * 0.37) % 1, tint: SHIRTS[rnd(SHIRTS.length)], tint2: PANTS[rnd(PANTS.length)], skin: SKIN[rnd(SKIN.length)], seed: LOOK_SEED++, lk: undefined, data: undefined });
      }
      return true;
    }
    return false;
  }
  private updatePeds(dt: number, t: number, focus: THREE.Vector3) {
    const peds = this.peds, cap = Math.min(this.caps.farPeds, 900), nodes = this.city.pedNodes;
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i], d = Math.hypot(p.x - focus.x, p.z - focus.z);
      // never removed while it can be seen: over the cap it waits until it is out of view; up close it becomes a real person
      const inView = d < 120 && this.seen(p.x, 1 + (p.y ?? 0), p.z, 1.2);
      let gone = d > 235 || (i >= cap && !inView);
      if (!gone && d < PROMOTE_R && !this.prewarming) { if (this.promotePed?.(p.x, p.z, p.from, p.to, p.yaw, this.lookOf(p), d < NEAR_PROMOTE_PED)) gone = true; else this.stats.heldPeds++; }
      if (!gone && d < NEAR_KILL && !inView) gone = true;
      if (gone) { p.dead = true; peds.splice(i, 1); }
    }
    let spawns = this.prewarming ? 120 : 10;
    while (peds.length < cap && spawns-- > 0) if (!this.spawnPed(focus)) break;
    for (const p of peds) {
      const lead = p.leader && !p.leader.dead ? p.leader : undefined; if (!lead) p.leader = undefined;
      if (lead) { p.from = lead.from; p.to = lead.to; p.t = lead.t; p.wait = lead.wait; p.speed = lead.speed; }
      const a = nodes[p.from], b = nodes[p.to];
      if (lead) { /* follows its friend */ }
      else if (p.wait > 0) { p.wait -= dt; }
      else {
        const edge = a.edges.find(e => e.to === p.to);
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        // wait at the kerb for the walk signal
        if (edge?.crossing && p.t < 0.02 && !pedestrianMayCross(this.city.intersections[edge.crossing.intersection], edge.crossing.axis, t)) { p.wait = 0.5; }
        else {
          p.t += p.speed * dt / len;
          if (p.t >= 1) {
            // arrived: choose the next edge (never straight back unless dead end), sometimes stop to chat / look at a phone
            const opts = b.edges.filter(e => e.to !== p.from);
            const e = (opts.length ? opts : b.edges)[Math.floor(Math.random() * (opts.length || b.edges.length))];
            p.from = p.to; p.to = e.to; p.t = 0;
            if (Math.random() < 0.18) p.wait = 2 + Math.random() * 7;
          }
        }
      }
      const a2 = nodes[p.from], b2 = nodes[p.to];
      const dx = b2.x - a2.x, dz = b2.z - a2.z, l = Math.hypot(dx, dz) || 1;
      const crossing = a2.edges.find(e => e.to === p.to)?.crossing; p.road = !!crossing;
      const off = crossing ? (lead ? p.off - lead.off : 0) : p.off;
      p.x = a2.x + dx * p.t - dz / l * off; p.z = a2.z + dz * p.t + dx / l * off; p.y = (a2.y ?? 0) + ((b2.y ?? 0) - (a2.y ?? 0)) * p.t;
      const yaw = Math.atan2(dx, dz); if (p.wait <= 0) p.yaw = yaw;
    }
  }
  private drawPeds() {
    const people = this.people; if (!people) return;
    for (const p of this.peds) {
      const lk = this.lookOf(p);
      people.add(lk, p.data!, p.x, (p.y ?? 0) + (p.road ? 0 : CURB_HEIGHT), p.z, p.yaw, p.wait > 0 ? 0 : p.speed, p.phase);
    }
  }

  // ---------------------------------------------------------------- parked
  private updateParked(focus: THREE.Vector3) {
    const vis: Slot[] = [], cap = Math.min(this.caps.parked, 1200);
    for (const s of this.slots) {
      const d = Math.hypot(s.x - focus.x, s.z - focus.z);
      if (s.real) {
        const v = s.real;
        const gone = !this.vehicles.list.includes(v) || !v.parked || !!v.driver;
        if (gone) { s.taken = true; s.real = null; }
        else if (v.position.y < -1.2) { this.vehicles.remove(v); s.real = null; s.taken = true; } // fell through a gap in the road: never seen again
        else if (d > 110) { s.hp = v.health / v.spec.health; if (s.hp > 0.98) s.hp = undefined; this.vehicles.remove(v); s.real = null; }
        else continue; // the real car stands here
      }
      if (s.taken || d > 230) continue;
      if (d < 55 && !this.prewarming) { this.promote(s); if (s.real) continue; }
      vis.push(s);
    }
    vis.sort((a, b) => (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2 - ((b.x - focus.x) ** 2 + (b.z - focus.z) ** 2));
    if (vis.length > cap) vis.length = cap;
    this.visSlots = vis;
  }
  /** Parked cars are drawn every frame (culled per instance) with the real far model and the slot's real paint. */
  private drawParked() {
    for (const s of this.visSlots) {
      if (s.taken || s.real) continue;
      const kind = PARKED_MIX[s.kind % PARKED_MIX.length]; if (!hasTemplate(kind)) continue;
      this.far.add(kind, s.x, 0, s.z, s.yaw, kindPaint(kind, s.paint, col), false);
    }
  }
  private promote(s: Slot) {
    // something stands on the spot: a stopped/parked car takes the slot for good; a car driving past only delays the swap
    const o = this.vehicles.list.find(o => Math.abs(o.position.x - s.x) < 3 && Math.abs(o.position.z - s.z) < 3);
    if (o) { if (!o.driver && Math.abs(o.speed) < 0.5) s.taken = true; return; } // a car waiting at the lights beside the slot is not parked there
    const v = this.vehicles.spawn(PARKED_MIX[s.kind % PARKED_MIX.length], s.x, s.z, s.yaw, s.paint, 0.25);
    v.settleParked(0); // settled at rest height and asleep: tall trucks neither drop nor tip
    if (s.hp !== undefined) v.health = Math.max(1, v.spec.health * s.hp);
    v.parked = true; v.doorsLocked = s.paint % 3 !== 0; v.ignition = false; s.real = v;
  }
}
