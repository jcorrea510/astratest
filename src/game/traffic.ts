/** Ambient traffic and police driving: lane following, signals, spacing, reactions, parked cars, pursuit. */
import * as THREE from 'three';
import type { CityMap, Lane } from '../world/citymap';
import { samplePath, signalState, SIDEWALK, CURB_HEIGHT } from '../world/citymap';
import type { VehicleManager } from './vehicles';
import type { Vehicle } from '../vehicles/vehicle';
import type { Population } from './population';
import type { Npc } from '../actors/npc';
import type { Character } from '../actors/character';
import { TRAFFIC_MIX, type VehicleKind } from '../vehicles/specs';
import type { GameAudio } from '../ui/contracts';
import { Rng } from '../core/rng';
import type { Look } from '../actors/human';

export type DriveMode = 'cruise' | 'flee' | 'pursuit' | 'park' | 'goto';
export interface AiCar { v: Vehicle; driver: Npc; lane: Lane; s: number; mode: DriveMode; target: THREE.Vector3 | null; stuckT: number; honkT: number; reverseT: number; persistent: boolean; ram: boolean; arriveDist: number; onArrive?: () => void; maxSpeed?: number }

const sp = { x: 0, z: 0, dx: 0, dz: 0 };
export class Traffic {
  cars: AiCar[] = [];
  maxCars = 18;
  private spawnT = 0;
  private parkedBlocks = new Map<number, Vehicle[]>();
  private frustum = new THREE.Frustum(); private m4 = new THREE.Matrix4();
  private rng = new Rng(7);
  constructor(private city: CityMap, private vehicles: VehicleManager, private pop: Population, private audio: GameAudio, private time: () => number) { }

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
    this.cars.push(car);
    return car;
  }
  seat(n: Npc, v: Vehicle) {
    n.brain = 'passenger'; n.char.inVehicle = v; n.char.setCollision(false);
    v.driver = n.char; v.visual.add(n.char.human.root);
    n.char.human.root.position.copy(v.seatOffset()); n.char.human.root.rotation.set(0, 0, 0);
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
  carOf(v: Vehicle) { return this.cars.find(c => c.v === v) ?? null; }
  panic(v: Vehicle) { const c = this.carOf(v); if (c && c.mode === 'cruise') c.mode = 'flee'; }
  private distToStop(car: AiCar): number { return car.lane.connector ? Infinity : car.lane.length - car.s - 5.2; }

  fixedUpdate(dt: number, player: Character, playerVehicle: Vehicle | null) {
    const t = this.time();
    for (const car of [...this.cars]) {
      const v = car.v;
      if (v.destroyed || !car.driver.alive || v.driver !== car.driver.char) {
        // driver gone (carjacked, killed, destroyed car)
        const idx = this.cars.indexOf(car); if (idx >= 0) this.cars.splice(idx, 1);
        if (car.driver.alive && car.driver.char.inVehicle === v) this.eject(null, v, 1);
        v.input.throttle = 0; v.input.handbrake = true;
        continue;
      }
      v.syncTransform();
      const pos = v.position, f = v.phys.forward();
      const speed = v.speed;
      // progress along the lane
      if (car.mode !== 'pursuit' && car.mode !== 'goto' || !car.target || pos.distanceTo(car.target) > 40) this.advanceLane(car, pos, car.target);
      let targetSpeed = car.maxSpeed ?? car.lane.speed * (car.mode === 'flee' ? 1.6 : car.mode === 'pursuit' ? 1.8 : 1);
      const aim = new THREE.Vector3();
      const look = THREE.MathUtils.clamp(Math.abs(speed) * 0.55 + 4, 5, 16);
      if ((car.mode === 'pursuit' || car.mode === 'goto') && car.target && pos.distanceTo(car.target) < 40) {
        aim.copy(car.target);
        const d = pos.distanceTo(car.target);
        targetSpeed = car.mode === 'pursuit' ? (car.ram ? 26 : Math.min(26, Math.max(0, d - 9) * 1.2)) : Math.min(car.maxSpeed ?? 14, Math.max(0, d - car.arriveDist) * 1.5);
        if (car.mode === 'goto' && d < car.arriveDist + 1 && car.onArrive) { const cb = car.onArrive; car.onArrive = undefined; cb(); }
      } else {
        let s = car.s + look, lane = car.lane;
        const nextChoice = (car as unknown as { nextChoice?: number }).nextChoice ?? lane.next[0];
        if (s > lane.length && lane.next.length) { s -= lane.length; lane = this.city.lanes[nextChoice]; if (s > lane.length && lane.next.length) { s -= lane.length; lane = this.city.lanes[lane.next[0]]; } }
        samplePath(lane, Math.min(s, lane.length), sp); aim.set(sp.x, 0, sp.z);
      }
      // Slow for corners: angle between heading and the aim point
      { const ax = aim.x - pos.x, az = aim.z - pos.z, al = Math.hypot(ax, az) || 1; const cosA = (ax * f.x + az * f.z) / al; const ang = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1)); if (ang > 0.25) targetSpeed = Math.min(targetSpeed, Math.max(6, targetSpeed * (1.15 - ang * 1.1))); }
      // Signals
      if (car.mode === 'cruise' && !car.lane.connector) {
        const inter = this.city.intersections[car.lane.intersection];
        const st = signalState(inter, car.lane.axis, t);
        const dStop = this.distToStop(car);
        if (st !== 'green' && dStop > -1 && !(st === 'yellow' && dStop < speed * 0.45)) targetSpeed = Math.min(targetSpeed, Math.max(0, dStop) * 0.9);
      }
      // Following distance / obstacles ahead
      let blockDist = Infinity, blocker: 'car' | 'person' | null = null;
      const check = (ox: number, oz: number, radius: number, kind: 'car' | 'person') => {
        const dx = ox - pos.x, dz = oz - pos.z;
        const ahead = dx * f.x + dz * f.z; if (ahead < 1 || ahead > 26) return;
        const lat = Math.abs(dx * f.z - dz * f.x); if (lat > radius) return;
        if (ahead < blockDist) { blockDist = ahead; blocker = kind; }
      };
      for (const o of this.vehicles.list) if (o !== v) check(o.position.x, o.position.z, 2.3, 'car');
      if (!player.inVehicle && player.alive) check(player.pos.x, player.pos.z, 1.9, 'person');
      for (const n of this.pop.npcs) if (n.alive && !n.char.inVehicle && !n.far) check(n.pos.x, n.pos.z, 1.7, 'person');
      if (blockDist < Infinity && !(car.mode === 'pursuit' && car.ram)) {
        const gap = blocker === 'car' ? 7.5 : 5.5;
        targetSpeed = Math.min(targetSpeed, Math.max(0, (blockDist - gap) * 0.8));
        if (blocker === 'person' && blockDist < 9 && Math.abs(speed) < 2) { car.honkT += dt; if (car.honkT > 1.6) { car.honkT = -2.5; this.audio.play('horn', { pos, volume: 0.6 }); } }
      }
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
      void playerVehicle;
    }
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
    const ext = car as unknown as { nextChoice?: number };
    if (ext.nextChoice === undefined || !lane.next.includes(ext.nextChoice)) ext.nextChoice = this.chooseNext(lane, target);
    if (car.s > lane.length - 0.8) { car.lane = this.city.lanes[ext.nextChoice]; car.s = 0; ext.nextChoice = this.chooseNext(car.lane, target); }
    if (bd > 25) { // far off the lane (pushed away): re-snap to nearest lane
      let nb: Lane | null = null, nd = Infinity;
      for (const l of this.city.lanes) { if (l.connector) continue; samplePath(l, l.length / 2, sp); const d = Math.hypot(sp.x - pos.x, sp.z - pos.z); if (d < nd) { nd = d; nb = l; } }
      if (nb) { car.lane = nb; car.s = 0; }
    }
  }
  private chooseNext(lane: Lane, target: THREE.Vector3 | null): number {
    if (!lane.next.length) return lane.id;
    if (target) {
      let best = lane.next[0], bd = Infinity;
      for (const n of lane.next) { const l = this.city.lanes[n]; const end = this.city.lanes[l.next[0] ?? n]; const p = end.points[end.points.length - 1]; const d = Math.hypot(p.x - target.x, p.z - target.z); if (d < bd) { bd = d; best = n; } }
      return best;
    }
    return lane.next[Math.floor(this.rng.next() * lane.next.length)];
  }
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, maxCars: number) {
    this.maxCars = maxCars;
    // Despawn
    for (const car of [...this.cars]) {
      if (car.persistent) continue;
      if (car.v.position.distanceTo(focus) > 210) { this.cars.splice(this.cars.indexOf(car), 1); this.pop.remove(car.driver); this.vehicles.remove(car.v); }
    }
    for (const v of [...this.vehicles.list]) {
      if (v.persistent || v.driver || this.cars.some(c => c.v === v)) continue;
      if (v.parked) continue;
      if (v.position.distanceTo(focus) > 230 || (v.destroyed && v.burnTime < 0 && v.position.distanceTo(focus) > 60)) { const occupant = this.pop.npcs.find(n => n.char.inVehicle === v); if (occupant) this.pop.remove(occupant); this.vehicles.remove(v); }
    }
    // Spawn
    this.spawnT -= dt;
    const ambient = this.cars.filter(c => c.mode === 'cruise' && !c.persistent).length;
    if (this.spawnT <= 0 && ambient < this.maxCars) {
      this.spawnT = 0.35;
      this.m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.m4);
      for (let tries = 0; tries < 6; tries++) {
        const lane = this.city.lanes[Math.floor(Math.random() * this.city.lanes.length)];
        if (lane.connector || lane.length < 30) continue;
        const s = 8 + Math.random() * (lane.length - 26);
        samplePath(lane, s, sp);
        const p = new THREE.Vector3(sp.x, 1, sp.z);
        const d = p.distanceTo(focus);
        if (d < 70 || d > 170) continue;
        if (d < 140 && this.frustum.containsPoint(p)) continue;
        if (this.vehicles.list.some(o => o.position.distanceTo(p) < 14)) continue;
        this.spawnOnLane(this.pickKind(), lane, s);
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
          const kinds: VehicleKind[] = ['sedan', 'hatch', 'wagon', 'coupe', 'van', 'sedan', 'hatch'];
          const v = this.vehicles.spawn(r.pick(kinds), x, z, z < cz ? 0 : Math.PI, r.int(0, 6), CURB_HEIGHT + 0.25);
          v.parked = true; list.push(v);
        }
        this.parkedBlocks.set(b.id, list);
      } else if (d > 190 && have) {
        for (const v of have) if (this.vehicles.list.includes(v) && v.parked && !v.driver) this.vehicles.remove(v);
        this.parkedBlocks.delete(b.id);
      }
    }
  }
  /** Marks a vehicle as no longer parked (stolen/driven) so the parked pool forgets it. */
  unpark(v: Vehicle) { v.parked = false; for (const [, l] of this.parkedBlocks) { const i = l.indexOf(v); if (i >= 0) l.splice(i, 1); } }
}
