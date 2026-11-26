/** Model: shotgun (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
    const r = longGun(k, { recv: [-0.08, 0.13], recvH: 0.062, w: 0.036, barrel: 0.66, br: 0.011, stock: 'wood', stockLen: 0.32, stockMat: 'wood', mag: 'none', optic: 'none', muzzle: 'none', furniture: 'polymer' });
    k.cyl(0.0105, 0.13, 0.6, 0.06 - 0.024, 'steel', 12); k.cyl(0.012, 0.59, 0.62, 0.06 - 0.024, 'steel', 12);
    k.box(0, 0.06 + 0.014, 0.645, 0.006, 0.01, 0.006, 'brass');
    k.in('pump', () => { k.prof([[0.22, 0.06 - 0.008], [0.42, 0.06 - 0.008], [0.42, 0.06 - 0.045], [0.22, 0.06 - 0.045]], 0.048, 'wood', 0.008); for (let i = 0; i < 6; i++) k.box(0, 0.06 - 0.046, 0.25 + i * 0.028, 0.044, 0.003, 0.008, 'polymer'); });
    r.support = new THREE.Vector3(0, 0.0, 0.32); // palm round the pump slide
    return r;
  }
