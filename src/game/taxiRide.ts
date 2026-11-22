/**
 * Round 7: ride in a cab. Walk up to a moving or waiting taxi and press Interact: it pulls over, you sit in the back,
 * and it drives (obeying traffic like any AI car) to your map waypoint. The meter runs by distance; Interact again
 * skips the trip for a bit extra, Enter (F) gets out early and pays what the meter shows.
 */
import * as THREE from 'three';
import type { AiCar } from './traffic';
import type { Vehicle } from '../vehicles/vehicle';
import { nearestLane, samplePath } from '../world/citymap';

/** Fare: flag drop plus a rate per metre driven. Pure: used by tests. */
export function taxiFare(metres: number): number { return Math.round(4 + metres * 0.02); }
/** Price of skipping the rest of the trip (the meter for the straight-line distance left, plus a tip). */
export function skipFare(metresLeft: number): number { return Math.round(metresLeft * 0.025 + 5); }

export interface TaxiHost {
  player: { pos: THREE.Vector3; alive: boolean; inVehicle: unknown; human: { root: THREE.Object3D; setState(s: string): void; setUpperMode(m: string): void; setSpeed(s: number): void }; setCollision(on: boolean): void; place(x: number, y: number, z: number, yaw?: number): void };
  traffic: { cars: AiCar[]; carOf(v: Vehicle): AiCar | null };
  vehicles: { list: Vehicle[] };
  city: Parameters<typeof nearestLane>[0];
  waypoint: THREE.Vector3 | null;
  money: number; addMoney(d: number): void;
  scene: THREE.Object3D;
  toast(msg: string, kind?: string): void;
  sound(name: string, pos: THREE.Vector3): void;
}

export class TaxiRide {
  car: AiCar | null = null;
  private metres = 0; private last = new THREE.Vector3(); private dest: THREE.Vector3 | null = null; private arrived = false; waitT = 0;
  constructor(private h: TaxiHost) {}
  get riding() { return !!this.car; }
  get vehicle(): Vehicle | null { return this.car?.v ?? null; }
  get fare() { return taxiFare(this.metres); }

  /** An AI cab with a live civilian driver close enough to hail. */
  nearestCab(): AiCar | null {
    const p = this.h.player.pos; let best: AiCar | null = null, bd = 9;
    for (const c of this.h.traffic.cars) {
      if (c.v.kind !== 'taxi' || c.persistent || c.v.destroyed || c.driver.role !== 'civilian' || !c.driver.alive || c.driver.char.inVehicle !== c.v || c.mode !== 'cruise') continue;
      const d = c.v.position.distanceTo(p); if (d < bd && Math.abs(c.v.speed) < 9) { bd = d; best = c; }
    }
    return best;
  }
  prompt(key: string): string | null {
    if (this.car) return this.dest ? `${key}  Skip trip ($${skipFare(this.left())})   ·   F  Get out ($${this.fare})` : `Set a waypoint on the map  ·  F  Get out`;
    return this.nearestCab() ? `${key}  Take a taxi` : null;
  }
  private left() { const v = this.car?.v; return v && this.dest ? Math.hypot(v.position.x - this.dest.x, v.position.z - this.dest.z) : 0; }

  /** Interact pressed: hail / skip. Returns true if it handled the key. */
  interact(): boolean {
    if (this.car) { if (this.dest) this.skip(); return true; }
    const cab = this.nearestCab(); if (!cab) return false;
    // the cab pulls up and the player gets in the back
    const pl = this.h.player, v = cab.v;
    cab.persistent = true; v.persistent = true; cab.driver.persistent = true; cab.stopPlan = null; cab.stopT = 0; cab.maxSpeed = 0;
    if (cab.passengers?.length) for (const p of cab.passengers) { p.char.inVehicle = null; } // the NPC fare was already let out
    this.car = cab; this.metres = 0; this.arrived = false; this.dest = null; this.waitT = 0; this.last.copy(v.position);
    pl.inVehicle = v; pl.setCollision(false);
    const hr = pl.human; v.visual.add(hr.root); hr.root.position.copy(v.seatLocal(2)); hr.root.rotation.set(0, 0, 0);
    hr.setState('drive'); hr.setUpperMode('none'); hr.setSpeed(0);
    this.h.sound('doorClose', v.position);
    this.h.toast(this.h.waypoint ? 'Taxi: "Sure thing, on our way."' : 'Taxi: "Where to?"  Set a waypoint on the map.', 'info');
    return true;
  }
  /** Pay the meter for the rest of the way and arrive now (the cab is placed on the nearest kerb lane to the waypoint). */
  private skip() {
    const c = this.car!, d = this.dest!, cost = skipFare(this.left());
    if (this.h.money < cost + this.fare) { this.h.toast(`Skipping costs $${cost}`, 'warning'); return; }
    const nl = nearestLane(this.h.city, d.x, d.z); if (!nl) return;
    const sp = { x: 0, z: 0, dx: 0, dz: 1, y: 0 } as { x: number; z: number; dx: number; dz: number; y?: number };
    const s = Math.max(2, Math.min(nl.lane.length - 4, nl.s - 6)); samplePath(nl.lane, s, sp);
    c.v.phys.settleAt(sp.x, sp.y ?? 0, sp.z, Math.atan2(sp.dx, sp.dz)); c.lane = nl.lane; c.s = s; c.nextChoice = undefined;
    this.h.addMoney(-cost); this.last.copy(c.v.position);
  }
  /** Get out (F): the cab stops, you pay the meter and step onto the kerb side. */
  exit(): void {
    const c = this.car; if (!c) return;
    const v = c.v, pl = this.h.player;
    const fare = Math.min(this.h.money, this.fare);
    if (fare > 0) this.h.addMoney(-fare);
    const p = v.doorPoint(1);
    this.h.scene.add(pl.human.root);
    pl.place(p.x, Math.max(p.y, v.position.y - 0.2), p.z, v.yaw);
    pl.inVehicle = null; pl.setCollision(true); pl.human.setState('loco');
    this.h.sound('doorClose', v.position);
    this.h.toast(fare > 0 ? `Taxi fare  $${fare}` : 'Thanks for riding.', 'money');
    // the cab goes back to cruising for fares
    c.mode = 'cruise'; c.target = null; c.persistent = false; v.persistent = false; c.driver.persistent = false; c.maxSpeed = undefined; c.onArrive = undefined; c.stopT = 2; c.stopPlan = null;
    this.car = null; this.dest = null;
  }
  update(dt: number) {
    const c = this.car; if (!c) return;
    const v = c.v;
    // the ride is over if the cab is wrecked or its driver is gone (shot, dragged out)
    if (v.destroyed || !c.driver.alive || c.driver.char.inVehicle !== v || !this.h.traffic.cars.includes(c) || !this.h.vehicles.list.includes(v)) { this.exit(); return; }
    this.metres += Math.hypot(v.position.x - this.last.x, v.position.z - this.last.z); this.last.copy(v.position);
    const wp = this.h.waypoint;
    if (wp && (!this.dest || this.dest.distanceToSquared(wp) > 1)) {
      this.dest = wp.clone(); this.arrived = false;
      // drive to the kerb lane nearest the pin (a pin inside a block must not pull the cab off the road)
      const nl = nearestLane(this.h.city, wp.x, wp.z), sp = { x: wp.x, z: wp.z, dx: 0, dz: 1 };
      if (nl) samplePath(nl.lane, nl.s, sp);
      c.mode = 'goto'; c.target = new THREE.Vector3(sp.x, 0, sp.z); c.arriveDist = 6; c.maxSpeed = 16;
      c.onArrive = () => { this.arrived = true; };
    }
    if (!this.dest) { c.maxSpeed = 0; this.waitT += dt; } // waiting for a destination
    if (this.arrived) {
      c.maxSpeed = 0;
      if (Math.abs(v.speed) < 0.8) { this.h.toast('Taxi: "Here we are."', 'info'); this.exit(); }
    }
  }
}
