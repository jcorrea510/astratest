/** Model: molotov (see combat/weapons.ts for its name and stats). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
    k.latheY([[0, -0.08], [0.034, -0.08], [0.037, -0.07], [0.037, 0.03], [0.03, 0.06], [0.013, 0.085], [0.012, 0.12], [0.014, 0.125], [0.0, 0.125]], 'glass', 14);
    k.latheY([[0, -0.07], [0.033, -0.07], [0.033, 0.0], [0, 0.0]], 'tan', 12);
    k.latheY([[0.0, 0.11], [0.015, 0.115], [0.02, 0.14], [0.012, 0.17], [0.006, 0.18], [0, 0.182]], 'cloth', 8);
    return { muzzle: new THREE.Vector3(0, 0.17, 0), eject: new THREE.Vector3() };
  }
