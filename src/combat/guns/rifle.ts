/**
 * Model: rifle ("Longline AR", 5.56 direct-impingement pattern). Also exports `buildAR`, the bespoke AR-pattern builder the
 * carbine reuses with a shorter handguard, tan furniture, different stock / muzzle device and a red dot.
 * Gun space: metres, +z muzzle, y up, bore axis at y = 0.06, firing-hand palm near the origin.
 */
import * as THREE from 'three';
import type { Kit, Built, Mat } from './kit';

export interface AROpt {
  guardLen: number;        // free-float handguard length
  barrelEnd: number;       // z of the barrel crown (before the muzzle device)
  furniture: Mat;          // handguard / grip / stock material
  stock: 'mil' | 'slim';
  stockLen: number;
  muzzle: 'birdcage' | 'brake';
  optic: 'irons' | 'dot';
}

export function buildAR(k: Kit, o: AROpt): Built {
  const by = 0.06, w = 0.032, f = o.furniture;
  const r0 = -0.08, r1 = 0.175, upTop = by + 0.03, upBot = by - 0.012;
  // ---- upper receiver, lower receiver, magwell flare
  k.prof([[r0, upBot], [r0, upTop - 0.004], [r0 + 0.006, upTop], [r1 - 0.004, upTop], [r1, upTop - 0.006], [r1, upBot]], w, 'steel', 0.003);
  k.prof([[-0.082, 0.05], [-0.082, 0.022], [-0.066, 0.012], [0.04, 0.012], [0.046, 0.006], [0.062, 0.006], [0.07, 0.012], [0.118, 0.012], [0.118, 0.05]], w * 0.96, 'steel', 0.003);
  k.box(0, 0.026, 0.092, w + 0.008, 0.03, 0.062, 'steel');              // flared magwell
  k.box(0, 0.011, 0.092, w + 0.01, 0.004, 0.066, 'steel');
  // ejection port with dust cover, forward assist, charging handle, pins, selector, releases
  k.box(w / 2 + 0.0004, by + 0.004, 0.035, 0.0012, 0.026, 0.07, 'bore');
  k.prof([[0.0, by - 0.008], [0.072, by - 0.008], [0.072, by + 0.018], [0.0, by + 0.018]], 0.0016, 'steel', 0.0008, w / 2 + 0.0001);
  k.cylX(0.0045, 0.012, w / 2 + 0.006, by + 0.004, -0.058, 'steel', 8);   // forward assist
  k.cylX(0.0075, 0.005, w / 2 + 0.009, by + 0.004, -0.058, 'steel', 8);
  k.box(0, upTop - 0.003, -0.085, 0.026, 0.016, 0.03, 'polymer');          // charging handle
  k.box(0.0, upTop - 0.004, -0.098, 0.034, 0.012, 0.01, 'steel');
  k.cylX(0.0045, w + 0.012, 0, 0.033, -0.07, 'steel', 8);                  // rear takedown pin
  k.cylX(0.0045, w + 0.012, 0, 0.033, 0.098, 'steel', 8);                  // pivot pin
  k.cylX(0.006, 0.01, -w * 0.48 - 0.005, 0.034, -0.002, 'steel', 8);       // selector (left)
  k.box(-w * 0.48 - 0.002, 0.02, 0.058, 0.008, 0.012, 0.016, 'steel');     // mag release
  k.box(w * 0.48 + 0.002, 0.034, 0.034, 0.005, 0.014, 0.01, 'steel');      // bolt catch
  // ---- pistol grip (angled, with ribs), trigger guard, trigger
  k.prof([[0.02, 0.016], [0.03, 0.008], [0.001, -0.108], [-0.044, -0.104], [-0.032, -0.05], [-0.03, 0.016]], w * 0.84, f, 0.005);
  k.box(0, -0.103, -0.02, w * 0.84, 0.007, 0.046, f);                       // grip cap
  for (let i = 0; i < 4; i++) k.box(0, -0.01 - i * 0.022, 0.017 - i * 0.012, w * 0.86, 0.004, 0.006, f);
  k.prof([[0.09, 0.016], [0.09, -0.01], [0.072, -0.018], [0.034, -0.014], [0.034, -0.008], [0.068, -0.012], [0.082, -0.004], [0.082, 0.016]], 0.009, 'steel', 0.0015);
  k.prof([[0.05, 0.016], [0.058, 0.014], [0.052, -0.006], [0.046, -0.004]], 0.005, 'steel', 0.001);
  // ---- buffer tube + stock
  k.cyl(0.0125, r0 - o.stockLen + 0.02, r0 + 0.004, by - 0.004, 'steel', 12);
  const sb = r0 - o.stockLen; // butt face z
  if (o.stock === 'mil') {
    k.prof([[r0 - 0.012, by + 0.02], [sb + 0.012, by + 0.026], [sb, by + 0.02], [sb - 0.002, by - 0.066], [sb + 0.03, by - 0.07], [sb + 0.07, by - 0.032], [r0 - 0.012, by - 0.03]], 0.036, f, 0.006);
    k.box(0, by - 0.023, sb - 0.003, 0.038, 0.088, 0.008, 'bore');           // rubber butt pad
    for (let i = 0; i < 5; i++) k.box(0, by - 0.034, r0 - 0.03 - i * 0.026, 0.038, 0.004, 0.004, 'bore'); // adjustment slots
    k.box(0, by - 0.036, r0 - 0.03, 0.012, 0.01, 0.03, 'steel');            // adjustment lever
  } else {
    k.prof([[r0 - 0.012, by + 0.022], [sb + 0.01, by + 0.028], [sb, by + 0.02], [sb + 0.004, by - 0.062], [sb + 0.028, by - 0.066], [sb + 0.05, by - 0.03], [sb + 0.1, by - 0.03], [r0 - 0.012, by - 0.026]], 0.03, f, 0.005);
    k.box(0, by - 0.022, sb - 0.003, 0.032, 0.086, 0.007, 'bore');
    k.box(0, by - 0.034, r0 - 0.03, 0.012, 0.01, 0.03, 'steel');
  }
  k.cylX(0.0045, w + 0.018, 0, by - 0.03, r0 - 0.018, 'steel', 8);          // receiver-end sling plate
  k.cylX(0.004, 0.044, 0, by - 0.058, sb + 0.026, 'steel', 8);              // stock sling loop
  k.cylX(0.0035, 0.034, 0, by + 0.012, r1 + o.guardLen + 0.02, 'steel', 8); // front sling point
  // ---- flat-top rail + free-float M-LOK handguard
  k.rail(r0 + 0.008, r1, upTop - 0.003, 0.021);
  const g0 = r1, g1 = r1 + o.guardLen, gr = 0.0215;
  k.cyl(gr * 1.12, g0 - 0.012, g0 + 0.004, by, 'steel', 14);                // barrel nut / cap
  k.cyl(gr, g0, g1, by, f, 14, 0, gr * 0.96);
  k.cyl(gr * 1.04, g1 - 0.006, g1, by, 'steel', 14);                        // end cap
  k.rail(g0, g1 - 0.006, by + gr * 0.94, 0.02);
  for (let z = g0 + 0.016; z < g1 - 0.03; z += 0.026) {
    for (const s of [-1, 1]) { k.box(s * gr * 0.97, by, z, 0.0026, 0.012, 0.016, 'bore'); k.box(s * gr * 0.7, by - gr * 0.7, z, 0.012, 0.0026, 0.016, 'bore'); }
    k.box(0, by - gr * 0.99, z, 0.012, 0.0026, 0.016, 'bore');
  }
  // ---- barrel, gas block / folding front sight, muzzle device
  const bz = o.barrelEnd, br = 0.0075;
  k.cyl(br, g1 - 0.01, bz, by, 'steel', 12);
  const gb = g1 + 0.012;
  k.cyl(0.0115, gb - 0.012, gb + 0.012, by, 'steel', 12);
  k.box(0, by + 0.014, gb, 0.01, 0.014, 0.012, 'steel');
  k.box(0, by + 0.03, gb, 0.004, 0.022, 0.004, 'steel');                    // front post
  let mz: number;
  if (o.muzzle === 'birdcage') {
    mz = bz + 0.046;
    k.cyl(0.0105, bz - 0.006, bz + 0.008, by, 'steel', 12);                 // crush-washer collar
    k.cyl(0.0125, bz + 0.008, mz, by, 'steel', 12);
    for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; k.box(Math.cos(a) * 0.0127, by + Math.sin(a) * 0.0127, bz + 0.03, 0.003, 0.003, 0.026, 'bore'); }
    k.cyl(0.0132, mz - 0.004, mz, by, 'steel', 12);
    k.bore(0.0058, mz, by);
  } else {
    mz = bz + 0.052;
    k.cyl(0.0105, bz - 0.006, bz + 0.006, by, 'steel', 12);
    k.cyl(0.0142, bz + 0.006, mz, by, 'steel', 14);
    for (let i = 0; i < 3; i++) k.box(0, by, bz + 0.016 + i * 0.012, 0.031, 0.008, 0.005, 'bore');
    k.bore(0.0058, mz, by);
  }
  // ---- sights
  const rail = upTop + 0.006;
  if (o.optic === 'irons') {
    k.box(0, rail + 0.006, -0.03, 0.016, 0.012, 0.03, 'steel');            // folding rear sight base
    k.box(-0.008, rail + 0.019, -0.03, 0.004, 0.016, 0.008, 'steel');
    k.box(0.008, rail + 0.019, -0.03, 0.004, 0.016, 0.008, 'steel');
    k.cylX(0.004, 0.02, 0, rail + 0.012, -0.044, 'steel', 8);
  } else {
    // tube red dot on a QD mount
    const sy = rail + 0.03, z0 = 0.02, z1 = 0.092;
    k.box(0, rail + 0.008, 0.055, 0.024, 0.016, 0.06, 'steel');
    k.cyl(0.0165, z0, z1, sy, 'steel', 16);
    k.cyl(0.0205, z0 - 0.006, z0 + 0.012, sy, 'steel', 16, 0, 0.0165);
    k.cyl(0.0185, z1 - 0.012, z1 + 0.004, sy, 'steel', 16, 0, 0.0165);
    k.cylY(0.006, 0.01, 0, sy + 0.02, 0.056, 'steel', 8);
    k.cylX(0.006, 0.012, 0.0175, sy, 0.056, 'steel', 8);
    for (const [r, z, ry] of [[0.0165, z0 - 0.0062, Math.PI], [0.0158, z1 + 0.0042, 0]] as const) {
      const g = new THREE.CircleGeometry(r, 16); g.rotateY(ry); g.translate(0, sy, z); k.push(g, 'lens');
    }
    k.box(0, rail + 0.006, -0.03, 0.016, 0.012, 0.03, 'steel');            // backup folded iron
    k.box(0, rail + 0.016, -0.03, 0.01, 0.008, 0.008, 'steel');
  }
  // ---- 30-round curved magazine with ribs and floorplate
  k.in('mag', () => {
    const top = 0.034, n = 8, L = 0.178, pts: [number, number][] = [];
    const zc = (t: number) => 0.094 + 0.052 * t * t + 0.004 * t;
    for (let i = 0; i <= n; i++) { const t = i / n; pts.push([zc(t) - 0.0185 + 0.002 * t, top - L * t]); }
    for (let i = n; i >= 0; i--) { const t = i / n; pts.push([zc(t) + 0.0195 + 0.004 * t, top - L * t]); }
    k.prof(pts, 0.0245, 'polymer', 0.003);
    for (let i = 1; i < 9; i++) { const t = 0.1 + i * 0.09; k.box(0, top - L * t, zc(t) + 0.001, 0.0265, 0.004, 0.034, 'polymer'); }
    k.box(0, top - L - 0.003, zc(1) + 0.004, 0.027, 0.007, 0.046, 'polymer');
  });
  const support = new THREE.Vector3(0, by - gr * 0.92, (g0 + g1) / 2);
  return { muzzle: new THREE.Vector3(0, by, mz + 0.003), eject: new THREE.Vector3(w / 2 + 0.01, by + 0.005, 0.03), butt: new THREE.Vector3(0, by - 0.03, sb - 0.004), support, grip: new THREE.Vector3(0, -0.045, -0.01) };
}

export function build(k: Kit): Built {
  return buildAR(k, { guardLen: 0.28, barrelEnd: 0.6, furniture: 'polymer', stock: 'mil', stockLen: 0.2, muzzle: 'birdcage', optic: 'irons' });
}
