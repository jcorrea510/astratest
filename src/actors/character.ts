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
  private controller: RAPIER.KinematicCharacterController;
  twist = 0;
  private twistSmoothed = 0;

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
  /** Moves with the character controller. desired is horizontal velocity (m/s). */
  move(desired: THREE.Vector3, dt: number, jump = false) {
    if (!this.physicsEnabled) return;
    const deep = this.pos.y < WATER_LEVEL - 0.9;
    this.swimming = deep;
    if (this.swimming) {
      this.vel.x = damp(this.vel.x, desired.x * 0.45, 4, dt); this.vel.z = damp(this.vel.z, desired.z * 0.45, 4, dt);
      this.vel.y = damp(this.vel.y, (WATER_LEVEL - 1.25 - this.pos.y) * 3, 6, dt);
    } else {
      const acc = this.grounded ? 14 : 3;
      this.vel.x = damp(this.vel.x, desired.x, acc, dt); this.vel.z = damp(this.vel.z, desired.z, acc, dt);
      if (this.grounded) { this.vel.y = jump ? 6.4 : -2; }
      else this.vel.y = Math.max(-30, this.vel.y - 20 * dt);
    }
    const delta = { x: this.vel.x * dt, y: this.vel.y * dt, z: this.vel.z * dt };
    this.controller.computeColliderMovement(this.collider, delta, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS, groups(0xffff, G_STATIC | G_VEHICLE | G_CHAR));
    const m = this.controller.computedMovement();
    const wasGrounded = this.grounded;
    this.grounded = this.controller.computedGrounded();
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
  setCollision(enabled: boolean) { this.collider.setEnabled(enabled); this.physicsEnabled = enabled; }
  faceTowards(yaw: number, rate: number, dt: number) { this.yaw = dampAngle(this.yaw, yaw, rate, dt); }
  get speed() { return Math.hypot(this.vel.x, this.vel.z); }
  /** Applies damage; returns true if this hit killed the character. */
  damage(amount: number, from: Character | null, time: number): boolean {
    if (!this.alive) return false;
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
  dispose() {
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
