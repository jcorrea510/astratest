/**
 * Small articulated ragdoll (2 Rapier bodies: legs+pelvis and torso+head+arms, one spherical waist joint) for people hit
 * by cars and for corpses that get run over. It collides with the world and the cars' hood/cabin proxy hulls (G_VRAG),
 * so a body rolls onto the hood, slides off when the car brakes and is thrown at speed. The visual is the normal human
 * skeleton: root follows the legs body, the spine bends by the torso/legs relative rotation, a limp pose hangs the arms.
 * Bodies are removed (frozen to the last pose) when the cap is exceeded; sleeping bodies cost almost nothing.
 */
import * as THREE from 'three';
import { RAPIER, type Physics, G_STATIC, G_PROP, G_RAG, groups } from '../core/physics';
import type { Character } from './character';
import type { Human } from './human';
import type { Pose } from './actions';
import { sym } from './actions';

/** Round 9: tumble spin cap (rad/s), waist fold where the spring starts, max drawn spine bend (rad) */
export const MAX_SPIN = 11, FOLD = 1.05, BEND_MAX = 1.3, ROOT_STEP = 0.38;
const LEG = { hh: 0.27, r: 0.15, cy: 0.42, mass: 32 };
const TOR = { hh: 0.26, r: 0.19, cy: 1.33, mass: 42 };
const WAIST_Y = 0.86;
export const LIMP: Pose = sym({ armL: [-14, 0, 24], foreL: [-28, 0, 0], handL: [0, 0, 10], thighL: [-6, 0, -4], shinL: [10, 0, 0], head: [8, 0, 0] });
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _I = new THREE.Quaternion();
const _pq = new THREE.Quaternion(), _lq = new THREE.Quaternion();

export interface LaunchOpts {
  /** initial velocity of both bodies (m/s) */
  vx: number; vy: number; vz: number;
  /** extra spin (rad/s) */
  spin?: number;
  /** keep the person alive and get them back up when settled */
  getUp?: boolean;
  /** start lying (a corpse) instead of upright */
  lying?: boolean;
  /** the car that hit them (windshield cracking) */
  car?: { glassAt(p: THREE.Vector3, tol?: number): number | null; hitGlass(id: number, at?: THREE.Vector3, hits?: number): boolean; isGlassBroken(id: number): boolean } | null;
}

export class Ragdoll {
  legs: RAPIER.RigidBody; torso: RAPIER.RigidBody; joint: RAPIER.ImpulseJoint | null = null;
  t = 0; still = 0; frozen = false; ended = false;
  /** world-space rotation of the torso relative to the legs, kept after freezing */
  bend = new THREE.Quaternion();
  rootPos = new THREE.Vector3(); rootQuat = new THREE.Quaternion();
  hood = 0; // seconds the torso has been above the car's hood line (stats for tests)
  groundT = 0; /** times a body was lifted back out of the ground (stats for tests) */ unsunk = 0;
  private crackedGlass = false;
  readonly s: number;
  constructor(private sys: RagdollSystem, public char: Character, public o: LaunchOpts) {
    const w = sys.physics.world, h = char.human, s = (this.s = h.look.height || 1);
    // frame: yaw about Y, optionally lying on the back (head behind)
    const yaw = char.yaw;
    const R = new THREE.Quaternion().setFromEuler(new THREE.Euler(o.lying ? -Math.PI / 2 : 0, yaw, 0, 'YXZ'));
    const lift = o.lying ? 0.2 : 0.04;
    const at = (cy: number, out: THREE.Vector3) => out.set(0, cy * s, 0).applyQuaternion(R).add(char.pos).add(_v2.set(0, lift, 0));
    const lp = at(LEG.cy, new THREE.Vector3()), tp = at(TOR.cy, new THREE.Vector3());
    const mk = (p: THREE.Vector3, hh: number, r: number, mass: number) => {
      const rb = w.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: R.x, y: R.y, z: R.z, w: R.w })
        .setLinvel(o.vx, o.vy, o.vz).setAngvel({ x: 0, y: o.spin ?? 0, z: 0 }).setLinearDamping(0.12).setAngularDamping(2.4).setCcdEnabled(true).setCanSleep(true));
      w.createCollider(RAPIER.ColliderDesc.capsule(hh * s, r * s).setMass(mass).setFriction(0.9).setRestitution(0.06)
        .setCollisionGroups(groups(G_RAG, G_STATIC | G_PROP | sys.vragMask)), rb);
      return rb;
    };
    this.legs = mk(lp, LEG.hh, LEG.r, LEG.mass); this.torso = mk(tp, TOR.hh, TOR.r, TOR.mass);
    this.joint = w.createImpulseJoint(RAPIER.JointData.spherical({ x: 0, y: (WAIST_Y - LEG.cy) * s, z: 0 }, { x: 0, y: (WAIST_Y - TOR.cy) * s, z: 0 }), this.legs, this.torso, true);
    this.rootQuat.copy(R); this.rootPos.copy(char.pos);
  }
  get speed() { const a = this.legs.linvel(), b = this.torso.linvel(); return Math.hypot(a.x, a.y, a.z) + Math.hypot(b.x, b.y, b.z); }
  /** world position of the torso centre */
  torsoPos(out: THREE.Vector3) { const p = this.torso.translation(); return out.set(p.x, p.y, p.z); }
  /** Reads the bodies into rootPos / rootQuat / bend and updates the character's ground position. */
  sync() {
    if (this.frozen) return;
    const lp = this.legs.translation(), lq = this.legs.rotation(), tq = this.torso.rotation();
    _lq.set(lq.x, lq.y, lq.z, lq.w); _pq.set(tq.x, tq.y, tq.z, tq.w);
    // Round 9: the drawn body turns at most ~22 degrees per tick (a contact impulse could snap it 50+ degrees in one step)
    { const a = this.rootQuat.angleTo(_lq); if (a > ROOT_STEP && this.t > 0.02) this.rootQuat.rotateTowards(_lq, ROOT_STEP); else this.rootQuat.copy(_lq); }
    this.rootPos.set(0, -LEG.cy * this.s, 0).applyQuaternion(this.rootQuat).add(_v.set(lp.x, lp.y, lp.z));
    this.bend.copy(_pq).multiply(_q.copy(_lq).invert()); // torso * legs^-1 (world delta)
    const wp = _v2.set(0, (WAIST_Y - LEG.cy) * this.s, 0).applyQuaternion(_lq).add(_v.set(lp.x, lp.y, lp.z));
    const c = this.char; c.pos.set(wp.x, Math.max(-50, Math.min(this.rootPos.y, wp.y - 0.15)), wp.z); c.vel.set(0, 0, 0);
  }
  /** Applies the root transform to the skeleton (call before Human.update). */
  syncRoot(h: Human) { h.root.position.copy(this.rootPos); h.root.quaternion.copy(this.rootQuat); h.root.updateMatrixWorld(true); }
  /** Applies the spine bend + limp pose (call after Human.update). */
  applyBend(h: Human) {
    h.applyPose(LIMP, 1);
    h.root.updateMatrixWorld(true);
    const sp = h.spine; if (!sp.parent || !sp.parent.parent) return;
    // Round 9: the drawn spine never folds past ~75 degrees (the bodies can briefly, mid-impact)
    const ba = 2 * Math.acos(Math.min(1, Math.abs(this.bend.w)));
    const part = _q2.copy(_I.identity()).slerp(this.bend, (ba > BEND_MAX ? BEND_MAX / ba : 1) / 3);
    for (const b of [sp.parent.parent, sp.parent, sp]) {
      b.parent!.getWorldQuaternion(_pq);
      // local' = (P^-1 * D * P) * local
      _lq.copy(_pq).invert().multiply(part).multiply(_pq);
      b.quaternion.premultiply(_lq); b.updateMatrixWorld(true);
    }
  }
  /** Windshield crack when the torso slams into the glass. */
  checkGlass() {
    const car = this.o.car; if (!car || this.crackedGlass || this.t > 1.5) return;
    this.torsoPos(_v);
    const id = car.glassAt(_v, 0.38);
    if (id !== null && this.torso.linvel().y > -30 && this.speed > 7) { this.crackedGlass = true; if (!car.isGlassBroken(id)) car.hitGlass(id, _v.clone(), 2); }
  }
  freeze() {
    if (this.frozen) return; this.sync(); this.frozen = true;
    const w = this.sys.physics.world;
    if (this.joint) { w.removeImpulseJoint(this.joint, true); this.joint = null; }
    w.removeRigidBody(this.legs); w.removeRigidBody(this.torso);
  }
  dispose() { this.freeze(); }
}

export class RagdollSystem {
  list: Ragdoll[] = [];
  /** collision-mask bit of the car hull proxies (set by the game wiring; default G_VRAG) */
  vragMask = 0x0040;
  /** max ragdolls that keep physics bodies (older ones freeze in place) */
  maxLive = 8;
  onFinished: ((c: Character, r: Ragdoll) => void) | null = null;
  constructor(public physics: Physics) { }
  /** Turns a person into a ragdoll. Returns null if already ragdolled. */
  launch(char: Character, o: LaunchOpts): Ragdoll | null {
    if (char.ragdoll) return null;
    const r = new Ragdoll(this, char, o);
    char.beginRagdoll(r);
    this.list.push(r);
    while (this.list.filter(x => !x.frozen).length > this.maxLive) { const old = this.list.find(x => !x.frozen && !x.o.getUp); (old ?? this.list.find(x => !x.frozen))!.freeze(); }
    return r;
  }
  /** After the physics step. */
  update(dt: number) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const r = this.list[i], c = r.char;
      if (r.frozen) { if (!c.ragdoll) this.list.splice(i, 1); continue; }
      r.t += dt; this.tame(r, dt); r.sync(); r.checkGlass(); this.unsink(r, dt);
      const sleeping = r.legs.isSleeping() && r.torso.isSleeping();
      if (r.speed < 0.5 || sleeping) r.still += dt; else r.still = 0;
      if (r.o.getUp && c.alive && r.t > 1.0 && r.still > 0.6) { this.release(r); this.list.splice(i, 1); continue; }
      if (r.o.getUp && !c.alive) r.o.getUp = false;
      if (!r.o.getUp && r.t > 30 && r.still > 2) r.freeze();
      if (c.isDisposed) { r.freeze(); this.list.splice(i, 1); }
    }
  }
  /**
   * Round 9 (owner: hit pedestrians "start glitching everywhere"): a 45 mph hit spun the bodies at ~40 rad/s and folded the
   * torso 180 degrees over the legs (the waist joint has no limits). Spin is capped at a human tumble rate and a waist
   * spring pulls the torso back toward the legs once the fold passes ~60 degrees.
   */
  private tame(r: Ragdoll, dt: number) {
    for (const b of [r.legs, r.torso]) {
      const w = b.angvel(), m = Math.hypot(w.x, w.y, w.z);
      if (m > MAX_SPIN) { const k = MAX_SPIN / m; b.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true); }
    }
    const lq = r.legs.rotation(), tq = r.torso.rotation();
    _lq.set(lq.x, lq.y, lq.z, lq.w); _pq.set(tq.x, tq.y, tq.z, tq.w);
    const rel = _q.copy(_pq).multiply(_q2.copy(_lq).invert()); // world delta legs -> torso
    if (rel.w < 0) { rel.x = -rel.x; rel.y = -rel.y; rel.z = -rel.z; rel.w = -rel.w; }
    const ang = 2 * Math.acos(Math.min(1, rel.w));
    if (ang > FOLD) {
      const sn = Math.sqrt(Math.max(1e-6, 1 - rel.w * rel.w)), ax = rel.x / sn, ay = rel.y / sn, az = rel.z / sn;
      const k = Math.min(1, (ang - FOLD) / 0.6) * 60 * dt; // impulse-ish: angular speed change per step (rad/s)
      const tw = r.torso.angvel(), lw = r.legs.angvel();
      r.torso.setAngvel({ x: tw.x - ax * k, y: tw.y - ay * k, z: tw.z - az * k }, true);
      r.legs.setAngvel({ x: lw.x + ax * k * 0.6, y: lw.y + ay * k * 0.6, z: lw.z + az * k * 0.6 }, true);
    }
  }
  /**
   * Round 7: a body squeezed under the street (pinned by a car, solver push-through) is lifted back onto the ground
   * instead of jittering half inside it. Checked a few times a second per body.
   */
  private unsink(r: Ragdoll, dt: number) {
    r.groundT -= dt; if (r.groundT > 0) return; r.groundT = 0.15;
    for (const [b, rad] of [[r.legs, LEG.r * r.s], [r.torso, TOR.r * r.s]] as const) {
      const p = b.translation(), hit = this.physics.ray(p.x, p.y + 1.6, p.z, 0, -1, 0, 4, groups(0xffff, G_STATIC)), g = hit ? p.y + 1.6 - hit.toi : null; // streets only (not a car roof)
      if (g === null || p.y - rad > g - 0.08) continue;
      b.setTranslation({ x: p.x, y: g + rad + 0.03, z: p.z }, true);
      const v = b.linvel(); b.setLinvel({ x: v.x * 0.5, y: Math.max(0, v.y), z: v.z * 0.5 }, true);
      r.unsunk++;
    }
  }
  /** Stand a living ragdoll back up where it came to rest. */
  release(r: Ragdoll) {
    const c = r.char; r.sync();
    const tq = r.torso.rotation(); _q.set(tq.x, tq.y, tq.z, tq.w);
    const head = _v.set(0, 1, 0).applyQuaternion(_q); head.y = 0;
    const yaw = head.lengthSq() > 0.02 ? Math.atan2(-head.x, -head.z) : c.yaw;
    const wp = r.legs.translation();
    const g = c.groundBelow(wp.x, wp.y + 0.8, wp.z, 3);
    r.freeze();
    c.endRagdoll(wp.x, g ?? r.rootPos.y, wp.z, yaw);
  }
  clear() { for (const r of this.list) r.freeze(); this.list.length = 0; }
}
