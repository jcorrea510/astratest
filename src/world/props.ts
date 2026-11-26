/**
 * Procedural street furniture and vegetation, built once as templates and instanced per chunk:
 * cobra-head street lights, mast-arm traffic signals, hydrants, benches, bins, bus shelters, phone kiosks,
 * newspaper boxes, parking meters, mailboxes, dumpsters, bollards, power poles, and leaf-card trees, palms, shrubs.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { TrimBuilder, T_PAINT, T_METAL, T_IRON, T_ROUGH, T_PLASTIC, T_GLASS, T_NIGHTGLOW, T_GLOW, type TrimParams } from './builders';

const C = (h: string) => new THREE.Color(h);
const D2R = Math.PI / 180;

/** Street light: arm points along local +z. Lamp head position relative to the base. */
export const LAMP = { reach: 2.3, height: 8.4 };
export function streetLightGeo(): THREE.BufferGeometry {
  const t = new TrimBuilder(); const pole = C('#5b6064'), dark = C('#3a3d40');
  t.cyl(0, 0, 0, 0.2, 0.17, 0.5, 10, C('#6d7174'), T_METAL);
  t.cyl(0, 0.5, 0, 0.12, 0.075, 7.6, 10, pole, T_METAL);
  // curved arm: four segments rising then levelling
  const pts: [number, number][] = [[0, 7.7], [0.6, 8.25], [1.4, 8.48], [LAMP.reach, 8.5]];
  for (let i = 0; i < pts.length - 1; i++) t.beam(0, pts[i][1], pts[i][0], 0, pts[i + 1][1], pts[i + 1][0], 0.09, 0.09, pole, T_METAL);
  t.box(0, LAMP.height + 0.05, LAMP.reach + 0.15, 0.36, 0.16, 0.75, 0, dark, T_METAL);
  t.box(0, LAMP.height - 0.04, LAMP.reach + 0.18, 0.26, 0.03, 0.5, 0, C('#fff2d8'), T_NIGHTGLOW(7));
  return t.build();
}
/** Lens radius of the signal lamps: a real 12-inch lens (Round 13: the old 0.5 m lenses in a 2 m head read as a toy). */
export const SIGNAL_LENS_R = 0.155;
/** Vertical spacing of the three lenses (red, amber, green from the top). */
export const SIGNAL_LENS_DY = 0.38;
/** How far in front of the head's anchor the lens discs sit (just proud of the housing face, inside the visors). */
export const SIGNAL_LENS_Z = 0.1;
/** Mast-arm traffic signal: pole at origin, arm along local -x of length `arm`, heads facing local +z (one per approach lane). */
export function signalGeo(arm: number): { geo: THREE.BufferGeometry; heads: THREE.Vector3[] } {
  const t = new TrimBuilder(); const pole = C('#8c9094'), dark = C('#101112'), yellow = C('#e8c21a');
  t.cyl(0, 0, 0, 0.3, 0.26, 0.5, 10, C('#6e706f'), T_METAL);
  t.cyl(0, 0.5, 0, 0.17, 0.12, 6.9, 10, pole, T_METAL);
  t.beam(0, 6.9, 0, -arm, 7.1, 0, 0.1, 0.13, pole, T_METAL);
  t.beam(0, 6.0, 0, -arm * 0.5, 7.0, 0, 0.05, 0.05, pole, T_METAL);
  const heads: THREE.Vector3[] = [];
  const hy = 5.65; // head centre; bottom of backplate stays above 4.3 m
  const xs = arm >= 6 ? [-arm + 0.8, -arm + 0.8 + 3.6] : [-arm + 0.8];
  for (const hx of xs) {
    // signal housing (three 12-inch sections, real proportions), black backplate with a thin yellow retroreflective border
    t.box(hx, hy, 0, 0.44, 1.2, 0.26, 0, dark, T_PLASTIC);
    t.box(hx, hy, -0.16, 0.84, 1.56, 0.02, 0, yellow, T_PAINT);
    t.box(hx, hy, -0.145, 0.78, 1.5, 0.03, 0, dark, T_PLASTIC);
    for (let k = 0; k < 3; k++) {
      const ly = hy + SIGNAL_LENS_DY - k * SIGNAL_LENS_DY;
      // tunnel visor: a hood over the top and down both sides of each lens, sloping forward
      t.box(hx, ly + 0.175, 0.24, 0.4, 0.02, 0.24, 0, dark, T_PLASTIC, -0.18);
      for (const sx of [-1, 1]) t.box(hx + sx * 0.19, ly + 0.07, 0.24, 0.02, 0.22, 0.22, 0, dark, T_PLASTIC);
      t.cyl(hx, ly, 0.125, 0.18, 0.18, 0.012, 14, dark, T_PLASTIC, 0, Math.PI / 2); // lens bezel ring (behind the lens disc)
    }
    t.beam(hx, hy + 0.6, 0, hx, 7.0, 0, 0.05, 0.05, dark, T_METAL);
    heads.push(new THREE.Vector3(hx, hy, 0.14 - SIGNAL_LENS_Z)); // lens discs land at z 0.14, just proud of the bezel
  }
  // pedestrian head and push button on the pole
  t.box(-0.26, 2.8, 0, 0.34, 0.36, 0.28, Math.PI / 2, dark, T_PLASTIC);
  t.box(0, 1.15, 0.2, 0.12, 0.18, 0.06, 0, C('#d8c25a'), T_PAINT);
  // street-name blade
  t.box(-arm * 0.45, 7.45, 0, 1.6, 0.3, 0.04, 0, C('#1f6b3a'), T_PAINT);
  return { geo: t.build(), heads };
}
export function hydrantGeo(): THREE.BufferGeometry {
  const t = new TrimBuilder(); const red = C('#b3261e'), cap = C('#d9d4c4');
  t.cyl(0, 0, 0, 0.2, 0.2, 0.08, 10, C('#7a7a75'), T_METAL);
  t.cyl(0, 0.08, 0, 0.15, 0.14, 0.6, 10, red, [0.5, 0.2, 2, 0]);
  t.cyl(0, 0.62, 0, 0.18, 0.18, 0.06, 10, red, [0.5, 0.2, 0, 0]);
  t.sphere(0, 0.7, 0, 0.14, red, [0.5, 0.2, 0, 0], 0.7);
  t.cyl(0, 0.78, 0, 0.04, 0.04, 0.08, 6, cap, T_METAL);
  for (const s of [-1, 1]) t.cyl(s * 0.14, 0.45, 0, 0.06, 0.06, 0.12, 8, cap, T_METAL, 0, 0, s * Math.PI / 2);
  t.cyl(0, 0.4, 0.14, 0.08, 0.08, 0.1, 8, cap, T_METAL, 0, Math.PI / 2);
  return t.build();
}
export function benchGeo(): THREE.BufferGeometry {
  const t = new TrimBuilder(); const iron = C('#2a2c2e'), wood = C('#8a5f3c');
  for (const x of [-0.75, 0.75]) { t.box(x, 0.22, 0.05, 0.06, 0.44, 0.5, 0, iron, T_IRON); t.box(x, 0.65, -0.2, 0.06, 0.5, 0.06, 0, iron, T_IRON, -0.15); t.box(x, 0.62, 0.15, 0.06, 0.05, 0.5, 0, iron, T_IRON); }
  for (let k = 0; k < 4; k++) t.box(0, 0.45, -0.12 + k * 0.11, 1.8, 0.04, 0.09, 0, wood, [0.8, 0, 2, 0]);
  for (let k = 0; k < 3; k++) t.box(0, 0.62 + k * 0.13, -0.24 - k * 0.02, 1.8, 0.09, 0.03, 0, wood, [0.8, 0, 2, 0], -0.15);
  return t.build();
}
export function binGeo(): THREE.BufferGeometry {
  const t = new TrimBuilder(); const g = C('#2f4a3a');
  t.cyl(0, 0, 0, 0.27, 0.3, 0.92, 12, g, [0.55, 0.3, 2, 0]);
  t.cyl(0, 0.92, 0, 0.32, 0.22, 0.12, 12, C('#26372d'), T_METAL);
  for (const y of [0.25, 0.7]) t.cyl(0, y, 0, 0.305, 0.305, 0.04, 12, C('#1d2a22'), T_METAL);
  return t.build();
}
export function busStopGeo(): THREE.BufferGeometry {
  const t = new TrimBuilder(); const frame = C('#4b5257'), glass = C('#a9c2c8');
  for (const x of [-1.9, 1.9]) for (const z of [-0.6, 0.6]) t.box(x, 1.25, z, 0.08, 2.5, 0.08, 0, frame, T_METAL);
  t.box(0, 2.56, 0, 4.1, 0.12, 1.6, 0, frame, T_METAL);
  t.box(0, 2.48, 0, 3.9, 0.04, 1.4, 0, C('#f0f0e8'), T_NIGHTGLOW(1.5));
  t.box(0, 1.35, -0.62, 3.7, 1.9, 0.03, 0, glass, T_GLASS);
  t.box(-1.92, 1.35, 0, 0.03, 1.9, 1.1, 0, glass, T_GLASS);
  t.box(1.92, 1.25, 0, 0.12, 2.1, 1.15, 0, C('#2d3236'), T_METAL);
  t.box(1.99, 1.3, 0, 0.02, 1.7, 1.0, 0, C('#ffe9c0'), T_GLOW(0.6));
  t.box(0, 0.45, -0.4, 2.4, 0.06, 0.4, 0, C('#6c7378'), T_METAL);
  for (const x of [-1.0, 1.0]) t.box(x, 0.22, -0.4, 0.06, 0.44, 0.3, 0, frame, T_METAL);
  // bus stop sign pole
  t.cyl(-2.4, 0, 0.7, 0.04, 0.04, 2.8, 6, frame, T_METAL);
  t.box(-2.4, 2.6, 0.7, 0.5, 0.5, 0.03, 0, C('#1f5fa8'), T_PAINT);
  return t.build();
}
export function phoneGeo(): THREE.BufferGeometry {
  const t = new TrimBuilder(); const body = C('#596169');
  t.box(0, 1.05, 0, 0.12, 2.1, 0.12, 0, body, T_METAL);
  t.box(0, 1.55, 0.12, 0.7, 1.0, 0.3, 0, body, T_METAL);
  t.box(0, 2.15, 0.15, 0.85, 0.08, 0.5, 0, C('#2c3136'), T_METAL);
  t.box(0, 2.2, 0.15, 0.6, 0.2, 0.04, 0, C('#e8eef0'), T_GLOW(0.5));
  t.box(0, 1.6, 0.28, 0.3, 0.45, 0.04, 0, C('#1b1d20'), T_PLASTIC);
  return t.build();
}
export function newsBoxesGeo(seed: number): THREE.BufferGeometry {
  const t = new TrimBuilder(); const r = new Rng(seed);
  const cols = ['#c0392b', '#1f5fa8', '#e2b007', '#2e7d32', '#ececec', '#6a1b9a'];
  for (let k = 0; k < 3; k++) {
    const x = -0.55 + k * 0.55, c = C(cols[r.int(0, cols.length - 1)]);
    t.box(x, 0.12, 0, 0.42, 0.24, 0.36, 0, C('#2a2a2a'), T_METAL);
    t.box(x, 0.62, 0, 0.48, 0.76, 0.42, 0, c, [0.5, 0.2, 2, 0]);
    t.box(x, 0.72, 0.215, 0.36, 0.3, 0.01, 0, C('#cfd8dc'), T_GLASS);
  }
  return t.build();
}
export function meterGeo(): THREE.BufferGeometry {
  const t = new TrimBuilder();
  t.cyl(0, 0, 0, 0.04, 0.04, 1.15, 6, C('#5a5f63'), T_METAL);
  t.box(0, 1.27, 0, 0.18, 0.28, 0.14, 0, C('#8b9196'), T_METAL);
  t.sphere(0, 1.42, 0, 0.1, C('#8b9196'), T_METAL, 0.7);
  t.box(0, 1.3, 0.075, 0.1, 0.08, 0.01, 0, C('#202020'), T_GLASS);
  return t.build();
}
export function mailboxGeo(): THREE.BufferGeometry {
  const t = new TrimBuilder(); const b = C('#244f8c');
  for (const x of [-0.18, 0.18]) for (const z of [-0.18, 0.18]) t.box(x, 0.12, z, 0.06, 0.24, 0.06, 0, b, T_METAL);
  t.box(0, 0.7, 0, 0.5, 0.9, 0.5, 0, b, [0.5, 0.3, 2, 0]);
  t.cyl(0, 1.15, 0, 0.25, 0.25, 0.5, 10, b, [0.5, 0.3, 0, 0], 0, 0, Math.PI / 2);
  return t.build();
}
export function dumpsterGeo(seed: number): THREE.BufferGeometry {
  const t = new TrimBuilder(); const c = C(seed % 2 ? '#2e5b3a' : '#2a4d7a');
  t.box(0, 0.75, 0, 2.0, 1.2, 1.3, 0, c, [0.55, 0.4, 2, 0]);
  t.box(0, 1.38, -0.05, 2.04, 0.06, 1.4, 0, C('#1b1b1b'), T_PLASTIC, 0.08);
  for (const x of [-0.85, 0.85]) for (const z of [-0.5, 0.5]) t.cyl(x, 0, z, 0.08, 0.08, 0.15, 6, C('#111'), T_ROUGH);
  for (const x of [-1.05, 1.05]) t.box(x, 0.9, 0, 0.08, 0.1, 1.0, 0, C('#3a3a3a'), T_METAL);
  return t.build();
}
export function bollardGeo(): THREE.BufferGeometry {
  const t = new TrimBuilder(); t.cyl(0, 0, 0, 0.11, 0.11, 0.9, 8, C('#3a3d40'), T_METAL); t.sphere(0, 0.9, 0, 0.11, C('#3a3d40'), T_METAL, 0.6); t.cyl(0, 0.75, 0, 0.115, 0.115, 0.06, 8, C('#e8c54a'), T_PAINT); return t.build();
}
/** Wooden utility pole with a crossarm, insulators and a transformer can. Wires attach at WIRE_Y on local x = +-1.1. */
export const WIRE = { y: 8.6, dx: 1.1 };
export function powerPoleGeo(transformer: boolean): THREE.BufferGeometry {
  const t = new TrimBuilder(); const wood = C('#5d4a38');
  t.cyl(0, 0, 0, 0.16, 0.12, 9.4, 8, wood, [0.9, 0, 2, 0]);
  t.box(0, 8.55, 0, 2.6, 0.12, 0.12, 0, wood, T_ROUGH);
  for (const x of [-1.1, 0, 1.1]) t.cyl(x, 8.6, 0, 0.05, 0.04, 0.16, 6, C('#cfd8d0'), [0.2, 0, 0, 0]);
  if (transformer) { t.cyl(0.25, 6.6, 0, 0.3, 0.3, 1.0, 10, C('#8c9296'), T_METAL); t.cyl(0.25, 7.6, 0, 0.3, 0.2, 0.08, 10, C('#6d7276'), T_METAL); }
  return t.build();
}
export function billboardFrameGeo(w: number): THREE.BufferGeometry {
  const t = new TrimBuilder(); const steel = C('#4a4d50');
  for (const x of [-w / 3, w / 3]) t.box(x, 1.6, -0.4, 0.3, 3.2, 0.3, 0, steel, T_IRON);
  t.box(0, 3.3 + w * 0.25, -0.1, w + 0.4, w * 0.5 + 0.4, 0.2, 0, steel, T_IRON);
  t.box(0, 3.1, 0.35, w, 0.06, 0.9, 0, steel, T_IRON);
  for (const x of [-w / 3, 0, w / 3]) { t.beam(x, 3.15, 0.75, x, 3.55 + w * 0.5, 0.75, 0.04, 0.04, steel, T_METAL); t.box(x, 3.25, 0.7, 0.3, 0.18, 0.3, 0, C('#fff1d0'), T_NIGHTGLOW(4), 0.6); }
  return t.build();
}

type LeafOut = { pos: number[]; nor: number[]; uv: number[]; col: number[] };
const _up = new THREE.Vector3(0, 1, 0);
const _ex = new THREE.Vector3(1, 0, 0);
/**
 * Leaf-cluster cards scattered through an ellipsoid lobe. Cards face mostly outwards (never a stack of parallel planes),
 * sky holes are carved out of the outer shell, and vertex colour darkens with depth into the whole crown (ambient occlusion).
 * `crown` is the overall crown sphere used for the depth term: centre (x,y,z) and radius R.
 */
function canopy(r: Rng, cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, cards: number, size: number, out: LeafOut, tint: THREE.Color,
  crown: { x: number; y: number; z: number; R: number } = { x: cx, y: cy, z: cz, R: Math.max(rx, ry, rz) }) {
  const holes: THREE.Vector3[] = [];
  for (let h = 0; h < 2; h++) { const a = r.next() * 6.28, u = r.range(-0.3, 0.9), s = Math.sqrt(1 - u * u); holes.push(new THREE.Vector3(cx + Math.cos(a) * s * rx * 0.8, cy + u * ry * 0.8, cz + Math.sin(a) * s * rz * 0.8)); }
  const p = new THREE.Vector3(), n0 = new THREE.Vector3(), nrm = new THREE.Vector3(), tv = new THREE.Vector3(), bv = new THREE.Vector3(), rnd = new THREE.Vector3(), vn = new THREE.Vector3();
  const cc = new THREE.Vector3(crown.x, crown.y, crown.z);
  const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let i = 0; i < cards; i++) {
    for (let tries = 0; tries < 4; tries++) {
      const u = r.next() * 2 - 1, a = r.next() * Math.PI * 2, rr = 0.35 + Math.cbrt(r.next()) * 0.6;
      const s = Math.sqrt(1 - u * u);
      p.set(cx + Math.cos(a) * s * rx * rr, cy + u * ry * rr, cz + Math.sin(a) * s * rz * rr);
      if (holes.some(h => h.distanceTo(p) < Math.min(rx, rz) * 0.32)) continue;
      break;
    }
    n0.set(p.x - crown.x, (p.y - crown.y) * 0.8 + crown.R * 0.15, p.z - crown.z).normalize();
    rnd.set(r.range(-1, 1), r.range(-1, 1), r.range(-1, 1)).normalize();
    nrm.copy(n0).multiplyScalar(0.7).addScaledVector(rnd, 0.9).normalize();
    tv.crossVectors(nrm, Math.abs(nrm.y) > 0.9 ? _ex : _up).normalize();
    bv.crossVectors(nrm, tv).normalize();
    const roll = r.range(0, 6.28), cr = Math.cos(roll), sr = Math.sin(roll);
    const t2 = tv.clone().multiplyScalar(cr).addScaledVector(bv, sr), b2 = bv.clone().multiplyScalar(cr).addScaledVector(tv, -sr);
    const sz = size * r.range(0.7, 1.25) * 0.5;
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, y]) => p.clone().addScaledVector(t2, x * sz).addScaledVector(b2, y * sz));
    // depth into the crown (0 at the surface, 1 at the core) and height: dark inside and underneath, bright on top
    const depth = THREE.MathUtils.clamp(1 - p.distanceTo(cc) / crown.R, 0, 1);
    const hgt = THREE.MathUtils.clamp((p.y - (crown.y - crown.R)) / (2 * crown.R), 0, 1);
    const ao = (0.42 + 0.72 * (1 - depth * depth)) * (0.78 + 0.34 * hgt) * r.range(0.9, 1.08);
    const yel = r.next() < 0.3 ? r.range(0.12, 0.28) : 0; // some leaves lean yellow-green
    const cr_ = tint.r * (1 + yel * 0.7) * ao, cg_ = tint.g * (1 + yel * 0.2) * ao, cb_ = tint.b * (1 - yel * 0.5) * ao;
    for (const k of [0, 1, 2, 0, 2, 3]) {
      const v = corners[k]; out.pos.push(v.x, v.y, v.z);
      vn.set(v.x - cx, (v.y - cy) * 0.7 + ry * 0.3, v.z - cz).normalize().lerp(n0, 0.5).normalize();
      out.nor.push(vn.x, vn.y, vn.z); out.uv.push(uvs[k][0], uvs[k][1]);
      out.col.push(cr_, cg_, cb_);
    }
  }
}
function leafGeo(o: LeafOut) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(o.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(o.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(o.uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(o.col, 3));
  g.computeBoundingSphere(); g.computeBoundingBox(); return g;
}
/** Tapered round limb from a to b (cylinder: r0 at a, r1 at b), via the trim builder's yaw/pitch cylinder. */
function limb(t: TrimBuilder, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r0: number, r1: number, seg: number, bark: THREE.Color) {
  const dx = bx - ax, dy = by - ay, dz = bz - az, len = Math.hypot(dx, dy, dz); if (len < 1e-3) return;
  t.cyl(ax, ay, az, r0, r1, len, seg, bark, [0.95, 0, 2, 0], Math.atan2(dx, dz), Math.acos(THREE.MathUtils.clamp(dy / len, -1, 1)));
}
/** Deciduous street tree (plane/maple-like): flared trunk, forked limbs visible below the crown, lobed crown with sky gaps. */
export function treeGeos(seed: number): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  const r = new Rng(seed); const t = new TrimBuilder(); const bark = C(['#5a4c40', '#665848', '#4f4338'][seed % 3]);
  const h = r.range(3.2, 4.2);
  t.cyl(0, 0, 0, 0.36, 0.2, 0.55, 5, bark, [0.95, 0, 2, 0]); // root flare
  t.cyl(0, 0.5, 0, 0.2, 0.13, h - 0.5, 5, bark, [0.95, 0, 2, 0]);
  const o: LeafOut = { pos: [], nor: [], uv: [], col: [] };
  const tint = C(['#9fbe62', '#92b25a', '#a9c46c', '#86a853'][seed % 4]);
  const nb = r.int(3, 5);
  const crown = { x: 0, y: h + 1.7, z: 0, R: 3.1 };
  for (let i = 0; i < nb; i++) {
    const a = (i / nb) * Math.PI * 2 + r.range(-0.35, 0.35), len = r.range(1.7, 2.5), up = r.range(0.9, 1.5);
    const by = h * r.range(0.7, 0.95);
    const ex = Math.cos(a) * len, ez = Math.sin(a) * len;
    limb(t, 0, by, 0, ex, by + up, ez, 0.1, 0.05, 3, bark);
    const mx = ex * 0.55, mz = ez * 0.55, my = by + up * 0.55; // a twig forking sideways off the limb
    const a2 = a + r.range(0.5, 0.9) * (i % 2 ? 1 : -1);
    if (i % 2 === 0) limb(t, mx, my, mz, mx + Math.cos(a2) * 0.9, my + 0.7, mz + Math.sin(a2) * 0.9, 0.05, 0.03, 3, bark);
    canopy(r, ex * 0.85, by + up + 0.65, ez * 0.85, 1.55, 1.2, 1.55, 12, 1.85, o, tint, crown);
  }
  canopy(r, 0, h + 2.1, 0, 2.1, 1.5, 2.1, 17, 1.95, o, tint, crown);
  return { trunk: t.build(), leaves: leafGeo(o) };
}
export function palmGeos(seed: number): { trunk: THREE.BufferGeometry; leaves: THREE.BufferGeometry } {
  const r = new Rng(seed); const t = new TrimBuilder();
  const h = r.range(7, 10), lean = r.range(0.4, 1.4), segs = 9;
  let px = 0, py = 0;
  for (let i = 0; i < segs; i++) {
    const t0 = i / segs, t1 = (i + 1) / segs;
    const x0 = lean * t0 * t0, x1 = lean * t1 * t1;
    t.beam(x0, t0 * h, 0, x1, t1 * h, 0, 0.36 - t1 * 0.1, 0.36 - t1 * 0.1, C(i % 2 ? '#8a7356' : '#7b664c'), [0.95, 0, 2, 0]);
    px = x1; py = t1 * h;
  }
  t.sphere(px, py - 0.2, 0, 0.45, C('#5d4c36'), T_ROUGH, 0.8);
  // fronds: arched strips of quads with the palm-leaf card
  const o = { pos: [] as number[], nor: [] as number[], uv: [] as number[], col: [] as number[] };
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + r.range(-0.2, 0.2); const len = r.range(3.6, 4.6), droop = r.range(1.2, 2.2), wdt = 1.3;
    const steps = 5; const dir = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)), side = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
    const shade = r.range(0.85, 1.1); const tint = C('#9bb06a');
    for (let s = 0; s < steps; s++) {
      const P = (k: number, sd: number) => { const tt = k / steps; return new THREE.Vector3(px, py + 0.1, 0).addScaledVector(dir, tt * len).add(new THREE.Vector3(0, tt * 0.9 - tt * tt * droop, 0)).addScaledVector(side, sd * wdt * 0.5); };
      const a0 = P(s, -1), b0 = P(s, 1), a1 = P(s + 1, -1), b1 = P(s + 1, 1);
      const u0 = s / steps, u1 = (s + 1) / steps;
      const quad = [[a0, u0, 0], [b0, u0, 1], [b1, u1, 1], [a0, u0, 0], [b1, u1, 1], [a1, u1, 0]] as const;
      for (const [v, u, vv] of quad) {
        o.pos.push(v.x, v.y, v.z); o.uv.push(u, vv);
        // normals lean outward along the arch (soft shading, not a flat up-facing sheet); colour: dark at the crown core, brighter to the tips
        o.nor.push(dir.x * 0.35, 0.94 - u * 0.4, dir.z * 0.35);
        const ao = (0.5 + 0.62 * u) * shade; o.col.push(tint.r * ao, tint.g * ao * 1.02, tint.b * ao * 0.95);
      }
    }
  }
  return { trunk: t.build(), leaves: leafGeo(o) };
}
export function shrubGeos(seed: number): { leaves: THREE.BufferGeometry } {
  const r = new Rng(seed); const o = { pos: [] as number[], nor: [] as number[], uv: [] as number[], col: [] as number[] };
  canopy(r, 0, 0.55, 0, 0.9, 0.6, 0.9, 10, 1.1, o, C('#94b464'));
  return { leaves: leafGeo(o) };
}
export function leafMaterial(map: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.45, side: THREE.DoubleSide, roughness: 0.85, vertexColors: true });
  return m;
}
void D2R; void T_GLOW;
export type { TrimParams };
