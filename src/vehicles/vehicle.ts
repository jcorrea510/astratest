/**
 * A vehicle: physics body + procedural skinned model (doors and wheels are bones), paint, glass panes that can be
 * broken, lights, sprung body motion, deformable damage, fire.
 *
 * Door / seat / glass API (body frame: +z forward, +x = LEFT = driver side):
 *   doors[i]            { side: 'left'|'right', row: 0|1, open (target 0..1), amount (current 0..1), hanging }
 *                       index = row * 2 + (left ? 0 : 1); doorForSeat(seat) gives the door a seat is reached from
 *   setDoor(i, amount)  sets the target; the door swings there on a spring (amount 0 shut, 1 fully open ~66 deg)
 *   doorWorldPos(i)     where a person stands to open door i (outside, by the handle, clear of the swing)
 *   seatWorldPos(seat)  hip point of a seat (0 driver, 1 front passenger, 2 rear left, 3 rear right)
 *   seatLocal(seat)     where to put a seated human's root inside `visual`
 *   panes / breakGlass(id) / glassAt(worldPoint) / isGlassBroken(id)
 */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { VehiclePhysics, type DriveInput, type VehicleLayout } from './vehiclePhysics';
import { VEHICLES, type VehicleKind, type VehicleSpec } from './specs';
import type { Character } from '../actors/character';
import { getTemplate, type CarTemplate } from './models/build';
import { carMaterial, glassMaterial, type CarUniforms } from './models/carMaterial';
import { GROUND } from './shapes';

/** Height of the rig's hips above its root in the sitting/driving clips. */
export const HIP_ABOVE_ROOT = 0.55;
/** Swing angle of a fully open door (rad). */
const DOOR_MAX = 1.15;
const LOD_FAR = 36;

export interface VehicleTemplate extends CarTemplate { model: string; /** detailed undamaged body (shared) */ body: THREE.BufferGeometry }
export interface DoorState { side: 'left' | 'right'; row: 0 | 1; open: number; amount: number; vel: number; hanging: boolean; bone: THREE.Bone }
export interface PaneState { id: number; name: string; broken: boolean; door: number }

const beamTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 2, 0, 0);
  const gr = g.createRadialGradient(32, 50, 2, 32, 40, 30); gr.addColorStop(0, 'rgba(255,240,200,0.9)'); gr.addColorStop(0.6, 'rgba(255,240,200,0.35)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const POLICE_LIKE = new Set<VehicleKind>(['police', 'fbi', 'swat']);

let VEH_ID = 0;
export class Vehicle {
  /** Called when a pane breaks (VehicleManager hooks particles + sound). */
  static onGlassBreak: ((v: Vehicle, pane: number, at: THREE.Vector3) => void) | null = null;
  id = VEH_ID++;
  phys: VehiclePhysics;
  spec: VehicleSpec;
  group = new THREE.Group();
  /** sprung body (roll / pitch / heave); seated humans are parented here */
  visual = new THREE.Group();
  bodyMesh: THREE.SkinnedMesh;
  glassMesh: THREE.SkinnedMesh | null = null;
  skeleton: THREE.Skeleton;
  material: THREE.MeshPhysicalMaterial & { userData: { u: CarUniforms } };
  glassMat: ReturnType<typeof glassMaterial> | null = null;
  tpl: VehicleTemplate;
  health: number;
  destroyed = false;
  /** sank in deep water: dead, no fire */
  flooded = false;
  burnTime = 0;
  driver: Character | null = null;
  input: DriveInput = { throttle: 0, steer: 0, handbrake: false };
  headlights = false;
  siren = false;
  lightsBroken = false;
  paint = new THREE.Color();
  parked = false;
  lastDriverTime = 0;
  locked = false;
  flashT = 0;
  persistent = false;
  lastDamagedBy: unknown = null;
  /** hazard lights (indicators blink) */
  hazard = false;
  doors: DoorState[] = [];
  panes: PaneState[] = [];
  /** tank turret yaw / gun pitch (rad), animated towards the targets */
  turretYaw = 0; gunPitch = 0; turretTarget = 0; gunTarget = 0;
  lod = 0;
  private bones: THREE.Bone[] = [];
  private beam: THREE.Mesh | null = null;
  private ownGeo = false;
  private roll = 0; private pitch = 0; private rollV = 0; private pitchV = 0; private heave = 0; private heaveV = 0;
  private baseDirt = 0;
  private lastVel = new THREE.Vector3();
  private brokenMask = 0;
  private trackL = 0; private trackR = 0;

  constructor(physics: Physics, public kind: VehicleKind, _tpl: unknown, x: number, y: number, z: number, yaw: number, _atlas: unknown = null, paintIndex = -1) {
    this.spec = VEHICLES[kind];
    const t = getTemplate(kind);
    this.tpl = Object.assign(Object.create(t), { model: kind, body: t.lods[0].body }) as VehicleTemplate;
    this.health = this.spec.health;
    this.phys = new VehiclePhysics(physics, this.spec, t.layout, x, y + 0.6, z, yaw);
    physics.tag(this.phys.collider, { kind: 'vehicle', ref: this });
    // skeleton: body bone in the sprung group, wheel bones in the unsprung group, doors/turret under the body
    const inverses: THREE.Matrix4[] = [];
    for (const b of t.bones) {
      const bone = new THREE.Bone(); bone.name = b.name;
      const parentPos = b.parent >= 0 ? t.bones[b.parent].pos : [0, 0, 0];
      bone.position.set(b.pos[0] - parentPos[0], b.pos[1] - parentPos[1], b.pos[2] - parentPos[2]);
      if (b.parent === -1) this.visual.add(bone); else if (b.parent === -2) this.group.add(bone); else this.bones[b.parent].add(bone);
      this.bones.push(bone);
      inverses.push(new THREE.Matrix4().makeTranslation(-b.pos[0], -b.pos[1], -b.pos[2]));
    }
    this.skeleton = new THREE.Skeleton(this.bones, inverses);
    this.material = carMaterial();
    const u = this.material.userData.u;
    const paints = this.spec.paints;
    this.paint.set(paints[paintIndex >= 0 ? paintIndex % paints.length : Math.floor(Math.random() * paints.length)]).convertSRGBToLinear();
    u.uPaint.value.copy(this.paint);
    const s = t.shape;
    u.uMetal.value = s.metallic * (0.6 + Math.random() * 0.4);
    u.uLivery.value = s.livery;
    u.uGrille.value = s.grille.style;
    const d0 = s.doors[0], dz = s.doors.length ? [Math.min(...s.doors.map(d => d[0])), Math.max(...s.doors.map(d => d[1]))] : [0, 0];
    u.uBody.value.set(s.W / 2, (d0 ? t.doors[0].beltY : 1), dz[0], dz[1]);
    u.uBody2.value.set((s.gh ? s.gh.roof : 1.4) + GROUND, t.front, t.rear, Math.random());
    // second colour: liveries and two-tone bodies
    if (kind === 'muscle') u.uPaint2.value.set(this.paint.getHSL({ h: 0, s: 0, l: 0 }).l > 0.35 ? '#141416' : '#f2f2f0').convertSRGBToLinear();
    else if (kind === 'race') u.uPaint2.value.set(['#f4f2ee', '#141416', '#f2c230'][Math.floor(Math.random() * 3)]).convertSRGBToLinear();
    else if (kind === 'van') u.uPaint2.value.set('#f3f1ea').convertSRGBToLinear();
    this.bodyMesh = new THREE.SkinnedMesh(t.lods[0].body, this.material);
    this.setupSkinned(this.bodyMesh, t);
    this.bodyMesh.castShadow = true; this.bodyMesh.receiveShadow = true;
    if (t.lods[0].glass) {
      this.glassMat = glassMaterial();
      this.glassMesh = new THREE.SkinnedMesh(t.lods[0].glass, this.glassMat);
      this.setupSkinned(this.glassMesh, t); this.glassMesh.renderOrder = 1;
    }
    this.baseDirt = Math.random() * 0.3;
    for (const d of t.doors) this.doors.push({ side: d.side, row: d.row, open: 0, amount: 0, vel: 0, hanging: false, bone: this.bones[d.bone] });
    for (const p of t.panes) this.panes.push({ id: p.id, name: p.name, broken: false, door: t.doorBones.indexOf(p.bone) });
    if (beamTex && s.type !== 'tank') {
      this.beam = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 9).rotateX(-Math.PI / 2).translate(0, GROUND + 0.04, t.front + 4.4), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
      this.beam.renderOrder = 2; this.visual.add(this.beam);
    }
    this.group.add(this.visual);
    this.syncTransform();
  }
  private setupSkinned(m: THREE.SkinnedMesh, t: CarTemplate) {
    m.userData.shared = true;
    m.bind(this.skeleton, new THREE.Matrix4());
    m.boundingSphere = t.sphere.clone();
    m.boundingBox = t.bbox.clone().expandByScalar(1.2);
    m.frustumCulled = true;
    this.group.add(m);
  }
  get position() { return this.group.position; }
  get speed() { return this.phys.speed; }
  get yaw() { return this.phys.yaw; }
  get name() { return this.spec.name; }
  get size() { return Math.max(1, (this.tpl.front - this.tpl.rear) / 4.7) * (this.tpl.roofY > 1.8 ? 1.15 : 1); }
  get layout(): VehicleLayout { return this.tpl.layout; }

  // ------------------------------------------------------------------------------------------- doors & seats
  /** Door a seat is entered from (-1 if none, e.g. the tank hatch). */
  doorForSeat(seat: number) { return this.tpl.seats[seat]?.door ?? -1; }
  /** Index of a door by side and row (or -1). */
  doorIndex(side: 'left' | 'right', row: 0 | 1 = 0) { return this.doors.findIndex(d => d.side === side && d.row === row); }
  /** Target opening 0..1 of door i (spring-animated). */
  setDoor(i: number, amount: number) { const d = this.doors[i]; if (d) d.open = THREE.MathUtils.clamp(amount, 0, 1); }
  /** Body-frame stand point for door i. */
  doorLocal(i: number, out = new THREE.Vector3()) {
    const d = this.tpl.doors[i];
    if (!d) return out.set(this.tpl.shape.W / 2 + 0.6, GROUND, 0);
    const sg = d.side === 'left' ? 1 : -1;
    return out.set(sg * (d.outX + 0.5), GROUND + 0.02, d.z0 - 0.12);
  }
  /** Where a person stands (on the ground) to open door i: outside, by the handle, clear of the swing. */
  doorWorldPos(i: number, out = new THREE.Vector3()) { this.group.updateMatrixWorld(); return this.doorLocal(i, out).applyMatrix4(this.group.matrixWorld); }
  /** Hip point of a seat in the world. */
  seatWorldPos(seat: number, out = new THREE.Vector3()) {
    const s = this.tpl.seats[Math.min(seat, this.tpl.seats.length - 1)];
    this.visual.updateMatrixWorld();
    return out.set(s.x, s.y, s.z).applyMatrix4(this.visual.matrixWorld);
  }
  /** Root position (inside `visual`) for a human sitting in a seat. */
  seatLocal(seat = 0): THREE.Vector3 {
    const s = this.tpl.seats[Math.min(seat, this.tpl.seats.length - 1)];
    return new THREE.Vector3(s.x, s.y - HIP_ABOVE_ROOT, s.z + 0.04);
  }
  /** Driver seat (kept for older callers). */
  seatOffset(): THREE.Vector3 { return this.seatLocal(0); }
  /** World position of the front door's stand point on a side (1 = left/driver, -1 = right). */
  doorPoint(side: 1 | -1 = 1, out = new THREE.Vector3()) {
    const i = this.doorIndex(side === 1 ? 'left' : 'right', 0);
    if (i < 0) { out.set(side * (this.tpl.shape.W / 2 + 1.2), 0, 0).applyQuaternion(this.group.quaternion).add(this.group.position); return out; }
    return this.doorWorldPos(i, out);
  }

  // ------------------------------------------------------------------------------------------- glass
  isGlassBroken(id: number) { return (this.brokenMask >> id & 1) === 1; }
  /** Shatters a pane (particles + sound through Vehicle.onGlassBreak). Returns false if it was already gone. */
  breakGlass(id: number): boolean {
    const p = this.panes.find(x => x.id === id);
    if (!p || p.broken) return false;
    p.broken = true; this.brokenMask |= 1 << id;
    if (this.glassMat) this.glassMat.userData.broken.value = this.brokenMask;
    const tp = this.tpl.panes.find(x => x.id === id)!;
    // centre of the pane in the world
    const c = new THREE.Vector3(); const n = tp.tris.length / 3;
    for (let i = 0; i < n; i++) { c.x += tp.tris[i * 3]; c.y += tp.tris[i * 3 + 1]; c.z += tp.tris[i * 3 + 2]; }
    c.multiplyScalar(1 / Math.max(1, n));
    this.bodyMesh.updateMatrixWorld();
    c.applyMatrix4(this.boneMatrix(tp.bone, _m));
    Vehicle.onGlassBreak?.(this, id, c);
    return true;
  }
  /** Pane whose glass is within `tol` metres of a world point (e.g. a bullet hit), or null. Broken panes are skipped. */
  glassAt(worldPoint: THREE.Vector3, tol = 0.12): number | null {
    let best: number | null = null, bd = tol;
    this.group.updateMatrixWorld();
    for (const p of this.tpl.panes) {
      if (this.isGlassBroken(p.id)) continue;
      // into the rest pose of the pane's bone
      const inv = this.boneMatrix(p.bone, _m).invert();
      const lp = _v.copy(worldPoint).applyMatrix4(inv);
      const d = distToTris(lp, p.tris);
      if (d < bd) { bd = d; best = p.id; }
    }
    return best;
  }
  /** World matrix that maps rest-pose (body frame) points of a bone's vertices into the world. */
  private boneMatrix(bone: number, out: THREE.Matrix4) { const b = this.bones[bone]; b.updateWorldMatrix(true, false); return out.multiplyMatrices(b.matrixWorld, this.skeleton.boneInverses[bone]); }

  setTurret(yaw: number, pitch: number) { this.turretTarget = yaw; this.gunTarget = THREE.MathUtils.clamp(pitch, -0.12, 0.35); }

  // ------------------------------------------------------------------------------------------- update
  syncTransform() {
    const p = this.phys.body.translation(), q = this.phys.body.rotation();
    this.group.position.set(p.x, p.y, p.z); this.group.quaternion.set(q.x, q.y, q.z, q.w);
  }
  /** 0 = detailed, 1 = far (lighter body, no interior). */
  setLod(l: number) {
    if (l === this.lod || this.ownGeo) return;
    this.lod = l;
    this.bodyMesh.geometry = this.tpl.lods[l].body;
    if (this.glassMesh) this.glassMesh.geometry = this.tpl.lods[l].glass ?? this.tpl.lods[0].glass!;
  }
  updateLod(dist: number) { this.setLod(dist > LOD_FAR ? 1 : 0); }
  update(dt: number, night: number, time: number, braking: boolean) {
    this.syncTransform();
    const t = this.tpl, c = this.phys.ctrl, spec = this.spec;
    t.wheelBones.forEach((bi, i) => {
      const w = this.bones[bi], wd = t.layout.wheels[i];
      if (!wd) return;
      const sl = c.wheelSuspensionLength(i) ?? spec.suspRest;
      w.position.y = wd.y + spec.suspRest * 0.8 - sl;
      w.rotation.set(0, 0, 0);
      w.rotateY(c.wheelSteering(i) ?? 0);
      w.rotateX(this.phys.wheelRot[i]);
    });
    if (t.turretBone >= 0) {
      const k = Math.min(1, dt * 1.2);
      const dy = Math.atan2(Math.sin(this.turretTarget - this.turretYaw), Math.cos(this.turretTarget - this.turretYaw));
      this.turretYaw += THREE.MathUtils.clamp(dy, -0.9 * dt, 0.9 * dt) * (k > 0 ? 1 : 0);
      this.gunPitch += (this.gunTarget - this.gunPitch) * Math.min(1, dt * 3);
      this.bones[t.turretBone].rotation.set(0, this.turretYaw, 0);
      this.bones[t.gunBone].rotation.set(-this.gunPitch, 0, 0);
      // treads scroll with the ground speed of each side
      const yawRate = this.phys.body.angvel().y, half = t.shape.W / 2 + 0.3;
      this.trackL += (this.speed - yawRate * half) * dt / t.trackLen * 40; this.trackR += (this.speed + yawRate * half) * dt / t.trackLen * 40;
      this.material.userData.u.uTrack.value.set(-this.trackL % 1, -this.trackR % 1);
    }
    // doors: spring towards the target, loose doors swing with the body; fast driving pushes doors shut
    const v = this.phys.body.linvel();
    let lat = 0;
    if (dt > 0) {
      const ax = (v.x - this.lastVel.x) / dt, az = (v.z - this.lastVel.z) / dt, ay = (v.y - this.lastVel.y) / dt;
      const f = this.phys.forward();
      const lon = THREE.MathUtils.clamp(ax * f.x + az * f.z, -40, 40); lat = THREE.MathUtils.clamp(ax * f.z - az * f.x, -40, 40);
      for (const d of this.doors) {
        if (Math.abs(this.speed) > 7 && !d.hanging) d.open = 0;
        const target = d.hanging ? Math.max(d.open, 0.15) : d.open;
        let acc = (target - d.amount) * 70 - d.vel * 11;
        if (d.hanging) acc += (-lon * 0.05 + (d.side === 'left' ? 1 : -1) * lat * 0.03);
        d.vel += acc * dt; d.amount += d.vel * dt;
        if (d.amount < 0) { d.amount = 0; d.vel = Math.abs(d.vel) * 0.15; }
        if (d.amount > 1.05) { d.amount = 1.05; d.vel = -Math.abs(d.vel) * 0.3; }
        const sg = d.side === 'left' ? 1 : -1;
        d.bone.rotation.set(0, -sg * d.amount * DOOR_MAX, d.hanging ? sg * 0.06 : 0);
      }
      // Body roll / pitch / heave from acceleration: a sprung, slightly underdamped body reads as weight transfer.
      this.lastVel.set(v.x, v.y, v.z);
      const g = this.phys.grounded ? 1 : 0.2;
      const soft = t.shape.type === 'tank' ? 0.3 : 1;
      const tRoll = THREE.MathUtils.clamp(lat * 0.0085, -0.085, 0.085) * g * soft, tPitch = THREE.MathUtils.clamp(-lon * 0.0065, -0.06, 0.06) * g * soft;
      const k = 70, cc = 9, h = Math.min(dt, 1 / 30);
      this.rollV += ((tRoll - this.roll) * k - this.rollV * cc) * h; this.roll += this.rollV * h;
      this.pitchV += ((tPitch - this.pitch) * k - this.pitchV * cc) * h; this.pitch += this.pitchV * h;
      const tHeave = this.phys.grounded ? THREE.MathUtils.clamp(-ay * 0.004, -0.08, 0.05) : 0;
      this.heaveV += ((tHeave - this.heave) * 90 - this.heaveV * 10) * h; this.heave += this.heaveV * h;
      this.visual.rotation.set(this.pitch, 0, this.roll);
      this.visual.position.y = this.heave;
    }
    // Lights: lenses glow (bloom does the halo); brake lights flare, night tail lights glow softly.
    const u = this.material.userData.u;
    const occupied = !!this.driver || this.persistent;
    const on = (this.headlights || night > 0.35) && !this.destroyed && !this.lightsBroken && occupied;
    u.uHead.value = on ? 4 : 0;
    if (this.beam) { (this.beam.material as THREE.MeshBasicMaterial).opacity = on ? 0.28 * Math.max(night, 0.2) : 0; this.beam.visible = on; }
    const lit = !this.destroyed && occupied;
    u.uTail.value = this.destroyed ? 0 : braking && lit ? 7 : on ? 2.2 : 0;
    u.uRev.value = lit && this.input.throttle < -0.1 && this.speed < -0.3 ? 3 : 0;
    const blink = Math.floor(time * 2.6) % 2 ? 3.5 : 0;
    const steerBlink = lit && !this.siren && !this.hazard && Math.abs(this.input.steer) > 0.6 && Math.abs(this.speed) < 12 && !!this.driver;
    const hz = !this.destroyed && (lit && this.hazard);
    u.uInd.value.set(hz || (steerBlink && this.input.steer > 0) ? blink : 0, hz || (steerBlink && this.input.steer < 0) ? blink : 0);
    const ph = Math.floor(time * 6) % 2, s = this.siren && !this.destroyed;
    u.uBar.value.set(s && ph ? 6 : 0.15, s && !ph ? 7 : 0.15);
    u.uLight.value = this.destroyed ? 0 : Math.max(0.6, night * 2.5);
    u.uDirt.value = Math.min(1, this.baseDirt + (1 - this.health / spec.health) * 0.8);
    if (this.glassMesh) this.glassMesh.visible = !this.destroyed;
    if (this.flashT > 0) { this.flashT -= dt; u.uFlash.value = Math.max(0, this.flashT * 4); }
    void POLICE_LIKE;
  }
  /** Applies damage; deforms the body near the impact point (local space). Returns true when this destroyed it. */
  damage(amount: number, worldPoint?: THREE.Vector3, worldDir?: THREE.Vector3, by?: unknown): boolean {
    if (this.destroyed) return false;
    if (by !== undefined) this.lastDamagedBy = by;
    this.health -= amount;
    if (worldPoint && amount > 25) {
      const sev = Math.min(1, amount / 300);
      this.deform(worldPoint, worldDir, sev);
      // hard hits shatter the nearest pane; a battered car's doors spring loose
      if (sev > 0.35) {
        const lp = this.visual.worldToLocal(worldPoint.clone());
        let best = -1, bd = 1.6;
        for (const p of this.tpl.panes) { if (this.isGlassBroken(p.id)) continue; const d = distToTris(lp, p.tris); if (d < bd) { bd = d; best = p.id; } }
        if (best >= 0 && Math.random() < sev) this.breakGlass(best);
        if (this.health < this.spec.health * 0.35) {
          for (let i = 0; i < this.doors.length; i++) {
            const d = this.doors[i], dd = this.tpl.doors[i];
            if (!d.hanging && Math.sign(lp.x) === (d.side === 'left' ? 1 : -1) && lp.z < dd.z1 + 0.8 && lp.z > dd.z0 - 0.8 && Math.random() < 0.5) { d.hanging = true; d.vel = 2; }
          }
        }
      }
    }
    const frac = this.health / this.spec.health;
    this.phys.enginePower = frac < 0.25 ? 0.6 : 1;
    if (this.health <= 0) {
      this.health = 0; this.destroyed = true; this.burnTime = 0.001; this.siren = false;
      const u = this.material.userData.u; u.uBurn.value = 0.85;
      for (const p of this.panes) this.breakGlass(p.id);
      return true;
    }
    return false;
  }
  private deform(worldPoint: THREE.Vector3, worldDir: THREE.Vector3 | undefined, severity: number) {
    if (!this.ownGeo) {
      // private positions/normals, everything else shared with the template
      const src = this.tpl.lods[0].body, g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, k === 'position' || k === 'normal' ? (a as THREE.BufferAttribute).clone() : a);
      this.bodyMesh.geometry = g; this.ownGeo = true; this.lod = 0;
    }
    const g = this.bodyMesh.geometry; const pos = g.attributes.position as THREE.BufferAttribute, si = g.attributes.skinIndex as THREE.BufferAttribute;
    this.visual.updateMatrixWorld();
    const inv = new THREE.Matrix4().copy(this.visual.matrixWorld).invert();
    const lp = worldPoint.clone().applyMatrix4(inv);
    const center = new THREE.Vector3(0, (this.tpl.bbox.min.y + this.tpl.bbox.max.y) / 2, 0);
    const dir = worldDir ? worldDir.clone().transformDirection(inv) : center.clone().sub(lp).normalize();
    const radius = 1.3, push = 0.24 * severity;
    const wheel = new Set(this.tpl.wheelBones);
    for (let i = 0; i < pos.count; i++) {
      if (wheel.has(si.getX(i))) continue;
      const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
      const d = Math.hypot(vx - lp.x, (vy - lp.y) * 1.4, vz - lp.z);
      if (d > radius) continue;
      const k = (1 - d / radius) ** 2 * push;
      pos.setXYZ(i, vx + dir.x * k + (Math.random() - 0.5) * k * 0.3, vy + dir.y * k * 0.5 - k * 0.15, vz + dir.z * k);
    }
    pos.needsUpdate = true;
    if (lp.z > this.tpl.front - 0.8 && severity > 0.4) this.lightsBroken = true;
  }
  /** New paint (liveried service vehicles keep their colours). */
  respray(color: THREE.ColorRepresentation) {
    if (this.tpl.shape.livery === 1 || this.tpl.shape.livery >= 5) return;
    this.paint.set(color).convertSRGBToLinear(); this.material.userData.u.uPaint.value.copy(this.paint);
  }
  /** Restores the undamaged shared body (respray): panels, glass, doors. */
  resetBody() {
    if (this.ownGeo) { this.bodyMesh.geometry.dispose(); this.ownGeo = false; }
    this.lod = -1; this.setLod(0);
    this.lightsBroken = false;
    this.brokenMask = 0; for (const p of this.panes) p.broken = false;
    if (this.glassMat) this.glassMat.userData.broken.value = 0;
    for (const d of this.doors) { d.hanging = false; d.open = 0; }
  }
  private disposed = false;
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.phys.dispose(); this.group.removeFromParent();
    if (this.ownGeo) this.bodyMesh.geometry.dispose();
    this.material.dispose(); this.glassMat?.dispose();
    this.skeleton.dispose();
    this.phys.physics.untag(this.phys.collider);
    this.visual.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.shared && !(m as THREE.SkinnedMesh).isSkinnedMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } });
    this.driver = null;
  }
}

/** Distance from p to the nearest triangle in a flat position list. */
function distToTris(p: THREE.Vector3, tris: Float32Array): number {
  let best = Infinity;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), q = new THREE.Vector3();
  const tri = new THREE.Triangle();
  for (let i = 0; i < tris.length; i += 9) {
    a.fromArray(tris, i); b.fromArray(tris, i + 3); c.fromArray(tris, i + 6);
    tri.set(a, b, c); tri.closestPointToPoint(p, q);
    const d = q.distanceTo(p); if (d < best) best = d;
  }
  return best;
}
void _q;
