/**
 * Hair and beards as layered hair cards: thin curved ribbons laid on the head (and falling off it under gravity), textured with a
 * procedural strand map (fine strands, root-to-tip shading, soft alpha edge) and alpha-tested. The scalp underneath is painted by the
 * skin shader (hair tint, fade, stubble), so short cuts need no solid shell. Cards are skinned to the head bone like every other extra.
 * Perf: one merged geometry per style/sex/hat (cached by the caller), one shared material per hair colour, no shadow casting.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { headCoords, hairline, type BodyBase } from './humanAssets';
import type { FullLook, HairStyle } from './look';

/** Styles built from cards (the others stay as the old shell / braid geometry; buzz and bald are skin paint only). */
export const CARD_HAIR = new Set<HairStyle>(['short', 'slick', 'parted', 'curly', 'afro', 'long', 'bob', 'pixie', 'ponytail', 'bun', 'buns', 'fade', 'crew']);

// ---------------------------------------------------------------------------------------------------------- strand texture + material
let strandTex: THREE.CanvasTexture | null = null;
/** 128x256: strands run along v (root at v = 0 / top row of the canvas), RGB = grey shading, A = strand coverage. */
export function strandTexture(): THREE.CanvasTexture | null {
  if (strandTex) return strandTex;
  if (typeof document === 'undefined') return null;
  const W = 128, H = 256, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); if (!g) return null;
  const r = new Rng(9137);
  const img = g.createImageData(W, H), d = img.data;
  // per-column strand profile: a strand is ~2-4 px wide with its own brightness, end point and slight sway
  const cols: { x: number; w: number; b: number; end: number; sway: number; ph: number }[] = [];
  for (let i = 0; i < 70; i++) cols.push({ x: r.range(0, W), w: r.range(1.1, 2.6), b: r.range(0.55, 1.0), end: r.range(0.72, 1.0), sway: r.range(0, 2.2), ph: r.range(0, 6.28) });
  const cover = new Float32Array(W * H), shade = new Float32Array(W * H);
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (const s of cols) {
      if (v > s.end) continue;
      const cx = s.x + Math.sin(v * 7 + s.ph) * s.sway;
      const taper = v > s.end - 0.18 ? (s.end - v) / 0.18 : 1; // thin to a point
      const hw = s.w * 0.5 * (0.35 + 0.65 * taper);
      for (let x = Math.floor(cx - hw - 1); x <= Math.ceil(cx + hw + 1); x++) {
        const xx = ((x % W) + W) % W, a = Math.max(0, Math.min(1, hw + 0.5 - Math.abs(x - cx)));
        if (a > cover[y * W + xx]) { cover[y * W + xx] = Math.max(cover[y * W + xx], a); shade[y * W + xx] = s.b * (0.85 + 0.15 * Math.sin(v * 40 + s.ph)); }
      }
    }
  }
  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    const root = 0.3 + 0.7 * Math.min(1, v / 0.38);           // roots sit in shadow
    const tip = 1 + 0.18 * Math.max(0, (v - 0.7) / 0.3);        // tips catch the light
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4, cv = cover[y * W + x];
      const edge = Math.min(1, Math.min(x, W - 1 - x) / 9);     // soft fade at the card sides
      const k = Math.max(0, Math.min(1, shade[y * W + x] * root * tip));
      d[i] = d[i + 1] = d[i + 2] = Math.round(255 * k);
      d[i + 3] = Math.round(255 * Math.min(1, cv * (0.35 + 0.65 * edge) * (v < 0.04 ? 1 : 1)));
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; t.wrapS = THREE.ClampToEdgeWrapping; t.generateMipmaps = true;
  strandTex = t; return t;
}
const mats = new Map<string, THREE.MeshPhysicalMaterial>();
/** Shared hair-card material for a hair colour: alpha-tested, double sided, sheen + anisotropy for a soft highlight along the strands. */
export function hairMaterial(hex: string): THREE.MeshPhysicalMaterial {
  let m = mats.get(hex); if (m) return m;
  const col = new THREE.Color(hex);
  m = new THREE.MeshPhysicalMaterial({ color: col, map: strandTexture(), alphaTest: 0.42, side: THREE.DoubleSide, vertexColors: true, roughness: 0.52, metalness: 0, sheen: 0.9, sheenRoughness: 0.35, sheenColor: col.clone().lerp(new THREE.Color('#ffffff'), 0.45), anisotropy: 0.65, anisotropyRotation: Math.PI / 2, envMapIntensity: 0.7 });
  mats.set(hex, m); return m;
}

// ---------------------------------------------------------------------------------------------------------- surfaces
interface Surf { P: Float32Array; N: Float32Array; idx: ArrayLike<number>; cdf: Float32Array; col: Grid }
class Grid {
  private cell = 0.035; private map = new Map<number, number[]>();
  constructor(private pos: Float32Array, private nor: Float32Array, ids: number[]) { for (const i of ids) { const k = this.key(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]); (this.map.get(k) ?? this.map.set(k, []).get(k)!).push(i); } }
  private key(x: number, y: number, z: number) { const c = this.cell; return ((Math.floor(x / c) + 512) * 1024 + (Math.floor(y / c) + 512)) * 1024 + (Math.floor(z / c) + 512); }
  /** Nearest body vertex within ~1 cell: signed distance along its normal. */
  query(p: THREE.Vector3, outN: THREE.Vector3): number | null {
    const c = this.cell; let best = -1, bd = c * c * 2.2;
    const cx = Math.floor(p.x / c), cy = Math.floor(p.y / c), cz = Math.floor(p.z / c);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (let d = -1; d <= 1; d++) {
      const l = this.map.get(((cx + a + 512) * 1024 + (cy + b + 512)) * 1024 + (cz + d + 512)); if (!l) continue;
      for (const i of l) { const dx = this.pos[i * 3] - p.x, dy = this.pos[i * 3 + 1] - p.y, dz = this.pos[i * 3 + 2] - p.z, dd = dx * dx + dy * dy + dz * dz; if (dd < bd) { bd = dd; best = i; } }
    }
    if (best < 0) return null;
    outN.set(this.nor[best * 3], this.nor[best * 3 + 1], this.nor[best * 3 + 2]);
    return (p.x - this.pos[best * 3]) * outN.x + (p.y - this.pos[best * 3 + 1]) * outN.y + (p.z - this.pos[best * 3 + 2]) * outN.z;
  }
}
const surfs = new WeakMap<BodyBase, Surf>();
function surface(base: BodyBase): Surf {
  let s = surfs.get(base); if (s) return s;
  const g = base.scalp, P = Float32Array.from(g.attributes.position.array as ArrayLike<number>), N = Float32Array.from(g.attributes.normal.array as ArrayLike<number>), idx = g.index!.array;
  const nt = idx.length / 3, cdf = new Float32Array(nt); let acc = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let t = 0; t < nt; t++) {
    a.fromArray(P, idx[t * 3] * 3); b.fromArray(P, idx[t * 3 + 1] * 3); c.fromArray(P, idx[t * 3 + 2] * 3);
    acc += b.sub(a).cross(c.sub(a)).length() * 0.5; cdf[t] = acc;
  }
  // collider: every body vertex from the shoulders up (head, neck, shoulders, upper back) so falling hair stays out of the body
  const B = base.bodyIdx, bp = B.attributes.position, bn = B.attributes.normal, ids: number[] = [];
  const minY = base.J.neck.y - 0.32;
  const bpos = new Float32Array(bp.count * 3), bnor = new Float32Array(bp.count * 3);
  for (let i = 0; i < bp.count; i++) { bpos[i * 3] = bp.getX(i); bpos[i * 3 + 1] = bp.getY(i); bpos[i * 3 + 2] = bp.getZ(i); bnor[i * 3] = bn.getX(i); bnor[i * 3 + 1] = bn.getY(i); bnor[i * 3 + 2] = bn.getZ(i); if (bp.getY(i) > minY && Math.abs(bp.getX(i)) < 0.3) ids.push(i); }
  s = { P, N, idx, cdf, col: new Grid(bpos, bnor, ids) }; surfs.set(base, s); return s;
}
function sampleRoot(s: Surf, r: Rng, p: THREE.Vector3, n: THREE.Vector3) {
  const total = s.cdf[s.cdf.length - 1], x = r.next() * total;
  let lo = 0, hi = s.cdf.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (s.cdf[m] < x) lo = m + 1; else hi = m; }
  let u = r.next(), v = r.next(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
  const w = 1 - u - v, i0 = s.idx[lo * 3], i1 = s.idx[lo * 3 + 1], i2 = s.idx[lo * 3 + 2];
  p.set(0, 0, 0); n.set(0, 0, 0);
  for (const [i, k] of [[i0, w], [i1, u], [i2, v]] as const) { p.x += s.P[i * 3] * k; p.y += s.P[i * 3 + 1] * k; p.z += s.P[i * 3 + 2] * k; n.x += s.N[i * 3] * k; n.y += s.N[i * 3 + 1] * k; n.z += s.N[i * 3 + 2] * k; }
  n.normalize();
}

// ---------------------------------------------------------------------------------------------------------- strands
interface Spec { len: number; flow: THREE.Vector3; lift: number; grav: number; wave: number; w: number; off: number; stick: number; seg?: number; target?: THREE.Vector3; tint?: number; arc?: { c: THREE.Vector3; r: number; ph: number } }
type Planner = (hn: THREE.Vector3, n: THREE.Vector3, p: THREE.Vector3, r: Rng) => Spec | null;
const UP = new THREE.Vector3(0, 1, 0);
const tang = (v: THREE.Vector3, n: THREE.Vector3) => v.addScaledVector(n, -v.dot(n)).normalize();

function buildCards(base: BodyBase, planners: Planners, seed: number, hatOn: boolean): THREE.BufferGeometry | null {
  const s = surface(base), r = new Rng(seed), H = base.head;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], colr: number[] = [], index: number[] = [];
  const p = new THREE.Vector3(), n = new THREE.Vector3(), hn = new THREE.Vector3(), q = new THREE.Vector3(), cn = new THREE.Vector3(), tmp = new THREE.Vector3();
  const side = new THREE.Vector3(), tan = new THREE.Vector3();
  for (const pl of planners) {
    let made = 0, tries = 0;
    while (made < pl.count && tries++ < pl.count * 40) {
      let spec: Spec | null;
      if (pl.fixedRoot) { const f = pl.fixedRoot(r); p.copy(f.p); n.copy(f.n); headCoords(H, p, hn); spec = pl.plan(hn, n, p, r); } else { sampleRoot(s, r, p, n); headCoords(H, p, hn); if (hatOn && hn.y > -0.05) continue; spec = pl.plan(hn, n, p, r); }
      if (!spec) continue;
      made++;
      const N = spec.seg ?? 5, step = spec.len / N, pts: THREE.Vector3[] = [], nrm: THREE.Vector3[] = [];
      q.copy(p).addScaledVector(n, spec.off); pts.push(q.clone()); nrm.push(n.clone());
      const cur = q.clone(), curN = n.clone(), phase = r.range(0, 6.28);
      if (spec.arc) { // a wrapped strand: meridian arc over a small sphere
        pts.length = 0; nrm.length = 0; const A = spec.arc;
        for (let i = 0; i <= N; i++) {
          const th = Math.PI * (0.04 + 0.92 * i / N), bulge = A.r * (1 + 0.06 * Math.sin(th));
          const o = V3(Math.sin(th) * Math.cos(A.ph), -Math.cos(th), Math.sin(th) * Math.sin(A.ph));
          pts.push(A.c.clone().addScaledVector(o, bulge)); nrm.push(o);
        }
      }
      else for (let i = 1; i <= N; i++) {
        const t = i / N;
        tmp.copy(spec.flow);
        if (spec.target) { tmp.copy(spec.target).sub(cur).normalize(); }
        tmp.addScaledVector(curN, spec.lift * (1 - t) * (1 - t));
        tmp.y -= spec.grav * t * t;
        if (spec.wave) { side.crossVectors(spec.flow, curN).normalize(); tmp.addScaledVector(side, Math.sin(t * 7 + phase) * spec.wave); }
        tmp.normalize(); cur.addScaledVector(tmp, step);
        const sd = s.col.query(cur, cn);
        if (sd !== null) {
          const want = spec.off + 0.0015 * t;
          const dd = want - sd;
          if (dd > 0) cur.addScaledVector(cn, dd); else cur.addScaledVector(cn, Math.max(dd, -spec.stick * step));
          curN.lerp(cn, 0.6).normalize();
        }
        pts.push(cur.clone()); nrm.push(curN.clone());
      }
      // ribbon
      const base0 = pos.length / 3, tint = (spec.tint ?? 1) * r.range(0.82, 1.12);
      for (let i = 0; i <= N; i++) {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(N, i + 1)];
        tan.copy(b).sub(a).normalize();
        side.crossVectors(tan, nrm[i]); if (side.lengthSq() < 1e-6) side.crossVectors(tan, UP); side.normalize();
        const t = i / N, w = spec.w * (1 - 0.55 * t * t) * 0.5;
        for (const sg of [-1, 1]) {
          pos.push(pts[i].x + side.x * w * sg, pts[i].y + side.y * w * sg, pts[i].z + side.z * w * sg);
          nor.push(nrm[i].x, nrm[i].y, nrm[i].z);
          uv.push(sg < 0 ? 0 : 1, t * 0.98);
          colr.push(tint, tint, tint);
        }
        if (i > 0) { const k = base0 + (i - 1) * 2; index.push(k, k + 1, k + 2, k + 1, k + 3, k + 2); }
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3));
  const nv = pos.length / 3, si = new Uint16Array(nv * 4), sw = new Float32Array(nv * 4), hi = base.boneNames.indexOf('DEF-head');
  for (let i = 0; i < nv; i++) { si[i * 4] = hi; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4)); g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.setIndex(index); g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

const V3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const sstep = THREE.MathUtils.smoothstep;
/** A point in head-normalised coordinates -> model space. */
const fromHn = (b: BodyBase, x: number, y: number, z: number) => V3(b.head.center.x + x * b.head.half.x, b.head.center.y + y * b.head.half.y, b.head.center.z + z * b.head.half.z);
const inHair = (hn: THREE.Vector3) => hn.y > hairline(hn.x, hn.z) - 0.04;

type Planners = { count: number; plan: Planner; fixedRoot?: (r: Rng) => { p: THREE.Vector3; n: THREE.Vector3 } }[];
function hairPlans(base: BodyBase, style: HairStyle): Planners {
  const crown = fromHn(base, 0, 0.9, -0.15), c = base.head.center;
  const rad = (p: THREE.Vector3, n: THREE.Vector3) => tang(p.clone().sub(crown), n);
  switch (style) {
    case 'short': return [{ count: 330, plan: (hn, n, p, r) => !inHair(hn) ? null : { len: r.range(0.03, 0.05), flow: hn.z > 0.45 && hn.y > 0.25 ? tang(V3(hn.x * 0.4, 0.25, 1), n) : rad(p, n), lift: 0.25, grav: 0.1, wave: 0.15, w: 0.02, off: r.range(0.002, 0.005), stick: 0.7 } }];
    case 'crew': return [{ count: 170, plan: (hn, n, p, r) => hn.y < 0.15 || !inHair(hn) ? null : { len: r.range(0.014, 0.022), flow: rad(p, n), lift: 0.2, grav: 0, wave: 0, w: 0.012, off: 0.0022, stick: 0.9, seg: 3, tint: 0.9 } }];
    case 'fade': return [{ count: 150, plan: (hn, n, p, r) => hn.y < 0.48 || !inHair(hn) ? null : { len: r.range(0.02, 0.034), flow: hn.z > 0.4 ? tang(V3(0, 0.3, 1), n) : rad(p, n), lift: 0.3, grav: 0, wave: 0.1, w: 0.014, off: 0.0025, stick: 0.8, seg: 3 } }];
    case 'slick': return [{ count: 300, plan: (hn, n, p, r) => !inHair(hn) ? null : { len: r.range(0.09, 0.14), flow: tang(V3(hn.x * 0.15, 0.12, -1), n), lift: 0.18, grav: 0.2, wave: 0.08, w: 0.022, off: r.range(0.002, 0.007), stick: 0.5 } }];
    case 'parted': return [{ count: 340, plan: (hn, n, p, r) => !inHair(hn) ? null : { len: r.range(0.07, 0.11), flow: tang(V3(Math.sign(hn.x - 0.32) * 1.0, -0.5, hn.z > 0.3 ? 0.35 : -0.15), n), lift: 0.3, grav: 0.35, wave: 0.12, w: 0.022, off: r.range(0.002, 0.007), stick: 0.5 } }];
    case 'curly': return [{ count: 520, plan: (hn, n, p, r) => !inHair(hn) ? null : { len: r.range(0.04, 0.075), flow: tang(V3(r.range(-1, 1), r.range(-0.3, 1), r.range(-1, 1)).normalize().add(rad(p, n)), n), lift: 0.9, grav: 0.25, wave: 0.7, w: 0.026, off: r.range(0.003, 0.01), stick: 0.2, seg: 4 } }];
    case 'afro': return [{ count: 760, plan: (hn, n, p, r) => !inHair(hn) && hn.y < -0.1 ? null : { len: r.range(0.06, 0.1), flow: p.clone().sub(c).normalize(), lift: 0.6, grav: 0.1, wave: 0.5, w: 0.034, off: r.range(0.004, 0.03), stick: 0, seg: 3 } }];
    case 'long': return [{ count: 620, plan: (hn, n, p, r) => hn.y < hairline(hn.x, hn.z) - 0.25 ? null : { len: hn.y > 0.5 ? r.range(0.26, 0.36) : r.range(0.22, 0.34), flow: tang(V3(Math.sign(hn.x || 1) * (hn.z > 0.2 ? 0.7 : 0.3), -1, hn.z > 0.2 ? 0.1 : -0.2), n), lift: 0.35, grav: 1.8, wave: 0.1, w: 0.03, off: r.range(0.002, 0.012), stick: 0.25, seg: 7 } }];
    case 'bob': return [{ count: 440, plan: (hn, n, p, r) => hn.y < hairline(hn.x, hn.z) - 0.2 ? null : { len: r.range(0.1, 0.15), flow: tang(V3(Math.sign(hn.x || 1) * (hn.z > 0.2 ? 0.7 : 0.25), -1, hn.z > 0.2 ? 0.1 : -0.15), n), lift: 0.35, grav: 1.3, wave: 0.05, w: 0.03, off: r.range(0.003, 0.012), stick: 0.3, seg: 6 } }];
    case 'pixie': return [{ count: 340, plan: (hn, n, p, r) => !inHair(hn) ? null : { len: r.range(0.045, 0.07), flow: tang(V3(hn.x * 0.8, -0.2, 0.6), n), lift: 0.35, grav: 0.1, wave: 0.2, w: 0.02, off: r.range(0.002, 0.007), stick: 0.5, seg: 4 } }];
    case 'ponytail': {
      const tie = fromHn(base, 0, 0.3, -1.02);
      return [
        { count: 240, plan: (hn, n, p, r) => !inHair(hn) ? null : { len: r.range(0.08, 0.13), flow: tang(tie.clone().sub(p), n), target: tie, lift: 0.12, grav: 0.05, wave: 0.05, w: 0.022, off: r.range(0.002, 0.006), stick: 0.6 } },
        { count: 90, fixedRoot: r => ({ p: tie.clone().add(V3(r.range(-0.012, 0.012), r.range(-0.01, 0.01), r.range(-0.01, 0.006))), n: V3(0, 0, -1) }), plan: (hn, n, p, r) => ({ len: r.range(0.2, 0.3), flow: V3(r.range(-0.1, 0.1), -0.45, -0.9).normalize(), lift: 0, grav: 1.4, wave: 0.18, w: 0.024, off: 0, stick: 0, seg: 6 }) },
      ];
    }
    case 'bun': {
      const tie = fromHn(base, 0, 0.62, -0.92), bc = fromHn(base, 0, 0.78, -0.98), br = 0.046;
      return [
        { count: 240, plan: (hn, n, p, r) => !inHair(hn) ? null : { len: r.range(0.07, 0.12), flow: tang(tie.clone().sub(p), n), target: tie, lift: 0.1, grav: 0, wave: 0.05, w: 0.022, off: r.range(0.002, 0.006), stick: 0.6 } },
        ...bunCards(bc, br, 110),
      ];
    }
    case 'buns': {
      const tl = fromHn(base, -0.55, 0.62, -0.62), tr = fromHn(base, 0.55, 0.62, -0.62), br = 0.04;
      return [
        { count: 260, plan: (hn, n, p, r) => !inHair(hn) ? null : { len: r.range(0.06, 0.11), flow: tang((hn.x < 0 ? tl : tr).clone().sub(p), n), target: hn.x < 0 ? tl : tr, lift: 0.1, grav: 0, wave: 0.05, w: 0.022, off: r.range(0.002, 0.006), stick: 0.6 } },
        ...bunCards(fromHn(base, -0.6, 0.72, -0.62), br, 70), ...bunCards(fromHn(base, 0.6, 0.72, -0.62), br, 70),
      ];
    }
    default: return [];
  }
}
/** Strands wrapped around a small sphere: meridian arcs from one pole to the other (a bun / knot). */
function bunCards(centre: THREE.Vector3, rad: number, count: number): Planners {
  return [{
    count, fixedRoot: () => ({ p: centre.clone(), n: V3(0, 1, 0) }),
    plan: (_hn, _n, _p, r) => ({ len: rad * 3, flow: UP, lift: 0, grav: 0, wave: 0, w: 0.02, off: 0, stick: 0, seg: 7, tint: 1.05, arc: { c: centre, r: rad, ph: r.range(0, 6.28) } }),
  }];
}

function facialPlans(base: BodyBase, kind: FullLook['facial']): Planners {
  const mouth = (hn: THREE.Vector3) => Math.abs(hn.x) < 0.34 && hn.y > -0.72 && hn.y < -0.4 && hn.z > 0.55;
  const mkBeard = (count: number, accept: (hn: THREE.Vector3) => boolean, lenA: number, lenB: number): Planners => [{
    count, plan: (hn, n, p, r) => {
      if (!accept(hn) || mouth(hn)) return null;
      const chin = sstep(-hn.y, 0.45, 0.95);
      return { len: r.range(lenA, lenB) * (0.8 + 0.6 * chin), flow: tang(V3(hn.x * 0.25, -1, 0.1), n), lift: 0.35, grav: 0.55, wave: 0.12, w: 0.013, off: r.range(0.0008, 0.0028), stick: 0.6, seg: 3, tint: 0.95 };
    },
  }];
  if (kind === 'beard') return mkBeard(420, hn => (hn.y < -0.1 && hn.z > -0.05) || (Math.abs(hn.x) > 0.5 && hn.y < 0.12 && hn.y > -0.3 && hn.z > -0.35 && hn.z < 0.3), 0.016, 0.03);
  if (kind === 'goatee') return mkBeard(150, hn => Math.abs(hn.x) < 0.34 && hn.y < -0.5 && hn.z > 0.35, 0.018, 0.034);
  if (kind === 'moustache') return [{ count: 120, plan: (hn, n, p, r) => !(Math.abs(hn.x) < 0.42 && hn.y > -0.52 && hn.y < -0.3 && hn.z > 0.55) || Math.abs(hn.y + 0.42) < 0.02 && Math.abs(hn.x) < 0.04 ? null : { len: r.range(0.012, 0.022), flow: tang(V3(Math.sign(hn.x || 1) * 0.7, -0.6, 0.3), n), lift: 0.4, grav: 0.3, wave: 0.1, w: 0.011, off: 0.0015, stick: 0.5, seg: 3, tint: 0.95 } }];
  return [];
}

/** Cards for a hair style (hat on: only strands hanging below the brim) or null when the style is painted / shell based. */
export function hairCardGeometry(base: BodyBase, style: HairStyle, hatOn: boolean): THREE.BufferGeometry | null {
  if (!CARD_HAIR.has(style)) return null;
  return buildCards(base, hairPlans(base, style), 1000 + style.length * 97 + style.charCodeAt(0), hatOn);
}
export function facialCardGeometry(base: BodyBase, kind: FullLook['facial']): THREE.BufferGeometry | null {
  const pl = facialPlans(base, kind); if (!pl.length) return null;
  return buildCards(base, pl, 777 + kind.length * 31, false);
}
