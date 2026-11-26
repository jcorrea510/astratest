/** Model: shotgun "Breaker 12" - pump-action 12 gauge: steel receiver (loading + ejection ports), vent-rib barrel with bead,
 * tube magazine with cap, grooved walnut fore-end on action bars (group 'pump'), walnut stock with recoil pad. */
import * as THREE from 'three';
import type { Kit, Built, Mat } from './kit';

type P = [number, number][];
export function build(k: Kit): Built {
  const S = 0.04, by = 0.06; // design z is shifted by S so the wrist sits near the origin
  const Z = (z: number) => z + S;
  const prof = (pts: P, w: number, m: Mat, b: number) => k.prof(pts.map(([z, y]) => [Z(z), y] as [number, number]), w, m, b);
  const W = 0.036, BE = 0.63, ty = by - 0.0245; // receiver width, barrel end (design z), tube axis height
  // ---- receiver: steel block + round top shell, barrel collar; ports modelled as dark inlays
  prof([[-0.09, 0.024], [0.13, 0.024], [0.13, 0.078], [0.1, 0.084], [-0.075, 0.084], [-0.09, 0.078]], W, 'steel', 0.004);
  k.cyl(0.0185, Z(-0.07), Z(0.125), 0.066, 'steel', 14);
  k.cyl(0.0175, Z(0.12), Z(0.15), by, 'steel', 14);
  k.box(W / 2 + 0.0004, 0.06, Z(0.04), 0.0012, 0.026, 0.075, 'bore'); // ejection port
  k.box(W / 2 + 0.0004, 0.03, Z(0.05), 0.0012, 0.005, 0.06, 'bore'); // action bar slot
  k.box(0, 0.0236, Z(0.035), 0.024, 0.0012, 0.055, 'bore'); // loading port
  for (let i = 0; i < 6; i++) k.box(0, 0.0875, Z(-0.04 + i * 0.012), 0.012, 0.001, 0.003, 'steel'); // top serrations
  k.cylX(0.0045, 0.052, 0, 0.0285, Z(-0.0), 'brass', 8); // cross-bolt safety button
  k.cylX(0.0028, 0.044, 0, 0.074, Z(-0.06), 'steel', 8); // pin
  // ---- trigger guard + trigger
  prof([[-0.055, 0.026], [-0.055, -0.004], [-0.045, -0.018], [0.035, -0.018], [0.045, -0.004], [0.045, 0.026], [0.04, 0.026], [0.04, -0.002], [0.032, -0.012], [-0.042, -0.012], [-0.05, -0.002], [-0.05, 0.026]], 0.008, 'steel', 0.0012);
  prof([[-0.006, 0.026], [0.002, 0.026], [-0.001, -0.009], [-0.01, -0.006]], 0.005, 'steel', 0.001);
  // ---- barrel, vent rib, bead, crown; tube magazine and cap
  k.cyl(0.0118, Z(0.14), Z(BE), by, 'steel', 14);
  k.cyl(0.0132, Z(BE - 0.02), Z(BE), by, 'steel', 14);
  k.bore(0.0098, Z(BE), by);
  k.box(0, by + 0.0118 + 0.0035, Z((0.14 + BE) / 2), 0.0075, 0.0045, BE - 0.14, 'steel');
  for (let i = 0; i < 8; i++) k.box(0, by + 0.0118 + 0.0015, Z(0.17 + i * 0.062), 0.0035, 0.007, 0.006, 'steel');
  k.box(0, by + 0.0118 + 0.0085, Z(BE - 0.03), 0.0028, 0.005, 0.005, 'brass'); // bead sight
  k.cyl(0.0095, Z(0.12), Z(0.57), ty, 'steel', 12);
  k.cyl(0.0138, Z(0.55), Z(0.59), ty, 'steel', 14); // magazine cap
  k.box(0, by - 0.0105, Z(0.575), 0.007, 0.024, 0.012, 'steel'); // barrel / tube clamp
  k.bore(0.0085, Z(0.59), ty);
  // ---- stock: walnut with wrist, rubber recoil pad, tang
  prof([[-0.085, 0.085], [-0.2, 0.08], [-0.33, 0.073], [-0.395, 0.075], [-0.405, 0.06], [-0.412, -0.06], [-0.375, -0.064], [-0.3, -0.026], [-0.17, -0.02], [-0.125, -0.045], [-0.1, -0.062], [-0.068, -0.058], [-0.06, 0.0], [-0.085, 0.0]], 0.036, 'wood', 0.006);
  prof([[-0.396, 0.077], [-0.416, 0.072], [-0.424, -0.062], [-0.378, -0.066]], 0.038, 'bore', 0.004);
  prof([[-0.095, 0.083], [-0.11, 0.083], [-0.11, 0.0], [-0.095, 0.0]], 0.039, 'steel', 0.002);
  for (let i = 0; i < 4; i++) k.box(0, -0.008 - i * 0.012, Z(-0.105 + i * 0.0), 0.039, 0.0015, 0.04, 'bore', 0.0); // wrist grip lines
  // ---- pump fore-end: ribbed walnut lathe over the tube + action bars (gunRig moves group 'pump')
  k.in('pump', () => {
    const pr: P = [[0.0005, 0.23], [0.0185, 0.23], [0.021, 0.236]];
    for (let i = 0; i < 7; i++) { const z = 0.248 + i * 0.016; pr.push([0.0215, z], [0.0185, z + 0.004], [0.0185, z + 0.008], [0.0215, z + 0.012]); }
    pr.push([0.0215, 0.37], [0.0195, 0.385], [0.0005, 0.385]);
    k.lathe(pr.map(([r, z]) => [r, Z(z)] as [number, number]), ty, 'wood', 14);
    for (const s of [-1, 1]) k.box(s * 0.0165, by - 0.012, Z(0.18), 0.0035, 0.012, 0.15, 'steel');
    k.box(0, ty, Z(0.225), 0.036, 0.034, 0.012, 'steel');
  });
  return {
    muzzle: new THREE.Vector3(0, by, Z(BE) + 0.003), eject: new THREE.Vector3(W / 2 + 0.01, by + 0.004, Z(0.04)),
    butt: new THREE.Vector3(0, by - 0.012, Z(-0.405)), support: new THREE.Vector3(0, ty - 0.012, Z(0.305)), grip: new THREE.Vector3(0, -0.012, Z(-0.075)),
  };
}
