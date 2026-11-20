/** Pure traffic rules: kerb clearance, siren yielding and the player's traffic-violation detector (no rendering / physics). */
import type * as THREE from 'three';

export type ViolationKind = 'red_light' | 'speeding' | 'wrong_way' | 'collision' | 'reckless';
export interface Violation { kind: ViolationKind; pos: THREE.Vector3 }

/**
 * How far (m, to the left) a car must shift inside its lane to clear a stopped car on its right.
 * latS = lateral offset of the obstacle's centre (negative = right of us).
 */
export function curbShift(latS: number, ownHalf: number, otherHalf: number, margin = 0.3): number {
  if (latS > 0.4) return 0;
  const clearance = ownHalf + otherHalf + margin;
  return Math.max(0, Math.min(1.4, clearance - Math.abs(latS)));
}

/** Should a driver at (x,z) heading (fx,fz) give way to a siren vehicle? Behind and closing, or ahead and oncoming. */
export function yieldsToSiren(x: number, z: number, fx: number, fz: number, sx: number, sz: number, sfx: number, sfz: number, ssp: number): boolean {
  const rx = sx - x, rz = sz - z, d = Math.hypot(rx, rz);
  if (d > 60 || d < 0.5) return false;
  const along = rx * fx + rz * fz, lat = Math.abs(rx * fz - rz * fx);
  if (along < 2 && along > -60 && lat < 9 && ssp > 2) return (sfx * fx + sfz * fz) > -0.2 && d < 55; // coming up behind us
  if (along >= 2 && d < 45 && (sfx * fx + sfz * fz) < -0.3 && lat < 14) return true; // oncoming: slow and give room
  return false;
}

export interface LaneProbe { id: number; limit: number; /** metres from the car to the lane centreline */ dist: number; dx: number; dz: number; /** metres left to the stop line (<0 = past it) */ toStop: number; signal: 'green' | 'yellow' | 'red' }
export interface PlayerSample { x: number; z: number; fx: number; fz: number; speed: number; /** |slip angle| rad */ beta: number; nearCars: number; hitCar: boolean }

/** Watches the driven vehicle and reports speeding, red lights, wrong-way driving, collisions and reckless driving. */
export class ViolationMonitor {
  private acc: Record<ViolationKind, number> = { red_light: 0, speeding: 0, wrong_way: 0, collision: 0, reckless: 0 };
  private cool: Record<ViolationKind, number> = { red_light: 0, speeding: 0, wrong_way: 0, collision: 0, reckless: 0 };
  private armed = false; private armedLane = -1;
  constructor(private emit: (v: Violation) => void, private makePos: (x: number, z: number) => THREE.Vector3) { }
  update(dt: number, p: PlayerSample, lane: LaneProbe | null) {
    for (const k of Object.keys(this.cool) as ViolationKind[]) this.cool[k] = Math.max(0, this.cool[k] - dt);
    const fire = (k: ViolationKind, cd: number) => { if (this.cool[k] > 0) return; this.cool[k] = cd; this.acc[k] = 0; this.emit({ kind: k, pos: this.makePos(p.x, p.z) }); };
    const on = lane !== null && lane.dist < 4;
    const track = (k: ViolationKind, cond: boolean, after: number, cd: number) => { this.acc[k] = cond ? this.acc[k] + dt : Math.max(0, this.acc[k] - dt * 2); if (this.acc[k] > after) fire(k, cd); };
    track('speeding', on && p.speed > lane!.limit * 1.7 + 2, 1.2, 10);
    track('wrong_way', on && p.speed > 4 && (p.fx * lane!.dx + p.fz * lane!.dz) < -0.7, 1.5, 10);
    track('reckless', p.speed > 12 && p.beta > 0.55 && p.nearCars > 0, 0.9, 8);
    if (p.hitCar) fire('collision', 1.5);
    // red light: armed while approaching a red stop line at speed; fires when the car carries on across it
    const aligned = lane !== null && (p.fx * lane.dx + p.fz * lane.dz) > 0.5;
    if (on && aligned && lane!.signal === 'red' && lane!.toStop > -1 && lane!.toStop < 16 && p.speed > 3) { this.armed = true; this.armedLane = lane!.id; }
    else if (this.armed && (p.speed < 1.5 || (on && lane!.id === this.armedLane && lane!.signal !== 'red'))) this.armed = false;
    if (this.armed && (!on || lane!.id !== this.armedLane || lane!.toStop < -1)) { this.armed = false; if (p.speed > 3) fire('red_light', 6); }
  }
}

/** Comfortable braking (m/s²) AI drivers plan stops with, and the hardest they will brake for a late amber. */
export const COMFORT_DECEL = 3.4, MAX_DECEL = 5.5;
/** Fastest speed (m/s) from which a car can still halt `d` metres ahead at `decel`. */
export function stopSpeed(d: number, decel = COMFORT_DECEL): number { return Math.sqrt(2 * decel * Math.max(0, d)); }
/**
 * Speed cap for a signalised stop line `dStop` metres ahead (<0 = already past it) at `speed`.
 * Green: free. Amber: carry on only if the car cannot stop before the line at MAX_DECEL (dilemma zone), else stop.
 * Red: stop at the line (a car already across it, dStop < -1, clears the box).
 */
export function signalCap(state: 'green' | 'yellow' | 'red', dStop: number, speed: number): number {
  if (state === 'green' || dStop < -1) return Infinity;
  if (state === 'yellow' && dStop < Math.max(0, speed) ** 2 / (2 * MAX_DECEL)) return Infinity;
  return stopSpeed(dStop - 0.4);
}
/**
 * Stop-sign rule: halt at the line, wait `waited` s (counted by the caller while standing), then go once `clear`
 * (nobody in the junction). After 6 s the driver goes regardless so nobody deadlocks.
 */
export function stopSignCap(dStop: number, speed: number, waited: number, clear: boolean): number {
  if (dStop < -1) return Infinity;
  if (waited >= 1.5 && (clear || waited > 6)) return Infinity;
  void speed;
  return stopSpeed(dStop - 0.4);
}
/** +1 = left turn, -1 = right turn, 0 = straight, from unit heading before (d0) and after (d1) the turn. */
export function turnSide(d0x: number, d0z: number, d1x: number, d1z: number): number {
  const c = d0x * d1z - d0z * d1x; // x right / z forward world: left turn gives negative cross
  return c < -0.5 ? 1 : c > 0.5 ? -1 : 0;
}
/** Is an oncoming car (position rel. to junction centre, heading, speed) close enough that a left-turner must wait? */
export function oncomingConflict(ox: number, oz: number, ofx: number, ofz: number, ospeed: number, afx: number, afz: number): boolean {
  if (ospeed < 1.5) return false;
  if ((ofx * afx + ofz * afz) > -0.7) return false; // not opposing our approach
  const d = Math.hypot(ox, oz); if (d > 40) return false;
  if ((-ox * ofx - oz * ofz) < 0) return false; // already past the junction
  const lat = Math.abs(ox * afz - oz * afx); if (lat > 7) return false;
  return d / ospeed < 4.5;
}
