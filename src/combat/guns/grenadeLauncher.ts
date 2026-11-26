/** Model: grenadeLauncher "Thumper 40" (see combat/weapons.ts). Six-shot rotary 40 mm launcher; the cylinder is the 'slide' group. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  const by = 0.07;            // bore height
  const R = 0.042;            // chamber ring radius
  const cy = by - R;          // cylinder axis height (top chamber lines up with the barrel)
  // ---- rotary cylinder (moving group): body, index bands, ratchet hub, six chambers with dark mouths
  k.in('slide', () => {
    k.lathe([[0.0, 0.07], [0.058, 0.07], [0.066, 0.078], [0.07, 0.09], [0.0715, 0.12], [0.0715, 0.26], [0.07, 0.28], [0.064, 0.298], [0.062, 0.304], [0.0, 0.304]], cy, 'steel', 24);
    k.lathe([[0.0715, 0.14], [0.074, 0.148], [0.074, 0.156], [0.0715, 0.164]], cy, 'steel', 24);
    k.lathe([[0.0715, 0.2], [0.074, 0.208], [0.074, 0.216], [0.0715, 0.224]], cy, 'steel', 24);
    k.lathe([[0.03, 0.066], [0.034, 0.07], [0.034, 0.08], [0.03, 0.084]], cy, 'polymer', 14);
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2, x = Math.sin(a) * R, y = cy + Math.cos(a) * R;
      k.cyl(0.0265, 0.296, 0.3045, y, 'steel', 12, x);       // chamber lip
      k.cyl(0.0215, 0.298, 0.3065, y, 'bore', 12, x);         // dark open mouth
      const b = a + Math.PI / 6;
      k.box(Math.sin(b) * 0.0715, cy + Math.cos(b) * 0.0715, 0.19, 0.006, 0.006, 0.12, 'polymer'); // flutes between chambers
    }
  });
  // ---- frame: receiver, strap over the cylinder, belly plate, cheeks
  k.prof([[-0.08, by - 0.045], [0.1, by - 0.045], [0.1, by + 0.038], [-0.02, by + 0.038], [-0.07, by + 0.026], [-0.08, by + 0.01]], 0.046, 'steel', 0.005);
  k.prof([[0.1, by - 0.008], [0.3, by - 0.008], [0.3, by + 0.03], [0.1, by + 0.03]], 0.05, 'steel', 0.004);
  k.box(0, cy - 0.076, 0.19, 0.05, 0.012, 0.22, 'steel');
  k.box(0.037, cy, 0.17, 0.006, 0.07, 0.2, 'steel'); k.box(-0.037, cy, 0.17, 0.006, 0.07, 0.2, 'steel');
  k.cylX(0.008, 0.1, 0, cy, 0.075, 'steel', 8);
  // ---- barrel: heavy rifled barrel with shroud, vents and clamp rings
  k.lathe([[0.0, 0.3], [0.03, 0.3], [0.03, 0.4], [0.032, 0.405], [0.032, 0.5], [0.0285, 0.505], [0.0285, 0.54], [0.034, 0.545], [0.034, 0.56], [0.0, 0.56]], by, 'steel', 18);
  k.bore(0.0215, 0.56, by);
  for (let i = 0; i < 4; i++) { k.box(0.0315, by, 0.32 + i * 0.022, 0.004, 0.018, 0.012, 'bore'); k.box(-0.0315, by, 0.32 + i * 0.022, 0.004, 0.018, 0.012, 'bore'); }
  for (const z of [0.31, 0.4, 0.52]) k.cyl(0.036, z - 0.006, z + 0.006, by, 'polymer', 16);
  // ---- top rail, reflex sight, iron sights
  k.rail(-0.05, 0.29, by + 0.038, 0.022);
  k.redDot(0.06, by + 0.05);
  k.irons(0.5, -0.07, by + 0.038);
  // ---- forward grip on an under-barrel mount
  k.box(0, by - 0.036, 0.405, 0.03, 0.014, 0.07, 'steel');
  k.prof([[0.385, by - 0.04], [0.425, by - 0.04], [0.43, by - 0.075], [0.425, by - 0.12], [0.39, by - 0.12], [0.382, by - 0.075]], 0.032, 'polymer', 0.006);
  for (let i = 0; i < 4; i++) k.box(0, by - 0.06 - i * 0.015, 0.4075, 0.034, 0.003, 0.046, 'steel');
  // ---- pistol grip, trigger guard, trigger, pivot, safety
  k.prof([[0.02, 0.012], [0.032, 0.005], [-0.003, -0.105], [-0.045, -0.1], [-0.03, -0.06], [-0.022, 0.012]], 0.034, 'polymer', 0.006);
  k.prof([[0.02, by - 0.045], [0.085, by - 0.045], [0.088, by - 0.065], [0.07, by - 0.075], [0.03, by - 0.075], [0.02, by - 0.06]], 0.012, 'steel', 0.002);
  k.box(0, by - 0.058, 0.045, 0.01, 0.026, 0.008, 'steel', -0.2);
  k.cylX(0.007, 0.056, 0, by + 0.01, -0.06, 'steel', 8);
  k.box(0.03, by + 0.004, 0.0, 0.006, 0.014, 0.03, 'steel');
  // ---- telescoping stock: rods, locking collar, buttplate with rubber pad
  k.cyl(0.0085, -0.32, -0.07, by - 0.022, 'steel', 8, 0.02); k.cyl(0.0085, -0.32, -0.07, by - 0.022, 'steel', 8, -0.02);
  k.box(0, by - 0.022, -0.1, 0.06, 0.03, 0.026, 'polymer'); k.cylX(0.01, 0.07, 0, by - 0.022, -0.1, 'steel', 8);
  k.prof([[-0.335, by + 0.03], [-0.3, by + 0.034], [-0.3, by - 0.09], [-0.325, by - 0.095], [-0.338, by - 0.03]], 0.04, 'polymer', 0.006);
  k.box(0, by - 0.03, -0.339, 0.042, 0.115, 0.006, 'polymer');
  k.box(0, by - 0.022, -0.275, 0.05, 0.02, 0.02, 'steel');
  const sling = new THREE.TorusGeometry(0.009, 0.0025, 6, 10); sling.rotateY(Math.PI / 2); sling.translate(-0.026, by - 0.03, -0.075); k.push(sling, 'steel');
  return { muzzle: new THREE.Vector3(0, by, 0.56), eject: new THREE.Vector3(0.03, by, 0.2), butt: new THREE.Vector3(0, by, -0.34), support: new THREE.Vector3(0, by - 0.075, 0.405) };
}
