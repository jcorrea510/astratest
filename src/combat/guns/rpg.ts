/** Model: rpg (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
    const by = 0.1;
    k.lathe([[0.042, -0.45], [0.05, -0.47], [0.052, -0.42], [0.045, -0.35], [0.045, 0.3], [0.05, 0.32], [0.05, 0.36], [0.044, 0.38]], by, 'olive', 16);
    k.lathe([[0.034, -0.46], [0.034, 0.37]], by, 'bore', 12);
    k.in('mag', () => k.lathe([[0.0, 0.38], [0.035, 0.38], [0.05, 0.42], [0.055, 0.5], [0.04, 0.58], [0.012, 0.64], [0.0, 0.645]], by, 'olive', 14)); // rocket warhead (the "magazine")
    k.prof([[0.02, 0.06], [0.03, 0.055], [-0.005, -0.1], [-0.042, -0.098], [-0.03, -0.06], [-0.022, 0.06]], 0.03, 'polymer', 0.005);
    k.prof([[0.2, 0.06], [0.23, 0.06], [0.215, -0.07], [0.185, -0.068]], 0.03, 'polymer', 0.005);
    k.box(-0.055, by + 0.03, 0.05, 0.03, 0.05, 0.1, 'steel'); k.box(-0.055, by + 0.055, 0.0, 0.03, 0.02, 0.025, 'lens');
    k.box(0, by + 0.06, -0.15, 0.03, 0.02, 0.2, 'wood');
    return { muzzle: new THREE.Vector3(0, by, 0.4), eject: new THREE.Vector3(), butt: new THREE.Vector3(0, by, -0.3), support: new THREE.Vector3(0, -0.02, 0.207) };
  }
