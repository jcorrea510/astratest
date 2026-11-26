/** Model: knife "Tidewater Folder" - folding work knife held open: drop-point flat-ground blade, G10 scales, liner lock, clip. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

/** Drop-point blade stations: [z, spine y, edge y]. Each station is a 5-point section (spine L/R, grind line R/L, edge). */
const BLADE: [number, number, number][] = [
  [0.1, 0.0125, -0.0105], [0.125, 0.0125, -0.0112], [0.15, 0.0125, -0.0122], [0.18, 0.0123, -0.0128], [0.205, 0.0105, -0.0124],
  [0.226, 0.0068, -0.0105], [0.243, 0.0028, -0.0065], [0.254, -0.0008, -0.0028], [0.258, -0.0022, -0.0022],
];

function bladeGeo(t: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const ring = (z: number, ys: number, ye: number): THREE.Vector3[] => {
    const yg = ye + (ys - ye) * 0.58, tt = ys - ye < 0.0006 ? 0 : t;
    return [new THREE.Vector3(-tt, ys, z), new THREE.Vector3(tt, ys, z), new THREE.Vector3(tt, yg, z), new THREE.Vector3(0, ye, z), new THREE.Vector3(-tt, yg, z)];
  };
  const rings = BLADE.map(([z, ys, ye]) => ring(z, ys, ye));
  const c = new THREE.Vector3(), n = new THREE.Vector3(), a = new THREE.Vector3(), b = new THREE.Vector3();
  const tri = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, ctr: THREE.Vector3) => {
    a.subVectors(q, p); b.subVectors(r, p); n.crossVectors(a, b); c.copy(p).add(q).add(r).multiplyScalar(1 / 3).sub(ctr);
    if (n.dot(c) < 0) pos.push(p.x, p.y, p.z, r.x, r.y, r.z, q.x, q.y, q.z); else pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  };
  for (let i = 0; i < rings.length - 1; i++) {
    const A = rings[i], B = rings[i + 1], ctr = new THREE.Vector3(0, (A[0].y + A[3].y + B[0].y + B[3].y) / 4, (A[0].z + B[0].z) / 2);
    for (let j = 0; j < 5; j++) { const j2 = (j + 1) % 5; tri(A[j], A[j2], B[j], ctr); tri(A[j2], B[j2], B[j], ctr); }
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
  return g;
}

export function build(k: Kit): Built {
  // handle outline (z forward, y up): slim work-knife handle with a finger swell
  const H: [number, number][] = [[-0.006, 0.006], [0.0, 0.0125], [0.03, 0.0145], [0.07, 0.0142], [0.104, 0.0128], [0.112, 0.0095], [0.11, -0.006], [0.1, -0.0105], [0.075, -0.0145], [0.05, -0.0155], [0.025, -0.0138], [0.005, -0.0105], [-0.006, -0.003]];
  const inset = (d: number): [number, number][] => H.map(([z, y]) => [z > 0.05 ? z - d : z + d, y > 0 ? y - d : y + d] as [number, number]);
  // steel liners (centre), G10 scales either side
  k.prof(inset(0.0012), 0.0042, 'steel', 0.0006);
  for (const s of [-1, 1]) {
    k.prof(H, 0.0048, 'polymer', 0.0014, s * 0.0045);
    // G10 texture: fine cross ridges on the outer face
    for (let z = 0.004; z < 0.104; z += 0.0065) { const top = 0.0135 - Math.abs(z - 0.05) * 0.0002, bot = -0.0148; k.box(s * 0.00725, (top + bot) / 2, z, 0.0006, top - bot - 0.004, 0.0016, 'polymer'); }
    // handle screws
    for (const [z, y] of [[0.012, 0.0045], [0.05, -0.0085], [0.09, 0.005]] as [number, number][]) k.cylX(0.0027, 0.0016, s * 0.0083, y, z, 'chrome', 8);
  }
  // pivot screw + thumb stud
  k.cylX(0.0036, 0.0194, 0, 0.0035, 0.105, 'chrome', 10);
  k.cylX(0.0034, 0.0132, 0, 0.0065, 0.128, 'chrome', 8);
  // liner lock: spring bar showing at the blade/handle junction
  k.box(0.0036, -0.0062, 0.098, 0.0017, 0.0036, 0.022, 'steel');
  // pocket clip on +x scale (spring steel, tip riveted at the butt)
  k.prof([[0.0, 0.0138], [0.062, 0.0138], [0.066, 0.0124], [0.06, 0.0112], [0.003, 0.0112]], 0.0042, 'chrome', 0.0004, 0.0108);
  k.cylX(0.0016, 0.0046, 0.0108, 0.0125, 0.058, 'chrome', 6);
  // flat-ground drop-point blade
  k.parts.push({ geo: bladeGeo(0.0018), mat: 'chrome', group: 'body' });
  // blade stop / ricasso block
  k.box(0, 0.0105, 0.104, 0.0036, 0.004, 0.006, 'steel');
  return { muzzle: new THREE.Vector3(0, 0, 0.258), eject: new THREE.Vector3() };
}
