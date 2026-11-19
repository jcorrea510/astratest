/** Ambient traffic and police driving: lane following, signals, spacing, reactions, parked cars, pursuit. */
import * as THREE from 'three';
import type { CityMap, Lane } from '../world/citymap';
import { samplePath, signalState, routeField, districtAt, DISTRICT_INFO, SIDEWALK, CURB_HEIGHT } from '../world/citymap';
import type { VehicleManager } from './vehicles';
import type { Vehicle } from '../vehicles/vehicle';
import type { Population } from './population';
import type { Npc } from '../actors/npc';
import type { Character } from '../actors/character';
import { TRAFFIC_MIX, PARKED_MIX, type VehicleKind } from '../vehicles/specs';
import type { GameAudio } from '../ui/contracts';
import { Rng } from '../core/rng';
import type { Look } from '../actors/human';
import { carActivity } from './schedule';
import { COP_LOOK } from './dispatch';
import { curbShift, yieldsToSiren, ViolationMonitor, type Violation, type LaneProbe } from './trafficRules';
export type { Violation, ViolationKind } from './trafficRules';

export type DriveMode = 'cruise' | 'flee' | 'pursuit' | 'park' | 'goto';
export interface AiCar { v: Vehicle; driver: Npc; lane: Lane; s: number; mode: DriveMode; target: THREE.Vector3 | null; stuckT: number; honkT: number; reverseT: number; persistent: boolean; ram: boolean; arriveDist: number; onArrive?: () => void; maxSpeed?: number;
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
  legitWait?: boolean; blockedBy?: Vehicle | null }
interface CrashSite { pos: THREE.Vector3; t: number; v: Vehicle }

const sp = { x: 0, z: 0, dx: 0, dz: 0 };
export class Traffic {
  cars: AiCar[] = [];
  maxCars = 18;
  /** world clock hour (set by the game each frame): rush hours / quiet nights */
  hour = 17;
  prewarming = false;
  private spawnT = 0; private laneT = 0; private nearLanes: Lane[] = [];
  private parkedBlocks = new Map<number, Vehicle[]>();
  private frustum = new THREE.Frustum(); private m4 = new THREE.Matrix4();
  private rng = new Rng(7);
  private crashes: CrashSite[] = [];
  private violationCbs: ((v: Violation) => void)[] = [];
  private monitor = new ViolationMonitor(v => { for (const cb of this.violationCbs) cb(v); }, (x, z) => new THREE.Vector3(x, 0, z));
  private monT = 0; private lastProbe: LaneProbe | null = null;
  /** consecutive-frame bookkeeping for tests / diagnostics */
  stats = { jamBreaks: 0, jamDespawns: 0, honks: 0, yields: 0 };
  /**
   * Subscribe to traffic violations committed by the player while driving: {kind: 'red_light'|'speeding'|'wrong_way'|'collision'|'reckless', pos}.
   * Returns an unsubscribe function. Events are rate limited per kind, so the police can report each one directly.
   */
  onPlayerTrafficViolation(cb: (v: Violation) => void): () => void { this.violationCbs.push(cb); return () => { const i = this.violationCbs.indexOf(cb); if (i >= 0) this.violationCbs.splice(i, 1); }; }
  constructor(private city: CityMap, private vehicles: VehicleManager, private pop: Population, private audio: GameAudio, private time: () => number) {
    vehicles.crashListeners.push(e => { this.crashes.push({ pos: e.point.clone(), t: this.time(), v: e.vehicle }); if (this.crashes.length > 6) this.crashes.shift(); });
  }

  pickKind(): VehicleKind {
    const total = TRAFFIC_MIX.reduce((a, b) => a + b.weight, 0); let r = Math.random() * total;
    for (const m of TRAFFIC_MIX) { r -= m.weight; if (r <= 0) return m.kind; }
    return 'sedan';
  }
  /** Spawns a driven car on a lane at distance s. */
  spawnOnLane(kind: VehicleKind, lane: Lane, s: number, mode: DriveMode = 'cruise', role: 'civilian' | 'police' | 'gang' = 'civilian', look?: Look): AiCar {
    samplePath(lane, s, sp);
    const yaw = Math.atan2(sp.dx, sp.dz);
    const v = this.vehicles.spawn(kind, sp.x, sp.z, yaw);
    v.phys.body.setLinvel({ x: sp.dx * lane.speed * 0.6, y: 0, z: sp.dz * lane.speed * 0.6 }, true);
    const driver = this.pop.spawn(role, sp.x, sp.z, 0.5, look);
    this.seat(driver, v);
    const car: AiCar = { v, driver, lane, s, mode, target: null, stuckT: 0, honkT: 0, reverseT: 0, persistent: false, ram: false, arriveDist: 8 };
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
  carOf(v: Vehicle) { return this.cars.find(c => c.v === v) ?? null; }
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
  /** Somebody opens fire: drivers close by floor it (or bail out on foot if they are boxed in, see fixedUpdate). */
  gunfire(origin: THREE.Vector3, shooter?: THREE.Vector3, radius = 24) {
    for (const c of this.cars) {
      if (c.persistent || c.mode !== 'cruise' || c.driver.role !== 'civilian' || c.v.destroyed) continue;
      if (c.v.position.distanceTo(origin) > radius && !(shooter && c.v.position.distanceTo(shooter) < radius * 0.6)) continue;
      this.panic(c.v);
      if (this.time() - (c.lastHonk ?? -99) > 3) { c.lastHonk = this.time(); this.audio.play('horn', { pos: c.v.position, volume: 0.6 }); this.stats.honks++; }
    }
  }
  private honk(car: AiCar, t: number, vol = 0.65, gap = 4) { if (t - (car.lastHonk ?? -99) < gap) return; car.lastHonk = t; this.stats.honks++; this.audio.play('horn', { pos: car.v.position, volume: vol, pitch: 0.9 + this.rng.next() * 0.25 }); }
  private distToStop(car: AiCar): number { return car.lane.connector ? Infinity : car.lane.length - car.s - 5.2; }

  fixedUpdate(dt: number, player: Character, playerVehicle: Vehicle | null) {
    const t = this.time();
    this.monitorPlayer(dt, t, playerVehicle);
    while (this.crashes.length && t - this.crashes[0].t > 20) this.crashes.shift();
    const sirens: Vehicle[] = [];
    if (playerVehicle?.sirenOn) sirens.push(playerVehicle);
    for (const c of this.cars) if (c.v.sirenOn && !c.persistent) sirens.push(c.v);
    for (const car of [...this.cars]) {
      const v = car.v;
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
      let targetSpeed = car.maxSpeed ?? car.lane.speed * (car.mode === 'flee' ? 1.6 : car.mode === 'pursuit' ? 1.8 : 1);
      let legit = false;
      const civ = car.mode === 'cruise' && !car.persistent && car.driver.role === 'civilian';
      // shot at: a driver whose car just took damage from the player floors it
      if (car.hp !== undefined && v.health < car.hp - 0.5 && civ && v.lastDamagedBy === player) this.panic(v);
      car.hp = v.health;
      // sirens (a police car, or a stolen one the player is driving): pull over to the kerb and let it by
      car.yieldT = (car.yieldT ?? 0) - dt; car.crashT = (car.crashT ?? 0) - dt;
      let crashD = Infinity, crashLat = 0;
      if (civ && !car.lane.connector) {
        for (const sv of sirens) {
          if (sv === v) continue;
          const sf = sv.phys.forward();
          if (yieldsToSiren(pos.x, pos.z, f.x, f.z, sv.position.x, sv.position.z, sf.x, sf.z, sv.speed)) { if (car.yieldT <= 0) this.stats.yields++; car.yieldT = 2.5; break; }
        }
        // an accident ahead: slow down, tuck to the kerb and stop short of it
        for (const cs of this.crashes) {
          if (t - cs.t > 9 || cs.v === v) continue;
          const dx = cs.pos.x - pos.x, dz = cs.pos.z - pos.z, ahead = dx * f.x + dz * f.z;
          if (ahead < -3 || ahead > 42) continue;
          const lat = dx * f.z - dz * f.x;
          if (ahead < crashD) { crashD = ahead; crashLat = lat; }
          car.crashT = Math.max(car.crashT, 2.5);
        }
      }
      if (this.crashes.some(c => c.v === v && t - c.t < 5)) { v.hazard = true; legit = true; targetSpeed = 0; } else if (v.hazard && !car.stopT) v.hazard = false;
      if (car.yieldT > 0) { legit = true; targetSpeed = Math.min(targetSpeed, car.yieldT > 2.2 ? 4 : 0); }
      if (car.crashT > 0 && crashD < Infinity) { legit = true; targetSpeed = Math.min(targetSpeed, crashD < 16 && Math.abs(crashLat) < 3.4 ? Math.max(0, (crashD - 9) * 0.5) : 5); }
      // lateral offset inside the lane: clear kerbside parked cars, tuck right for sirens / crashes
      {
        let want = 0;
        if (car.mode === 'cruise' && !car.lane.connector) {
          const ohw0 = v.phys.layout.half[0];
          for (const o of this.vehicles.list) {
            if (o === v || Math.abs(o.speed) > 0.6 || o.driver || o.position.y > 3) continue;
            const dx = o.position.x - pos.x, dz = o.position.z - pos.z, ahead = dx * f.x + dz * f.z;
            if (ahead < -2 || ahead > 26 || (o !== playerVehicle && this.carOf(o))) continue;
            const lat = dx * f.z - dz * f.x;
            if (lat > -0.4 || lat < -3.4) continue;
            want = Math.max(want, curbShift(lat, ohw0, o.phys.layout.half[0]));
          }
          if (want <= 0 && (car.yieldT > 0 || car.crashT > 0)) want = car.lane.lane === car.lane.lanes - 1 ? -1.3 : -0.8;
        }
        car.shift = (car.shift ?? 0) + (want - (car.shift ?? 0)) * Math.min(1, dt * 2.5);
      }
      const aim = new THREE.Vector3();
      const look = THREE.MathUtils.clamp(Math.abs(speed) * 0.55 + 4, 5, 16);
      if ((car.mode === 'pursuit' || car.mode === 'goto') && car.target && pos.distanceTo(car.target) < 40) {
        aim.copy(car.target);
        const d = pos.distanceTo(car.target);
        targetSpeed = car.mode === 'pursuit' ? (car.ram ? 26 : Math.min(26, Math.max(0, d - 9) * 1.2)) : Math.min(car.maxSpeed ?? 14, Math.max(0, d - car.arriveDist) * 1.5);
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
      { const ax = aim.x - pos.x, az = aim.z - pos.z, al = Math.hypot(ax, az) || 1; const cosA = (ax * f.x + az * f.z) / al; const ang = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1)); if (ang > 0.25) targetSpeed = Math.min(targetSpeed, Math.max(6, targetSpeed * (1.15 - ang * 1.1))); }
      // Brake ahead of a turn on the route (matters at race speed): v² = v_turn² + 2·a·d
      if (!car.lane.connector && car.nextChoice !== undefined) {
        const nl = this.city.lanes[car.nextChoice];
        if (nl.connector && nl.speed < 10) targetSpeed = Math.min(targetSpeed, Math.sqrt(nl.speed * nl.speed + 2 * 6 * Math.max(0, car.lane.length - car.s - 3)));
      }
      // Signals
      if (car.mode === 'cruise' && !car.lane.connector) {
        const inter = this.city.intersections[car.lane.intersection];
        const st = signalState(inter, car.lane.axis, t);
        const dStop = this.distToStop(car);
        if (st !== 'green' && dStop > -1 && !(st === 'yellow' && dStop < speed * 0.45)) { targetSpeed = Math.min(targetSpeed, Math.max(0, dStop) * 0.9); legit = true; }
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
      for (const o of this.vehicles.list) {
        if (o === v || o === car.avoid?.v) continue;
        if (ghost && o !== playerVehicle && this.carOf(o)) continue; // deadlock breaker: drive through (the bodies just nudge each other)
        // a stopped car nobody drives (kerbside parked, wrecked): judged by its real width and by where we are steering
        if (!o.driver && Math.abs(o.speed) < 0.6 && o !== playerVehicle) check(o.position.x, o.position.z, v.phys.layout.half[0] + o.phys.layout.half[0] + 0.2, 'car', o, car.shift ?? 0);
        else check(o.position.x, o.position.z, 2.3, 'car', o);
      }
      if (!player.inVehicle && player.alive) check(player.pos.x, player.pos.z, 1.9, 'person');
      for (const n of this.pop.npcs) if (n.alive && !n.char.inVehicle && !n.far) check(n.pos.x, n.pos.z, 1.7, 'person');
      if (blockDist < Infinity && !(car.mode === 'pursuit' && car.ram)) {
        const gap = blocker === 'car' ? 6.5 + Math.max(0, speed) * 0.4 : 5.5;
        targetSpeed = Math.min(targetSpeed, Math.max(0, (blockDist - gap) * 0.8));
        // A stopped car nobody in traffic is driving (parked, abandoned, wrecked, or the player waiting) never moves on its own:
        // after a few seconds, pull out and pass it.
        const bv = blockerV as Vehicle | null;
        const boc = bv ? this.carOf(bv) : null;
        car.blockedBy = bv;
        if (blocker === 'person') legit = true;
        else if (bv) {
          if (bv === playerVehicle) {
            legit = true;
            // cut off / blocked by the player: lean on the horn
            if (car.mode === 'cruise' && blockDist < 14 && speed > 5 && speed - bv.speed > 4) this.honk(car, t, 0.8, 3.5);
            else if (car.mode === 'cruise' && blockDist < 10 && Math.abs(speed) < 1.5) { car.honkT += dt; if (car.honkT > 2) { car.honkT = -1.5; this.honk(car, t, 0.7, 1); } }
          } else if (boc && (boc.legitWait || Math.abs(bv.speed) > 0.8)) legit = true;
          // two cars nose to nose (or a cycle in the intersection): the one in the box goes through
          if (boc && boc.blockedBy === v && car.mode === 'cruise' && (car.lane.connector || car.lane.length - car.s < 10 || v.id < bv.id) && (car.jamT ?? 0) > (car.lane.connector ? 1.5 : 4) && (car.ghostT ?? 0) <= 0) { car.ghostT = 6; this.stats.jamBreaks++; }
        }
        if (bv && Math.abs(bv.speed) < 0.6 && !this.carOf(bv) && Math.abs(speed) < 1 && car.mode !== 'pursuit') {
          car.blockedT = (car.blockedT ?? 0) + dt;
          if (car.blockedT > 3 && !car.avoid) { car.avoid = { v: bv, side: blockerLat > 0.4 ? -1 : 1, t: 0 }; car.blockedT = 0; }
        } else car.blockedT = 0;
        // honk at somebody stepping out in front of a moving car (jaywalkers)
        if (blocker === 'person' && speed > 3 && blockDist < 15 && t - (car.lastHonk ?? -99) > 5) { car.lastHonk = t; this.audio.play('horn', { pos, volume: 0.55 }); }
        if (blocker === 'person' && blockDist < 9 && Math.abs(speed) < 2) { car.honkT += dt; if (car.honkT > 1.6) { car.honkT = -2.5; this.audio.play('horn', { pos, volume: 0.6 }); } }
      }
      if (blockDist === Infinity) car.blockedBy = null;
      car.legitWait = legit;
      // gridlock watchdog: stopped with nothing legitimate to wait for
      if (car.mode === 'cruise' && !car.persistent && Math.abs(speed) < 0.8 && targetSpeed < 0.3 && !legit) car.jamT = (car.jamT ?? 0) + dt;
      else if (Math.abs(speed) > 2 || legit) car.jamT = 0;
      if ((car.jamT ?? 0) > 12 && car.reverseT <= 0 && (car.jamT ?? 0) % 9 < dt) { car.reverseT = 1.4; car.lcCool = 0; this.stats.jamBreaks++; }
      // panicking and boxed in: bail out and run
      if (car.mode === 'flee' && !car.persistent && blockDist < 7 && Math.abs(speed) < 1.5) { car.boxedT = (car.boxedT ?? 0) + dt; if (car.boxedT > 2) { for (const p of car.passengers ?? []) if (p.alive && p.char.inVehicle === v) this.ejectPassenger(p, v); this.eject(car, v, 1); continue; } } else car.boxedT = 0;
      this.laneChange(car, dt, pos, f, speed, blockDist, blocker, blockerV);
      // Pure-pursuit steering
      const pp = v.phys.body.translation();
      const adx = aim.x - pp.x, adz = aim.z - pp.z;
      const local = { x: adx * f.z - adz * f.x, z: adx * f.x + adz * f.z };
      let steer = THREE.MathUtils.clamp(Math.atan2(local.x, Math.max(0.5, local.z)) * 2.0, -1, 1);
      if (local.z < 0 && (car.mode === 'pursuit' || car.mode === 'goto')) steer = Math.sign(local.x || 1);
      // Stuck handling: reverse briefly
      if (targetSpeed > 2 && Math.abs(speed) < 0.6) car.stuckT += dt; else car.stuckT = Math.max(0, car.stuckT - dt);
      if (car.stuckT > 2.2) { car.reverseT = 1.4; car.stuckT = 0; }
      let throttle: number;
      if (car.reverseT > 0) { car.reverseT -= dt; throttle = -0.8; steer = -steer; }
      else { const err = targetSpeed - speed; throttle = THREE.MathUtils.clamp(err * 0.35, -1, 1); if (targetSpeed < 0.3 && Math.abs(speed) < 0.5) throttle = 0; }
      v.input.throttle = throttle; v.input.steer = steer; v.input.handbrake = targetSpeed < 0.3 && Math.abs(speed) < 0.5;
      v.siren = car.mode === 'pursuit' || (car.driver.role === 'police' && car.mode === 'goto');
    }
  }
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
    if (best) { samplePath(best, bs, sp); probe = { id: best.id, limit: best.speed, dist: bd, dx: sp.dx, dz: sp.dz, toStop: best.length - bs - 5.2, signal: signalState(this.city.intersections[best.intersection], best.axis, t) }; }
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
        const p = v.doorPoint(1), n = this.pop.spawn('civilian', p.x, p.z, Math.max(0.2, v.position.y), undefined);
        n.node = -1; n.nextNode = -1; n.char.yaw = v.yaw; n.char.human.playAction('exit_car');
        car.stopT = plan.kind === 'deliver' ? 18 + Math.random() * 22 : 5 + Math.random() * 4;
      } else if (plan.npc && plan.npc.alive && plan.npc.brain === 'idle') {
        const n = plan.npc, p = v.doorPoint(1);
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
    if (car.mode !== 'cruise' || car.lane.connector || car.persistent) { if (car.lc) { car.lc = null; v.signal = 0; } return; }
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
    if (car.lcCool > 0 || car.stopPlan || speed < 3 || car.lane.length - car.s < 30 || car.s < 8) return;
    const lane = car.lane;
    const toId = lane.lane > 0 ? lane.leftLane : lane.rightLane;
    if (toId === undefined) return;
    // slow or stopped car right ahead: overtake. Skip when everybody is just queueing for a red.
    let want = false;
    if (blocker === 'car' && blockerV && blockDist < 24) {
      const slow = blockerV.speed < lane.speed * 0.55 && blockerV.speed > 0.3;
      const oc = this.carOf(blockerV), dead = oc ? (oc.stopT ?? 0) > 0 : Math.abs(blockerV.speed) < 0.6; // parked, wrecked, or a taxi / double-parked van standing in the lane
      const st = signalState(this.city.intersections[lane.intersection], lane.axis, this.time());
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
      const dd = car.v.position.distanceTo(focus), jam = (car.jamT ?? 0) > 20 && dd > 30 && !seen(car.v.position, dd) || (car.jamT ?? 0) > 60 && dd > 70;
      if (jam) this.stats.jamDespawns++;
      if (jam || dd > 150 && !seen(car.v.position, dd)) { this.cars.splice(this.cars.indexOf(car), 1); this.pop.remove(car.driver); for (const p of car.passengers ?? []) if (p.char.inVehicle === car.v) this.pop.remove(p); this.vehicles.remove(car.v); }
    }
    for (const v of [...this.vehicles.list]) {
      if (v.persistent || v.driver || this.cars.some(c => c.v === v)) continue;
      if (v.parked) continue;
      const dv = v.position.distanceTo(focus), vis = seen(v.position, dv);
      if ((dv > 170 && !vis) || dv > 260 || (v.destroyed && v.burnTime < 0 && dv > 60 && !vis)) { for (const o of this.pop.npcs.filter(n => n.char.inVehicle === v)) this.pop.remove(o); this.vehicles.remove(v); }
    }
    // Spawn (candidate lanes near the player, refreshed twice a second)
    this.laneT -= dt;
    if (this.laneT <= 0) {
      this.laneT = this.prewarming ? 0 : 0.5; this.nearLanes.length = 0;
      for (const l of this.city.lanes) { if (l.connector || l.length < 30) continue; const a = l.points[0], b = l.points[l.points.length - 1]; const dx = (a.x + b.x) / 2 - focus.x, dz = (a.z + b.z) / 2 - focus.z; if (dx * dx + dz * dz < 190 * 190) this.nearLanes.push(l); }
    }
    this.spawnT -= dt;
    const ambient = this.cars.filter(c => c.mode === 'cruise' && !c.persistent).length;
    if (this.spawnT <= 0 && ambient < this.maxCars) {
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
        if (this.vehicles.list.some(o => o.position.distanceTo(p) < 11) || this.cars.some(c => c.lane === lane && Math.abs(c.s - s) < 16)) continue;
        // now and then an ambient police cruiser rolls by on patrol (max two, only while the heat is off)
        if (!this.prewarming && ambient > 5 && Math.random() < 0.05 && this.cars.filter(c => c.patrol).length < 2) {
          const pc = this.spawnOnLane('police', lane, s, 'cruise', 'police', COP_LOOK); pc.patrol = true; pc.maxSpeed = lane.speed * 0.85;
        } else this.spawnOnLane(this.pickKind(), lane, s);
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
          const v = this.vehicles.spawn(r.pick(PARKED_MIX), x, z, z < cz ? 0 : Math.PI, r.int(0, 11), CURB_HEIGHT + 0.25);
          v.settleParked(CURB_HEIGHT); // settled and asleep: no drop, trucks stay upright
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
