/**
 * Holds a weapon model on any Human (NPC gang / police / army) with the same IK as the player: stock in the shoulder,
 * two-hand grip on long guns, one hand out on pistols. Call after the human's update(); cheap, so callers gate it to
 * near / visible people and leave far ones on the clip.
 */
import * as THREE from 'three';
import type { Human } from '../actors/human';
import { solveHold, makeHoldOut, supportGripWeight } from './gunHold';
import { weaponAnchors } from './weaponModels';

const out = makeHoldOut();
const _sr = new THREE.Vector3(), _sl = new THREE.Vector3(), _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3(), _dir = new THREE.Vector3(), _lo = new THREE.Vector3();
const _q = new THREE.Quaternion(), _qr = new THREE.Quaternion();
const shoulders = new WeakMap<Human, [THREE.Object3D, THREE.Object3D] | null>();

/** aim = world point to point the barrel at (null = low ready along `yaw`). raise 0..1. Returns false if the rig is missing bones. */
export function holdOnHuman(h: Human, m: THREE.Object3D, yaw: number, aim: THREE.Vector3 | null, raise: number): boolean {
  let s = shoulders.get(h);
  if (s === undefined) {
    const r = h.model.getObjectByName('DEF-upper_armR'), l = h.model.getObjectByName('DEF-upper_armL');
    s = r && l ? [r, l] : null; shoulders.set(h, s);
  }
  if (!s) return false;
  h.root.updateMatrixWorld(true); m.updateMatrixWorld(true);
  const an = weaponAnchors(m), long = !!an.butt;
  s[0].getWorldPosition(_sr); s[1].getWorldPosition(_sl);
  const lp = long ? 0.85 : 0.3;
  _lo.set(Math.sin(yaw) * Math.cos(lp), -Math.sin(lp), Math.cos(yaw) * Math.cos(lp));
  if (aim) { _dir.copy(aim).sub(_sr); if (_dir.lengthSq() < 0.5) _dir.copy(_lo); _dir.normalize(); _dir.lerp(_lo, 1 - raise).normalize(); } else _dir.copy(_lo);
  h.rightHand.parent!.getWorldPosition(_a1); h.rightHand.getWorldPosition(_a2);
  solveHold({ shR: _sr, shL: _sl, armLen: _sr.distanceTo(_a1) + _a1.distanceTo(_a2), dir: _dir, anchors: an, supportHand: raise > 0.4, raise }, out);
  m.position.copy(out.pos); m.quaternion.copy(out.quat); m.updateMatrixWorld(true);
  _a1.copy(an.grip).add(_a2.set(-0.017, 0, 0)).applyMatrix4(m.matrixWorld);
  h.gripSolve('R', _a1, out.rQuat, 1, true); // world matrices were refreshed at the top; the left arm chain is independent of the right one
  if (out.hasLeft) h.gripSolve('L', out.lPalm, out.lQuat, supportGripWeight(long, raise), true);
  void _q; void _qr;
  return true;
}
