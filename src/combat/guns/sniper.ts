/** Model: sniper (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
    const r = longGun(k, { recv: [-0.1, 0.24], recvH: 0.07, w: 0.036, barrel: 0.95, br: 0.011, guard: 0.32, guardR: 0.026, guardMat: 'olive', stock: 'thumb', stockLen: 0.34, stockMat: 'olive', mag: 'box', magLen: 0.08, magZ: 0.12, optic: 'scope', scopeLen: 0.4, muzzle: 'brake', furniture: 'olive', bipod: true });
    k.in('bolt', () => { k.cylX(0.006, 0.05, 0.035, 0.07, 0.0, 'steel'); const g = new THREE.SphereGeometry(0.011, 10, 8); g.translate(0.062, 0.07, 0.0); k.parts.push({ geo: g, mat: 'steel', group: 'bolt' }); });
    return r;
  }
