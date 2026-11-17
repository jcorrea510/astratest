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
  /** On-foot motion fed by the player controller each step: sprint blend 0..1, ground speed, step phase (cycles), airborne. */
  foot = { sprint: 0, speed: 0, stepPhase: 0, airborne: false, falling: false };
  private sprintBlend = 0;
  private bobAmp = 0;
  private dipY = 0; private dipV = 0;

  constructor(public camera: THREE.PerspectiveCamera, private physics: Physics) { }

  addInput(dx: number, dy: number, sensitivity: number, invertY: boolean) {
    if (Math.abs(dx) + Math.abs(dy) > 0.5) this.lastInput = 0;
    this.yaw -= dx * 0.0022 * sensitivity;
    this.pitch -= dy * 0.0022 * sensitivity * (invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.2, 0.85);
  }
  addShake(amount: number) { this.trauma = Math.min(1, this.trauma + amount * this.shakeScale); }
  snapBehind(yaw: number) { this.yaw = yaw; this.pitch = -0.12; }
  /** Landing impulse: the camera dips by roughly `amount` metres and springs back. */
  landDip(amount: number) { this.dipV -= Math.min(0.5, Math.max(0, amount)) * 11; }

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
    // On foot: sprint pulls the camera back a touch, kicks the FOV and adds a subtle step bob; landings dip it.
    const onFoot = mode === 'foot', f = this.foot;
    this.sprintBlend = damp(this.sprintBlend, onFoot ? f.sprint : 0, f.sprint > this.sprintBlend ? 3 : 4, dt);
    if (onFoot) { targetDist += this.sprintBlend * 0.35; fovT += this.sprintBlend * 5; }
    this.bobAmp = damp(this.bobAmp, onFoot && !f.airborne ? Math.min(1, Math.max(0, (f.speed - 1) / 6)) : 0, 6, dt);
    this.dipV += (-90 * this.dipY - 13 * this.dipV) * Math.min(dt, 0.05);
    this.dipY += this.dipV * Math.min(dt, 0.05);
    if (!onFoot && mode !== 'aim') { this.dipY = 0; this.dipV = 0; }
    this.dist = damp(this.dist, targetDist, 8, dt);
    this.shoulder = damp(this.shoulder, shoulderT, 10, dt);
    this.fovExtra = damp(this.fovExtra, fovT, 6, dt);
    const ph = f.stepPhase * Math.PI * 2;
    const bobY = this.bobAmp * (0.022 + 0.018 * this.sprintBlend) * Math.cos(ph * 2);
    this.pivot.set(focus.x, focus.y + height, focus.z);
    if (!this.initialized) { this.smoothPivot.copy(this.pivot); this.initialized = true; }
    // On foot the follow lags slightly (a weighty, filmic chase); aiming and vehicles stay tight.
    const pk = mode === 'vehicle' ? 18 : onFoot ? 11 : 22;
    this.smoothPivot.x = damp(this.smoothPivot.x, this.pivot.x, pk, dt);
    this.smoothPivot.z = damp(this.smoothPivot.z, this.pivot.z, pk, dt);
    // Vertical: soft during jumps (the arc reads on screen), quick when falling far or on the ground.
    const vk = mode === 'vehicle' ? 10 : onFoot && f.airborne ? (f.falling ? 14 : 4.5) : 12;
    this.smoothPivot.y = damp(this.smoothPivot.y, this.pivot.y, vk, dt);
    if (this.smoothPivot.distanceTo(this.pivot) > 6) this.smoothPivot.copy(this.pivot);

    const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
    const yaw = opts.lookBack && opts.vehicleYaw !== undefined ? opts.vehicleYaw + Math.PI : opts.lookBack ? this.yaw + Math.PI : this.yaw;
    const back = new THREE.Vector3(Math.sin(yaw) * cy, -sy, Math.cos(yaw) * cy);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
    const origin = this.smoothPivot.clone().addScaledVector(right, this.shoulder);
    origin.y += bobY + this.dipY;
    // keep the shoulder offset itself out of walls
    const sideHit = this.cast(this.smoothPivot, right, this.shoulder, opts.exclude);
    if (sideHit !== null) { origin.copy(this.smoothPivot).addScaledVector(right, Math.max(0, sideHit - 0.05)); origin.y += bobY + this.dipY; }
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
    if (this.bobAmp > 0.001) this.camera.rotateZ(Math.sin(ph) * this.bobAmp * 0.004 * (1 + this.sprintBlend));
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
