/**
 * The player's car in road coordinates: s along the road, u across, psi = heading relative to the road (+ = toward +u).
 * Simple arcade dynamics that use the real car specs (mass, engine force, top speed, brakes): speed-sensitive steering,
 * heading that settles back to the road direction, barrier / rail contact and crash damage.
 */
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import { SHAPES } from '../vehicles/shapes';
import { MEDIAN_HALF, RAIL_U, laneU } from './road';

export interface DriveInput { steer: number; throttle: number; brake: number; handbrake: boolean }
export interface ImpactEvent { kind: 'barrier' | 'rail' | 'car'; power: number }

export class PlayerCar {
  s = 0; u = laneU(1); psi = 0; v = 28; yawRate = 0;
  steer = 0; steerAngle = 0; accelNow = 0; pitch = 0; roll = 0;
  health = 100; wrecked = false;
  readonly spec; readonly len: number; readonly wid: number;
  lastLateralSpeed = 0; private hitCool = 0;
  onImpact: (e: ImpactEvent) => void = () => {};
  constructor(public readonly kind: VehicleKind) {
    this.spec = VEHICLES[kind];
    this.len = SHAPES[kind].L; this.wid = SHAPES[kind].W;
  }
  get mass(): number { return this.spec.mass; }
  update(dt: number, input: DriveInput): void {
    const sp = this.spec;
    const dead = this.wrecked;
    const thr = dead ? 0 : input.throttle, brk = dead ? 0.35 : input.brake;
    // longitudinal
    const vmax = sp.topSpeed * (0.55 + 0.45 * this.health / 100);
    let a = (sp.engine / sp.mass) * thr * Math.max(0, 1 - Math.pow(Math.max(0, this.v) / vmax, 1.7)) * (this.v < 3 ? 1.0 : 1.0);
    a -= 0.35 + 0.0011 * this.v * this.v; // rolling + air drag
    if (brk > 0) a -= sp.brake * 0.92 * brk * (this.v > 0.2 ? 1 : 0);
    if (input.handbrake && !dead) a -= sp.brake * 0.35;
    this.accelNow += (a - this.accelNow) * Math.min(1, dt * 8);
    this.v = Math.max(0, this.v + a * dt);
    // steering: keyboard-smoothed, much less lock at speed
    const target = dead ? 0 : input.steer;
    const rate = Math.abs(target) > Math.abs(this.steer) || Math.sign(target) !== Math.sign(this.steer) ? 5.5 : 8;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
    const lock = sp.maxSteer / (1 + Math.pow(this.v / 5.5, 2));
    this.steerAngle = this.steer * lock;
    const grip = input.handbrake ? 0.55 : 1;
    const turn = (this.v / (this.len * 0.58)) * Math.tan(this.steerAngle) * grip;
    const settle = 1.5 * (this.v / (this.v + 4)) * (input.handbrake ? 0.35 : 1);
    this.yawRate += (turn - this.yawRate) * Math.min(1, dt * 14);
    this.psi += (this.yawRate - settle * this.psi) * dt;
    this.psi = Math.max(-1.2, Math.min(1.2, this.psi));
    this.s += this.v * Math.cos(this.psi) * dt;
    this.lastLateralSpeed = this.v * Math.sin(this.psi);
    this.u += this.lastLateralSpeed * dt;
    // body motion for the camera
    this.pitch += ((-this.accelNow * 0.004) - this.pitch) * Math.min(1, dt * 6);
    this.roll += ((-this.yawRate * this.v * 0.0025) - this.roll) * Math.min(1, dt * 6);
    this.contactBounds(dt);
  }
  /** Half extent across the road including the heading. */
  halfAcross(): number { return (this.wid / 2) * Math.cos(this.psi) + (this.len / 2) * Math.abs(Math.sin(this.psi)); }
  private contactBounds(dt: number): void {
    const hw = this.halfAcross();
    const lo = MEDIAN_HALF + hw, hi = RAIL_U - 0.25 - hw;
    let side = 0;
    if (this.u < lo) { this.u = lo; side = -1; } else if (this.u > hi) { this.u = hi; side = 1; }
    if (side) {
      const into = -side * this.lastLateralSpeed; // > 0 when moving into the wall
      this.hitCool -= dt;
      if (into > 0.5 && this.hitCool <= 0) {
        this.hitCool = 0.35;
        this.hurt(Math.max(0, into - 1.2) * 2.4 + 1);
        this.onImpact({ kind: side < 0 ? 'barrier' : 'rail', power: into });
        this.psi = -this.psi * 0.25; this.yawRate = 0;
      }
      this.v = Math.max(0, this.v - (3 + this.v * 0.05) * dt); // scraping
      this.psi *= 1 - Math.min(1, dt * 4);
    }
  }
  hurt(amount: number): void {
    if (this.wrecked) return;
    this.health = Math.max(0, this.health - amount);
    if (this.health <= 0) this.wrecked = true;
  }
  reset(s: number, lane: number, v: number): void {
    this.s = s; this.u = laneU(lane); this.psi = 0; this.v = v; this.health = 100; this.wrecked = false; this.steer = 0; this.yawRate = 0;
  }
}

/** Oriented-rectangle overlap in road coordinates; returns minimum translation (axis sign +/-, depth) or null. */
export function overlap(a: { s: number; u: number; len: number; wid: number; psi: number }, b: { s: number; u: number; len: number; wid: number; psi: number }): { nx: number; nz: number; depth: number } | null {
  // axes: forward (along s) and right (u) for each; a point's frame uses angle psi from the s axis toward u
  const axes: [number, number][] = [];
  for (const q of [a, b]) { const c = Math.cos(q.psi), s = Math.sin(q.psi); axes.push([c, s], [-s, c]); }
  let best = Infinity, bn: [number, number] = [1, 0];
  const dx = b.s - a.s, dz = b.u - a.u;
  for (const [ax, az] of axes) {
    const proj = (q: typeof a) => { const c = Math.cos(q.psi), s = Math.sin(q.psi); return Math.abs(c * ax + s * az) * q.len / 2 + Math.abs(-s * ax + c * az) * q.wid / 2; };
    const d = Math.abs(dx * ax + dz * az), pen = proj(a) + proj(b) - d;
    if (pen <= 0) return null;
    if (pen < best) { best = pen; bn = (dx * ax + dz * az) >= 0 ? [ax, az] : [-ax, -az]; }
  }
  return { nx: bn[0], nz: bn[1], depth: best };
}
