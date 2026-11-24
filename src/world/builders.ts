/**
 * Low-level geometry writers used by the city: FacadeBuilder emits building surfaces with the procedural facade
 * attributes (see facadeShader.ts); TrimBuilder emits vertex-coloured boxes/cylinders/prisms with per-vertex
 * roughness/metalness/pattern/glow for trims, props and furniture. Both produce one merged non-indexed geometry.
 */
import * as THREE from 'three';

export interface WallSpec {
  kind: number; seed: number; cellW: number; cellH: number;
  winW: number; winH: number; sill: number; mat: number;
  originV: number; baseY: number; lit: number; floors: number;
}
export const SOLID = (mat: number, seed = 0, baseY = 0): WallSpec => ({ kind: 3, seed, cellW: 3, cellH: 3, winW: 0, winH: 0, sill: 0, mat, originV: 0, baseY, lit: 0, floors: 0 });
export const ROOF: WallSpec = { kind: 5, seed: 0, cellW: 1, cellH: 1, winW: 0, winH: 0, sill: 0, mat: 0, originV: 0, baseY: 0, lit: 0, floors: 0 };

const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _n = new THREE.Vector3();

export class FacadeBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; f1: number[] = []; f2: number[] = []; f3: number[] = [];
  /** Drops the JS number arrays once the GPU-bound typed arrays exist (they cost 8 bytes/element and stay reachable via Chunked). */
  release() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.f1 = []; this.f2 = []; this.f3 = []; }
  get empty() { return this.pos.length === 0; }
  private vert(p: THREE.Vector3, n: THREE.Vector3, u: number, v: number, c: THREE.Color, s: WallSpec) {
    this.pos.push(p.x, p.y, p.z); this.nor.push(n.x, n.y, n.z); this.uv.push(u, v); this.col.push(c.r, c.g, c.b);
    this.f1.push(s.kind, s.seed, s.cellW, s.cellH); this.f2.push(s.winW, s.winH, s.sill, s.mat); this.f3.push(s.originV, s.baseY, s.lit, s.floors);
  }
  /** Quad a,b,c,d (counter-clockwise seen from the front) with explicit uvs. */
  quad(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3, uvs: number[], color: THREE.Color, spec: WallSpec) {
    _n.subVectors(b, a).cross(_b.subVectors(d, a)).normalize();
    const vs = [a, b, c, a, c, d], us = [0, 1, 2, 0, 2, 3];
    for (let i = 0; i < 6; i++) this.vert(vs[i], _n, uvs[us[i] * 2], uvs[us[i] * 2 + 1], color, spec);
  }
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, uvs: number[], color: THREE.Color, spec: WallSpec) {
    _n.subVectors(b, a).cross(_b.subVectors(c, a)).normalize();
    const vs = [a, b, c];
    for (let i = 0; i < 3; i++) this.vert(vs[i], _n, uvs[i * 2], uvs[i * 2 + 1], color, spec);
  }
  /**
   * Vertical wall from (ax,az) to (bx,bz) between y0 and y1; outward normal is (b-a) x up.
   * Windowed specs get their cell width adjusted so a whole number of bays fits the wall.
   */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, color: THREE.Color, spec: WallSpec, uOff = 0) {
    const len = Math.hypot(bx - ax, bz - az); if (len < 0.01 || y1 - y0 < 0.01) return;
    let s = spec;
    if (spec.kind === 1 || spec.kind === 2 || spec.kind === 4 || spec.kind === 8) {
      const n = Math.max(1, Math.round(len / spec.cellW));
      const cw = len / n;
      if (cw < spec.winW + 0.5 && spec.kind === 2) s = { ...spec, kind: 3 };
      else s = { ...spec, cellW: cw, winW: spec.kind === 4 ? spec.winW : Math.min(spec.winW, cw - 0.4) }; // kind 4 stores the shop style in winW
    }
    const vb = y0 - spec.baseY, vt = y1 - spec.baseY;
    this.quad(_a.set(ax, y0, az).clone(), new THREE.Vector3(bx, y0, bz), new THREE.Vector3(bx, y1, bz), new THREE.Vector3(ax, y1, az), [uOff, vb, uOff + len, vb, uOff + len, vt, uOff, vt], color, s);
  }
  /** Horizontal rectangle (roof/floor) centred at cx,cz rotated by yaw, facing up (or down). */
  flat(cx: number, cz: number, w: number, d: number, y: number, yaw: number, color: THREE.Color, spec: WallSpec, down = false) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx: number, lz: number) => new THREE.Vector3(cx + lx * c + lz * s, y, cz - lx * s + lz * c);
    const hw = w / 2, hd = d / 2;
    const p = [P(-hw, hd), P(hw, hd), P(hw, -hd), P(-hw, -hd)];
    const u0 = cx * 0.5, v0 = cz * 0.5;
    const uvs = [u0 - hw, v0 + hd, u0 + hw, v0 + hd, u0 + hw, v0 - hd, u0 - hw, v0 - hd];
    if (down) this.quad(p[3], p[2], p[1], p[0], [uvs[6], uvs[7], uvs[4], uvs[5], uvs[2], uvs[3], uvs[0], uvs[1]], color, spec);
    else this.quad(p[0], p[1], p[2], p[3], uvs, color, spec);
  }
  /**
   * Box of walls (front = +z local) with per-face specs [front, right, back, left] (null = skip the face),
   * and an optional roof spec. Returns world corners.
   */
  box(cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number, color: THREE.Color, faces: (WallSpec | null)[], roof: WallSpec | null, roofColor?: THREE.Color) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx: number, lz: number) => [cx + lx * c + lz * s, cz - lx * s + lz * c] as const;
    const hw = w / 2, hd = d / 2;
    const k = [P(-hw, hd), P(hw, hd), P(hw, -hd), P(-hw, -hd)];
    for (let i = 0; i < 4; i++) {
      const f = faces[i % faces.length]; if (!f) continue;
      const a = k[i], b = k[(i + 1) % 4];
      this.wall(a[0], a[1], b[0], b[1], y0, y1, color, f);
    }
    if (roof) this.flat(cx, cz, w, d, y1, yaw, roofColor ?? color, roof);
  }
  /** Gable roof over a w x d footprint (ridge along local x), eaves at y0, ridge at y1, with gable-end walls. */
  gable(cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number, overhang: number, roofColor: THREE.Color, roofSpec: WallSpec, wallColor: THREE.Color, wallSpec: WallSpec) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx: number, y: number, lz: number) => new THREE.Vector3(cx + lx * c + lz * s, y, cz - lx * s + lz * c);
    const hw = w / 2 + overhang, hd = d / 2 + overhang, rise = y1 - y0;
    const slope = Math.hypot(hd, rise + overhang * rise / (d / 2));
    const ye = y0 - overhang * rise / (d / 2);
    // front slope (+z)
    this.quad(P(-hw, ye, hd), P(hw, ye, hd), P(hw, y1, 0), P(-hw, y1, 0), [0, 0, 2 * hw, 0, 2 * hw, slope, 0, slope], roofColor, roofSpec);
    this.quad(P(hw, ye, -hd), P(-hw, ye, -hd), P(-hw, y1, 0), P(hw, y1, 0), [0, 0, 2 * hw, 0, 2 * hw, slope, 0, slope], roofColor, roofSpec);
    // undersides of the overhang are skipped; gable triangles
    const gw = w / 2, gd = d / 2;
    this.tri(P(gw, y0, gd), P(gw, y0, -gd), P(gw, y1, 0), [0, y0 - wallSpec.baseY, d, y0 - wallSpec.baseY, d / 2, y1 - wallSpec.baseY], wallColor, wallSpec);
    this.tri(P(-gw, y0, -gd), P(-gw, y0, gd), P(-gw, y1, 0), [0, y0 - wallSpec.baseY, d, y0 - wallSpec.baseY, d / 2, y1 - wallSpec.baseY], wallColor, wallSpec);
  }
  /** Hip roof (four slopes) over w x d, eaves at y0, ridge at y1. */
  hip(cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number, overhang: number, roofColor: THREE.Color, roofSpec: WallSpec) {
    const c = Math.cos(yaw), s = Math.sin(yaw);
    const P = (lx: number, y: number, lz: number) => new THREE.Vector3(cx + lx * c + lz * s, y, cz - lx * s + lz * c);
    const hw = w / 2 + overhang, hd = d / 2 + overhang;
    const ridge = Math.max(0, hw - hd);
    const sl = Math.hypot(hd, y1 - y0);
    this.quad(P(-hw, y0, hd), P(hw, y0, hd), P(ridge, y1, 0), P(-ridge, y1, 0), [0, 0, 2 * hw, 0, hw + ridge, sl, hw - ridge, sl], roofColor, roofSpec);
    this.quad(P(hw, y0, -hd), P(-hw, y0, -hd), P(-ridge, y1, 0), P(ridge, y1, 0), [0, 0, 2 * hw, 0, hw + ridge, sl, hw - ridge, sl], roofColor, roofSpec);
    this.tri(P(hw, y0, hd), P(hw, y0, -hd), P(ridge, y1, 0), [0, 0, 2 * hd, 0, hd, sl], roofColor, roofSpec);
    this.tri(P(-hw, y0, -hd), P(-hw, y0, hd), P(-ridge, y1, 0), [0, 0, 2 * hd, 0, hd, sl], roofColor, roofSpec);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('facade', new THREE.Float32BufferAttribute(this.f1, 4));
    g.setAttribute('facade2', new THREE.Float32BufferAttribute(this.f2, 4));
    g.setAttribute('facade3', new THREE.Float32BufferAttribute(this.f3, 4));
    g.computeBoundingSphere(); g.computeBoundingBox();
    this.release();
    return g;
  }
}

/** [roughness, metalness, pattern, glow] */
export type TrimParams = [number, number, number, number];
/** Round 11: one trim param as a byte: roughness / metalness x255, pattern id as is, glow x10 (decoded in trimMaterial). Pure (tests). */
export function packTrim(v: number, k: number): number { return Math.round(THREE.MathUtils.clamp(k === 2 ? v : k === 3 ? v * 10 : v * 255, 0, 255)); }
export const T_PAINT: TrimParams = [0.6, 0, 0, 0];
export const T_STONE: TrimParams = [0.85, 0, 2, 0];
export const T_METAL: TrimParams = [0.45, 0.7, 0, 0];
export const T_IRON: TrimParams = [0.6, 0.5, 2, 0];
export const T_ROUGH: TrimParams = [0.92, 0, 2, 0];
export const T_PLASTIC: TrimParams = [0.4, 0, 0, 0];
export const T_GLASS: TrimParams = [0.06, 0.2, 0, 0];
export const T_FABRIC: TrimParams = [0.85, 0, 1, 0];
export const T_NIGHTGLOW = (g: number): TrimParams => [0.4, 0, 3, g];
export const T_GLOW = (g: number): TrimParams => [0.4, 0, 4, g];

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _nm = new THREE.Matrix3();
const _v = new THREE.Vector3(), _w = new THREE.Vector3();

/** Unit templates (non-indexed, centred, size 1) */
const templates = new Map<string, THREE.BufferGeometry>();
function template(key: string, make: () => THREE.BufferGeometry) {
  let g = templates.get(key);
  if (!g) { g = make(); if (g.index) g = g.toNonIndexed(); templates.set(key, g); }
  return g;
}

export class TrimBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = []; tr: number[] = [];
  release() { this.pos = []; this.nor = []; this.uv = []; this.col = []; this.tr = []; }
  get empty() { return this.pos.length === 0; }
  get vertexCount() { return this.pos.length / 3; }
  /** Appends a template geometry transformed by m. uvs are scaled to metres by `uvScale`. */
  geo(g: THREE.BufferGeometry, m: THREE.Matrix4, color: THREE.Color, t: TrimParams, uvScale: [number, number] = [1, 1]) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
    _nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m); _w.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      this.pos.push(_v.x, _v.y, _v.z); this.nor.push(_w.x, _w.y, _w.z);
      this.uv.push(uv ? uv.getX(i) * uvScale[0] : 0, uv ? uv.getY(i) * uvScale[1] : 0);
      this.col.push(color.r, color.g, color.b); this.tr.push(t[0], t[1], t[2], t[3]);
    }
  }
  /** Box centred at (x,y,z) with size (sx,sy,sz), rotated by yaw (then pitch about local x, roll about local z). */
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw: number, color: THREE.Color, t: TrimParams, pitch = 0, roll = 0) {
    const g = template('box', () => new THREE.BoxGeometry(1, 1, 1));
    _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz));
    this.geo(g, _m, color, t, [Math.max(sx, sz), sy]);
  }
  /** Vertical cylinder (or cone when r1 != r0) with its base at y. */
  cyl(x: number, y: number, z: number, r0: number, r1: number, h: number, seg: number, color: THREE.Color, t: TrimParams, yaw = 0, pitch = 0, roll = 0) {
    const key = `cyl${seg}:${(r1 / Math.max(r0, 1e-4)).toFixed(3)}`;
    const ratio = r1 / Math.max(r0, 1e-4);
    const g = template(key, () => new THREE.CylinderGeometry(ratio, 1, 1, seg, 1).translate(0, 0.5, 0));
    _q.setFromEuler(_e.set(pitch, yaw, roll, 'YXZ'));
    _m.compose(_p.set(x, y, z), _q, _s.set(r0, h, r0));
    this.geo(g, _m, color, t, [r0 * 6.28, h]);
  }
  sphere(x: number, y: number, z: number, r: number, color: THREE.Color, t: TrimParams, sy = 1) {
    const g = template('sph', () => new THREE.SphereGeometry(1, 8, 6));
    _m.compose(_p.set(x, y, z), _q.identity(), _s.set(r, r * sy, r));
    this.geo(g, _m, color, t);
  }
  /** Generic transform from position / quaternion / scale. */
  geoAt(key: string, make: () => THREE.BufferGeometry, pos: THREE.Vector3, q: THREE.Quaternion, scale: THREE.Vector3, color: THREE.Color, t: TrimParams) {
    _m.compose(pos, q, scale); this.geo(template(key, make), _m, color, t, [scale.x, scale.y]);
  }
  /** A slab between two points (beam / rail / wire segment) with square section `w` x `h`. */
  beam(ax: number, ay: number, az: number, bx: number, by: number, bz: number, w: number, h: number, color: THREE.Color, t: TrimParams) {
    const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz); if (len < 1e-3) return;
    const yaw = Math.atan2(dx, dz), pitch = -Math.asin(dy / len);
    this.box((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2, w, h, len, yaw, color, t, pitch);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    // Round 11 (memory + vertex bandwidth): the street dressing is ~10 M vertices. Normals and colours are packed into
    // normalized bytes and the trim params into raw bytes (decoded in trimMaterial), all 4-byte aligned for Metal:
    // 60 -> 32 bytes per vertex (~565 -> ~300 MB of the city's vertex data)
    const n = this.pos.length / 3, nor = new Int8Array(n * 4), col = new Uint8Array(n * 4), tr = new Uint8Array(n * 4);
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 3; k++) { nor[i * 4 + k] = Math.round(THREE.MathUtils.clamp(this.nor[i * 3 + k], -1, 1) * 127); col[i * 4 + k] = Math.round(THREE.MathUtils.clamp(this.col[i * 3 + k], 0, 1) * 255); }
      col[i * 4 + 3] = 255;
      const t = this.tr; tr[i * 4] = packTrim(t[i * 4], 0); tr[i * 4 + 1] = packTrim(t[i * 4 + 1], 1); tr[i * 4 + 2] = packTrim(t[i * 4 + 2], 2); tr[i * 4 + 3] = packTrim(t[i * 4 + 3], 3);
    }
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 4, true));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 4, true));
    g.setAttribute('trim', new THREE.BufferAttribute(tr, 4, false));
    g.computeBoundingSphere(); g.computeBoundingBox();
    this.release();
    return g;
  }
}

/** Static geometry only: once uploaded to the GPU the CPU copies are never read again (no raycast/clone), so drop them (saves ~300 MB). */
export function freeAfterUpload(g: THREE.BufferGeometry, keep: readonly string[] = []) {
  g.computeBoundingSphere(); if (!g.boundingBox) g.computeBoundingBox();
  const drop = (a: THREE.BufferAttribute | THREE.InterleavedBufferAttribute) => {
    if ((a as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return;
    const ba = a as THREE.BufferAttribute; const Ctor = ba.array.constructor as new (n: number) => typeof ba.array;
    ba.onUpload(() => { ba.array = new Ctor(0); });
  };
  for (const k in g.attributes) if (!keep.includes(k)) drop(g.attributes[k]);
  if (g.index && !keep.includes('index')) drop(g.index);
}

/** Spatial buckets of builders so every chunk is one draw call per material. */
export class Chunked<T extends { empty: boolean; build(): THREE.BufferGeometry }> {
  map = new Map<string, T>();
  constructor(public size: number, private make: () => T) { }
  at(x: number, z: number): T {
    const k = `${Math.floor(x / this.size)},${Math.floor(z / this.size)}`;
    let b = this.map.get(k); if (!b) { b = this.make(); this.map.set(k, b); } return b;
  }
  meshes(mat: THREE.Material, parent: THREE.Object3D, opts: { cast?: boolean; receive?: boolean; small?: boolean; name?: string } = {}): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    for (const [k, b] of this.map) {
      if (b.empty) continue;
      const geo = b.build(); freeAfterUpload(geo);
      const m = new THREE.Mesh(geo, mat); m.castShadow = opts.cast ?? true; m.receiveShadow = opts.receive ?? true;
      m.name = `${opts.name ?? 'chunk'}@${k}`; if (opts.small) m.userData.small = true;
      parent.add(m); out.push(m);
    }
    return out;
  }
}
