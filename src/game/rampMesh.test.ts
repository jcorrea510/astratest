import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { rampMeshes } from './rampMesh';
import { RAMPS } from './places';

/** 27 Nov: ten ramps of nine meshes each cost ~45 draw calls at a busy corner; they are merged per material now. */
describe('stunt ramp meshes', () => {
  it('draw every ramp in four meshes, each ramp at its spot', () => {
    const ms = rampMeshes(RAMPS, () => 0);
    expect(RAMPS.length).toBeGreaterThanOrEqual(10);
    expect(ms.length).toBeLessThanOrEqual(4);
    const concrete = ms.find(m => m.castShadow)!;
    const box = new THREE.Box3().setFromBufferAttribute(concrete.geometry.attributes.position as THREE.BufferAttribute);
    for (const r of RAMPS) expect(box.containsPoint(new THREE.Vector3(r.x, r.h / 2, r.z))).toBe(true);
    const tris = ms.reduce((n, m) => n + m.geometry.attributes.position.count / 3, 0);
    expect(tris).toBeGreaterThan(RAMPS.length * 100);
  });
});
