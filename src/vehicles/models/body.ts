/**
 * Procedural car body: a lofted shell (plan superellipse x vertical profile with rounded sill and shoulder, deck line
 * following hood / beltline / trunk, nose and tail set back at the top, bumper bulge, tumblehome) cut by implicit
 * regions into panels: wheel arches, the cabin opening, doors with seams, hood/trunk/bumper seams, lamps, grille.
 * The greenhouse is a second lofted surface (window base ring -> roof ring -> crowned roof) assembled from
 * parameter patches so pillars, glass panes and door frames line up exactly. Built in the ground frame (y = 0 ground).
 */
import * as THREE from 'three';
import { Soup, gridSurface, spow, sstep, monotone, dropDegenerate } from './soup';
import { K } from './kinds';
import { axlesOf, bodyEnds, type CarShape, type Lamp } from '../shapes';

export type V2 = [number, number];
/** Evenly spaced (by arc length) parameter samples of a plan curve. */
export function arcSamples(fn: (a: number) => V2, a0: number, a1: number, n: number): number[] {
  const M = 240, cum = [0], as = [a0];
  let prev = fn(a0);
  for (let i = 1; i <= M; i++) { const a = a0 + (a1 - a0) * i / M, p = fn(a); cum.push(cum[i - 1] + Math.hypot(p[0] - prev[0], p[1] - prev[1])); as.push(a); prev = p; }
  const out = [a0], total = cum[M];
  let j = 0;
  for (let k = 1; k < n; k++) { const target = total * k / n; while (j < M && cum[j + 1] < target) j++; const f = (target - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]); out.push(as[j] + (as[j + 1] - as[j]) * f); }
  out.push(a1);
  return out;
}
const lin = (a: number, b: number, n: number) => Array.from({ length: n + 1 }, (_, i) => a + (b - a) * i / n);

export interface BodyKit {
  s: CarShape; zr: number; zf: number; zc: number; hl: number;
  yT: (z: number) => number; yB: (z: number) => number;
  /** plan point / outward normal of the body outline */
  plan: (a: number) => V2; planN: (a: number) => V2;
  lower: (a: number, t: number, out: number[]) => void;
  /** outer side surface x at (z, y) (ray cast), front surface z at (x, y), rear surface z at (x, y) */
  sideX: (z: number, y: number) => number; frontZ: (x: number, y: number) => number; rearZ: (x: number, y: number) => number; topY: (x: number, z: number) => number;
  shell: Soup;
}

export function bodyKit(s: CarShape, lod: number): BodyKit {
  const [zr, zf] = bodyEnds(s);
  const zc = (zr + zf) / 2, hl = (zf - zr) / 2;
  const yT = monotone(s.top);
  const axles = axlesOf(s);
  const yB = (z: number) => s.clear + s.endRise * Math.max(sstep(axles[0], zf, z), sstep(axles[axles.length - 1], zr, z));
  const pinchAt = (z: number) => 1 - s.pinch * Math.exp(-(((z - (axles[0] + axles[axles.length - 1]) / 2) / (s.wb * 0.28)) ** 2));
  const e = 2 / s.plan;
  const plan = (a: number): V2 => { const z = zc + hl * spow(Math.cos(a), e); return [s.W / 2 * pinchAt(z) * spow(Math.sin(a), e), z]; };
  const planN = (a: number): V2 => {
    const p1 = plan(a + 1e-4), p0 = plan(a - 1e-4);
    const tx = p1[0] - p0[0], tz = p1[1] - p0[1], l = Math.hypot(tx, tz) || 1;
    return [-tz / l, tx / l];
  };
  // profile: t in [0, 1] bottom centre -> sill -> side -> shoulder -> deck centre
  const T1 = 0.12, T2 = 0.22, T3 = 0.55, T4 = 0.7;
  const P = [0, 0], N = [0, 0];
  const lower = (a: number, t: number, out: number[]) => {
    const pp = plan(a), nn = planN(a); P[0] = pp[0]; P[1] = pp[1]; N[0] = nn[0]; N[1] = nn[1];
    const ez = (P[1] - zc) / hl, endW = sstep(0.55, 0.985, Math.abs(ez)), front = ez > 0;
    const zg = P[1];
    const H = Math.max(0.2, yT(zg) - yB(zg));
    const ends = (v: number) => (front ? s.noseIn : s.tailIn) * Math.pow(sstep(0.4, 1, v), 1.4) * endW - s.bump * Math.exp(-(((v - 0.32) / 0.16) ** 2)) * endW + s.tumble * v * v;
    let d: number, ymode: number, yv: number, scale = 1, deck = 0;
    if (t < T1) { scale = t / T1; d = s.rb + ends(0); ymode = 0; yv = 0; }
    else if (t < T2) { const ph = (t - T1) / (T2 - T1) * Math.PI / 2; d = s.rb * (1 - Math.sin(ph)); const dy = s.rb * (1 - Math.cos(ph)); d += ends(dy / H); ymode = 0; yv = dy; }
    else if (t < T3) { const f = (t - T2) / (T3 - T2); d = -s.bulge * Math.sin(Math.PI * f) + ends((s.rb + f * (H - s.rb - s.rs)) / H); ymode = 2; yv = f; }
    else if (t < T4) { const ph = (t - T3) / (T4 - T3) * Math.PI / 2; d = s.rs * (1 - Math.cos(ph)) + ends(1); ymode = 1; yv = s.rs * (1 - Math.sin(ph)); }
    else { scale = 1 - (t - T4) / (1 - T4); d = s.rs + ends(1); ymode = 1; yv = 0; deck = 1; }
    let x = P[0] - d * N[0], z = P[1] - d * N[1];
    if (scale < 1) { const cz = Math.min(Math.max(zc, zr + 1.2), zf - 1.2); x *= scale; z = cz + (z - cz) * scale; }
    let y: number;
    if (ymode === 0) y = yB(z) + yv;
    else if (ymode === 1) y = yT(z) - yv + (deck ? 0.025 * (1 - scale * scale) * sstep(0, 0.5, scale) : 0);
    else y = yB(z) + s.rb + yv * (yT(z) - s.rs - yB(z) - s.rb);
    out[0] = x; out[1] = y; out[2] = z;
  };
  const na = lod ? 44 : 84;
  const as = arcSamples(plan, 0, Math.PI * 2, na);
  const tb = [...lin(0, T1, lod ? 2 : 3)];
  const deckF = lod ? [0.08, 0.22, 0.4, 0.62, 1] : [0.03, 0.09, 0.18, 0.3, 0.45, 0.62, 0.8, 1];
  const ts = [...lin(T1, T2, lod ? 2 : 3), ...lin(T2, T3, lod ? 3 : 7).slice(1), ...lin(T3, T4, lod ? 2 : 5).slice(1), ...deckF.map(f => T4 + (1 - T4) * f)];
  const ref = (x: number, y: number, z: number): [number, number, number] => [x, y - (s.clear + 0.45), (z - zc) * 0.5];
  const shell = dropDegenerate(gridSurface(lower, as, tb, { kind: K.UNDER, color: '#1b1b1c' }, ref)).append(dropDegenerate(gridSurface(lower, as, ts, { kind: K.PAINT }, ref)));
  const probe = shell.clone();
  const sideX = (z: number, y: number) => { const d = probe.raycast(5, y, z, -1, 0, 0); return Number.isFinite(d) ? 5 - d : s.W / 2; };
  const frontZ = (x: number, y: number) => { const d = probe.raycast(x, y, zf + 5, 0, 0, -1); return Number.isFinite(d) ? zf + 5 - d : zf; };
  const rearZ = (x: number, y: number) => { const d = probe.raycast(x, y, zr - 5, 0, 0, 1); return Number.isFinite(d) ? zr - 5 + d : zr; };
  const topY = (x: number, z: number) => { const d = probe.raycast(x, 6, z, 0, -1, 0); return Number.isFinite(d) ? 6 - d : yT(z); };
  return { s, zr, zf, zc, hl, yT, yB, plan, planN, lower, sideX, frontZ, rearZ, topY, shell };
}

/** superellipse "distance" in 2D, < 1 inside */
const se2 = (u: number, v: number, p: number) => Math.pow(Math.pow(Math.abs(u), p) + Math.pow(Math.abs(v), p), 1 / p);

/** Splits off the part of `s` inside f < 0 whose triangles also pass `keep`, repaints it and returns the rest + it. */
function regionN(soup: Soup, f: (x: number, y: number, z: number) => number, paint: { kind: number; color?: string }, keep: (nx: number, ny: number, nz: number, x: number, y: number, z: number) => boolean, inset = 0, onlyKind: number = K.PAINT): Soup {
  const [ins, out] = soup.split(f);
  const [take, back] = ins.partition((x, y, z, nx, ny, nz, k) => k === onlyKind && keep(nx, ny, nz, x, y, z));
  take.paint(paint); if (inset) take.offset(-inset);
  return out.append(back).append(take);
}
/** Seam band of half-width w around g = 0, restricted (by centroid) to mask. */
function seam(soup: Soup, g: (x: number, y: number, z: number) => number, w: number, mask: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => boolean, kind: number = K.SEAM): Soup {
  const [band, rest] = soup.split((x, y, z) => Math.abs(g(x, y, z)) - w);
  const [m, n] = band.partition((x, y, z, nx, ny, nz, k) => (k === K.PAINT || k === K.PLASTIC) && mask(x, y, z, nx, ny, nz));
  m.paint({ kind }); return rest.append(n).append(m);
}

export interface DoorOut { soup: Soup; inner: Soup; side: 1 | -1; row: number; z0: number; z1: number; bone: number }
export interface LowerOut { body: Soup; doors: DoorOut[] }

/** Cuts the shell into panels. `doorBone(row, side)` gives the bone index for a door. */
export function cutLower(kit: BodyKit, lod: number, doorBone: (row: number, side: 1 | -1) => number): LowerOut {
  const { s, zr, zf, yT } = kit;
  let b = kit.shell;
  const W2 = s.W / 2;
  const axles = axlesOf(s);
  const Ra = s.R + s.arch;
  // wheel arches (tank: none, tracks cover the sides)
  if (s.type !== 'tank') for (const za of axles) {
    const cy = s.R + 0.03;
    b = b.split((x, y, z) => Math.max(Math.hypot(z - za, y - cy) - Ra, (W2 - 0.5) - Math.abs(x)))[1];
  }
  // cabin opening
  const gh = s.gh;
  if (gh) {
    const g = ghGeom(kit);
    b = b.split((x, y, z) => Math.max(se2(x / (g.hwB - 0.004), (z - g.zcB) / (g.hlB - 0.004), gh.pB) - 1, Math.abs(x) - (g.lim(z) - 0.004), (yT(z) - 0.16) - y))[1];
  }
  // pickup bed
  if (s.type === 'pickup' && s.cargo) {
    const c = s.cargo;
    b = b.split((x, y, z) => Math.max(Math.abs(x) - c.hw, c.z0 - z, z - c.z1, c.y0 + 0.05 - y))[1];
  }
  const front = (z: number) => z > zf - 0.8, rear = (z: number) => z < zr + 0.8;
  // body side mouldings
  if (s.extras.includes('rubstrip')) {
    const yy = s.clear + 0.36;
    b = regionN(b, (x, y) => Math.max(Math.abs(y - yy) - 0.03, W2 - 0.25 - Math.abs(x)), { kind: s.extras.includes('chromebelt') ? K.CHROME : K.PLASTIC, color: '#202124' }, (nx) => Math.abs(nx) > 0.6);
  }
  if (s.extras.includes('chromebelt') && gh) {
    b = regionN(b, (x, y, z) => Math.max(Math.abs(y - (yT(z) - 0.035)) - 0.012, W2 - 0.25 - Math.abs(x), z - gh.zA, gh.zC - z), { kind: K.CHROME }, (nx) => Math.abs(nx) > 0.35);
  }
  if (s.extras.includes('sideintake')) {
    const zi = s.doors[0][0] - 0.32, yi = s.clear + 0.42;
    b = regionN(b, (x, y, z) => Math.max(se2((z - zi) / 0.28, (y - yi) / 0.13, 3) - 1, W2 - 0.3 - Math.abs(x)), { kind: K.GRILLE, color: '#0d0d0e' }, (nx) => Math.abs(nx) > 0.4, 0.02);
  }
  // bumpers, seams above them
  const bumperPaint = s.bumper === 'chrome' ? { kind: K.CHROME } : s.bumper === 'black' ? { kind: K.PLASTIC, color: '#232426' } : null;
  if (s.bumperF[1] > 0) {
    if (bumperPaint) {
      b = regionN(b, (_x, y, z) => Math.max(s.bumperF[0] - y, y - s.bumperF[1], zf - 0.75 - z), bumperPaint, () => true);
      b = regionN(b, (_x, y, z) => Math.max(s.bumperR[0] - y, y - s.bumperR[1], z - (zr + 0.75)), bumperPaint, () => true);
    }
    b = seam(b, (_x, y) => y - s.bumperF[1], 0.006, (_x, _y, z) => front(z) && z > zf - 0.72);
    b = seam(b, (_x, y) => y - s.bumperR[1], 0.006, (_x, _y, z) => rear(z) && z < zr + 0.72);
  }
  // hood and trunk seams
  if (gh && s.type !== 'tank') {
    const zh = gh.zA + 0.1, hx = W2 - 0.17;
    const onTop = (x: number, y: number, z: number, _nx: number, ny: number) => ny > 0.5;
    b = seam(b, (_x, _y, z) => z - zh, 0.005, (x, y, z, nx, ny) => onTop(x, y, z, nx, ny) && Math.abs(x) < hx);
    b = seam(b, (x) => Math.abs(x) - hx, 0.005, (x, y, z, nx, ny) => z > zh && z < zf - 0.2 && ny > 0.6);
    if (s.type === 'car' && gh.zC > zr + 0.6) {
      const zt = gh.zC - 0.1;
      b = seam(b, (_x, _y, z) => z - zt, 0.005, (x, y, z, nx, ny) => ny > 0.5 && Math.abs(x) < hx);
      b = seam(b, (x) => Math.abs(x) - hx, 0.005, (x, y, z, nx, ny) => z < zt && ny > 0.5);
    }
    if (gh.zC <= zr + 0.6 && s.type === 'car') {
      // hatch / tailgate: seam around the rear opening
      b = seam(b, (x) => Math.abs(x) - (W2 - 0.12), 0.005, (x, y, z, nx, _ny, nz) => z < zr + 0.3 && nz < -0.4 && y > s.bumperR[1]);
    }
  }
  // grille, intake, lamps
  const gr = s.grille;
  const zone = (zf2: number) => (_x: number, _y: number, z: number) => zf2 - z;
  if (gr.w > 0.05) {
    const fz = zone(zf - 0.45);
    if (gr.chrome || s.extras.includes('grillelights')) b = regionN(b, (x, y, z) => Math.max(se2(x / (gr.w + 0.035), (y - gr.y) / (gr.h + 0.035), gr.p ?? 4) - 1, fz(x, y, z)), { kind: gr.chrome ? K.CHROME : K.TRIM }, (_nx, ny, nz) => nz > 0.2 && ny < 0.8);
    else b = regionN(b, (x, y, z) => Math.max(se2(x / (gr.w + 0.012), (y - gr.y) / (gr.h + 0.012), gr.p ?? 4) - 1, fz(x, y, z)), { kind: K.TRIM }, (_nx, ny, nz) => nz > 0.2 && ny < 0.8);
    b = regionN(b, (x, y, z) => Math.max(se2(x / gr.w, (y - gr.y) / gr.h, gr.p ?? 4) - 1, fz(x, y, z)), { kind: K.GRILLE, color: '#0e0f10' }, (_nx, ny, nz) => nz > 0.2 && ny < 0.85, 0.012, gr.chrome || s.extras.includes('grillelights') ? K.CHROME : K.TRIM);
  }
  if (s.intake) {
    const it = s.intake;
    b = regionN(b, (x, y, z) => Math.max(se2(x / it.w, (y - it.y) / it.h, it.p ?? 5) - 1, zf - 0.5 - z), { kind: K.GRILLE, color: '#0b0b0c' }, (_nx, _ny, nz) => nz > 0.2, 0.01, s.bumper === 'paint' ? K.PAINT : s.bumper === 'chrome' ? K.CHROME : K.PLASTIC);
  }
  const lamp = (l: Lamp, isFront: boolean, sideSign: number) => {
    const lim = isFront ? (_x: number, _y: number, z: number) => zf - 0.6 - z : (_x: number, _y: number, z: number) => z - (zr + 0.6);
    const nk = (nz: number) => isFront ? nz > 0.15 : nz < -0.15;
    const f = (grow: number) => (x: number, y: number, z: number) => Math.max(se2((x * sideSign - l.x) / (l.w + grow), (y - l.y) / (l.h + grow), l.p ?? 4) - 1, lim(x, y, z), -x * sideSign);
    for (const k of [K.PAINT, K.PLASTIC, K.CHROME]) b = regionN(b, f(0.012), { kind: K.TRIM, color: '#121213' }, (_nx, _ny, nz) => nk(nz), 0, k);
    b = regionN(b, f(0), { kind: isFront ? K.HEAD : K.TAIL }, (_nx, _ny, nz) => nk(nz), 0.004, K.TRIM);
    if (isFront && s.type !== 'tank') b = regionN(b, (x, y, z) => Math.max(f(0)(x, y, z), l.x + l.w * 0.68 - x * sideSign), { kind: K.IND }, () => true, 0, K.HEAD);
    if (!isFront && s.type !== 'tank') b = regionN(b, (x, y, z) => Math.max(f(0)(x, y, z), x * sideSign - (l.x + l.w * 0.1), y - (l.y - l.h * 0.15)), { kind: K.REV }, () => true, 0, K.TAIL);
  };
  for (const sg of [1, -1]) { for (const l of s.head) lamp(l, true, sg); for (const l of s.tail) lamp(l, false, sg); }
  // doors: inner panel with a seam ring, split off onto their bones
  const doors: DoorOut[] = [];
  const ySill = s.clear + (s.type === 'car' ? 0.13 : 0.12), g = 0.006;
  s.doors.forEach(([z0, z1], row) => {
    for (const side of [1, -1] as const) {
      const outer = (x: number, y: number, z: number) => Math.max(z0 - g - z, z - z1 - g, ySill - g - y, W2 - 0.42 - side * x);
      const inner = (x: number, y: number, z: number) => Math.max(z0 + g - z, z - z1 + g, ySill + g - y, W2 - 0.42 - side * x);
      const [o, rest] = b.split(outer);
      const [d, ring] = o.split(inner);
      ring.paint({ kind: K.SEAM });
      const bone = doorBone(row, side);
      d.paint({ bone });
      const innerPanel = lod ? new Soup() : d.partition((_x, _y, _z, nx) => Math.abs(nx) > 0.2)[0].clone().offset(-0.055).flipped().paint({ kind: K.INTERIOR, color: s.interior, bone });
      doors.push({ soup: d, inner: innerPanel, side, row, z0, z1, bone });
      b = rest.append(ring);
    }
  });
  return { body: b, doors };
}

export interface GhGeom { hwB: number; zcB: number; hlB: number; hwR: number; zcR: number; hlR: number; lim: (z: number) => number }
export function ghGeom(kit: BodyKit): GhGeom {
  const { s } = kit, gh = s.gh!;
  // keep the window base on the deck: clamp to the deck edge ring at the nose / tail
  const rz = kit.rearZ(0, kit.yT(kit.zr + 0.3) - 0.03), fz = kit.frontZ(0, kit.yT(kit.zf - 0.3) - 0.03);
  const zA = Math.min(gh.zA, fz - 0.1), zC = Math.max(gh.zC, rz + 0.1);
  const midZ = (zA + zC) / 2;
  // half width of the deck edge ring at the cabin middle
  const deckHW = kit.sideX(midZ, kit.yT(midZ) - 0.005);
  const hwB = Math.min(deckHW, s.W / 2 - s.rs - s.tumble) - gh.inset - 0.02;
  // deck-edge half width along z, so the window base never pokes out where the body tapers
  const zs: number[] = [], ws: number[] = [];
  for (let i = 0; i <= 48; i++) { const z = zC - 0.05 + (zA - zC + 0.1) * i / 48; zs.push(z); ws.push(kit.sideX(z, kit.yT(z) - 0.004)); }
  const lim = (z: number) => { const f = Math.min(47.999, Math.max(0, (z - zs[0]) / (zs[48] - zs[0]) * 48)), i = Math.floor(f); return ws[i] + (ws[i + 1] - ws[i]) * (f - i) - gh.inset - 0.035; };
  return { hwB, zcB: midZ, hlB: (zA - zC) / 2, hwR: gh.roofW, zcR: (gh.zR1 + gh.zR2) / 2, hlR: (gh.zR1 - gh.zR2) / 2, lim };
}

export interface Pane { id: number; name: string; bone: number; soup: Soup }
export interface GreenhouseOut { body: Soup; glass: Soup; doorParts: Map<number, Soup>; panes: Pane[] }
/** Pane ids */
export const PANE = { windshield: 0, rear: 1, fl: 2, fr: 3, rl: 4, rr: 5, ql: 6, qr: 7 } as const;

export function greenhouse(kit: BodyKit, lod: number, doorBone: (row: number, side: 1 | -1) => number): GreenhouseOut {
  const { s, yT } = kit, gh = s.gh!;
  const G = ghGeom(kit);
  const eB = 2 / gh.pB, eR = 2 / gh.pR;
  const softMin = (x: number, l: number) => { const k = 0.025, d = x - l; return x - (d > -4 * k ? k * Math.log1p(Math.exp(d / k)) : 0); };
  const base = (a: number): V2 => { const z = G.zcB + G.hlB * spow(Math.cos(a), eB), x = G.hwB * spow(Math.sin(a), eB); return [Math.sign(x) * softMin(Math.abs(x), G.lim(z)), z]; };
  const roofP = (a: number): V2 => [G.hwR * spow(Math.sin(a), eR), G.zcR + G.hlR * spow(Math.cos(a), eR)];
  const baseN = (a: number): V2 => { const p1 = base(a + 1e-4), p0 = base(a - 1e-4); const tx = p1[0] - p0[0], tz = p1[1] - p0[1], l = Math.hypot(tx, tz) || 1; return [-tz / l, tx / l]; };
  const roofY = gh.roof, edgeDrop = 0.045;
  const bow = 0.03, k1 = 0.07, k2 = 0.09;
  const tS = 0.62, tR = 0.72;
  const B = [0, 0, 0], T = [0, 0, 0], Cc = [0, 0, 0];
  const pt = (a: number) => {
    const b = base(a), r = roofP(a);
    B[0] = b[0]; B[2] = b[1]; B[1] = yT(b[1]) - 0.012;
    T[0] = r[0]; T[2] = r[1]; T[1] = roofY - edgeDrop;
    Cc[0] = 0; Cc[2] = G.zcR; Cc[1] = roofY;
  };
  const roofAt = (u: number, o: number[]) => { o[0] = T[0] + (Cc[0] - T[0]) * u; o[2] = T[2] + (Cc[2] - T[2]) * u; o[1] = T[1] + edgeDrop * (1 - (1 - u) * (1 - u)); };
  const lineAt = (a: number, f: number, o: number[]) => {
    const n = baseN(a), w = bow * Math.sin(Math.PI * f);
    o[0] = B[0] + (T[0] - B[0]) * f + n[0] * w; o[1] = B[1] + (T[1] - B[1]) * f; o[2] = B[2] + (T[2] - B[2]) * f + n[1] * w;
  };
  const q1 = [0, 0, 0], q2 = [0, 0, 0];
  const fn = (a: number, t: number, out: number[]) => {
    pt(a);
    const len = Math.hypot(T[0] - B[0], T[1] - B[1], T[2] - B[2]), rlen = Math.hypot(Cc[0] - T[0], Cc[2] - T[2]) || 1;
    const f1 = 1 - Math.min(0.3, k1 / len), u2 = Math.min(0.3, k2 / rlen);
    if (t <= tS) { lineAt(a, (t / tS) * f1, out); return; }
    if (t >= tR) { roofAt(u2 + (1 - u2) * (t - tR) / (1 - tR), out); return; }
    const w = (t - tS) / (tR - tS);
    lineAt(a, f1, q1); roofAt(u2, q2);
    for (let i = 0; i < 3; i++) out[i] = (1 - w) * (1 - w) * q1[i] + 2 * (1 - w) * w * T[i] + w * w * q2[i];
  };
  // a-values on the left half (0 = front, PI = rear)
  const angleA = (deg: number) => { // where the base plan normal reaches `deg` from forward
    let lo = 0, hi = Math.PI;
    for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2, n = baseN(m), ang = Math.atan2(n[0], n[1]) * 180 / Math.PI; if (ang < deg) lo = m; else hi = m; }
    return (lo + hi) / 2;
  };
  const aOfZ = (z: number) => { const c = Math.max(-1, Math.min(1, (z - G.zcB) / G.hlB)); return Math.acos(spow(c, gh.pB / 2)); };
  const along = (a0: number, dist: number) => { // a after travelling `dist` metres along the base plan from a0
    let a = a0; const step = 0.002; let acc = 0, p = base(a);
    while (acc < dist && a < Math.PI) { a += step; const q = base(a); acc += Math.hypot(q[0] - p[0], q[1] - p[1]); p = q; }
    return a;
  };
  const aW = angleA(gh.wsAngle), aA = along(aW, s.type === 'car' ? 0.085 : 0.07);
  const aCe = angleA(gh.rearAngle);
  const two = s.doors.length === 1;
  const fd = s.doors[0], rd = s.doors[1];
  type Seg = { a0: number; a1: number; what: 'glass' | 'pillar' | 'divider' | 'bpillar'; pane?: number; row?: number };
  const segs: Seg[] = [];
  const clampA = (a: number) => Math.min(Math.max(a, aA + 0.01), aCe - 0.01);
  let aLast = aA;
  const push = (a1: number, what: Seg['what'], pane?: number, row?: number) => { a1 = Math.min(Math.max(a1, aLast + 0.004), aCe); if (a1 - aLast > 0.003) segs.push({ a0: aLast, a1, what, pane, row }); aLast = a1; };
  if (!fd) push(aCe, 'pillar');
  else if (two || !rd) {
    const aDoorEnd = clampA(aOfZ(fd[0] + 0.03));
    push(aDoorEnd, 'glass', PANE.fl, 0);
    if (!gh.open) {
      const aQ = clampA(aOfZ(gh.winEnd));
      if (aQ > aDoorEnd + 0.06) { push(aDoorEnd + 0.025, 'divider'); push(aQ, 'glass', PANE.ql); }
    }
    push(aCe, 'pillar');
  } else {
    push(clampA(aOfZ(gh.zB + gh.bw)), 'glass', PANE.fl, 0);
    push(clampA(aOfZ(gh.zB - gh.bw)), 'bpillar');
    const aRD = clampA(aOfZ(rd[0] + 0.03));
    push(aRD, 'glass', PANE.rl, 1);
    const aQ = clampA(aOfZ(gh.winEnd));
    if (aQ > aRD + 0.06) { push(aRD + 0.025, 'divider'); push(aQ, 'glass', PANE.ql); }
    push(aCe, 'pillar');
  }
  const tTrim = 0.025 * tS, tTop = gh.glassTop * tS * (1 - 0.0);
  const body = new Soup(), glass = new Soup(), doorParts = new Map<number, Soup>();
  const panes: Pane[] = [];
  const ref = (x: number, y: number, z: number): [number, number, number] => [x, y - (gh.roof - 0.6), (z - G.zcB) * 0.6];
  const na = (a0: number, a1: number, per: number) => Math.max(2, Math.round(Math.abs(a1 - a0) * per));
  const perA = lod ? 14 : 26;
  const tsOf = (t0: number, t1: number, n: number) => lin(t0, t1, Math.max(1, lod ? Math.ceil(n / 2) : n));
  const patch = (a0: number, a1: number, t0: number, t1: number, nt: number, paint: { kind: number; color?: string; bone?: number; extra?: number }) =>
    dropDegenerate(gridSurface(fn, arcSamples(base, a0, a1, na(a0, a1, perA)), tsOf(t0, t1, nt), paint, ref));
  const pillarKind = gh.blackPillars ? K.TRIM : K.PAINT;
  const glassPaint = (pane: number) => ({ kind: K.PAINT, color: '#ffffff', extra: pane });
  const sideParts: { soup: Soup; glass: boolean; pane: number; row: number }[] = [];
  const addSide = (soup: Soup, isGlass: boolean, pane = -1, row = -1) => sideParts.push({ soup, glass: isGlass, pane, row });
  const openTop = gh.open ? 0.42 * tS : tTop;
  // windshield and its frame (left half; mirrored below)
  addSide(patch(0, aW, 0, tTrim, 1, { kind: K.TRIM, color: '#141415' }), false);
  addSide(patch(0, aW, tTrim, tTop, 8, glassPaint(PANE.windshield)), true, PANE.windshield);
  addSide(patch(0, aW, tTop, tS, 2, { kind: K.PAINT }), false);
  addSide(patch(aW, aA, 0, tS, 8, { kind: pillarKind, color: '#151516' }), false);
  for (const sg of segs) {
    if (sg.what !== 'glass') {
      if (gh.open) continue;
      addSide(patch(sg.a0, sg.a1, 0, tS, 8, { kind: sg.what === 'pillar' && !gh.blackPillars ? K.PAINT : K.TRIM, color: '#151516' }), false, -1, -1);
      continue;
    }
    const row = sg.row ?? -1;
    addSide(patch(sg.a0, sg.a1, 0, tTrim, 1, { kind: s.extras.includes('chromebelt') ? K.CHROME : K.TRIM, color: '#141415' }), false, -1, row);
    addSide(patch(sg.a0, sg.a1, tTrim, gh.open ? openTop : tTop, 6, glassPaint(sg.pane!)), true, sg.pane!, row);
    if (!gh.open) addSide(patch(sg.a0, sg.a1, tTop, tS, 2, { kind: gh.frameless ? K.PAINT : K.TRIM, color: '#141415' }), false, -1, gh.frameless ? -1 : row);
  }
  if (!gh.open) {
    addSide(patch(aCe, Math.PI, 0, tTrim, 1, { kind: K.TRIM, color: '#141415' }), false);
    addSide(patch(aCe, Math.PI, tTrim, tTop, 6, glassPaint(PANE.rear)), true, PANE.rear);
    addSide(patch(aCe, Math.PI, tTop, tS, 2, { kind: K.PAINT }), false);
    addSide(patch(0, Math.PI, tS, 1, lod ? 5 : 10, { kind: K.PAINT }), false);
  } else {
    // windshield header bar only
    addSide(patch(aW, aA, tS, tR, 2, { kind: K.PAINT }), false);
    addSide(patch(0, aW, tS, tR, 2, { kind: K.PAINT }), false);
  }
  // A-pillars of open cars: keep only to the header; side glass of open cars stops low
  const mirrorPane = (p: number) => p === PANE.fl ? PANE.fr : p === PANE.rl ? PANE.rr : p === PANE.ql ? PANE.qr : p;
  const paneSoups = new Map<number, Soup>();
  for (const part of sideParts) {
    for (const side of [1, -1] as const) {
      const sp = side === 1 ? part.soup.clone() : part.soup.mirrorX();
      const pane = side === 1 ? part.pane : mirrorPane(part.pane);
      const bone = part.row >= 0 ? doorBone(part.row, side) : 0;
      if (part.glass) {
        const tint = new THREE.Color().setHSL(0.52, 0.25, 0.12 * (1 - s.tint) + 0.02);
        sp.paint({ bone, extra: pane, color: '#' + tint.getHexString() });
        glass.append(sp);
        if (!paneSoups.has(pane)) paneSoups.set(pane, new Soup());
        paneSoups.get(pane)!.append(sp);
      } else if (bone) {
        sp.paint({ bone });
        if (!doorParts.has(bone)) doorParts.set(bone, new Soup());
        doorParts.get(bone)!.append(sp);
      } else body.append(sp);
    }
  }
  const names = ['windshield', 'rear', 'front-left', 'front-right', 'rear-left', 'rear-right', 'quarter-left', 'quarter-right'];
  for (const [id, sp] of paneSoups) panes.push({ id, name: names[id], bone: sp.d[13], soup: sp });
  panes.sort((a, b) => a.id - b.id);
  return { body, glass, doorParts, panes };
}
