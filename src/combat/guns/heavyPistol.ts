/** Model: heavyPistol "Bastion .45" (see combat/weapons.ts for stats). Bespoke all-steel single-action service pistol. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

export function build(k: Kit): Built {
  const W = 0.0245, back = -0.055, fr = 0.146, base = 0.04, H = 0.0335, top = base + H, by = top - 0.0155;
  const g = 0.115, a = 0.31, ca = Math.cos(a), sa = Math.sin(a), AZ = -0.02, AY = 0.004;
  /** Grip-space point: t along the grip (0 top .. 1 bottom, fraction of g), s across it (+ forward). */
  const P = (t: number, s: number): [number, number] => [AZ + ca * s - sa * t * g, AY - sa * s - ca * t * g];
  const strapZ = (y: number) => P((AY - sa * 0.0165 - y) / (ca * g), 0.0165)[0];
  const FW = 0.0232, dz = strapZ(-0.03) - -0.0051;

  // ---------------------------------------------------------------- slide (moves on firing)
  k.in('slide', () => {
    k.prof([[back, base], [fr, base], [fr, top - 0.007], [fr - 0.005, top], [back + 0.012, top], [back + 0.002, top - 0.006], [back, top - 0.016]], W, 'steel', 0.0035);
    const ym = (base + top) / 2 - 0.001;
    for (let i = 0; i < 9; i++) for (const sx of [-1, 1]) k.box(sx * (W / 2 + 0.0002), ym, back + 0.008 + i * 0.0043, 0.0014, H - 0.012, 0.0017, 'bore'); // rear serrations
    for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) k.box(sx * (W / 2 + 0.0002), ym, fr - 0.040 + i * 0.0043, 0.0014, H - 0.012, 0.0017, 'bore'); // front serrations
    k.box(W / 2 + 0.0003, top - 0.0105, 0.022, 0.0012, 0.0145, 0.037, 'bore'); // ejection port
    k.box(W / 2 + 0.0012, top - 0.0125, 0.046, 0.0016, 0.017, 0.0032, 'steel'); // extractor
    k.prof([[fr - 0.017, top], [fr - 0.005, top], [fr - 0.0065, top + 0.0072], [fr - 0.0135, top + 0.0072]], 0.0034, 'steel', 0.0008); // front blade
    for (const sx of [-1, 1]) k.box(sx * 0.0062, top + 0.0033, back + 0.0135, 0.0095, 0.0066, 0.012, 'steel'); // rear sight, notch between
    k.box(0, top - 0.0002, back + 0.0135, 0.022, 0.0014, 0.012, 'steel');
  });

  // ---------------------------------------------------------------- frame
  const F: [number, number][] = [
    [-0.038, 0.0415], [0.114, 0.0415], [0.1165, 0.03], [0.111, 0.0135], [0.062, 0.0135], [0.034, 0.0105], P(0, 0.0165), P(0.96, 0.0165),
    P(1.0, 0.0125), P(1.0, -0.019), P(0.78, -0.0255), P(0.4, -0.0225), P(0, -0.022), [-0.0365, 0.028], [-0.0335, 0.0415],
  ];
  k.prof(F, FW, 'steel', 0.0022);
  // barrel bushing, barrel crown and recoil-spring plug
  k.cyl(0.0092, fr - 0.004, fr + 0.0035, by, 'steel', 14);
  k.cyl(0.0063, fr, fr + 0.0066, by, 'steel', 14).bore(0.0043, fr + 0.0066, by);
  k.cyl(0.0038, fr - 0.014, fr + 0.0005, by - 0.0155, 'steel', 10);
  // trigger guard + trigger
  const gz = (z: number) => z + dz;
  k.prof([[gz(0.056), 0.0135], [gz(0.067), -0.002], [gz(0.060), -0.021], [gz(0.040), -0.031], [gz(-0.002), -0.0305], [gz(-0.001), -0.0265], [gz(0.038), -0.0265],
    [gz(0.052), -0.0195], [gz(0.0575), -0.0045], [gz(0.0515), 0.0075]], 0.0085, 'steel', 0.0012);
  k.prof([[gz(0.024), 0.0125], [gz(0.031), 0.0125], [gz(0.034), 0.002], [gz(0.032), -0.012], [gz(0.027), -0.0195], [gz(0.0235), -0.0185], [gz(0.0265), -0.01], [gz(0.0275), 0.0]], 0.006, 'steel', 0.0012);
  // hammer, beavertail / grip safety (arched housing is part of the frame outline)
  k.prof([[-0.052, 0.040], [-0.0565, 0.048], [-0.0625, 0.0505], [-0.070, 0.0535], [-0.0715, 0.049], [-0.066, 0.0435], [-0.0625, 0.040]], 0.0075, 'steel', 0.0015);
  k.prof([[-0.0345, 0.0175], [-0.050, 0.0265], [-0.0615, 0.0335], [-0.0625, 0.0395], [-0.0555, 0.0445], [-0.043, 0.0435], [-0.030, 0.0425], [-0.030, 0.027]], 0.0205, 'steel', 0.0025);
  // thumb safety (left), slide stop (left), magazine release
  k.prof([[-0.043, 0.0405], [-0.0165, 0.0405], [-0.0135, 0.0435], [-0.016, 0.0475], [-0.0235, 0.0495], [-0.0405, 0.0495]], 0.0035, 'steel', 0.0008, -(FW / 2 + 0.0014));
  k.prof([[0.012, 0.0375], [0.047, 0.0375], [0.050, 0.0405], [0.046, 0.0435], [0.014, 0.0435]], 0.003, 'steel', 0.0008, -(FW / 2 + 0.0012));
  const mr = P(0.1, 0.004); k.cylX(0.0042, 0.0044, FW / 2 + 0.0003, mr[1], mr[0] + 0.008, 'steel', 10);
  // checkered grip panels (wood) with a crosshatch of ribs
  const panel = [P(0.08, 0.0148), P(0.96, 0.0148), P(1.0, 0.0105), P(1.0, -0.0125), P(0.96, -0.016), P(0.1, -0.017)] as [number, number][];
  for (const sx of [-1, 1]) {
    k.prof(panel, 0.004, 'wood', 0.0011, sx * (FW / 2 + 0.0017));
    const xr = sx * (FW / 2 + 0.0017 + 0.002 + 0.0002);
    for (let i = 0; i < 7; i++) { const [z, y] = P(0.52, -0.0125 + i * 0.004); k.box(xr, y, z, 0.001, 0.088, 0.0014, 'wood', a); }
    for (let i = 0; i < 19; i++) { const [z, y] = P((0.014 + i * 0.0048) / g + 0.08, -0.0005); k.box(xr, y, z, 0.001, 0.0014, 0.029, 'wood', a); }
    for (const t of [0.3, 0.8]) { const [z, y] = P(t, -0.001); k.cylX(0.0027, 0.0012, sx * (FW / 2 + 0.0017 + 0.0022), y, z, 'steel', 8); }
  }
  // magazine (moves on reload): body, flush floorplate
  k.in('mag', () => {
    const c = P(0.46, -0.0025); k.box(0, c[1], c[0], 0.0205, 0.129, 0.0295, 'steel', a);
    const b = P(1.03, -0.003); k.box(0, b[1], b[0], 0.0272, 0.007, 0.0415, 'steel', a);
  });

  const gr = P(0.45, -0.0015);
  return { muzzle: new THREE.Vector3(0, by, fr + 0.0075), eject: new THREE.Vector3(0.016, top - 0.01, 0.022), grip: new THREE.Vector3(0, gr[1], gr[0]) };
}
