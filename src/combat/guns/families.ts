/**
 * Shared generic families (pistol, long gun). Per-gun files may call these, or copy what they need into their own file
 * and build bespoke; do not change these signatures (several guns use them).
 */
import * as THREE from 'three';
import type { Kit, Built, Mat } from './kit';

export interface PistolOpt { slide: number; front: number; h: number; w: number; grip: number; mat?: Mat; frame?: Mat; comp?: boolean; ext?: number; auto?: boolean }
/** Semi-auto pistol: slide with serrations, frame with dust-cover rail, trigger guard, angled grip, flush magazine. */
export function pistol(k: Kit, o: PistolOpt): Built {
  const top = 0.04 + o.h, back = -o.slide * 0.32, fr = back + o.slide, by = 0.04 + o.h * 0.55;
  const fm = o.frame ?? 'polymer', sm = o.mat ?? 'steel';
  k.in('slide', () => {
    k.prof([[back, 0.04], [fr, 0.04], [fr, top - 0.006], [fr - 0.006, top], [back + 0.008, top], [back, top - 0.008]], o.w, sm, 0.002);
    for (let i = 0; i < 6; i++) { const z = back + 0.012 + i * 0.006; k.box(o.w / 2 + 0.0005, (0.04 + top) / 2, z, 0.0012, o.h * 0.75, 0.0025, 'polymer'); k.box(-o.w / 2 - 0.0005, (0.04 + top) / 2, z, 0.0012, o.h * 0.75, 0.0025, 'polymer'); }
    k.box(o.w / 2 + 0.0004, top - o.h * 0.35, back + o.slide * 0.62, 0.001, o.h * 0.3, o.slide * 0.18, 'bore'); // ejection port
    k.irons(fr - 0.008, back + 0.008, top);
  });
  k.cyl(0.0065, fr - 0.01, fr + 0.003 + (o.ext ?? 0), by, sm).bore(0.0045, fr + 0.003 + (o.ext ?? 0), by);
  if (o.comp) { k.box(0, by + 0.002, fr + 0.022, o.w * 0.95, o.h * 0.85, 0.036, 'steel'); for (let i = 0; i < 3; i++) k.box(0, top + 0.0005, fr + 0.01 + i * 0.01, o.w * 0.5, 0.003, 0.004, 'bore'); k.bore(0.0045, fr + 0.0401, by); }
  // frame / dust cover with a short rail
  k.prof([[back + 0.01, 0.002], [fr - 0.012, 0.01], [fr - 0.01, 0.041], [back + 0.004, 0.041], [back - 0.004, 0.03]], o.w * 0.92, fm, 0.002);
  k.rail(fr - 0.05, fr - 0.016, 0.0, o.w * 0.8, fm);
  // trigger guard + trigger
  k.prof([[0.006, 0.003], [0.052, 0.006], [0.054, -0.022], [0.046, -0.028], [0.012, -0.025], [0.012, -0.019], [0.044, -0.021], [0.047, -0.003], [0.008, 0.0]], 0.009, fm, 0.0015);
  k.prof([[0.024, 0.002], [0.03, 0.0], [0.03, -0.012], [0.026, -0.018], [0.022, -0.016]], 0.005, 'steel', 0.001);
  // grip with texture panels and beavertail
  const g = o.grip, ang = 0.32;
  const gp = (t: number, side: number): [number, number] => [-0.012 + side * 0.016 - Math.sin(ang) * t * g, 0.004 - Math.cos(ang) * t * g];
  k.prof([[back - 0.008, 0.04], [back + 0.006, 0.026], gp(0, -1.4), gp(1, -1.4), [gp(1, 1)[0] + 0.004, gp(1, 1)[1]], gp(1, 1), gp(0, 1.1), [0.012, 0.004]], o.w * 1.05, fm, 0.004);
  const mid = gp(0.5, 0);
  k.box(0, mid[1], mid[0], o.w * 1.12, g * 0.55, 0.026, 'polymer', ang);
  // magazine baseplate (moves with the magazine)
  k.in('mag', () => { const b = gp(1, 0); k.box(0, b[1] - 0.004, b[0] - 0.002, o.w * 1.1, 0.008, 0.036, sm === 'chrome' ? 'chrome' : 'steel', ang); k.box(0, b[1] + 0.03, b[0] + 0.006, o.w * 0.7, 0.06, 0.026, 'steel', ang); });
  if (o.auto) k.box(-o.w / 2 - 0.003, 0.03, back + 0.02, 0.004, 0.008, 0.012, 'steel'); // selector
  return { muzzle: new THREE.Vector3(0, by, fr + 0.004 + (o.ext ?? 0) + (o.comp ? 0.037 : 0)), eject: new THREE.Vector3(0.02, top - 0.01, back + o.slide * 0.62), grip: new THREE.Vector3(0, 0.004 - Math.cos(ang) * 0.5 * g, -0.012 - Math.sin(ang) * 0.5 * g) };
}

export interface LongOpt {
  recv: [number, number]; recvH: number; w?: number; barrel: number; br?: number; guard?: number; guardR?: number; guardMat?: Mat;
  stock: 'fixed' | 'folded' | 'skeleton' | 'wood' | 'none' | 'tube' | 'thumb'; stockLen?: number; stockMat?: Mat;
  mag: 'curved' | 'straight' | 'pistol' | 'box' | 'drum' | 'none' | 'belt'; magLen?: number; magZ?: number;
  optic?: 'irons' | 'dot' | 'scope' | 'none'; scopeLen?: number; furniture?: Mat; muzzle?: 'brake' | 'flash' | 'can' | 'none'; carry?: boolean; bipod?: boolean;
}
/** Long gun: receiver, pistol grip, handguard, barrel + muzzle device, stock, magazine and optic. */
export function longGun(k: Kit, o: LongOpt): Built {
  const [r0, r1] = o.recv, h = o.recvH, w = o.w ?? 0.034, by = 0.06, f = o.furniture ?? 'polymer';
  const top = by + h * 0.45;
  // upper / lower receiver
  k.prof([[r0, by - h * 0.55], [r1, by - h * 0.55], [r1, top], [r0 + 0.01, top], [r0, top - 0.012]], w, 'steel', 0.003);
  k.prof([[r0 + 0.005, by - h * 0.55], [r1 - 0.01, by - h * 0.55], [r1 - 0.02, by - h * 0.55 - 0.022], [r0 + 0.04, by - h * 0.55 - 0.02], [r0 + 0.01, by - h * 0.55 - 0.01]], w * 0.95, f, 0.003);
  k.box(w / 2 + 0.0005, by + 0.005, r0 + (r1 - r0) * 0.6, 0.0012, h * 0.4, 0.05, 'bore'); // ejection port
  k.box(w / 2 + 0.006, by + h * 0.25, r0 + (r1 - r0) * 0.75, 0.01, 0.008, 0.016, 'steel'); // charging handle / forward assist
  // grip + trigger guard
  k.prof([[0.02, 0.012], [0.03, 0.005], [-0.005, -0.1], [-0.042, -0.098], [-0.03, -0.06], [-0.022, 0.012]], w * 0.82, f, 0.005);
  k.prof([[0.025, 0.012], [0.085, 0.012], [0.085, -0.012], [0.03, -0.016], [0.03, -0.01], [0.078, -0.007], [0.078, 0.006], [0.025, 0.006]], 0.008, f, 0.0015);
  k.prof([[0.045, 0.014], [0.052, 0.012], [0.05, -0.004], [0.046, -0.006]], 0.005, 'steel', 0.001);
  // handguard
  const g0 = r1, g1 = r1 + (o.guard ?? 0.2), gr = o.guardR ?? 0.022;
  if (o.guard) {
    k.prof([[g0, by - gr], [g1, by - gr * 0.92], [g1, by + gr * 0.92], [g0, by + gr]], gr * 1.9, o.guardMat ?? f, 0.005);
    for (let z = g0 + 0.02; z < g1 - 0.015; z += 0.03) for (const s of [-1, 1]) k.box(s * gr * 0.96, by, z, 0.002, gr * 0.7, 0.014, 'bore');
    k.rail(g0, g1 - 0.005, by + gr * 0.92, 0.02);
  }
  k.rail(r0 + 0.02, r1, top - 0.003);
  // barrel, gas block, muzzle device
  const bz = o.barrel, br = o.br ?? 0.009;
  k.cyl(br, g1 - 0.01, bz, by, 'steel', 12).bore(br * 0.6, bz, by);
  if (o.guard) k.box(0, by + br + 0.006, g1 + 0.025, 0.018, 0.02, 0.018, 'steel');
  let mz = bz;
  if (o.muzzle === 'brake') { k.cyl(br * 1.6, bz, bz + 0.05, by, 'steel', 12); for (let i = 0; i < 3; i++) k.box(0, by, bz + 0.01 + i * 0.013, br * 3.4, br * 1.2, 0.006, 'bore'); k.bore(br * 0.7, bz + 0.05, by); mz = bz + 0.05; }
  else if (o.muzzle === 'flash') { k.cyl(br * 1.25, bz, bz + 0.045, by, 'steel', 10); for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4; k.box(Math.cos(a) * br * 1.26, by + Math.sin(a) * br * 1.26, bz + 0.03, 0.002, 0.002, 0.03, 'bore'); } k.bore(br * 0.8, bz + 0.045, by); mz = bz + 0.045; }
  else if (o.muzzle === 'can') { k.cyl(br * 2.4, bz, bz + 0.16, by, 'polymer', 14); k.bore(br * 0.7, bz + 0.16, by); mz = bz + 0.16; }
  // optic
  const opt = o.optic ?? 'irons';
  if (opt === 'irons') { k.box(0, top + 0.02, g1 - 0.02, 0.012, 0.035, 0.014, 'steel'); k.box(0, top + 0.016, r0 + 0.04, 0.022, 0.03, 0.02, 'steel'); k.box(0, top + 0.035, g1 - 0.02, 0.003, 0.014, 0.003, 'steel'); }
  else if (opt === 'dot') { k.redDot(r0 + (r1 - r0) * 0.55, top + 0.01); k.box(0, top + 0.01, g1 - 0.02, 0.01, 0.02, 0.01, 'steel'); }
  else if (opt === 'scope') k.scope(r0 + 0.01, r0 + 0.01 + (o.scopeLen ?? 0.32), top + 0.045);
  if (o.carry) { k.prof([[r0 + 0.03, top], [r1 - 0.03, top], [r1 - 0.035, top + 0.035], [r0 + 0.04, top + 0.035]], 0.016, 'steel', 0.002); }
  // stock
  const sl = o.stockLen ?? 0.26, sm = o.stockMat ?? f;
  if (o.stock === 'fixed') {
    k.cyl(0.014, r0 - 0.07, r0, by - 0.005, 'steel', 10);
    k.prof([[r0 - 0.04, by + 0.025], [r0 - sl, by + 0.03], [r0 - sl - 0.005, by - 0.075], [r0 - sl + 0.04, by - 0.085], [r0 - 0.03, by - 0.03], [r0, by - 0.03], [r0, by + 0.012]], w * 1.1, sm, 0.006);
    k.box(0, by - 0.022, r0 - sl - 0.001, w * 1.15, 0.11, 0.012, 'polymer');
  } else if (o.stock === 'wood' || o.stock === 'thumb') {
    const pts: [number, number][] = o.stock === 'thumb'
      ? [[r0, by + 0.02], [r0 - sl, by + 0.035], [r0 - sl - 0.01, by - 0.09], [r0 - sl + 0.05, by - 0.095], [r0 - 0.11, by - 0.045], [-0.03, -0.09], [-0.045, -0.092], [-0.02, -0.02], [r0, by - 0.03]]
      : [[r0, by + 0.02], [r0 - sl, by + 0.03], [r0 - sl - 0.008, by - 0.09], [r0 - sl + 0.04, by - 0.095], [r0 - 0.04, by - 0.035], [r0, by - 0.035]];
    k.prof(pts, w * 1.15, sm, 0.007); k.box(0, by - 0.03, r0 - sl - 0.004, w * 1.2, 0.12, 0.012, 'polymer');
  } else if (o.stock === 'skeleton') {
    k.cyl(0.006, r0 - sl, r0, by + 0.012, 'steel', 8); k.cyl(0.006, r0 - sl, r0, by - 0.035, 'steel', 8);
    k.box(0, by - 0.015, r0 - sl, w * 0.9, 0.09, 0.012, 'polymer');
  } else if (o.stock === 'folded') {
    k.prof([[r0, by + 0.015], [r0 + 0.012, by + 0.015], [r0 + 0.012, by - 0.03], [r0, by - 0.03]], 0.01, 'steel', 0.002, -w / 2 - 0.007);
    k.prof([[r0 + 0.01, by + 0.012], [r0 + sl, by + 0.012], [r0 + sl, by - 0.02], [r0 + 0.01, by - 0.02]], 0.008, 'polymer', 0.002, -w / 2 - 0.007);
  } else if (o.stock === 'tube') {
    k.cyl(0.016, r0 - sl, r0, by - 0.005, 'steel', 12); k.box(0, by - 0.015, r0 - sl, w, 0.08, 0.014, 'polymer');
  }
  // magazine
  const mz0 = o.magZ ?? (r1 - 0.045), ml = o.magLen ?? 0.15, myTop = by - h * 0.55;
  k.in('mag', () => {
    if (o.mag === 'curved') {
      const pts: [number, number][] = []; const n = 6;
      for (let i = 0; i <= n; i++) { const t = i / n; pts.push([mz0 + 0.018 + 0.05 * t * t, myTop - ml * t]); }
      for (let i = n; i >= 0; i--) { const t = i / n; pts.push([mz0 - 0.02 + 0.06 * t * t - 0.004 * t, myTop - ml * t]); }
      k.prof(pts, 0.024, 'polymer', 0.003);
      for (let i = 1; i < 5; i++) { const t = i / 5.5; k.box(0.0125, myTop - ml * t, mz0 + 0.06 * t * t, 0.002, 0.004, 0.03, 'polymer'); }
    } else if (o.mag === 'straight' || o.mag === 'pistol') {
      const ww = o.mag === 'pistol' ? 0.02 : 0.024, d = o.mag === 'pistol' ? 0.028 : 0.04;
      k.prof([[mz0 - d / 2, myTop], [mz0 + d / 2, myTop], [mz0 + d / 2 + 0.006, myTop - ml], [mz0 - d / 2 + 0.006, myTop - ml]], ww, 'steel', 0.002);
      k.box(0, myTop - ml - 0.003, mz0 + 0.006, ww + 0.004, 0.008, d + 0.008, 'polymer');
    } else if (o.mag === 'box') {
      k.prof([[mz0 - 0.03, myTop], [mz0 + 0.03, myTop], [mz0 + 0.034, myTop - ml], [mz0 - 0.026, myTop - ml]], 0.026, 'steel', 0.003);
    } else if (o.mag === 'drum') {
      k.box(0, myTop - 0.02, mz0, 0.026, 0.04, 0.05, 'polymer');
      const g = new THREE.CylinderGeometry(0.075, 0.075, 0.06, 20); g.rotateZ(Math.PI / 2); g.translate(0, myTop - 0.1, mz0 + 0.01); k.parts.push({ geo: g, mat: 'polymer', group: 'mag' });
      k.cylX(0.03, 0.065, 0, myTop - 0.1, mz0 + 0.01, 'steel', 14);
    } else if (o.mag === 'belt') {
      k.prof([[mz0 - 0.05, myTop], [mz0 + 0.05, myTop], [mz0 + 0.055, myTop - 0.11], [mz0 - 0.055, myTop - 0.11]], 0.07, 'olive', 0.006, -0.01);
      for (let i = 0; i < 7; i++) k.cyl(0.0045, 0, 0.022, myTop + 0.012 - i * 0.002, 'brass', 6, 0.03 + i * 0.008, 0.0045);
    }
  });
  if (o.bipod) { for (const s of [-1, 1]) { const g = new THREE.CylinderGeometry(0.005, 0.005, 0.2, 6); g.rotateX(-0.25); g.rotateZ(s * 0.1); g.translate(s * 0.01, by - 0.11, g1 - 0.03); k.parts.push({ geo: g, mat: 'steel', group: 'body' }); } }
  // hold anchors: butt = back of the stock (shoulder pocket), support = palm centre of the fore hand (under the handguard)
  const butt = o.stock === 'folded' || o.stock === 'none' ? undefined : new THREE.Vector3(0, by - 0.03, r0 - sl - 0.005);
  const support = new THREE.Vector3(0, o.guard ? by - gr * 0.95 : by - h * 0.55 - 0.01, o.guard ? (g0 + g1) / 2 : r1 + 0.03);
  return { muzzle: new THREE.Vector3(0, by, mz + 0.003), eject: new THREE.Vector3(w / 2 + 0.01, by + 0.005, r0 + (r1 - r0) * 0.6), butt, support, grip: new THREE.Vector3(0, -0.048, -0.008) };
}

