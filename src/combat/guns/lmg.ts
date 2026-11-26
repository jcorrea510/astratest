/**
 * Model: lmg = "Anvil LMG" (see combat/weapons.ts for stats). Bespoke build: box receiver with hinged feed-tray cover and
 * rail, ventilated heat shield, quick-change barrel with carry handle, gas tube + sights, ventilated flash hider, folded
 * bipod, fixed polymer stock with lightening cut-outs. The ammo box hangs on the left with a brass link belt of 5.56
 * cartridges curving up into the feed tray (group 'mag', reloadKind 'belt'). Gun space metres, +z muzzle, bore axis y = 0.06.
 */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  const by = 0.06;

  // ---- receiver, feed-tray cover, rail, sights, charging handle, ejection / feed openings
  k.prof([[-0.12, -0.025], [0.28, -0.025], [0.28, 0.082], [0.0, 0.082], [-0.04, 0.072], [-0.12, 0.072]], 0.052, 'steel', 0.004);
  k.prof([[0.0, 0.082], [0.0, 0.1], [0.04, 0.115], [0.2, 0.115], [0.225, 0.098], [0.225, 0.082]], 0.046, 'steel', 0.004);
  k.rail(0.03, 0.19, 0.115, 0.02);
  k.cylX(0.006, 0.05, 0, 0.083, 0.0, 'steel', 8); // cover hinge
  k.box(0, 0.118, 0.215, 0.012, 0.01, 0.012, 'steel'); // cover latch
  k.box(0.0268, 0.05, 0.09, 0.001, 0.034, 0.075, 'bore'); // ejection port
  k.box(-0.0268, 0.045, 0.1, 0.001, 0.026, 0.07, 'bore'); // feed slot
  k.box(0.034, 0.089, 0.05, 0.012, 0.012, 0.045, 'steel'); // charging handle
  k.box(0, 0.088, -0.06, 0.02, 0.026, 0.014, 'steel'); // rear sight leaf
  for (const s of [-1, 1]) k.box(s * 0.007, 0.102, -0.06, 0.004, 0.012, 0.012, 'steel');
  for (let i = 0; i < 5; i++) for (const s of [-1, 1]) k.box(s * 0.0265, 0.0, -0.1 + i * 0.012, 0.002, 0.018, 0.004, 'polymer'); // receiver ribs
  k.cyl(0.018, -0.165, -0.11, 0.035, 'steel', 10); // stock tube / buffer

  // ---- pistol grip, trigger guard, trigger
  k.prof([[0.02, 0.012], [0.03, 0.005], [-0.005, -0.1], [-0.042, -0.098], [-0.03, -0.06], [-0.022, 0.012]], 0.034, 'polymer', 0.005);
  for (let i = 0; i < 5; i++) { const t = i / 4; for (const s of [-1, 1]) k.box(s * 0.0175, -0.015 - t * 0.065, -0.012 - t * 0.016, 0.002, 0.007, 0.026, 'bore'); }
  k.prof([[0.025, -0.01], [0.088, -0.01], [0.088, -0.034], [0.03, -0.038], [0.03, -0.03], [0.081, -0.028], [0.081, -0.018], [0.025, -0.018]], 0.008, 'polymer', 0.0015);
  k.prof([[0.045, -0.012], [0.052, -0.014], [0.05, -0.028], [0.046, -0.03]], 0.005, 'steel', 0.001);

  // ---- fixed stock with lightening cut-outs and butt pad
  k.prof([[-0.15, 0.045], [-0.375, 0.042], [-0.39, 0.03], [-0.39, -0.08], [-0.35, -0.085], [-0.24, -0.04], [-0.15, -0.03]], 0.042, 'polymer', 0.006);
  for (const s of [-1, 1]) k.box(s * 0.0215, 0.0, -0.27, 0.001, 0.045, 0.09, 'bore');
  k.box(0, -0.02, -0.388, 0.046, 0.12, 0.014, 'steel');

  // ---- quick-change barrel: heat shield, barrel, carry handle, gas tube + sight, bipod, flash hider
  k.lathe([[0.0, 0.28], [0.03, 0.28], [0.03, 0.46], [0.026, 0.466], [0.0, 0.466]], by, 'polymer', 16);
  for (const s of [-1, 1]) for (let row = 0; row < 2; row++) for (let z = 0.3; z < 0.45; z += 0.025) k.box(s * 0.0293, by - 0.012 + row * 0.024, z, 0.002, 0.008, 0.014, 'bore');
  k.lathe([[0.0, 0.26], [0.0125, 0.26], [0.0125, 0.84], [0.0145, 0.842], [0.0, 0.842]], by, 'steel', 14);
  k.box(0, 0.027, 0.285, 0.012, 0.02, 0.03, 'steel'); // barrel release latch
  k.cyl(0.0065, 0.26, 0.66, 0.083, 'steel', 8); // gas tube
  for (const z of [0.47, 0.56]) { k.cyl(0.0175, z - 0.01, z + 0.01, by, 'steel', 12); for (const s of [-1, 1]) k.prof([[z - 0.006, by + 0.01], [z + 0.006, by + 0.01], [z + 0.006, 0.108], [z - 0.006, 0.108]], 0.006, 'steel', 0.001, s * 0.014); }
  k.cyl(0.0075, 0.455, 0.575, 0.108, 'steel', 8); // carry handle bar
  k.box(0, 0.083, 0.62, 0.016, 0.02, 0.04, 'steel'); // gas block
  k.box(0, 0.1, 0.62, 0.003, 0.022, 0.004, 'steel'); for (const s of [-1, 1]) k.box(s * 0.008, 0.097, 0.62, 0.003, 0.016, 0.004, 'steel'); // front sight
  k.cyl(0.0175, 0.65, 0.67, by, 'steel', 12); k.box(0, 0.045, 0.66, 0.034, 0.016, 0.02, 'steel'); // bipod collar + pivot
  for (const s of [-1, 1]) { k.cyl(0.0042, 0.67, 0.76, 0.038, 'steel', 6, s * 0.012); k.cyl(0.0034, 0.76, 0.8, 0.038, 'steel', 6, s * 0.012); k.cyl(0.006, 0.8, 0.812, 0.038, 'polymer', 6, s * 0.012); }
  k.lathe([[0.0, 0.84], [0.0125, 0.84], [0.016, 0.848], [0.016, 0.895], [0.0, 0.895]], by, 'steel', 12);
  for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; k.box(Math.cos(a) * 0.0163, by + Math.sin(a) * 0.0163, 0.872, 0.0022, 0.0022, 0.022, 'bore'); }
  k.bore(0.008, 0.895, by);

  // ---- ammo box on the left + link belt of brass 5.56 rounds climbing into the feed tray (moves with the reload)
  k.in('mag', () => {
    k.box(-0.062, -0.032, 0.07, 0.07, 0.1, 0.13, 'olive');
    k.box(-0.062, 0.02, 0.07, 0.074, 0.008, 0.134, 'olive'); // lid
    k.box(-0.099, -0.024, 0.07, 0.004, 0.03, 0.02, 'steel'); // latch
    k.box(-0.062, 0.027, 0.07, 0.03, 0.008, 0.05, 'steel'); // carry strap mount
    for (const z of [0.03, 0.07, 0.11]) k.box(-0.0985, -0.036, z, 0.003, 0.08, 0.012, 'olive');
    const N = 8;
    for (let i = 0; i < N; i++) {
      const t = i / (N - 1);
      const x = -0.07 + 0.043 * t + 0.0 * t * t, y = 0.014 + 0.045 * Math.pow(t, 0.8);
      k.cyl(0.0057, 0.044, 0.1, y, 'brass', 8, x); // case
      k.cyl(0.0057, 0.1, 0.108, y, 'brass', 8, x, 0.0042); // shoulder
      k.cyl(0.0042, 0.108, 0.128, y, 'brass', 8, x, 0.0022); // bullet
      k.cyl(0.0069, 0.052, 0.062, y, 'steel', 6, x); // link ring
      k.cyl(0.0069, 0.082, 0.092, y, 'steel', 6, x);
      if (i < N - 1) { const dx = 0.043 / (N - 1); k.box(x + dx / 2, y + 0.003, 0.057, dx * 0.8, 0.004, 0.012, 'steel'); k.box(x + dx / 2, y + 0.003, 0.087, dx * 0.8, 0.004, 0.012, 'steel'); }
    }
  });

  return { muzzle: new THREE.Vector3(0, by, 0.898), eject: new THREE.Vector3(0.03, 0.065, 0.09), butt: new THREE.Vector3(0, -0.01, -0.392), support: new THREE.Vector3(0, 0.03, 0.38), grip: new THREE.Vector3(0, -0.048, -0.008) };
}
