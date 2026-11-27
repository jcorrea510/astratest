/** Ambient traffic and police driving: lane following, signals, spacing, reactions, parked cars, pursuit. */
import * as THREE from 'three';
import type { CityMap, Lane } from '../world/citymap';
import { samplePath, signalState, laneSigAxis, yellowLeft, nearestLane, routeField, routeStep, districtAt, DISTRICT_INFO, SIDEWALK, CURB_HEIGHT } from '../world/citymap';
import type { VehicleManager } from './vehicles';
import type { Vehicle } from '../vehicles/vehicle';
import type { Population } from './population';
import type { Npc } from '../actors/npc';
import type { Character } from '../actors/character';
import { TRAFFIC_MIX, PARKED_MIX, type VehicleKind } from '../vehicles/specs';
import type { GameAudio } from '../ui/contracts';
import { Rng } from '../core/rng';
import { SpatialGrid } from './spatialGrid';
import type { Look } from '../actors/human';
import { carActivity } from './schedule';
import { COP_LOOK } from './dispatch';
import { aiPedal, stopBack, curbShift, yieldsToSiren, signalCap, skipSignalNearTarget, stopSignCap, spawnSafeAtSignal, stopSpeed, turnSide, oncomingConflict, arrivalTime, lineStop, BOX_EDGE, leftClearing, willStopForSignal, LEFT_PATIENCE, ViolationMonitor, type Violation, type LaneProbe } from './trafficRules';
export type { Violation, ViolationKind } from './trafficRules';

export type DriveMode = 'cruise' | 'flee' | 'pursuit' | 'park' | 'goto';
export interface AiCar { v: Vehicle; driver: Npc; lane: Lane; s: number; mode: DriveMode; target: THREE.Vector3 | null; /** pursuit: the suspect's speed (m/s) */ targetVel?: number; stuckT: number; honkT: number; reverseT: number; persistent: boolean; ram: boolean; arriveDist: number; onArrive?: () => void; maxSpeed?: number;
  /** lane picked at the end of the current one, and the routing target it was picked for */
  nextChoice?: number; nextKey?: string;
  /** steering around a stopped, undriven obstacle: which vehicle, which side, time spent */
  avoid?: { v: Vehicle; side: number; t: number } | null; blockedT?: number;
  /** riders besides the driver (seat 1..) */
  passengers?: Npc[];
  /** lane change in progress: target lane, seconds since the signal came on, committed once the car has moved over */
  lc?: { to: number; t: number; done: boolean } | null; lcCool?: number;
  /** curbside stop: where (arc position on a lane), why; seconds left standing; lane the plan was last rolled for */
  stopPlan?: { s: number; lane: number; kind: 'drop' | 'pick' | 'deliver'; npc?: Npc } | null; stopT?: number; planLane?: number; scanT?: number; lastHonk?: number;
  /** ambient police cruiser on patrol (no heat) */
  patrol?: boolean;
  /** lateral offset (m, + = left) the car holds inside its lane: clears kerbside parked cars, tucks right for sirens / crashes */
  shift?: number;
  /** seconds a siren vehicle is still pushing us to the kerb; seconds left standing after an accident ahead */
  yieldT?: number; crashT?: number;
  /** seconds spent stopped with nothing legitimate to wait for (signal, pedestrian, curb stop) */
  jamT?: number; ghostT?: number;
  /** seconds panicking and boxed in (the driver bails out on foot) and health last seen (shot at) */
  boxedT?: number; hp?: number;
  /** waiting for a legitimate reason last step (signal, pedestrian, queue ahead), and who we are stuck behind */
  legitWait?: boolean; legitDepth?: number; blockedBy?: Vehicle | null;
  /** stop-sign / left-turn wait bookkeeping: lane it was counted on and seconds stood at the line */
  ssLane?: number; ssWait?: number; /** Round 13: lane on which this left turner started clearing on amber/all-red */ clearGo?: number; lcRetry?: number; /** seconds waited at a line because the exit lane is backed up */ boxWait?: number }
interface CrashSite { pos: THREE.Vector3; t: number; v: Vehicle }

const sp: { x: number; z: number; dx: number; dz: number; y?: number } = { x: 0, z: 0, dx: 0, dz: 0 };
export class Traffic {
  cars: AiCar[] = [];
  maxCars = 18;
  /** world clock hour (set by the game each frame): rush hours / quiet nights */
  hour = 17;
  prewarming = false;
  private spawnT = 0; private laneT = 0; private nearLanes: Lane[] = [];
  private parkedBlocks = new Map<number, Vehicle[]>();
  /** Round 8: seconds each untracked car has stood still; the player's last car is never towed */
  private idleT = new WeakMap<Vehicle, number>(); protect: Vehicle | null = null;
  private frustum = new THREE.Frustum(); private m4 = new THREE.Matrix4();
  private rng = new Rng(7);
  private crashes: CrashSite[] = [];
  /** positions / headings of siren vehicles this step (read by Crowd so far cars pull over too) */
  sirenSources: { x: number; z: number; fx: number; fz: number; speed: number }[] = [];
  private violationCbs: ((v: Violation) => void)[] = [];
  private monitor = new ViolationMonitor(v => { for (const cb of this.violationCbs) cb(v); }, (x, z) => new THREE.Vector3(x, 0, z));
  private monT = 0; private lastProbe: LaneProbe | null = null;
  /** consecutive-frame bookkeeping for tests / diagnostics */
  stats = { jamBreaks: 0, jamDespawns: 0, honks: 0, yields: 0 };
  private patrolT = 15; private forcePatrol = false;
  /**
   * Subscribe to traffic violations committed by the player while driving: {kind: 'red_light'|'speeding'|'wrong_way'|'collision'|'reckless', pos}.
   * Returns an unsubscribe function. Events are rate limited per kind, so the police can report each one directly.
   */
  onPlayerTrafficViolation(cb: (v: Violation) => void): () => void { this.violationCbs.push(cb); return () => { const i = this.violationCbs.indexOf(cb); if (i >= 0) this.violationCbs.splice(i, 1); }; }
  constructor(private city: CityMap, readonly vehicles: VehicleManager, private pop: Population, private audio: GameAudio, private time: () => number) {
    // a vehicle removed by anyone (crowd, activities, tests) must not stay on the AI list: its body is freed and eject()/yaw would trap in physics
    vehicles.removeListeners.push(v => { const i = this.cars.findIndex(c => c.v === v); if (i >= 0) this.cars.splice(i, 1); this.crashes = this.crashes.filter(c => c.v !== v); });
    vehicles.crashListeners.push(e => { this.crashes.push({ pos: e.point.clone(), t: this.time(), v: e.vehicle }); if (this.crashes.length > 6) this.crashes.shift(); });
  }

  pickKind(): VehicleKind {
    const total = TRAFFIC_MIX.reduce((a, b) => a + b.weight, 0); let r = Math.random() * total;
    for (const m of TRAFFIC_MIX) { r -= m.weight; if (r <= 0) return m.kind; }
    return 'sedan';
  }
  /** Spawns a driven car on a lane at distance s. */
  /** far-crowd car positions near the player, refreshed by the crowd each frame (real cars queue behind them) */
  farObs: { x: number; z: number; yaw?: number; v?: number }[] = [];
  spawnOnLane(kind: VehicleKind, lane: Lane, s: number, mode: DriveMode = 'cruise', role: 'civilian' | 'police' | 'gang' = 'civilian', look?: Look, speed0?: number, pose?: { x: number; z: number; yaw: number }): AiCar {
    samplePath(lane, s, sp);
    // a promoted far car takes over exactly where it was drawn (lane offset, heading); everything spawns settled on its
    // springs at the road height: no drop and bounce (tall trucks used to land hard and tip)
    const yaw = pose?.yaw ?? Math.atan2(sp.dx, sp.dz), px = pose?.x ?? sp.x, pz = pose?.z ?? sp.z;
    const v = this.vehicles.spawn(kind, px, pz, yaw);
    v.phys.settleAt(px, lane.ys ? (sp.y ?? 0) : 0, pz, yaw);
    // start at the speed the caller handed over (a far-crowd car being promoted), never faster than it could stop for a red
    let v0 = speed0 ?? lane.speed * 0.6;
    if (!lane.connector && mode === 'cruise') v0 = Math.min(v0, signalCap(signalState(this.city.intersections[lane.intersection], laneSigAxis(lane), this.time()), lane.length - s - 5.2, v0));
    v.phys.setVelocity(Math.sin(yaw) * v0, 0, Math.cos(yaw) * v0); // syncs the crash detector: a car spawned moving must not 'crash' into its own speed
    const driver = this.pop.spawn(role, sp.x, sp.z, 0.5, look);
    this.seat(driver, v);
    const car: AiCar = { v, driver, lane, s, mode, target: null, stuckT: 0, honkT: 0, reverseT: 0, persistent: false, ram: false, arriveDist: 8 };
    // a promoted far car keeps its lateral place in the lane (it was tucked away from the kerbside parked row): no swerve back into it
    if (pose) { const l = Math.hypot(sp.dx, sp.dz) || 1; car.shift = THREE.MathUtils.clamp(((px - sp.x) * sp.dz - (pz - sp.z) * sp.dx) / l, -1.4, 1.4); }
    // some civilians drive with a friend in the front passenger seat
    if (role === 'civilian' && mode === 'cruise' && v.tpl.seats.length > 1 && v.doorIndex('right', 0) >= 0 && Math.random() < 0.2) {
      const pax = this.pop.spawn('civilian', sp.x, sp.z, 0.5);
      this.seat(pax, v, 1); car.passengers = [pax];
    }
    this.cars.push(car);
    return car;
  }
  seat(n: Npc, v: Vehicle, seat = 0) {
    n.brain = 'passenger'; n.char.inVehicle = v; n.char.setCollision(false);
    if (seat === 0) v.driver = n.char;
    v.visual.add(n.char.human.root);
    n.char.human.root.position.copy(v.seatLocal(seat)); n.char.human.root.rotation.set(0, 0, 0);
    n.char.human.setState('drive');
    if (n.model) n.model.visible = false;
  }
  /** Removes the NPC from the car and places it at the door. */
  eject(car: AiCar | null, v: Vehicle, side: 1 | -1 = 1): Npc | null {
    const n = car?.driver ?? this.pop.npcs.find(x => x.char.inVehicle === v) ?? null;
    if (car) this.cars.splice(this.cars.indexOf(car), 1);
    if (!n) return null;
    const p = v.doorPoint(side);
    this.pop.adopt(n);
    n.char.inVehicle = null; if (v.driver === n.char) v.driver = null;
    n.char.place(p.x, Math.max(0.2, v.position.y), p.z, v.yaw);
    n.char.setCollision(true);
    n.char.human.setState('loco');
    n.brain = n.role === 'civilian' ? 'flee' : 'combat'; n.stateT = 0; n.fleeFrom.copy(v.position);
    return n;
  }
  /** A passenger gets out on their own side and runs. */
  ejectPassenger(n: Npc, v: Vehicle) {
    const side = n.char.human.root.position.x >= 0 ? 1 : -1;
    const p = v.doorPoint(side as 1 | -1);
    this.pop.adopt(n);
    n.char.inVehicle = null;
    n.char.place(p.x, Math.max(0.2, v.position.y), p.z, v.yaw);
    n.char.setCollision(true); n.char.human.setState('loco');
    n.brain = 'flee'; n.stateT = 0; n.fleeFrom.copy(v.position);
  }
  carOf(v: Vehicle) { const cs = this.cars; for (let i = 0; i < cs.length; i++) if (cs[i].v === v) return cs[i]; return null; } // (no closure: it is called per car x per vehicle each step)
  /**
   * Takes a car out of AI control without moving anyone (scripted carjacks animate the occupants themselves).
   * Returns the driver and passengers that were in it.
   */
  release(v: Vehicle): { driver: Npc | null; passengers: Npc[] } {
    const car = this.carOf(v);
    if (car) this.cars.splice(this.cars.indexOf(car), 1);
    const inside = this.pop.npcs.filter(n => n.char.inVehicle === v && n.alive);
    const driver = inside.find(n => n.char === v.driver) ?? null;
    v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true;
    return { driver, passengers: inside.filter(n => n !== driver) };
  }
  /** Someone (the player) walks up to a car: a startled civilian driver may floor it. Returns true if they drive off. */
  startle(v: Vehicle, chance = 0.35): boolean {
    const car = this.carOf(v);
    if (!car || car.persistent || car.driver.role !== 'civilian' || car.mode !== 'cruise' || Math.random() >= chance) return false;
    car.mode = 'flee'; car.maxSpeed = undefined; car.honkT = -3;
    this.audio.play('horn', { pos: v.position, volume: 0.7 });
    this.audio.play('tireScreech', { pos: v.position, volume: 0.6 });
    return true;
  }
  panic(v: Vehicle) { const c = this.carOf(v); if (c && c.mode === 'cruise') { c.mode = 'flee'; c.maxSpeed = undefined; c.stopPlan = null; c.stopT = 0; } }
  /**
   * Somebody opens fire: the driver of a car the bullets hit always panics, so do cars within 15 m of an impact;
   * other cars only react close to the muzzle (10 m). Panicked drivers floor it, or bail out on foot if boxed in (see fixedUpdate).
   */
  gunfire(origin: THREE.Vector3, shooter?: THREE.Vector3, hits: { target: unknown; point: THREE.Vector3 }[] = [], muzzleRadius = 10) {
    const t = this.time();
    for (const c of this.cars) {
      if (c.persistent || c.mode !== 'cruise' || c.driver.role !== 'civilian' || c.v.destroyed) continue;
      const p = c.v.position;
      const hitMe = hits.some(h => h.target === c.v || (h.point && h.point.distanceTo(p) < 15));
      if (!hitMe && p.distanceTo(origin) > muzzleRadius && !(shooter && p.distanceTo(shooter) < muzzleRadius)) continue;
      this.panic(c.v);
      if (t - (c.lastHonk ?? -99) > 3) { c.lastHonk = t; this.audio.play('horn', { pos: p, volume: 0.6 }); this.stats.honks++; }
    }
  }
  private honk(car: AiCar, t: number, vol = 0.65, gap = 4) { if (t - (car.lastHonk ?? -99) < gap) return; car.lastHonk = t; this.stats.honks++; this.audio.play('horn', { pos: car.v.position, volume: vol, pitch: 0.9 + this.rng.next() * 0.25 }); }
  /** Any driven or moving vehicle inside the junction box (bodies parked beside it do not count). */
  private boxBusy(inter: { x: number; z: number; halfX: number; halfZ: number }, self: Vehicle): boolean {
    for (const o of this.vehicles.list) {
      if (o === self || (!o.driver && Math.abs(o.speed) < 0.6)) continue;
      if (Math.abs(o.position.x - inter.x) < inter.halfX + 2 && Math.abs(o.position.z - inter.z) < inter.halfZ + 2) return true;
    }
    return false;
  }
  private turnCache = new Map<number, number>();
  /** 1 = left, -1 = right, 0 = straight, for a junction connector lane. */
  turnOf(id: number): number {
    let r = this.turnCache.get(id);
    if (r === undefined) {
      const nl = this.city.lanes[id], a = nl.points[0], b = nl.points[nl.points.length - 1], p1 = nl.points[1] ?? b, pn = nl.points[nl.points.length - 2] ?? a;
      const d0 = Math.hypot(p1.x - a.x, p1.z - a.z) || 1, d1 = Math.hypot(b.x - pn.x, b.z - pn.z) || 1;
      r = nl.connector ? turnSide((p1.x - a.x) / d0, (p1.z - a.z) / d0, (b.x - pn.x) / d1, (b.z - pn.z) / d1) : 0; this.turnCache.set(id, r);
    }
    return r;
  }
  /** Round 13: an AI car approaching junction `interId` that will halt for its own amber/red (a clearing left turner may go). */
  private stopsForSignal(o: Vehicle, interId: number, t: number): boolean {
    const oc = this.carOf(o);
    if (!oc || (oc.mode !== 'cruise' && oc.mode !== 'goto') || oc.lane.connector || oc.lane.intersection !== interId) return false;
    if (oc.mode === 'goto' && oc.driver.role !== 'civilian') return false;
    const oi = this.city.intersections[interId], ax = laneSigAxis(oc.lane);
    const left = oc.nextChoice !== undefined && this.turnOf(oc.nextChoice) === 1;
    return willStopForSignal(signalState(oi, ax, t), this.distToStop(oc), o.speed, left ? 0 : yellowLeft(oi, ax, t));
  }
  /**
   * A left turner waits while the box is busy, an oncoming car would reach the junction within a few seconds, or an
   * opposing left turner with priority (lower id) is about to go. After a long wait (`patient` false) only a car that is
   * really close still holds it (a deadlock breaker that never drives into a moving car).
   */
  private leftBlocked(inter: { id: number; x: number; z: number; halfX: number; halfZ: number }, self: Vehicle, f: { x: number; z: number }, patient = true, clearT?: number): boolean {
    // Round 13: `clearT` set = our light is in its amber/all-red, so oncoming cars that will stop for theirs do not count
    const clearing = clearT !== undefined;
    if (patient && this.boxBusy(inter, self)) return true;
    for (const o of this.vehicles.list) {
      if (o === self) continue;
      const of = o.phys.forward(), sg = o.speed < 0 ? -1 : 1, ox = o.position.x - inter.x, oz = o.position.z - inter.z;
      // Round 11 (zero crashes): an oncoming car standing first at its own line on our green is about to pull away, not
      // parked: judge it as if already rolling (left turners went, it set off and hit them mid-turn)
      const osp = Math.abs(o.speed);
      if (clearing && this.stopsForSignal(o, inter.id, clearT)) continue;
      let mayGo = false;
      if (osp < 1.5 && !clearing) { const oc = this.carOf(o); mayGo = !!oc && !oc.lane.connector && oc.lane.intersection === inter.id && this.distToStop(oc) < 6 && !(oc.nextChoice !== undefined && this.turnOf(oc.nextChoice) === 1); }
      if (oncomingConflict(ox, oz, of.x * sg, of.z * sg, osp, f.x, f.z, mayGo) && (patient || arrivalTime(Math.hypot(ox, oz), osp) < 3.5)) return true;
      if (!patient) { if (Math.abs(ox) < inter.halfX && Math.abs(oz) < inter.halfZ && Math.abs(o.speed) > 1) return true; continue; }
      // opposing left turner waiting at its line: the lower id goes first (their paths can cross at uneven junctions)
      if (o.id < self.id && of.x * f.x + of.z * f.z < -0.7) {
        const oc = this.carOf(o);
        if (oc && !oc.lane.connector && oc.lane.intersection === inter.id && oc.nextChoice !== undefined && this.turnOf(oc.nextChoice) === 1 && this.distToStop(oc) < 10) return true;
      }
    }
    // Round 11: an opposing left turner already part-way through its turn has the box: wait until it is out of our path
    for (const oc of this.cars) {
      if (oc.v === self || !oc.lane.connector || oc.lane.intersection !== inter.id || this.turnOf(oc.lane.id) !== 1 || oc.s > oc.lane.length * 0.8) continue;
      const p0 = oc.lane.points[0], p1 = oc.lane.points[1], l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
      if (((p1.x - p0.x) * f.x + (p1.z - p0.z) * f.z) / l < -0.7) return true;
    }
    // Round 10: the far crowd's drawn cars count too (an oncoming one 60-90 m out is not a real car yet)
    for (const o of this.farObs) {
      if (clearing) break; // 60-90 m out on amber: they stop for it
      if (o.yaw === undefined || !o.v) continue;
      const ox = o.x - inter.x, oz = o.z - inter.z;
      if (oncomingConflict(ox, oz, Math.sin(o.yaw), Math.cos(o.yaw), o.v, f.x, f.z) && (patient || arrivalTime(Math.hypot(ox, oz), o.v) < 3.5)) return true;
    }
    return false;
  }
  /**
   * Round 10 (owner: left turners caused the crashes): a green light is no licence to drive into a car still crossing the
   * box from the other street (a left turner clearing after its light changed). True while such a car is in a connector of
   * this junction that started across our heading.
   */
  crossInBox(car: AiCar, interId: number, f: { x: number; z: number }): boolean {
    for (const o of this.cars) {
      if (o === car || !o.lane.connector || o.lane.intersection !== interId) continue;
      const p0 = o.lane.points[0], p1 = o.lane.points[1], l = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1;
      if (Math.abs(((p1.x - p0.x) * f.x + (p1.z - p0.z) * f.z) / l) < 0.85 && o.s < o.lane.length - 2) return true;
    }
    return false;
  }
  /** Round 9 (owner: cars stopped on the crosswalk): the stop point keeps the nose behind the zebra (3 m) whatever the car's length. */
  private distToStop(car: AiCar): number { return car.lane.connector ? Infinity : car.lane.length - car.s - stopBack(car.v.phys.layout.half[2]); }

  private aimBuf = new THREE.Vector3();
  // Round 14 (CS): per-step spatial hashes so each car only tests nearby vehicles / pedestrians instead of all of them
  private vGrid = new SpatialGrid<Vehicle>(32); private nGrid = new SpatialGrid<Npc>(32);
  private vNear: Vehicle[] = []; private nNear: Npc[] = [];
  fixedUpdate(dt: number, player: Character, playerVehicle: Vehicle | null) {
    const t = this.time();
    this.monitorPlayer(dt, t, playerVehicle);
    while (this.crashes.length && t - this.crashes[0].t > 20) this.crashes.shift();
    const sirens: Vehicle[] = [];
    if (playerVehicle?.sirenOn) sirens.push(playerVehicle);
    for (const c of this.cars) if (c.v.sirenOn && !c.persistent) sirens.push(c.v);
    this.vGrid.clear(); this.nGrid.clear();
    for (const o of this.vehicles.list) this.vGrid.insert(o, o.position.x, o.position.z);
    for (const n of this.pop.npcs) if (n.alive && !n.char.inVehicle && !n.far) this.nGrid.insert(n, n.pos.x, n.pos.z);
    this.sirenSources.length = 0;
    for (const sv of sirens) { const sf = sv.phys.forward(); this.sirenSources.push({ x: sv.position.x, z: sv.position.z, fx: sf.x, fz: sf.z, speed: sv.speed }); }
    for (const car of [...this.cars]) {
      const v = car.v;
      if (v.disposed) { const k = this.cars.indexOf(car); if (k >= 0) this.cars.splice(k, 1); continue; }
      if (v.destroyed || !car.driver.alive || v.driver !== car.driver.char) {
        // driver gone (carjacked, killed, destroyed car)
        const idx = this.cars.indexOf(car); if (idx >= 0) this.cars.splice(idx, 1);
        if (car.driver.alive && car.driver.char.inVehicle === v) this.eject(null, v, 1);
        for (const p of car.passengers ?? []) if (p.alive && p.char.inVehicle === v) this.ejectPassenger(p, v);
        v.input.throttle = 0; v.input.handbrake = car.driver.alive || v.destroyed; // COMBAT: a driver shot dead in the seat lets the car coast
        continue;
      }
      v.syncTransform();
      const pos = v.position, f = v.phys.forward();
      const speed = v.speed;
      // progress along the lane
      if (car.mode !== 'pursuit' && car.mode !== 'goto' || !car.target || pos.distanceTo(car.target) > 40) this.advanceLane(car, pos, car.target);
      // Round 9 (owner: cops should chase quickly): a pursuit car runs at ~2.6x the limit (60-70 mph in town) on its route
      let targetSpeed = car.maxSpeed ?? (car.mode === 'pursuit' ? Math.max(28, car.lane.speed * 2.6) : car.lane.speed * (car.mode === 'flee' ? 1.6 : 1));
      let legit = false, depth = 0;
      const civ = car.mode === 'cruise' && !car.persistent && car.driver.role === 'civilian';
      // shot at: a driver whose car just took damage from the player floors it
      if (car.hp !== undefined && v.health < car.hp - 0.5 && civ && v.lastDamagedBy === player) this.panic(v);
      car.hp = v.health;
      // sirens (a police car, or a stolen one the player is driving): pull over to the kerb and let it by
      car.yieldT = (car.yieldT ?? 0) - dt; car.crashT = (car.crashT ?? 0) - dt;
      let crashD = Infinity, crashLat = 0, passCap = Infinity;
      if (civ && !car.lane.connector) {
        for (const sv of sirens) {
          if (sv === v) continue;
          const sf = sv.phys.forward();
          if (yieldsToSiren(pos.x, pos.z, f.x, f.z, sv.position.x, sv.position.z, sf.x, sf.z, sv.speed)) { if (car.yieldT <= 0) this.stats.yields++; car.yieldT = 2.5; break; }
        }
        // an accident ahead: slow down, tuck to the kerb and stop short of it
        for (const cs of this.crashes) {
          if (cs.v === v) continue;
          // Round 10: after 5 s (Round 7: pile-ups clear faster) nobody stops for it any more, but drivers still crawl past a
          // wreck that is still standing there instead of sweeping by at 25+ km/h
          if (t - cs.t > 5) {
            const wx = cs.v.position.x - pos.x, wz = cs.v.position.z - pos.z, wa = wx * f.x + wz * f.z;
            if (Math.abs(cs.v.speed) < 0.6 && cs.v.position.distanceTo(cs.pos) < 6 && wa > -2 && wa < 22 && Math.abs(wx * f.z - wz * f.x) < 6) passCap = 4;
            continue;
          }
          const dx = cs.pos.x - pos.x, dz = cs.pos.z - pos.z, ahead = dx * f.x + dz * f.z;
          if (ahead < -3 || ahead > 42) continue;
          const lat = dx * f.z - dz * f.x;
          if (ahead < crashD) { crashD = ahead; crashLat = lat; }
          car.crashT = Math.max(car.crashT, 2.5);
        }
      }
      if (this.crashes.some(c => c.v === v && t - c.t < 2.5)) { v.hazard = true; legit = true; targetSpeed = 0; } else if (v.hazard && !car.stopT) v.hazard = false;
      if (car.yieldT > 0) { legit = true; targetSpeed = Math.min(targetSpeed, car.yieldT > 2.2 ? 4 : 0); }
      targetSpeed = Math.min(targetSpeed, passCap);
      if (car.crashT > 0 && crashD < Infinity) { legit = true; targetSpeed = Math.min(targetSpeed, crashD < 16 && Math.abs(crashLat) < 3.4 ? Math.max(0, (crashD - 9) * 0.5) : 5); }
      // lateral offset inside the lane: clear kerbside parked cars, tuck right for sirens / crashes
      {
        let want = 0;
        if (car.mode === 'cruise' && !car.lane.connector) {
          const ohw0 = v.phys.layout.half[0];
          const cNear = this.vNear; cNear.length = 0; this.vGrid.query(pos.x, pos.z, 32, cNear);
          for (let ci = 0; ci < cNear.length; ci++) {
            const o = cNear[ci];
            if (o === v || Math.abs(o.speed) > 0.6 || o.driver || o.position.y > 3) continue;
            const dx = o.position.x - pos.x, dz = o.position.z - pos.z, ahead = dx * f.x + dz * f.z;
            if (ahead < -2 || ahead > 26 || (o !== playerVehicle && this.carOf(o))) continue;
            // Round 11 (zero crashes): measured from the lane line, not from where the shift has already put us (that
            // feedback settled at about half the clearance needed: wide cars still scraped parked vans)
            const lat = dx * f.z - dz * f.x + (car.shift ?? 0);
            if (lat > -0.4 || lat < -3.6) continue;
            want = Math.max(want, curbShift(lat, ohw0, o.phys.layout.half[0]));
          }
          if (want <= 0 && (car.yieldT > 0 || car.crashT > 0)) want = car.lane.lane === car.lane.lanes - 1 ? -1.3 : -0.8;
        }
        car.shift = (car.shift ?? 0) + (want - (car.shift ?? 0)) * Math.min(1, dt * 2.5);
      }
      const aim = this.aimBuf;
      const look = THREE.MathUtils.clamp(Math.abs(speed) * 0.55 + 4, 5, 16);
      if ((car.mode === 'pursuit' || car.mode === 'goto') && car.target && pos.distanceTo(car.target) < 40) {
        aim.copy(car.target);
        const d = pos.distanceTo(car.target);
        // Round 9: close in at the suspect's own speed plus the gap (it was capped at 26 m/s: a fast car simply drove away)
        const tsp = Math.abs(car.targetVel ?? 0);
        targetSpeed = car.mode === 'pursuit' ? (car.ram ? Math.max(26, tsp + 6) : Math.min(42, tsp * 1.05 + Math.max(0, d - 9) * 1.2)) : Math.min(car.maxSpeed ?? 14, Math.max(0, d - car.arriveDist) * 1.5);
        if (car.mode === 'goto' && d < car.arriveDist + 1 && car.onArrive) { const cb = car.onArrive; car.onArrive = undefined; cb(); }
      } else {
        let s = car.s + look, lane = car.lane;
        const nextChoice = car.nextChoice ?? lane.next[0];
        if (s > lane.length && lane.next.length) { s -= lane.length; lane = this.city.lanes[nextChoice]; if (s > lane.length && lane.next.length) { s -= lane.length; lane = this.city.lanes[this.chooseNext(lane, car.target, true)]; } }
        samplePath(lane, Math.min(s, lane.length), sp); aim.set(sp.x, 0, sp.z);
        // pull out around a stopped obstacle
        { const l = Math.hypot(sp.dx, sp.dz) || 1, off = (car.avoid ? car.avoid.side * 3.4 : 0) + (car.shift ?? 0); aim.x += off * (sp.dz / l); aim.z += off * (-sp.dx / l); }
      }
      // Slow for corners: angle between heading and the aim point
      { const ax = aim.x - pos.x, az = aim.z - pos.z, al = Math.hypot(ax, az) || 1; const cosA = (ax * f.x + az * f.z) / al; const ang = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1)); if (ang > 0.25) targetSpeed = Math.min(targetSpeed, Math.max(car.mode === 'pursuit' ? 8 : 3.6, targetSpeed * (1.15 - ang * 1.1))); }
      // Brake ahead of a turn on the route (matters at race speed): v² = v_turn² + 2·a·d
      if (!car.lane.connector && car.nextChoice !== undefined) {
        const nl = this.city.lanes[car.nextChoice];
        if (nl.connector && nl.speed < 10) targetSpeed = Math.min(targetSpeed, Math.sqrt(nl.speed * nl.speed + 2 * (car.mode === 'pursuit' ? 6 : 2.6) * Math.max(0, car.lane.length - car.s - 3))); // Round 9: brake gently into a turn
      }
      // Signals
      if ((car.mode === 'cruise' || car.mode === 'goto') && !car.lane.connector && !(car.mode === 'goto' && (car.driver.role !== 'civilian' || (car.target && pos.distanceTo(car.target) < 20 && skipSignalNearTarget(this.distToStop(car)))))) {
        const inter = this.city.intersections[car.lane.intersection];
        const st = signalState(inter, laneSigAxis(car.lane), t);
        const dStop = this.distToStop(car);
        // Round 10: a left turner gives way to oncoming traffic, so it cannot count on clearing the box before the red at its
        // current speed: amber means stop unless it physically cannot (it used to commit, slow for the turn and enter on red)
        // ...except the one already waiting at the line: it takes the amber to turn once the oncoming cars stop (gap check below)
        const leftTurn = car.nextChoice !== undefined && this.turnOf(car.nextChoice) === 1, yl = yellowLeft(inter, laneSigAxis(car.lane), t);
        // Round 13 (owner: left-lane cars not going): the first left turner takes the amber to turn once oncoming traffic is
        // stopping (it used to get 0.8 s of amber and sat through cycles); once started it is committed
        if (car.clearGo !== undefined && (car.clearGo !== car.lane.id || (st === 'red' && dStop > -BOX_EDGE && Math.abs(speed) < 1))) car.clearGo = undefined;
        const clearing = leftTurn && leftClearing(st, yl, dStop, speed, car.clearGo === car.lane.id);
        const sneak = clearing;
        const cap = sneak ? Infinity : signalCap(st, dStop, Math.max(0, speed), leftTurn ? 0 : yl);
        if (cap < Infinity) { targetSpeed = Math.min(targetSpeed, cap); legit = true; }
        else if (inter.signalized && dStop > -1 && dStop < 15 && this.crossInBox(car, inter.id, f)) { targetSpeed = Math.min(targetSpeed, lineStop(dStop)); legit = true; }
        // Round 10: a left turner that rolled past the bar still yields until its nose reaches the box (it skipped the check)
        else if (dStop > (car.nextChoice !== undefined && this.turnOf(car.nextChoice) === 1 && inter.signalized ? -BOX_EDGE + 0.5 : -1) && dStop < 45) {
          // no protection from the light: stop signs at plain junctions, yield for a left turn across oncoming traffic
          if (car.ssLane !== car.lane.id) { car.ssLane = car.lane.id; car.ssWait = 0; }
          const standing = dStop < 1.8 && Math.abs(speed) < 0.4;
          if (!inter.signalized) {
            if (standing) car.ssWait = (car.ssWait ?? 0) + dt;
            const c2 = stopSignCap(dStop, speed, car.ssWait ?? 0, dStop > 14 || !this.boxBusy(inter, v));
            if (c2 < Infinity) { targetSpeed = Math.min(targetSpeed, c2); legit = true; }
          } else if (dStop < 22 && car.nextChoice !== undefined) {
            if (this.turnOf(car.nextChoice) === 1) {
              if (standing) car.ssWait = (car.ssWait ?? 0) + dt;
              if (this.leftBlocked(inter, v, f, (car.ssWait ?? 0) < LEFT_PATIENCE, sneak ? t : undefined)) { targetSpeed = Math.min(targetSpeed, lineStop(dStop)); legit = true; }
              else if (sneak) car.clearGo = car.lane.id;
            }
          }
        }
      }
      // Round 9 (owner: left turns caused the most disruption): a left-turner that has just started into the junction still
      // stops for an oncoming car about to arrive (one that sped up or appeared after the gap check at the line)
      // Round 10: only while still short of the oncoming lanes (it used to halt at 35%, right across them, and got T-boned):
      // once over that point the turn is committed and finished briskly
      if (car.mode === 'cruise' && car.lane.connector && car.s < car.lane.length * 0.22 && this.turnOf(car.lane.id) === 1) {
        const inter = this.city.intersections[car.lane.intersection], p0 = car.lane.points[0], p1 = car.lane.points[1];
        const l0 = Math.hypot(p1.x - p0.x, p1.z - p0.z) || 1, ax = (p1.x - p0.x) / l0, az = (p1.z - p0.z) / l0;
        for (const o of this.vehicles.list) {
          if (o === v || Math.abs(o.speed) < 3) continue;
          const of = o.phys.forward(), sg = o.speed < 0 ? -1 : 1, ox = o.position.x - inter.x, oz = o.position.z - inter.z;
          if (oncomingConflict(ox, oz, of.x * sg, of.z * sg, Math.abs(o.speed), ax, az) && Math.hypot(ox, oz) / Math.abs(o.speed) < 2.6 && !this.stopsForSignal(o, inter.id, t)) {
            targetSpeed = Math.min(targetSpeed, stopSpeed(Math.max(0, car.lane.length * 0.22 - car.s - 1.5))); legit = true; break;
          }
        }
      }
      // never block the box: hold at the line while the lane beyond the junction is backed up at its start
      if (car.mode === 'cruise' && !car.persistent && !car.lane.connector && car.nextChoice !== undefined) {
        const dS = this.distToStop(car);
        if (dS > -0.5 && dS < 10) {
          const conn = this.city.lanes[car.nextChoice], exit = conn.connector && conn.next.length ? conn.next[0] : -1;
          const full = exit >= 0 && this.cars.some(o => o !== car && o.lane.id === exit && o.s < 11 && Math.abs(o.v.speed) < 1.2);
          if (full && (car.boxWait ?? 0) < 10) { car.boxWait = (car.boxWait ?? 0) + (Math.abs(speed) < 0.5 ? dt : 0); targetSpeed = Math.min(targetSpeed, lineStop(dS)); legit = true; }
        } else car.boxWait = 0;
      }
      if (car.mode === 'cruise' && !car.persistent) { targetSpeed = this.curbStops(car, dt, targetSpeed, f, t); if ((car.stopT ?? 0) > 0 || car.stopPlan) legit = true; }
      // Following distance / obstacles ahead
      let blockDist = Infinity, blocker: 'car' | 'person' | null = null, blockerV: Vehicle | null = null, blockerLat = 0;
      const check = (ox: number, oz: number, radius: number, kind: 'car' | 'person', ov: Vehicle | null = null, latOff = 0) => {
        const dx = ox - pos.x, dz = oz - pos.z;
        const ahead = dx * f.x + dz * f.z; if (ahead < 1 || ahead > Math.max(26, speed * 1.8)) return;
        const latS = dx * f.z - dz * f.x, lat = Math.abs(latS - latOff); if (lat > radius) return;
        if (ahead < blockDist) { blockDist = ahead; blocker = kind; blockerV = ov; blockerLat = latS; }
      };
      if (car.avoid) {
        // finished once the obstacle is behind us, or give up after a while
        const o = car.avoid.v, dx = o.position.x - pos.x, dz = o.position.z - pos.z;
        car.avoid.t += dt;
        if (dx * f.x + dz * f.z < -4 || car.avoid.t > 14 || !this.vehicles.list.includes(o)) car.avoid = null;
      }
      const ghost = (car.ghostT ?? 0) > 0; if (ghost) car.ghostT = (car.ghostT ?? 0) - dt;
      const vNear = this.vNear; vNear.length = 0; this.vGrid.query(pos.x, pos.z, Math.max(26, speed * 1.8) + 6, vNear);
      for (let vi = 0; vi < vNear.length; vi++) {
        const o = vNear[vi];
        if (o === v || o === car.avoid?.v) continue;
        if (ghost && o !== playerVehicle && this.carOf(o)) continue; // deadlock breaker: drive through (the bodies just nudge each other)
        // a stopped car nobody drives (kerbside parked, wrecked): judged by its real width and by where we are steering
        if (!o.driver && Math.abs(o.speed) < 0.6 && o !== playerVehicle) check(o.position.x, o.position.z, v.phys.layout.half[0] + o.phys.layout.half[0] + 0.45, 'car', o, car.shift ?? 0);
        else check(o.position.x, o.position.z, 2.3, 'car', o);
      }
      // far-crowd cars ahead (drawn, not simulated physically): queue behind them like any car instead of driving into them
      let farBlock = false;
      for (const o of this.farObs) { const was = blockDist; check(o.x, o.z, 2.1, 'car', null); if (blockDist < was) farBlock = true; }
      if (!player.inVehicle && player.alive) check(player.pos.x, player.pos.z, 1.9, 'person');
      const nNear = this.nNear; nNear.length = 0; this.nGrid.query(pos.x, pos.z, Math.max(26, speed * 1.8) + 6, nNear);
      for (let ni = 0; ni < nNear.length; ni++) { const n = nNear[ni]; check(n.pos.x, n.pos.z, 1.7, 'person'); }
      if (blockDist < Infinity && !(car.mode === 'pursuit' && car.ram)) {
        const gap = blocker === 'car' ? 6.5 + Math.max(0, speed) * 0.4 : 5.5;
        targetSpeed = Math.min(targetSpeed, Math.max(0, (blockDist - gap) * 0.8));
        // A stopped car nobody in traffic is driving (parked, abandoned, wrecked, or the player waiting) never moves on its own:
        // after a few seconds, pull out and pass it.
        const bv = blockerV as Vehicle | null;
        const boc = bv ? this.carOf(bv) : null;
        car.blockedBy = bv;
        if (blocker === 'person') legit = true;
        else if (!bv && farBlock) legit = true; // a far car moves on by itself
        else if (bv) {
          if (bv === playerVehicle) {
            legit = true;
            // cut off / blocked by the player: lean on the horn
            if (car.mode === 'cruise' && blockDist < 14 && speed > 5 && speed - bv.speed > 4) this.honk(car, t, 0.8, 3.5);
            else if (car.mode === 'cruise' && blockDist < 10 && Math.abs(speed) < 1.5) { car.honkT += dt; if (car.honkT > 2) { car.honkT = -1.5; this.honk(car, t, 0.7, 1); } }
          } else if (boc && !car.lane.connector && ((boc.legitWait && (boc.legitDepth ?? 0) < 14) || Math.abs(bv.speed) > 0.8)) { legit = true; depth = (boc.legitDepth ?? 0) + 1; } // a queue behind a red; chains that never reach a root cause (cycles) stop counting
          else if (boc && Math.abs(bv.speed) > 0.8) legit = true;
          // two cars nose to nose (or a cycle in the intersection): the one in the box goes through
          if (boc && boc.blockedBy === v && car.mode === 'cruise' && (car.lane.connector || car.lane.length - car.s < 10 || v.id < bv.id) && (car.jamT ?? 0) > (car.lane.connector ? 1.5 : 4) && (car.ghostT ?? 0) <= 0) { car.ghostT = 6; this.stats.jamBreaks++; }
        }
        // ...or an AI car that is itself stuck (wrecked, tangled in a pile-up, its driver gone): go round it quickly
        const stuckAi = !!boc && !boc.legitWait && ((boc.jamT ?? 0) > 1.5 || !boc.driver.alive || boc.driver.char.inVehicle !== bv || (bv?.destroyed ?? false));
        // Round 9: a pursuit car goes round anything slow in its way at once (traffic yields, but not always in time)
        const chaseBlock = car.mode === 'pursuit' && !!bv && bv !== playerVehicle && Math.abs(bv.speed) < 6 && blockDist < 18;
        if (chaseBlock || (bv && Math.abs(bv.speed) < 0.6 && (!boc || stuckAi) && Math.abs(speed) < 1 && car.mode !== 'pursuit')) {
          car.blockedT = (car.blockedT ?? 0) + dt * (chaseBlock ? 3 : 1);
          if (car.blockedT > 1.5 && !car.avoid) { car.avoid = { v: bv, side: blockerLat > 0.4 ? -1 : 1, t: 0 }; car.blockedT = 0; }
        } else car.blockedT = 0;
        // honk at somebody stepping out in front of a moving car (jaywalkers)
        if (blocker === 'person' && speed > 3 && blockDist < 15 && t - (car.lastHonk ?? -99) > 5) { car.lastHonk = t; this.audio.play('horn', { pos, volume: 0.55 }); }
        if (blocker === 'person' && blockDist < 9 && Math.abs(speed) < 2) { car.honkT += dt; if (car.honkT > 1.6) { car.honkT = -2.5; this.audio.play('horn', { pos, volume: 0.6 }); } }
      }
      if (blockDist === Infinity) car.blockedBy = null;
      car.legitWait = legit; car.legitDepth = legit ? depth : 0;
      if (car.lane.connector && car.mode === 'cruise' && (car.jamT ?? 0) > 2.5 && (car.ghostT ?? 0) <= 0 && blockerV && blockerV !== playerVehicle && this.carOf(blockerV)) { car.ghostT = 6; this.stats.jamBreaks++; }
      // gridlock watchdog: stopped with nothing legitimate to wait for
      if (car.mode === 'cruise' && !car.persistent && Math.abs(speed) < 0.8 && targetSpeed < 0.3 && !legit) car.jamT = (car.jamT ?? 0) + dt;
      else if (Math.abs(speed) > 2 || legit) car.jamT = 0;
      if ((car.jamT ?? 0) > 5 && car.reverseT <= 0 && (car.jamT ?? 0) % 6 < dt) { car.reverseT = 1.4; car.lcCool = 0; this.stats.jamBreaks++; }
      // panicking and boxed in: bail out and run
      if (car.mode === 'flee' && !car.persistent && blockDist < 7 && Math.abs(speed) < 1.5) { car.boxedT = (car.boxedT ?? 0) + dt; if (car.boxedT > 2) { for (const p of car.passengers ?? []) if (p.alive && p.char.inVehicle === v) this.ejectPassenger(p, v); this.eject(car, v, 1); continue; } } else car.boxedT = 0;
      this.laneChange(car, dt, pos, f, speed, blockDist, blocker, blockerV);
      // Pure-pursuit steering
      v.phys.refreshPose(); const pp = v.phys.cPos;
      const adx = aim.x - pp.x, adz = aim.z - pp.z;
      const local = { x: adx * f.z - adz * f.x, z: adx * f.x + adz * f.z };
      let steer = THREE.MathUtils.clamp(Math.atan2(local.x, Math.max(0.5, local.z)) * 2.0, -1, 1);
      if (local.z < 0 && (car.mode === 'pursuit' || car.mode === 'goto')) steer = Math.sign(local.x || 1);
      // Stuck handling: reverse briefly
      if (targetSpeed > 2 && Math.abs(speed) < 0.6) car.stuckT += dt; else car.stuckT = Math.max(0, car.stuckT - dt);
      if (car.stuckT > 2.2) { car.reverseT = 1.4; car.stuckT = 0; }
      let throttle: number;
      if (car.reverseT > 0) { car.reverseT -= dt; throttle = -0.8; steer = -steer; }
      else throttle = aiPedal(targetSpeed - speed, speed, targetSpeed);
      v.input.throttle = throttle; v.input.steer = steer; v.input.handbrake = targetSpeed < 0.3 && Math.abs(speed) < 0.5;
      v.siren = car.mode === 'pursuit' || (car.driver.role === 'police' && car.mode === 'goto');
    }
  }
  /** Is a world point inside the camera view (as of the last update)? */
  seen(p: THREE.Vector3): boolean { return this.frustum.containsPoint(p); }
  /** Samples the player's driving at 8 Hz and reports violations (see onPlayerTrafficViolation). */
  private hitLatch = false; private monAcc = 0;
  private monitorPlayer(dt: number, t: number, pv: Vehicle | null) {
    if (!pv || pv.destroyed) { this.monAcc = 0; this.hitLatch = false; return; }
    if (pv.phys.impact > 2.5 && this.vehicles.list.some(o => o !== pv && o.position.distanceTo(pv.position) < 5)) this.hitLatch = true;
    this.monAcc += dt;
    if (this.monAcc < 0.125) return;
    const adt = this.monAcc; this.monAcc = 0;
    const p = pv.position, f = pv.phys.forward();
    let best: Lane | null = null, bd = Infinity, bs = 0;
    for (const l of this.nearLanes) {
      for (let i = 1; i < l.points.length; i++) {
        const a = l.points[i - 1], b = l.points[i], vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
        const u = Math.max(0, Math.min(1, ((p.x - a.x) * vx + (p.z - a.z) * vz) / l2));
        const d = Math.hypot(p.x - (a.x + vx * u), p.z - (a.z + vz * u));
        if (d < bd) { bd = d; best = l; bs = l.cum[i - 1] + Math.sqrt(l2) * u; }
      }
    }
    let probe: LaneProbe | null = null;
    if (best) { samplePath(best, bs, sp); probe = { id: best.id, limit: best.speed, dist: bd, dx: sp.dx, dz: sp.dz, toStop: best.length - bs - 5.2, signal: signalState(this.city.intersections[best.intersection], laneSigAxis(best), t) }; }
    this.lastProbe = probe;
    let near = 0; for (const c of this.cars) if (c.v !== pv && c.v.position.distanceToSquared(p) < 625) near++;
    this.monitor.update(adt, { x: p.x, z: p.z, fx: pv.speed < 0 ? -f.x : f.x, fz: pv.speed < 0 ? -f.z : f.z, speed: Math.abs(pv.speed), beta: Math.abs(pv.phys.beta), nearCars: near, hitCar: this.hitLatch }, probe);
    this.hitLatch = false;
  }
  /** Taxis hail-and-drop, delivery vans double-park with hazards. Returns the (possibly reduced) target speed. */
  private curbStops(car: AiCar, dt: number, ts: number, f: { x: number; z: number }, t: number): number {
    const v = car.v, lane = car.lane, kind = v.kind;
    if ((car.stopT ?? 0) > 0) {
      car.stopT = (car.stopT ?? 0) - dt; v.hazard = car.stopPlan?.kind === 'deliver';
      const pl = car.stopPlan;
      if (pl?.kind === 'pick') {
        const n = pl.npc;
        if (!n || n.disposed || !n.alive) car.stopT = Math.min(car.stopT, 0.5);
        else if (n.brain === 'inside' && n.activity === 'taxi') { this.pop.remove(n); pl.npc = undefined; car.stopT = Math.min(car.stopT, 1.2); }
      }
      if (car.stopT <= 0) { v.hazard = false; car.stopPlan = null; car.stopT = 0; car.lcCool = 4; }
      return 0;
    }
    if (lane.connector || lane.length < 55) return ts;
    const plan = car.stopPlan;
    if (plan && plan.lane !== lane.id) { car.stopPlan = null; return ts; }
    if (!plan) {
      if (car.planLane !== lane.id) {
        car.planLane = lane.id;
        if ((kind === 'taxi' || kind === 'van') && car.s < lane.length * 0.35 && Math.random() < (kind === 'van' ? 0.5 : 0.4))
          car.stopPlan = { s: car.s + 14 + Math.random() * Math.max(4, lane.length - car.s - 45), lane: lane.id, kind: kind === 'van' ? 'deliver' : 'drop' };
      }
      // a taxi spots a raised hand ahead on the pavement
      if (!car.stopPlan && kind === 'taxi') {
        car.scanT = (car.scanT ?? Math.random()) - dt;
        if (car.scanT <= 0) {
          car.scanT = 0.6;
          const pos = car.v.position;
          for (const n of this.pop.npcs) {
            if (n.activity !== 'hail' || n.brain !== 'idle') continue;
            const dx = n.pos.x - pos.x, dz = n.pos.z - pos.z, ahead = dx * f.x + dz * f.z;
            if (ahead < 9 || ahead > 55 || Math.abs(dx * f.z - dz * f.x) > 14) continue;
            car.stopPlan = { s: Math.min(lane.length - 12, car.s + ahead - 1.5), lane: lane.id, kind: 'pick', npc: n }; break;
          }
        }
      }
      return ts;
    }
    const dist = plan.s - car.s;
    if (dist < -4) { car.stopPlan = null; return ts; }
    if (dist < 1.6 && Math.abs(v.speed) < 0.7) { // arrived: do the thing
      if (plan.kind === 'drop' || plan.kind === 'deliver') {
        const p = v.doorPoint(-1), n = this.pop.spawn('civilian', p.x, p.z, Math.max(0.2, v.position.y), undefined);
        n.node = -1; n.nextNode = -1; n.char.yaw = v.yaw; n.char.human.playAction('exit_car');
        car.stopT = plan.kind === 'deliver' ? 18 + Math.random() * 22 : 5 + Math.random() * 4;
      } else if (plan.npc && plan.npc.alive && plan.npc.brain === 'idle') {
        const n = plan.npc, p = v.doorPoint(-1); // Round 7: the kerb-side door (the street side sent people across the road)
        this.pop.runner.endAct(n); n.brain = 'wander'; n.activity = 'taxi'; n.destPt = new THREE.Vector3(p.x, n.pos.y, p.z); n.stateT = 0;
        car.stopT = 16;
      } else { car.stopPlan = null; return ts; }
      void t; return 0;
    }
    return Math.min(ts, Math.max(0, dist - 0.8) * 0.75);
  }
  /** Both lanes in use: signal, then move over when a slower/stopped car is ahead (or now and then to even out the lanes). */
  private laneChange(car: AiCar, dt: number, pos: THREE.Vector3, f: { x: number; z: number }, speed: number, blockDist: number, blocker: 'car' | 'person' | null, blockerV: Vehicle | null) {
    const v = car.v;
    // route-following cars (buses, goto, police) move over for their next turn: turns only leave from the correct lane
    const routed = (car.mode === 'goto' || car.mode === 'pursuit') && !!car.target && !car.lane.connector;
    if ((car.mode !== 'cruise' && !routed) || car.lane.connector || (car.persistent && !routed)) { if (car.lc) { car.lc = null; v.signal = 0; } return; }
    car.lcCool = (car.lcCool ?? 0) - dt;
    if (car.lc) {
      car.lc.t += dt;
      if (!car.lc.done) {
        const tl = this.city.lanes[car.lc.to];
        if (car.lc.t > 1.4) {
          if (this.laneClear(tl, car.s, v)) { car.lane = tl; car.nextChoice = undefined; car.lc.done = true; car.lcCool = 7 + Math.random() * 6; }
          else if (car.lc.t > 5) { car.lc = null; v.signal = 0; }
        }
      } else if (car.lc.t > 3.4) { car.lc = null; v.signal = 0; }
      return;
    }
    const lane = car.lane;
    if (routed) {
      const st = routeStep(this.city, routeField(this.city, car.target!.x, car.target!.z), lane);
      car.lcRetry = (car.lcRetry ?? 0) - dt;
      if (!st?.change || lane.length - car.s < 9 || speed < 0.5 || car.lcRetry > 0) return;
      const tl = this.city.lanes[st.id];
      if (!this.laneClear(tl, car.s, v)) { car.lcRetry = 0.6; return; }
      samplePath(tl, Math.min(car.s + 8, tl.length - 0.1), sp);
      v.signal = (sp.x - pos.x) * f.z - (sp.z - pos.z) * f.x > 0 ? 1 : -1;
      car.lc = { to: st.id, t: 0.6, done: false };
      return;
    }
    if (car.lcCool > 0 || car.stopPlan || speed < 3 || lane.length - car.s < 30 || car.s < 8) return;
    const toId = lane.lane > 0 ? lane.leftLane : lane.rightLane;
    if (toId === undefined) return;
    // slow or stopped car right ahead: overtake. Skip when everybody is just queueing for a red.
    let want = false;
    if (blocker === 'car' && blockerV && blockDist < 24) {
      const slow = blockerV.speed < lane.speed * 0.55 && blockerV.speed > 0.3;
      const oc = this.carOf(blockerV), dead = oc ? (oc.stopT ?? 0) > 0 : Math.abs(blockerV.speed) < 0.6; // parked, wrecked, or a taxi / double-parked van standing in the lane
      const st = signalState(this.city.intersections[lane.intersection], laneSigAxis(lane), this.time());
      if ((slow || dead) && (st === 'green' || lane.length - car.s > 45)) want = true;
    }
    if (!want && Math.random() < dt * 0.015) want = true;
    if (!want) return;
    const tl = this.city.lanes[toId];
    if (!this.laneClear(tl, car.s, v)) { car.lcCool = 1.5; return; }
    samplePath(tl, Math.min(car.s + 8, tl.length - 0.1), sp);
    const lx = (sp.x - pos.x) * f.z - (sp.z - pos.z) * f.x; // same sign convention as the steering below
    v.signal = lx > 0 ? 1 : -1;
    car.lc = { to: toId, t: 0, done: false };
  }
  /** Is there room in lane `tl` beside/ahead/behind arc position s? */
  private laneClear(tl: Lane, s: number, self: Vehicle): boolean {
    samplePath(tl, Math.min(s, tl.length - 0.1), sp);
    const px = sp.x, pz = sp.z, dx = sp.dx, dz = sp.dz;
    for (const o of this.vehicles.list) {
      if (o === self) continue;
      const ox = o.position.x - px, oz = o.position.z - pz;
      const along = ox * dx + oz * dz, lat = Math.abs(ox * dz - oz * dx);
      if (lat < 2.6 && along > -10 && along < 17) return false;
      // Round 11 (zero crashes): a car standing at the kerb (parked, abandoned, knocked crooked) sits partly in the kerb
      // lane: lane changes kept the moving-car margin and clipped it, then everyone hit the now-angled car
      if (!o.driver && Math.abs(o.speed) < 0.6 && lat < 3.5 && along > -6 && along < 22) return false;
    }
    return true;
  }
  private advanceLane(car: AiCar, pos: THREE.Vector3, target: THREE.Vector3 | null) {
    // project onto the current lane
    const lane = car.lane;
    let best = car.s, bd = Infinity;
    for (let i = 1; i < lane.points.length; i++) {
      const a = lane.points[i - 1], b = lane.points[i];
      const vx = b.x - a.x, vz = b.z - a.z, l2 = vx * vx + vz * vz || 1;
      let u = ((pos.x - a.x) * vx + (pos.z - a.z) * vz) / l2; u = Math.max(0, Math.min(1, u));
      const d = Math.hypot(pos.x - (a.x + vx * u), pos.z - (a.z + vz * u));
      if (d < bd) { bd = d; best = lane.cum[i - 1] + Math.sqrt(l2) * u; }
    }
    car.s = best;
    // re-pick the turn whenever the routing target moves to a new cell (race checkpoints, chase targets)
    const key = target ? `${Math.round(target.x / 10)},${Math.round(target.z / 10)}` : '';
    if (car.nextChoice === undefined || !lane.next.includes(car.nextChoice) || car.nextKey !== key) { car.nextChoice = this.chooseNext(lane, target); car.nextKey = key; }
    if (car.s > lane.length - 0.8) { car.lane = this.city.lanes[car.nextChoice]; car.s = 0; car.nextChoice = this.chooseNext(car.lane, target); car.nextKey = key; }
    if (bd > 25) { // far off the lane (pushed away): re-snap to nearest lane
      let nb: Lane | null = null, nd = Infinity;
      for (const l of this.city.lanes) { if (l.connector) continue; samplePath(l, l.length / 2, sp); const d = Math.hypot(sp.x - pos.x, sp.z - pos.z); if (d < nd) { nd = d; nb = l; } }
      if (nb) { car.lane = nb; car.s = 0; }
    }
  }
  private chooseNext(lane: Lane, target: THREE.Vector3 | null, deterministic = false): number {
    if (!lane.next.length) return lane.id;
    if (target) {
      // shortest driving route through the lane graph
      const field = routeField(this.city, target.x, target.z);
      let best = lane.next[0], bd = Infinity;
      for (const n of lane.next) if (field[n] < bd) { bd = field[n]; best = n; }
      return best;
    }
    if (deterministic) return lane.next[0];
    return lane.next[Math.floor(this.rng.next() * lane.next.length)];
  }
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, maxCars: number) {
    this.maxCars = Math.max(2, Math.round(maxCars * carActivity(this.hour)));
    this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.m4);
    // Despawn only far away AND out of view (never pop a car out while it can be seen), or a gridlocked car nobody is looking at
    const seen = (p: THREE.Vector3, d: number) => d < 230 && this.frustum.containsPoint(p);
    for (const car of [...this.cars]) {
      if (car.persistent) continue;
      const dd = car.v.position.distanceTo(focus), jam = (car.jamT ?? 0) > 20 && dd > 30 && !seen(car.v.position, dd); // never pop a jammed car the player can see (R6-V)
      if (jam) this.stats.jamDespawns++;
      if (jam || dd > 150 && !seen(car.v.position, dd)) { this.cars.splice(this.cars.indexOf(car), 1); this.pop.remove(car.driver); for (const p of car.passengers ?? []) if (p.char.inVehicle === car.v) this.pop.remove(p); this.vehicles.remove(car.v); }
    }
    for (const v of [...this.vehicles.list]) {
      if (v.persistent || v.driver || this.cars.some(c => c.v === v)) continue;
      const dv = v.position.distanceTo(focus), vis = seen(v.position, dv);
      // Round 8: a driverless car left standing in a driving lane (driver bailed out, knocked out of its kerb slot) is towed
      // once nobody can see it, instead of blocking traffic until the player is 170 m away ("parked cars in the road")
      const idle = Math.abs(v.speed) < 0.3 ? (this.idleT.get(v) ?? 0) + dt : 0; this.idleT.set(v, idle);
      if (v !== this.protect && towAbandoned(idle, dv, vis, () => { const nl = nearestLane(this.city, v.position.x, v.position.z); return nl ? nl.dist : 99; })) {
        for (const o of this.pop.npcs.filter(n => n.char.inVehicle === v)) this.pop.remove(o); this.vehicles.remove(v); this.idleT.delete(v); continue;
      }
      if (v.parked) continue;
      if ((dv > 170 && !vis) || dv > 260 || (v.destroyed && v.burnTime < 0 && dv > 60 && !vis)) { for (const o of this.pop.npcs.filter(n => n.char.inVehicle === v)) this.pop.remove(o); this.vehicles.remove(v); }
    }
    // Spawn (candidate lanes near the player, refreshed twice a second)
    this.laneT -= dt;
    if (this.laneT <= 0) {
      this.laneT = this.prewarming ? 0 : 0.5; this.nearLanes.length = 0;
      for (const l of this.city.lanes) { if (l.connector || l.length < 30) continue; const a = l.points[0], b = l.points[l.points.length - 1]; const dx = (a.x + b.x) / 2 - focus.x, dz = (a.z + b.z) / 2 - focus.z; if (dx * dx + dz * dz < 190 * 190) this.nearLanes.push(l); }
    }
    this.spawnT -= dt; this.patrolT -= dt;
    const ambient = this.cars.filter(c => c.mode === 'cruise' && !c.persistent).length;
    // Round 7: most cars near the player now come from the far crowd, so the ambient spawner below rarely runs and patrols
    // stopped appearing: give one cruiser its own timer (on top of the cap) while nobody is patrolling
    const patrolling = this.cars.some(c => c.patrol);
    if (!this.prewarming && this.patrolT <= 0 && !patrolling && ambient > 5) { this.patrolT = 25 + Math.random() * 25; this.forcePatrol = true; }
    if (this.spawnT <= 0 && (ambient < this.maxCars || this.forcePatrol)) {
      this.spawnT = this.prewarming ? 0 : 0.18;
      for (let tries = 0; tries < 12; tries++) {
        if (!this.nearLanes.length) break;
        const lane = this.nearLanes[Math.floor(Math.random() * this.nearLanes.length)];
        if (lane.connector || lane.length < 30) continue;
        const s = 8 + Math.random() * (lane.length - 26);
        samplePath(lane, s, sp);
        const p = new THREE.Vector3(sp.x, 1, sp.z);
        const d = p.distanceTo(focus);
        if (d < (this.prewarming ? 20 : 45) || d > 125) continue;
        if (Math.random() > DISTRICT_INFO[districtAt(this.city, p.x, p.z)].trafficDensity) continue;
        if (!this.prewarming && d < 100 && this.frustum.containsPoint(p)) continue;
        { const I = this.city.intersections[lane.intersection]; if (!this.prewarming && !spawnSafeAtSignal(signalState(I, laneSigAxis(lane), this.time()), signalState(I, laneSigAxis(lane), this.time() + 5), lane.length - s - 5.2)) continue; }
        if (this.vehicles.list.some(o => o.position.distanceTo(p) < 11) || this.cars.some(c => c.lane === lane && Math.abs(c.s - s) < 16)) continue;
        if (this.farObs.some(o => Math.abs(o.x - p.x) < 12 && Math.abs(o.z - p.z) < 12)) continue;
        if (this.pop.npcs.some(n => !n.char.inVehicle && Math.hypot(n.char.pos.x - p.x, n.char.pos.z - p.z) < 4)) continue; // never on top of a person // a far-crowd car is drawn there: never spawn a second (different) car on top of it
        // now and then an ambient police cruiser rolls by on patrol (max two, only while the heat is off)
        if (this.forcePatrol || (!this.prewarming && ambient > 5 && Math.random() < 0.05 && this.cars.filter(c => c.patrol).length < 2)) {
          const pc = this.spawnOnLane('police', lane, s, 'cruise', 'police', COP_LOOK); pc.patrol = true; pc.maxSpeed = lane.speed * 0.85; this.forcePatrol = false;
        } else if (ambient < this.maxCars) this.spawnOnLane(this.pickKind(), lane, s);
        break;
      }
    }
    this.updateParked(focus);
  }
  /** Parked cars in block courtyards near the player (stealable). */
  private updateParked(focus: THREE.Vector3) {
    for (const b of this.city.blocks) {
      if (b.kind !== 'buildings' || b.district === 'heights') continue;
      const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
      const d = Math.hypot(cx - focus.x, cz - focus.z);
      const have = this.parkedBlocks.get(b.id);
      if (d < 150 && !have) {
        const r = new Rng(b.id * 13 + 1); const list: Vehicle[] = [];
        const ix0 = b.x0 + SIDEWALK + 10, ix1 = b.x1 - SIDEWALK - 10, iz0 = b.z0 + SIDEWALK + 10, iz1 = b.z1 - SIDEWALK - 10;
        const n = r.int(2, 5);
        for (let i = 0; i < n; i++) {
          const x = ix0 + 4 + (i % 5) * ((ix1 - ix0 - 8) / 4.5), z = r.chance(0.5) ? iz0 + 5 : iz1 - 5;
          if (this.vehicles.list.some(o => Math.hypot(o.position.x - x, o.position.z - z) < 5)) continue;
          // parked along the drive aisle: nose with the traffic of the nearest street
          const nl = nearestLane(this.city, x, z); let yaw = z < cz ? 0 : Math.PI;
          if (nl) { samplePath(nl.lane, nl.s, sp); yaw = Math.atan2(sp.dx, sp.dz); }
          const v = this.vehicles.spawn(r.pick(PARKED_MIX), x, z, yaw, r.int(0, 11), CURB_HEIGHT + 0.25);
          v.settleParked(CURB_HEIGHT); // settled and asleep: no drop, trucks stay upright
          // solid courtyard paving under all four corners (no ground there, or a wall/stoop inside the footprint: skip the spot)
          { const L = v.phys.layout, c = Math.cos(yaw), sn = Math.sin(yaw); let ok = true;
            for (const [ax, az] of [[-1, -1], [1, -1], [-1, 1], [1, 1], [0, 0]]) {
              const lx = ax * L.half[0], lz = az * L.half[2], wx = x + lx * c + lz * sn, wz = z - lx * sn + lz * c;
              const h = v.phys.physics.ray(wx, CURB_HEIGHT + 3, wz, 0, -1, 0, 4, undefined, null, v.phys.body);
              if (!h || Math.abs(CURB_HEIGHT + 3 - h.toi - CURB_HEIGHT) > 0.25) { ok = false; break; } }
            if (!ok) { this.vehicles.remove(v); continue; } }
          v.parked = true; v.doorsLocked = r.chance(0.7); v.ignition = false; list.push(v);
        }
        this.parkedBlocks.set(b.id, list);
      } else if (d > 190 && have && !have.some(v => this.frustum.containsPoint(v.position))) {
        for (const v of have) if (this.vehicles.list.includes(v) && v.parked && !v.driver) this.vehicles.remove(v);
        this.parkedBlocks.delete(b.id);
      }
    }
  }
  /** Marks a vehicle as no longer parked (stolen/driven) so the parked pool forgets it. */
  unpark(v: Vehicle) { v.parked = false; for (const [, l] of this.parkedBlocks) { const i = l.indexOf(v); if (i >= 0) l.splice(i, 1); } }
}

/** Round 8: tow a driverless car standing in the middle of a driving lane for 15 s, 40 m+ away and out of view. Pure (tests). */
export function towAbandoned(idleS: number, dist: number, visible: boolean, laneDist: () => number): boolean {
  return idleS > 15 && dist > 40 && !visible && laneDist() < 1.0;
}
