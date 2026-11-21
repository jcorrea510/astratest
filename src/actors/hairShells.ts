/**
 * Hair and beards as layered shells (the usual game technique for short hair and fur): a base surface (the scalp / jaw region
 * of the actual head mesh, or a sheet, tube or ball for long hair, tails and buns) is copied outwards along its normals in
 * several layers. Every vertex carries strand coordinates (u across strands, v along them) and the comb direction; the
 * person shader's HAIR variant draws individual tapered strands per layer (alpha tested), shades them with a strand-aligned
 * (Kajiya-Kay) highlight, and turns the layers solid once strands get smaller than a pixel, so there is no shimmer and the
 * far LOD (two solid layers) looks the same. The scalp under the shells is painted hair colour by the skin shader, and
 * shell thickness / strand density fade to zero at the hairline, so hairlines and beard edges are soft.
 * Perf: one cached indexed geometry per style/sex/hat/LOD, drawn with one material per person (same program as the body).
 */
import * as THREE from 'three';
import { hairline, headCoords, R, type BodyBase } from './humanAssets';
import type { FacialHair, HairStyle } from './look';

/** smoothstep that also accepts falling edges (a > b). */
const sstep = (x: number, a: number, b: number) => a <= b ? THREE.MathUtils.smoothstep(x, a, b) : 1 - THREE.MathUtils.smoothstep(x, b, a);
const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** One base surface: positions/normals in body bind space (m), strand coordinates and per-vertex density/thickness. */
export interface Surf {
  pos: number[]; nor: number[]; u: number[]; v: number[]; dens: number[]; thick: number[]; tri: number[];
  /** u wraps with this period (0 = no wrap): triangles across the wrap get duplicated vertices. */
  uPeriod: number;
}
export interface LayerOpts { layers: number; mode: number; droop?: number; core?: boolean; twoSided?: boolean; /** coil cell size class (0..15): cell = 1 + 0.5 * size strand widths */ size?: number }
/** Hair mode in the shader: 0 = strands lying along the surface, 1 = coils standing out of it (curls, afro, fuzz), 2 = cornrow braids. */
export const MODE = { lying: 0, coil: 1, rows: 2 } as const;

/** Accumulates layered surfaces into one geometry. */
class Acc {
  pos: number[] = []; nor: number[] = []; hs: number[] = []; hd: number[] = []; idx: number[] = [];
  add(s0: Surf, o: LayerOpts, far: boolean) {
    const s = fixSeams(s0);
    const n = s.pos.length / 3, dir = combDirs(s);
    // far LOD: a core plus two solid layers at the depth the near shader goes solid at
    const fr = far ? [0.3, 0.62] : Array.from({ length: o.layers }, (_, k) => (k + 1) / o.layers);
    const layers: number[] = [];
    if (o.core) layers.push(0);
    for (const f of fr) { layers.push(f); if (o.twoSided) layers.push(-f); }
    for (const L of layers) {
      const base = this.pos.length / 3, a = Math.abs(L);
      for (let i = 0; i < n; i++) {
        const t = s.thick[i] * L, dr = (o.droop ?? 0) * a * a * (s.thick[i] > 0 ? 1 : 0);
        this.pos.push(s.pos[i * 3] + s.nor[i * 3] * t, s.pos[i * 3 + 1] + s.nor[i * 3 + 1] * t - dr, s.pos[i * 3 + 2] + s.nor[i * 3 + 2] * t);
        const sg = L < 0 ? -1 : 1;
        this.nor.push(s.nor[i * 3] * sg, s.nor[i * 3 + 1] * sg, s.nor[i * 3 + 2] * sg);
        // hs: u, v, layer (0..1; 0 = opaque core), density; hd: comb direction, flags (mode + 4 * solid + 8 * coil size)
        this.hs.push(s.u[i], s.v[i], L === 0 ? 0 : 0.02 + a * 0.98, s.dens[i]);
        this.hd.push(dir[i * 3], dir[i * 3 + 1], dir[i * 3 + 2], o.mode + (far ? 4 : 0) + 8 * (o.size ?? 0));
      }
      for (let t = 0; t < s.tri.length; t += 3) {
        if (L < 0) this.idx.push(base + s.tri[t], base + s.tri[t + 2], base + s.tri[t + 1]);
        else this.idx.push(base + s.tri[t], base + s.tri[t + 1], base + s.tri[t + 2]);
      }
    }
  }
  build(base: BodyBase): THREE.BufferGeometry | null {
    const n = this.pos.length / 3; if (!n) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('hs', new THREE.Float32BufferAttribute(this.hs, 4));
    g.setAttribute('hd', new THREE.Float32BufferAttribute(this.hd, 4));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4), hb = base.boneNames.indexOf('DEF-head');
    for (let i = 0; i < n; i++) { si[i * 4] = hb; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere(); g.computeBoundingBox();
    return g;
  }
}

/** Duplicates the vertices of triangles that straddle the u wrap, so u interpolates without a jump. */
function fixSeams(s: Surf): Surf {
  if (!s.uPeriod) return s;
  const P = s.uPeriod, out: Surf = { ...s, pos: [...s.pos], nor: [...s.nor], u: [...s.u], v: [...s.v], dens: [...s.dens], thick: [...s.thick], tri: [...s.tri] };
  const dup = new Map<number, number>();
  for (let t = 0; t < out.tri.length; t += 3) {
    const a = out.tri.slice(t, t + 3), us = a.map(i => s.u[i]);
    if (Math.max(...us) - Math.min(...us) < P / 2) continue;
    for (let k = 0; k < 3; k++) {
      const i = a[k]; if (s.u[i] >= P / 2) continue;
      let j = dup.get(i);
      if (j === undefined) {
        j = out.u.length; dup.set(i, j);
        out.pos.push(s.pos[i * 3], s.pos[i * 3 + 1], s.pos[i * 3 + 2]); out.nor.push(s.nor[i * 3], s.nor[i * 3 + 1], s.nor[i * 3 + 2]);
        out.u.push(s.u[i] + P); out.v.push(s.v[i]); out.dens.push(s.dens[i]); out.thick.push(s.thick[i]);
      }
      out.tri[t + k] = j;
    }
  }
  return out;
}

/** Per-vertex direction of increasing v (the way the strands run), from the triangles' (u, v) parametrisation, in the tangent plane. */
function combDirs(s: Surf): Float32Array {
  const n = s.pos.length / 3, acc = new Float32Array(n * 3);
  const p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), p2 = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), d = new THREE.Vector3();
  for (let t = 0; t < s.tri.length; t += 3) {
    const a = s.tri[t], b = s.tri[t + 1], c = s.tri[t + 2];
    p0.fromArray(s.pos, a * 3); p1.fromArray(s.pos, b * 3); p2.fromArray(s.pos, c * 3);
    e1.subVectors(p1, p0); e2.subVectors(p2, p0);
    const du1 = s.u[b] - s.u[a], dv1 = s.v[b] - s.v[a], du2 = s.u[c] - s.u[a], dv2 = s.v[c] - s.v[a];
    const det = du1 * dv2 - du2 * dv1; if (Math.abs(det) < 1e-12) continue;
    d.copy(e2).multiplyScalar(du1).addScaledVector(e1, -du2).multiplyScalar(1 / det); // dP/dv
    const l = d.length(); if (!(l > 0)) continue; d.multiplyScalar(1 / l);
    for (const i of [a, b, c]) { acc[i * 3] += d.x; acc[i * 3 + 1] += d.y; acc[i * 3 + 2] += d.z; }
  }
  const nn = new THREE.Vector3();
  for (let i = 0; i < n; i++) {
    d.fromArray(acc, i * 3); nn.fromArray(s.nor, i * 3);
    d.addScaledVector(nn, -d.dot(nn));
    if (d.lengthSq() < 1e-10) d.set(0, -1, 0).addScaledVector(nn, -nn.y);
    d.normalize(); d.toArray(acc, i * 3);
  }
  return acc;
}

// ---------------------------------------------------------------------------------------------------------- strand parametrisations
/** Cranium centre in head coordinates (the scalp is roughly a unit sphere around it). */
const C0 = V3(0, 0.08, -0.06);
/** Strands radiate from `pole` (a direction from the cranium centre, head coordinates): u = angle around the pole, v = arc away from it (m). */
function poleParam(pole: THREE.Vector3, strands: number) {
  const A = pole.clone().normalize();
  const e1 = Math.abs(A.y) < 0.9 ? V3(0, 1, 0).cross(A).normalize() : V3(1, 0, 0).cross(A).normalize(), e2 = A.clone().cross(e1);
  const q = new THREE.Vector3();
  return (hn: THREE.Vector3) => {
    q.copy(hn).sub(C0).normalize();
    const th = Math.acos(THREE.MathUtils.clamp(q.dot(A), -1, 1)), ps = Math.atan2(q.dot(e2), q.dot(e1));
    return { u: (ps / (Math.PI * 2) + 0.5) * strands, v: th * 0.1 };
  };
}

/** Radial clearance of the body (torso, neck, head; not arms) around the head axis, for hair that hangs down: max distance per (angle, height) bin. */
interface Clear { r: Float32Array; y0: number; dy: number; nb: number; ny: number; cx: number; cz: number }
const clears = new WeakMap<BodyBase, Clear>();
function clearance(base: BodyBase): Clear {
  let c = clears.get(base); if (c) return c;
  const g = base.bodyIdx, P = g.attributes.position, RG = g.attributes.region;
  const nb = 48, dy = 0.01, y0 = base.head.center.y - 0.6, ny = 80, cx = base.head.center.x, cz = base.head.center.z;
  const r = new Float32Array(nb * ny);
  for (let i = 0; i < P.count; i++) {
    if (RG.getX(i) === R.ARM) continue;
    const y = P.getY(i), yi = Math.floor((y - y0) / dy); if (yi < 0 || yi >= ny) continue;
    const x = P.getX(i) - cx, z = P.getZ(i) - cz, a = Math.atan2(x, -z), bi = ((Math.floor((a / (Math.PI * 2) + 0.5) * nb) % nb) + nb) % nb;
    const d = Math.hypot(x, z); if (d > r[yi * nb + bi]) r[yi * nb + bi] = d;
  }
  // spread to neighbours (a strand is not a point) and fill gaps
  const out = new Float32Array(r.length);
  for (let yi = 0; yi < ny; yi++) for (let bi = 0; bi < nb; bi++) {
    let m = 0; for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) { const yy = yi + a; if (yy < 0 || yy >= ny) continue; m = Math.max(m, r[yy * nb + ((bi + b + nb) % nb)]); }
    out[yi * nb + bi] = m;
  }
  c = { r: out, y0, dy, nb, ny, cx, cz }; clears.set(base, c); return c;
}
/** Pushes a point (m) out radially (around the head's vertical axis) until it is `gap` outside the body. */
function pushOut(c: Clear, p: THREE.Vector3, gap: number) {
  const yi = Math.floor((p.y - c.y0) / c.dy); if (yi < 0 || yi >= c.ny) return p;
  const x = p.x - c.cx, z = p.z - c.cz, a = Math.atan2(x, -z), bi = ((Math.floor((a / (Math.PI * 2) + 0.5) * c.nb) % c.nb) + c.nb) % c.nb;
  const need = c.r[yi * c.nb + bi] + gap, d = Math.hypot(x, z);
  if (d < need && d > 1e-4) { p.x = c.cx + x / d * need; p.z = c.cz + z / d * need; }
  return p;
}

// ---------------------------------------------------------------------------------------------------------- base surfaces
const toM = (b: BodyBase, h: THREE.Vector3, out = new THREE.Vector3()) => out.set(b.head.center.x + h.x * b.head.half.x, b.head.center.y + h.y * b.head.half.y, b.head.center.z + h.z * b.head.half.z);

/** The scalp / face of the head mesh where `mask(hn)` > 0: thickness `thick(hn)` (m), density = mask, strand coords from `param`. */
function headSurf(base: BodyBase, mask: (hn: THREE.Vector3) => number, thick: (hn: THREE.Vector3) => number, param: (hn: THREE.Vector3, p: THREE.Vector3) => { u: number; v: number }, uPeriod: number): Surf {
  const g = base.scalp, P = g.attributes.position, N = g.attributes.normal, idx = g.index!.array;
  const s: Surf = { pos: [], nor: [], u: [], v: [], dens: [], thick: [], tri: [], uPeriod };
  const map = new Int32Array(P.count).fill(-1), hn = new THREE.Vector3(), p = new THREE.Vector3();
  const m = new Float32Array(P.count);
  for (let i = 0; i < P.count; i++) { p.fromBufferAttribute(P, i); m[i] = mask(headCoords(base.head, p, hn)); }
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (m[a] <= 0 && m[b] <= 0 && m[c] <= 0) continue;
    if (m[a] < 0 || m[b] < 0 || m[c] < 0) continue; // negative mask = hard exclusion (eyes, lips)
    for (const i of [a, b, c]) {
      if (map[i] < 0) {
        map[i] = s.u.length;
        p.fromBufferAttribute(P, i); headCoords(base.head, p, hn);
        s.pos.push(p.x, p.y, p.z); s.nor.push(N.getX(i), N.getY(i), N.getZ(i));
        const uv = param(hn, p); s.u.push(uv.u); s.v.push(uv.v);
        s.dens.push(THREE.MathUtils.clamp(m[i], 0, 1)); s.thick.push(Math.max(0, thick(hn)) * THREE.MathUtils.clamp(m[i] * 1.6, 0, 1));
      }
      s.tri.push(map[i]);
    }
  }
  return s;
}

/** A parametric surface in head coordinates: `f(s, t)` gives the point (s across the strands, t along them); normals point away from `inside`. */
function gridSurf(base: BodyBase, f: (s: number, t: number) => THREE.Vector3, ns: number, nt: number, strands: number, len: number,
  dens: (s: number, t: number) => number, thick: (s: number, t: number) => number, opts: { clear?: number; inside?: (p: THREE.Vector3) => THREE.Vector3 } = {}): Surf {
  const s: Surf = { pos: [], nor: [], u: [], v: [], dens: [], thick: [], tri: [], uPeriod: 0 };
  const cols = ns + 1, cl = opts.clear !== undefined ? clearance(base) : null, p = new THREE.Vector3();
  for (let j = 0; j <= nt; j++) for (let i = 0; i < cols; i++) {
    const S = i / ns, T = j / nt;
    toM(base, f(S, T), p); if (cl) pushOut(cl, p, opts.clear!);
    s.pos.push(p.x, p.y, p.z); s.u.push(S * strands); s.v.push(T * len); s.dens.push(dens(S, T)); s.thick.push(thick(S, T));
  }
  for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) {
    const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1;
    s.tri.push(a, c, b, b, c, d);
  }
  // normals from the grid, oriented away from the inside reference
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(s.pos, 3)); g.setIndex(s.tri); g.computeVertexNormals();
  const N = g.attributes.normal, q = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i < N.count; i++) {
    n.fromBufferAttribute(N, i); q.fromArray(s.pos, i * 3);
    const ref = opts.inside ? opts.inside(q) : base.head.center;
    if (n.dot(q.clone().sub(ref)) < 0) n.negate();
    s.nor.push(n.x, n.y, n.z);
  }
  return s;
}

// ---------------------------------------------------------------------------------------------------------- styles
interface ScalpSpec {
  thick: (hn: THREE.Vector3) => number; pole: THREE.Vector3; layers: number; mode: number;
  line?: (x: number, z: number) => number; strands?: number; feather?: number; droop?: number; size?: number;
}
const CROWN = V3(0.18, 0.72, -0.67), FRONT = V3(0, 0.3, 0.95), SIDE = V3(0.85, 0.5, 0.15);
const SCALP: Partial<Record<HairStyle, ScalpSpec>> = {
  short: { thick: h => 0.009 + 0.011 * sstep(h.y, 0.1, 0.8), pole: CROWN, layers: 10, mode: MODE.lying },
  crew: { thick: h => 0.004 + 0.008 * sstep(h.y, 0.25, 0.85), pole: CROWN, layers: 7, mode: MODE.lying },
  fade: { thick: h => 0.002 + 0.011 * sstep(h.y, 0.4, 0.85), pole: CROWN, layers: 8, mode: MODE.lying, line: (x, z) => Math.max(hairline(x, z), 0.2), feather: 0.35 },
  buzz: { thick: () => 0.0028, pole: CROWN, layers: 3, mode: MODE.coil, size: 0 },
  slick: { thick: h => 0.008 + 0.006 * sstep(h.y, 0.2, 0.9) + 0.004 * sstep(h.z, 0.3, 0.9), pole: FRONT, layers: 8, mode: MODE.lying },
  parted: { thick: h => 0.01 + 0.012 * sstep(h.y, 0.1, 0.8), pole: SIDE, layers: 10, mode: MODE.lying },
  pixie: { thick: h => 0.01 + 0.013 * sstep(h.y, 0.0, 0.8) + 0.005 * Math.max(0, h.z), pole: V3(-0.3, 0.75, -0.6), layers: 10, mode: MODE.lying },
  curly: { thick: h => 0.022 + 0.01 * sstep(h.y, 0.0, 0.8), pole: CROWN, layers: 14, mode: MODE.coil, size: 6 },
  afro: { thick: h => 0.05 + 0.03 * sstep(h.y, -0.3, 0.7), pole: CROWN, layers: 22, mode: MODE.coil, size: 2, line: (x, z) => hairline(x, z) - 0.05 },
  cornrows: { thick: () => 0.006, pole: FRONT, layers: 6, mode: MODE.rows, strands: 520 },
  long: { thick: h => 0.01 + 0.007 * sstep(h.y, 0.1, 0.8), pole: FRONT, layers: 9, mode: MODE.lying },
  bob: { thick: h => 0.011 + 0.008 * sstep(h.y, 0.1, 0.8), pole: FRONT, layers: 9, mode: MODE.lying },
  ponytail: { thick: h => 0.007 + 0.004 * sstep(h.y, 0.2, 0.9), pole: FRONT, layers: 7, mode: MODE.lying },
  bun: { thick: h => 0.007 + 0.004 * sstep(h.y, 0.2, 0.9), pole: FRONT, layers: 7, mode: MODE.lying },
  buns: { thick: h => 0.008 + 0.004 * sstep(h.y, 0.2, 0.9), pole: FRONT, layers: 7, mode: MODE.lying },
};
/** Styles drawn with shells (bald is skin only). */
export const SHELL_HAIR = new Set<HairStyle>(Object.keys(SCALP) as HairStyle[]);
/** Shell thickness at a scalp point (hats sit on top of it). */
export const shellThick = (style: HairStyle, hn: THREE.Vector3) => SCALP[style]?.thick(hn) ?? 0.012;
/** Hats cover the scalp above this line (head coordinates): hair only shows below it. */
export const capLine = (_x: number, z: number) => THREE.MathUtils.lerp(0.02, 0.36, sstep(z, 0.1, 0.75));

const ROOT_STRANDS = 720;
function scalpSurf(base: BodyBase, sp: ScalpSpec, hatOn: boolean): Surf {
  const line = sp.line ?? hairline, fe = sp.feather ?? 0.28;
  const param = poleParam(sp.pole, sp.strands ?? ROOT_STRANDS);
  return headSurf(base, hn => {
    const h = line(hn.x, hn.z);
    let m = sstep(hn.y, h - 0.06, h + 0.1);
    if (hatOn) m *= 1 - sstep(hn.y, capLine(hn.x, hn.z) - 0.04, capLine(hn.x, hn.z) + 0.02);
    return hn.y < h - 0.06 ? 0 : m;
  }, hn => sp.thick(hn) * sstep(hn.y, line(hn.x, hn.z) - 0.06, line(hn.x, hn.z) + fe), hn => param(hn), sp.strands ?? ROOT_STRANDS);
}

/** Long hair: a sheet hanging from under the scalp shell round the back of the head, clear of the neck/shoulders/back. */
function curtain(base: BodyBase, len: number, sideLen: number, spread: number, flare: number, far: boolean): Surf {
  const phi0 = Math.PI * spread;
  const f = (s: number, t: number) => {
    const ph = (s * 2 - 1) * phi0, side = Math.abs(s * 2 - 1);
    const yEnd = THREE.MathUtils.lerp(len, sideLen, side * side);
    const y = THREE.MathUtils.lerp(0.55, yEnd, t);
    // hugging the cranium above the ears, then falling straight with a little flare
    const onHead = Math.sqrt(Math.max(0, 1 - Math.min(1, ((y - C0.y) / 1.02) ** 2)));
    const r = Math.max(onHead * 1.04, 0.0) + (y < 0 ? 0.04 + flare * sstep(-y, 0, 2.4) : 0.04);
    const rr = y < C0.y ? Math.max(r, 1.0 + flare * sstep(-y, 0, 2.4)) : r;
    return V3(C0.x + Math.sin(ph) * rr, y, C0.z - Math.cos(ph) * rr * (1 + 0.12 * sstep(-y, 0.5, 3)));
  };
  return gridSurf(base, f, far ? 14 : 28, far ? 10 : 22, 900, 0.5,
    (s, t) => sstep(t, 1.0, 0.82) * sstep(s, 0, 0.06) * sstep(s, 1, 0.94),
    (s, t) => 0.009 * (0.4 + 0.6 * sstep(t, 0, 0.15)) * sstep(t, 1.02, 0.85), { clear: 0.014, inside: q => V3(base.head.center.x, q.y, base.head.center.z) });
}

/** A tapered tube along a polyline in head coordinates (ponytail); radius in metres. */
function tubeSurf(base: BodyBase, pts: THREE.Vector3[], radius: (t: number) => number, far: boolean): Surf {
  const curve = new THREE.CatmullRomCurve3(pts), cl = clearance(base);
  const nt = far ? 8 : 20, ns = far ? 6 : 12;
  const P: THREE.Vector3[] = [], T: THREE.Vector3[] = [];
  for (let j = 0; j <= nt; j++) { const p = toM(base, curve.getPointAt(j / nt)); pushOut(cl, p, radius(j / nt) + 0.01); P.push(p); }
  for (let j = 0; j <= nt; j++) T.push(P[Math.min(nt, j + 1)].clone().sub(P[Math.max(0, j - 1)]).normalize());
  const fm = (j: number) => { const t = T[j]; const a = Math.abs(t.x) < 0.9 ? V3(1, 0, 0) : V3(0, 0, 1); const b1 = a.clone().cross(t).normalize(); return [b1, t.clone().cross(b1)]; };
  const s: Surf = { pos: [], nor: [], u: [], v: [], dens: [], thick: [], tri: [], uPeriod: 0 };
  const strands = 180;
  for (let j = 0; j <= nt; j++) {
    const [b1, b2] = fm(j), r = radius(j / nt);
    for (let i = 0; i <= ns; i++) {
      const a = (i / ns) * Math.PI * 2, n = b1.clone().multiplyScalar(Math.cos(a)).addScaledVector(b2, Math.sin(a));
      s.pos.push(P[j].x + n.x * r, P[j].y + n.y * r, P[j].z + n.z * r); s.nor.push(n.x, n.y, n.z);
      s.u.push((i / ns) * strands); s.v.push(j / nt * 0.3); s.dens.push(sstep(j / nt, 1.0, 0.85)); s.thick.push(r * 0.7 * sstep(j / nt, 1.02, 0.8) + 0.002);
    }
  }
  for (let j = 0; j < nt; j++) for (let i = 0; i < ns; i++) { const a = j * (ns + 1) + i, b = a + 1, c = a + ns + 1, d = c + 1; s.tri.push(a, c, b, b, c, d); }
  return s;
}

/** A ball of hair (bun) centred at `c` (head coordinates) with radius `r` (head units): strands wrap around it. */
function ballSurf(base: BodyBase, c: THREE.Vector3, r: number, far: boolean): Surf {
  const f = (s: number, t: number) => { const lon = s * Math.PI * 2, lat = (t - 0.5) * Math.PI * 0.96; return V3(c.x + Math.cos(lat) * Math.sin(lon) * r, c.y + Math.sin(lat) * r * 0.85, c.z + Math.cos(lat) * Math.cos(lon) * r * 0.9); };
  // strands run around the ball (along s): swap roles so v follows the longitude
  const g = gridSurf(base, (s, t) => f(t, s), far ? 8 : 14, far ? 12 : 24, 240, 0.25, () => 1, () => 0.008, { inside: () => toM(base, c) });
  return g;
}

// ---------------------------------------------------------------------------------------------------------- public builders
/** Hair geometry for a style (null for bald). `far` = the cheap LOD (core + two solid layers). */
export function hairShellGeometry(base: BodyBase, style: HairStyle, hatOn: boolean, far = false): THREE.BufferGeometry | null {
  const sp = SCALP[style]; if (!sp) return null;
  const acc = new Acc();
  acc.add(scalpSurf(base, sp, hatOn), { layers: sp.layers, mode: sp.mode, droop: sp.droop, size: sp.size }, far);
  const longL = { layers: 5, mode: MODE.lying, core: true, twoSided: true };
  switch (style) {
    case 'long': acc.add(curtain(base, -3.4, -2.1, 0.6, 0.1, far), longL, far); break;
    case 'bob': acc.add(curtain(base, -0.95, -0.75, 0.66, 0.06, far), longL, far); break;
    case 'ponytail': if (!hatOn || true) acc.add(tubeSurf(base, [V3(0, 0.36, -1.02), V3(0, 0.24, -1.2), V3(0, -0.25, -1.26), V3(0, -0.95, -1.2), V3(0, -1.65, -1.12)], t => 0.017 * (1 - t * 0.5) + 0.006 * Math.sin(t * Math.PI), far), { layers: 5, mode: MODE.lying, core: true }, far); break;
    case 'bun': if (!hatOn) acc.add(ballSurf(base, V3(0, 0.78, -0.82), 0.34, far), { layers: 5, mode: MODE.lying, core: true }, far); break;
    case 'buns': if (!hatOn) for (const sx of [-1, 1]) acc.add(ballSurf(base, V3(sx * 0.62, 0.78, -0.2), 0.27, far), { layers: 5, mode: MODE.lying, core: true }, far); break;
  }
  return acc.build(base);
}

/** Facial hair: the jaw / lip / chin region of the face mesh grown out in layers (stubble is skin paint plus a fine fuzz). */
export function beardShellGeometry(base: BodyBase, facial: FacialHair, far = false): THREE.BufferGeometry | null {
  if (facial === 'none') return null;
  const dbg = (globalThis as unknown as { __beardDbg?: number }).__beardDbg;
  const mask = dbg ? (h: THREE.Vector3) => (h.z > -0.3 && h.y < 0.6 && ((dbg === 1 ? Math.floor(h.y * 10) : Math.floor(h.x * 10)) & 1) === 0 ? 1 : 0) : beardMask(facial);
  const thick = (hn: THREE.Vector3) => facial === 'stubble' ? 0.0018
    : facial === 'moustache' ? 0.006
    : facial === 'goatee' ? 0.007 + 0.009 * sstep(-hn.y, 0.6, 0.95)
    : 0.008 + 0.01 * sstep(-hn.y, 0.55, 0.95) * sstep(hn.z, -0.1, 0.5);
  // strands run down the face and back under the chin; u goes round the jaw
  const param = (hn: THREE.Vector3, p: THREE.Vector3) => {
    const a = Math.atan2(hn.x, hn.z);
    return { u: (a / (Math.PI * 2) + 0.5) * 900, v: -(p.y - base.head.center.y) + Math.max(0, -hn.y - 0.7) * (base.head.center.z - p.z) * 0.8 };
  };
  const acc = new Acc();
  acc.add(headSurf(base, mask, thick, param, 0), { layers: far ? 2 : facial === 'stubble' ? 2 : 7, mode: facial === 'stubble' ? MODE.coil : MODE.lying, droop: facial === 'beard' || facial === 'goatee' ? 0.003 : 0 }, far);
  return acc.build(base);
}

/** Beard coverage at a face point (head coordinates): 0..1, negative = never (lips, eyes, nose). Shared with the skin paint shader. */
export function beardMask(facial: FacialHair) {
  return (h: THREE.Vector3): number => {
    if (h.y > 0.05 || h.z < -0.25) return 0;
    const ax = Math.abs(h.x);
    const lips = ax < 0.36 && h.y < -0.38 && h.y > -0.7 && h.z > 0.6 ? 1 : 0;
    const nose = ax < 0.25 && h.y > -0.42 && h.z > 0.7 ? 1 : 0;
    if (nose) return -1;
    const jaw = sstep(h.y, 0.02, -0.22) * sstep(h.z, -0.2, 0.25) * sstep(h.y, -1.1, -0.85);
    const mous = sstep(ax, 0.44, 0.3) * sstep(h.y, -0.5, -0.43) * sstep(h.y, -0.24, -0.32) * sstep(h.z, 0.65, 0.8);
    const chin = sstep(ax, 0.34, 0.2) * sstep(h.y, -0.62, -0.76) * sstep(h.z, 0.2, 0.55) * sstep(h.y, -1.1, -0.9);
    let m = 0;
    if (facial === 'stubble' || facial === 'beard') m = Math.max(jaw, mous);
    else if (facial === 'moustache') m = mous;
    else if (facial === 'goatee') m = Math.max(mous, chin, sstep(ax, 0.36, 0.22) * sstep(h.y, -0.62, -0.72) * sstep(h.z, 0.5, 0.7));
    if (lips) return m > 0 ? -1 : 0;
    return m;
  };
}
