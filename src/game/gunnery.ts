/**
 * Human-like gunnery for AI gunships (pure, unit tested). A gunner needs a moment to react once he sees the target, tracks it with
 * a lag (so a moving target is hit far less often than a standing one), has a slowly drifting aim bias that makes a whole burst land
 * on one side, and scatters every round on top. Hit chance falls with range and with the target's speed; nothing here is a lock-on.
 */
import * as THREE from 'three';

export type Rand = () => number;
export function mulberry32(seed: number): Rand {
  return () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** Seconds between first seeing the target and the first round going out. */
export const GUNNER_REACT = 1.6;
/** Per-round scatter (radians, 1 sigma) at `dist` metres against a target moving `speed` m/s. */
export const gunSigma = (dist: number, speed: number) => 0.012 + dist * 0.00022 + speed * 0.0016;

const up = new THREE.Vector3(0, 1, 0), tR = new THREE.Vector3(), tU = new THREE.Vector3(), tP = new THREE.Vector3();

export class Gunner {
  seenT = 0; private unseenT = 0;
  private bx = 0; private by = 0; private lag = -0.15;
  constructor(private rand: Rand = Math.random) { }
  private gauss() { let u = 0, v = 0; while (u === 0) u = this.rand(); v = this.rand(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  /** Call every frame. Returns true once the gunner has acquired the target (reacted). */
  track(dt: number, seen: boolean, dist = 60, speed = 10): boolean {
    if (seen) {
      this.seenT += dt; this.unseenT = 0;
      const tau = 1.3, sb = gunSigma(dist, speed) * 0.7, k = Math.sqrt(2 * dt / tau);
      this.bx += -this.bx * dt / tau + this.gauss() * sb * k; this.by += -this.by * dt / tau + this.gauss() * sb * k * 0.6;
      this.lag = THREE.MathUtils.clamp(this.lag + this.gauss() * 0.35 * Math.sqrt(dt), -0.4, 0.05);
    } else { this.unseenT += dt; if (this.unseenT > 0.6) this.seenT = 0; }
    return this.seenT >= GUNNER_REACT;
  }
  get acquired() { return this.seenT >= GUNNER_REACT; }
  /** Direction of the next hit-scan round from `eye` at a target at `pos` moving with `vel` (written to `out`). */
  aim(eye: THREE.Vector3, pos: THREE.Vector3, vel: THREE.Vector3, out = new THREE.Vector3()) {
    tP.copy(pos).addScaledVector(vel, this.lag);
    out.copy(tP).sub(eye); const dist = out.length(); out.normalize();
    const s = gunSigma(dist, vel.length());
    tR.crossVectors(out, up); if (tR.lengthSq() < 1e-6) tR.set(1, 0, 0); tR.normalize(); tU.crossVectors(tR, out);
    out.addScaledVector(tR, this.bx + this.gauss() * s * 0.8).addScaledVector(tU, this.by + this.gauss() * s * 0.5).normalize();
    return out;
  }
  /** Angular error (rad) added to a lead-aimed projectile (missile). */
  missileError(dist: number, speed: number) { return gunSigma(dist, speed) * 0.9; }
  /** Fraction (0.5..0.85) of the true lead a gunner applies when firing a slow projectile. */
  leadFraction() { return 0.5 + this.rand() * 0.35; }
  perturb(dir: THREE.Vector3, sigma: number) {
    tR.crossVectors(dir, up); if (tR.lengthSq() < 1e-6) tR.set(1, 0, 0); tR.normalize(); tU.crossVectors(tR, dir);
    return dir.addScaledVector(tR, this.gauss() * sigma).addScaledVector(tU, this.gauss() * sigma * 0.6).normalize();
  }
}
/** Closest approach (metres) of a ray from `eye` along unit `dir` to `target`; Infinity if the target is behind. */
export function rayMiss(eye: THREE.Vector3, dir: THREE.Vector3, target: THREE.Vector3) {
  tP.copy(target).sub(eye); const along = tP.dot(dir); if (along <= 0) return Infinity;
  return tP.cross(dir).length();
}
