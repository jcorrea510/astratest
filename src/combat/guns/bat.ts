/** Model: bat "Boardwalk Slugger" - turned ash baseball bat: knob, 25 mm handle with grip tape, long taper to a 65 mm barrel, cupped end. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

/** [radius, z] along the bat. */
const PROFILE: [number, number][] = [
  [0, -0.1], [0.011, -0.0995], [0.017, -0.0965], [0.0205, -0.091], [0.0212, -0.085], [0.0195, -0.077], [0.0155, -0.069], [0.0132, -0.06],
  [0.0126, -0.04], [0.0125, 0.0], [0.0125, 0.1], [0.0127, 0.19], [0.0138, 0.23], [0.0158, 0.27], [0.0185, 0.31], [0.0215, 0.355], [0.0248, 0.4],
  [0.0278, 0.45], [0.0302, 0.5], [0.0318, 0.55], [0.0325, 0.6], [0.0326, 0.65], [0.0322, 0.685], [0.0308, 0.707], [0.0285, 0.717], [0.0255, 0.7205],
  [0.021, 0.7195], [0.012, 0.7175], [0, 0.7168],
];

export function build(k: Kit): Built {
  k.lathe(PROFILE, 0, 'wood', 20);
  // grip tape: sleeve on the handle, edged with cloth rings, wound seam as a thin helix
  k.lathe([[0.0008, -0.064], [0.0136, -0.064], [0.0136, 0.17], [0.0008, 0.17]], 0, 'polymer', 16);
  for (const z of [-0.064, 0.17]) k.lathe([[0.0124, z - 0.0025], [0.0144, z - 0.0025], [0.0144, z + 0.0025], [0.0124, z + 0.0025]], 0, 'cloth', 14);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 40; i++) { const t = i / 40, a = t * Math.PI * 2 * 5; pts.push(new THREE.Vector3(Math.cos(a) * 0.0138, Math.sin(a) * 0.0138, -0.062 + t * 0.23)); }
  const seam = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 60, 0.0009, 4, false);
  k.parts.push({ geo: seam, mat: 'cloth', group: 'body' });
  return { muzzle: new THREE.Vector3(0, 0, 0.7), eject: new THREE.Vector3() };
}
