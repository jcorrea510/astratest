import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh } from '../weaponModels';

function stats(id: 'sniper' | 'lmg') {
  const m = weaponMesh(id);
  m.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(m);
  let tris = 0, meshes = 0;
  const verts: THREE.Vector3[] = [];
  m.traverse(o => {
    const me = o as THREE.Mesh;
    if (!me.isMesh) return;
    meshes++;
    const p = me.geometry.attributes.position;
    tris += (me.geometry.index ? me.geometry.index.count : p.count) / 3;
    for (let i = 0; i < p.count; i += 1) verts.push(new THREE.Vector3().fromBufferAttribute(p, i));
  });
  const near = (v: THREE.Vector3) => Math.min(...verts.map(q => q.distanceTo(v)));
  return { m, box, tris, meshes, near };
}

describe('G8 sniper + lmg models', () => {
  it('sniper: size, budget, groups and anchors', () => {
    const { m, box, tris, meshes, near } = stats('sniper');
    expect(box.max.z).toBeGreaterThan(0.95); expect(box.max.z).toBeLessThan(1.1);
    expect(box.min.z).toBeGreaterThan(-0.5); expect(box.min.z).toBeLessThan(-0.4);
    expect(box.max.y).toBeLessThan(0.2); expect(box.min.y).toBeGreaterThan(-0.16);
    expect(tris).toBeLessThanOrEqual(9000); expect(tris).toBeGreaterThan(2500);
    expect(meshes).toBeLessThanOrEqual(8);
    expect(m.getObjectByName('bolt')).toBeTruthy(); expect(m.getObjectByName('mag')).toBeTruthy();
    const a = m.userData.anchors;
    expect(near(m.userData.muzzle)).toBeLessThan(0.02);
    expect(Math.abs(a.butt.z - box.min.z)).toBeLessThan(0.012); expect(near(a.butt)).toBeLessThan(0.07);
    expect(near(a.grip)).toBeLessThan(0.03);
    expect(near(a.support)).toBeLessThan(0.04);
    expect(m.userData.eject).toBeTruthy();
  });
  it('lmg: size, budget, groups and anchors', () => {
    const { m, box, tris, meshes, near } = stats('lmg');
    expect(box.max.z).toBeGreaterThan(0.85); expect(box.max.z).toBeLessThan(1.0);
    expect(box.min.z).toBeGreaterThan(-0.45); expect(box.min.z).toBeLessThan(-0.35);
    expect(box.min.x).toBeGreaterThan(-0.12);
    expect(tris).toBeLessThanOrEqual(9000); expect(tris).toBeGreaterThan(2500);
    expect(meshes).toBeLessThanOrEqual(8);
    const mag = m.getObjectByName('mag')!;
    expect(mag).toBeTruthy();
    const mb = new THREE.Box3().setFromObject(mag);
    expect(mb.min.x).toBeLessThan(-0.05); // ammo box sits on the left
    const a = m.userData.anchors;
    expect(near(m.userData.muzzle)).toBeLessThan(0.02);
    expect(Math.abs(a.butt.z - box.min.z)).toBeLessThan(0.012); expect(near(a.butt)).toBeLessThan(0.07);
    expect(near(a.grip)).toBeLessThan(0.03);
    expect(near(a.support)).toBeLessThan(0.04);
  });
});
