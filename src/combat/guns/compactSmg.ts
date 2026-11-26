/**
 * Model: compactSmg "Mako Compact" - stamped-steel 9 mm micro SMG: tube-and-cover receiver, perforated barrel shroud,
 * short compensated barrel, side-folded wire stock (stowed along the left), textured grip, 20-round pistol magazine.
 * Gun space: metres, +z muzzle, y up, bore axis y = 0.06, firing-hand grip at the origin.
 */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

const BY = 0.06;
const LEAN = 0.144; // grip / magazine lean: z gained per metre of height
const cz = (y: number) => -0.013 + LEAN * (y + 0.048); // grip centre line (z at height y)

export function build(k: Kit): Built {
  // ---- receiver: lower body + stamped top cover with a bevelled nose
  k.prof([[-0.058, 0.03], [0.11, 0.03], [0.116, 0.036], [0.116, 0.07], [-0.058, 0.072]], 0.034, 'steel', 0.005);
  k.prof([[-0.056, 0.068], [0.112, 0.068], [0.112, 0.082], [0.104, 0.09], [-0.046, 0.09], [-0.056, 0.082]], 0.028, 'steel', 0.004);
  // receiver seam, ejection port, selector slot
  k.box(0.0172, 0.0695, 0.03, 0.0009, 0.0013, 0.17, 'bore'); k.box(-0.0172, 0.0695, 0.03, 0.0009, 0.0013, 0.17, 'bore');
  k.box(0.0173, 0.056, 0.032, 0.0012, 0.016, 0.046, 'bore');
  k.box(-0.0173, 0.046, 0.045, 0.0012, 0.004, 0.05, 'bore');
  // barrel bushing nut, perforated shroud, barrel, compensator
  k.lathe([[0.001, 0.108], [0.0158, 0.108], [0.0158, 0.12], [0.0138, 0.123], [0.001, 0.123]], BY, 'steel', 16);
  k.lathe([[0.0136, 0.12], [0.0136, 0.163], [0.012, 0.166]], BY, 'steel', 16);
  for (let i = 0; i < 6; i++) {
    const z = 0.127 + i * 0.0062;
    k.box(0, BY + 0.0135, z, 0.006, 0.0014, 0.0034, 'bore'); k.box(0.0135, BY, z, 0.0014, 0.006, 0.0034, 'bore'); k.box(-0.0135, BY, z, 0.0014, 0.006, 0.0034, 'bore');
  }
  k.cyl(0.0082, 0.163, 0.184, BY, 'steel', 12);
  k.lathe([[0.0082, 0.18], [0.0112, 0.182], [0.0112, 0.2], [0.0092, 0.2025], [0.001, 0.2025]], BY, 'steel', 14);
  for (let i = 0; i < 3; i++) { const z = 0.1865 + i * 0.0049; k.box(0, BY + 0.0112, z, 0.007, 0.0012, 0.0024, 'bore'); k.box(0.0112, BY, z, 0.0012, 0.007, 0.0024, 'bore'); k.box(-0.0112, BY, z, 0.0012, 0.007, 0.0024, 'bore'); }
  k.bore(0.0058, 0.2025, BY);
  // rear cap and screw, sling loop, cross pins
  k.cyl(0.0165, -0.07, -0.056, 0.058, 'steel', 14); k.cyl(0.0065, -0.074, -0.07, 0.058, 'steel', 8);
  k.prof([[-0.05, 0.034], [-0.078, 0.034], [-0.078, 0.018], [-0.05, 0.018], [-0.05, 0.022], [-0.074, 0.022], [-0.074, 0.03], [-0.05, 0.03]], 0.004, 'steel', 0.0008);
  k.cylX(0.0028, 0.038, 0, 0.043, 0.0, 'steel', 8); k.cylX(0.0028, 0.038, 0, 0.044, 0.088, 'steel', 8);
  // sights: rear aperture ears either side of the notch, hooded front post on the shroud
  k.box(0, 0.092, -0.046, 0.016, 0.006, 0.016, 'steel'); k.box(0.0055, 0.099, -0.046, 0.0035, 0.012, 0.009, 'steel'); k.box(-0.0055, 0.099, -0.046, 0.0035, 0.012, 0.009, 'steel');
  k.box(0, BY + 0.016, 0.15, 0.012, 0.014, 0.014, 'steel'); k.box(0, BY + 0.03, 0.15, 0.0035, 0.016, 0.004, 'steel');
  k.box(0.0065, BY + 0.03, 0.15, 0.0026, 0.02, 0.01, 'steel'); k.box(-0.0065, BY + 0.03, 0.15, 0.0026, 0.02, 0.01, 'steel');
  // cocking handle (right) with knob
  k.cylX(0.0035, 0.018, 0.021, 0.08, 0.02, 'steel', 8); k.cylX(0.0068, 0.008, 0.0315, 0.08, 0.02, 'steel', 12);
  // selector lever (left) and trigger guard + trigger
  k.prof([[-0.022, 0.036], [0.0, 0.036], [0.003, 0.042], [-0.004, 0.047], [-0.02, 0.046]], 0.004, 'steel', 0.001, -0.019);
  k.prof([[0.0, 0.034], [0.062, 0.034], [0.062, 0.004], [0.054, -0.006], [0.02, -0.006], [0.02, 0.0], [0.05, 0.0], [0.056, 0.006], [0.056, 0.03], [0.0, 0.03]], 0.008, 'steel', 0.0015);
  k.prof([[0.028, 0.033], [0.036, 0.033], [0.034, 0.014], [0.027, 0.006], [0.023, 0.01]], 0.005, 'steel', 0.001);
  // grip: polymer shell with backstrap, side ribs and heel
  const g: [number, number][] = [[0.02, 0.036], [0.014, 0.0], [0.0, -0.105], [-0.045, -0.105], [-0.037, -0.06], [-0.025, 0.0], [-0.012, 0.032]];
  k.prof(g, 0.03, 'polymer', 0.005);
  for (let y = 0.022; y > -0.1; y -= 0.0085) for (const s of [-1, 1]) k.box(s * 0.0153, y, cz(y) - 0.002, 0.0012, 0.0022, 0.026, 'polymer', 0.143);
  // magazine (moves on reload): ribbed steel stick with witness holes and a polymer floorplate
  k.in('mag', () => {
    const t = -0.03, b = -0.142, w = 0.014;
    k.prof([[cz(t) - w, t], [cz(t) + w, t], [cz(b) + w, b], [cz(b) - w, b]], 0.022, 'steel', 0.002);
    for (let y = -0.112; y > -0.14; y -= 0.007) { k.box(0.0113, y, cz(y), 0.0008, 0.0022, 0.026, 'steel', 0.143); k.box(-0.0113, y, cz(y), 0.0008, 0.0022, 0.026, 'steel', 0.143); }
    for (let i = 0; i < 3; i++) k.box(0.0113, -0.118 - i * 0.008, cz(-0.12) + 0.004, 0.0008, 0.0026, 0.0026, 'bore');
    k.box(0, b - 0.003, cz(b) + 0.001, 0.027, 0.007, 0.04, 'polymer', 0.143);
  });
  // side-folded wire stock lying along the left of the receiver (hinge at the rear, butt plate forward)
  const sx = -0.0255;
  k.box(sx + 0.002, 0.058, -0.06, 0.01, 0.042, 0.012, 'steel');
  k.cyl(0.0033, -0.06, 0.12, 0.076, 'steel', 8, sx); k.cyl(0.0033, -0.06, 0.12, 0.04, 'steel', 8, sx);
  k.box(sx, 0.058, 0.121, 0.0045, 0.05, 0.01, 'steel'); k.box(sx, 0.058, 0.1275, 0.0065, 0.048, 0.004, 'polymer');
  return {
    muzzle: new THREE.Vector3(0, BY, 0.2045), eject: new THREE.Vector3(0.02, 0.06, 0.03),
    grip: new THREE.Vector3(0, -0.048, -0.013), support: new THREE.Vector3(0, 0.043, 0.143),
  };
}
