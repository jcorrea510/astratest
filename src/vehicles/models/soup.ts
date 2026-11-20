/**
 * Triangle soup used to build the procedural cars: flat vertex records (position, normal, uv, colour + extra,
 * surface kind, bone) that can be cut by implicit functions (exact edge roots), recoloured, mirrored and baked
 * into one skinned BufferGeometry per material.
 */
import * as THREE from 'three';

/** floats per vertex: p3 n3 uv2 c4 kind bone */
export const STRIDE = 14;
export type Fn3 = (x: number, y: number, z: number) => number;
export interface Paint { kind: number; color?: THREE.ColorRepresentation; extra?: number; bone?: number }

const tmpC = new THREE.Color();
export class Soup {
  d: number[] = [];
  get verts() { return this.d.length / STRIDE; }
  get tris() { return this.d.length / STRIDE / 3; }
  vert(px: number, py: number, pz: number, nx: number, ny: number, nz: number, u: number, v: number, r: number, g: number, b: number, a: number, kind: number, bone: number) {
    this.d.push(px, py, pz, nx, ny, nz, u, v, r, g, b, a, kind, bone);
  }
  append(o: Soup) { for (let i = 0; i < o.d.length; i++) this.d.push(o.d[i]); return this; }
  clone() { const s = new Soup(); s.d = this.d.slice(); return s; }
  /** Adds a three.js geometry (indexed or not) with one paint. uv is kept when present. */
  addGeometry(g: THREE.BufferGeometry, p: Paint, m?: THREE.Matrix4) {
    const geo = g.index ? g.toNonIndexed() : g;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position, nor = geo.attributes.normal, uv = geo.attributes.uv;
    tmpC.set(p.color ?? '#ffffff').convertSRGBToLinear();
    const v = new THREE.Vector3(), n = new THREE.Vector3();
    const nm = m ? new THREE.Matrix3().getNormalMatrix(m) : null;
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i); n.fromBufferAttribute(nor, i);
      if (m) { v.applyMatrix4(m); n.applyMatrix3(nm!).normalize(); }
      this.vert(v.x, v.y, v.z, n.x, n.y, n.z, uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0, tmpC.r, tmpC.g, tmpC.b, p.extra ?? 0, p.kind, p.bone ?? 0);
    }
    if (geo !== g) geo.dispose();
    return this;
  }
  /** Sets kind / colour / bone of every vertex. */
  paint(p: Partial<Paint>) {
    if (p.color !== undefined) tmpC.set(p.color).convertSRGBToLinear();
    for (let i = 0; i < this.d.length; i += STRIDE) {
      if (p.kind !== undefined) this.d[i + 12] = p.kind;
      if (p.bone !== undefined) this.d[i + 13] = p.bone;
      if (p.color !== undefined) { this.d[i + 8] = tmpC.r; this.d[i + 9] = tmpC.g; this.d[i + 10] = tmpC.b; }
      if (p.extra !== undefined) this.d[i + 11] = p.extra;
    }
    return this;
  }
  /** Moves every vertex (normals are kept unless the function is a pure translation). */
  translate(x: number, y: number, z: number) { for (let i = 0; i < this.d.length; i += STRIDE) { this.d[i] += x; this.d[i + 1] += y; this.d[i + 2] += z; } return this; }
  applyMatrix(m: THREE.Matrix4) {
    const v = new THREE.Vector3(), n = new THREE.Vector3(), nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < this.d.length; i += STRIDE) {
      v.set(this.d[i], this.d[i + 1], this.d[i + 2]).applyMatrix4(m); n.set(this.d[i + 3], this.d[i + 4], this.d[i + 5]).applyMatrix3(nm).normalize();
      this.d[i] = v.x; this.d[i + 1] = v.y; this.d[i + 2] = v.z; this.d[i + 3] = n.x; this.d[i + 4] = n.y; this.d[i + 5] = n.z;
    }
    return this;
  }
  /** Mirror copy across x = 0 (winding flipped so faces stay outward). */
  mirrorX(): Soup {
    const s = new Soup(); const d = this.d;
    for (let t = 0; t < d.length; t += STRIDE * 3) for (const k of [0, 2, 1]) {
      const o = t + k * STRIDE;
      for (let j = 0; j < STRIDE; j++) s.d.push(j === 0 || j === 3 ? -d[o + j] : d[o + j]);
    }
    return s;
  }
  /** Flipped copy (inside faces). */
  flipped(): Soup {
    const s = new Soup(); const d = this.d;
    for (let t = 0; t < d.length; t += STRIDE * 3) for (const k of [0, 2, 1]) {
      const o = t + k * STRIDE;
      for (let j = 0; j < STRIDE; j++) s.d.push(j >= 3 && j <= 5 ? -d[o + j] : d[o + j]);
    }
    return s;
  }
  /** Splits by an implicit function: [inside (f < 0), outside]. Edge crossings are found exactly (regula falsi). */
  split(f: Fn3): [Soup, Soup] {
    const ins = new Soup(), out = new Soup(), d = this.d;
    const fv = [0, 0, 0];
    const va: number[] = new Array(STRIDE), vb: number[] = new Array(STRIDE), vc: number[] = new Array(STRIDE);
    const cross = (o1: number, f1: number, o2: number, f2: number, dst: number[]) => {
      let lo = 0, hi = 1, flo = f1, fhi = f2, t = f1 / (f1 - f2);
      for (let it = 0; it < 6; it++) {
        const x = d[o1] + (d[o2] - d[o1]) * t, y = d[o1 + 1] + (d[o2 + 1] - d[o1 + 1]) * t, z = d[o1 + 2] + (d[o2 + 2] - d[o1 + 2]) * t;
        const ft = f(x, y, z);
        if (Math.abs(ft) < 1e-5) break;
        if ((ft < 0) === (flo < 0)) { lo = t; flo = ft; } else { hi = t; fhi = ft; }
        t = lo + (hi - lo) * (flo / (flo - fhi));
      }
      for (let j = 0; j < STRIDE; j++) dst[j] = d[o1 + j] + (d[o2 + j] - d[o1 + j]) * t;
      const nl = Math.hypot(dst[3], dst[4], dst[5]) || 1; dst[3] /= nl; dst[4] /= nl; dst[5] /= nl;
      dst[12] = d[o1 + 12]; dst[13] = d[o1 + 13];
    };
    const push = (s: Soup, ...vs: (number | number[])[]) => {
      for (const v of vs) { if (typeof v === 'number') for (let j = 0; j < STRIDE; j++) s.d.push(d[v + j]); else for (let j = 0; j < STRIDE; j++) s.d.push(v[j]); }
    };
    for (let t = 0; t < d.length; t += STRIDE * 3) {
      const o = [t, t + STRIDE, t + STRIDE * 2];
      for (let k = 0; k < 3; k++) fv[k] = f(d[o[k]], d[o[k] + 1], d[o[k] + 2]);
      const s0 = fv[0] < 0, s1 = fv[1] < 0, s2 = fv[2] < 0;
      if (s0 === s1 && s1 === s2) { push(s0 ? ins : out, o[0], o[1], o[2]); continue; }
      // rotate so that vertex 0 is the lone one
      let r = 0; if (s0 === s1) r = 2; else if (s0 === s2) r = 1;
      const i0 = o[r], i1 = o[(r + 1) % 3], i2 = o[(r + 2) % 3];
      const f0 = fv[r], f1 = fv[(r + 1) % 3], f2 = fv[(r + 2) % 3];
      cross(i0, f0, i1, f1, va); cross(i0, f0, i2, f2, vb);
      const lone = f0 < 0 ? ins : out, pair = f0 < 0 ? out : ins;
      push(lone, i0, va.slice(), vb.slice());
      push(pair, va.slice(), i1, i2);
      for (let j = 0; j < STRIDE; j++) vc[j] = vb[j];
      push(pair, va.slice(), i2, vc.slice());
    }
    return [ins, out];
  }
  /** Splits by an implicit function and repaints the inside part; returns the merged soup. */
  region(f: Fn3, p: Partial<Paint>, extra?: (inside: Soup) => void): Soup {
    const [i, o] = this.split(f); i.paint(p); extra?.(i); return o.append(i);
  }
  /** Partition by triangle centroid. */
  partition(pred: (x: number, y: number, z: number, nx: number, ny: number, nz: number, kind: number) => boolean): [Soup, Soup] {
    const a = new Soup(), b = new Soup(), d = this.d;
    for (let t = 0; t < d.length; t += STRIDE * 3) {
      const cx = (d[t] + d[t + STRIDE] + d[t + 2 * STRIDE]) / 3, cy = (d[t + 1] + d[t + STRIDE + 1] + d[t + 2 * STRIDE + 1]) / 3, cz = (d[t + 2] + d[t + STRIDE + 2] + d[t + 2 * STRIDE + 2]) / 3;
      const nx = d[t + 3] + d[t + STRIDE + 3] + d[t + 2 * STRIDE + 3], ny = d[t + 4] + d[t + STRIDE + 4] + d[t + 2 * STRIDE + 4], nz = d[t + 5] + d[t + STRIDE + 5] + d[t + 2 * STRIDE + 5];
      const s = pred(cx, cy, cz, nx / 3, ny / 3, nz / 3, d[t + 12]) ? a : b;
      for (let j = 0; j < STRIDE * 3; j++) s.d.push(d[t + j]);
    }
    return [a, b];
  }
  /** Moves vertices along their normal by `amount` (insets lamps, builds door trims). */
  offset(amount: number) { for (let i = 0; i < this.d.length; i += STRIDE) { this.d[i] += this.d[i + 3] * amount; this.d[i + 1] += this.d[i + 4] * amount; this.d[i + 2] += this.d[i + 5] * amount; } return this; }
  /** Nearest ray hit (origin, unit dir) against the soup; returns distance or Infinity. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, pred?: (kind: number) => boolean): number {
    const d = this.d; let best = Infinity;
    for (let t = 0; t < d.length; t += STRIDE * 3) {
      if (pred && !pred(d[t + 12])) continue;
      const ax = d[t], ay = d[t + 1], az = d[t + 2];
      const e1x = d[t + STRIDE] - ax, e1y = d[t + STRIDE + 1] - ay, e1z = d[t + STRIDE + 2] - az;
      const e2x = d[t + 2 * STRIDE] - ax, e2y = d[t + 2 * STRIDE + 1] - ay, e2z = d[t + 2 * STRIDE + 2] - az;
      const px = dy * e2z - dz * e2y, py = dz * e2x - dx * e2z, pz = dx * e2y - dy * e2x;
      const det = e1x * px + e1y * py + e1z * pz; if (Math.abs(det) < 1e-9) continue;
      const inv = 1 / det, tx = ox - ax, ty = oy - ay, tz = oz - az;
      const u = (tx * px + ty * py + tz * pz) * inv; if (u < 0 || u > 1) continue;
      const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x;
      const v = (dx * qx + dy * qy + dz * qz) * inv; if (v < 0 || u + v > 1) continue;
      const dist = (e2x * qx + e2y * qy + e2z * qz) * inv;
      if (dist > 0 && dist < best) best = dist;
    }
    return best;
  }
  /**
   * Vertex-clustering decimation: vertices that share a grid cell (and bone + surface kind) merge into one averaged vertex;
   * triangles that collapse are dropped. Used for the far LODs of the cars (the bones keep wheels and doors separate).
   */
  decimate(cell: number): Soup {
    const d = this.d, n = this.verts, key = new Array<string>(n);
    const acc = new Map<string, { s: number[]; c: number }>();
    for (let i = 0; i < n; i++) {
      const o = i * STRIDE, k = `${Math.floor(d[o] / cell)},${Math.floor(d[o + 1] / cell)},${Math.floor(d[o + 2] / cell)},${d[o + 12]},${d[o + 13]}`;
      key[i] = k; let a = acc.get(k);
      if (!a) { a = { s: d.slice(o, o + STRIDE), c: 1 }; acc.set(k, a); } else { a.c++; for (let j = 0; j < 6; j++) a.s[j] += d[o + j]; }
    }
    const out = new Soup();
    for (let t = 0; t < n; t += 3) {
      const k0 = key[t], k1 = key[t + 1], k2 = key[t + 2];
      if (k0 === k1 || k1 === k2 || k0 === k2) continue;
      for (const k of [k0, k1, k2]) {
        const a = acc.get(k)!, v = a.s, nl = Math.hypot(v[3], v[4], v[5]) || 1;
        out.vert(v[0] / a.c, v[1] / a.c, v[2] / a.c, v[3] / nl, v[4] / nl, v[5] / nl, v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13]);
      }
    }
    return out;
  }
  /** Decimates until at most `target` triangles remain (binary search on the cluster size). */
  decimateTo(target: number): Soup {
    if (this.tris <= target) return this.clone();
    let lo = 0.01, hi = 3, best = this.decimate(hi);
    for (let i = 0; i < 7; i++) {
      const mid = Math.sqrt(lo * hi), r = this.decimate(mid);
      if (r.tris > target) lo = mid; else { hi = mid; best = r; }
    }
    return best;
  }
  /** Bakes into a skinned BufferGeometry (rigid single-bone weights). */
  toGeometry(): THREE.BufferGeometry {
    const n = this.verts, d = this.d;
    const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), C = new Float32Array(n * 4), K = new Float32Array(n);
    const SI = new Uint16Array(n * 4), SW = new Float32Array(n * 4);
    for (let i = 0, o = 0; i < n; i++, o += STRIDE) {
      P[i * 3] = d[o]; P[i * 3 + 1] = d[o + 1]; P[i * 3 + 2] = d[o + 2];
      N[i * 3] = d[o + 3]; N[i * 3 + 1] = d[o + 4]; N[i * 3 + 2] = d[o + 5];
      U[i * 2] = d[o + 6]; U[i * 2 + 1] = d[o + 7];
      C[i * 4] = d[o + 8]; C[i * 4 + 1] = d[o + 9]; C[i * 4 + 2] = d[o + 10]; C[i * 4 + 3] = d[o + 11];
      K[i] = d[o + 12]; SI[i * 4] = d[o + 13]; SW[i * 4] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3)); g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(U, 2)); g.setAttribute('color', new THREE.BufferAttribute(C, 4));
    g.setAttribute('aKind', new THREE.BufferAttribute(K, 1));
    g.setAttribute('skinIndex', new THREE.BufferAttribute(SI, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(SW, 4));
    return g;
  }
}

/** Builds a quad-grid surface from a parametric function over the given parameter samples. */
export function gridSurface(fn: (a: number, t: number, out: number[]) => void, as: number[], ts: number[], p: Paint, outwardRef?: (x: number, y: number, z: number) => [number, number, number], uvFn?: (a: number, t: number) => [number, number]): Soup {
  const s = new Soup();
  const pts: number[][][] = [];
  const nrm: number[][][] = [];
  const tmp = [0, 0, 0], ta = [0, 0, 0], tb = [0, 0, 0], tc = [0, 0, 0], td = [0, 0, 0];
  for (let j = 0; j < ts.length; j++) {
    pts.push([]); nrm.push([]);
    for (let i = 0; i < as.length; i++) {
      const a = as[i], t = ts[j];
      fn(a, t, tmp); const P = [tmp[0], tmp[1], tmp[2]];
      const ea = 1e-3, et = 1e-3;
      fn(a + ea, t, ta); fn(a - ea, t, tb);
      fn(a, Math.min(1, t + et), tc); fn(a, Math.max(0, t - et), td);
      const ux = ta[0] - tb[0], uy = ta[1] - tb[1], uz = ta[2] - tb[2];
      const vx = tc[0] - td[0], vy = tc[1] - td[1], vz = tc[2] - td[2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      let l = Math.hypot(nx, ny, nz);
      if (l < 1e-12) { nx = 0; ny = 1; nz = 0; l = 1; }
      nx /= l; ny /= l; nz /= l;
      if (outwardRef) { const r = outwardRef(P[0], P[1], P[2]); if (nx * r[0] + ny * r[1] + nz * r[2] < 0) { nx = -nx; ny = -ny; nz = -nz; } }
      pts[j].push(P); nrm[j].push([nx, ny, nz]);
    }
  }
  tmpC.set(p.color ?? '#ffffff').convertSRGBToLinear();
  const V = (i: number, j: number) => { const P = pts[j][i], N = nrm[j][i]; const uv = uvFn ? uvFn(as[i], ts[j]) : [0, 0]; s.vert(P[0], P[1], P[2], N[0], N[1], N[2], uv[0], uv[1], tmpC.r, tmpC.g, tmpC.b, p.extra ?? 0, p.kind, p.bone ?? 0); };
  for (let j = 0; j < ts.length - 1; j++) for (let i = 0; i < as.length - 1; i++) {
    // orient each quad so its geometric normal agrees with the smooth normal
    const A = pts[j][i], B = pts[j][i + 1], C = pts[j + 1][i + 1];
    const e1 = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], e2 = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const gn = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const sn = nrm[j][i];
    const flip = gn[0] * sn[0] + gn[1] * sn[1] + gn[2] * sn[2] < 0;
    if (!flip) { V(i, j); V(i + 1, j); V(i + 1, j + 1); V(i, j); V(i + 1, j + 1); V(i, j + 1); }
    else { V(i, j); V(i + 1, j + 1); V(i + 1, j); V(i, j); V(i, j + 1); V(i + 1, j + 1); }
  }
  return s;
}
/** Removes degenerate (zero-area) triangles, e.g. at surface poles. */
export function dropDegenerate(s: Soup): Soup {
  const o = new Soup(), d = s.d;
  for (let t = 0; t < d.length; t += STRIDE * 3) {
    const e1x = d[t + STRIDE] - d[t], e1y = d[t + STRIDE + 1] - d[t + 1], e1z = d[t + STRIDE + 2] - d[t + 2];
    const e2x = d[t + 2 * STRIDE] - d[t], e2y = d[t + 2 * STRIDE + 1] - d[t + 1], e2z = d[t + 2 * STRIDE + 2] - d[t + 2];
    const a = Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x);
    if (a > 1e-9) for (let j = 0; j < STRIDE * 3; j++) o.d.push(d[t + j]);
  }
  return o;
}
export const spow = (x: number, e: number) => Math.sign(x) * Math.pow(Math.abs(x), e);
export const sstep = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Monotone cubic interpolation through (x, y) points sorted by x (Fritsch–Carlson). */
export function monotone(pts: [number, number][]): (x: number) => number {
  const n = pts.length, xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const dx: number[] = [], m: number[] = [];
  for (let i = 0; i < n - 1; i++) { dx.push(xs[i + 1] - xs[i]); m.push((ys[i + 1] - ys[i]) / dx[i]); }
  const c1: number[] = [m[0]];
  for (let i = 0; i < n - 2; i++) {
    if (m[i] * m[i + 1] <= 0) c1.push(0);
    else { const common = dx[i] + dx[i + 1]; c1.push(3 * common / ((common + dx[i + 1]) / m[i] + (common + dx[i]) / m[i + 1])); }
  }
  c1.push(m[n - 2]);
  return (x: number) => {
    if (x <= xs[0]) return ys[0]; if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0; while (i < n - 2 && x > xs[i + 1]) i++;
    const h = dx[i], t = (x - xs[i]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * c1[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * c1[i + 1];
  };
}
