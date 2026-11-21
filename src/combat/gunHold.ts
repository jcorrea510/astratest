/**
 * Gun hold solver: where the weapon sits on the body and where each palm goes, from the shoulders and an aim direction.
 * Long guns (stock) seat the butt in the right shoulder pocket with the barrel on the aim line and the left palm under
 * the handguard; pistols are held out in front with the left hand wrapped round the right. The result feeds
 * Human.gripSolve (two-bone IK + hand orientation), so the arms follow the weapon instead of the weapon following the
 * animation. Pure maths: unit-tested without a renderer.
 */
import * as THREE from 'three';
import type { WeaponAnchors } from './weaponModels';

export interface HoldInput {
  shR: THREE.Vector3; shL: THREE.Vector3;
  /** shoulder-to-wrist length of the right arm (m) */
  armLen: number;
  /** unit aim direction (world) */
  dir: THREE.Vector3;
  anchors: WeaponAnchors;
  /** support hand on the gun (long guns always; pistols when raised) */
  supportHand: boolean;
  /** 0 = held low, 1 = raised to aim (pistol reach and hand position change with it) */
  raise: number;
}
export interface HoldOut {
  pos: THREE.Vector3; quat: THREE.Quaternion;
  rPalm: THREE.Vector3; rQuat: THREE.Quaternion;
  lPalm: THREE.Vector3; lQuat: THREE.Quaternion; hasLeft: boolean;
}
export const makeHoldOut = (): HoldOut => ({ pos: new THREE.Vector3(), quat: new THREE.Quaternion(), rPalm: new THREE.Vector3(), rQuat: new THREE.Quaternion(), lPalm: new THREE.Vector3(), lQuat: new THREE.Quaternion(), hasLeft: false });

const UP = new THREE.Vector3(0, 1, 0), ZERO = new THREE.Vector3();
const _m = new THREE.Matrix4(), _in = new THREE.Vector3(), _fw = new THREE.Vector3(), _g = new THREE.Vector3(), _f = new THREE.Vector3(), _n = new THREE.Vector3(), _t = new THREE.Vector3(), _x = new THREE.Vector3(), _a = new THREE.Vector3();
const _qb = new THREE.Quaternion();

/** Hand orientation (hand space: y = fingers, z = thumb side, x = back of the hand on the right / palm on the left) from gun-space finger and palm-normal directions. */
export function handQuat(side: 'L' | 'R', f: THREE.Vector3, n: THREE.Vector3, gun: THREE.Quaternion, out: THREE.Quaternion) {
  _f.copy(f).normalize(); _n.copy(n).normalize();
  if (side === 'R') _t.crossVectors(_f, _n); else _t.crossVectors(_n, _f);
  _t.normalize(); _x.crossVectors(_f, _t);
  _m.makeBasis(_x, _f, _t); _qb.setFromRotationMatrix(_m);
  return out.copy(gun).multiply(_qb);
}

export function solveHold(i: HoldInput, o: HoldOut): HoldOut {
  _m.lookAt(i.dir, ZERO, UP); o.quat.setFromRotationMatrix(_m);
  _in.subVectors(i.shL, i.shR); _in.y = 0; _in.normalize();                 // towards the chest centre
  _fw.set(i.dir.x, 0, i.dir.z); if (_fw.lengthSq() < 1e-6) _fw.set(0, 0, 1); _fw.normalize();
  const a = i.anchors, q = o.quat;
  if (a.butt) {
    // stock in the shoulder pocket: just in front of and inside the joint
    _g.copy(i.shR).addScaledVector(_in, 0.07).addScaledVector(_fw, 0.07).addScaledVector(UP, -0.035);
    o.pos.copy(_g).sub(_a.copy(a.butt).applyQuaternion(q));
  } else {
    // arm-length hold: raised = out in front near the body line, low = at the hip
    const reach = i.armLen * (0.5 + 0.35 * i.raise);
    _g.copy(i.shR).addScaledVector(i.dir, reach).addScaledVector(_in, 0.06 + 0.06 * i.raise).addScaledVector(UP, -0.12 * (1 - i.raise));
    o.pos.copy(_g).sub(_a.copy(a.grip).applyQuaternion(q));
  }
  // a long fore-end can be out of the left arm's reach: slide the whole gun back towards the shooter (at most 14 cm)
  if (a.butt && a.support) {
    _a.copy(a.support).applyQuaternion(q).add(o.pos);
    const over = _a.distanceTo(i.shL) - i.armLen * 0.96;
    if (over > 0) o.pos.addScaledVector(i.dir, -Math.min(0.14, over));
  }
  // right palm on the right-hand side of the grip
  o.rPalm.copy(a.grip).add(_a.set(-0.017, 0, 0)).applyQuaternion(q).add(o.pos);
  handQuat('R', _a.set(0, -0.5, 0.87), _n.set(1, 0, 0), q, o.rQuat);
  o.hasLeft = false;
  if (a.butt && a.support) {
    // left palm up under the handguard, fingers wrapping across to the right
    o.lPalm.copy(a.support).applyQuaternion(q).add(o.pos); o.hasLeft = true;
    handQuat('L', _a.set(-0.95, 0.15, 0.25), _n.set(0, 1, 0), q, o.lQuat);
  } else if (i.supportHand) {
    if (a.support) { o.lPalm.copy(a.support).applyQuaternion(q).add(o.pos); handQuat('L', _a.set(-0.95, 0.15, 0.25), _n.set(0, 1, 0), q, o.lQuat); }
    else { o.lPalm.copy(a.grip).add(_a.set(0.017, -0.012, 0.012)).applyQuaternion(q).add(o.pos); handQuat('L', _a.set(0, -0.7, 0.7), _n.set(-1, 0, 0), q, o.lQuat); }
    o.hasLeft = true;
  }
  return o;
}

/**
 * Upper-body animation mode for a person on foot. Aimed: pistol / rifle pose. Not aimed: a two-handed gun is carried (both arms in the
 * carry pose, the IK then seats the left hand on the fore-end), but a gun that needs only the right hand leaves the left arm to the
 * normal idle / walk / run swing ('loco') so it never hangs in a pistol-ready pose or lags behind.
 */
export function onFootUpperMode(armed: boolean, aiming: boolean, twoHanded: boolean): 'loco' | 'pistol' | 'rifle' | 'carry' {
  if (!armed) return 'loco';
  if (aiming) return twoHanded ? 'rifle' : 'pistol';
  return twoHanded ? 'carry' : 'loco';
}
const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/**
 * How strongly the left hand is pulled onto the gun. Long guns (stock + fore-end) always; a one-hand gun only while raised
 * to aim, fading out below `raise` 0.35, so a lowered one-hand gun has no left-arm IK left over at all.
 */
export function supportGripWeight(hasButt: boolean, raise: number): number { return hasButt ? 1 : sstep(0.35, 0.8, raise); }
