/** Model: sawnoff "Stub Twin" - sawed-off side-by-side 12 gauge: twin barrels with rib, round-action break action with top lever, twin hammers, splinter fore-end, walnut pistol-grip stock. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

/** Trigger guard: an elliptical hoop (side profile), front point at (cz + rx, cy) swinging down and back to (cz - rx, cy). */
function guard(k: Kit, cz: number, cy: number, rx: number, ry: number, th: number, w: number) {
  const pts: [number, number][] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([cz + rx * Math.cos(a), cy - ry * Math.sin(a)]); }
  for (let i = n; i >= 0; i--) { const a = (i / n) * Math.PI; pts.push([cz + (rx - th) * Math.cos(a), cy - (ry - th) * Math.sin(a)]); }
  k.prof(pts, w, 'steel', 0.0012);
}

export function build(k: Kit): Built {
  const by = 0.06, bx = 0.0125, mz = 0.345;
  // ---- barrels: two tubes with a slightly flared breech, sawn muzzle with visible bores, ribs between
  for (const x of [-bx, bx]) {
    k.lathe([[0.0001, 0.03], [0.0134, 0.03], [0.0132, 0.075], [0.0127, 0.12], [0.0125, mz - 0.004], [0.0112, mz], [0.0092, mz]], by, 'steel', 20, x).cyl(0.0092, mz - 0.002, mz + 0.0008, by, 'bore', 14, x);
  }
  k.box(0, by + 0.0112, 0.2, 0.0062, 0.0048, mz - 0.06, 'steel'); // top rib
  k.box(0, by - 0.0112, 0.2, 0.0062, 0.0048, mz - 0.06, 'steel'); // bottom rib
  k.cylY(0.0021, 0.006, 0, by + 0.0165, mz - 0.012, 'brass', 8); // bead sight
  k.box(0, by + 0.0128, 0.34, 0.009, 0.004, 0.012, 'steel'); // sight block at the sawn end

  // ---- receiver (round boxlock action): body, sideplate discs, hinge pin, top lever, twin hammers
  k.prof([[-0.056, 0.026], [-0.05, 0.016], [0.02, 0.014], [0.058, 0.022], [0.075, 0.034], [0.075, by + 0.0125], [0.03, by + 0.0185], [-0.04, by + 0.0185], [-0.056, by + 0.012]], 0.044, 'steel', 0.004);
  for (const sx of [1, -1]) {
    k.cylX(0.0175, 0.0024, sx * 0.0225, by - 0.014, 0.012, 'steel', 22);
    k.cylX(0.0036, 0.0032, sx * 0.0235, by - 0.014, 0.012, 'brass', 10);
  }
  k.cylX(0.0045, 0.052, 0, by - 0.022, 0.07, 'steel', 10); // hinge pin
  k.prof([[-0.05, by + 0.0175], [-0.025, by + 0.0195], [-0.012, by + 0.0235], [-0.012, by + 0.0265], [-0.028, by + 0.0235], [-0.05, by + 0.0215]], 0.0065, 'brass', 0.0012); // top lever
  for (const x of [-0.0105, 0.0105]) k.prof([[-0.04, by + 0.012], [-0.05, by + 0.015], [-0.057, by + 0.028], [-0.0535, by + 0.0365], [-0.045, by + 0.034], [-0.0395, by + 0.022], [-0.034, by + 0.014]], 0.0072, 'steel', 0.001, x);

  // ---- splinter fore-end, barrel loop, fore-end latch
  k.prof([[0.078, by - 0.009], [0.236, by - 0.009], [0.244, by - 0.02], [0.236, by - 0.033], [0.2, by - 0.0365], [0.09, by - 0.0365], [0.078, by - 0.03]], 0.037, 'wood', 0.008);
  k.box(0, by - 0.0105, 0.242, 0.04, 0.012, 0.006, 'steel'); // barrel loop / fore-end tip band
  k.box(0, by - 0.0368, 0.085, 0.008, 0.004, 0.014, 'steel'); // latch plate

  // ---- trigger guard with two triggers
  guard(k, 0.045, 0.018, 0.027, 0.028, 0.0036, 0.009);
  for (const z of [0.036, 0.054]) k.prof([[z - 0.003, 0.02], [z + 0.003, 0.02], [z + 0.002, 0.006], [z + 0.007, -0.002], [z + 0.002, -0.004], [z - 0.004, 0.004]], 0.0045, 'steel', 0.001);

  // ---- cut-down walnut pistol-grip stock with steel cap
  k.prof([[-0.05, by + 0.016], [-0.076, by + 0.004], [-0.088, -0.02], [-0.085, -0.04], [-0.079, -0.07], [-0.072, -0.09], [-0.024, -0.097], [-0.021, -0.07], [-0.013, -0.03], [-0.004, 0.0], [0.002, 0.016], [-0.045, 0.02]], 0.038, 'wood', 0.008);
  k.prof([[-0.0735, -0.088], [-0.0225, -0.0955], [-0.0225, -0.1005], [-0.0735, -0.0935]], 0.037, 'steel', 0.0015);
  return { muzzle: new THREE.Vector3(0, by, mz), eject: new THREE.Vector3(0.02, by + 0.02, 0.05), support: new THREE.Vector3(0, by - 0.035, 0.17), grip: new THREE.Vector3(0, -0.035, -0.045) };
}
