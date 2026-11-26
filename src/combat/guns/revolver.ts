/** Model: revolver "Ironside .357" - stainless six-shot double-action magnum with full-lug vent-rib barrel, fluted cylinder, wood grips. */
import * as THREE from 'three';
import type { Kit, Built } from './kit';

/** Trigger guard: an elliptical hoop (side profile), front point at (cz + rx, cy) swinging down and back to (cz - rx, cy). */
function guard(k: Kit, cz: number, cy: number, rx: number, ry: number, th: number, w: number, mat: 'chrome' | 'steel') {
  const pts: [number, number][] = [];
  const n = 14;
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI; pts.push([cz + rx * Math.cos(a), cy - ry * Math.sin(a)]); }
  for (let i = n; i >= 0; i--) { const a = (i / n) * Math.PI; pts.push([cz + (rx - th) * Math.cos(a), cy - (ry - th) * Math.sin(a)]); }
  k.prof(pts, w, mat, 0.0012);
}

/** Cylinder body: fluted (or round) outline extruded along z with six chamber holes. */
function cylinderBody(k: Kit, cy: number, R: number, orbit: number, hole: number, z0: number, z1: number, fluted: boolean) {
  const s = new THREE.Shape();
  const n = 72;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    // chambers sit at 90 deg + i * 60 deg; the flutes are cut between them
    const f = fluted ? Math.max(0, Math.cos(3 * (a - Math.PI / 2 - Math.PI / 6))) : 0;
    const r = R - 0.0032 * Math.pow(f, 6);
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) s.moveTo(x, y); else s.lineTo(x, y);
  }
  s.closePath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 2 + (i * Math.PI) / 3;
    const h = new THREE.Path(); h.absarc(Math.cos(a) * orbit, Math.sin(a) * orbit, hole, 0, Math.PI * 2, true); s.holes.push(h);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: z1 - z0, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, cy, z0);
  k.push(g, 'chrome');
}

export function build(k: Kit): Built {
  const by = 0.072; // barrel axis height
  const orbit = 0.0165, cy = by - orbit, R = 0.0245; // cylinder centre and radius

  // ---- frame (stainless): rear block with sideplate, top strap, lower frame, yoke
  k.prof([[-0.064, 0.026], [-0.004, 0.026], [-0.004, by + 0.014], [-0.03, by + 0.019], [-0.056, by + 0.02], [-0.065, by + 0.011]], 0.03, 'chrome', 0.0035);
  k.prof([[-0.004, by + 0.0085], [0.056, by + 0.0085], [0.056, by + 0.017], [0.02, by + 0.0195], [-0.004, by + 0.0195]], 0.024, 'chrome', 0.003); // top strap over the cylinder
  k.prof([[-0.004, 0.024], [0.058, 0.024], [0.058, 0.032], [-0.004, 0.032]], 0.022, 'chrome', 0.002); // bottom of the frame window
  k.prof([[0.044, 0.026], [0.07, 0.03], [0.07, by + 0.004], [0.044, by + 0.004]], 0.02, 'chrome', 0.003); // frame front / yoke seat
  for (const sx of [1, -1]) {
    k.cylX(0.0145, 0.0022, sx * 0.0157, 0.052, -0.034, 'chrome', 20); // sideplate disc
    k.cylX(0.0028, 0.0034, sx * 0.0168, 0.058, -0.048, 'steel', 8); k.cylX(0.0028, 0.0034, sx * 0.0168, 0.042, -0.02, 'steel', 8); // screws
  }
  // cylinder release latch (left side) with thumbpiece
  k.box(0.0172, 0.058, -0.012, 0.004, 0.012, 0.022, 'steel'); k.cylX(0.0045, 0.004, 0.0185, 0.058, -0.007, 'steel', 8);

  // ---- barrel: full-lug, tapered, crowned muzzle; underlug covering the ejector rod
  k.lathe([[0.0001, 0.05], [0.0132, 0.05], [0.0132, 0.064], [0.0124, 0.072], [0.0124, 0.232], [0.0114, 0.2385], [0.0094, 0.243], [0.0046, 0.243]], by, 'chrome', 20).bore(0.0046, 0.243, by);
  k.lathe([[0.0001, 0.056], [0.0096, 0.056], [0.0098, 0.19], [0.0088, 0.2], [0.0001, 0.2]], by - 0.0235, 'chrome', 14);
  k.box(0, by - 0.0115, 0.13, 0.009, 0.014, 0.15, 'chrome');
  k.cyl(0.0042, 0.2, 0.205, by - 0.0235, 'steel', 8); // ejector rod end
  // vent rib: base bar + posts
  k.box(0, by + 0.0128, 0.15, 0.0055, 0.0036, 0.172, 'chrome');
  for (let i = 0; i < 10; i++) k.box(0, by + 0.0162, 0.07 + i * 0.0172, 0.0072, 0.0058, 0.0125, 'chrome');
  // sights: ramp front (steel) and adjustable rear with notch
  k.prof([[0.203, by + 0.0118], [0.239, by + 0.0118], [0.239, by + 0.0285], [0.233, by + 0.0285]], 0.0042, 'steel', 0.0008);
  k.box(0, by + 0.0225, -0.036, 0.016, 0.0034, 0.011, 'steel');
  for (const sx of [-1, 1]) k.box(sx * 0.0055, by + 0.0265, -0.036, 0.0052, 0.0072, 0.007, 'steel');

  // ---- hammer with spur, trigger and rounded guard
  k.prof([[-0.05, by + 0.014], [-0.058, by + 0.012], [-0.07, by + 0.017], [-0.083, by + 0.028], [-0.08, by + 0.0345], [-0.069, by + 0.033], [-0.057, by + 0.024], [-0.046, by + 0.022]], 0.0085, 'steel', 0.0012);
  k.prof([[0.014, 0.034], [0.02, 0.033], [0.02, 0.018], [0.026, 0.009], [0.021, 0.0065], [0.0145, 0.016], [0.0135, 0.028]], 0.0048, 'steel', 0.001);
  guard(k, 0.027, 0.032, 0.027, 0.032, 0.0036, 0.009, 'chrome');

  // ---- grips: stainless grip-frame core + wood panels with finger grooves, round butt
  const back: [number, number][] = [[-0.06, 0.032], [-0.067, 0.016], [-0.075, -0.006], [-0.081, -0.03], [-0.083, -0.054], [-0.078, -0.073], [-0.065, -0.084], [-0.048, -0.088], [-0.036, -0.083]];
  const front: [number, number][] = [];
  const N = 16;
  for (let i = N; i >= 0; i--) { const t = i / N; front.push([-0.0005 - 0.031 * t - 0.0034 * Math.pow(Math.sin(3 * Math.PI * t), 2), 0.03 - 0.108 * t]); }
  const outline = [...back, ...front];
  k.prof(outline, 0.011, 'chrome', 0.0015);
  for (const sx of [-1, 1]) {
    k.prof(outline, 0.0124, 'wood', 0.0032, sx * 0.0105);
    k.cylX(0.0036, 0.0016, sx * 0.0178, -0.012, -0.052, 'steel', 10); // grip screw escutcheon
  }

  // ---- cylinder (group 'slide': the reload swings it out)
  k.in('slide', () => {
    cylinderBody(k, cy, R, orbit, 0.0068, 0.0, 0.007, false);
    cylinderBody(k, cy, R, orbit, 0.0068, 0.007, 0.043, true);
    cylinderBody(k, cy, R, orbit, 0.0068, 0.043, 0.05, false);
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 2 + (i * Math.PI) / 3;
      const d = new THREE.CircleGeometry(0.0066, 12); d.translate(Math.cos(a) * orbit, cy + Math.sin(a) * orbit, 0.012); k.push(d, 'bore');
    }
    k.cyl(0.0045, 0.05, 0.068, cy, 'chrome', 10); // ejector rod / centre pin
    k.cyl(0.0095, -0.0035, 0.0, cy, 'chrome', 12); // ratchet star
  });
  return { muzzle: new THREE.Vector3(0, by, 0.243), eject: new THREE.Vector3(0.02, cy, 0.025), grip: new THREE.Vector3(0, -0.04, -0.04) };
}
