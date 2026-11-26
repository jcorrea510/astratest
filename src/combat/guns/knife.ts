/** Model: knife (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
    k.prof([[0.0, 0.014], [0.105, 0.016], [0.112, 0.01], [0.105, -0.004], [0.04, -0.012], [0.0, -0.01]], 0.017, 'polymer', 0.004);
    k.prof([[0.105, 0.012], [0.235, 0.008], [0.245, 0.0], [0.2, -0.012], [0.105, -0.012]], 0.004, 'chrome', 0.0012);
    k.cylX(0.006, 0.02, 0, 0.0, 0.1, 'steel');
    return { muzzle: new THREE.Vector3(0, 0, 0.24), eject: new THREE.Vector3() };
  }
