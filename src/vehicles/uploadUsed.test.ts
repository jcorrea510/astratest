import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { uploadUsed } from './farCars';

describe('instance uploads (Round 7 perf)', () => {
  it('only the instances in use are marked for upload, not the whole capacity', () => {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(400 * 16), 16);
    const v0 = a.version;
    uploadUsed(a, 25);
    expect(a.updateRanges).toEqual([{ start: 0, count: 25 * 16 }]);
    expect(a.version).toBeGreaterThan(v0);
    uploadUsed(a, 3); expect(a.updateRanges).toEqual([{ start: 0, count: 48 }]);
  });
});
