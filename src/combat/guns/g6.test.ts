import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh } from '../weaponModels';
import type { WeaponId } from '../weapons';

function stats(id: WeaponId) {
  const g = weaponMesh(id); g.updateMatrixWorld(true);
  let tris = 0, meshes = 0; const box = new THREE.Box3(); const groups = new Set<string>();
  g.traverse(o => {
    if ((o as THREE.Mesh).isMesh) { const m = o as THREE.Mesh; meshes++; tris += m.geometry.attributes.position.count / 3; box.union(new THREE.Box3().setFromObject(m)); }
    if (o.name && o !== g) groups.add(o.name.split(':')[0]);
  });
  return { g, tris, meshes, box, groups };
}
describe.each(['rifle', 'carbine'] as WeaponId[])('G6 %s', id => {
  const s = stats(id);
  it('fits budgets', () => { expect(s.tris).toBeLessThanOrEqual(8000); expect(s.meshes).toBeLessThanOrEqual(8); expect(s.tris).toBeGreaterThan(800); });
  it('has a mag group and sane size', () => {
    expect(s.groups.has('mag')).toBe(true);
    const sz = s.box.getSize(new THREE.Vector3());
    expect(sz.z).toBeGreaterThan(id === 'rifle' ? 0.8 : 0.65); expect(sz.z).toBeLessThan(id === 'rifle' ? 1.0 : 0.85);
    expect(sz.x).toBeLessThan(0.1); expect(sz.y).toBeGreaterThan(0.2); expect(sz.y).toBeLessThan(0.4);
  });
  it('anchors sit on the geometry', () => {
    const a = s.g.userData.anchors, m = s.g.userData.muzzle as THREE.Vector3;
    const bb = s.box.clone().expandByScalar(0.03);
    for (const p of [a.grip, a.butt, a.support, m, s.g.userData.eject]) expect(bb.containsPoint(p)).toBe(true);
    expect(Math.abs(m.z - s.box.max.z)).toBeLessThan(0.02);
    expect(Math.abs(a.butt.z - s.box.min.z)).toBeLessThan(0.02);
    expect(Math.abs(a.grip.y)).toBeLessThan(0.08); expect(Math.abs(a.grip.z)).toBeLessThan(0.05);
    expect(a.support.z).toBeGreaterThan(0.2);
  });
});
