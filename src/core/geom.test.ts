import { describe, it, expect, vi, afterEach } from 'vitest';
import * as THREE from 'three';
import { flatCopy } from './geom';

afterEach(() => vi.restoreAllMocks());
describe('flatCopy', () => {
  it('copies a non-indexed geometry without the three.js "already non-indexed" console warning', () => {
    const warn = vi.spyOn(console, 'warn');
    const ex = new THREE.ExtrudeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(1, 0), new THREE.Vector2(0, 1)]), { depth: 0.1, bevelEnabled: false });
    expect(ex.index).toBeNull();
    const f = flatCopy(ex);
    expect(f).not.toBe(ex);
    expect(f.attributes.position.count).toBe(ex.attributes.position.count);
    expect(warn).not.toHaveBeenCalled();
  });
  it('expands an indexed geometry', () => {
    const b = new THREE.BoxGeometry(1, 1, 1), f = flatCopy(b);
    expect(f.index).toBeNull();
    expect(f.attributes.position.count).toBe(b.index!.count);
  });
});
