/** Third-person camera: smooth follow, over-the-shoulder aiming, vehicle chase, wall avoidance and shake. */
import * as THREE from 'three';
import { RAPIER, type Physics, G_STATIC, G_VEHICLE, groups } from '../core/physics';
import { clamp, damp, dampAngle, wrapAngle } from '../core/rng';
import { motionScale } from '../core/runtime';
import { rumble } from '../core/haptics';

/** Shortest boom (camera to shoulder pivot) on foot / aiming, however close the wall behind is. */
export const MIN_BOOM = 0.55;
/** The player's body is hidden while the camera is closer than this to the head, and shown again past HIDE_DIST + hysteresis. */
export const HIDE_DIST = 0.7;
/** Boom length after collision: the hit distance minus a skin, never below `min`, never above the wanted `dist`. */
export function boomLength(hit: number | null, dist: number, min = MIN_BOOM): number {
  const want = hit !== null ? Math.max(min, hit - 0.08) : dist;
  return Math.min(want, dist);
}
/** Hysteresis for hiding the player mesh when the camera sits inside / against the head. */
export function playerHiddenAt(headDist: number, wasHidden: boolean): boolean {
  return wasHidden ? headDist < HIDE_DIST + 0.15 : headDist < HIDE_DIST;
}
/** A one-frame focus jump (teleport, respawn, entering a far safehouse) bigger than this snaps the camera instead of easing through walls. */
export const TELEPORT_SNAP = 2.5;
export function isTeleport(prev: THREE.Vector3, next: THREE.Vector3): boolean {
  return prev.distanceToSquared(next) > TELEPORT_SNAP * TELEPORT_SNAP;
}

/** Chase-camera yaw follow rate (1/s): time constant ~0.18 s, so the view swings with a turning car instead of trailing it (was 2.2 = 0.45 s). */
export const CHASE_YAW_RATE = 5.5;

/**
 * Pure dynamic chase-camera offsets for vehicles: acceleration pulls the camera back for speed sensation,
 * hard braking nudges it closer, steering & lateral drift slip angle swing the camera slightly into the apex,
 * and carving corners adds a subtle banked roll.
 */
export function chaseCameraFx(speed: number, steer: number, accel: number, slipAngle: number): { distOffset: number; yawLead: number; roll: number } {
  const sp = Math.abs(speed);
  const speedK = clamp((sp - 3) / 22, 0, 1);
  const distOffset = accel >= 0
    ? clamp(accel / 18, 0, 1) * 0.52 * (0.35 + 0.65 * speedK)
    : -clamp(-accel / 22, 0, 1) * 0.34 * speedK;
  const yawLead = clamp(-steer * 0.13 * speedK + clamp(slipAngle, -0.8, 0.8) * 0.24 * speedK, -0.26, 0.26);
  const roll = clamp(steer * 0.021 * speedK - clamp(slipAngle, -0.7, 0.7) * 0.015 * speedK, -0.028, 0.028);
  return { distOffset, yawLead, roll };
}

export type CamMode = 'foot' | 'aim' | 'vehicle' | 'dead' | 'cinematic';

const _back = new THREE.Vector3();
const _right = new THREE.Vector3();
const _origin = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _look = new THREE.Vector3();

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
  private clear = 4; private hasClear = false; private lastMode: CamMode = 'foot';
  shakeScale = 1;
  baseFov = 62;
  zoomLevel = 0;
  cinematic: { pos: THREE.Vector3; look: THREE.Vector3 } | null = null;
  /** Barber / clothing preview: orbit `focus` (the player's chest) at `yaw` (0 = from +z), `dist` metres away; null = normal camera. */
  preview: { focus: THREE.Vector3; yaw: number; dist: number; pitch: number; fov: number } | null = null;
  /** COMBAT: vertical FOV (degrees) while looking through a weapon scope (set by PlayerCombat), null = none. */
  scopeFov: number | null = null;
  /** Active over-the-shoulder side (+1 right, -1 left) for corner peeking while aiming. */
  aimSide: 1 | -1 = 1;
  toggleShoulder() { this.aimSide = this.aimSide === 1 ? -1 : 1; }
  /** On-foot motion fed by the player controller each step: sprint blend 0..1, ground speed, step phase (cycles), airborne. */
  foot = { sprint: 0, speed: 0, stepPhase: 0, airborne: false, falling: false };
  private sprintBlend = 0;
  private bobAmp = 0;
  private dipY = 0; private dipV = 0;
  private dynDist = 0; private dynYaw = 0; private dynRoll = 0; private swayT = 0;

  constructor(public camera: THREE.PerspectiveCamera, private physics: Physics) { }

  addInput(dx: number, dy: number, sensitivity: number, invertY: boolean) {
    if (Math.abs(dx) + Math.abs(dy) > 0.5) this.lastInput = 0;
    this.yaw -= dx * 0.0022 * sensitivity;
    this.pitch -= dy * 0.0022 * sensitivity * (invertY ? -1 : 1);
    this.pitch = clamp(this.pitch, -1.2, 0.85);
  }
  /** Camera trauma; shakes of 0.14+ (explosions, crashes, taking damage, hard landings) also rumble the pad. Gunfire passes quiet=true (it rumbles lightly itself). */
  addShake(amount: number, quiet = false) {
    this.trauma = Math.min(1, this.trauma + amount * this.shakeScale * motionScale());
    if (!quiet && amount >= 0.14) rumble(Math.min(1, amount * 1.2), 120 + amount * 280);
  }
  /** True while the camera is so close to the head that the player's body should be hidden (set each update; PlayerCombat applies it). */
  hideBody = false;
  private lastFocus = new THREE.Vector3(); private haveFocus = false;
  snapBehind(yaw: number) { this.yaw = yaw; this.pitch = -0.12; this.initialized = false; this.hasClear = false; this.dist = 4.2; this.dynDist = 0; this.dynYaw = 0; this.dynRoll = 0; }
  /** Landing impulse: the camera dips by roughly `amount` metres and springs back. */
  landDip(amount: number) { this.dipV -= Math.min(0.5, Math.max(0, amount)) * 11; }

  update(dt: number, focus: THREE.Vector3, mode: CamMode, opts: { vehicleYaw?: number; speed?: number; vehicleSize?: number; exclude?: RAPIER.RigidBody | null; lookBack?: boolean; free?: boolean; steer?: number; accel?: number; slipAngle?: number } = {}) {
    this.lastInput += dt;
    this.swayT += dt;
    if (this.preview) {
      const v = this.preview, cp = Math.cos(v.pitch);
      this.camera.position.set(v.focus.x + Math.sin(v.yaw) * cp * v.dist, v.focus.y + Math.sin(v.pitch) * v.dist, v.focus.z + Math.cos(v.yaw) * cp * v.dist);
      this.camera.lookAt(v.focus);
      if (Math.abs(this.camera.fov - v.fov) > 0.01) { this.camera.fov = v.fov; this.camera.updateProjectionMatrix(); }
      this.initialized = false; this.hasClear = false; // the follow camera snaps back to the player afterwards
      return;
    }
    if (mode === 'cinematic' && this.cinematic) {
      this.camera.position.lerp(this.cinematic.pos, 1 - Math.exp(-dt * 2));
      this.camera.lookAt(this.cinematic.look);
      return;
    }
    if (this.haveFocus && isTeleport(this.lastFocus, focus)) { this.initialized = false; this.hasClear = false; this.dist = mode === 'vehicle' ? 6.6 * (opts.vehicleSize ?? 1) : mode === 'aim' ? 2.0 : 4.2; this.dynDist = 0; this.dynYaw = 0; this.dynRoll = 0; }
    this.lastFocus.copy(focus); this.haveFocus = true;
    const ms = motionScale();
    let targetDist = 4.2, height = 1.55, shoulderT = 0.45 * this.aimSide, fovT = 0;
    let wantDynDist = 0, wantDynYaw = 0, wantDynRoll = 0;
    if (mode === 'aim') { targetDist = 1.95; shoulderT = 0.72 * this.aimSide; height = 1.6; fovT = -13; }
    else if (mode === 'vehicle') {
      const size = opts.vehicleSize ?? 1;
      targetDist = (6.6 + this.zoomLevel * 2.5) * size; height = 1.5 * size + 0.4; shoulderT = 0;
      const sp = Math.abs(opts.speed ?? 0);
      fovT = clamp(sp * 0.35, 0, 14) * ms;
      const cfx = chaseCameraFx(opts.speed ?? 0, opts.steer ?? 0, opts.accel ?? 0, opts.slipAngle ?? 0);
      wantDynDist = cfx.distOffset * ms;
      wantDynYaw = (!opts.free && !opts.lookBack) ? cfx.yawLead * ms : 0;
      wantDynRoll = (!opts.free && !opts.lookBack) ? cfx.roll * ms : 0;
      // Auto-align behind the car when the player is not steering the camera.
      if (this.lastInput > 1.2 && sp > 3 && opts.vehicleYaw !== undefined && !opts.free) {
        this.yaw = dampAngle(this.yaw, opts.vehicleYaw, CHASE_YAW_RATE, dt);
        this.pitch = damp(this.pitch, -0.16, 2, dt);
      }
    } else if (mode === 'dead') { targetDist = 6; height = 1.0; shoulderT = 0; }
    else targetDist = 4.2 + this.zoomLevel * 1.4;
    this.dynDist = damp(this.dynDist, wantDynDist, 4.5, dt);
    this.dynYaw = damp(this.dynYaw, wantDynYaw, 4.2, dt);
    this.dynRoll = damp(this.dynRoll, wantDynRoll, 5.0, dt);
    targetDist += this.dynDist;
    // On foot: sprint pulls the camera back a touch, kicks the FOV and adds a subtle step bob; landings dip it.
    const onFoot = mode === 'foot', f = this.foot;
    this.sprintBlend = damp(this.sprintBlend, onFoot ? f.sprint : 0, f.sprint > this.sprintBlend ? 3.8 : 4.6, dt);
    if (onFoot) { targetDist += this.sprintBlend * 0.42; fovT += this.sprintBlend * 6.5 * ms; }
    this.bobAmp = damp(this.bobAmp, onFoot && !f.airborne ? Math.min(1, Math.max(0, (f.speed - 1) / 6)) : 0, 7, dt);
    this.dipV += (-96 * this.dipY - 14 * this.dipV) * Math.min(dt, 0.05);
    this.dipY += this.dipV * Math.min(dt, 0.05);
    if (!onFoot && mode !== 'aim') { this.dipY = 0; this.dipV = 0; }
    this.dist = damp(this.dist, targetDist, mode === 'aim' ? 11.5 : 8.5, dt);
    this.shoulder = damp(this.shoulder, shoulderT, mode === 'aim' ? 13 : 10, dt);
    this.fovExtra = damp(this.fovExtra, fovT, mode === 'aim' ? 10 : 6.5, dt);
    // Round 12: speed feel for the renderer's radial blur (0 below ~65 km/h, full near 160 km/h)
    this.camera.userData.speedFx = damp((this.camera.userData.speedFx as number) ?? 0, mode === 'vehicle' ? clamp((Math.abs(opts.speed ?? 0) - 18) / 26, 0, 1) : 0, 4, dt);
    const ph = f.stepPhase * Math.PI * 2;
    const bobY = ms * this.bobAmp * (0.022 + 0.018 * this.sprintBlend) * Math.cos(ph * 2);
    this.pivot.set(focus.x, focus.y + height, focus.z);
    if (!this.initialized) { this.smoothPivot.copy(this.pivot); this.initialized = true; }
    // Responsive on-foot follow with slight cinematic weight; aiming and vehicles stay razor-tight.
    const pk = mode === 'vehicle' ? 18 : onFoot ? 14.5 : 24;
    this.smoothPivot.x = damp(this.smoothPivot.x, this.pivot.x, pk, dt);
    this.smoothPivot.z = damp(this.smoothPivot.z, this.pivot.z, pk, dt);
    // Vertical: soft during jumps (the arc reads on screen), quick when falling far or on the ground.
    const vk = mode === 'vehicle' ? 10 : onFoot && f.airborne ? (f.falling ? 15 : 5.2) : 14;
    this.smoothPivot.y = damp(this.smoothPivot.y, this.pivot.y, vk, dt);
    if (this.smoothPivot.distanceTo(this.pivot) > 6) this.smoothPivot.copy(this.pivot);

    const cy = Math.cos(this.pitch), sy = Math.sin(this.pitch);
    const yaw = opts.lookBack && opts.vehicleYaw !== undefined ? opts.vehicleYaw + Math.PI : opts.lookBack ? this.yaw + Math.PI : this.yaw + this.dynYaw;
    _back.set(Math.sin(yaw) * cy, -sy, Math.cos(yaw) * cy);
    _right.set(Math.cos(yaw), 0, -Math.sin(yaw));
    _origin.copy(this.smoothPivot).addScaledVector(_right, this.shoulder);
    _origin.y += bobY + this.dipY;
    // keep the shoulder offset itself out of walls (works for both right and mirrored left shoulder)
    const shAbs = Math.abs(this.shoulder);
    if (shAbs > 0.01) {
      const shSign = this.shoulder >= 0 ? 1 : -1;
      if (shSign < 0) _right.negate();
      const sideHit = this.cast(this.smoothPivot, _right, shAbs, opts.exclude);
      if (sideHit !== null) { _origin.copy(this.smoothPivot).addScaledVector(_right, Math.max(0, sideHit - 0.05)); _origin.y += bobY + this.dipY; }
      if (shSign < 0) _right.negate();
    }
    // Collision distance is smoothed: it tightens fast (never look through a wall) but eases back out slowly, so a rail,
    // hanger or passing car flicking in and out of the ray no longer makes the view pop between two positions.
    const hit = this.cast(_origin, _back, this.dist, opts.exclude);
    const want = mode === 'vehicle' ? (hit !== null ? Math.max(0.35, hit - 0.08) : this.dist) : boomLength(hit, this.dist);
    if (!this.hasClear || mode !== this.lastMode) this.clear = want;
    else this.clear = want < this.clear ? damp(this.clear, want, 38, dt) : damp(this.clear, want, 2.6, dt);
    this.hasClear = true; this.lastMode = mode;
    const d = Math.min(this.clear, this.dist);
    _pos.copy(_origin).addScaledVector(_back, d);
    if (mode === 'foot' || mode === 'aim') {
      const hx = _pos.x - focus.x, hy = _pos.y - (focus.y + 1.55), hz = _pos.z - focus.z;
      this.hideBody = playerHiddenAt(Math.hypot(hx, hy, hz), this.hideBody);
    } else this.hideBody = false;
    // shake
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    this.shakeT += dt * 30;
    const s = this.trauma * this.trauma * 0.35;
    const n = (k: number) => Math.sin(this.shakeT * (1 + k * 0.37) + k * 12.3) * Math.sin(this.shakeT * 0.71 + k * 3.1);
    this.camera.position.copy(_pos);
    _look.copy(_origin).addScaledVector(_back, -10);
    this.camera.lookAt(_look);
    if (this.bobAmp > 0.001 && ms > 0.5) this.camera.rotateZ(Math.sin(ph) * this.bobAmp * 0.004 * (1 + this.sprintBlend));
    if (Math.abs(this.dynRoll) > 1e-4) this.camera.rotateZ(this.dynRoll);
    if (mode === 'aim' && !this.scopeFov && ms > 0.5) {
      const still = clamp(1 - f.speed / 3, 0.35, 1);
      this.camera.rotateX(Math.sin(this.swayT * 1.35) * 0.0014 * still * ms);
      this.camera.rotateY(Math.sin(this.swayT * 0.92 + 1.1) * 0.0012 * still * ms);
    }
    this.camera.rotateZ(n(3) * s * 0.12);
    this.camera.rotateX(n(1) * s * 0.08);
    this.camera.rotateY(n(2) * s * 0.08);
    const fov = mode === 'aim' && this.scopeFov ? this.scopeFov : this.baseFov + this.fovExtra; // COMBAT: scope zoom
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
