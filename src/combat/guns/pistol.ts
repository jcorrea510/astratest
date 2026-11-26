/**
 * Model: pistol "Kestrel P9" - full-size polymer-frame striker-fired 9 mm. Also hosts `handgun()`, the bespoke
 * semi-auto builder that the compact (Wren .380) reuses with its own dimensions.
 * Design space: slide underside y = 0.040, +z muzzle. At the end everything is shifted so the firing-hand palm is at
 * the original anchor (0, -0.046, -0.029) the hold code was tuned for.
 */
import * as THREE from 'three';
import type { Kit, Built, Mat } from './kit';

export interface HandgunOpt {
  slide: number; slideH: number; slideW: number; frameW: number; gripW: number;
  gripLen: number; rake: number; depth: number;
  slideMat: Mat; dots: boolean; rail: boolean; frontSerr: boolean; rearSerr: number; guardZ: number;
  magW: number; takedown: boolean; grooves: boolean; backIn: number;
}

const ANCHOR = new THREE.Vector3(0, -0.046, -0.029);

export function handgun(k: Kit, o: HandgunOpt): Built {
  const yb = 0.04, top = yb + o.slideH, sm = o.slideMat;
  const back = -o.slide * 0.32, fr = back + o.slide;
  const by = top - o.slideH * 0.5 - 0.0045; // bore axis
  const a = o.rake, sa = Math.sin(a), ca = Math.cos(a), L = o.gripLen, D = o.depth;
  // grip frame: B0 = top of the backstrap; G(t, s) walks down the grip axis (t 0..1) and across it (s, forward positive)
  const B0: [number, number] = [back + o.backIn, yb - 0.008];
  const G = (t: number, s: number): [number, number] => [B0[0] + (-sa) * t * L + ca * s, B0[1] + (-ca) * t * L - sa * s];
  const sBack = (t: number) => -0.0025 * Math.sin(Math.PI * Math.min(1, t * 1.1));
  const sFront = (t: number) => {
    const u = Math.min(1, Math.max(0, (t - 0.14) / 0.6));
    const g = o.grooves ? 0.0022 * (1 - Math.cos(2 * Math.PI * 3 * u)) / 2 : 0;
    return D - g + 0.003 * t * t * t;
  };
  const N = 10;
  const fp: [number, number][] = [], bp: [number, number][] = [];
  for (let i = 0; i <= N; i++) { const t = i / N; fp.push(G(t, sFront(t))); bp.push(G(t, sBack(t))); }

  // ---------------------------------------------------------------- slide (moves on firing)
  const w = o.slideW, hw = w / 2;
  k.in('slide', () => {
    // body: rounded top, sloped front, bevelled rear
    k.prof([[back, yb], [fr, yb], [fr, top - 0.0075], [fr - 0.0045, top - 0.0008], [fr - 0.008, top], [back + 0.012, top], [back + 0.002, top - 0.0035], [back, top - 0.011]], w, sm, 0.0033);
    // serrations: vertical grooves both sides, rear and (full-size) front
    const gy = yb + o.slideH * 0.46, gh = o.slideH * 0.62;
    for (let i = 0; i < o.rearSerr; i++) { const z = back + 0.0075 + i * 0.0042; for (const s of [-1, 1]) k.box(s * hw, gy, z, 0.0016, gh, 0.0015, 'bore'); }
    if (o.frontSerr) for (let i = 0; i < 4; i++) { const z = fr - 0.0305 + i * 0.0042; for (const s of [-1, 1]) k.box(s * hw, gy, z, 0.0016, gh, 0.0015, 'bore'); }
    // ejection port (right side) with the barrel hood showing in it
    const p0 = back + o.slide * 0.34, pl = o.slide * 0.19, ph = o.slideH * 0.44;
    k.box(hw, top - ph / 2 - 0.0016, p0 + pl / 2, 0.0014, ph, pl, 'bore');
    k.box(hw + 0.0001, top - ph - 0.0016 + 0.0042, p0 + pl * 0.62, 0.0012, 0.0074, pl * 0.5, sm === 'chrome' ? 'bore' : sm);
    // muzzle opening and barrel crown face
    k.bore(0.0072, fr - 0.0002, by);
    k.bore(0.0042, fr + 0.0016, by);
    // sights: dovetailed rear blade with notch, tapered front post
    const zr = back + 0.012, zf = fr - 0.012;
    k.box(0, top + 0.0012, zr, 0.0125, 0.0028, 0.0085, sm);
    for (const s of [-1, 1]) k.box(s * 0.0043, top + 0.0033, zr, 0.0042, 0.0064, 0.0085, sm);
    k.box(0, top + 0.0012, zf, 0.0095, 0.0022, 0.0075, sm);
    k.prof([[zf - 0.0028, top], [zf + 0.0035, top], [zf + 0.0022, top + 0.0072], [zf - 0.0018, top + 0.0072]], 0.0034, sm, 0.0006);
    if (o.dots) {
      for (const s of [-1, 1]) k.box(s * 0.0043, top + 0.0043, zr - 0.0044, 0.0021, 0.0021, 0.0005, 'chrome');
      k.box(0, top + 0.0045, zf - 0.0023, 0.0021, 0.0021, 0.0006, 'chrome');
    }
  });

  // ---------------------------------------------------------------- barrel (stays on the frame, crown just proud of the slide)
  k.cyl(0.0058, fr - 0.022, fr + 0.001, by, 'steel', 14);
  k.cyl(0.0058, fr + 0.001, fr + 0.0016, by, 'steel', 14, 0, 0.0049);

  // ---------------------------------------------------------------- frame: grip, backstrap with beavertail, front strap
  const fw = o.gripW;
  const frame: [number, number][] = [[back - 0.003, yb + 0.0005], [0.046, yb + 0.0005], [0.046, 0.0215]];
  frame.push([fp[0][0], 0.0215]);
  for (const p of fp) frame.push(p);
  frame.push(G(1, D + 0.004));
  frame.push(G(1.0, -0.003));
  for (let i = N; i >= 0; i--) frame.push(bp[i]);
  frame.push([back - 0.007, yb - 0.0045], [back - 0.0045, yb - 0.0005]); // beavertail kick
  k.prof(frame, fw, 'polymer', 0.0035);
  // dust cover (narrower, with accessory rail slots under it)
  const dz = o.rail ? 0.0215 : 0.0235;
  k.prof([[0.04, yb + 0.0005], [fr - 0.003, yb + 0.0005], [fr - 0.0025, dz + 0.003], [fr - 0.006, dz], [0.04, dz]], o.frameW * 0.92, 'polymer', 0.0018);
  if (o.rail) for (let z = 0.058; z < fr - 0.012; z += 0.0095) k.box(0, dz - 0.0017, z + 0.0025, o.frameW * 0.92, 0.0034, 0.0048, 'polymer');
  // trigger guard (open ring, undercut where it meets the front strap)
  const gz = o.guardZ, gx = (z: number) => z * gz;
  const gy0 = dz;
  const outer: [number, number][] = [[gx(0.050), gy0 + 0.001], [gx(0.060), 0.017], [gx(0.064), 0.007], [gx(0.063), -0.003], [gx(0.0585), -0.0105], [gx(0.051), -0.015], [gx(0.030), -0.0158], [gx(0.010), -0.0150], [gx(-0.002), -0.0118]];
  const inner: [number, number][] = [[gx(0.047), gy0 - 0.0004], [gx(0.056), 0.0160], [gx(0.0595), 0.0070], [gx(0.0585), -0.0020], [gx(0.0545), -0.0080], [gx(0.0485), -0.0112], [gx(0.030), -0.0118], [gx(0.010), -0.0110], [gx(-0.001), -0.0085]];
  k.prof([...outer, ...inner.slice().reverse()], o.frameW * 0.86, 'polymer', 0.0014);
  // trigger blade with safety lever, curved shoe
  const tz = gx(0.0165);
  k.prof([[tz + 0.0012, gy0 + 0.0008], [tz + 0.0072, gy0 + 0.0008], [tz + 0.0058, 0.008], [tz + 0.0038, -0.0015], [tz + 0.0012, -0.0068], [tz - 0.0042, -0.0066], [tz - 0.0018, 0.0035], [tz - 0.0005, 0.012]], 0.0078, 'steel', 0.0012);
  k.box(0, 0.003, tz - 0.0042, 0.0036, 0.011, 0.0012, 'steel', -0.12);
  // controls on the left (-x): slide stop above the trigger, takedown lever ahead of it, mag release behind the guard
  const lx = -fw / 2;
  k.prof([[gx(0.002), yb - 0.0058], [gx(0.036), yb - 0.0058], [gx(0.0375), yb - 0.0015], [gx(0.030), yb + 0.0015], [gx(0.018), yb + 0.0006], [gx(0.006), yb - 0.0022]], 0.0032, 'steel', 0.0007, lx - 0.0012);
  if (o.takedown) k.prof([[gx(0.041), yb - 0.0085], [gx(0.0485), yb - 0.0085], [gx(0.0485), yb - 0.0025], [gx(0.044), yb - 0.0006], [gx(0.041), yb - 0.0025]], 0.0028, 'steel', 0.0006, lx - 0.001);
  const mr = G(0.1, D - 0.002);
  k.cylX(0.0036, 0.0058, lx - 0.0008, mr[1] + 0.0015, mr[0] - 0.0015, 'steel', 12);
  // retaining pins through the frame
  for (const [z, y] of [[gx(0.0165), yb - 0.0105], [gx(0.044), yb - 0.0125]] as [number, number][]) k.cylX(0.0019, fw + 0.0014, 0, y, z, 'steel', 8);
  // grip texture: fine horizontal ribs on both sides over the lower two thirds
  for (let i = 0; i < 15; i++) {
    const t = 0.2 + i * 0.05, c = G(t, D * 0.5 - 0.0005);
    for (const s of [-1, 1]) k.box(s * (fw / 2 - 0.0001), c[1], c[0], 0.0009, 0.0017, D * 0.74, 'polymer', a);
  }
  // backstrap ribs
  for (let i = 0; i < 9; i++) { const t = 0.3 + i * 0.07, c = G(t, sBack(t) - 0.0004); k.box(0, c[1], c[0], fw * 0.5, 0.0013, 0.0014, 'polymer', a); }

  // ---------------------------------------------------------------- magazine: steel body + flush baseplate (moves on reload)
  k.in('mag', () => {
    const mw = o.magW;
    k.prof([G(-0.09, 0.0025), G(-0.09, D - 0.0025), G(1.0, D - 0.0025), G(1.0, 0.0025)], mw, 'steel', 0.0012);
    k.prof([G(1.0, -0.0005), G(1.0, D + 0.0045), G(1.045, D + 0.0045), G(1.045, -0.0005)], mw + 0.0016, 'steel', 0.0012);
  });

  // ---------------------------------------------------------------- anchors, then shift so the palm sits at the old grip anchor
  const pc = G(0.42, sBack(0.42) + D * 0.34);
  const dx = ANCHOR.x, dy = ANCHOR.y - pc[1], dz2 = ANCHOR.z - pc[0];
  for (const p of k.parts) p.geo.translate(dx, dy, dz2);
  const portMid = back + o.slide * 0.34 + o.slide * 0.095;
  return {
    muzzle: new THREE.Vector3(0, by + dy, fr + 0.0016 + dz2),
    eject: new THREE.Vector3(0.02, top - 0.008 + dy, portMid + dz2),
    grip: ANCHOR.clone(),
  };
}

export function build(k: Kit): Built {
  return handgun(k, {
    slide: 0.186, slideH: 0.031, slideW: 0.0265, frameW: 0.0255, gripW: 0.0285, gripLen: 0.096, rake: 0.35, depth: 0.0395,
    slideMat: 'steel', dots: true, rail: true, frontSerr: true, rearSerr: 7, guardZ: 0.93, magW: 0.0215, takedown: true, grooves: true, backIn: 0.014,
  });
}
