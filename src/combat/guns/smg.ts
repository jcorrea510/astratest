/**
 * Model: smg "Vandal 9" - full-size 9 mm SMG: rounded stamped receiver with top rail and tube red-dot, bulbous slotted
 * handguard, hooded front sight, three-prong flash hider, curved 30-round magazine, retractable wire stock.
 * Gun space: metres, +z muzzle, y up, bore axis y = 0.06, firing-hand grip at the origin.
 */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

const BY = 0.06;
const LEAN = 0.144;
const cz = (y: number) => -0.013 + LEAN * (y + 0.048); // grip centre line

export function build(k: Kit): Built {
  // ---- receiver: lower body + round top (lathe), rear stock block, cap
  k.prof([[-0.082, 0.032], [0.16, 0.032], [0.168, 0.04], [0.168, 0.066], [-0.082, 0.066]], 0.036, 'steel', 0.005);
  k.lathe([[0.001, -0.084], [0.0165, -0.084], [0.0192, -0.079], [0.0192, 0.162], [0.0172, 0.168], [0.001, 0.168]], 0.062, 'steel', 16);
  k.box(0.0187, 0.046, 0.04, 0.0012, 0.004, 0.09, 'bore'); k.box(-0.0187, 0.046, 0.04, 0.0012, 0.004, 0.09, 'bore'); // seams / selector slot
  k.box(0.0189, 0.058, 0.03, 0.0012, 0.018, 0.058, 'bore'); // ejection port
  k.box(0.0194, 0.074, 0.044, 0.0012, 0.0012, 0.04, 'bore'); // bolt-track line
  k.cylX(0.003, 0.04, 0, 0.044, 0.01, 'steel', 8); k.cylX(0.003, 0.04, 0, 0.044, 0.15, 'steel', 8); // takedown pins
  // cocking handle (left, forward) with knob
  k.cylX(0.0038, 0.02, -0.0235, 0.066, 0.1, 'steel', 8); k.cylX(0.0075, 0.008, -0.0345, 0.066, 0.1, 'steel', 12);
  // top rail and tube red-dot sight (open mount, lenses both ends)
  k.rail(-0.062, 0.15, 0.0785, 0.02);
  k.box(0, 0.0945, 0.026, 0.026, 0.01, 0.062, 'steel');
  k.lathe([[0.001, -0.004], [0.0143, -0.004], [0.0156, 0.0], [0.0156, 0.05], [0.0178, 0.056], [0.0178, 0.062], [0.0158, 0.066], [0.001, 0.066]], 0.113, 'steel', 18);
  const lens = (r: number, z: number, back: boolean) => { const g = new THREE.CircleGeometry(r, 16); if (back) g.rotateY(Math.PI); g.translate(0, 0.113, z); k.push(g, 'lens'); };
  lens(0.0148, 0.0671, false); lens(0.0128, -0.0052, true);
  k.box(0, 0.1295, 0.03, 0.007, 0.004, 0.012, 'steel'); // elevation turret cap
  k.cylX(0.0045, 0.008, 0.0185, 0.113, 0.03, 'steel', 8); // windage turret
  // trigger housing, guard, trigger, selector, grip
  k.prof([[-0.05, 0.036], [0.082, 0.036], [0.082, 0.014], [0.066, 0.006], [0.01, 0.0], [-0.03, 0.01]], 0.032, 'polymer', 0.004);
  k.prof([[0.014, 0.034], [0.078, 0.034], [0.078, 0.004], [0.07, -0.006], [0.022, -0.006], [0.022, 0.0], [0.066, 0.0], [0.072, 0.006], [0.072, 0.03], [0.014, 0.03]], 0.009, 'polymer', 0.0015);
  k.prof([[0.034, 0.033], [0.042, 0.033], [0.04, 0.014], [0.033, 0.005], [0.029, 0.01]], 0.005, 'steel', 0.001);
  k.cylX(0.0085, 0.004, -0.0185, 0.034, -0.012, 'steel', 12); k.prof([[-0.012, 0.03], [-0.004, 0.034], [0.004, 0.042], [0.0, 0.044], [-0.012, 0.038]], 0.004, 'steel', 0.001, -0.021);
  const g: [number, number][] = [[0.02, 0.036], [0.012, 0.0], [0.0, -0.105], [-0.046, -0.105], [-0.038, -0.06], [-0.026, 0.0], [-0.014, 0.032]];
  k.prof(g, 0.032, 'polymer', 0.005);
  for (let y = 0.022; y > -0.1; y -= 0.0085) for (const s of [-1, 1]) k.box(s * 0.0163, y, cz(y) - 0.003, 0.0012, 0.0022, 0.026, 'polymer', 0.143);
  // magazine well + curved 30-round magazine (moves on reload)
  k.prof([[0.078, 0.034], [0.134, 0.034], [0.134, 0.004], [0.078, 0.004]], 0.034, 'polymer', 0.004);
  k.in('mag', () => {
    const n = 8, ml = 0.15, amp = 0.036, z0 = 0.106, top = 0.026, hw = 0.0185;
    const front: [number, number][] = [], back: [number, number][] = [];
    for (let i = 0; i <= n; i++) { const t = i / n; front.push([z0 + hw + amp * t * t, top - ml * t]); back.push([z0 - hw + amp * t * t - 0.004 * t, top - ml * t]); }
    k.prof([...front, ...back.reverse()], 0.025, 'steel', 0.003);
    for (let i = 2; i <= 7; i++) { const t = i / 7.4, y = top - ml * t, zc = z0 + amp * t * t - 0.002 * t; for (const s of [-1, 1]) k.box(s * 0.0128, y, zc, 0.0008, 0.0032, 0.034, 'steel', -Math.atan2(2 * amp * t, ml)); }
    const tb = 1, a = -Math.atan2(2 * amp * tb, ml);
    k.box(0, top - ml - 0.004, z0 + amp - 0.003, 0.03, 0.008, 0.048, 'polymer', a);
  });
  // handguard: rounded slotted polymer with underside finger ridges, barrel, front sight ring, hider
  k.lathe([[0.001, 0.166], [0.0212, 0.166], [0.0268, 0.18], [0.027, 0.205], [0.0262, 0.26], [0.0235, 0.284], [0.02, 0.292], [0.001, 0.292]], BY, 'polymer', 18);
  for (let i = 0; i < 6; i++) { const z = 0.19 + i * 0.019; for (const s of [-1, 1]) k.box(s * 0.0265, BY + 0.002, z, 0.0016, 0.011, 0.011, 'bore'); }
  for (let i = 0; i < 4; i++) k.box(0, BY - 0.026, 0.205 + i * 0.019, 0.02, 0.004, 0.0075, 'polymer');
  k.prof([[0.2, 0.026], [0.2, 0.02], [0.214, 0.02], [0.214, 0.026]], 0.012, 'steel', 0.001); // sling loop block
  k.cyl(0.0088, 0.29, 0.326, BY, 'steel', 12);
  k.lathe([[0.0086, 0.296], [0.0175, 0.296], [0.0175, 0.31], [0.0086, 0.31]], BY, 'steel', 16); // front sight ring
  k.box(0, BY + 0.0215, 0.303, 0.0035, 0.014, 0.004, 'steel');
  k.box(0.007, BY + 0.0165, 0.303, 0.0025, 0.018, 0.012, 'steel'); k.box(-0.007, BY + 0.0165, 0.303, 0.0025, 0.018, 0.012, 'steel');
  k.lathe([[0.0088, 0.324], [0.0118, 0.328], [0.0128, 0.334], [0.0128, 0.372], [0.0108, 0.376], [0.001, 0.376]], BY, 'steel', 14);
  for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; k.box(Math.cos(a) * 0.0129, BY + Math.sin(a) * 0.0129, 0.355, 0.0016, 0.0016, 0.034, 'bore'); }
  k.bore(0.0058, 0.3765, BY);
  // retractable wire stock: mount block, twin rods, steel frame and polymer butt pad
  k.cyl(0.0165, -0.102, -0.082, 0.062, 'steel', 14);
  k.box(0, 0.062, -0.098, 0.04, 0.052, 0.014, 'steel');
  k.cyl(0.0058, -0.292, -0.098, 0.078, 'steel', 8, 0.0); k.cyl(0.0058, -0.292, -0.098, 0.04, 'steel', 8, 0.0);
  k.prof([[-0.292, 0.1], [-0.302, 0.098], [-0.306, 0.04], [-0.302, -0.012], [-0.292, -0.014], [-0.29, 0.04]], 0.03, 'polymer', 0.005);
  k.box(0, 0.06, -0.296, 0.016, 0.015, 0.012, 'steel');
  return {
    muzzle: new THREE.Vector3(0, BY, 0.3785), eject: new THREE.Vector3(0.02, 0.062, 0.03),
    grip: new THREE.Vector3(0, -0.048, -0.013), support: new THREE.Vector3(0, 0.035, 0.228), butt: new THREE.Vector3(0, 0.04, -0.304),
  };
}
