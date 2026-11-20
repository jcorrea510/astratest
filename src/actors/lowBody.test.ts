/** Far-body decimation keeps thin limbs (a collapsed forearm left hands floating next to far pedestrians). */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lowBody } from './human';

function part(g: THREE.BufferGeometry, bone: number): THREE.BufferGeometry {
  const ng = g.toNonIndexed(), n = ng.attributes.position.count;
  const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { si[i * 4] = bone; sw[i * 4] = 1; }
  ng.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); ng.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  return ng;
}

describe('lowBody', () => {
  it('keeps a thin limb when the torso is decimated hard', () => {
    const torso = part(new THREE.BoxGeometry(0.4, 0.6, 0.26, 14, 20, 10), 0);
    const arm = part(new THREE.CylinderGeometry(0.035, 0.035, 0.3, 12, 8).rotateZ(Math.PI / 2).translate(0.38, 0.2, 0), 1);
    const hand = part(new THREE.BoxGeometry(0.08, 0.1, 0.04, 3, 3, 2).translate(0.57, 0.2, 0), 2);
    const geo = mergeGeometries([torso, arm, hand])!;
    const low = lowBody(geo, 250);
    const P = low.attributes.position, SI = low.attributes.skinIndex;
    let armTris = 0, x0 = Infinity, x1 = -Infinity;
    for (let t = 0; t < P.count; t += 3) if (SI.getX(t) === 1) { armTris++; for (let k = 0; k < 3; k++) { x0 = Math.min(x0, P.getX(t + k)); x1 = Math.max(x1, P.getX(t + k)); } }
    expect(P.count / 3).toBeLessThanOrEqual(250);
    expect(armTris).toBeGreaterThan(48); // still a tube (uniform clustering left ~28 slivers)
    expect(x1 - x0).toBeGreaterThan(0.24); // and it still reaches the hand
  });
});
