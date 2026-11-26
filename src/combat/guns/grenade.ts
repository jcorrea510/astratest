/** Model: grenade (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
    k.latheY([[0, -0.045], [0.022, -0.042], [0.031, -0.025], [0.033, 0.0], [0.029, 0.025], [0.016, 0.04], [0.013, 0.05], [0, 0.05]], 'olive', 14, 0, 0.0);
    k.cylY(0.011, 0.02, 0, 0.055, 0, 'steel', 10);
    k.prof([[0.0, 0.065], [0.012, 0.062], [0.03, 0.03], [0.033, -0.02], [0.028, -0.02], [0.026, 0.028], [0.008, 0.055]], 0.012, 'steel', 0.0015);
    const ring = new THREE.TorusGeometry(0.012, 0.0022, 6, 14); ring.translate(-0.022, 0.062, 0); k.parts.push({ geo: ring, mat: 'steel', group: 'body' });
    return { muzzle: new THREE.Vector3(0, 0, 0.04), eject: new THREE.Vector3() };
  }
