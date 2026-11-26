import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh, weaponAnchors } from '../weaponModels';

function stats(id: 'shotgun' | 'autoShotgun') {
  const g = weaponMesh(id); g.updateMatrixWorld(true);
  let tris = 0, meshes = 0; const box = new THREE.Box3();
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { meshes++; tris += m.geometry.attributes.position.count / 3; box.expandByObject(m); } });
  return { g, tris, meshes, box };
}
const near = (box: THREE.Box3, p: THREE.Vector3, d: number) => box.clone().expandByScalar(d).containsPoint(p);

describe('G5 shotguns', () => {
  it('shotgun: size, budget, pump group, anchors', () => {
    const { g, tris, meshes, box } = stats('shotgun');
    expect(tris).toBeLessThanOrEqual(7000); expect(meshes).toBeLessThanOrEqual(8);
    const s = box.getSize(new THREE.Vector3());
    expect(s.z).toBeGreaterThan(0.95); expect(s.z).toBeLessThan(1.2); expect(s.y).toBeGreaterThan(0.12); expect(s.y).toBeLessThan(0.25);
    expect(g.getObjectByName('pump')).toBeTruthy();
    const pump = new THREE.Box3().expandByObject(g.getObjectByName('pump')!);
    const a = weaponAnchors(g);
    expect(near(pump, a.support!, 0.03)).toBe(true);
    expect(near(box, g.userData.muzzle, 0.02)).toBe(true); expect(near(box, a.butt!, 0.02)).toBe(true); expect(near(box, a.grip, 0.03)).toBe(true);
    expect(near(box, g.userData.eject, 0.03)).toBe(true);
    expect(Math.abs(a.grip.z)).toBeLessThan(0.1);
  });
  it('autoShotgun: size, budget, drum in mag group, anchors', () => {
    const { g, tris, meshes, box } = stats('autoShotgun');
    expect(tris).toBeLessThanOrEqual(7000); expect(meshes).toBeLessThanOrEqual(8);
    const s = box.getSize(new THREE.Vector3());
    expect(s.z).toBeGreaterThan(0.9); expect(s.z).toBeLessThan(1.2); expect(s.y).toBeGreaterThan(0.25); expect(s.y).toBeLessThan(0.4);
    const mag = new THREE.Box3().expandByObject(g.getObjectByName('mag')!).getSize(new THREE.Vector3());
    expect(mag.y).toBeGreaterThan(0.15); expect(mag.z).toBeGreaterThan(0.15);
    const a = weaponAnchors(g);
    expect(near(box, g.userData.muzzle, 0.02)).toBe(true); expect(near(box, a.butt!, 0.02)).toBe(true); expect(near(box, a.support!, 0.03)).toBe(true); expect(near(box, a.grip, 0.03)).toBe(true);
  });
});
