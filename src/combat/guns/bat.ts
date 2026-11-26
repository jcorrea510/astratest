/** Model: bat (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
    k.lathe([[0, -0.1], [0.024, -0.1], [0.026, -0.09], [0.015, -0.082], [0.014, 0.1], [0.018, 0.25], [0.028, 0.45], [0.033, 0.62], [0.033, 0.7], [0.028, 0.72], [0, 0.722]], 0, 'wood', 14);
    k.lathe([[0.0155, -0.075], [0.0155, 0.12], [0, 0.12]], 0, 'cloth', 12);
    return { muzzle: new THREE.Vector3(0, 0, 0.7), eject: new THREE.Vector3() };
  }
