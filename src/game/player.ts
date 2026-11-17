/** Translates input into the player's on-foot movement and facing. Vehicle/weapon logic lives in their systems. */
import * as THREE from 'three';
import type { Character } from '../actors/character';
import type { Input } from '../core/input';
import type { CameraRig } from './camera';
import { wrapAngle } from '../core/rng';

export class PlayerController {
  aiming = false;
  sprinting = false;
  rollT = 0;
  private rollDir = new THREE.Vector3();
  private desired = new THREE.Vector3();
  stamina = 1;
  constructor(public char: Character, private input: Input, private cam: CameraRig) { }

  /** Fixed-step movement. canAim indicates a ranged weapon is equipped. */
  fixedUpdate(dt: number, opts: { canAim: boolean; blocked: boolean }) {
    const c = this.char, h = c.human;
    if (!c.alive || c.inVehicle) return;
    const mv = opts.blocked ? { x: 0, y: 0 } : this.input.moveAxes();
    const camYaw = this.cam.yaw + Math.PI; // direction the camera looks
    const fx = Math.sin(camYaw), fz = Math.cos(camYaw);
    const rx = -fz, rz = fx; // right of forward (x east, z south)
    const dirX = fx * mv.y - rx * mv.x * -1, dirZ = fz * mv.y - rz * mv.x * -1;
    const mag = Math.min(1, Math.hypot(mv.x, mv.y));
    this.aiming = !opts.blocked && opts.canAim && this.input.held('aim');
    const wantSprint = this.input.held('sprint') && !this.aiming && mag > 0.3;
    this.sprinting = wantSprint && this.stamina > 0.05;
    this.stamina = Math.max(0, Math.min(1, this.stamina + (this.sprinting ? -dt * 0.09 : dt * 0.2)));
    let speed = this.sprinting ? 6.6 : 4.1;
    if (this.input.pad.connected && mag < 0.6 && !this.sprinting) speed = 1.6 + mag * 3.2;
    if (this.aiming) speed = 2.4;
    if (c.swimming) speed = 2.2;
    // Dodge roll
    if (this.rollT > 0) {
      this.rollT -= dt;
      this.desired.copy(this.rollDir).multiplyScalar(6.2 * Math.min(1, this.rollT / 0.25 + 0.3));
      c.move(this.desired, dt, false);
      return;
    }
    if (!opts.blocked && this.input.justPressed('crouch') && c.grounded && !c.swimming && !h.busy) {
      this.rollT = 0.72;
      const yaw = mag > 0.1 ? Math.atan2(dirX, dirZ) : c.yaw;
      this.rollDir.set(Math.sin(yaw), 0, Math.cos(yaw)); c.yaw = yaw;
      h.playOnce('Roll', 'full', 0.08);
      return;
    }
    this.desired.set(dirX * speed * mag, 0, dirZ * speed * mag);
    const jump = !opts.blocked && this.input.justPressed('jump') && c.grounded && !c.swimming && !this.aiming;
    if (jump) h.playOnce('Jump_Start', 'full', 0.05);
    c.move(this.desired, dt, jump);
    // Facing: aim faces the camera; otherwise face movement. When aiming while moving the legs lead and the torso twists.
    const moveYaw = Math.atan2(this.desired.x, this.desired.z);
    if (this.aiming) {
      const moving = mag > 0.1;
      let legYaw = camYaw;
      if (moving) {
        const rel = wrapAngle(moveYaw - camYaw);
        legYaw = Math.abs(rel) < 1.9 ? camYaw + rel * 0.75 : camYaw + wrapAngle(rel + Math.PI) * 0.5;
      }
      c.faceTowards(legYaw, 16, dt);
      c.twist = wrapAngle(camYaw - c.yaw);
    } else {
      c.twist = 0;
      if (mag > 0.1) c.faceTowards(moveYaw, c.grounded ? 11 : 4, dt);
    }
  }
  /** Per-frame animation state. */
  updateAnimation() {
    const c = this.char, h = c.human;
    if (!c.alive) return;
    if (c.inVehicle) return;
    if (c.swimming) h.setState('swim');
    else if (!c.grounded && c.vel.y < -1.5 && this.rollT <= 0) h.setState('jump');
    else {
      if (h.currentState === 'jump' && c.grounded) h.playOnce('Jump_Land', 'full', 0.06);
      h.setState('loco');
    }
    const fwdSpeed = c.speed;
    h.setSpeed(fwdSpeed);
    h.aimPitch = -this.cam.pitch;
  }
}
