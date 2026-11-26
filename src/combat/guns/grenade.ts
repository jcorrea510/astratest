/** Model: grenade - smooth modern egg-shaped frag body, fuze head, spoon lever, pull ring and pin. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

/** Body radius profile [r, y] (y up). */
const BODY: [number, number][] = [[0, -0.047], [0.012, -0.0462], [0.021, -0.0425], [0.0285, -0.0345], [0.0322, -0.022], [0.0338, -0.006], [0.0335, 0.01], [0.0305, 0.026], [0.0245, 0.037], [0.0185, 0.0445], [0.0152, 0.0475], [0.0, 0.0475]];
function rAt(y: number): number {
  for (let i = 0; i < BODY.length - 1; i++) { const [r0, y0] = BODY[i], [r1, y1] = BODY[i + 1]; if (y >= y0 && y <= y1 && y1 > y0) return r0 + (r1 - r0) * (y - y0) / (y1 - y0); }
  return 0.0152;
}

export function build(k: Kit): Built {
  k.latheY(BODY, 'olive', 20);
  // painted band + base plug
  k.latheY([[rAt(0.0), -0.002], [rAt(0.0) + 0.0004, -0.002], [rAt(0.016) + 0.0004, 0.016], [rAt(0.016), 0.016]], 'brass', 20);
  k.cylY(0.0095, 0.0016, 0, -0.0472, 0, 'steel', 12);
  // fuze: threaded collar, body, striker cap
  k.latheY([[0.0, 0.0465], [0.0175, 0.0465], [0.0178, 0.0525], [0.0148, 0.0535], [0.0135, 0.0535], [0.0135, 0.0625], [0.0125, 0.0645], [0.0, 0.0645]], 'steel', 16);
  // spoon (safety lever): bridges the fuze top then hugs the body down the +z side
  const outer: [number, number][] = [], inner: [number, number][] = [];
  for (let y = 0.058; y >= -0.022; y -= 0.008) { outer.push([rAt(Math.min(y, 0.0465)) + 0.0036, y]); inner.push([rAt(Math.min(y, 0.0465)) + 0.0006, y]); }
  const spoon: [number, number][] = [[0.0, 0.0675], [0.0125, 0.0675], [0.0158, 0.0642], ...outer, ...inner.reverse(), [0.0138, 0.0602], [0.0, 0.0602]];
  k.prof(spoon, 0.0165, 'steel', 0.0008);
  // pin through the fuze (along x) and pull ring
  k.cylX(0.0016, 0.032, -0.006, 0.057, 0.0, 'chrome', 6);
  const ring = new THREE.TorusGeometry(0.0108, 0.0019, 6, 20); ring.rotateY(0.45); ring.translate(-0.0285, 0.057, 0);
  k.parts.push({ geo: ring, mat: 'chrome', group: 'body' });
  return { muzzle: new THREE.Vector3(0, 0, 0.04), eject: new THREE.Vector3() };
}
