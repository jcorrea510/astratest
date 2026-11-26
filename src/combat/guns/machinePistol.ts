/** Model: machinePistol "Hornet MP" (see combat/weapons.ts for stats). Bespoke polymer-frame full-auto 9 mm with compensator. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  const W = 0.0262, FW = 0.0275, GW = 0.0305, back = -0.058, fr = 0.132, base = 0.04, H = 0.031, top = base + H, by = top - 0.0145;
  const g = 0.098, a = 0.38, ca = Math.cos(a), sa = Math.sin(a), AZ = -0.016, AY = 0.004, sF = 0.0155, sB = -0.0195;
  const P = (t: number, s: number): [number, number] => [AZ + ca * s - sa * t * g, AY - sa * s - ca * t * g];
  const strapZ = (y: number) => P((AY - sa * sF - y) / (ca * g), sF)[0];

  // ---------------------------------------------------------------- slide
  k.in('slide', () => {
    k.prof([[back, base], [fr, base], [fr, top - 0.009], [fr - 0.009, top], [back + 0.008, top], [back, top - 0.007]], W, 'steel', 0.004);
    const ym = (base + top) / 2 - 0.001;
    for (let i = 0; i < 6; i++) for (const sx of [-1, 1]) k.box(sx * (W / 2 + 0.0002), ym, back + 0.008 + i * 0.0045, 0.0014, H - 0.011, 0.0018, 'bore');
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) k.box(sx * (W / 2 + 0.0002), ym, fr - 0.028 + i * 0.0045, 0.0014, H - 0.011, 0.0018, 'bore');
    for (const z of [fr - 0.037, fr - 0.022]) k.box(0, top + 0.0004, z, 0.0065, 0.001, 0.0085, 'bore'); // ported slide
    k.box(W / 2 + 0.0003, top - 0.0105, 0.03, 0.0012, 0.014, 0.04, 'bore'); // ejection port
    k.prof([[back + 0.004, top - 0.017], [back + 0.026, top - 0.017], [back + 0.026, top - 0.008], [back + 0.004, top - 0.008]], 0.003, 'steel', 0.0008, -(W / 2 + 0.0012)); // selector
    k.cylX(0.0028, 0.0045, -(W / 2 + 0.0035), top - 0.0125, back + 0.015, 'steel', 8);
    k.prof([[fr - 0.018, top], [fr - 0.006, top], [fr - 0.0075, top + 0.007], [fr - 0.0145, top + 0.007]], 0.004, 'steel', 0.0008); // front sight
    for (const sx of [-1, 1]) k.box(sx * 0.0075, top + 0.0033, back + 0.015, 0.0085, 0.0066, 0.011, 'steel');
  });

  // ---------------------------------------------------------------- compensator (lathe) with top and side ports
  k.lathe([[0, fr - 0.006], [0.0098, fr - 0.006], [0.0098, fr + 0.003], [0.0108, fr + 0.004], [0.0108, fr + 0.029], [0.0098, fr + 0.032], [0.007, fr + 0.034], [0, fr + 0.034]], by, 'steel', 16);
  k.bore(0.0045, fr + 0.034, by);
  for (const z of [fr + 0.011, fr + 0.018, fr + 0.025]) k.box(0, by + 0.0107, z, 0.0055, 0.0012, 0.004, 'bore');
  for (const z of [fr + 0.014, fr + 0.024]) for (const sx of [-1, 1]) k.box(sx * 0.0108, by, z, 0.0012, 0.0045, 0.004, 'bore');

  // ---------------------------------------------------------------- polymer frame + grip
  const F: [number, number][] = [
    [-0.050, 0.0415], [0.112, 0.0415], [0.116, 0.032], [0.110, 0.0175], [0.014, 0.0175], P(0, sF), P(1, sF), P(1, sB), P(0, sB), [-0.0425, 0.0235], [-0.050, 0.034],
  ];
  k.prof(F, FW, 'polymer', 0.003);
  k.prof([P(0.08, sF + 0.0004), P(1, sF), P(1, sB), P(0.08, sB - 0.0004)], GW, 'polymer', 0.004);
  const fz = (y: number) => strapZ(y);
  k.prof([[0.064, 0.0175], [0.0715, 0.007], [0.070, -0.012], [0.0635, -0.0215], [0.040, -0.0245], [fz(-0.0245) + 0.001, -0.0245], [fz(-0.0205) + 0.001, -0.0203], [0.0405, -0.0198],
    [0.0585, -0.0165], [0.0612, -0.011], [0.0625, 0.0]], 0.0105, 'polymer', 0.0015);
  k.prof([[0.0195, 0.0125], [0.0275, 0.0125], [0.0305, 0.0], [0.0285, -0.014], [0.0235, -0.0195], [0.0215, -0.018], [0.0245, -0.0095], [0.0235, 0.0]], 0.0065, 'steel', 0.0012);
  k.prof([[0.020, 0.0385], [0.046, 0.0385], [0.049, 0.0415], [0.046, 0.0445], [0.023, 0.0445]], 0.0028, 'steel', 0.0007, -(FW / 2 + 0.0013)); // slide stop
  const mr = P(0.1, 0.0045); k.cylX(0.0042, 0.0035, -(GW / 2 + 0.0002), mr[1], mr[0] + 0.003, 'steel', 10);
  for (const z of [0.075, 0.09, 0.1015]) k.box(0, 0.0172, z, FW - 0.002, 0.0012, 0.0022, 'bore'); // accessory-rail slots
  for (let i = 0; i < 3; i++) { const [z, y] = P(0.28 + i * 0.2, sF + 0.0005); k.box(0, y, z, FW - 0.004, 0.0022, 0.0016, 'bore', a); } // finger grooves
  for (const sx of [-1, 1]) for (let i = 0; i < 11; i++) { const [z, y] = P(0.13 + i * 0.075, -0.002); k.box(sx * (GW / 2 + 0.0003), y, z, 0.001, 0.002, 0.0245, 'polymer', a); } // stippling

  // ---------------------------------------------------------------- extended magazine (moves on reload)
  k.in('mag', () => {
    const c = P(0.66, -0.002); k.box(0, c[1], c[0], 0.0235, 0.149, 0.0315, 'polymer', a);
    const b = P(1.42, -0.002); k.box(0, b[1], b[0], 0.0265, 0.007, 0.0365, 'polymer', a);
  });

  const gr = P(0.45, -0.002);
  return { muzzle: new THREE.Vector3(0, by, fr + 0.0355), eject: new THREE.Vector3(0.016, top - 0.01, 0.03), grip: new THREE.Vector3(0, gr[1], gr[0]) };
}
