/** Model: grenadeLauncher (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
    const by = 0.07;
    k.prof([[-0.06, by - 0.04], [0.12, by - 0.04], [0.12, by + 0.035], [-0.04, by + 0.035], [-0.06, by + 0.02]], 0.044, 'steel', 0.004);
    k.in('slide', () => { k.cyl(0.07, 0.12, 0.32, by - 0.03, 'polymer', 6); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; k.cyl(0.021, 0.319, 0.322, by - 0.03 + Math.sin(a) * 0.045, 'bore', 10, Math.cos(a) * 0.045); } });
    k.cyl(0.026, 0.3, 0.52, by, 'steel', 14).bore(0.021, 0.52, by);
    k.prof([[0.33, by - 0.03], [0.48, by - 0.03], [0.48, by - 0.065], [0.33, by - 0.065]], 0.04, 'polymer', 0.006);
    k.prof([[0.02, 0.012], [0.03, 0.005], [-0.005, -0.1], [-0.042, -0.098], [-0.03, -0.06], [-0.022, 0.012]], 0.03, 'polymer', 0.005);
    k.cyl(0.015, -0.32, -0.06, by, 'steel', 10); k.box(0, by - 0.02, -0.32, 0.04, 0.11, 0.016, 'polymer');
    k.redDot(0.03, by + 0.036);
    return { muzzle: new THREE.Vector3(0, by, 0.53), eject: new THREE.Vector3(0.03, by, 0.2), butt: new THREE.Vector3(0, by, -0.33), support: new THREE.Vector3(0, by - 0.065, 0.405) };
  }
