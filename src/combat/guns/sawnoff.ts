/** Model: sawnoff (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
    const by = 0.06;
    for (const x of [-0.0125, 0.0125]) { k.cyl(0.0125, 0.04, 0.34, by, 'steel', 14, x).bore(0.009, 0.34, by); }
    k.bore(0.009, 0.34, by); // (both bores drawn above at x = 0 for the central one; the pair reads at range)
    k.prof([[-0.05, 0.014], [0.06, 0.014], [0.06, by + 0.026], [-0.045, by + 0.03], [-0.052, by + 0.02]], 0.05, 'steel', 0.004); // action
    k.prof([[0.08, by - 0.013], [0.25, by - 0.012], [0.25, by - 0.03], [0.09, by - 0.034]], 0.042, 'wood', 0.006); // fore-end
    k.prof([[0.024, 0.012], [0.07, 0.012], [0.07, -0.012], [0.03, -0.016], [0.03, -0.01], [0.064, -0.007], [0.064, 0.006], [0.024, 0.006]], 0.008, 'steel', 0.0015);
    k.prof([[-0.044, by + 0.024], [-0.075, by + 0.008], [-0.062, -0.095], [-0.022, -0.1], [-0.008, -0.03], [0.002, 0.016], [-0.046, 0.018]], 0.04, 'wood', 0.008); // sawed-off pistol-grip stock
    k.prof([[-0.04, by + 0.03], [-0.03, by + 0.04], [-0.012, by + 0.03], [-0.02, by + 0.022]], 0.01, 'steel', 0.002); // hammers
    return { muzzle: new THREE.Vector3(0, by, 0.345), eject: new THREE.Vector3(0.02, by + 0.02, 0.05), support: new THREE.Vector3(0, by - 0.035, 0.17), grip: new THREE.Vector3(0, -0.04, -0.03) };
  }
