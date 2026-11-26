import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { armChainPath } from './gunRig';

describe('armChainPath', () => {
  it('lists each ancestor once, parents first, and skips unrelated bones', () => {
    const root = new THREE.Object3D(), spine = new THREE.Object3D(), armR = new THREE.Object3D(), handR = new THREE.Object3D(), armL = new THREE.Object3D(), handL = new THREE.Object3D(), finger = new THREE.Object3D(), head = new THREE.Object3D();
    root.add(spine); spine.add(armR, armL, head); armR.add(handR); armL.add(handL); handR.add(finger);
    const p = armChainPath(root, [armR, armL, handR, handL]);
    expect(p).toEqual([root, spine, armR, armL, handR, handL]);
    expect(p).not.toContain(head); expect(p).not.toContain(finger);
  });
});
