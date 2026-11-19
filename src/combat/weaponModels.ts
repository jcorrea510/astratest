/**
 * Procedural weapon models. Metres; muzzle along +z, the firing hand's grip at the origin (y up).
 *
 * Every part is built from side-profile extrusions (bevelled), lathes and cylinders, then merged per material, so a
 * detailed gun costs a handful of draw calls. Moving parts (magazine, slide / pump / bolt) stay separate meshes so the
 * reload and firing animations can move them. Geometry is cached per weapon id and materials are shared, so NPCs holding
 * the same gun share everything.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { WeaponId } from './weapons';

type Mat = 'steel' | 'polymer' | 'wood' | 'tan' | 'chrome' | 'lens' | 'bore' | 'olive' | 'glass' | 'cloth' | 'brass';
let MATS: Record<Mat, THREE.Material> | null = null;
function mats(): Record<Mat, THREE.Material> {
  if (MATS) return MATS;
  const std = (color: string, metalness: number, roughness: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  MATS = {
    steel: std('#2b2e33', 0.85, 0.34), polymer: std('#1c1d20', 0.05, 0.62), wood: std('#6e4628', 0.05, 0.55), tan: std('#9b8664', 0.05, 0.7),
    chrome: std('#b8bcc2', 0.95, 0.2), lens: std('#1b3550', 0.4, 0.05, { emissive: new THREE.Color('#0c2236'), emissiveIntensity: 0.6 }), bore: std('#050505', 0, 1),
    olive: std('#4d5638', 0.1, 0.65), glass: std('#5f8a6a', 0.1, 0.08, { transparent: true, opacity: 0.75 }), cloth: std('#c9b48a', 0, 0.95), brass: std('#b8893a', 0.9, 0.3),
  };
  for (const m of Object.values(MATS)) m.userData.shared = true;
  return MATS;
}

// ---------------------------------------------------------------- part builders
type Part = { geo: THREE.BufferGeometry; mat: Mat; group: string };
class Kit {
  parts: Part[] = [];
  group = 'body';
  in(group: string, fn: () => void) { const g = this.group; this.group = group; fn(); this.group = g; }
  private push(geo: THREE.BufferGeometry, mat: Mat) { this.parts.push({ geo, mat, group: this.group }); }
  /**
   * Side profile in (z forward, y up) extruded `w` wide across x, centred on x0, with a bevel. Points go around the outline.
   */
  prof(pts: [number, number][], w: number, mat: Mat, bevel = 0.003, x0 = 0) {
    const s = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    const b = Math.min(bevel, w * 0.3);
    const g = new THREE.ExtrudeGeometry(s, { depth: Math.max(0.001, w - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: 4 });
    g.rotateY(-Math.PI / 2); g.translate(x0 + (w - 2 * b) / 2, 0, 0);
    this.push(g, mat); return this;
  }
  /** Box (centre, size). */
  box(cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, mat: Mat, rx = 0) {
    const g = new THREE.BoxGeometry(sx, sy, sz); if (rx) g.rotateX(rx); g.translate(cx, cy, cz); this.push(g, mat); return this;
  }
  /** Cylinder along z from z0 to z1. */
  cyl(r: number, z0: number, z1: number, y: number, mat: Mat, seg = 12, x = 0, r1 = r) {
    const g = new THREE.CylinderGeometry(r1, r, z1 - z0, seg); g.rotateX(Math.PI / 2); g.translate(x, y, (z0 + z1) / 2); this.push(g, mat); return this;
  }
  /** Cylinder along x (pins, knobs, bolt handles). */
  cylX(r: number, len: number, x: number, y: number, z: number, mat: Mat, seg = 10) {
    const g = new THREE.CylinderGeometry(r, r, len, seg); g.rotateZ(Math.PI / 2); g.translate(x, y, z); this.push(g, mat); return this;
  }
  /** Vertical cylinder. */
  cylY(r: number, h: number, x: number, y: number, z: number, mat: Mat, seg = 10, r1 = r) {
    const g = new THREE.CylinderGeometry(r1, r, h, seg); g.translate(x, y, z); this.push(g, mat); return this;
  }
  /** Lathe around the z axis: points are [radius, z]. */
  lathe(pts: [number, number][], y: number, mat: Mat, seg = 14, x = 0) {
    const g = new THREE.LatheGeometry(pts.map(([r, z]) => new THREE.Vector2(Math.max(0.0005, r), z)), seg); g.rotateX(Math.PI / 2); g.translate(x, y, 0); this.push(g, mat); return this;
  }
  /** Lathe around the vertical axis: points are [radius, y]. */
  latheY(pts: [number, number][], mat: Mat, seg = 16, x = 0, z = 0) {
    const g = new THREE.LatheGeometry(pts.map(([r, yy]) => new THREE.Vector2(Math.max(0.0005, r), yy)), seg); g.translate(x, 0, z); this.push(g, mat); return this;
  }
  /** Bore: a dark disc just inside the muzzle so barrels read as hollow. */
  bore(r: number, z: number, y: number) { const g = new THREE.CircleGeometry(r, 10); g.translate(0, y, z + 0.0008); this.push(g, 'bore'); return this; }
  /** Picatinny rail from z0 to z1 on top at height y. */
  rail(z0: number, z1: number, y: number, w = 0.021, mat: Mat = 'steel') {
    this.box(0, y + 0.004, (z0 + z1) / 2, w * 0.7, 0.008, z1 - z0, mat);
    for (let z = z0 + 0.006; z < z1 - 0.004; z += 0.01) this.box(0, y + 0.0095, z, w, 0.004, 0.0052, mat);
    return this;
  }
  /** Front post + rear notch iron sights. */
  irons(zf: number, zr: number, y: number, mat: Mat = 'steel') { this.box(0, y + 0.006, zf, 0.004, 0.012, 0.006, mat); this.box(-0.006, y + 0.005, zr, 0.004, 0.01, 0.008, mat).box(0.006, y + 0.005, zr, 0.004, 0.01, 0.008, mat); return this; }
  /** Telescopic sight centred over the bore from z0 to z1, axis at height y. */
  scope(z0: number, z1: number, y: number, r = 0.019, obj = 0.026) {
    const L = z1 - z0;
    this.lathe([[0, z0], [r * 1.25, z0], [r * 1.3, z0 + 0.012], [r * 1.05, z0 + 0.04], [r, z0 + 0.06], [r, z0 + L * 0.42], [r * 1.12, z0 + L * 0.45], [r * 1.12, z0 + L * 0.55], [r, z0 + L * 0.58], [r, z1 - 0.07], [obj, z1 - 0.03], [obj * 1.05, z1], [0, z1]], y, 'steel', 16);
    this.cylY(0.007, 0.022, 0, y + r + 0.009, z0 + L * 0.5, 'steel', 10); this.cylX(0.007, 0.03, 0.022, y, z0 + L * 0.5, 'steel');
    const lens = (rr: number, z: number) => { const g = new THREE.CircleGeometry(rr, 14); g.translate(0, y, z); this.push(g, 'lens'); const g2 = new THREE.CircleGeometry(rr, 14); g2.rotateY(Math.PI); g2.translate(0, y, z); this.push(g2, 'lens'); };
    lens(obj * 0.85, z1 + 0.001); lens(r * 1.05, z0 - 0.001);
    // rings
    for (const z of [z0 + L * 0.28, z0 + L * 0.72]) { this.cyl(r + 0.004, z - 0.007, z + 0.007, y, 'steel', 14); this.box(0, y - r - 0.006, z, 0.016, 0.014, 0.014, 'steel'); }
    return this;
  }
  /** Small red-dot sight. */
  redDot(z: number, y: number) {
    this.prof([[z - 0.03, y], [z + 0.03, y], [z + 0.03, y + 0.014], [z + 0.02, y + 0.04], [z - 0.02, y + 0.04], [z - 0.03, y + 0.014]], 0.026, 'polymer', 0.002);
    const g = new THREE.CircleGeometry(0.009, 12); g.rotateY(Math.PI); g.translate(0, y + 0.026, z - 0.0305); this.push(g, 'lens');
    return this;
  }
  build(id: string): THREE.Group {
    const root = new THREE.Group(); root.name = `weapon:${id}`;
    const M = mats();
    const byGroup = new Map<string, Map<Mat, THREE.BufferGeometry[]>>();
    for (const p of this.parts) {
      let gm = byGroup.get(p.group); if (!gm) byGroup.set(p.group, gm = new Map());
      let list = gm.get(p.mat); if (!list) gm.set(p.mat, list = []);
      const g = p.geo.index ? p.geo.toNonIndexed() : p.geo; g.clearGroups();
      for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      list.push(g);
    }
    for (const [group, gm] of byGroup) {
      const node = group === 'body' ? root : new THREE.Group(); node.name = group;
      for (const [mat, list] of gm) {
        const merged = mergeGeometries(list, false); if (!merged) continue;
        merged.computeBoundingSphere(); merged.userData.shared = true;
        const mesh = new THREE.Mesh(merged, M[mat]); mesh.castShadow = mat !== 'lens' && mat !== 'bore'; mesh.name = `${group}:${mat}`;
        node.add(mesh);
      }
      if (node !== root) root.add(node);
    }
    return root;
  }
}

// ---------------------------------------------------------------- families
interface PistolOpt { slide: number; front: number; h: number; w: number; grip: number; mat?: Mat; frame?: Mat; comp?: boolean; ext?: number; auto?: boolean }
/** Semi-auto pistol: slide with serrations, frame with dust-cover rail, trigger guard, angled grip, flush magazine. */
function pistol(k: Kit, o: PistolOpt): Built {
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

interface LongOpt {
  recv: [number, number]; recvH: number; w?: number; barrel: number; br?: number; guard?: number; guardR?: number; guardMat?: Mat;
  stock: 'fixed' | 'folded' | 'skeleton' | 'wood' | 'none' | 'tube' | 'thumb'; stockLen?: number; stockMat?: Mat;
  mag: 'curved' | 'straight' | 'pistol' | 'box' | 'drum' | 'none' | 'belt'; magLen?: number; magZ?: number;
  optic?: 'irons' | 'dot' | 'scope' | 'none'; scopeLen?: number; furniture?: Mat; muzzle?: 'brake' | 'flash' | 'can' | 'none'; carry?: boolean; bipod?: boolean;
}
/** Long gun: receiver, pistol grip, handguard, barrel + muzzle device, stock, magazine and optic. */
function longGun(k: Kit, o: LongOpt): Built {
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

interface ModelInfo { group: THREE.Group; muzzle: THREE.Vector3; eject: THREE.Vector3 }
type Built = { muzzle: THREE.Vector3; eject: THREE.Vector3; butt?: THREE.Vector3; support?: THREE.Vector3; grip?: THREE.Vector3 };
const BUILDERS: Partial<Record<WeaponId, (k: Kit) => Built>> = {
  knife: k => {
    k.prof([[0.0, 0.014], [0.105, 0.016], [0.112, 0.01], [0.105, -0.004], [0.04, -0.012], [0.0, -0.01]], 0.017, 'polymer', 0.004);
    k.prof([[0.105, 0.012], [0.235, 0.008], [0.245, 0.0], [0.2, -0.012], [0.105, -0.012]], 0.004, 'chrome', 0.0012);
    k.cylX(0.006, 0.02, 0, 0.0, 0.1, 'steel');
    return { muzzle: new THREE.Vector3(0, 0, 0.24), eject: new THREE.Vector3() };
  },
  bat: k => {
    k.lathe([[0, -0.1], [0.024, -0.1], [0.026, -0.09], [0.015, -0.082], [0.014, 0.1], [0.018, 0.25], [0.028, 0.45], [0.033, 0.62], [0.033, 0.7], [0.028, 0.72], [0, 0.722]], 0, 'wood', 14);
    k.lathe([[0.0155, -0.075], [0.0155, 0.12], [0, 0.12]], 0, 'cloth', 12);
    return { muzzle: new THREE.Vector3(0, 0, 0.7), eject: new THREE.Vector3() };
  },
  compact: k => pistol(k, { slide: 0.15, front: 0, h: 0.028, w: 0.025, grip: 0.085, mat: 'chrome', frame: 'polymer' }),
  pistol: k => pistol(k, { slide: 0.185, front: 0, h: 0.032, w: 0.029, grip: 0.105 }),
  heavyPistol: k => { const r = pistol(k, { slide: 0.215, front: 0, h: 0.036, w: 0.032, grip: 0.115, mat: 'steel', frame: 'tan' }); return r; },
  machinePistol: k => pistol(k, { slide: 0.19, front: 0, h: 0.032, w: 0.029, grip: 0.105, comp: true, auto: true, frame: 'polymer' }),
  revolver: k => {
    const by = 0.072;
    k.prof([[-0.055, 0.03], [0.07, 0.04], [0.07, by + 0.026], [-0.03, by + 0.03], [-0.062, by + 0.012]], 0.028, 'chrome', 0.003);
    k.cyl(0.011, 0.06, 0.24, by, 'chrome', 14).bore(0.0055, 0.24, by);
    k.prof([[0.06, by + 0.008], [0.235, by + 0.008], [0.235, by + 0.025], [0.06, by + 0.025]], 0.018, 'chrome', 0.003); // vent rib / lug
    k.prof([[0.08, by - 0.006], [0.23, by - 0.008], [0.23, by - 0.026], [0.09, by - 0.02]], 0.016, 'chrome', 0.003); // ejector shroud
    k.box(0, by + 0.036, 0.228, 0.006, 0.014, 0.012, 'chrome'); k.box(0, by + 0.034, -0.03, 0.016, 0.01, 0.012, 'steel');
    k.prof([[-0.06, by + 0.012], [-0.08, by + 0.035], [-0.068, by + 0.04], [-0.05, by + 0.02]], 0.008, 'steel', 0.002); // hammer
    k.in('slide', () => { // cylinder (named slide so the reload swings it)
      k.cyl(0.024, -0.005, 0.055, by - 0.006, 'chrome', 6);
      for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2 + Math.PI / 6; k.box(Math.cos(a) * 0.022, by - 0.006 + Math.sin(a) * 0.022, 0.025, 0.004, 0.004, 0.04, 'steel'); }
      k.cyl(0.004, 0.055, 0.075, by - 0.006, 'steel', 8);
    });
    k.prof([[0.0, 0.035], [0.05, 0.033], [0.052, 0.005], [0.04, -0.008], [0.012, -0.008], [0.012, -0.002], [0.04, 0.0], [0.045, 0.026], [0.0, 0.028]], 0.008, 'chrome', 0.0015);
    k.prof([[0.02, 0.03], [0.026, 0.027], [0.024, 0.005], [0.018, 0.004]], 0.005, 'steel', 0.001);
    k.prof([[-0.055, 0.035], [-0.0, 0.03], [-0.03, -0.075], [-0.07, -0.08], [-0.078, -0.05], [-0.062, 0.0]], 0.034, 'wood', 0.008);
    return { muzzle: new THREE.Vector3(0, by, 0.243), eject: new THREE.Vector3(0.02, by, 0.03) };
  },
  compactSmg: k => longGun(k, { recv: [-0.06, 0.12], recvH: 0.06, w: 0.036, barrel: 0.2, guard: 0.05, guardR: 0.02, stock: 'folded', stockLen: 0.2, mag: 'pistol', magLen: 0.14, magZ: -0.002, optic: 'irons', muzzle: 'none' }),
  smg: k => longGun(k, { recv: [-0.08, 0.16], recvH: 0.062, barrel: 0.33, guard: 0.13, guardR: 0.021, stock: 'skeleton', stockLen: 0.22, mag: 'straight', magLen: 0.16, magZ: 0.115, optic: 'dot', muzzle: 'flash' }),
  sawnoff: k => {
    const by = 0.06;
    for (const x of [-0.0125, 0.0125]) { k.cyl(0.0125, 0.04, 0.34, by, 'steel', 14, x).bore(0.009, 0.34, by); }
    k.bore(0.009, 0.34, by); // (both bores drawn above at x = 0 for the central one; the pair reads at range)
    k.prof([[-0.05, 0.014], [0.06, 0.014], [0.06, by + 0.026], [-0.045, by + 0.03], [-0.052, by + 0.02]], 0.05, 'steel', 0.004); // action
    k.prof([[0.08, by - 0.013], [0.25, by - 0.012], [0.25, by - 0.03], [0.09, by - 0.034]], 0.042, 'wood', 0.006); // fore-end
    k.prof([[0.024, 0.012], [0.07, 0.012], [0.07, -0.012], [0.03, -0.016], [0.03, -0.01], [0.064, -0.007], [0.064, 0.006], [0.024, 0.006]], 0.008, 'steel', 0.0015);
    k.prof([[-0.044, by + 0.024], [-0.075, by + 0.008], [-0.062, -0.095], [-0.022, -0.1], [-0.008, -0.03], [0.002, 0.016], [-0.046, 0.018]], 0.04, 'wood', 0.008); // sawed-off pistol-grip stock
    k.prof([[-0.04, by + 0.03], [-0.03, by + 0.04], [-0.012, by + 0.03], [-0.02, by + 0.022]], 0.01, 'steel', 0.002); // hammers
    return { muzzle: new THREE.Vector3(0, by, 0.345), eject: new THREE.Vector3(0.02, by + 0.02, 0.05), support: new THREE.Vector3(0, by - 0.035, 0.17), grip: new THREE.Vector3(0, -0.04, -0.03) };
  },
  shotgun: k => {
    const r = longGun(k, { recv: [-0.08, 0.13], recvH: 0.062, w: 0.036, barrel: 0.66, br: 0.011, stock: 'wood', stockLen: 0.32, stockMat: 'wood', mag: 'none', optic: 'none', muzzle: 'none', furniture: 'polymer' });
    k.cyl(0.0105, 0.13, 0.6, 0.06 - 0.024, 'steel', 12); k.cyl(0.012, 0.59, 0.62, 0.06 - 0.024, 'steel', 12);
    k.box(0, 0.06 + 0.014, 0.645, 0.006, 0.01, 0.006, 'brass');
    k.in('pump', () => { k.prof([[0.22, 0.06 - 0.008], [0.42, 0.06 - 0.008], [0.42, 0.06 - 0.045], [0.22, 0.06 - 0.045]], 0.048, 'wood', 0.008); for (let i = 0; i < 6; i++) k.box(0, 0.06 - 0.046, 0.25 + i * 0.028, 0.044, 0.003, 0.008, 'polymer'); });
    r.support = new THREE.Vector3(0, 0.0, 0.32); // palm round the pump slide
    return r;
  },
  autoShotgun: k => longGun(k, { recv: [-0.09, 0.2], recvH: 0.075, w: 0.04, barrel: 0.55, br: 0.011, guard: 0.18, guardR: 0.026, stock: 'fixed', stockLen: 0.26, mag: 'drum', magZ: 0.12, optic: 'dot', muzzle: 'brake', carry: false }),
  carbine: k => longGun(k, { recv: [-0.08, 0.17], recvH: 0.065, barrel: 0.46, guard: 0.18, stock: 'tube', stockLen: 0.24, mag: 'curved', magLen: 0.17, optic: 'dot', muzzle: 'flash', furniture: 'tan' }),
  rifle: k => longGun(k, { recv: [-0.09, 0.18], recvH: 0.066, barrel: 0.6, guard: 0.26, stock: 'fixed', stockLen: 0.27, mag: 'curved', magLen: 0.19, optic: 'irons', muzzle: 'flash', carry: false }),
  battleRifle: k => longGun(k, { recv: [-0.1, 0.2], recvH: 0.072, w: 0.038, barrel: 0.68, br: 0.01, guard: 0.28, guardR: 0.025, guardMat: 'wood', stock: 'wood', stockLen: 0.3, stockMat: 'wood', mag: 'box', magLen: 0.13, optic: 'irons', muzzle: 'brake', furniture: 'polymer' }),
  marksman: k => longGun(k, { recv: [-0.09, 0.19], recvH: 0.068, barrel: 0.72, guard: 0.3, guardMat: 'tan', stock: 'fixed', stockLen: 0.29, stockMat: 'tan', mag: 'box', magLen: 0.1, optic: 'scope', scopeLen: 0.3, muzzle: 'brake', furniture: 'polymer' }),
  sniper: k => {
    const r = longGun(k, { recv: [-0.1, 0.24], recvH: 0.07, w: 0.036, barrel: 0.95, br: 0.011, guard: 0.32, guardR: 0.026, guardMat: 'olive', stock: 'thumb', stockLen: 0.34, stockMat: 'olive', mag: 'box', magLen: 0.08, magZ: 0.12, optic: 'scope', scopeLen: 0.4, muzzle: 'brake', furniture: 'olive', bipod: true });
    k.in('bolt', () => { k.cylX(0.006, 0.05, 0.035, 0.07, 0.0, 'steel'); const g = new THREE.SphereGeometry(0.011, 10, 8); g.translate(0.062, 0.07, 0.0); k.parts.push({ geo: g, mat: 'steel', group: 'bolt' }); });
    return r;
  },
  lmg: k => longGun(k, { recv: [-0.1, 0.26], recvH: 0.09, w: 0.044, barrel: 0.85, br: 0.012, guard: 0.22, guardR: 0.03, stock: 'fixed', stockLen: 0.28, mag: 'belt', magZ: 0.14, optic: 'dot', muzzle: 'flash', carry: true, bipod: true }),
  grenadeLauncher: k => {
    const by = 0.07;
    k.prof([[-0.06, by - 0.04], [0.12, by - 0.04], [0.12, by + 0.035], [-0.04, by + 0.035], [-0.06, by + 0.02]], 0.044, 'steel', 0.004);
    k.in('slide', () => { k.cyl(0.07, 0.12, 0.32, by - 0.03, 'polymer', 6); for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; k.cyl(0.021, 0.319, 0.322, by - 0.03 + Math.sin(a) * 0.045, 'bore', 10, Math.cos(a) * 0.045); } });
    k.cyl(0.026, 0.3, 0.52, by, 'steel', 14).bore(0.021, 0.52, by);
    k.prof([[0.33, by - 0.03], [0.48, by - 0.03], [0.48, by - 0.065], [0.33, by - 0.065]], 0.04, 'polymer', 0.006);
    k.prof([[0.02, 0.012], [0.03, 0.005], [-0.005, -0.1], [-0.042, -0.098], [-0.03, -0.06], [-0.022, 0.012]], 0.03, 'polymer', 0.005);
    k.cyl(0.015, -0.32, -0.06, by, 'steel', 10); k.box(0, by - 0.02, -0.32, 0.04, 0.11, 0.016, 'polymer');
    k.redDot(0.03, by + 0.036);
    return { muzzle: new THREE.Vector3(0, by, 0.53), eject: new THREE.Vector3(0.03, by, 0.2), butt: new THREE.Vector3(0, by, -0.33), support: new THREE.Vector3(0, by - 0.065, 0.405) };
  },
  rpg: k => {
    const by = 0.1;
    k.lathe([[0.042, -0.45], [0.05, -0.47], [0.052, -0.42], [0.045, -0.35], [0.045, 0.3], [0.05, 0.32], [0.05, 0.36], [0.044, 0.38]], by, 'olive', 16);
    k.lathe([[0.034, -0.46], [0.034, 0.37]], by, 'bore', 12);
    k.in('mag', () => k.lathe([[0.0, 0.38], [0.035, 0.38], [0.05, 0.42], [0.055, 0.5], [0.04, 0.58], [0.012, 0.64], [0.0, 0.645]], by, 'olive', 14)); // rocket warhead (the "magazine")
    k.prof([[0.02, 0.06], [0.03, 0.055], [-0.005, -0.1], [-0.042, -0.098], [-0.03, -0.06], [-0.022, 0.06]], 0.03, 'polymer', 0.005);
    k.prof([[0.2, 0.06], [0.23, 0.06], [0.215, -0.07], [0.185, -0.068]], 0.03, 'polymer', 0.005);
    k.box(-0.055, by + 0.03, 0.05, 0.03, 0.05, 0.1, 'steel'); k.box(-0.055, by + 0.055, 0.0, 0.03, 0.02, 0.025, 'lens');
    k.box(0, by + 0.06, -0.15, 0.03, 0.02, 0.2, 'wood');
    return { muzzle: new THREE.Vector3(0, by, 0.4), eject: new THREE.Vector3(), butt: new THREE.Vector3(0, by, -0.3), support: new THREE.Vector3(0, -0.02, 0.207) };
  },
  grenade: k => {
    k.latheY([[0, -0.045], [0.022, -0.042], [0.031, -0.025], [0.033, 0.0], [0.029, 0.025], [0.016, 0.04], [0.013, 0.05], [0, 0.05]], 'olive', 14, 0, 0.0);
    k.cylY(0.011, 0.02, 0, 0.055, 0, 'steel', 10);
    k.prof([[0.0, 0.065], [0.012, 0.062], [0.03, 0.03], [0.033, -0.02], [0.028, -0.02], [0.026, 0.028], [0.008, 0.055]], 0.012, 'steel', 0.0015);
    const ring = new THREE.TorusGeometry(0.012, 0.0022, 6, 14); ring.translate(-0.022, 0.062, 0); k.parts.push({ geo: ring, mat: 'steel', group: 'body' });
    return { muzzle: new THREE.Vector3(0, 0, 0.04), eject: new THREE.Vector3() };
  },
  molotov: k => {
    k.latheY([[0, -0.08], [0.034, -0.08], [0.037, -0.07], [0.037, 0.03], [0.03, 0.06], [0.013, 0.085], [0.012, 0.12], [0.014, 0.125], [0.0, 0.125]], 'glass', 14);
    k.latheY([[0, -0.07], [0.033, -0.07], [0.033, 0.0], [0, 0.0]], 'tan', 12);
    k.latheY([[0.0, 0.11], [0.015, 0.115], [0.02, 0.14], [0.012, 0.17], [0.006, 0.18], [0, 0.182]], 'cloth', 8);
    return { muzzle: new THREE.Vector3(0, 0.17, 0), eject: new THREE.Vector3() };
  },
};

type Cached = { proto: THREE.Group; muzzle: THREE.Vector3; eject: THREE.Vector3; butt: THREE.Vector3 | null; support: THREE.Vector3 | null; grip: THREE.Vector3 };
const CACHE = new Map<WeaponId, Cached>();
function proto(id: WeaponId) {
  let c = CACHE.get(id);
  if (!c) {
    const b = BUILDERS[id];
    if (!b) { c = { proto: new THREE.Group(), muzzle: new THREE.Vector3(), eject: new THREE.Vector3(), butt: null, support: null, grip: new THREE.Vector3(0, -0.045, 0) }; }
    else { const k = new Kit(); const r = b(k); c = { proto: k.build(id), muzzle: r.muzzle, eject: r.eject, butt: r.butt ?? null, support: r.support ?? null, grip: r.grip ?? new THREE.Vector3(0, -0.045, 0) }; }
    CACHE.set(id, c);
  }
  return c;
}

/** A new instance of the weapon model (shared geometry and materials). Empty group for fists. */
export function weaponMesh(id: WeaponId): THREE.Group {
  const c = proto(id);
  const g = c.proto.clone(true);
  g.userData.muzzle = c.muzzle.clone(); g.userData.eject = c.eject.clone(); g.userData.weapon = id;
  g.userData.anchors = { grip: c.grip.clone(), butt: c.butt?.clone() ?? null, support: c.support?.clone() ?? null } satisfies WeaponAnchors;
  g.traverse(o => { o.userData.rest = o.position.clone(); o.userData.restRot = o.rotation.clone(); });
  return g;
}
/** Muzzle distance along +z (legacy: the muzzle is at (0, 0.07, MUZZLE[id]) roughly; prefer userData.muzzle). */
export const MUZZLE = new Proxy({} as Record<WeaponId, number>, { get: (_t, id: string) => proto(id as WeaponId).muzzle.z });
export interface WeaponParts { mag: THREE.Object3D | null; slide: THREE.Object3D | null; pump: THREE.Object3D | null; bolt: THREE.Object3D | null; muzzle: THREE.Vector3; eject: THREE.Vector3 }
/** Moving parts of a model instance for the firing / reload animations. */
export function weaponParts(g: THREE.Group): WeaponParts {
  const f = (n: string) => g.getObjectByName(n) ?? null;
  return { mag: f('mag'), slide: f('slide'), pump: f('pump'), bolt: f('bolt'), muzzle: g.userData.muzzle ?? new THREE.Vector3(0, 0.06, 0.3), eject: g.userData.eject ?? new THREE.Vector3() };
}
/** Muzzle point of a placed model instance in world space. */
export function muzzleWorld(g: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
  return out.copy((g.userData.muzzle as THREE.Vector3) ?? new THREE.Vector3(0, 0.06, 0.3)).applyMatrix4(g.matrixWorld);
}
/** Where hands and shoulder meet a model (gun space): grip = firing-hand palm centre, butt = stock end, support = fore-hand palm centre. */
export interface WeaponAnchors { grip: THREE.Vector3; butt: THREE.Vector3 | null; support: THREE.Vector3 | null }
export function weaponAnchors(g: THREE.Object3D): WeaponAnchors {
  return (g.userData.anchors as WeaponAnchors | undefined) ?? { grip: new THREE.Vector3(0, -0.045, 0), butt: null, support: null };
}
export type { ModelInfo };
