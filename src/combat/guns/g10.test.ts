import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh } from '../weaponModels';
import type { WeaponId } from '../weapons';

function stats(id: WeaponId) {
  const g = weaponMesh(id); g.updateMatrixWorld(true);
  let tris = 0, meshes = 0;
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { meshes++; const geo = m.geometry; tris += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; } });
  return { box: new THREE.Box3().setFromObject(g), tris, meshes };
}
const between = (v: number, a: number, b: number) => { expect(v).toBeGreaterThanOrEqual(a); expect(v).toBeLessThanOrEqual(b); };

describe('G10 melee/throwable models', () => {
  for (const id of ['knife', 'bat', 'grenade', 'molotov'] as WeaponId[]) {
    it(`${id} stays within budget`, () => { const s = stats(id); expect(s.tris).toBeLessThanOrEqual(3000); expect(s.meshes).toBeLessThanOrEqual(5); expect(s.tris).toBeGreaterThan(150); });
  }
  it('knife: open folder, blade forward of the hand', () => {
    const { box } = stats('knife'); between(box.max.z, 0.24, 0.28); between(box.min.z, -0.02, 0.0); between(box.max.y - box.min.y, 0.025, 0.04); between(box.max.x - box.min.x, 0.012, 0.03);
  });
  it('bat: ~0.82 m long, 65 mm barrel, 25 mm handle', () => {
    const { box } = stats('bat'); between(box.max.z - box.min.z, 0.8, 0.84); between(box.max.x - box.min.x, 0.063, 0.068);
    const pos = ((weaponMesh('bat').children[0]) as THREE.Mesh).geometry.attributes.position; let r = 0;
    for (let i = 0; i < pos.count; i++) if (Math.abs(pos.getZ(i) - 0.1) < 0.001) r = Math.max(r, Math.hypot(pos.getX(i), pos.getY(i)));
    between(r, 0.0122, 0.0132);
  });
  it('grenade: egg body about 7 cm, anchors kept', () => {
    const { box } = stats('grenade'); between(box.max.y - box.min.y, 0.1, 0.125); between(box.max.x - box.min.x, 0.065, 0.1); expect(weaponMesh('grenade').userData.muzzle.z).toBeCloseTo(0.04);
  });
  it('molotov: bottle with rag above the neck', () => {
    const { box } = stats('molotov'); between(box.min.y, -0.082, -0.078); between(box.max.y, 0.15, 0.19); between(box.max.x - box.min.x, 0.074, 0.1); expect(weaponMesh('molotov').userData.muzzle.y).toBeCloseTo(0.17);
  });
});
