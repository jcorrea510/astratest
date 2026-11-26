import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh, weaponAnchors } from '../weaponModels';

function stats(id: 'battleRifle' | 'marksman') {
  const g = weaponMesh(id); g.updateMatrixWorld(true);
  let tris = 0, meshes = 0; const groups = new Set<string>();
  g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { meshes++; tris += m.geometry.attributes.position.count / 3; } if (o.name) groups.add(o.name.split(':')[0]); });
  const box = new THREE.Box3().setFromObject(g);
  return { g, tris, meshes, groups, box, a: weaponAnchors(g) };
}
/** Anchor lies on / near some mesh: distance to the nearest mesh bounding box (stocks and handguards are big flat faces). */
const near = (g: THREE.Object3D, p: THREE.Vector3, tol: number) => {
  let best = Infinity; const bb = new THREE.Box3();
  g.traverse(o => { const m = o as THREE.Mesh; if (!m.isMesh) return; m.geometry.computeBoundingBox(); bb.copy(m.geometry.boundingBox!); best = Math.min(best, bb.distanceToPoint(p)); });
  return best <= tol;
};

describe.each([
  ['battleRifle', { len: [1.0, 1.25], hgt: [0.2, 0.32] }],
  ['marksman', { len: [1.05, 1.3], hgt: [0.2, 0.34] }],
] as const)('%s model', (id, r) => {
  const s = stats(id);
  it('has realistic size', () => {
    const len = s.box.max.z - s.box.min.z, h = s.box.max.y - s.box.min.y, wd = s.box.max.x - s.box.min.x;
    console.log(id, 'len', len.toFixed(3), 'h', h.toFixed(3), 'w', wd.toFixed(3), 'tris', s.tris, 'meshes', s.meshes);
    expect(len).toBeGreaterThan(r.len[0]); expect(len).toBeLessThan(r.len[1]);
    expect(h).toBeGreaterThan(r.hgt[0]); expect(h).toBeLessThan(r.hgt[1]);
    expect(wd).toBeGreaterThan(0.05); expect(wd).toBeLessThan(0.14);
  });
  it('stays in budget with a mag group', () => {
    expect(s.tris).toBeLessThanOrEqual(8000); expect(s.meshes).toBeLessThanOrEqual(8);
    expect(s.groups.has('mag')).toBe(true);
  });
  it('anchors sit on the geometry', () => {
    const ud = s.g.userData;
    expect(ud.muzzle.z).toBeGreaterThan(0.7); expect(near(s.g, ud.muzzle, 0.02)).toBe(true);
    expect(s.a.butt).not.toBeNull(); expect(near(s.g, s.a.butt!, 0.03)).toBe(true);
    expect(s.a.support).not.toBeNull(); expect(near(s.g, s.a.support!, 0.03)).toBe(true);
    expect(near(s.g, s.a.grip, 0.03)).toBe(true);
    expect(near(s.g, ud.eject, 0.03)).toBe(true);
  });
});
