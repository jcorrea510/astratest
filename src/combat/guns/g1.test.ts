import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh, weaponParts, weaponAnchors } from '../weaponModels';
import type { WeaponId } from '../weapons';

/** Budget: <= 5000 triangles and <= 6 meshes (one per material per moving group) per gun. */
function stats(id: WeaponId) {
  const g = weaponMesh(id); g.updateMatrixWorld(true);
  let tris = 0, meshes = 0;
  g.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes++; const geo = (o as THREE.Mesh).geometry; tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; } });
  const box = new THREE.Box3().setFromObject(g), size = box.getSize(new THREE.Vector3());
  return { g, tris, meshes, box, size };
}

describe.each([
  ['pistol', { len: [0.18, 0.23], hgt: [0.12, 0.17], wid: [0.025, 0.04] }],
  ['compact', { len: [0.13, 0.18], hgt: [0.09, 0.13], wid: [0.02, 0.034] }],
] as const)('%s model', (id, r) => {
  const s = stats(id as WeaponId);
  it('fits the real-world size range and the budget', () => {
    expect(s.size.z).toBeGreaterThan(r.len[0]); expect(s.size.z).toBeLessThan(r.len[1]);
    expect(s.size.y).toBeGreaterThan(r.hgt[0]); expect(s.size.y).toBeLessThan(r.hgt[1]);
    expect(s.size.x).toBeGreaterThan(r.wid[0]); expect(s.size.x).toBeLessThan(r.wid[1]);
    expect(s.tris).toBeLessThanOrEqual(5000); expect(s.meshes).toBeLessThanOrEqual(6);
  });
  it('has slide and mag groups', () => {
    const p = weaponParts(s.g);
    expect(p.slide).toBeTruthy(); expect(p.mag).toBeTruthy();
    expect(p.slide!.children.length).toBeGreaterThan(0); expect(p.mag!.children.length).toBeGreaterThan(0);
  });
  it('anchors sit on the gun', () => {
    const p = weaponParts(s.g), a = weaponAnchors(s.g), big = s.box.clone().expandByScalar(0.004);
    expect(big.containsPoint(a.grip)).toBe(true);
    expect(p.eject.x).toBeGreaterThan(0.01); expect(p.eject.z).toBeGreaterThan(big.min.z); expect(p.eject.z).toBeLessThan(big.max.z); expect(p.eject.y).toBeGreaterThan(big.min.y); expect(p.eject.y).toBeLessThan(big.max.y);
    expect(Math.abs(p.muzzle.z - s.box.max.z)).toBeLessThan(0.006);
    expect(p.muzzle.z).toBeGreaterThan(0.08);
    expect(a.grip.distanceTo(new THREE.Vector3(0, -0.046, -0.029))).toBeLessThan(0.02);
  });
});
