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
import { VEHICLES, type VehicleClass, type VehicleKind, type VehicleSpec } from './specs';
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
export const LOD_MID = 13, LOD_FAR = 65;
const LOD_REF_TAN = Math.tan(THREE.MathUtils.degToRad(31)); // the game camera's 62 deg vertical FOV
/**
 * Pure LOD choice from screen size: distance is scaled by the camera FOV (zoom/aim makes a car look closer, a wide FOV
 * farther) and by vehicle length (a bus keeps detail longer). Hysteresis: a finer LOD returns at 88% of the threshold that
 * dropped it, so a car on a boundary never flickers. The player's own car is always LOD 0.
 */
export function pickLod(dist: number, cur: number, o: { fovDeg?: number; size?: number; midMax?: number; player?: boolean } = {}): number {
  if (o.player) return 0;
  const d = dist * Math.tan(THREE.MathUtils.degToRad((o.fovDeg ?? 62) / 2)) / LOD_REF_TAN / Math.min(1.6, Math.max(0.8, o.size ?? 1));
  const mid = (o.midMax ?? LOD_MID) * (cur >= 1 ? 0.88 : 1), far = LOD_FAR * (cur === 2 ? 0.88 : 1);
  return d > far ? 2 : d > mid ? 1 : 0;
}

export interface VehicleTemplate extends CarTemplate { model: string; /** detailed undamaged body (shared) */ body: THREE.BufferGeometry }
export interface DoorState { side: 'left' | 'right'; row: 0 | 1; open: number; amount: number; vel: number; hanging: boolean; bone: THREE.Bone; /** crash-bent: the door stays slightly ajar (0..1) */ jam?: number }
/** Police-style strobe: each side fires a quick triple flash, then the other side answers (red, blue). Returns 0/1 per side. */
export function barStrobe(time: number): [number, number] {
  const slot = Math.floor((time * 9) % 18); // 2 s cycle in 9 Hz slots: even slot = flash, odd = dark
  const flash = slot % 2 === 0;
  return [flash && slot < 6 ? 1 : 0, flash && slot >= 9 && slot < 15 ? 1 : 0];
}
export interface PaneState { id: number; name: string; broken: boolean; door: number; /** 0 intact, 1 star crack, 2 heavy web */ crack: number }

/** Per-class sprung body parameters (D3): visual pitch/roll/heave without changing the physics collider. */
export interface BodySpringParams {
  rollGain: number;
  pitchGain: number;
  maxRoll: number;
  maxPitch: number;
  /** Spring stiffness (1/s²) and damping (1/s); zeta = c / (2*sqrt(k)) ~ 0.45 gives one soft overshoot. */
  k: number;
  c: number;
}
export interface BodySpringState {
  roll: number; rollV: number;
  pitch: number; pitchV: number;
  heave: number; heaveV: number;
}

/**
 * Class-differentiated visual suspension softness (D3):
 * SUVs, vans, trucks and luxury land-yachts lean and dive noticeably; sedans have comfortable street travel
 * (>= 2.5 deg nose-down braking from 60 mph with one soft overshoot, >= 3 deg roll at 0.8 g); super & race stay flat and taut.
 */
export function bodySpringParams(cls: VehicleClass, kind: VehicleKind): BodySpringParams {
  if (kind === 'tank') return { rollGain: 0.0022, pitchGain: 0.0028, maxRoll: 0.032, maxPitch: 0.035, k: 68, c: 11.5 };
  if (kind === 'race' || cls === 'super') return { rollGain: 0.0046, pitchGain: 0.0036, maxRoll: 0.056, maxPitch: 0.048, k: 84, c: 11.2 };
  if (kind === 'coupe' || kind === 'sportsedan') return { rollGain: 0.0066, pitchGain: 0.0048, maxRoll: 0.082, maxPitch: 0.068, k: 60, c: 8.2 };
  if (cls === 'luxury') return { rollGain: 0.0124, pitchGain: 0.0086, maxRoll: 0.145, maxPitch: 0.105, k: 34, c: 5.2 };
  if (cls === 'utility' || cls === 'service') return { rollGain: 0.0132, pitchGain: 0.0088, maxRoll: 0.155, maxPitch: 0.108, k: 32, c: 5.0 };
  if (cls === 'military') return { rollGain: 0.0082, pitchGain: 0.0062, maxRoll: 0.105, maxPitch: 0.082, k: 40, c: 6.4 };
  if (cls === 'muscle') return { rollGain: 0.0094, pitchGain: 0.0076, maxRoll: 0.12, maxPitch: 0.095, k: 42, c: 5.9 };
  // sedan, compact, sports (convertible), emergency
  return { rollGain: 0.0092, pitchGain: 0.0064, maxRoll: 0.118, maxPitch: 0.092, k: 42, c: 5.9 };
}

/**
 * Pure, allocation-free visual body spring integrator (D3).
 * Mutates `s` in place. Positive pitch tilts the nose down (+z towards -y); positive roll leans right (+x towards +y).
 */
export function stepBodySpring(s: BodySpringState, lon: number, lat: number, ay: number, grounded: boolean, kneel: number, p: BodySpringParams, dt: number): void {
  const g = grounded ? 1 : 0.2;
  const tRoll = THREE.MathUtils.clamp(lat * p.rollGain, -p.maxRoll, p.maxRoll) * g - kneel * 0.022;
  const tPitch = THREE.MathUtils.clamp(-lon * p.pitchGain, -p.maxPitch, p.maxPitch) * g;
  const h = Math.min(Math.max(0, dt), 1 / 30);
  s.rollV += ((tRoll - s.roll) * p.k - s.rollV * p.c) * h;
  s.roll += s.rollV * h;
  s.pitchV += ((tPitch - s.pitch) * p.k - s.pitchV * p.c) * h;
  s.pitch += s.pitchV * h;
  const tHeave = (grounded ? THREE.MathUtils.clamp(-ay * 0.004, -0.08, 0.05) : 0) - kneel * 0.07;
  s.heaveV += ((tHeave - s.heave) * 90 - s.heaveV * 10) * h;
  s.heave += s.heaveV * h;
}

const beamTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d')!;
  // Twin-headlight dual-cone ground projection (left & right hot cores merging into wide forward throw)
  g.clearRect(0, 0, 128, 128);
  const drawBeam = (cx: number) => {
    g.save();
    g.translate(cx, 118);
    g.scale(0.85, 2.1);
    const gr = g.createRadialGradient(0, -10, 2, 0, -24, 46);
    gr.addColorStop(0, 'rgba(255,244,218,0.68)');
    gr.addColorStop(0.28, 'rgba(255,238,200,0.34)');
    gr.addColorStop(0.65, 'rgba(255,232,190,0.10)');
    gr.addColorStop(1, 'rgba(255,230,185,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(0, -24, 46, 0, Math.PI * 2); g.fill();
    g.restore();
  };
  drawBeam(40);
  drawBeam(88);
  return new THREE.CanvasTexture(c);
})();
/** Soft radial-ellipse underbody ambient occlusion contact shadow to ground vehicles on asphalt. */
const underShadowTex = (() => {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas'); c.width = 128; c.height = 128; const g = c.getContext('2d')!;
  g.clearRect(0, 0, 128, 128);
  // Dark tight chassis core + wide soft penumbra so cars never look like they float over flat asphalt
  const outer = g.createRadialGradient(64, 64, 14, 64, 64, 62);
  outer.addColorStop(0, 'rgba(4, 6, 10, 0.78)');
  outer.addColorStop(0.52, 'rgba(4, 6, 10, 0.56)');
  outer.addColorStop(0.78, 'rgba(4, 6, 10, 0.22)');
  outer.addColorStop(1, 'rgba(4, 6, 10, 0)');
  g.fillStyle = outer;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
})();
const PERF_CLASSES = new Set(['sports', 'muscle', 'race', 'super']);
/** Pure gear (R/N/1..6) and normalized RPM (0..1) estimator for HUD tach and shift pops. */
export function vehicleGearRpm(speed: number, topSpeed: number, throttle: number): { gear: string; gearNum: number; rpm: number } {
  const sp = Math.abs(speed), top = Math.max(12, topSpeed);
  if (speed < -0.5) return { gear: 'R', gearNum: -1, rpm: Math.min(1, 0.22 + (sp / (top * 0.35)) * 0.72) };
  if (sp < 0.45 && Math.abs(throttle) < 0.08) return { gear: 'N', gearNum: 0, rpm: 0.16 };
  const ratios = [0, 0.19, 0.36, 0.54, 0.73, 0.89, 1.08];
  const frac = Math.min(1.06, sp / top);
  let g = 1;
  while (g < 6 && frac > ratios[g]) g++;
  const lo = ratios[g - 1], hi = ratios[g];
  const band = Math.max(0, Math.min(1, (frac - lo) / Math.max(0.05, hi - lo)));
  const rpm = Math.min(1, 0.24 + band * 0.72 + (throttle > 0.2 ? 0.05 : 0));
  return { gear: String(g), gearNum: g, rpm };
}
const _sm = new THREE.Matrix4(), _sa = new THREE.Vector3(), _sb = new THREE.Vector3();
const _v = new THREE.Vector3(), _m = new THREE.Matrix4(), _q = new THREE.Quaternion();
const _m2 = new THREE.Matrix4(), _v3 = new THREE.Vector3();
const POLICE_LIKE = new Set<VehicleKind>(['police', 'fbi', 'swat']);
/** Round 13 (owner: headlights too bright, hard to see): lens glow of lit headlamps (was 2.2: a white bloom blob facing you)
 * and the opacity of the painted light pool on the road ahead (was 0.5, stacked on the real spot light). */
export const HEAD_LENS = 1.5;
export const BEAM_OPACITY = 0.22;

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
  lod = 0; private lodTick = 0;
  private bones: THREE.Bone[] = [];
  private beam: THREE.Mesh | null = null;
  private underShadow: THREE.Mesh | null = null;
  private ownGeo = false; private ownG: THREE.BufferGeometry | null = null;
  /** 0..1: a city bus kneels at the kerb (body lowered and leaning to the pavement) */
  kneel = 0;
  /** Visual body spring state (roll/pitch/heave) and class-tuned parameters (D3). */
  readonly bodySpring: BodySpringState = { roll: 0, rollV: 0, pitch: 0, pitchV: 0, heave: 0, heaveV: 0 };
  readonly bodySpringP: BodySpringParams;
  private smoothLon = 0; private smoothLat = 0;
  private baseDirt = 0;
  private lastVel = new THREE.Vector3();
  private brokenMask = 0;
  private trackL = 0; private trackR = 0;
  /** True when a dead NPC driver is slumped on the wheel (D5: continuous stuck horn until destroyed or entered). */
  hornStuck = false;
  hornStuckT = 0;
  /** Cadence timer for metallic wall-scrape grind audio (D1). */
  scrapeAudioT = 0;
  /** Live estimated gear ('R'|'N'|'1'..'6') and normalized engine RPM (0..1) for HUD & exhaust pops. */
  gear = 'N';
  gearNum = 0;
  rpm = 0.16;
  private prevThrottle = 0;
  private backfireCool = 0;
  /** Set true on frames where a performance car triggers an upshift or throttle-lift exhaust backfire pop. */
  backfireTriggered = false;

  constructor(physics: Physics, public kind: VehicleKind, _tpl: unknown, x: number, y: number, z: number, yaw: number, _atlas: unknown = null, paintIndex = -1) {
    this.spec = VEHICLES[kind];
    this.bodySpringP = bodySpringParams(this.spec.cls, kind);
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
      this.beam = new THREE.Mesh(new THREE.PlaneGeometry(3.8, 8.6).rotateX(-Math.PI / 2).translate(0, GROUND + 0.04, t.front + 4.1), new THREE.MeshBasicMaterial({ map: beamTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0, toneMapped: false }));
      this.beam.renderOrder = 2; this.visual.add(this.beam);
    }
    if (underShadowTex) {
      const len = Math.max(3.2, (t.front - t.rear) * 1.12);
      const wid = Math.max(1.8, s.W * 1.24);
      const cz = (t.front + t.rear) * 0.5;
      const sm = new THREE.MeshBasicMaterial({ map: underShadowTex, transparent: true, depthWrite: false, opacity: 0.72, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
      this.underShadow = new THREE.Mesh(new THREE.PlaneGeometry(wid, len).rotateX(-Math.PI / 2).translate(0, GROUND + 0.028, cz), sm);
      this.underShadow.renderOrder = 0;
      this.group.add(this.underShadow);
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
  /** Shatters the windshield (and front side windows on extreme hits) for severe head-on crashes (D5). */
  shatterFrontGlass(includeSides = false): number {
    let broke = 0;
    for (const p of this.panes) {
      if (p.broken) continue;
      if (p.name === 'windshield' || (includeSides && (p.name === 'front-left' || p.name === 'front-right'))) {
        if (this.breakGlass(p.id)) broke++;
      }
    }
    return broke;
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
    this.glassPrepare();
    return this.glassAtPrepared(worldPoint, tol, includeBroken);
  }
  private paneInv: THREE.Matrix4[] = [];
  /**
   * Caches every pane's inverse bone matrix for a burst of glassAtPrepared() queries (the aim trace marches 50+ points along
   * a ray: it used to refresh the whole car's matrices and invert a matrix per pane at every point). Call again next frame.
   */
  glassPrepare(): void {
    this.group.updateMatrixWorld();
    const ps = this.tpl.panes;
    for (let i = 0; i < ps.length; i++) (this.paneInv[i] ??= new THREE.Matrix4()).copy(this.boneMatrix(ps[i].bone, _m)).invert();
  }
  /** glassAt() against the matrices cached by the last glassPrepare(). Same result, no allocation, and a cheap box reject per pane. */
  glassAtPrepared(worldPoint: THREE.Vector3, tol = 0.12, includeBroken = false): number | null {
    let best: number | null = null, bd = tol;
    const ps = this.tpl.panes;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      if (!includeBroken && this.isGlassBroken(p.id)) continue;
      const lp = _v.copy(worldPoint).applyMatrix4(this.paneInv[i]);
      const bb = paneBounds(p);
      if (lp.x < bb[0] - bd || lp.x > bb[3] + bd || lp.y < bb[1] - bd || lp.y > bb[4] + bd || lp.z < bb[2] - bd || lp.z > bb[5] + bd) continue; // farther than bd from every triangle
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
    const ph = this.phys, a = Math.max(0, Math.min(1, Vehicle.renderAlpha));
    ph.refreshPose(); const p = ph.cPos, q = ph.cQuat;
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
  updateLod(dist: number, fovDeg = 62) { this.setLod(pickLod(dist, this.lod, { fovDeg, size: this.size, midMax: this.ownGeo ? 40 : LOD_MID })); }
  update(dt: number, night: number, time: number, braking: boolean) {
    this.syncTransform();
    const t = this.tpl, c = this.phys.ctrl, spec = this.spec;
    // far cars (lod 2, > ~65 m): wheels animate every other frame and idle doors are not stepped (nothing there is visible)
    const farCar = this.lod === 2 && !this.driver?.isPlayer;
    const skipWheels = farCar && ((this.lodTick = (this.lodTick + 1) & 1) === 1);
    if (!skipWheels) {
      const wb = t.wheelBones, wl = t.layout.wheels;
      for (let i = 0; i < wb.length; i++) {
        const wd = wl[i];
        if (!wd) continue;
        const w = this.bones[wb[i]];
        const sl = c.wheelSuspensionLength(i) ?? spec.suspRest;
        w.position.y = wd.y + spec.suspRest * 0.8 - sl;
        w.rotation.set(0, 0, 0);
        w.rotateY(c.wheelSteering(i) ?? 0);
        w.rotateX(this.phys.wheelRot[i]);
      }
    }
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
        if (farCar && d.amount === 0 && d.vel === 0 && d.open === 0 && !d.hanging && !d.jam && !this.destroyed) continue;
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
      // Body roll / pitch / heave from acceleration: class-differentiated sprung body weight (D3).
      this.lastVel.set(v.x, v.y, v.z);
      const aFilt = Math.min(1, dt * 18);
      this.smoothLon += (lon - this.smoothLon) * aFilt;
      this.smoothLat += (lat - this.smoothLat) * aFilt;
      stepBodySpring(this.bodySpring, this.smoothLon, this.smoothLat, ay, this.phys.grounded, this.kneel, this.bodySpringP, dt);
      this.visual.rotation.set(this.bodySpring.pitch, 0, this.bodySpring.roll);
      this.visual.position.y = this.bodySpring.heave;
    }
    // Lights: lenses glow (bloom does the halo); brake lights flare, night tail lights glow softly.
    const u = this.material.userData.u;
    const occupied = !!this.driver || this.persistent;
    const on = (this.headlights || night > 0.35) && !this.destroyed && !this.lightsBroken && occupied;
    this.headOn = on;
    u.uHead.value = on ? HEAD_LENS : 0;
    if (this.beam) { (this.beam.material as THREE.MeshBasicMaterial).opacity = on ? BEAM_OPACITY * night : 0; this.beam.visible = on && night > 0.05; }
    if (this.underShadow) {
      const upY = 1 - 2 * (this.group.quaternion.x * this.group.quaternion.x + this.group.quaternion.z * this.group.quaternion.z);
      const showShadow = underShadowShown(this.phys.grounded, upY, this.lod);
      this.underShadow.visible = showShadow;
      if (showShadow) (this.underShadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.lerp(0.76, 0.42, night);
    }
    // Gear, RPM and performance exhaust backfire trigger on upshift / fast throttle lift
    const prevGear = this.gearNum;
    const gr = vehicleGearRpm(this.speed, spec.topSpeed, this.input.throttle);
    this.gear = gr.gear; this.gearNum = gr.gearNum; this.rpm = gr.rpm;
    this.backfireCool = Math.max(0, this.backfireCool - dt);
    this.backfireTriggered = false;
    if (occupied && !this.destroyed && PERF_CLASSES.has(spec.cls) && this.backfireCool <= 0 && this.speed > 12) {
      const upshift = prevGear >= 2 && this.gearNum > prevGear && this.input.throttle > 0.5;
      const liftPop = this.prevThrottle > 0.65 && this.input.throttle < 0.15 && this.rpm > 0.62;
      if (upshift || liftPop) { this.backfireTriggered = true; this.backfireCool = 0.85; }
    }
    this.prevThrottle = this.input.throttle;
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
      this.health = 0; this.destroyed = true; this.burnTime = 0.001; this.siren = false; this.sirenTone = 0; this.lightBar = false; this.hornStuck = false;
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

const _ta = new THREE.Vector3(), _tb = new THREE.Vector3(), _tc = new THREE.Vector3(), _tq = new THREE.Vector3(), _tri = new THREE.Triangle();
/** Distance from p to the nearest triangle in a flat position list (no allocation). */
function distToTris(p: THREE.Vector3, tris: Float32Array): number {
  let best = Infinity;
  for (let i = 0; i < tris.length; i += 9) {
    _ta.fromArray(tris, i); _tb.fromArray(tris, i + 3); _tc.fromArray(tris, i + 6);
    _tri.set(_ta, _tb, _tc); _tri.closestPointToPoint(p, _tq);
    const d = _tq.distanceTo(p); if (d < best) best = d;
  }
  return best;
}
const _paneBb = new WeakMap<Float32Array, number[]>();
/** [minX, minY, minZ, maxX, maxY, maxZ] of a pane's triangles (cached per template). */
function paneBounds(p: { tris: Float32Array }): number[] {
  let b = _paneBb.get(p.tris);
  if (!b) {
    b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = 0; i < p.tris.length; i += 3) for (let k = 0; k < 3; k++) { const v = p.tris[i + k]; if (v < b[k]) b[k] = v; if (v > b[k + 3]) b[k + 3] = v; }
    _paneBb.set(p.tris, b);
  }
  return b;
}
void _q;

/** Heading (yaw, atan2 of the forward +Z axis) of a rotation. Pure. */
export function yawOfQuat(q: { x: number; y: number; z: number; w: number }): number { return Math.atan2(2 * (q.x * q.z + q.w * q.y), 1 - 2 * (q.x * q.x + q.y * q.y)); }

/** The soft contact shadow under a car: grounded, upright, and not a far car (lod 2, ~65 m+: one draw call per car for a
 * patch too small to see; 27 Nov busy-corner budget). Pure: tests. */
export function underShadowShown(grounded: boolean, upY: number, lod: number): boolean {
  return grounded && upY > 0.6 && lod < 2;
}
