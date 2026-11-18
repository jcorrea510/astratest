/**
 * Helicopters: a dynamic Rapier body flown with an arcade model, plus the manager that owns them, their helipads,
 * rotor audio and crashes.
 *
 * Flight (player): collective up/down (Space / Shift or C) climbs or descends, W/S pitch the nose for speed, A/D yaw;
 * with no input it levels itself and brakes to a hover. The rotor needs ~4 s to spin up before it lifts off; on the
 * ground the skids rest on whatever is below. Hard impacts damage it; a rotor strike or a big crash destroys it and
 * it explodes.
 *
 * It implements the `Enterable` contract of game/carEntry (doors, seats, door frames) so getting in uses the same
 * walk-up, open-the-door and climb-in scene as cars, and the duck-typed parts of Vehicle that combat uses
 * (damage, glassAt, phys.body, visual, size, yaw), so it can be shot at.
 */
import * as THREE from 'three';
import { RAPIER, type Physics, groups, G_VEHICLE, G_STATIC, G_PROP, G_PLAYER } from '../core/physics';
import type { Character } from '../actors/character';
import { buildHeliModel, heliName, HELI_DOOR, HELI_GROUND, HELI_SEATS, MAST, ROTOR_R, type HeliModel, type HeliVariant } from './helicopterModel';
import { HIP_ABOVE_ROOT } from './vehicle';

export interface HeliInput { lift: number; pitch: number; yaw: number }
const DOOR_MAX = 1.2;
const _q = new THREE.Quaternion(), _e = new THREE.Euler(0, 0, 0, 'YXZ'), _v = new THREE.Vector3();
let HELI_ID = 10000;

export class Helicopter {
  id = HELI_ID++;
  readonly isHelicopter = true;
  group = new THREE.Group();
  /** model space (seated people are parented here) */
  visual = new THREE.Group();
  model: HeliModel;
  phys: { body: RAPIER.RigidBody; collider: RAPIER.Collider; physics: Physics };
  name: string;
  driver: Character | null = null;
  input: HeliInput = { lift: 0, pitch: 0, yaw: 0 };
  health = 1400; maxHealth = 1400;
  destroyed = false; burnTime = 0; flashT = 0;
  locked = false; doorsLocked = false; ignition = true; playerUsed = false; persistent = true; parked = true;
  lastDamagedBy: unknown = null;
  /** 0..1 rotor speed */
  rotor = 0;
  engineOn = false;
  doors: { side: 'left' | 'right'; row: 0 | 1; open: number; amount: number; vel: number }[] = [
    { side: 'left', row: 0, open: 0, amount: 0, vel: 0 }, { side: 'right', row: 0, open: 0, amount: 0, vel: 0 }];
  /** height of the skids above the ground below (m), updated each step */
  agl = 0;
  grounded = true;
  brokenMask = 0;
  /** set when a step ends in a crash: impact speed change (m/s) */
  impact = 0;
  private hdg: number; private pitch = 0; private roll = 0; private yawRate = 0;
  private rotorAngle = 0; private tailAngle = 0;
  private velBefore = new THREE.Vector3();
  private spin = 0;

  constructor(physics: Physics, public variant: HeliVariant, x: number, y: number, z: number, yaw: number, paintIndex = -1) {
    this.hdg = yaw;
    this.model = buildHeliModel(variant, paintIndex);
    this.name = heliName(variant);
    this.visual.add(this.model.root);
    this.group.add(this.visual);
    const w = physics.world;
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    const body = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(x, y - HELI_GROUND + 0.02, z).setRotation(q).setLinearDamping(0.05).setAngularDamping(2).setCcdEnabled(true).setCanSleep(false));
    const g = groups(G_VEHICLE, G_STATIC | G_VEHICLE | G_PROP | G_PLAYER);
    const collider = w.createCollider(RAPIER.ColliderDesc.cuboid(0.78, 0.62, 1.75).setTranslation(0, 0, 0.6).setFriction(0.5).setRestitution(0.05).setDensity(160).setCollisionGroups(g), body);
    w.createCollider(RAPIER.ColliderDesc.cuboid(0.24, 0.28, 2.3).setTranslation(0, 0.45, -3.4).setFriction(0.5).setDensity(80).setCollisionGroups(g), body);
    // skids: wide, grippy sole
    w.createCollider(RAPIER.ColliderDesc.cuboid(1.05, 0.06, 1.55).setTranslation(0, HELI_GROUND + 0.06, 0.35).setFriction(1.2).setDensity(60).setCollisionGroups(g), body);
    physics.tag(collider, { kind: 'vehicle', ref: this });
    for (let i = 0; i < body.numColliders(); i++) physics.tag(body.collider(i), { kind: 'vehicle', ref: this });
    this.phys = { body, collider, physics };
    this.syncTransform();
  }

  get position() { return this.group.position; }
  get yaw() { return this.hdg; }
  /** forward ground speed (m/s) */
  get speed() { const v = this.phys.body.linvel(); return v.x * Math.sin(this.hdg) + v.z * Math.cos(this.hdg); }
  get size() { return 2.1; }
  get kind() { return 'helicopter' as const; }
  get spec() { return { name: this.name, health: this.maxHealth }; }

  // ------------------------------------------------------------------------------------------- Enterable
  doorIndex(side: 'left' | 'right', row: 0 | 1 = 0) { return row === 0 ? (side === 'left' ? 0 : 1) : -1; }
  doorForSeat(seat: number) { return seat < 4 ? (HELI_SEATS[seat].x > 0 ? 0 : 1) : -1; }
  setDoor(i: number, amount: number) { const d = this.doors[i]; if (d) d.open = Math.max(0, Math.min(1, amount)); }
  doorFrame(i: number) { return { sg: (i === 0 ? 1 : -1) as 1 | -1, outX: HELI_DOOR.outX, z0: HELI_DOOR.z0, z1: HELI_DOOR.z1, belt: HELI_DOOR.belt, ground: HELI_GROUND }; }
  seatLocal(seat = 0) { const s = HELI_SEATS[Math.min(seat, HELI_SEATS.length - 1)]; return new THREE.Vector3(s.x, s.y - HIP_ABOVE_ROOT, s.z + 0.04); }
  doorPoint(side: 1 | -1 = 1, out = new THREE.Vector3()) { this.group.updateMatrixWorld(); return out.set(side * (HELI_DOOR.outX + 0.6), HELI_GROUND + 0.05, HELI_DOOR.z0 - 0.1).applyMatrix4(this.group.matrixWorld); }
  paneOfDoor(_i: number) { return -1; }
  breakGlass(_id: number) { return false; }
  isGlassBroken(_id: number) { return false; }
  glassAt(_p: THREE.Vector3): number | null { return null; }

  // ------------------------------------------------------------------------------------------- physics
  syncTransform() {
    const p = this.phys.body.translation(), q = this.phys.body.rotation();
    this.group.position.set(p.x, p.y, p.z); this.group.quaternion.set(q.x, q.y, q.z, q.w);
  }
  teleport(x: number, y: number, z: number, yaw: number) {
    this.hdg = yaw; this.pitch = 0; this.roll = 0;
    this.phys.body.setTranslation({ x, y: y - HELI_GROUND + 0.02, z }, true);
    this.phys.body.setRotation(_q.setFromAxisAngle(_v.set(0, 1, 0), yaw), true);
    this.phys.body.setLinvel({ x: 0, y: 0, z: 0 }, true); this.phys.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    this.syncTransform();
  }
  /** Before the physics step: flight controls. */
  fixedUpdate(dt: number) {
    const b = this.phys.body;
    const lv = b.linvel();
    this.velBefore.set(lv.x, lv.y, lv.z);
    // height above whatever is below the skids
    const p = b.translation();
    const solid = groups(0xffff, G_STATIC | G_VEHICLE | G_PROP);
    const hit = this.phys.physics.ray(p.x, p.y + HELI_GROUND + 0.4, p.z, 0, -1, 0, 60, solid, null, b);
    this.agl = hit ? hit.toi - 0.4 : 60;
    this.grounded = this.agl < 0.12;
    const powered = this.engineOn && !this.destroyed;
    this.rotor = Math.max(0, Math.min(1, this.rotor + (powered ? dt / 4 : -dt / 7)));
    if (this.destroyed) { b.setAngularDamping(0.4); return; }
    const inp = this.input;
    const eff = Math.max(0, Math.min(1, (this.rotor - 0.55) / 0.4)); // lift authority
    const flying = eff > 0.98 && (!this.grounded || inp.lift > 0.1);
    // attitude: nose down for speed, bank into turns, level out without input
    const tPitch = flying ? inp.pitch * 0.3 : 0;
    this.pitch += (tPitch - this.pitch) * Math.min(1, dt * 2.6);
    const yawAuth = this.grounded ? eff * 0.4 : eff;
    const tYawRate = inp.yaw * 1.25 * yawAuth;
    this.yawRate += (tYawRate - this.yawRate) * Math.min(1, dt * 3);
    this.hdg += this.yawRate * dt;
    const fwdSpeed = this.speed;
    const tRoll = flying ? Math.max(-0.4, Math.min(0.4, -this.yawRate * Math.max(0, fwdSpeed) * 0.03)) : 0;
    this.roll += (tRoll - this.roll) * Math.min(1, dt * 2.5);
    _e.set(this.pitch, this.hdg, this.roll);
    b.setRotation(_q.setFromEuler(_e), true);
    b.setAngvel({ x: 0, y: 0, z: 0 }, true);
    // velocities: horizontal from tilt, vertical from collective (gravity is applied by the solver: -20 m/s²)
    let vx = lv.x, vy = lv.y, vz = lv.z;
    const fx = Math.sin(this.hdg), fz = Math.cos(this.hdg);
    if (flying) {
      const thrust = this.pitch * 62; // ~18 m/s² at full pitch
      vx += fx * thrust * dt; vz += fz * thrust * dt;
      const drag = Math.abs(inp.pitch) > 0.05 ? 0.42 : 0.9;
      vx -= vx * drag * dt; vz -= vz * drag * dt;
      // the tail follows the nose (no endless sideways drift)
      const side = vx * fz - vz * fx;
      vx -= fz * side * 1.6 * dt; vz += fx * side * 1.6 * dt;
    }
    const vyT = inp.lift > 0.1 ? inp.lift * 9 : inp.lift < -0.1 ? inp.lift * 7 : 0;
    // hover lift cancels gravity at full rotor speed; the collective adds a climb / sink rate on top
    vy += (20 * eff * eff) * dt;
    if (eff > 0.98 && (!this.grounded || inp.lift > 0.1)) vy += (vyT - vy) * Math.min(1, dt * 2.4);
    if (this.grounded && inp.lift <= 0.1) { vx *= Math.exp(-dt * 4); vz *= Math.exp(-dt * 4); }
    b.setLinvel({ x: vx, y: vy, z: vz }, true);
  }
  /** After the physics step: impacts and rotor strikes. Returns 'crash' when this step destroyed it. */
  postStep(): 'crash' | 'hit' | null {
    this.syncTransform();
    if (this.destroyed) return null;
    const lv = this.phys.body.linvel();
    // what the solver took away = impact
    const dv = Math.hypot(lv.x - this.velBefore.x, (lv.y - this.velBefore.y) * 0.6, lv.z - this.velBefore.z);
    this.impact = dv;
    let res: 'crash' | 'hit' | null = null;
    if (dv > 8) { if (this.damage((dv - 7) * 85)) res = 'crash'; else res = 'hit'; }
    // main rotor sweeping into a wall
    if (!this.destroyed && this.rotor > 0.45) {
      this.group.updateMatrixWorld();
      const hub = _v.copy(MAST).applyMatrix4(this.group.matrixWorld);
      const solid = groups(0xffff, G_STATIC | G_VEHICLE);
      for (let i = 0; i < 8; i++) {
        const a = i * Math.PI / 4 + this.rotorAngle;
        const hit = this.phys.physics.ray(hub.x, hub.y + 0.05, hub.z, Math.sin(a), 0, Math.cos(a), ROTOR_R - 0.2, solid, null, this.phys.body);
        if (hit) { this.damage(this.health + 1); res = 'crash'; break; }
      }
    }
    return res;
  }
  damage(amount: number, _point?: THREE.Vector3, _dir?: THREE.Vector3, by?: unknown): boolean {
    if (this.destroyed) return false;
    if (by !== undefined) this.lastDamagedBy = by;
    this.health -= amount; this.flashT = 0.12;
    if (this.health <= 0) {
      this.health = 0; this.destroyed = true; this.burnTime = 0.001; this.engineOn = false;
      this.spin = (Math.random() < 0.5 ? -1 : 1) * 2.5;
      this.phys.body.setAngvel({ x: (Math.random() - 0.5) * 1.5, y: this.spin, z: (Math.random() - 0.5) * 1.5 }, true);
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------------------------------- visuals
  update(dt: number, time: number, night: number) {
    this.syncTransform();
    const m = this.model;
    this.rotorAngle += this.rotor * 42 * dt; this.tailAngle += this.rotor * 160 * dt;
    m.mainRotor.rotation.y = this.rotorAngle; m.tailRotor.rotation.x = this.tailAngle;
    // motion blur: blades fade into a translucent disc as they speed up
    const blur = Math.max(0, Math.min(1, (this.rotor - 0.35) / 0.4));
    const bladeMat = m.blades.material as THREE.MeshStandardMaterial;
    bladeMat.opacity = 1 - blur * 0.82; bladeMat.depthWrite = blur < 0.5;
    const discMat = m.disc.material as THREE.MeshBasicMaterial; discMat.opacity = blur * 0.85;
    m.disc.visible = m.tailDisc.visible = blur > 0.02;
    m.blades.visible = !this.destroyed || this.rotor > 0.05;
    // doors swing on a spring
    for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i];
      if (!this.grounded && !this.destroyed) d.open = Math.min(d.open, this.driver ? 0 : d.open);
      const acc = (d.open - d.amount) * 60 - d.vel * 10;
      d.vel += acc * dt; d.amount += d.vel * dt;
      if (d.amount < 0) { d.amount = 0; d.vel = 0; }
      const sg = d.side === 'left' ? 1 : -1;
      m.doors[i].rotation.y = sg * d.amount * DOOR_MAX;
    }
    // lights: beacon pulse, police strobes
    const beat = Math.sin(time * 6) > 0.6 && this.rotor > 0.1 ? 1 : 0.15;
    m.beacon.visible = !this.destroyed; (m.beacon.material as THREE.MeshBasicMaterial).color.setRGB(beat * 0.7, beat * 0.05, beat * 0.03);
    for (let i = 0; i < m.strobes.length; i++) m.strobes[i].visible = !this.destroyed && this.rotor > 0.2 && Math.floor(time * 5 + i) % 2 === 0;
    if (this.flashT > 0) this.flashT -= dt;
    void night;
  }
  private disposed = false;
  dispose() {
    if (this.disposed) return; this.disposed = true;
    const b = this.phys.body;
    for (let i = 0; i < b.numColliders(); i++) this.phys.physics.untag(b.collider(i));
    this.phys.physics.world.removeRigidBody(b);
    this.group.removeFromParent();
    this.model.root.traverse(o => { const mm = o as THREE.Mesh; if (mm.isMesh) mm.geometry.dispose(); });
    for (const m of this.model.materials) m.dispose();
    this.driver = null;
  }
}
