/**
 * People built on the CC0 Quaternius Universal Base Characters (realistic male/female bodies with modelled faces)
 * animated with the Universal Animation Library, retargeted per body. Each person is two skinned meshes sharing one
 * skeleton and one material: the shared body (skin tinted, clothes painted in the shader) and cached extras
 * (hair, beard, hat, hood, collar, skirt).
 *
 * Animation runs in two layers (lower/upper body) with phase-synced locomotion so feet do not slide, plus a
 * procedural pose layer used by actions (see actions.ts): `playAction(name, opts)` plays any UAL clip or built-in
 * action (punches with a 'strike' event, knockdown/get-up, cower, hands up, handcuffed, open door, enter/exit car,
 * pulled out, smash window, hotwire, ...).
 */
import { bodyLodFor, personExtrasLod, BODY_LOD_TRIS } from './animLod';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadHumanAssets, extrasGeometries, type HumanAssets, type BodyBase } from './humanAssets';
import { personMaterial, hairMaterialFor, applyLookUniforms, type PersonUniforms } from './humanMaterial';
import { ACTIONS, BONE_OF, BONE_ORDER, samplePose, type ActionDef, type BoneKey, type Euler } from './actions';
import { resolveLook, type Look, type FullLook } from './look';

export { randomLook, resolveLook, PLAYER_DEFAULT_LOOK, SKIN_TONES } from './look';
export type { Look, FullLook, HairStyle, HatStyle, TopStyle, BottomStyle, ShoeStyle, FacialHair, Sex } from './look';
export { ACTIONS, UAL_CLIPS } from './actions';

const LOW_BODY = new Map<string, THREE.BufferGeometry>(), BODY_IDS = new WeakMap<THREE.BufferGeometry, number>(); let bodyIdN = 0;
/**
 * Per-vertex cluster-size factor from the thickness of the vertex's main bone: limbs (forearms, shins) cluster finer than the
 * torso, so they keep their shape instead of collapsing and leaving hands and shoes floating (R6-V). Small bones (fingers,
 * toes) stay at 1: they merge into the hand / foot.
 */
export function boneCellScale(g: THREE.BufferGeometry): Float32Array {
  const n = g.attributes.position.count, out = new Float32Array(n).fill(1), SI = g.attributes.skinIndex as THREE.BufferAttribute | undefined;
  if (!SI) return out;
  const P = g.attributes.position as THREE.BufferAttribute, box = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const b = SI.getX(i); let e = box.get(b);
    if (!e) { e = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; box.set(b, e); }
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i);
    e[0] = Math.min(e[0], x); e[1] = Math.min(e[1], y); e[2] = Math.min(e[2], z); e[3] = Math.max(e[3], x); e[4] = Math.max(e[4], y); e[5] = Math.max(e[5], z);
  }
  const f = new Map<number, number>();
  for (const [b, e] of box) {
    const ext = [e[3] - e[0], e[4] - e[1], e[5] - e[2]].sort((a, c) => a - c);
    f.set(b, ext[2] < 0.12 ? 1 : Math.max(0.35, Math.min(1, ext[0] / 0.24)));
  }
  for (let i = 0; i < n; i++) out[i] = f.get(SI.getX(i)) ?? 1;
  return out;
}

/** Vertex-clustering decimation of a (non-indexed or indexed) skinned body: position/normal/uv are averaged, all other attributes keep the first vertex and split clusters. */
export function lowBody(src: THREE.BufferGeometry, target: number): THREE.BufferGeometry {
  if (!BODY_IDS.has(src)) BODY_IDS.set(src, ++bodyIdN);
  const ck = `${BODY_IDS.get(src)}:${target}`, hit = LOW_BODY.get(ck); if (hit) return hit;
  const g = src.index ? src.toNonIndexed() : src, n = g.attributes.position.count, names = Object.keys(g.attributes);
  const others = ['skinIndex', 'region'].filter(k => g.attributes[k]); // discrete: clusters never mix bones / garment regions
  const avg = names.filter(k => !others.includes(k) && k !== 'skinWeight');
  const P = g.attributes.position as THREE.BufferAttribute, scale = boneCellScale(g);
  const run = (cell0: number) => {
    const key: string[] = new Array(n), cl = new Map<string, { first: number; c: number; sum: Record<string, number[]> }>();
    for (let i = 0; i < n; i++) {
      const cell = cell0 * scale[i];
      let k = `${Math.floor(P.getX(i) / cell)},${Math.floor(P.getY(i) / cell)},${Math.floor(P.getZ(i) / cell)}`;
      for (const o of others) { const a = g.attributes[o] as THREE.BufferAttribute; for (let j = 0; j < a.itemSize; j++) k += ',' + a.array[i * a.itemSize + j]; }
      key[i] = k; let c = cl.get(k);
      if (!c) { c = { first: i, c: 0, sum: {} }; for (const a of avg) c.sum[a] = new Array((g.attributes[a] as THREE.BufferAttribute).itemSize).fill(0); cl.set(k, c); }
      c.c++; for (const a of avg) { const at = g.attributes[a] as THREE.BufferAttribute; for (let j = 0; j < at.itemSize; j++) c.sum[a][j] += at.array[i * at.itemSize + j]; }
    }
    const keep: number[] = [];
    for (let t = 0; t < n; t += 3) if (key[t] !== key[t + 1] && key[t + 1] !== key[t + 2] && key[t] !== key[t + 2]) keep.push(t, t + 1, t + 2);
    return { key, cl, keep };
  };
  let lo = 0.02, hi = 1.5, best = run(hi);
  for (let i = 0; i < 7; i++) { const mid = Math.sqrt(lo * hi), r = run(mid); if (r.keep.length / 3 > target) lo = mid; else { hi = mid; best = r; } }
  const out = new THREE.BufferGeometry(), m = best.keep.length;
  for (const name of names) {
    const a = g.attributes[name] as THREE.BufferAttribute, arr = new (a.array.constructor as new (n: number) => Float32Array)(m * a.itemSize);
    for (let v = 0; v < m; v++) {
      const c = best.cl.get(best.key[best.keep[v]])!;
      if (avg.includes(name)) for (let j = 0; j < a.itemSize; j++) arr[v * a.itemSize + j] = c.sum[name][j] / c.c;
      else for (let j = 0; j < a.itemSize; j++) arr[v * a.itemSize + j] = a.array[c.first * a.itemSize + j];
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
  }
  if (out.attributes.normal) { const nr = out.attributes.normal as THREE.BufferAttribute; for (let i = 0; i < nr.count; i++) { const l = Math.hypot(nr.getX(i), nr.getY(i), nr.getZ(i)) || 1; nr.setXYZ(i, nr.getX(i) / l, nr.getY(i) / l, nr.getZ(i) / l); } }
  out.boundingSphere = src.boundingSphere?.clone() ?? null; out.boundingBox = src.boundingBox?.clone() ?? null;
  LOW_BODY.set(ck, out); return out;
}

export interface HumanTemplate { assets: HumanAssets }

/** Loads the body assets and retargets the animation library (call once at start-up). */
export async function loadHumanTemplate(ual: GLTF, base = import.meta.env.BASE_URL + 'assets/ubc/'): Promise<HumanTemplate> {
  return { assets: await loadHumanAssets(ual, base) };
}

type UpperMode = 'loco' | 'pistol' | 'rifle' | 'carry' | 'none';
interface Slot { action: THREE.AnimationAction; weight: number; target: number }
export interface ActionOpts {
  layer?: 'full' | 'upper'; fade?: number; from?: number; to?: number; rate?: number; weight?: number;
  soft?: boolean; loop?: boolean; hold?: boolean; reverse?: boolean;
  /** Called for each named event in the action (e.g. 'strike'). */
  onEvent?: (name: string) => void;
  onDone?: () => void;
}
interface Active {
  name: string; def: ActionDef; clip: string | null; layer: 'full' | 'upper'; t: number; dur: number; fade: number; weight: number;
  soft: boolean; hold: boolean; loop: boolean; ending: boolean; evI: number; onEvent?: (n: string) => void; onDone?: () => void; cycle: number;
}

const LOCO = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'];
const DEG = Math.PI / 180;
const _e = new THREE.Euler(), _r = new THREE.Quaternion(), _p = new THREE.Quaternion(), _t = new THREE.Quaternion();
const _chain: THREE.Object3D[] = [];

/** One animated person. */
/** wrist-to-palm-centre distance along the hand bone (m, before bone scale) */
const GRIP_PALM = 0.062;
const _ft = new THREE.Vector3();
const _gt = new THREE.Vector3(), _gz = new THREE.Vector3(0, 0, 1), _gq = new THREE.Quaternion();
const _ia = new THREE.Vector3(), _ib = new THREE.Vector3(), _ic = new THREE.Vector3(), _iu = new THREE.Vector3(), _iv = new THREE.Vector3(), _ia2 = new THREE.Vector3();
const _iq1 = new THREE.Quaternion(), _iq2 = new THREE.Quaternion(), _iqw = new THREE.Quaternion(), _sqA = new THREE.Quaternion(), _sqB = new THREE.Quaternion(), _sqN = new THREE.Quaternion();
const _dp = new THREE.Vector3(), _ds = new THREE.Vector3(), _dq = new THREE.Quaternion(); // matrixWorld decompose scratch (IK)
/**
 * Applies a world-space rotation to a bone's local quaternion (its and its parent's world matrices must be current) and refreshes the bone
 * plus the IK chain below it (`chain`, parent first). Not the whole subtree: the fingers hang off the hand and nothing reads them until the
 * renderer's own matrix pass (Round 12 fight perf: a recursive refresh walked ~20 bones per arm per solve). updateWorldMatrix(false, false) is used because updateMatrixWorld(false) still recurses into every child.
 */
function rotBone(bone: THREE.Object3D, q: THREE.Quaternion, chain?: THREE.Object3D, chain2?: THREE.Object3D) {
  bone.parent!.matrixWorld.decompose(_dp, _iq1, _ds); bone.matrixWorld.decompose(_dp, _iq2, _ds);
  bone.quaternion.copy(_iq1.invert().multiply(_iq2.premultiply(q))); bone.updateWorldMatrix(false, false);
  if (chain) { chain.updateWorldMatrix(false, false); if (chain2) chain2.updateWorldMatrix(false, false); }
}
/** Round 11: culling sphere for a person's skinned meshes (body space, metres; bind-pose sphere r 1.08 m at hip height). */
export const PERSON_SPHERE = new THREE.Sphere(new THREE.Vector3(0, 0.9, 0), 2.2);
/** Beyond this distance (m) a person's hair and beard use the two-layer solid LOD (strands are sub-pixel there anyway). */
const HAIR_LOD_DIST = 34;
/**
 * Round 7 perf: builds (and caches) the hair / hat / garment extras a look needs, ahead of the person turning real, so the
 * first close-up of a style never builds geometry mid-drive (100 ms - 1 s hitches). Returns the build time in ms.
 */
export function warmLookExtras(tpl: HumanTemplate, look: Look): number {
  const t0 = performance.now(), L = resolveLook(look);
  extrasGeometries(tpl.assets.bodies[L.sex], tpl.assets, L);
  return performance.now() - t0;
}
/** Round 7 perf: the mid / far body LODs (decimated once per sex, ~0.6 s each) are built at load, not on first sight. */
export function warmBodies(tpl: HumanTemplate) { for (const b of Object.values(tpl.assets.bodies)) for (const n of [3000, 1200, 600]) lowBody(b.geo, n); }
export class Human {
  root = new THREE.Group();
  model: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  extras: THREE.SkinnedMesh[] = [];
  mixer: THREE.AnimationMixer;
  material: THREE.MeshStandardMaterial;
  rightHand: THREE.Object3D;
  leftHand: THREE.Object3D;
  head: THREE.Object3D;
  spine: THREE.Object3D;
  look: FullLook;
  readonly base: BodyBase;
  private lower = new Map<string, Slot>();
  private upper = new Map<string, Slot>();
  private readonly layers: [Map<string, Slot>, Map<string, Slot>] = [this.lower, this.upper];
  private bones = new Map<BoneKey, THREE.Object3D>();
  private phase = 0;
  private locoWeights = [0, 0, 0, 0];
  private state = 'loco';
  private upperMode: UpperMode = 'loco';
  private act: Active | null = null;
  private poseTmp = new Map<BoneKey, Euler>();
  aimPitch = 0;
  /** World-space hand targets (two-bone IK, applied last each update): used to grab and haul people. */
  readonly reach: { L: THREE.Vector3 | null; R: THREE.Vector3 | null; w: number } = { L: null, R: null, w: 0 };
  speed = 0;
  /** Yaw rate (rad/s) fed by the character; drives turn-in-place stepping. */
  turnRate = 0;
  /** 0..1 how much of a running leap the jump pose is (set by the controller while airborne). */
  airMove = 0;
  scale: number;
  private flashT = 0;
  private stateTime = 0;
  private deathRate = 1;
  /** Clip held while dead (Death01 unless a death style picked another base) and the lock that stops stray actions standing a corpse up. */
  private deathClip = 'Death01'; private deathLock = false;
  private fingers: { bone: THREE.Object3D; rest: THREE.Quaternion }[] = [];
  private relax = 1;
  /** Organic life & gaze targets (rad, relative to body forward; driven by NPC brain or player). */
  private lifePhase = Math.random() * Math.PI * 2;
  lookYaw = 0;
  lookPitch = 0;
  private curLookYaw = 0;
  private curLookPitch = 0;
  private curLean = 0;
  private recoil = 0;
  private lifePose: Record<'spine' | 'chest' | 'neck' | 'head' | 'armR' | 'armL', Euler> = {
    spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0], armR: [0, 0, 0], armL: [0, 0, 0],
  };
  /** Adds a short procedural shoulder/chest recoil impulse on gunfire. */
  kickRecoil(amount = 0.85) { this.recoil = Math.min(1.4, this.recoil + amount); }

  constructor(private tpl: HumanTemplate, look: Look) {
    this.look = resolveLook(look);
    const A = tpl.assets;
    this.base = A.bodies[this.look.sex];
    const base = this.base;
    this.model = SkeletonUtils.clone(base.scene);
    const meshes: THREE.SkinnedMesh[] = [];
    this.model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    meshes.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count);
    this.mesh = meshes[0];
    for (let i = 1; i < meshes.length; i++) meshes[i].removeFromParent();
    this.mesh.geometry = base.geo;
    // The base bodies are athletes: slimmer limbs and narrower shoulders read as everyday people (bone scale/offset
    // is never animated: retargeted clips only carry rotations and the hip translation).
    const m = this.look.sex === 'm';
    const muscle = THREE.MathUtils.clamp(this.look.build - 1, -0.1, 0.12);
    for (const s of ['L', 'R']) {
      const arm = this.model.getObjectByName('DEF-upper_arm' + s), thigh = this.model.getObjectByName('DEF-thigh' + s);
      const at = (m ? 0.86 : 0.93) + muscle * 0.6, tt = (m ? 0.95 : 1.0) + muscle * 0.4 + this.look.weight * 0.05;
      if (arm) { arm.scale.set(at, 1, at); if (m) arm.position.multiplyScalar(0.9); }
      if (thigh) thigh.scale.set(tt, 1, tt);
    }
    this.material = personMaterial(base, A.map, A.normalMap);
    this.mesh.material = this.material;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    // Round 11 perf: people are culled off screen again (every one was drawn and skinned in both the main and the shadow
    // pass, behind the camera too). A generous fixed sphere in body space covers any pose, a ragdoll included.
    this.mesh.boundingSphere = PERSON_SPHERE.clone(); this.mesh.frustumCulled = true;
    this.buildExtras();
    applyLookUniforms(this.material, base, this.look);
    this.scale = this.look.height * (1.78 / base.height);
    this.applyScale();
    this.root.add(this.model);
    this.rightHand = this.model.getObjectByName('DEF-handR')!;
    this.leftHand = this.model.getObjectByName('DEF-handL')!;
    this.head = this.model.getObjectByName('DEF-head')!;
    this.spine = this.model.getObjectByName('DEF-spine003')!;
    for (const k of BONE_ORDER) { const b = this.model.getObjectByName(BONE_OF[k]); if (b) this.bones.set(k, b); }
    this.model.traverse(o => { if (/^DEF-(f_|thumb)/.test(o.name)) this.fingers.push({ bone: o, rest: o.quaternion.clone() }); });
    this.mixer = new THREE.AnimationMixer(this.model);
    for (const n of LOCO) { const l = this.slot(this.lower, n), u = this.slot(this.upper, n); l.action.timeScale = 0; u.action.timeScale = 0; }
    this.lower.get('Idle_Loop')!.weight = 1; this.upper.get('Idle_Loop')!.weight = 1;
    this.phase = Math.random();
    this.update(0);
  }
  private applyScale() {
    const s = this.scale, b = this.look.build;
    this.model.scale.set(s * b, s, s * (0.55 + b * 0.45));
  }
  private buildExtras() {
    for (const e of this.extras) e.removeFromParent();
    this.extras = [];
    for (const g of extrasGeometries(this.base, this.tpl.assets, this.look)) {
      const kind = g.userData.kind as string, hair = kind === 'hair' || kind === 'hairFar';
      const ex = new THREE.SkinnedMesh(g, hair || kind === 'scan' ? hairMaterialFor(this.material) : this.material);
      ex.bind(this.mesh.skeleton, this.mesh.bindMatrix);
      ex.boundingSphere = PERSON_SPHERE.clone(); ex.boundingBox = g.boundingBox!.clone(); // CPU vertices are freed after upload
      ex.receiveShadow = true; ex.frustumCulled = true; // Round 11: culled with the body
      // hair shells never cast shadows (many alpha-tested layers); callers toggle castShadow on all extras, so pin it
      if (hair) Object.defineProperty(ex, 'castShadow', { get: () => false, set: () => { /* pinned */ } });
      else ex.castShadow = true;
      ex.userData.lod = kind; // 'hair': near only; 'hairFar': far only (two solid layers); 'scan' / 'misc': always
      this.mesh.parent!.add(ex);
      this.extras.push(ex);
    }
    this.lodFar = false; this.lodT = 0; this.extrasLod = 0; this.showExtras();
  }
  /** Camera position used to swap hair shells for their cheap LOD beyond HAIR_LOD_DIST (set once by the game). */
  static lodFrom: THREE.Vector3 | null = null;
  private lodFar = false; private lodT = 0; private detail = true; private lodDriven = false; private extrasLod: 0 | 1 | 2 = 0;
  private showExtras() {
    for (const e of this.extras) { const k = e.userData.lod; e.visible = this.detail && (k === 'hair' ? !this.lodFar : k === 'hairFar' ? this.lodFar : true); }
  }
  /** Drives body LOD, extras LOD and hair swap from camera distance (scaled so nearby street people keep full meshes & 3D hair). */
  setLodDistance(dist: number, inView: boolean) {
    this.lodDriven = true;
    this.setBodyLod(bodyLodFor(dist * 0.48, this.bodyLod));
    const x = personExtrasLod(dist, inView, this.extrasLod);
    if (x === this.extrasLod) return; this.extrasLod = x;
    this.detail = x < 2; this.lodFar = x === 1; this.showExtras();
  }
  private updateHairLod(dt: number) {
    if (!Human.lodFrom || this.lodDriven) return;
    this.lodT -= dt; if (this.lodT > 0) return; this.lodT = 0.3 + Math.random() * 0.2;
    const far = this.root.position.distanceToSquared(Human.lodFrom) > HAIR_LOD_DIST * HAIR_LOD_DIST;
    if (far === this.lodFar) return; this.lodFar = far; this.showExtras();
  }
  /** Re-dresses this person (sex changes are not supported in place: create a new Human for that). */
  applyLook(look: Look) {
    const l = resolveLook({ ...look, sex: this.look.sex });
    const rebuild = l.hairStyle !== this.look.hairStyle || l.hair !== this.look.hair || l.facial !== this.look.facial || l.hatStyle !== this.look.hatStyle || l.topStyle !== this.look.topStyle || l.bottomStyle !== this.look.bottomStyle;
    this.look = l;
    if (rebuild) this.buildExtras();
    applyLookUniforms(this.material, this.base, l);
    this.scale = l.height * (1.78 / this.base.height); this.applyScale();
  }
  get sex() { return this.look.sex; }
  /** Names of every playable action: built-ins plus all UAL clips. */
  static actionNames(tpl: HumanTemplate) { return [...Object.keys(ACTIONS), ...tpl.assets.ualClipNames]; }

  private slot(layer: Map<string, Slot>, name: string): Slot {
    let s = layer.get(name);
    if (s) return s;
    const src = layer === this.lower ? this.base.lower : this.base.upper;
    const clip = src.get(name); if (!clip) throw new Error(`missing clip ${name}`);
    const a = this.mixer.clipAction(clip);
    const loop = name.endsWith('_Loop') || name === 'Sword_Idle';
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.enabled = true; a.setEffectiveWeight(0); a.play();
    s = { action: a, weight: 0, target: 0 };
    layer.set(name, s);
    return s;
  }
  /** Stride-synced locomotion cycle 0..1 (left foot plants near 0.08, right near 0.58). */
  get locoPhase() { return this.phase; }
  /** Locomotion speed in m/s (world). */
  setSpeed(v: number) { this.speed = v; }
  /** Full-body state: loco, jump, drive, swim, sit, dead, crouch, cower, talk, dance */
  setState(s: string) {
    if (s === this.state) return;
    this.state = s; this.stateTime = 0; this.deathLock = false;
    if (s === 'dead') { this.deathRate = 0.95 + Math.random() * 0.35; this.deathClip = 'Death01'; this.playAction('Death01', { layer: 'full', fade: 0.1, rate: this.deathRate, hold: true }); this.deathLock = true; }
  }
  /** Re-plays the death with another base clip / speed (call right after setState('dead')). */
  setDeathClip(clip: string, rate = 1, from = 0) {
    if (this.state !== 'dead') return;
    this.deathLock = false; this.deathClip = clip; this.deathRate = rate;
    this.playAction(clip, { layer: 'full', fade: 0.08, rate, from, hold: true, loop: false }); this.deathLock = true;
  }
  get dead() { return this.state === 'dead'; }
  get currentState() { return this.state; }
  setUpperMode(m: UpperMode) { this.upperMode = m; }

  /**
   * Plays a built-in action (see ACTIONS) or any UAL clip by name. Options override the action's defaults:
   * layer ('upper' keeps the legs walking), fade, from/to (s, clip time), rate, weight (< 1 blends over the current
   * pose), soft (never busy), loop, hold (stay until stopAction), reverse, onEvent (named events such as 'strike'),
   * onDone. Returns the action's duration in seconds (Infinity for held/looping actions).
   */
  playAction(name: string, opts: ActionOpts = {}): number {
    if (this.deathLock) return 0; // a corpse stays down: nothing may stand it back up
    const def: ActionDef = ACTIONS[name] ?? { clip: name, layer: opts.layer ?? 'full' };
    const clipName = def.clip ?? null;
    const layer = opts.layer ?? def.layer;
    const rate = opts.rate ?? def.rate ?? 1;
    const reverse = opts.reverse ?? def.reverse ?? false;
    const loop = opts.loop ?? def.loop ?? false, hold = opts.hold ?? def.hold ?? false;
    let span = def.dur ?? 1;
    if (clipName) {
      const clip = this.base.clips.get(clipName); if (!clip) throw new Error(`unknown action ${name}`);
      const from = Math.max(0, Math.min(clip.duration, opts.from ?? def.from ?? 0)), to = Math.max(from, Math.min(clip.duration, opts.to ?? def.to ?? clip.duration));
      span = def.dur ?? (to - from) / rate;
      for (const l of layer === 'full' ? [this.lower, this.upper] : [this.upper]) {
        const s = this.slot(l, clipName);
        s.action.reset();
        s.action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); s.action.clampWhenFinished = !loop;
        s.action.timeScale = reverse ? -rate : rate; s.action.time = reverse ? to : from; s.action.play();
      }
    }
    const fade = Math.min(opts.fade ?? def.fade ?? 0.1, span * 0.5);
    this.act = {
      name, def, clip: clipName, layer, t: 0, dur: loop || hold ? Infinity : span, fade, weight: Math.max(0, Math.min(1, opts.weight ?? 1)),
      soft: opts.soft ?? def.soft ?? false, hold, loop, ending: false, evI: 0, onEvent: opts.onEvent, onDone: opts.onDone, cycle: span,
    };
    return this.act.dur;
  }
  /** Ends the current action (or only `name`) with a short blend. */
  stopAction(name?: string) {
    const a = this.act; if (!a || (name && a.name !== name)) return;
    a.dur = Math.min(a.dur, a.t + a.fade); a.ending = true;
  }
  /** Name of the playing action (null when none). */
  get actionName() { return this.act && !this.act.ending ? this.act.name : null; }
  /** Normalised progress 0..1 of the playing action (0 for held/looping ones). */
  get actionProgress() { const a = this.act; return a && Number.isFinite(a.dur) ? Math.min(1, a.t / a.dur) : 0; }

  /** Compatibility wrapper: plays a clip as a one-shot over the given layer(s). */
  playOnce(name: string, layer: 'upper' | 'full', fade = 0.1, opts: { from?: number; to?: number; rate?: number; weight?: number; soft?: boolean } = {}) {
    this.playAction(name, { layer, fade, ...opts, loop: false, hold: false });
  }
  /** Name of the playing one-shot (null when none). */
  get oneShotName() { return this.act ? this.act.name : null; }
  /** Ends the current one-shot early with a short blend. */
  stopOnce(name?: string) { this.stopAction(name); }
  get busy() { const a = this.act; return !!a && !a.soft && !a.ending && a.t < a.dur - a.fade; }
  flash() { this.flashT = 0.12; }

  private addLower(n: string, t = 1) { this.slot(this.lower, n).target += t; }
  private addUpper(n: string, t = 1) { this.slot(this.upper, n).target += t; }

  update(dt: number) {
    this.updateHairLod(dt);
    this.stateTime += dt;
    const base = this.base;
    const sc = this.scale;
    const loco = base.loco;
    const walk = loco[0].speed * sc, jog = loco[1].speed * sc, sprint = loco[2].speed * sc;
    const v = this.speed;
    const w = this.locoWeights; w[0] = 0; w[1] = 0; w[2] = 0; w[3] = 0;
    if (v < 0.15) w[0] = 1;
    else if (v < walk) { const t = v / walk; w[0] = 1 - t; w[1] = t; }
    else if (v < jog) { const t = (v - walk) / (jog - walk); w[1] = 1 - t; w[2] = t; }
    else if (v < sprint) { const t = (v - jog) / (sprint - jog); w[2] = 1 - t; w[3] = t; }
    else w[3] = 1;
    // Turning on the spot: short shuffling steps instead of pivoting on frozen feet.
    const turning = this.state === 'loco' && v < 0.5 ? THREE.MathUtils.clamp((Math.abs(this.turnRate) - 0.7) * 0.25, 0, 0.6) : 0;
    if (turning > 0) { w[1] = Math.max(w[1], turning); w[0] = Math.max(0, 1 - w[1] - w[2] - w[3]); }
    const movingW = w[1] + w[2] + w[3];
    if (this.state === 'jump') this.phase = (this.phase + dt * 0.35) % 1; // a held stride while airborne
    else if (movingW > 0.001) {
      const stride = (w[1] * walk * loco[0].duration + w[2] * jog * loco[1].duration + w[3] * sprint * loco[2].duration) / movingW;
      const travel = Math.max(v, 0.4) + Math.abs(this.turnRate) * 0.25 * turning * 4;
      this.phase = (this.phase + (travel * dt) / stride) % 1;
    } else this.phase = (this.phase + dt / 4) % 1;
    for (let i = 0; i < 4; i++) {
      const n = LOCO[i], dur = i === 0 ? base.clips.get(n)!.duration : loco[i - 1].duration;
      const time = i === 0 ? (this.stateTime % dur) : this.phase * dur;
      this.lower.get(n)!.action.time = time; this.upper.get(n)!.action.time = time;
    }
    for (const s of this.lower.values()) s.target = 0;
    for (const s of this.upper.values()) s.target = 0;
    let fullOverride = false;
    switch (this.state) {
      case 'loco':
        for (let i = 0; i < 4; i++) { const wi = w[i]; if (wi > 0) { const n = LOCO[i]; this.addLower(n, wi); this.addUpper(n, wi); } }
        break;
      case 'jump': {
        const m = THREE.MathUtils.clamp(this.airMove, 0, 1);
        this.addLower('Jump_Loop', 1 - m); if (m > 0) this.addLower('Jog_Fwd_Loop', m);
        this.addUpper('Jump_Loop', 1 - m * 0.5); if (m > 0) this.addUpper('Jog_Fwd_Loop', m * 0.5);
        break;
      }
      case 'drive': this.addLower('Driving_Loop'); this.addUpper('Driving_Loop'); fullOverride = true; break;
      case 'swim': { const f = Math.min(1, v / 1.5); this.addLower('Swim_Idle_Loop', 1 - f); this.addLower('Swim_Fwd_Loop', f); this.addUpper('Swim_Idle_Loop', 1 - f); this.addUpper('Swim_Fwd_Loop', f); fullOverride = true; break; }
      case 'sit': this.addLower('Sitting_Idle_Loop'); this.addUpper('Sitting_Idle_Loop'); break;
      case 'crouch': case 'cower': this.addLower('Crouch_Idle_Loop'); this.addUpper('Crouch_Idle_Loop'); break;
      case 'talk': this.addLower('Idle_Loop'); this.addUpper('Idle_Talking_Loop'); break;
      case 'dance': this.addLower('Dance_Loop'); this.addUpper('Dance_Loop'); fullOverride = true; break;
      case 'dead': fullOverride = true; break;
    }
    if (!fullOverride && this.state !== 'cower') {
      if (this.upperMode === 'pistol' || this.upperMode === 'rifle') {
        for (const s of this.upper.values()) s.target = 0;
        const p = THREE.MathUtils.clamp(this.aimPitch / 0.9, -1, 1);
        if (p >= 0) { this.addUpper('Pistol_Aim_Neutral', 1 - p); this.addUpper('Pistol_Aim_Up', p); } else { this.addUpper('Pistol_Aim_Neutral', 1 + p); this.addUpper('Pistol_Aim_Down', -p); }
      } else if (this.upperMode === 'carry') { for (const s of this.upper.values()) s.target = 0; this.addUpper('Pistol_Idle_Loop'); }
    }
    // Active action overrides its layer(s).
    let actK = 0;
    const a = this.act;
    if (a) {
      a.t += dt;
      const fadeIn = Math.min(1, a.t / Math.max(1e-3, a.fade));
      const fadeOut = Number.isFinite(a.dur) ? Math.min(1, Math.max(0, (a.dur - a.t) / Math.max(1e-3, a.fade))) : 1;
      actK = Math.min(fadeIn, fadeOut) * a.weight;
      if (a.clip) {
        if (a.layer === 'full') { for (const s of this.lower.values()) s.target *= 1 - actK; this.slot(this.lower, a.clip).target = actK; }
        for (const s of this.upper.values()) s.target *= 1 - actK; this.slot(this.upper, a.clip).target = actK;
      }
      // events at normalised times of the first cycle
      const evs = a.def.events;
      if (evs && a.onEvent) {
        const u = a.t / a.cycle;
        while (a.evI < evs.length && u >= evs[a.evI][0]) { const ev = evs[a.evI++][1]; a.onEvent(ev); }
      }
      if (a.t >= a.dur) { this.act = null; a.onDone?.(); }
    }
    if (this.state === 'dead' && (!this.act || this.act.ending)) {
      for (let li = 0; li < 2; li++) { const l = this.layers[li]; for (const s of l.values()) s.target = 0; this.slot(l, this.deathClip).target = 1; }
    }
    const rate = 1 - Math.exp(-dt * 14);
    for (let li = 0; li < 2; li++) for (const s of this.layers[li].values()) {
      s.weight += (s.target - s.weight) * (dt === 0 ? 1 : rate);
      if (s.weight < 0.001 && s.target === 0) s.weight = 0;
      s.action.setEffectiveWeight(s.weight);
    }
    if (this.flashT > 0) { this.flashT -= dt; (this.material.userData.uniforms as PersonUniforms).uFlash.value = Math.max(0, this.flashT / 0.12) * 0.6; }
    // A held one-shot (death, knockdown) must freeze just before its last key: the library clips end on the standing bind
    // pose, so letting three.js "finish" them snapped corpses back upright a couple of seconds after they fell.
    if (a && a.hold && a.clip && !a.def.reverse) this.holdClip(a.clip, dt);
    if (this.state === 'dead') this.holdClip(this.deathClip, dt);
    this.mixer.update(dt);
    // Relaxed hands (the library's idle/locomotion clips clench fists) unless holding, aiming or fighting.
    const wantRelax = this.upperMode === 'loco' && this.state !== 'drive' && !(a && /punch|Punch|smash|pull/.test(a.name)) ? 0.7 : 0;
    this.relax += (wantRelax - this.relax) * (dt === 0 ? 1 : 1 - Math.exp(-dt * 10));
    if (this.relax > 0.01) for (const f of this.fingers) f.bone.quaternion.slerp(f.rest, this.relax);
    // Procedural pose layer (after the mixer, so it never accumulates).
    if (a && a.def.poses && actK > 0.001) {
      const u = Number.isFinite(a.dur) ? Math.min(1, a.t / a.dur) : (a.loop ? (a.t / a.cycle) % 1 : Math.min(1, a.t / a.cycle));
      this.applyPose(samplePose(a.def.poses, u, this.poseTmp), actK);
    }
    if (this.state === 'cower' && (!this.act || this.act.name !== 'cower')) this.applyPose(samplePose(ACTIONS.cower.poses!, 0, this.poseTmp), Math.min(1, this.stateTime * 4));
    // Organic life layer: subtle breathing, idle weight shift, turning bank, head/neck look-at tracking, and weapon recoil.
    if (this.state !== 'dead' && this.state !== 'drive') {
      const lk = dt === 0 ? 1 : 1 - Math.exp(-dt * 8.5);
      this.curLookYaw += (THREE.MathUtils.clamp(this.lookYaw, -0.95, 0.95) - this.curLookYaw) * lk;
      this.curLookPitch += (THREE.MathUtils.clamp(this.lookPitch, -0.42, 0.42) - this.curLookPitch) * lk;
      const wantLean = this.state === 'loco' ? THREE.MathUtils.clamp(this.turnRate * Math.min(v, 5.5) * 1.45, -8.5, 8.5) : 0;
      this.curLean += (wantLean - this.curLean) * (dt === 0 ? 1 : 1 - Math.exp(-dt * 7));
      this.recoil = dt === 0 ? 0 : this.recoil * Math.exp(-dt * 17);
      const bFreq = v > 3.5 ? 4.2 : v > 0.5 ? 2.4 : 1.45;
      const bAmp = v > 3.5 ? 1.55 : v > 0.5 ? 0.95 : 0.72;
      const breath = Math.sin(this.stateTime * bFreq + this.lifePhase) * bAmp;
      const idleW = this.state === 'loco' && v < 0.25 && this.upperMode === 'loco' && !a ? 1 : 0;
      const idleSway = idleW * Math.sin(this.stateTime * 0.62 + this.lifePhase * 1.7);
      const idleGlance = idleW * Math.sin(this.stateTime * 0.41 + this.lifePhase * 2.3) * 6.5;
      const lookYDeg = this.curLookYaw * (180 / Math.PI) + idleGlance;
      const lookPDeg = -this.curLookPitch * (180 / Math.PI);
      const lp = this.lifePose;
      lp.spine[0] = breath * 0.45; lp.spine[1] = idleSway * 1.6; lp.spine[2] = this.curLean * 0.45 + idleSway * 1.1;
      lp.chest[0] = breath * 0.75 - this.recoil * 6.5; lp.chest[1] = lookYDeg * 0.12 - idleSway * 0.8; lp.chest[2] = this.curLean * 0.55;
      lp.neck[0] = lookPDeg * 0.35 - breath * 0.25; lp.neck[1] = lookYDeg * 0.34; lp.neck[2] = -this.curLean * 0.2;
      lp.head[0] = lookPDeg * 0.65 - breath * 0.15; lp.head[1] = lookYDeg * 0.54; lp.head[2] = -this.curLean * 0.25 + idleSway * 1.2;
      if (this.recoil > 0.015) {
        lp.armR[0] = -this.recoil * 11; lp.armR[1] = 0; lp.armR[2] = this.recoil * 4;
        lp.armL[0] = -this.recoil * 7; lp.armL[1] = 0; lp.armL[2] = -this.recoil * 3;
      } else {
        lp.armR[0] = 0; lp.armR[1] = 0; lp.armR[2] = 0;
        lp.armL[0] = 0; lp.armL[1] = 0; lp.armL[2] = 0;
      }
      this.applyPose(lp, 1);
    }
    if (this.reach.w > 0.001) {
      this.root.updateMatrixWorld(true);
      if (this.reach.L) this.solveArm('L', this.reach.L, this.reach.w);
      if (this.reach.R) this.solveArm('R', this.reach.R, this.reach.w);
    }
    if (this.state === 'drive') this.plantSeatedFeet();
  }
  /**
   * Weapon hold: after update(), puts each hand's palm centre on a world target with a world orientation (two-bone IK
   * on the arm, then the hand bone is turned to `quat`). Hand-local axes: y = fingers, rim (+z) = thumb side.
   * w blends from the animated pose (0) to the full hold (1). Call every frame; the mixer resets the bones next frame.
   */
  gripSolve(side: 'L' | 'R', palm: THREE.Vector3, quat: THREE.Quaternion, w: number, fresh = false) {
    const hand = side === 'L' ? this.leftHand : this.rightHand;
    if (w <= 0.001 || !hand.parent) return;
    if (!fresh) this.root.updateMatrixWorld(true); // `fresh`: the caller just updated the world matrices and has not moved a bone of this arm since (saves a full skeleton pass)
    hand.matrixWorld.decompose(_dp, _dq, _gt); const sc = _gt.y || 1; // (matrixWorld is fresh here: read it directly, getWorldScale would re-walk every ancestor)
    _gt.set(0, GRIP_PALM * sc, 0).applyQuaternion(quat); _gt.negate().add(palm); // wrist target (kept apart from solveArm's scratch vectors)
    this.solveArm(side, _gt, w);
    hand.updateWorldMatrix(false, false);
    hand.parent.matrixWorld.decompose(_dp, _iq1, _ds); _iq1.invert();
    _iq2.copy(_iq1).multiply(quat);
    hand.quaternion.slerp(_iq2, w); hand.updateWorldMatrix(false, false);
    this.curlFingers(side, w);
  }
  /** 0..1: the firing hand's trigger finger curls in only while shooting (otherwise it lies along the frame). */
  trigger = 0;
  private curlSets: Record<'L' | 'R', { bone: THREE.Object3D; rest: THREE.Quaternion; amt: number; trig: boolean; q: THREE.Quaternion }[] | null> = { L: null, R: null };
  private curlKey: Record<'L' | 'R', number> = { L: -1, R: -1 }; private curlTrig = -1;
  /** Static grip curl on the finger bones (absolute from the rest pose, so it never accumulates). */
  private curlFingers(side: 'L' | 'R', w: number) {
    let set = this.curlSets[side];
    if (!set) {
      set = []; const AMT: Record<string, number> = { '1': 0.85, '2': 1.05, '3': 0.8 };
      for (const f of this.fingers) {
        const m = /^DEF-f_(index|middle|ring|pinky)0([123])([LR])$/.exec(f.bone.name);
        if (m && m[3] === side) set.push({ bone: f.bone, rest: f.rest, amt: AMT[m[2]], trig: m[1] === 'index', q: new THREE.Quaternion() });
      }
      this.curlSets[side] = set;
    }
    const sign = side === 'R' ? 1 : -1;
    // the curl is a constant grip pose: the finished quaternions are cached per (weight, trigger) and only copied on the frames in between
    if (this.curlKey[side] !== w || (side === 'R' && this.curlTrig !== this.trigger)) {
      this.curlKey[side] = w; if (side === 'R') this.curlTrig = this.trigger;
      for (const f of set) {
        const a = f.trig && side === 'R' ? 0.1 + 0.6 * this.trigger : f.amt;
        _gq.setFromAxisAngle(_gz, sign * a * w); f.q.copy(f.rest).multiply(_gq);
      }
    }
    for (const f of set) f.bone.quaternion.copy(f.q);
  }
  /** Two-bone IK: bends the forearm to the target distance, then swings the whole arm onto it. */
  private solveArm(side: 'L' | 'R', target: THREE.Vector3, w: number) {
    this.solveChain(this.bones.get(side === 'L' ? 'armL' : 'armR'), this.bones.get(side === 'L' ? 'foreL' : 'foreR'), this.bones.get(side === 'L' ? 'handL' : 'handR'), target, w);
  }
  /** Seated in a car: keeps the soles on the cabin floor (the driving clip hangs the feet below it). Floor height is `parent.userData.floorY` (the vehicle's visual space). */
  private plantSeatedFeet() {
    const par = this.root.parent, fy = par?.userData?.floorY;
    if (typeof fy !== 'number') return;
    par!.updateMatrixWorld(); this.root.updateMatrixWorld(true);
    for (const side of ['L', 'R'] as const) {
      const T = this.bones.get(side === 'L' ? 'thighL' : 'thighR'), K = this.bones.get(side === 'L' ? 'shinL' : 'shinR'), F = this.bones.get(side === 'L' ? 'footL' : 'footR');
      if (!T || !K || !F) continue;
      par!.worldToLocal(F.getWorldPosition(_ft));
      const ankle = fy + 0.06; // ankle joint above the sole
      if (_ft.y >= ankle) continue;
      _ft.y = ankle; par!.localToWorld(_ft);
      this.solveChain(T, K, F, _ft, 1);
    }
  }
  private solveChain(A: THREE.Object3D | undefined, B: THREE.Object3D | undefined, C: THREE.Object3D | undefined, target: THREE.Vector3, w: number) {
    if (!A || !B || !C) return;
    // world matrices are fresh on entry (callers update the skeleton first), so read them directly: getWorldPosition / getWorldQuaternion
    // re-compose every ancestor bone on each call, which made this solve the costliest part of a gun-holding NPC's frame
    const a = _ia.setFromMatrixPosition(A.matrixWorld), b = _ib.setFromMatrixPosition(B.matrixWorld), c = _ic.setFromMatrixPosition(C.matrixWorld);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    if (l1 < 1e-4 || l2 < 1e-4) return;
    const d = THREE.MathUtils.clamp(a.distanceTo(target), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.005);
    const want = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
    _iu.subVectors(a, b).normalize(); _iv.subVectors(c, b).normalize();
    const cur = Math.acos(THREE.MathUtils.clamp(_iu.dot(_iv), -1, 1));
    _ia2.crossVectors(_iu, _iv); if (_ia2.lengthSq() < 1e-8) _ia2.set(1, 0, 0).applyQuaternion(this.root.quaternion); _ia2.normalize();
    _iqw.setFromAxisAngle(_ia2, want - cur);
    _sqA.copy(A.quaternion); _sqB.copy(B.quaternion);
    rotBone(B, _iqw, C);
    _ic.setFromMatrixPosition(C.matrixWorld);
    _iu.subVectors(_ic, a).normalize(); _iv.subVectors(target, a).normalize();
    _iqw.setFromUnitVectors(_iu, _iv);
    rotBone(A, _iqw, B, C);
    if (w < 0.999) { _sqN.copy(A.quaternion); A.quaternion.slerpQuaternions(_sqA, _sqN, w); _sqN.copy(B.quaternion); B.quaternion.slerpQuaternions(_sqB, _sqN, w); A.updateWorldMatrix(false, false); B.updateWorldMatrix(false, false); C.updateWorldMatrix(false, false); }
  }
  private holdClip(name: string, dt: number) {
    for (const l of [this.lower, this.upper]) {
      const sl = l.get(name); if (!sl) continue;
      const act = sl.action, lim = act.getClip().duration - 0.07, step = act.timeScale * dt;
      if (act.timeScale > 0 && act.time + step >= lim) { act.time = lim; act.timeScale = 0; }
    }
  }
  /** Applies body-space bone rotations (degrees) scaled by `weight`; see actions.ts for the axes. */
  applyPose(pose: Map<BoneKey, Euler> | Partial<Record<BoneKey, Euler>>, weight = 1) {
    const get = (k: BoneKey) => (pose instanceof Map ? pose.get(k) : pose[k]);
    for (const k of BONE_ORDER) {
      const e = get(k); const bone = this.bones.get(k);
      if (!e || !bone || (e[0] === 0 && e[1] === 0 && e[2] === 0)) continue;
      _e.set(e[0] * DEG * weight, e[1] * DEG * weight, e[2] * DEG * weight, 'XYZ'); _r.setFromEuler(_e);
      _chain.length = 0; let o = bone.parent; while (o && o !== this.model) { _chain.push(o); o = o.parent; }
      _p.identity(); for (let i = _chain.length - 1; i >= 0; i--) _p.multiply(_chain[i].quaternion);
      _t.copy(_p).invert().multiply(_r).multiply(_p);
      bone.quaternion.premultiply(_t);
    }
  }
  /** Shows/hides hair and garment extras (far LOD). The hair near/far swap stays in effect. */
  setDetail(full: boolean) { if (full === this.detail) return; this.detail = full; this.showExtras(); }
  private bodyLod: 0 | 1 | 2 | 3 = 0;
  /** Body detail by distance: 0 = full (~14k tris), 1 = ~3k, 2 = ~1.2k, 3 = ~600 clustered copies of the shared body; same skeleton, so animation and the swap are seamless. */
  setBodyLod(l: 0 | 1 | 2 | 3) {
    if (l === this.bodyLod) return; this.bodyLod = l;
    this.mesh.geometry = l === 0 ? this.base.geo : lowBody(this.base.geo, BODY_LOD_TRIS[l]);
  }
  dispose() {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); /* Round 9: material not disposed (keeps its shader program alive: no recompile hitch) */ this.root.removeFromParent(); this.mesh.skeleton.dispose();
  }
}
