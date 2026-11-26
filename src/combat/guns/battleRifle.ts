/**
 * Model: battleRifle "Granite 308" (see combat/weapons.ts for its name and stats).
 * Full-power long-stroke battle rifle: milled receiver, walnut stock + handguard, gas cylinder, winged front sight post,
 * rear aperture sight, 20-round box magazine, side charging handle, slotted muzzle brake. Bespoke (does not use longGun).
 */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  const by = 0.06;            // bore axis height
  const rt = by + 0.034;      // receiver top
  const rb = by - 0.036;      // receiver bottom
  const w = 0.036;            // receiver width

  // ---- receiver (steel): milled body with a raised rear bridge and a front ring
  k.prof([[-0.1, rb], [0.2, rb], [0.2, rt - 0.004], [0.14, rt], [0.0, rt], [-0.04, rt + 0.004], [-0.1, rt - 0.004]], w, 'steel', 0.003);
  k.prof([[-0.1, rb - 0.004], [0.115, rb - 0.004], [0.115, rb], [-0.1, rb]], w * 0.9, 'steel', 0.002);   // floorplate
  k.cyl(0.0205, 0.19, 0.23, by + 0.003, 'steel', 14);                                                 // barrel collar
  k.box(w / 2 + 0.0006, by + 0.01, 0.045, 0.0012, 0.024, 0.075, 'bore');                              // ejection port (right)
  k.box(w / 2 + 0.0004, by - 0.015, 0.005, 0.001, 0.006, 0.07, 'bore');                               // bolt track slot
  k.box(-w / 2 - 0.0004, by + 0.008, 0.08, 0.001, 0.02, 0.05, 'bore');                                // left lightening cut
  // charging handle (right side): stem + knob
  k.cylX(0.0045, 0.02, w / 2 + 0.008, by + 0.014, 0.026, 'steel', 8);
  k.cylX(0.0085, 0.01, w / 2 + 0.02, by + 0.014, 0.026, 'steel', 10);
  // safety lever in front of the trigger guard
  k.box(0, rb - 0.003, 0.058, 0.006, 0.004, 0.02, 'steel');
  // rear aperture sight: windage base, ears and ring
  k.box(0, rt + 0.006, -0.085, 0.022, 0.012, 0.03, 'steel');
  k.box(-0.0095, rt + 0.017, -0.075, 0.004, 0.012, 0.012, 'steel'); k.box(0.0095, rt + 0.017, -0.075, 0.004, 0.012, 0.012, 'steel');
  k.lathe([[0.0035, -0.099], [0.0085, -0.099], [0.0085, -0.091], [0.0035, -0.091]], rt + 0.022, 'steel', 12);
  k.cylX(0.004, 0.026, 0.0, rt + 0.017, -0.095, 'steel', 6);                                          // elevation knob axle

  // ---- trigger guard + trigger (steel / polymer)
  k.prof([[0.0, rb + 0.002], [0.088, rb + 0.002], [0.088, rb - 0.03], [0.074, rb - 0.036], [0.01, rb - 0.034], [0.006, rb - 0.026], [0.07, rb - 0.028], [0.08, rb - 0.021], [0.08, rb - 0.005], [0.0, rb - 0.005]], 0.008, 'steel', 0.0015);
  k.prof([[0.034, rb - 0.003], [0.041, rb - 0.003], [0.043, rb - 0.024], [0.036, rb - 0.026]], 0.005, 'steel', 0.001);

  // ---- wood: stock (comb, wrist, heel), pistol-grip swell, handguard
  const sb = -0.405;  // butt face
  k.prof([[-0.095, by + 0.026], [-0.13, by + 0.03], [-0.3, by + 0.047], [sb + 0.012, by + 0.05], [sb, by + 0.044], [sb, by - 0.092], [sb + 0.05, by - 0.096], [-0.2, by - 0.05], [-0.12, by - 0.048], [-0.095, by - 0.05]], 0.036, 'wood', 0.006);
  k.prof([[0.024, rb], [0.034, rb - 0.006], [0.0, -0.097], [-0.04, -0.099], [-0.036, -0.06], [-0.03, rb]], 0.03, 'wood', 0.005);   // grip
  k.prof([[0.2, by - 0.034], [0.34, by - 0.034], [0.5, by - 0.022], [0.5, by + 0.014], [0.34, by + 0.026], [0.2, by + 0.03]], 0.04, 'wood', 0.006);   // lower handguard
  k.prof([[0.23, by + 0.028], [0.5, by + 0.019], [0.5, by + 0.029], [0.23, by + 0.037]], 0.029, 'wood', 0.003);   // upper handguard
  for (const s of [-1, 1]) for (let z = 0.27; z < 0.48; z += 0.07) k.box(s * 0.0205, by - 0.004, z, 0.0012, 0.012, 0.03, 'bore');   // heat-vent slots
  k.prof([[0.5, by - 0.026], [0.512, by - 0.026], [0.512, by + 0.02], [0.5, by + 0.02]], 0.038, 'steel', 0.002);   // handguard cap

  // buttplate + sling swivels
  k.prof([[sb - 0.003, by + 0.048], [sb - 0.003, by - 0.096], [sb + 0.004, by - 0.096], [sb + 0.004, by + 0.048]], 0.038, 'polymer', 0.002);
  k.cylX(0.0045, 0.012, 0, by - 0.1, -0.18, 'steel', 6);
  k.cylX(0.0045, 0.012, 0, by - 0.036, 0.46, 'steel', 6);

  // ---- barrel, gas system, sights, muzzle
  const bz = 0.69;
  k.cyl(0.0105, 0.23, bz, by, 'steel', 14);
  k.cyl(0.0078, 0.44, 0.63, by - 0.0195, 'steel', 10);                                  // gas cylinder under the barrel
  k.box(0, by - 0.012, 0.64, 0.02, 0.026, 0.026, 'steel');                              // gas block / sight base band
  k.box(0, by - 0.01, 0.515, 0.014, 0.02, 0.016, 'steel');                              // cylinder retainer
  k.cyl(0.0125, 0.62, 0.66, by, 'steel', 14);                                           // sight band
  k.box(0, by + 0.0185, 0.64, 0.01, 0.013, 0.022, 'steel');                             // front sight base
  k.box(0, by + 0.0325, 0.64, 0.0028, 0.018, 0.004, 'steel');                           // front post
  k.box(-0.0085, by + 0.026, 0.64, 0.0028, 0.022, 0.016, 'steel');                      // wings
  k.box(0.0085, by + 0.026, 0.64, 0.0028, 0.022, 0.016, 'steel');
  k.box(0, by + 0.0155, 0.64, 0.024, 0.0025, 0.016, 'steel');
  // muzzle brake: ringed body with side ports
  k.lathe([[0.0105, bz - 0.01], [0.0165, bz - 0.006], [0.0165, bz + 0.058], [0.0125, bz + 0.058], [0.0125, bz + 0.0]], by, 'steel', 14);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.box(s * 0.0167, by, bz + 0.012 + i * 0.015, 0.0012, 0.01, 0.007, 'bore');
  k.box(0, by + 0.0167, bz + 0.03, 0.01, 0.0012, 0.03, 'bore');
  k.bore(0.0065, bz + 0.058, by);
  const mz = bz + 0.058;

  // ---- 20-round box magazine (moves with the reload): slightly curved, stamped ribs, baseplate
  k.in('mag', () => {
    const top = rb + 0.002, mz0 = 0.115;
    k.prof([[mz0 - 0.03, top], [mz0 + 0.026, top], [mz0 + 0.034, top - 0.07], [mz0 + 0.04, top - 0.13], [mz0 - 0.012, top - 0.13], [mz0 - 0.022, top - 0.07]], 0.027, 'steel', 0.003);
    for (let i = 0; i < 4; i++) { const t = (i + 1) / 5; k.box(0.0141, top - 0.13 * t, mz0 + 0.008 + 0.012 * t, 0.0012, 0.005, 0.044, 'steel'); k.box(-0.0141, top - 0.13 * t, mz0 + 0.008 + 0.012 * t, 0.0012, 0.005, 0.044, 'steel'); }
    k.box(0, top - 0.133, mz0 + 0.014, 0.03, 0.007, 0.062, 'polymer');
  });

  return {
    muzzle: new THREE.Vector3(0, by, mz + 0.003),
    eject: new THREE.Vector3(w / 2 + 0.008, by + 0.01, 0.045),
    butt: new THREE.Vector3(0, by - 0.02, sb - 0.003),
    support: new THREE.Vector3(0, by - 0.03, 0.37),
    grip: new THREE.Vector3(0, -0.048, -0.008),
  };
}
