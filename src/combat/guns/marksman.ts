/**
 * Model: marksman "Heron DMR" (see combat/weapons.ts for its name and stats).
 * Semi-auto designated marksman rifle: dark receiver, tan free-float handguard and adjustable stock with cheek riser,
 * 4x scope with turrets / eyepiece / objective bell on ring mounts, 10-round box magazine, slotted brake. Bespoke.
 */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  const by = 0.06, w = 0.034;
  const r0 = -0.09, r1 = 0.19;
  const top = by + 0.031;          // receiver top
  const rb = by - 0.037;           // receiver bottom
  const railY = top - 0.003;

  // ---- upper receiver + lower receiver (steel) with ejection port, dust cover, forward assist
  k.prof([[r0, by - 0.006], [r1, by - 0.006], [r1, top], [r0 + 0.012, top], [r0, top - 0.014]], w, 'steel', 0.003);
  k.prof([[r0 + 0.005, rb], [r1 - 0.012, rb], [r1 - 0.012, by - 0.006], [r0 + 0.005, by - 0.006]], w * 0.97, 'steel', 0.003);
  k.prof([[r1 - 0.05, rb - 0.003], [r1 - 0.012, rb - 0.003], [r1 - 0.02, rb - 0.026], [r1 - 0.052, rb - 0.024]], 0.024, 'steel', 0.002);   // magwell flare
  k.box(w / 2 + 0.0006, by + 0.012, 0.055, 0.0012, 0.022, 0.058, 'bore');                                                                // ejection port
  k.box(w / 2 + 0.0035, by + 0.01, 0.05, 0.002, 0.026, 0.066, 'steel');                                                                  // dust cover
  k.box(w / 2 + 0.008, by + 0.0, -0.005, 0.014, 0.01, 0.018, 'steel');                                                                   // forward assist
  k.box(-w / 2 - 0.004, by - 0.012, -0.045, 0.006, 0.012, 0.016, 'steel');                                                               // bolt release
  k.box(-w / 2 - 0.003, by - 0.022, 0.062, 0.006, 0.013, 0.02, 'steel');                                                                 // mag release
  k.box(-w / 2 - 0.004, by - 0.014, -0.008, 0.007, 0.004, 0.028, 'steel');                                                               // selector
  k.box(0, top - 0.0, -0.088, 0.024, 0.012, 0.022, 'steel');                                                                             // T-latch charging handle
  k.rail(r0 + 0.01, r1 + 0.31, railY, 0.021);                                                                                            // monolithic top rail

  // ---- trigger guard + trigger
  k.prof([[0.025, rb + 0.002], [0.085, rb + 0.002], [0.088, rb - 0.012], [0.078, rb - 0.022], [0.03, rb - 0.02], [0.03, rb - 0.012], [0.07, rb - 0.014], [0.078, rb - 0.01], [0.074, rb - 0.003], [0.025, rb - 0.003]], 0.008, 'polymer', 0.0015);
  k.prof([[0.045, rb - 0.002], [0.052, rb - 0.002], [0.05, rb - 0.02], [0.043, rb - 0.022]], 0.005, 'steel', 0.001);

  // ---- tan furniture: pistol grip, free-float handguard (round, vented), adjustable stock with cheek riser
  k.prof([[0.024, rb + 0.002], [0.034, rb - 0.004], [0.0, -0.1], [-0.046, -0.098], [-0.034, -0.06], [-0.028, rb]], 0.03, 'tan', 0.006);
  for (let i = 0; i < 4; i++) k.box(0.0158, -0.02 - i * 0.017, -0.015 - i * 0.002, 0.001, 0.007, 0.034, 'bore');                           // grip texture grooves
  const g0 = r1 - 0.012, g1 = r1 + 0.31;
  k.cyl(0.0265, g0, g1, by, 'tan', 16, 0, 0.0255);
  k.cyl(0.0295, g0, g0 + 0.016, by, 'steel', 16);                                                                                        // barrel nut
  k.cyl(0.0275, g1, g1 + 0.006, by, 'steel', 16);                                                                                        // end cap
  for (const s of [-1, 1]) for (let z = g0 + 0.035; z < g1 - 0.03; z += 0.036) k.box(s * 0.0262, by + 0.002, z, 0.0012, 0.016, 0.022, 'bore');   // side vents
  k.box(0, by - 0.0275, g1 - 0.06, 0.012, 0.012, 0.04, 'tan');                                                                          // bottom sling / bipod rail stub
  k.cylX(0.0045, 0.012, 0, by - 0.036, g1 - 0.055, 'steel', 6);

  // stock: buffer tube + body, cheek riser, butt pad
  const sb = -0.385;
  k.cyl(0.0155, sb + 0.06, r0 + 0.005, by - 0.003, 'steel', 12);
  for (let i = 0; i < 4; i++) k.box(0, by - 0.003 - 0.0158, r0 - 0.03 - i * 0.026, 0.006, 0.002, 0.012, 'bore');                          // adjustment detents
  k.prof([[r0 + 0.006, by + 0.02], [-0.16, by + 0.026], [-0.22, by + 0.03], [sb + 0.01, by + 0.036], [sb, by + 0.03], [sb, by - 0.09], [sb + 0.05, by - 0.092], [-0.22, by - 0.03], [r0 + 0.006, by - 0.03]], 0.04, 'tan', 0.007);
  k.prof([[-0.14, by + 0.022], [-0.15, by + 0.036], [-0.25, by + 0.055], [-0.3, by + 0.052], [-0.3, by + 0.034], [-0.2, by + 0.03]], 0.03, 'tan', 0.005);   // cheek riser
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.box(s * 0.0205, by - 0.03, -0.24 - i * 0.045, 0.0012, 0.03, 0.02, 'bore');         // lightening slots
  k.prof([[sb - 0.012, by + 0.034], [sb - 0.012, by - 0.094], [sb, by - 0.094], [sb, by + 0.034]], 0.042, 'polymer', 0.003);              // recoil pad
  k.cylX(0.0045, 0.012, 0, by - 0.095, -0.2, 'steel', 6);                                                                                // rear sling loop

  // ---- barrel (free-float), gas block, brake
  const bz = 0.74;
  k.cyl(0.0105, g1, bz, by, 'steel', 14);
  k.cyl(0.0125, g1 - 0.14, g1 - 0.115, by, 'steel', 12);                                                                                 // visible gas block ring
  k.lathe([[0.0105, bz - 0.005], [0.0165, bz - 0.001], [0.0165, bz + 0.06], [0.0125, bz + 0.06], [0.0125, bz + 0.0]], by, 'steel', 14);
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) k.box(s * 0.0167, by, bz + 0.012 + i * 0.015, 0.0012, 0.01, 0.007, 'bore');
  k.box(0, by + 0.0167, bz + 0.03, 0.01, 0.0012, 0.03, 'bore');
  k.bore(0.0065, bz + 0.06, by);
  const mz = bz + 0.06;

  // ---- 4x scope on two ring mounts
  const sy = railY + 0.0115 + 0.027;       // scope axis
  const s0 = -0.06, s1 = 0.255;
  k.lathe([
    [0.0, s0], [0.0165, s0], [0.0235, s0 + 0.004], [0.0225, s0 + 0.03], [0.0165, s0 + 0.052],           // eyepiece bell flaring out
    [0.0152, s0 + 0.07], [0.0152, s0 + 0.135], [0.017, s0 + 0.145], [0.017, s0 + 0.168], [0.0152, s0 + 0.178],   // main tube with a magnification ring
    [0.0152, s0 + 0.2], [0.0185, s0 + 0.22], [0.027, s0 + 0.248], [0.0285, s1 - 0.005], [0.0275, s1], [0.0, s1],
  ], sy, 'steel', 18);
  k.box(0, sy + 0.0152 + 0.007, s0 + 0.115, 0.017, 0.014, 0.017, 'steel');                              // top (elevation) turret
  k.cylY(0.0105, 0.012, 0, sy + 0.0152 + 0.0165, s0 + 0.115, 'steel', 12);                              // turret cap
  k.box(0.0152 + 0.007, sy, s0 + 0.115, 0.014, 0.017, 0.017, 'steel');                                  // side (windage) turret
  k.cylX(0.0105, 0.012, 0.0152 + 0.0165, sy, s0 + 0.115, 'steel', 12);
  k.cylX(0.0075, 0.01, -0.0152 - 0.006, sy, s0 + 0.115, 'steel', 8);                                    // parallax knob (left)
  for (const z of [0.0, 0.1]) {                                                                         // ring mounts
    k.cyl(0.0185, z - 0.011, z + 0.011, sy, 'steel', 14);
    k.box(0, sy - 0.0185 - 0.004, z, 0.034, 0.012, 0.03, 'steel');
    k.box(0, railY + 0.0115 + 0.003, z, 0.028, 0.006, 0.034, 'steel');
    k.cylX(0.004, 0.012, 0.0215, sy - 0.0125, z, 'steel', 6);                                           // cross-bolts
  }
  { const gl = (rr: number, z: number, flip: number) => { const g = new THREE.CircleGeometry(rr, 16); if (flip) g.rotateY(Math.PI); g.translate(0, sy, z); k.push(g, 'lens'); };
    gl(0.0255, s1 + 0.0008, 0); gl(0.0145, s0 - 0.0008, 1); }

  // ---- 10-round box magazine (reload animation moves it)
  k.in('mag', () => {
    const t = rb + 0.002, mzc = r1 - 0.047;
    k.prof([[mzc - 0.028, t], [mzc + 0.028, t], [mzc + 0.03, t - 0.1], [mzc - 0.025, t - 0.1]], 0.025, 'steel', 0.003);
    for (let i = 0; i < 3; i++) { const y = t - 0.025 - i * 0.025; k.box(0.0131, y, mzc + 0.004, 0.0012, 0.005, 0.046, 'steel'); k.box(-0.0131, y, mzc + 0.004, 0.0012, 0.005, 0.046, 'steel'); }
    k.box(0, t - 0.103, mzc + 0.003, 0.029, 0.007, 0.062, 'polymer');
  });

  return {
    muzzle: new THREE.Vector3(0, by, mz + 0.003),
    eject: new THREE.Vector3(w / 2 + 0.008, by + 0.012, 0.055),
    butt: new THREE.Vector3(0, by - 0.03, sb - 0.012),
    support: new THREE.Vector3(0, by - 0.026, 0.3),
    grip: new THREE.Vector3(0, -0.048, -0.008),
  };
}
