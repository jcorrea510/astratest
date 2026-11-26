/** Model: autoShotgun "Tempest Drum" - drum-fed automatic combat shotgun: boxy steel receiver with top rail + red dot, ejection port,
 * charging handle, vented polymer handguard with vertical foregrip, gas tube, slotted muzzle brake, pistol grip, fixed stock,
 * 20-round drum (group 'mag'). */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  const by = 0.06, W = 0.042, r0 = -0.1, r1 = 0.24;
  // ---- receiver: steel box + polymer lower, top cover seam, ejection port, charging handle, selector
  k.prof([[r0, 0.012], [r1, 0.012], [r1, 0.09], [r1 - 0.02, 0.094], [r0 + 0.02, 0.094], [r0, 0.086]], W, 'steel', 0.004);
  k.prof([[r0 + 0.01, 0.0], [r1 - 0.02, 0.0], [r1 - 0.02, 0.014], [r0 + 0.01, 0.014]], W * 0.96, 'polymer', 0.003);
  k.box(W / 2 + 0.0004, 0.068, 0.08, 0.0012, 0.028, 0.07, 'bore'); // ejection port
  k.box(0, 0.0945, 0.07, W * 0.92, 0.0012, 0.0015, 'bore'); // cover seam
  for (let i = 0; i < 5; i++) k.box(W / 2 + 0.0004, 0.04, -0.07 + i * 0.012, 0.0012, 0.03, 0.003, 'bore'); // side fins
  k.box(W / 2 + 0.009, 0.082, 0.15, 0.016, 0.01, 0.02, 'steel'); // charging handle
  k.box(W / 2 + 0.003, 0.082, 0.15, 0.006, 0.004, 0.06, 'bore'); // handle track
  k.cylX(0.006, 0.01, -W / 2 - 0.004, 0.028, -0.065, 'steel', 8); // selector
  // ---- top rail with red dot
  k.rail(r0 + 0.03, r1 - 0.02, 0.094, 0.021);
  k.redDot(0.03, 0.107);
  // ---- trigger group / pistol grip
  k.prof([[0.0, 0.014], [0.034, 0.014], [0.018, -0.1], [-0.03, -0.108], [-0.045, -0.092], [-0.03, -0.03], [-0.02, 0.014]], W * 0.8, 'polymer', 0.006);
  for (let i = 0; i < 5; i++) k.box(0, -0.012 - i * 0.017, -0.012 - i * 0.003, 0.034, 0.003, 0.003, 'bore'); // finger grooves
  k.prof([[0.034, 0.014], [0.1, 0.014], [0.1, -0.012], [0.094, -0.018], [0.046, -0.018], [0.036, -0.006]], 0.008, 'steel', 0.0015);
  k.prof([[0.05, 0.014], [0.058, 0.014], [0.054, -0.01], [0.046, -0.008]], 0.005, 'steel', 0.001);
  // ---- handguard (vented polymer) + underside rail + vertical foregrip
  k.prof([[r1 - 0.01, by - 0.034], [0.43, by - 0.03], [0.44, by + 0.026], [r1 - 0.01, by + 0.034]], 0.046, 'polymer', 0.008);
  for (let z = r1 + 0.02; z < 0.42; z += 0.03) for (const s of [-1, 1]) k.box(s * 0.0235, by, z, 0.0015, 0.03, 0.016, 'bore');
  k.rail(r1 + 0.0, 0.43, by + 0.03, 0.02);
  k.prof([[0.3, by - 0.034], [0.345, by - 0.034], [0.35, by - 0.1], [0.31, by - 0.11], [0.295, by - 0.09]], 0.03, 'polymer', 0.006);
  for (let i = 0; i < 4; i++) k.box(0, by - 0.05 - i * 0.015, 0.325, 0.032, 0.003, 0.05, 'bore'); // grip ribs
  // ---- barrel, gas tube, slotted muzzle brake
  k.cyl(0.0125, 0.43, 0.6, by, 'steel', 14);
  k.cyl(0.0075, r1 - 0.01, 0.5, by + 0.034, 'steel', 8);
  k.cyl(0.011, 0.42, 0.44, by, 'steel', 12);
  k.lathe([[0.0125, 0.6], [0.019, 0.602], [0.019, 0.655], [0.0125, 0.657]], by, 'steel', 14);
  for (let i = 0; i < 3; i++) for (const s of [-1, 1]) k.box(s * 0.0185, by, 0.614 + i * 0.014, 0.003, 0.02, 0.006, 'bore');
  k.bore(0.0105, 0.657, by);
  // ---- fixed stock with cheek rest and rubber pad
  k.cyl(0.015, r0 - 0.06, r0, by + 0.02, 'steel', 10);
  k.prof([[r0 + 0.01, 0.092], [-0.2, 0.086], [-0.3, 0.078], [-0.36, 0.08], [-0.368, -0.07], [-0.325, -0.076], [-0.17, 0.004], [r0 + 0.01, 0.004]], 0.036, 'polymer', 0.007);
  k.prof([[-0.36, 0.082], [-0.378, 0.078], [-0.386, -0.072], [-0.33, -0.078]], 0.04, 'bore', 0.004);
  // ---- drum magazine (group 'mag'): well, rim, tread, hub, windows
  const dy = -0.07, dz = 0.185, R = 0.088;
  k.in('mag', () => {
    k.box(0, 0.0, dz, 0.032, 0.02, 0.06, 'polymer'); // mag well
    const pts: [number, number][] = [[0.0005, -0.036], [R * 0.82, -0.036], [R * 0.95, -0.032], [R, -0.022], [R, 0.022], [R * 0.95, 0.032], [R * 0.82, 0.036], [0.0005, 0.036]];
    const g = new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(Math.max(0.0005, r), y)), 24); g.rotateZ(Math.PI / 2); g.translate(0, dy, dz); k.parts.push({ geo: g, mat: 'polymer', group: 'mag' });
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; k.box(0, dy + Math.cos(a) * R * 0.99, dz + Math.sin(a) * R * 0.99, 0.038, 0.008, 0.012, 'steel', -a); } // radial ribs
    for (const s of [-1, 1]) k.cylX(0.026, 0.006, s * 0.0375, dy, dz, 'steel', 14);
    for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; k.box(0.0368, dy + Math.cos(a) * 0.052, dz + Math.sin(a) * 0.052, 0.001, 0.012, 0.012, 'bore', -a); }
  });
  return {
    muzzle: new THREE.Vector3(0, by, 0.66), eject: new THREE.Vector3(W / 2 + 0.01, 0.068, 0.08),
    butt: new THREE.Vector3(0, by - 0.005, -0.38), support: new THREE.Vector3(0, by - 0.08, 0.325), grip: new THREE.Vector3(0, -0.05, -0.01),
  };
}
