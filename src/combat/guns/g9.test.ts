import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh } from '../weaponModels';
import type { WeaponId } from '../weapons';

function stats(id: WeaponId) {
  const g = weaponMesh(id); g.updateMatrixWorld(true);
  let tris = 0, meshes = 0;
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes++; tris += (o as THREE.Mesh).geometry.attributes.position.count / 3; } });
  return { g, tris, meshes, box: new THREE.Box3().setFromObject(g) };
}
const distTo = (b: THREE.Box3, p: THREE.Vector3) => b.distanceToPoint(p);

describe.each([
  ['grenadeLauncher', 'slide', { zmin: -0.4, zmax: 0.65, zlen: [0.8, 1.05] }],
  ['rpg', 'mag', { zmin: -0.55, zmax: 0.72, zlen: [1.0, 1.25] }],
] as const)('%s model', (id, moving, r) => {
  const s = stats(id as WeaponId);
  it('fits the size and budgets', () => {
    expect(s.tris).toBeLessThanOrEqual(7000); expect(s.tris).toBeGreaterThan(800);
    expect(s.meshes).toBeLessThanOrEqual(8);
    expect(s.box.min.z).toBeGreaterThan(r.zmin); expect(s.box.max.z).toBeLessThan(r.zmax);
    const len = s.box.max.z - s.box.min.z; expect(len).toBeGreaterThan(r.zlen[0]); expect(len).toBeLessThan(r.zlen[1]);
    expect(s.box.max.y - s.box.min.y).toBeLessThan(0.4); expect(s.box.max.x - s.box.min.x).toBeLessThan(0.22);
  });
  it('has its moving group and anchors near geometry', () => {
    expect(s.g.getObjectByName(moving)).toBeTruthy();
    const u = s.g.userData, a = u.anchors;
    expect(distTo(s.box, u.muzzle)).toBeLessThan(0.02);
    expect(u.muzzle.z).toBeGreaterThan(0.38);
    expect(distTo(s.box, a.butt)).toBeLessThan(0.03);
    expect(distTo(s.box, a.support)).toBeLessThan(0.03);
    expect(distTo(s.box, a.grip)).toBeLessThan(0.06);
  });
});
