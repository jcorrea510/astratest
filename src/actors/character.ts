/** Shared body for every person: physics capsule, movement, health and the animated Human. */
import * as THREE from 'three';
import { RAPIER, type Physics, G_STATIC, G_VEHICLE, G_CHAR, groups } from '../core/physics';
import { Human, type HumanTemplate, type Look } from './human';
import { damp, dampAngle, wrapAngle } from '../core/rng';
import { WATER_LEVEL } from '../world/citymap';

export type Team = 'player' | 'civilian' | 'gang' | 'police';
const CAP_HALF = 0.55, CAP_R = 0.32, CENTER = CAP_HALF + CAP_R;

export class Character {
  human: Human;
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  swimming = false;
  health = 100; maxHealth = 100; armor = 0;
  alive = true;
  deadTime = 0;
  inVehicle: unknown = null;
  physicsEnabled = true;
  lastDamageFrom: Character | null = null;
  lastHitTime = -10;
  knockT = 0;
  private capStart = -10; private capUsed = 0;
  private controller: RAPIER.KinematicCharacterController;
  twist = 0;
  private twistSmoothed = 0;
  /** Whole-body lean (radians) pivoting at the feet: roll > 0 tilts to the character's right, pitch > 0 leans forward. */
  leanRoll = 0; leanPitch = 0;
  private leanRollS = 0; private leanPitchS = 0;
  /** Vertical speed just before the most recent landing (m/s, positive = downwards); set by integrate(). */
  landingSpeed = 0;

  constructor(public physics: Physics, tpl: HumanTemplate, look: Look, public team: Team, x: number, z: number, y = 0.2) {
    this.human = new Human(tpl, look);
    this.pos.set(x, y, z);
    this.body = physics.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(x, y + CENTER, z));
    this.collider = physics.world.createCollider(RAPIER.ColliderDesc.capsule(CAP_HALF, CAP_R).setCollisionGroups(groups(G_CHAR, G_STATIC | G_CHAR)), this.body);
    physics.tag(this.collider, { kind: 'character', ref: this });
    this.controller = physics.world.createCharacterController(0.02);
    this.controller.enableAutostep(0.35, 0.25, false);
    this.controller.enableSnapToGround(0.3);
    this.controller.setMaxSlopeClimbAngle(50 * Math.PI / 180);
    this.controller.setMinSlopeSlideAngle(55 * Math.PI / 180);
    this.controller.setApplyImpulsesToDynamicBodies(false);
    this.human.root.position.copy(this.pos);
  }
  get isPlayer() { return this.team === 'player'; }
  /** True when the body is deep enough in water to swim. */
  get inDeepWater() { return this.pos.y < WATER_LEVEL - 0.9; }
  /** Moves with the character controller. desired is horizontal velocity (m/s). */
  move(desired: THREE.Vector3, dt: number, jump = false) {
    if (!this.physicsEnabled) return;
    const deep = this.inDeepWater;
    this.swimming = deep;
    if (this.swimming) {
      this.vel.x = damp(this.vel.x, desired.x * 0.8, 4, dt); this.vel.z = damp(this.vel.z, desired.z * 0.8, 4, dt);
      this.vel.y = damp(this.vel.y, (WATER_LEVEL - 1.25 - this.pos.y) * 3, 6, dt);
    } else {
      const acc = this.grounded ? 14 : 3;
      this.vel.x = damp(this.vel.x, desired.x, acc, dt); this.vel.z = damp(this.vel.z, desired.z, acc, dt);
      if (this.grounded) { this.vel.y = jump ? 6.4 : -2; }
      else this.vel.y = Math.max(-30, this.vel.y - 20 * dt);
    }
    this.sweep(dt);
  }
  /**
   * Moves by the current velocity as set by the caller (who owns acceleration, gravity and jumping; used by the player).
   * Collision, ground detection and blocked-velocity correction are the same as move().
   */
  integrate(dt: number) {
    if (!this.physicsEnabled) return;
    this.swimming = false;
    this.sweep(dt);
  }
  private sweep(dt: number) {
    const vyBefore = this.vel.y;
    const delta = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.controller.computeColliderMovement(this.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G_STATIC | G_VEHICLE | G_CHAR));
    const m = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
    if (this.grounded && !wasGrounded) this.landingSpeed = Math.max(0, -vyBefore);
    if (!this.grounded && !wasGrounded && m.y > delta.y + 0.001 && this.vel.y < 0) this.vel.y = 0;
    if (!this.grounded && this.vel.y > 0 && m.y < delta.y - 0.001) this.vel.y = 0; // bonk
    this.pos.x += m.x; this.pos.y += m.y; this.pos.z += m.z;
    // horizontal velocity follows actual movement so blocked characters do not run on the spot
    if (dt > 0) { const ax = m.x / dt, az = m.z / dt; if (Math.hypot(ax, az) < Math.hypot(this.vel.x, this.vel.z) - 0.5) { this.vel.x = damp(this.vel.x, ax, 20, dt); this.vel.z = damp(this.vel.z, az, 20, dt); } }
    this.body.setNextKinematicTranslation({ x: this.pos.x, y: this.pos.y + CENTER, z: this.pos.z });
  }
  /** Teleports the body (no collision). */
  place(x: number, y: number, z: number, yaw?: number) {
    this.pos.set(x, y, z); this.vel.set(0, 0, 0);
    this.body.setTranslation({ x, y: y + CENTER, z }, true); this.body.setNextKinematicTranslation({ x, y: y + CENTER, z });
    if (yaw !== undefined) this.yaw = yaw;
    this.human.root.position.copy(this.pos); this.human.root.rotation.y = this.yaw;
  }
  /** Moves the body to a point without collision or resetting velocity (scripted motion such as a ledge climb). */
  setPosition(x: number, y: number, z: number) {
    this.pos.set(x, y, z);
    this.body.setNextKinematicTranslation({ x, y: y + CENTER, z });
  }
  /**
   * Looks for a ledge the character can climb in direction (dx, dz): an obstacle face within `reach` metres of the
   * capsule and a flat, free top between `minRise` and `maxRise` above the feet. Returns where to stand, or null.
   */
  findLedge(dx: number, dz: number, maxRise: number, minRise = 0.05, reach = 0.45): { x: number; y: number; z: number; rise: number } | null {
    const w = this.physics.world, flt = groups(0xffff, G_STATIC | G_VEHICLE);
    const flags = RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
    const l = Math.hypot(dx, dz); if (l < 1e-4) return null; dx /= l; dz /= l;
    // 1) an obstacle face ahead (rays at shin, hip and chest height)
    let face = Infinity;
    for (const hgt of [0.25, 0.65, 1.05]) {
      const hit = w.castRayAndGetNormal(new RAPIER.Ray({ x: this.pos.x, y: this.pos.y + hgt, z: this.pos.z }, { x: dx, y: 0, z: dz }), CAP_R + reach, true, flags, flt, this.collider);
      if (hit && Math.abs(hit.normal.y) < 0.5) face = Math.min(face, hit.timeOfImpact);
    }
    if (!Number.isFinite(face)) return null;
    // 2) a flat top just beyond the face
    const tx = this.pos.x + dx * (face + 0.42), tz = this.pos.z + dz * (face + 0.42);
    const fromY = this.pos.y + maxRise + 0.25;
    const down = w.castRayAndGetNormal(new RAPIER.Ray({ x: tx, y: fromY, z: tz }, { x: 0, y: -1, z: 0 }), maxRise + 0.25 - minRise, true, flags, flt, this.collider);
    if (!down || down.timeOfImpact < 0.02 || down.normal.y < 0.75) return null;
    const topY = fromY - down.timeOfImpact, rise = topY - this.pos.y;
    if (rise < minRise || rise > maxRise) return null;
    // 3) room to stand on top, and room to rise in place before stepping over
    const cflt = groups(0xffff, G_STATIC | G_VEHICLE | G_CHAR);
    if (this.physics.overlapsCapsule(tx, topY + CENTER + 0.04, tz, CAP_HALF, CAP_R - 0.02, cflt, this.body)) return null;
    if (this.physics.overlapsCapsule(this.pos.x, topY + CENTER + 0.04, this.pos.z, CAP_HALF, CAP_R - 0.06, cflt, this.body)) return null;
    return { x: tx, y: topY, z: tz, rise };
  }
  setCollision(enabled: boolean) { this.collider.setEnabled(enabled); this.physicsEnabled = enabled; }
  faceTowards(yaw: number, rate: number, dt: number) { this.yaw = dampAngle(this.yaw, yaw, rate, dt); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  /** Applies damage; returns true if this hit killed the character. */
  damage(amount: number, from: Character | null, time: number): boolean {
    if (!this.alive) return false;
    if (this.isPlayer) {
      // Fairness cap: incoming damage per rolling second is limited so death is never instantaneous.
      if (time - this.capStart > 1) { this.capStart = time; this.capUsed = 0; }
      amount = Math.max(0, Math.min(amount, 45 - this.capUsed)); this.capUsed += amount;
      if (amount <= 0) return false;
    }
    if (this.armor > 0) { const absorbed = Math.min(this.armor, amount * 0.65); this.armor -= absorbed; amount -= absorbed; }
    this.health -= amount; this.lastDamageFrom = from; this.lastHitTime = time;
    this.human.flash();
    if (this.health <= 0) { this.health = 0; this.kill(); return true; }
    return false;
  }
  kill() {
    if (!this.alive) return;
    this.alive = false; this.deadTime = 0;
    this.human.setState('dead'); this.human.setUpperMode('none');
    this.collider.setCollisionGroups(groups(0, 0));
  }
  revive(health = 100) {
    this.alive = true; this.health = health; this.human.setState('loco');
    this.collider.setCollisionGroups(groups(G_CHAR, G_STATIC | G_CHAR));
  }
  /** Updates visuals; twist rotates the upper body to aim while legs follow movement. */
  updateVisual(dt: number) {
    const h = this.human;
    h.root.position.copy(this.pos);
    if (this.swimming) h.root.position.y += 0.15;
    h.root.rotation.y = this.yaw;
    this.leanRollS = damp(this.leanRollS, this.leanRoll, 9, dt);
    this.leanPitchS = damp(this.leanPitchS, this.leanPitch, 9, dt);
    if (Math.abs(this.leanRollS) + Math.abs(this.leanPitchS) > 1e-4 || h.root.rotation.x !== 0 || h.root.rotation.z !== 0) {
      h.root.rotation.order = 'YXZ'; h.root.rotation.x = this.leanPitchS; h.root.rotation.z = this.leanRollS;
    }
    h.update(dt);
    this.twistSmoothed = damp(this.twistSmoothed, this.twist, 12, dt);
    if (Math.abs(this.twistSmoothed) > 0.001) {
      const t = wrapAngle(this.twistSmoothed);
      h.root.updateMatrixWorld(true);
      if (h.spine.parent) rotateBoneWorldY(h.spine.parent, t * 0.45);
      rotateBoneWorldY(h.spine, t * 0.55);
    }
  }
  /** Head height above ground in metres. */
  get headY() { return this.pos.y + 1.6 * this.human.look.height; }
  private disposed = false;
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.physics.untag(this.collider);
    this.physics.world.removeCharacterController(this.controller);
    this.physics.world.removeRigidBody(this.body);
    this.human.dispose();
  }
}

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _axis = new THREE.Vector3();
/** Rotates a bone about the world up axis (works under rotated parents). */
export function rotateBoneWorldY(bone: THREE.Object3D, angle: number) {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(_q);
  _axis.set(0, 1, 0).applyQuaternion(_q.invert());
  bone.quaternion.premultiply(_q2.setFromAxisAngle(_axis, angle));
  bone.updateMatrixWorld(true);
}
