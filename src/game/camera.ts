/** Third-person camera: smooth follow, over-the-shoulder aiming, vehicle chase, wall avoidance and shake. */
import * as THREE from 'three';
import { RAPIER, type Physics, G_STATIC, G_VEHICLE, groups } from '../core/physics';
import { clamp, damp, dampAngle, wrapAngle } from '../core/rng';

export type CamMode = 'foot' | 'aim' | 'vehicle' | 'dead' | 'cinematic';

export class CameraRig {
  yaw = 0; pitch = -0.12;
  private dist = 4.2;
  private shoulder = 0.45;
  private fovExtra = 0;
  trauma = 0;
  private shakeT = 0;
  private pivot = new THREE.Vector3();
  private smoothPivot = new THREE.Vector3();
  private lastInput = 0;
  private sphere = new RAPIER.Ball(0.22);
  private initialized = false;
  shakeScale = 1;
  baseFov = 62;
  zoomLevel = 0;
  cinematic: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;

  constructor(public camera: THREE.PerspectiveCamera, private physics: Physics) { }

  addInput(dx: number, dy: number, sensitivity: number, invertY: boolean) {
    if (Math.abs(dx) + Math.abs(dy) > 0.5) this.lastInput = 0;
    this.yaw -= dx * 0.0022 * sensitivity;
    this.pitch -= dy * 0.0022 * sensitivity * (invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.2, 0.85);
  }
  addShake(amount: number) { this.trauma = Math.min(1, this.trauma + amount * this.shakeScale); }
  snapBehind(yaw: number) { this.yaw = yaw; this.pitch = -0.12; }

  update(dt: number, focus: THREE.Vector3, mode: CamMode, opts: { vehicleYaw?: number; speed?: number; vehicleSize?: number; exclude?: RAPIER.RigidBody | null; lookBack?: boolean } = {}) {
    this.lastInput += dt;
    if (mode === 'cinematic' && this.cinematic) {
      this.camera.position.lerp(this.cinematic.pos, 1 - Math.exp(-dt * 2));
      this.camera.lookAt(this.cinematic.look);
      return;
    }
    let targetDist = 4.2, height = 1.55, shoulderT = 0.45, fovT = 0;
    if (mode === 'aim') { targetDist = 2.0; shoulderT = 0.72; height = 1.6; fovT = -12; }
    else if (mode === 'vehicle') {
      const size = opts.vehicleSize ?? 1;
      targetDist = (6.6 + this.zoomLevel * 2.5) * size; height = 1.5 * size + 0.4; shoulderT = 0;
      const sp = Math.abs(opts.speed ?? 0);
      fovT = clamp(sp * 0.35, 0, 14);
      // Auto-align behind the car when the player is not steering the camera.
      if (this.lastInput > 1.2 && sp > 3 && opts.vehicleYaw !== undefined) {
        this.yaw = dampAngle(this.yaw, opts.vehicleYaw, 2.2, dt);
        this.pitch = damp(this.pitch, -0.16, 2, dt);
      }
    } else if (mode === 'dead') { targetDist = 6; height = 1.0; }
    else targetDist = 4.2 + this.zoomLevel * 1.4;
    this.dist = damp(this.dist, targetDist, 8, dt);
    this.shoulder = damp(this.shoulder, shoulderT, 10, dt);
    this.fovExtra = damp(this.fovExtra, fovT, 6, dt);
    this.pivot.set(focus.x, focus.y + height, focus.z);
    if (!this.initialized) { this.smoothPivot.copy(this.pivot); this.initialized = true; }
    const pk = mode === 'vehicle' ? 18 : 22;
    this.smoothPivot.x = damp(this.smoothPivot.x, this.pivot.x, pk, dt);
    this.smoothPivot.z = damp(this.smoothPivot.z, this.pivot.z, pk, dt);
    this.smoothPivot.y = damp(this.smoothPivot.y, this.pivot.y, mode === 'vehicle' ? 10 : 12, dt);
    if (this.smoothPivot.distanceTo(this.pivot) > 6) this.smoothPivot.copy(this.pivot);

    const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
    const yaw = opts.lookBack && opts.vehicleYaw !== undefined ? opts.vehicleYaw + Math.PI : opts.lookBack ? this.yaw + Math.PI : this.yaw;
    const back = new THREE.Vector3(Math.sin(yaw) * cy, -sy, Math.cos(yaw) * cy);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const origin = this.smoothPivot.clone().addScaledVector(right, this.shoulder);
    // keep the shoulder offset itself out of walls
    const sideHit = this.cast(this.smoothPivot, right, this.shoulder, opts.exclude);
    if (sideHit !== null) origin.copy(this.smoothPivot).addScaledVector(right, Math.max(0, sideHit - 0.05));
    let d = this.dist;
    const hit = this.cast(origin, back, d, opts.exclude);
    if (hit !== null) d = Math.max(0.35, hit - 0.08);
    const pos = origin.clone().addScaledVector(back, d);
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeT += dt * 30;
    const s = this.trauma * this.trauma * 0.35;
    const n = (k: number) => Math.sin(this.shakeT * (1 + k * 0.37) + k * 12.3) * Math.sin(this.shakeT * 0.71 + k * 3.1);
    this.camera.position.copy(pos);
    const look = origin.clone().addScaledVector(back, -10);
    this.camera.lookAt(look);
    this.camera.rotateZ(n(3) * s * 0.12);
    this.camera.rotateX(n(1) * s * 0.08);
    this.camera.rotateY(n(2) * s * 0.08);
    const fov = this.baseFov + this.fovExtra;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
  private cast(from: THREE.Vector3, dir: THREE.Vector3, maxDist: number, exclude?: RAPIER.RigidBody | null): number | null {
    const hit = this.physics.world.castShape(from, { x: 0, y: 0, z: 0, w: 1 }, dir, this.sphere, 0, maxDist, true, undefined, groups(0xffff, G_STATIC | G_VEHICLE), undefined, exclude ?? undefined);
    return hit ? hit.time_of_impact : null;
  }
  /** World-space aim ray from the camera centre. */
  aimRay(origin: THREE.Vector3, dir: THREE.Vector3) {
    this.camera.getWorldPosition(origin); this.camera.getWorldDirection(dir);
  }
  get forwardYaw() { return wrapAngle(this.yaw + Math.PI); }
}
