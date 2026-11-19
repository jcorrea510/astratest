import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { buildHeliModel, heliDoorAngle, type HeliVariant } from './helicopterModel';

/** x (model space) of the door panel's free edge (the vertex farthest from the hinge) after swinging `amount` open. */
function freeEdgeX(variant: HeliVariant, side: 0 | 1, amount: number) {
  const m = buildHeliModel(variant, 0), pivot = m.doors[side];
  pivot.rotation.y = heliDoorAngle(side === 0 ? 'left' : 'right', amount); pivot.updateMatrixWorld(true);
  let best = 0, bx = 0;
  pivot.traverse(o => {
    const mesh = o as THREE.Mesh; if (!mesh.isMesh || !(mesh.geometry as THREE.BufferGeometry).attributes.position) return;
    const p = mesh.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) { const v = new THREE.Vector3().fromBufferAttribute(p, i); const d = Math.abs(v.z); if (d > best) { best = d; bx = v.applyMatrix4(mesh.matrixWorld).x; } }
  });
  return bx;
}

describe('helicopter cabin doors', () => {
  for (const variant of ['civilian', 'news', 'police', 'army'] as HeliVariant[]) {
    it(`${variant}: both doors swing away from the hull centre when opening (never into the cabin)`, () => {
      for (const side of [0, 1] as const) {
        const sg = side === 0 ? 1 : -1; // +x is the left side
        const closed = sg * freeEdgeX(variant, side, 0), open = sg * freeEdgeX(variant, side, 1);
        expect(open).toBeGreaterThan(closed + 0.3);
      }
    });
  }
  it('door angle is outward for both sides at every opening', () => {
    for (const a of [0.2, 0.6, 1]) { expect(heliDoorAngle('left', a)).toBeLessThan(0); expect(heliDoorAngle('right', a)).toBeGreaterThan(0); }
  });
});
