import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { ACTIONS, samplePose, type BoneKey, type Euler } from './actions';

/** Simple body-space FK of the left arm (rotations in body axes, child applied after parent; x = left, y = up, z = forward). */
function armAt(u: number) {
  const out = new Map<BoneKey, Euler>(); samplePose(ACTIONS.hands_up.poses!, u, out);
  const q = (e?: Euler) => new THREE.Quaternion().setFromEuler(new THREE.Euler(...((e ?? [0, 0, 0]).map(d => d * Math.PI / 180) as [number, number, number]), 'XYZ'));
  const qa = q(out.get('armL')), qf = q(out.get('foreL')).multiply(qa);
  const down = new THREE.Vector3(0, -1, 0);
  const elbow = down.clone().applyQuaternion(qa).multiplyScalar(0.29);
  const hand = elbow.clone().add(down.clone().applyQuaternion(qf).multiplyScalar(0.27));
  return { elbow, hand };
}
describe('hands up (Round 7: hands lead, not the elbows)', () => {
  it('half way through raising, the hands have climbed further (relative to their final height) than the elbows', () => {
    const a0 = armAt(0), a1 = armAt(1), am = armAt(0.45);
    const hand = (am.hand.y - a0.hand.y) / (a1.hand.y - a0.hand.y), elbow = (am.elbow.y - a0.elbow.y) / (a1.elbow.y - a0.elbow.y);
    expect(a1.hand.y).toBeGreaterThan(a1.elbow.y); // ends with the hands above the elbows
    expect(hand).toBeGreaterThan(elbow);
    expect(hand).toBeGreaterThan(0.5);
  });
});
