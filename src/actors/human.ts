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
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { loadHumanAssets, extrasGeometries, type HumanAssets, type BodyBase } from './humanAssets';
import { personMaterial, applyLookUniforms, type PersonUniforms } from './humanMaterial';
import { ACTIONS, BONE_OF, BONE_ORDER, samplePose, type ActionDef, type BoneKey, type Euler } from './actions';
import { resolveLook, type Look, type FullLook } from './look';

export { randomLook, resolveLook, PLAYER_DEFAULT_LOOK, SKIN_TONES } from './look';
export type { Look, FullLook, HairStyle, HatStyle, TopStyle, BottomStyle, ShoeStyle, FacialHair, Sex } from './look';
export { ACTIONS, UAL_CLIPS } from './actions';

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
const _ia = new THREE.Vector3(), _ib = new THREE.Vector3(), _ic = new THREE.Vector3(), _iu = new THREE.Vector3(), _iv = new THREE.Vector3(), _ia2 = new THREE.Vector3();
const _iq1 = new THREE.Quaternion(), _iq2 = new THREE.Quaternion(), _iqw = new THREE.Quaternion();
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
    this.mesh.castShadow = true; this.mesh.receiveShadow = true; this.mesh.frustumCulled = false;
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
      const ex = new THREE.SkinnedMesh(g, this.material);
      ex.bind(this.mesh.skeleton, this.mesh.bindMatrix);
      ex.boundingSphere = g.boundingSphere!.clone(); ex.boundingBox = g.boundingBox!.clone(); // CPU vertices are freed after upload
      ex.castShadow = true; ex.receiveShadow = true; ex.frustumCulled = false;
      this.mesh.parent!.add(ex);
      this.extras.push(ex);
    }
  }
  /** Re-dresses this person (sex changes are not supported in place: create a new Human for that). */
  applyLook(look: Look) {
    const l = resolveLook({ ...look, sex: this.look.sex });
    const rebuild = l.hairStyle !== this.look.hairStyle || l.facial !== this.look.facial || l.hatStyle !== this.look.hatStyle || l.topStyle !== this.look.topStyle || l.bottomStyle !== this.look.bottomStyle;
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

  update(dt: number) {
    this.stateTime += dt;
    const base = this.base;
    const sc = this.scale;
    const [walk, jog, sprint] = base.loco.map(l => l.speed * sc);
    const v = this.speed;
    const w = this.locoWeights; w.fill(0);
    if (v < 0.15) w[0] = 1;
    else if (v < walk) { const t = v / walk; w[0] = 1 - t; w[1] = t; }
    else if (v < jog) { const t = (v - walk) / (jog - walk); w[1] = 1 - t; w[2] = t; }
    else if (v < sprint) { const t = (v - jog) / (sprint - jog); w[2] = 1 - t; w[3] = t; }
    else w[3] = 1;
    // Turning on the spot: short shuffling steps instead of pivoting on frozen feet.
    const turning = this.state === 'loco' && v < 0.5 ? THREE.MathUtils.clamp((Math.abs(this.turnRate) - 0.7) * 0.25, 0, 0.6) : 0;
    if (turning > 0) { w[1] = Math.max(w[1], turning); w[0] = Math.max(0, 1 - w[1] - w[2] - w[3]); }
    const strides = base.loco.map(l => l.speed * sc * l.duration);
    const movingW = w[1] + w[2] + w[3];
    if (this.state === 'jump') this.phase = (this.phase + dt * 0.35) % 1; // a held stride while airborne
    else if (movingW > 0.001) {
      const stride = (w[1] * strides[0] + w[2] * strides[1] + w[3] * strides[2]) / movingW;
      const travel = Math.max(v, 0.4) + Math.abs(this.turnRate) * 0.25 * turning * 4;
      this.phase = (this.phase + (travel * dt) / stride) % 1;
    } else this.phase = (this.phase + dt / 4) % 1;
    for (let i = 0; i < 4; i++) {
      const n = LOCO[i], dur = i === 0 ? base.clips.get(n)!.duration : base.loco[i - 1].duration;
      const time = i === 0 ? (this.stateTime % dur) : this.phase * dur;
      this.lower.get(n)!.action.time = time; this.upper.get(n)!.action.time = time;
    }
    for (const s of this.lower.values()) s.target = 0;
    for (const s of this.upper.values()) s.target = 0;
    const L = (n: string, t = 1) => { this.slot(this.lower, n).target += t; };
    const U = (n: string, t = 1) => { this.slot(this.upper, n).target += t; };
    let fullOverride = false;
    switch (this.state) {
      case 'loco': LOCO.forEach((n, i) => { if (w[i] > 0) { L(n, w[i]); U(n, w[i]); } }); break;
      case 'jump': {
        const m = THREE.MathUtils.clamp(this.airMove, 0, 1);
        L('Jump_Loop', 1 - m); if (m > 0) L('Jog_Fwd_Loop', m);
        U('Jump_Loop', 1 - m * 0.5); if (m > 0) U('Jog_Fwd_Loop', m * 0.5);
        break;
      }
      case 'drive': L('Driving_Loop'); U('Driving_Loop'); fullOverride = true; break;
      case 'swim': { const f = Math.min(1, v / 1.5); L('Swim_Idle_Loop', 1 - f); L('Swim_Fwd_Loop', f); U('Swim_Idle_Loop', 1 - f); U('Swim_Fwd_Loop', f); fullOverride = true; break; }
      case 'sit': L('Sitting_Idle_Loop'); U('Sitting_Idle_Loop'); break;
      case 'crouch': case 'cower': L('Crouch_Idle_Loop'); U('Crouch_Idle_Loop'); break;
      case 'talk': L('Idle_Loop'); U('Idle_Talking_Loop'); break;
      case 'dance': L('Dance_Loop'); U('Dance_Loop'); fullOverride = true; break;
      case 'dead': fullOverride = true; break;
    }
    if (!fullOverride && this.state !== 'cower') {
      if (this.upperMode === 'pistol' || this.upperMode === 'rifle') {
        for (const s of this.upper.values()) s.target = 0;
        const p = THREE.MathUtils.clamp(this.aimPitch / 0.9, -1, 1);
        if (p >= 0) { U('Pistol_Aim_Neutral', 1 - p); U('Pistol_Aim_Up', p); } else { U('Pistol_Aim_Neutral', 1 + p); U('Pistol_Aim_Down', -p); }
      } else if (this.upperMode === 'carry') { for (const s of this.upper.values()) s.target = 0; U('Pistol_Idle_Loop'); }
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
        const layers = a.layer === 'full' ? [this.lower, this.upper] : [this.upper];
        for (const l of layers) { for (const s of l.values()) s.target *= 1 - actK; this.slot(l, a.clip).target = actK; }
      }
      // events at normalised times of the first cycle
      const evs = a.def.events;
      if (evs && a.onEvent) {
        const u = a.t / a.cycle;
        while (a.evI < evs.length && u >= evs[a.evI][0]) { const ev = evs[a.evI++][1]; a.onEvent(ev); }
      }
      if (a.t >= a.dur) { this.act = null; a.onDone?.(); }
    }
    if (this.state === 'dead' && (!this.act || this.act.ending)) { for (const l of [this.lower, this.upper]) { for (const s of l.values()) s.target = 0; this.slot(l, this.deathClip).target = 1; } }
    const rate = 1 - Math.exp(-dt * 14);
    for (const l of [this.lower, this.upper]) for (const s of l.values()) {
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
    if (this.reach.w > 0.001) {
      this.root.updateMatrixWorld(true);
      if (this.reach.L) this.solveArm('L', this.reach.L, this.reach.w);
      if (this.reach.R) this.solveArm('R', this.reach.R, this.reach.w);
    }
  }
  /** Two-bone IK: bends the forearm to the target distance, then swings the whole arm onto it. */
  private solveArm(side: 'L' | 'R', target: THREE.Vector3, w: number) {
    const A = this.bones.get(side === 'L' ? 'armL' : 'armR'), B = this.bones.get(side === 'L' ? 'foreL' : 'foreR'), C = this.bones.get(side === 'L' ? 'handL' : 'handR');
    if (!A || !B || !C) return;
    const a = A.getWorldPosition(_ia), b = B.getWorldPosition(_ib), c = C.getWorldPosition(_ic);
    const l1 = a.distanceTo(b), l2 = b.distanceTo(c);
    if (l1 < 1e-4 || l2 < 1e-4) return;
    const rot = (bone: THREE.Object3D, q: THREE.Quaternion) => {
      const pq = bone.parent!.getWorldQuaternion(_iq1), wq = bone.getWorldQuaternion(_iq2).premultiply(q);
      bone.quaternion.copy(pq.invert().multiply(wq)); bone.updateMatrixWorld(true);
    };
    const d = THREE.MathUtils.clamp(a.distanceTo(target), Math.abs(l1 - l2) + 0.02, l1 + l2 - 0.005);
    const want = Math.acos(THREE.MathUtils.clamp((l1 * l1 + l2 * l2 - d * d) / (2 * l1 * l2), -1, 1));
    _iu.subVectors(a, b).normalize(); _iv.subVectors(c, b).normalize();
    const cur = Math.acos(THREE.MathUtils.clamp(_iu.dot(_iv), -1, 1));
    _ia2.crossVectors(_iu, _iv); if (_ia2.lengthSq() < 1e-8) _ia2.set(1, 0, 0).applyQuaternion(this.root.quaternion); _ia2.normalize();
    _iqw.setFromAxisAngle(_ia2, want - cur);
    const save = [A.quaternion.clone(), B.quaternion.clone()];
    rot(B, _iqw);
    C.getWorldPosition(_ic);
    _iu.subVectors(_ic, a).normalize(); _iv.subVectors(target, a).normalize();
    _iqw.setFromUnitVectors(_iu, _iv);
    rot(A, _iqw);
    if (w < 0.999) { A.quaternion.slerpQuaternions(save[0], A.quaternion.clone(), w); B.quaternion.slerpQuaternions(save[1], B.quaternion.clone(), w); A.updateMatrixWorld(true); }
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
  /** Shows/hides hair and garment extras (far LOD). */
  setDetail(full: boolean) { for (const e of this.extras) e.visible = full; }
  dispose() {
    this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); this.material.dispose(); this.root.removeFromParent(); this.mesh.skeleton.dispose();
  }
}
