/** Model: molotov - glass bottle with neck and shoulder, liquid inside and a cloth rag stuffed in the neck. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  // bottle (outer wall, lip, then inner wall so the mouth reads hollow)
  k.latheY([[0, -0.08], [0.02, -0.0795], [0.03, -0.0775], [0.0355, -0.073], [0.0372, -0.066], [0.0374, -0.04], [0.0374, 0.028], [0.0362, 0.045], [0.0325, 0.06], [0.0265, 0.074], [0.0195, 0.087],
    [0.0148, 0.099], [0.0128, 0.108], [0.0124, 0.122], [0.0142, 0.1245], [0.0164, 0.128], [0.0166, 0.134], [0.0148, 0.1365], [0.0098, 0.1365], [0.0094, 0.12], [0.0094, 0.1]], 'glass', 24);
  // liquid with a slightly curved surface
  k.latheY([[0, -0.0745], [0.026, -0.0735], [0.0338, -0.07], [0.0354, -0.062], [0.0354, 0.006], [0.0335, 0.0125], [0.0, 0.0115]], 'tan', 20);
  // rag: wad stuffed in the neck, then two tails tumbling out of the mouth
  k.latheY([[0, 0.088], [0.0088, 0.09], [0.0092, 0.125], [0.0108, 0.138], [0.0085, 0.146], [0, 0.148]], 'cloth', 10);
  const tail = (pts: [number, number, number][], r: number) => k.parts.push({ geo: new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map(p => new THREE.Vector3(...p))), 16, r, 6, false), mat: 'cloth', group: 'body' });
  tail([[0.002, 0.135, 0], [0.004, 0.162, 0.002], [0.016, 0.178, 0.004], [0.032, 0.17, 0.006], [0.042, 0.148, 0.008]], 0.0062);
  tail([[-0.002, 0.135, 0], [-0.006, 0.158, -0.004], [-0.018, 0.166, -0.006], [-0.026, 0.152, -0.01]], 0.0052);
  return { muzzle: new THREE.Vector3(0, 0.17, 0), eject: new THREE.Vector3() };
}
