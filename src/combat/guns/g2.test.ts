import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh } from '../weaponModels';

function stats(id: 'heavyPistol' | 'machinePistol') {
  const m = weaponMesh(id); m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  let tris = 0, meshes = 0;
  m.traverse(o => { if ((o as THREE.Mesh).isMesh) { meshes++; const g = (o as THREE.Mesh).geometry; tris += (g.index ? g.index.count : g.attributes.position.count) / 3; } });
  return { m, box, tris, meshes };
}
const cases = [
  { id: 'heavyPistol' as const, len: [0.18, 0.24], hgt: [0.14, 0.2] },
  { id: 'machinePistol' as const, len: [0.17, 0.27], hgt: [0.15, 0.24] },
];
describe.each(cases)('$id model', ({ id, len, hgt }) => {
  const s = stats(id);
  it('has realistic dimensions', () => {
    const d = s.box.getSize(new THREE.Vector3());
    expect(d.z).toBeGreaterThan(len[0]); expect(d.z).toBeLessThan(len[1]);
    expect(d.y).toBeGreaterThan(hgt[0]); expect(d.y).toBeLessThan(hgt[1]);
    expect(d.x).toBeGreaterThan(0.025); expect(d.x).toBeLessThan(0.05);
  });
  it('stays in the triangle and mesh budget', () => { expect(s.tris).toBeLessThanOrEqual(5000); expect(s.meshes).toBeLessThanOrEqual(6); });
  it('has moving slide and magazine groups', () => {
    expect(s.m.getObjectByName('slide')).toBeTruthy(); expect(s.m.getObjectByName('mag')).toBeTruthy();
    const mag = new THREE.Box3().setFromObject(s.m.getObjectByName('mag')!), slide = new THREE.Box3().setFromObject(s.m.getObjectByName('slide')!);
    expect(mag.min.y).toBeLessThan(s.box.min.y + 0.01); expect(slide.max.y).toBeGreaterThan(s.box.max.y - 0.012);
  });
  it('puts anchors on the geometry', () => {
    const mz = s.m.userData.muzzle as THREE.Vector3, ej = s.m.userData.eject as THREE.Vector3, gp = s.m.userData.anchors.grip as THREE.Vector3;
    expect(Math.abs(mz.z - s.box.max.z)).toBeLessThan(0.012); expect(Math.abs(mz.x)).toBeLessThan(0.001); expect(mz.y).toBeGreaterThan(0.04); expect(mz.y).toBeLessThan(0.075);
    expect(s.box.clone().expandByScalar(0.002).containsPoint(ej)).toBe(true);
    expect(gp.y).toBeLessThan(0.0); expect(gp.y).toBeGreaterThan(-0.09); expect(Math.abs(gp.z)).toBeLessThan(0.06);
  });
});
