import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { weaponMesh, weaponAnchors } from '../weaponModels';
import type { WeaponId } from '../weapons';

const tris = (g: THREE.Object3D) => { let n = 0; g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { const geo = m.geometry; n += (geo.index ? geo.index.count : geo.attributes.position.count) / 3; } }); return n; };
const meshes = (g: THREE.Object3D) => { let n = 0; g.traverse(o => { if ((o as THREE.Mesh).isMesh) n++; }); return n; };
const bbox = (g: THREE.Object3D) => { g.updateMatrixWorld(true); return new THREE.Box3().setFromObject(g); };
/** distance from p to the box of the nearest mesh. */
const nearest = (g: THREE.Object3D, p: THREE.Vector3) => { let d = Infinity; g.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && m.name.indexOf('bore') < 0) { m.geometry.computeBoundingBox(); d = Math.min(d, m.geometry.boundingBox!.distanceToPoint(p)); } }); return d; };

describe.each([
  ['compactSmg', { z: [-0.09, 0.22], y: [-0.16, 0.11], x: 0.075, butt: false }],
  ['smg', { z: [-0.32, 0.4], y: [-0.16, 0.14], x: 0.07, butt: true }],
] as const)('G4 gun %s', (id, lim) => {
  const g = weaponMesh(id as WeaponId);
  it('fits a realistic size', () => {
    const b = bbox(g);
    expect(b.min.z).toBeGreaterThan(lim.z[0]); expect(b.max.z).toBeLessThan(lim.z[1]);
    expect(b.min.y).toBeGreaterThan(lim.y[0]); expect(b.max.y).toBeLessThan(lim.y[1]);
    expect(b.max.x).toBeLessThan(lim.x); expect(b.min.x).toBeGreaterThan(-lim.x);
  });
  it('stays in the triangle and mesh budget', () => { expect(tris(g)).toBeLessThanOrEqual(7000); expect(meshes(g)).toBeLessThanOrEqual(8); });
  it('keeps a magazine group below the receiver', () => {
    const mag = g.getObjectByName('mag'); expect(mag).toBeTruthy();
    const b = new THREE.Box3().setFromObject(mag!); expect(b.min.y).toBeLessThan(-0.1);
  });
  it('has anchors on the geometry', () => {
    const a = weaponAnchors(g), mz = g.userData.muzzle as THREE.Vector3;
    expect(nearest(g, mz)).toBeLessThan(0.01); expect(mz.z).toBeGreaterThan(0.18);
    expect(nearest(g, a.grip)).toBeLessThan(0.02);
    expect(a.support).toBeTruthy(); expect(nearest(g, a.support!)).toBeLessThan(0.012);
    if (lim.butt) { expect(a.butt).toBeTruthy(); expect(nearest(g, a.butt!)).toBeLessThan(0.012); } else expect(a.butt).toBeNull();
  });
});
