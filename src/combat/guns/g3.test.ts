import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh, weaponParts, weaponAnchors } from '../weaponModels';
import type { WeaponId } from '../weapons';

function stats(id: WeaponId) {
  const m = weaponMesh(id);
  const box = new THREE.Box3(); let tris = 0, meshes = 0;
  m.traverse(o => {
    const me = o as THREE.Mesh;
    if (!me.isMesh) return;
    meshes++; me.geometry.computeBoundingBox(); box.union(me.geometry.boundingBox!);
    tris += (me.geometry.index ? me.geometry.index.count : me.geometry.attributes.position.count) / 3;
  });
  return { m, box, tris, meshes };
}
const near = (box: THREE.Box3, p: THREE.Vector3, d: number) => box.clone().expandByScalar(d).containsPoint(p);

describe('G3 guns: revolver + sawnoff', () => {
  it('revolver: size, budget, cylinder group, anchors', () => {
    const { m, box, tris, meshes } = stats('revolver');
    const s = box.getSize(new THREE.Vector3());
    expect(s.z).toBeGreaterThan(0.26); expect(s.z).toBeLessThan(0.34);
    expect(s.y).toBeGreaterThan(0.15); expect(s.y).toBeLessThan(0.21);
    expect(s.x).toBeGreaterThan(0.03); expect(s.x).toBeLessThan(0.06);
    expect(tris).toBeLessThanOrEqual(5000); expect(tris).toBeGreaterThan(800); expect(meshes).toBeLessThanOrEqual(6);
    const p = weaponParts(m); expect(p.slide).not.toBeNull();
    expect(p.slide!.children.length).toBeGreaterThan(0);
    const mz = m.userData.muzzle as THREE.Vector3;
    expect(mz.z).toBeGreaterThan(box.max.z - 0.01); expect(mz.z).toBeLessThanOrEqual(box.max.z + 0.002);
    expect(near(box, mz, 0.005)).toBe(true);
    expect(near(box, weaponAnchors(m).grip, 0)).toBe(true);
  });
  it('sawnoff: size, budget, anchors', () => {
    const { m, box, tris, meshes } = stats('sawnoff');
    const s = box.getSize(new THREE.Vector3());
    expect(s.z).toBeGreaterThan(0.38); expect(s.z).toBeLessThan(0.48);
    expect(s.y).toBeGreaterThan(0.15); expect(s.y).toBeLessThan(0.23);
    expect(s.x).toBeGreaterThan(0.04); expect(s.x).toBeLessThan(0.07);
    expect(tris).toBeLessThanOrEqual(5000); expect(tris).toBeGreaterThan(800); expect(meshes).toBeLessThanOrEqual(6);
    const a = weaponAnchors(m);
    expect(a.support).not.toBeNull(); expect(a.butt).toBeNull();
    expect(near(box, a.support!, 0)).toBe(true); expect(near(box, a.grip, 0)).toBe(true);
    expect(near(box, m.userData.muzzle as THREE.Vector3, 0.005)).toBe(true);
  });
});
