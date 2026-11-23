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
import { ragHulls } from './ragHull';
import { Crumpler } from './crumple';

/** Height of the rig's hips above its root in the sitting/driving clips. */
export const HIP_ABOVE_ROOT = 0.55;
/** Swing angle of a fully open door (rad). */
const DOOR_MAX = 1.15;
// lod 0 (35k tris, interior) inside 15 m, lod 1 (~3k, looks the same from the street) to 65 m, lod 2 (~1.3k, the far-crowd model) beyond
const LOD_MID = 15, LOD_FAR = 65;

export interface VehicleTemplate extends CarTemplate { model: string; /** detailed undamaged body (shared) */ body: THREE.BufferGeometry }
export interface DoorState { side: 'left' | 'right'; row: 0 | 1; open: number; amount: number; vel: number; hanging: boolean; bone: THREE.Bone; /** crash-bent: the door stays slightly ajar (0..1) */ jam?: number }
/** Police-style strobe: each side fires a quick triple flash, then the other side answers (red, blue). Returns 0/1 per side. */
export function barStrobe(time: number): [number, number] {
  const slot = Math.floor((time * 9) % 18); // 2 s cycle in 9 Hz slots: even slot = flash, odd = dark
  const flash = slot % 2 === 0;
  return [flash && slot < 6 ? 1 : 0, flash && slot >= 9 && slot < 15 ? 1 : 0];
}
export interface PaneState { id: number; name: string; broken: boolean; door: number; /** 0 intact, 1 star crack, 2 heavy web */ crack: number }

const beamTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 64; c.height = 128; const g = c.getContext('2d')!;
  g.setTransform(1, 0, 0, 2, 0, 0);
  const gr = g.createRadialGradient(32, 50, 2, 32, 40, 30); gr.addColorStop(0, 'rgba(255,238,200,0.55)'); gr.addColorStop(0.55, 'rgba(255,238,200,0.18)'); gr.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64); return new THREE.CanvasTexture(c);
})();
const _sm = new THREE.Matrix4(), _sa = new THREE.Vector3(), _sb = new THREE.Vector3();
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _m2 = new THREE.Matrix4(), _v3 = new THREE.Vector3();
const POLICE_LIKE = new Set<VehicleKind>(['police', 'fbi', 'swat']);

let VEH_ID = 0;
export class Vehicle {
  /** Called when a pane breaks (VehicleManager hooks particles + sound). */
  static onGlassCrack: ((v: Vehicle, paneId: number, at: THREE.Vector3) => void) | null = null;
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
  /** headlights lit this frame (Round 7: the manager gives the nearest lit cars a real spot light) */
  headOn = false;
  /** Emergency lights + sound driven by AI units (police dispatch sets this). */
  siren = false;
  /** Player-controlled siren tone: 0 off, 1 wail, 2 yelp, 3 phaser. */
  sirenTone = 0;
  /** Light bar toggled by the driver (independent of the siren sound). */
  lightBar = false;
  /** True while this vehicle's siren is sounding (AI or player): the traffic/police code pulls over for it. */
  get sirenOn(): boolean { return (this.siren || this.sirenTone > 0) && !this.destroyed; }
  /** True while the light bar strobes. */
  get barOn(): boolean { return (this.siren || this.lightBar || this.sirenTone > 0) && !this.destroyed; }
  lightsBroken = false;
  paint = new THREE.Color();
  parked = false;
  lastDriverTime = 0;
  /** mission lock: nobody may get in */
  locked = false;
  /** doors locked: a thief has to smash the driver's window first (parked cars) */
  doorsLocked = false;
  /** engine can be started (false = needs hotwiring after a break-in) */
  ignition = true;
  /** the player has driven it (stays unlocked and started) */
  playerUsed = false;
  flashT = 0;
  persistent = false;
  lastDamagedBy: unknown = null;
  /** hazard lights (indicators blink) */
  hazard = false;
  /** turn signal set by AI drivers: +1 = same side as steer>0, -1 = steer<0, 0 = off */
  signal = 0;
  doors: DoorState[] = [];
  panes: PaneState[] = [];
  /** tank turret yaw / gun pitch (rad), animated towards the targets */
  turretYaw = 0; gunPitch = 0; turretTarget = 0; gunTarget = 0;
  lod = 0;
  private bones: THREE.Bone[] = [];
  private beam: THREE.Mesh | null = null;
  private ownGeo = false; private ownG: THREE.BufferGeometry | null = null;
  /** 0..1: a city bus kneels at the kerb (body lowered and leaning to the pavement) */
  kneel = 0;
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
    this.phys.addRagHulls(ragHulls(kind, t.shape, t.layout));
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
    else if (kind === 'van' || kind === 'bus') u.uPaint2.value.set('#f3f1ea').convertSRGBToLinear();
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
    for (const p of t.panes) this.panes.push({ id: p.id, name: p.name, broken: false, door: t.doorBones.indexOf(p.bone), crack: 0 });
    if (beamTex && s.type !== 'tank') {
      this.beam = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 7.5).rotateX(-Math.PI / 2).translate(0, GROUND + 0.04, t.front + 3.6), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
      this.beam.renderOrder = 2; this.visual.add(this.beam);
    }
    this.visual.userData.floorY = GROUND + t.shape.clear + 0.14; // cabin carpet top: seated humans plant their feet here
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
  /** Round 8: heading of the drawn (interpolated) car; the chase camera follows this, not the last physics step, so the car
   * doesn't shimmy against the camera when the frame rate and the 60 Hz physics beat against each other. */
  get visualYaw() { return yawOfQuat(this.group.quaternion); }
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
  /** Door geometry in the body frame for scripted entry: side sign (+1 left), outer skin x, rear/front edge z, belt line y, ground y. */
  doorFrame(i: number): { sg: 1 | -1; outX: number; z0: number; z1: number; belt: number; ground: number } {
    const d = this.tpl.doors[i];
    if (!d) return { sg: 1, outX: this.tpl.shape.W / 2, z0: -0.5, z1: 0.5, belt: GROUND + 1, ground: GROUND };
    return { sg: d.side === 'left' ? 1 : -1, outX: d.outX, z0: d.z0, z1: d.z1, belt: d.beltY, ground: GROUND };
  }
  /** Side-window pane of door i (-1 if none). */
  paneOfDoor(i: number) { return this.panes.find(p => p.door === i)?.id ?? -1; }
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
  /** Side windows wound down (drive-by): hidden like a broken pane but not 'broken' (no shards, no unlock). */
  private rolledMask = 0;
  rollWindow(pane: number, down: boolean) {
    if (pane < 0 || pane > 30) return;
    const nm = down ? this.rolledMask | (1 << pane) : this.rolledMask & ~(1 << pane);
    if (nm === this.rolledMask) return;
    this.rolledMask = nm;
    if (this.glassMat) this.glassMat.userData.broken.value = this.brokenMask | this.rolledMask;
  }
  isGlassBroken(id: number) { return (this.brokenMask >> id & 1) === 1; }
  /** Shatters a pane (particles + sound through Vehicle.onGlassBreak). Returns false if it was already gone. */
  breakGlass(id: number): boolean {
    const p = this.panes.find(x => x.id === id);
    if (!p || p.broken) return false;
    p.broken = true; this.brokenMask |= 1 << id;
    if (this.glassMat) this.glassMat.userData.broken.value = this.brokenMask | this.rolledMask;
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
  /** A hit that does not shatter yet: the pane cracks (spiderweb at `at`), a second hit makes it a heavy web, a third shatters it. */
  hitGlass(id: number, at?: THREE.Vector3, hits = 1): boolean {
    const p = this.panes.find(x => x.id === id);
    if (!p || p.broken) return false;
    const next = p.crack + hits;
    if (next >= 3) return this.breakGlass(id);
    const tp = this.tpl.panes.find(x => x.id === id);
    p.crack = next;
    if (tp && this.glassMat && id < 8) {
      this.group.updateMatrixWorld();
      const lp = at ? _v.copy(at).applyMatrix4(this.boneMatrix(tp.bone, _m).invert()) : _v.set(0, 0, 0);
      if (!at) { const n = tp.tris.length / 3; for (let i = 0; i < n; i++) { lp.x += tp.tris[i * 3]; lp.y += tp.tris[i * 3 + 1]; lp.z += tp.tris[i * 3 + 2]; } lp.multiplyScalar(1 / Math.max(1, n)); }
      const slot = this.glassMat.userData.crack.value[id];
      if (slot.w < 0.5 || !at) slot.set(lp.x, lp.y, lp.z, p.crack); else slot.w = p.crack; // keep the first impact as the web's centre
    }
    Vehicle.onGlassCrack?.(this, id, at ?? this.position);
    return true;
  }
  /** Pane whose glass is within `tol` metres of a world point (e.g. a bullet hit), or null. Broken panes are skipped. */
  glassAt(worldPoint: THREE.Vector3, tol = 0.12, includeBroken = false): number | null {
    let best: number | null = null, bd = tol;
    this.group.updateMatrixWorld();
    for (const p of this.tpl.panes) {
      if (!includeBroken && this.isGlassBroken(p.id)) continue;
      // into the rest pose of the pane's bone
      const inv = this.boneMatrix(p.bone, _m).invert();
      const lp = _v.copy(worldPoint).applyMatrix4(inv);
      const d = distToTris(lp, p.tris);
      if (d < bd) { bd = d; best = p.id; }
    }
    return best;
  }
  /**
   * Ray (world space) against the visible body mesh in its rest pose. The physics hull is much coarser than the paint,
   * so bullet-hole decals are snapped here. Only front-facing triangles count. Returns the distance along `d`, or -1.
   */
  surfaceRay(o: THREE.Vector3, d: THREE.Vector3, t0: number, t1: number, outN: THREE.Vector3): number {
    // Round 7: always the full-detail rest pose (a far LOD's CPU arrays are freed after upload: holes stopped appearing)
    const mesh = this.bodyMesh, g = this.ownGeo ? mesh.geometry : this.tpl.lods[0].body, pos = g.attributes.position, idx = g.index;
    mesh.updateWorldMatrix(true, false);
    const inv = _sm.copy(mesh.matrixWorld).invert();
    const lo = _sa.copy(o).applyMatrix4(inv), ld = _sb.copy(d).transformDirection(inv); // matrixWorld is rigid (scale 1)
    const n = idx ? idx.count : pos.count;
    let best = Infinity;
    for (let i = 0; i < n; i += 3) {
      const ia = idx ? idx.getX(i) : i, ib = idx ? idx.getX(i + 1) : i + 1, ic = idx ? idx.getX(i + 2) : i + 2;
      const ax = pos.getX(ia), ay = pos.getY(ia), az = pos.getZ(ia);
      const e1x = pos.getX(ib) - ax, e1y = pos.getY(ib) - ay, e1z = pos.getZ(ib) - az;
      const e2x = pos.getX(ic) - ax, e2y = pos.getY(ic) - ay, e2z = pos.getZ(ic) - az;
      const hx = ld.y * e2z - ld.z * e2y, hy = ld.z * e2x - ld.x * e2z, hz = ld.x * e2y - ld.y * e2x;
      const det = e1x * hx + e1y * hy + e1z * hz; if (det < 1e-9) continue; // front faces only (CCW normal opposes the ray)
      const f = 1 / det, sx = lo.x - ax, sy = lo.y - ay, sz = lo.z - az;
      const u = f * (sx * hx + sy * hy + sz * hz); if (u < 0 || u > 1) continue;
      const qx = sy * e1z - sz * e1y, qy = sz * e1x - sx * e1z, qz = sx * e1y - sy * e1x;
      const w = f * (ld.x * qx + ld.y * qy + ld.z * qz); if (w < 0 || u + w > 1) continue;
      const t = f * (e2x * qx + e2y * qy + e2z * qz);
      if (t >= t0 && t <= t1 && t < best) { best = t; outN.set(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x); }
    }
    if (best === Infinity) return -1;
    outN.transformDirection(mesh.matrixWorld).normalize();
    return best;
  }
  /** True if a world point lies over a window opening (broken or not): bullet holes must never be stamped there (the physics hull is coarser than the body, so they would hang in the air). */
  overGlass(worldPoint: THREE.Vector3, tol = 0.3) { return this.glassAt(worldPoint, tol, true) !== null; }
  /** World matrix that maps rest-pose (body frame) points of a bone's vertices into the world. */
  private boneMatrix(bone: number, out: THREE.Matrix4) { const b = this.bones[bone]; b.updateWorldMatrix(true, false); return out.multiplyMatrices(b.matrixWorld, this.skeleton.boneInverses[bone]); }

  setTurret(yaw: number, pitch: number) { this.turretTarget = yaw; this.gunTarget = THREE.MathUtils.clamp(pitch, -0.12, 0.35); }

  // ------------------------------------------------------------------------------------------- update
  /** Fraction of a fixed physics step elapsed since the last one (set by the game loop); 1 = show the latest state. */
  static renderAlpha = 1;
  /** Places the mesh at the physics pose, blended from the previous fixed step so motion is smooth at any frame rate. */
  syncTransform() {
    const ph = this.phys, p = ph.body.translation(), q = ph.body.rotation(), a = Math.max(0, Math.min(1, Vehicle.renderAlpha));
    if (a >= 1 || ph.body.isSleeping()) { this.group.position.set(p.x, p.y, p.z); this.group.quaternion.set(q.x, q.y, q.z, q.w); return; }
    const o = ph.prevPos, r = ph.prevQuat;
    this.group.position.set(o.x + (p.x - o.x) * a, o.y + (p.y - o.y) * a, o.z + (p.z - o.z) * a);
    this.group.quaternion.set(r.x, r.y, r.z, r.w).slerp(this._q.set(q.x, q.y, q.z, q.w), a);
  }
  private _q = new THREE.Quaternion();
  /** Parked spawn: sits settled on the ground at its rest height and sleeps until touched (no drop, tall trucks don't tip). */
  settleParked(groundY: number) {
    const p = this.phys.body.translation();
    this.phys.settleAt(p.x, groundY, p.z, this.yaw);
    this.syncTransform();
  }
  /** 0 = detailed, 1 = mid (~3k tris), 2 = far (~600 tris). */
  setLod(l: number) {
    if (l === this.lod) return;
    this.lod = l;
    this.bodyMesh.geometry = l === 0 && this.ownG ? this.ownG : this.tpl.lods[l].body;
    if (this.glassMesh) this.glassMesh.geometry = this.tpl.lods[l].glass ?? this.tpl.lods[0].glass!;
  }
  /** Dented cars keep their private (dented) body out to 40 m so damage never blinks away close by. */
  updateLod(dist: number) { this.setLod(dist > LOD_FAR ? 2 : dist > (this.ownGeo ? 40 : LOD_MID) ? 1 : 0); }
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
        const target = Math.max(d.hanging ? Math.max(d.open, 0.15) : d.open, (d.jam ?? 0) * 0.14);
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
      const tRoll = THREE.MathUtils.clamp(lat * 0.0085, -0.085, 0.085) * g * soft - this.kneel * 0.022, tPitch = THREE.MathUtils.clamp(-lon * 0.0065, -0.06, 0.06) * g * soft;
      const k = 70, cc = 9, h = Math.min(dt, 1 / 30);
      this.rollV += ((tRoll - this.roll) * k - this.rollV * cc) * h; this.roll += this.rollV * h;
      this.pitchV += ((tPitch - this.pitch) * k - this.pitchV * cc) * h; this.pitch += this.pitchV * h;
      const tHeave = (this.phys.grounded ? THREE.MathUtils.clamp(-ay * 0.004, -0.08, 0.05) : 0) - this.kneel * 0.07;
      this.heaveV += ((tHeave - this.heave) * 90 - this.heaveV * 10) * h; this.heave += this.heaveV * h;
      this.visual.rotation.set(this.pitch, 0, this.roll);
      this.visual.position.y = this.heave;
    }
    // Lights: lenses glow (bloom does the halo); brake lights flare, night tail lights glow softly.
    const u = this.material.userData.u;
    const occupied = !!this.driver || this.persistent;
    const on = (this.headlights || night > 0.35) && !this.destroyed && !this.lightsBroken && occupied;
    this.headOn = on;
    u.uHead.value = on ? 2.2 : 0;
    if (this.beam) { (this.beam.material as THREE.MeshBasicMaterial).opacity = on ? 0.5 * night : 0; this.beam.visible = on && night > 0.05; }
    const lit = !this.destroyed && occupied;
    u.uTail.value = this.destroyed ? 0 : braking && lit ? 3.5 : on ? 1.2 : 0;
    u.uRev.value = lit && this.input.throttle < -0.1 && this.speed < -0.3 ? 3 : 0;
    const blink = Math.floor(time * 2.6) % 2 ? 3.5 : 0;
    const steerBlink = lit && !this.barOn && !this.hazard && Math.abs(this.input.steer) > 0.6 && Math.abs(this.speed) < 12 && !!this.driver;
    const hz = !this.destroyed && (lit && this.hazard);
    const sg = lit && this.signal !== 0;
    u.uInd.value.set(hz || (sg && this.signal > 0) || (steerBlink && this.input.steer > 0) ? blink : 0, hz || (sg && this.signal < 0) || (steerBlink && this.input.steer < 0) ? blink : 0);
    const bar = barStrobe(time);
    u.uBar.value.set(this.barOn ? 0.15 + 11.85 * bar[0] : 0.15, this.barOn ? 0.15 + 13.85 * bar[1] : 0.15); // Round 9: brighter
    u.uLight.value = this.destroyed ? 0 : Math.max(0.6, night * 2.5);
    u.uDirt.value = Math.min(1, this.baseDirt + (1 - this.health / spec.health) * 0.8);
    if (this.glassMesh) this.glassMesh.visible = !this.destroyed;
    if (this.flashT > 0) { this.flashT -= dt; u.uFlash.value = Math.max(0, this.flashT * 4); }
    void POLICE_LIKE;
  }
  /** Applies damage; deforms the body near the impact point (local space). Returns true when this destroyed it. */
  damage(amount: number, worldPoint?: THREE.Vector3, worldDir?: THREE.Vector3, by?: unknown, dent = true): boolean {
    if (this.destroyed) return false;
    if (by !== undefined) this.lastDamagedBy = by;
    this.health -= amount;
    if (worldPoint && amount > 25) {
      const sev = Math.min(1, amount / 300);
      if (dent) this.deform(worldPoint, worldDir, sev);
      // hard hits shatter the nearest pane; a battered car's doors spring loose
      if (sev > 0.1) {
        const lp = this.visual.worldToLocal(worldPoint.clone());
        let best = -1, bd = 1.6;
        for (const p of this.tpl.panes) { if (this.isGlassBroken(p.id)) continue; const d = distToTris(lp, p.tris); if (d < bd) { bd = d; best = p.id; } }
        if (best >= 0 && sev > 0.7) this.breakGlass(best); // big crash: it goes
        else if (best >= 0 && Math.random() < sev * 2.5) this.hitGlass(best, worldPoint, sev > 0.45 ? 2 : 1); // otherwise cracks first
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
      this.health = 0; this.destroyed = true; this.burnTime = 0.001; this.siren = false; this.sirenTone = 0; this.lightBar = false;
      const u = this.material.userData.u; u.uBurn.value = 0.85;
      for (const p of this.panes) this.breakGlass(p.id);
      return true;
    }
    return false;
  }
  private deform(worldPoint: THREE.Vector3, worldDir: THREE.Vector3 | undefined, severity: number) {
    this.crumple(worldPoint, worldDir, severity * 1.1);
  }
  /** Crash state of the body panels (0..1): hood buckle, bumpers, ends, sides. Null until the first dent. */
  crumpler: Crumpler | null = null;
  private lastCrumple = -10;
  /**
   * Dents the body around a world-space contact. dirIn = direction the metal moves (into the car; omitted: towards the
   * centre). energy ~ 0.1 (tap) .. 1+ (40 mph into a wall). Also cracks glass, jams doors and breaks headlights.
   */
  crumple(worldPoint: THREE.Vector3, dirIn: THREE.Vector3 | undefined, energy: number) {
    if (energy <= 0.02) return;
    if (!this.ownGeo) {
      // private positions/normals, everything else shared with the template
      const src = this.tpl.lods[0].body, g = new THREE.BufferGeometry();
      for (const [k, a] of Object.entries(src.attributes)) g.setAttribute(k, k === 'position' || k === 'normal' ? (a as THREE.BufferAttribute).clone() : a);
      this.bodyMesh.geometry = g; this.ownGeo = true; this.ownG = g; this.lod = 0; this.crumpler = null;
    }
    const g = this.ownG!;
    const t = this.tpl;
    if (!this.crumpler) {
      const src = t.lods[0].body.attributes, orig = src.position.array as Float32Array;
      if (orig.length === 0) return; // CPU copy already freed (should not happen for lod 0)
      this.crumpler = new Crumpler({
        orig, skin: src.skinIndex.array as Uint16Array, skip: new Set(t.wheelBones), front: t.front, rear: t.rear, halfW: t.shape.W / 2,
        hoodZ0: t.shape.gh ? t.shape.gh.zA : 0.4, deckY: t.hood.y, bumperTop: GROUND + (t.shape.bumperF[1] || 0.5),
      }, g.attributes.position as THREE.BufferAttribute, g.attributes.normal as THREE.BufferAttribute);
    }
    this.group.updateMatrixWorld(true);
    const inv = _m2.copy(this.visual.matrixWorld).invert();
    const lp = worldPoint.clone().applyMatrix4(inv);
    const center = _v3.set(0, (t.bbox.min.y + t.bbox.max.y) / 2, 0);
    const dir = dirIn ? dirIn.clone().transformDirection(inv) : center.clone().sub(lp);
    dir.normalize();
    const cr = this.crumpler;
    cr.hit(lp, dir, energy);
    cr.panels(lp.x >= 0 ? 1 : -1);
    if (cr.bumperF > 0.5 || cr.front > 0.55) this.lightsBroken = true;
    // doors beside the impact spring ajar and no longer shut fully
    if (energy > 0.3 && Math.abs(lp.x) > t.shape.W * 0.3) for (let i = 0; i < this.doors.length; i++) {
      const d = this.doors[i], dd = t.doors[i];
      if (Math.sign(lp.x) === (d.side === 'left' ? 1 : -1) && lp.z < dd.z1 + 0.6 && lp.z > dd.z0 - 0.6) d.jam = Math.min(1, (d.jam ?? 0) + energy * 0.8);
    }
    if (energy > 0.45 && this.glassMesh) {
      let best = -1, bd = 1.7;
      for (const p of t.panes) { if (this.isGlassBroken(p.id)) continue; const d = distToTris(lp, p.tris); if (d < bd) { bd = d; best = p.id; } }
      if (best >= 0 && Math.random() < Math.min(1, energy * 1.2)) this.hitGlass(best, worldPoint, energy > 0.9 ? 2 : 1);
    }
    this.lastCrumple = performance.now();
  }
  /** New paint (liveried service vehicles keep their colours). */
  respray(color: THREE.ColorRepresentation) {
    if (this.tpl.shape.livery === 1 || this.tpl.shape.livery >= 5) return;
    this.paint.set(color).convertSRGBToLinear(); this.material.userData.u.uPaint.value.copy(this.paint);
  }
  /** Restores the undamaged shared body (respray): panels, glass, doors. */
  resetBody() {
    if (this.ownGeo) { this.disposeOwnGeo(); this.ownGeo = false; }
    this.lod = -1; this.setLod(0);
    this.lightsBroken = false;
    this.brokenMask = 0; for (const p of this.panes) p.broken = false;
    if (this.glassMat) { this.rolledMask = 0; this.glassMat.userData.broken.value = 0; for (const c of this.glassMat.userData.crack.value) c.w = 0; }
    for (const p of this.panes) p.crack = 0;
    for (const d of this.doors) { d.hanging = false; d.open = 0; d.jam = 0; }
    this.crumpler = null;
  }
  /** The dented copy shares most attributes with the template, whose CPU arrays were freed after upload: disposing them
   *  would drop the shared GPU buffers and the next re-upload would be empty (invisible car bodies). Only free the private ones. */
  private disposeOwnGeo() {
    const g = this.ownG ?? this.bodyMesh.geometry; this.ownG = null;
    for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
    g.setIndex(null);
    g.dispose();
  }
  /** True once removed from the world (its physics body is gone: never query it). */
  disposed = false;
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.phys.dispose(); this.group.removeFromParent();
    if (this.ownGeo) this.disposeOwnGeo();
    // Round 9 (Mac perf): the shared car materials are not disposed: disposing the last one released the shader program,
    // and the next car of that kind recompiled it mid-game (a hitch). The material itself is garbage-collected.
    this.skeleton.dispose();
    this.phys.physics.untag(this.phys.collider);
    this.visual.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && !m.userData.shared && !(m as THREE.SkinnedMesh).isSkinnedMesh) { m.geometry.dispose(); } });
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

/** Heading (yaw, atan2 of the forward +Z axis) of a rotation. Pure. */
export function yawOfQuat(q: { x: number; y: number; z: number; w: number }): number { return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)); }
