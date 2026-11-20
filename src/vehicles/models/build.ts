/**
 * Assembles a vehicle model from its shape: panels, greenhouse, doors (own bones), wheels (own bones), lamps,
 * plates, mirrors, interior, accessories, cargo bodies and the tank's tracks/turret. Three LODs share one bone layout.
 * Templates are built lazily on first use and cached per kind.
 */
import * as THREE from 'three';
import { Soup, type Paint } from './soup';
import { K } from './kinds';
import { bodyKit, cutLower, greenhouse, ghGeom, type BodyKit } from './body';
import { wheelSoup, blob, rbox, cyl, tube, plate, decalQuad, interiorSoup, at } from './parts';
import { SHAPES, GROUND, axlesOf, layoutFor, seatsFor, type CarShape, type SeatDef } from '../shapes';
import type { VehicleKind } from '../specs';
import type { VehicleLayout } from '../vehiclePhysics';
import { freeAfterUpload } from '../../world/builders';

export interface BoneDef { parent: number; pos: [number, number, number]; name: string }
export interface DoorDef { side: 'left' | 'right'; row: 0 | 1; bone: number; hinge: THREE.Vector3; z0: number; z1: number; outX: number; beltY: number }
export interface PaneDef { id: number; name: string; bone: number; tris: Float32Array }
export interface CarTemplate {
  kind: VehicleKind; shape: CarShape; layout: VehicleLayout; seats: SeatDef[];
  lods: { body: THREE.BufferGeometry; glass: THREE.BufferGeometry | null }[];
  bones: BoneDef[]; wheelBones: number[]; doorBones: number[]; turretBone: number; gunBone: number;
  doors: DoorDef[]; panes: PaneDef[];
  bbox: THREE.Box3; sphere: THREE.Sphere; front: number; rear: number; hood: THREE.Vector3; roofY: number;
  /** track loop length (tank tread scroll) */ trackLen: number;
  /** Rigid far model for instanced crowds: the lod-2 body with its glass merged in as aKind FAR_GLASS (no skinning, rest pose). */
  far: THREE.BufferGeometry;
}
/** aKind of the far model's (opaque, reflective) glass. */
export const FAR_GLASS = 60;
/** Merges a body and its glass into one plain geometry (position, normal, uv, color, aKind) for instancing. */
function farGeometry(body: THREE.BufferGeometry, glass: THREE.BufferGeometry | null): THREE.BufferGeometry {
  const parts = glass ? [body, glass] : [body], n = parts.reduce((a, g) => a + g.attributes.position.count, 0);
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2), C = new Float32Array(n * 4), Kd = new Float32Array(n);
  let o = 0;
  for (const g of parts) {
    const c = g.attributes.position.count, isGlass = g === glass;
    P.set(g.attributes.position.array as Float32Array, o * 3); N.set(g.attributes.normal.array as Float32Array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array as Float32Array, o * 2);
    if (g.attributes.color) { const ca = g.attributes.color, sz = ca.itemSize; for (let i = 0; i < c; i++) for (let k = 0; k < 4; k++) C[(o + i) * 4 + k] = k < sz ? (ca.array as Float32Array)[i * sz + k] : 1; }
    if (isGlass) Kd.fill(FAR_GLASS, o, o + c); else Kd.set(g.attributes.aKind.array as Float32Array, o);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3)); out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2)); out.setAttribute('color', new THREE.BufferAttribute(C, 4)); out.setAttribute('aKind', new THREE.BufferAttribute(Kd, 1));
  out.computeBoundingSphere();
  return out;
}

const cache = new Map<VehicleKind, CarTemplate>();
/** Triangle budget of the far model (lod 2, also the far-crowd impostor). */
export const FAR_TRIS = 1300;
/** True once the kind's template is built (far crowds only use kinds that are ready, so they never cause a build hitch). */
export function hasTemplate(kind: VehicleKind): boolean { return cache.has(kind); }
export function getTemplate(kind: VehicleKind): CarTemplate {
  let t = cache.get(kind);
  if (!t) { t = buildTemplate(kind); cache.set(kind, t); }
  return t;
}

function boneLayout(s: CarShape) {
  const axles = axlesOf(s);
  const bones: BoneDef[] = [{ parent: -1, pos: [0, 0, 0], name: 'body' }];
  const wheelBones: number[] = [];
  const layoutWheels: [number, number][] = [];
  axles.forEach(z => { for (const left of [true, false]) layoutWheels.push([left ? 1 : -1, z]); });
  for (const [sg, z] of layoutWheels) { wheelBones.push(bones.length); bones.push({ parent: -2, pos: [sg * (s.W / 2 - s.tw / 2 - 0.035), GROUND + s.R, z], name: 'wheel' }); }
  const doorBones: number[] = [];
  s.doors.forEach(() => { for (let k = 0; k < 2; k++) { doorBones.push(bones.length); bones.push({ parent: 0, pos: [0, 0, 0], name: 'door' }); } });
  let turretBone = -1, gunBone = -1;
  if (s.type === 'tank') { turretBone = bones.length; bones.push({ parent: 0, pos: [0, GROUND + 1.72, 0.1], name: 'turret' }); gunBone = bones.length; bones.push({ parent: turretBone, pos: [0, GROUND + 2.12, 1.75], name: 'gun' }); }
  return { bones, wheelBones, doorBones, turretBone, gunBone };
}

function buildTemplate(kind: VehicleKind): CarTemplate {
  const s = SHAPES[kind];
  const bl = boneLayout(s);
  const seats = seatsFor(kind);
  const doorBone = (row: number, side: 1 | -1) => bl.doorBones[row * 2 + (side === 1 ? 0 : 1)];
  const lods: CarTemplate['lods'] = [];
  let doors: DoorDef[] = [], panes: PaneDef[] = [], bbox = new THREE.Box3(), trackLen = 1;
  let far = new THREE.BufferGeometry();
  const hood = new THREE.Vector3();
  for (const lod of [0, 1, 2]) {
    const kit = bodyKit(s, lod);
    const lower = cutLower(kit, lod, doorBone);
    const body = new Soup().append(lower.body);
    let glass: Soup | null = null;
    const gh = s.gh ? greenhouse(kit, lod, doorBone) : null;
    if (gh) { body.append(gh.body); glass = gh.glass; }
    for (const d of lower.doors) { body.append(d.soup).append(d.inner); const extra = gh?.doorParts.get(d.bone); if (extra) body.append(extra); }
    body.append(details(kit, lod, seats, doorBone));
    const w = wheelSoup(s, lod);
    if (s.type !== 'tank') bl.wheelBones.forEach(b => {
      const p = bl.bones[b].pos, left = p[0] > 0;
      const ws = (left ? w.clone() : w.mirrorX()).translate(p[0], s.R, p[2]).paint({ bone: b });
      body.append(ws);
    });
    if (s.type === 'tank') trackLen = tankParts(kit, body, lod, bl);
    body.translate(0, GROUND, 0); glass?.translate(0, GROUND, 0);
    // lod 0 = full model (~35k tris); lod 1 (~3k) is clustered down from the simple model; lod 2 (~1.2k) is built natively coarse
    // (clustering a body down to a few hundred triangles tears it into spiky blobs) and only lightly clustered.
    const bake = (b: Soup, g: Soup | null) => ({ body: b.toGeometry(), glass: g && g.tris ? g.toGeometry() : null });
    const entries = lod === 0 ? [bake(body, glass)] : lod === 1 ? [bake(body.decimateTo(s.type === 'tank' ? 2200 : 3000), glass?.decimateTo(220) ?? null)]
      : [bake(body.decimateTo(s.type === 'tank' ? 1100 : FAR_TRIS), glass?.decimateTo(90) ?? null)];
    for (const e of entries) {
      lods.push(e);
      if (lods.length === 3) far = farGeometry(e.body, e.glass);
      // CPU copies are dead weight once uploaded (~7 MB per kind); only the lod-0 body keeps what dent deformation reads.
      freeAfterUpload(e.body, lods.length === 1 ? ['position', 'normal', 'skinIndex'] : []); if (e.glass) freeAfterUpload(e.glass);
    }
    if (lod === 0) {
      lods[0].body.computeBoundingBox(); bbox = lods[0].body.boundingBox!.clone();
      // door hinges at the front edge of each door, on the outer skin
      doors = [];
      s.doors.forEach(([z0, z1], row) => {
        for (const side of [1, -1] as const) {
          const beltY = kit.yT(z1);
          const outX = kit.sideX(z1 - 0.05, beltY - 0.25);
          const bone = doorBone(row, side);
          bl.bones[bone].pos = [side * (outX - 0.03), GROUND + beltY - 0.3, z1 - 0.02];
          doors.push({ side: side === 1 ? 'left' : 'right', row: row as 0 | 1, bone, hinge: new THREE.Vector3(side * (outX - 0.03), GROUND + beltY - 0.3, z1 - 0.02), z0, z1, outX, beltY: GROUND + beltY });
        }
      });
      const hz = s.type === 'car' && kind === 'super' ? kit.zr + 0.9 : kit.zf - 0.9;
      hood.set(0, GROUND + kit.yT(hz) - 0.05, hz);
    } else if (gh && lod === 1) {
      panes = gh.panes.map(p => { const sp = p.soup.clone().translate(0, GROUND, 0); const tris = new Float32Array(sp.verts * 3); for (let i = 0; i < sp.verts; i++) { tris[i * 3] = sp.d[i * 14]; tris[i * 3 + 1] = sp.d[i * 14 + 1]; tris[i * 3 + 2] = sp.d[i * 14 + 2]; } return { id: p.id, name: p.name, bone: p.bone, tris }; });
    }
  }
  const sphere = new THREE.Sphere(); bbox.getBoundingSphere(sphere); sphere.radius += 1.2;
  return { kind, shape: s, layout: layoutFor(kind), seats, lods, ...bl, doors, panes, bbox, sphere, front: bbox.max.z, rear: bbox.min.z, hood, roofY: bbox.max.y, trackLen, far };
}

/** Bones are rest-posed at the origin while building; skinning needs every vertex relative to its bone at rest, which is the identity here. */
function details(kit: BodyKit, lod: number, seats: SeatDef[], doorBone: (row: number, side: 1 | -1) => number): Soup {
  const { s, yT } = kit;
  const out = new Soup();
  const W2 = s.W / 2, gh = s.gh;
  const ex = (n: string) => s.extras.includes(n);
  const trim: Paint = { kind: K.TRIM, color: '#141416' };
  const plastic: Paint = { kind: K.PLASTIC, color: '#1f2022' };
  const chrome: Paint = { kind: K.CHROME };
  const paint: Paint = { kind: K.PAINT };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const axles = axlesOf(s);
  const Ra = s.R + s.arch;
  // wheel wells: liner + inner wall, and a rolled lip (or a flare)
  if (s.type !== 'tank') for (const za of axles) for (const sg of [1, -1]) {
    const cy = s.R + 0.03;
    const x0 = W2 - 0.5, x1 = W2 - 0.03;
    const liner = new THREE.CylinderGeometry(Ra - 0.01, Ra - 0.01, x1 - x0, lod ? 10 : 22, 1, true, -0.45, Math.PI + 0.9).rotateZ(Math.PI / 2).translate(sg * (x0 + x1) / 2, cy, za);
    out.addGeometry(liner, { kind: K.UNDER, color: '#111112' }); liner.dispose();
    const wall = new THREE.CircleGeometry(Ra, lod ? 8 : 16, -0.45, Math.PI + 0.9).rotateZ(Math.PI / 2).rotateY(sg > 0 ? -Math.PI / 2 : Math.PI / 2).translate(sg * x0, cy, za);
    // CircleGeometry lies in xy; after the rotations it stands in the yz plane
    out.addGeometry(wall, { kind: K.UNDER, color: '#0d0d0e' }); wall.dispose();
    if (!lod) {
      const flare = ex('flares');
      const pts: THREE.Vector3[] = [];
      for (let i = 0; i <= 18; i++) {
        const th = -0.22 + (Math.PI + 0.44) * i / 18, z = za + Math.cos(th) * (Ra + 0.005), y = cy + Math.sin(th) * (Ra + 0.005);
        if (y < s.clear + 0.03) continue;
        pts.push(V(sg * (kit.sideX(z, Math.max(y, s.clear + 0.1)) - (flare ? -0.012 : 0.012)), y, z));
      }
      if (pts.length > 1) out.append(tube(pts, flare ? 0.04 : 0.016, flare && kind(s) !== 'race' ? plastic : paint, 6));
    }
  }
  // number plates
  if (s.type !== 'tank' && kind(s) !== 'race') {
    const variant = Math.floor(Math.abs(Math.sin(s.L * 977 + s.W * 131)) * 8) % 8;
    const fy = s.bumperF[0] + 0.1, ry = s.type === 'car' ? Math.min(s.tail[0].y - 0.05, s.bumperR[1] + 0.13) : s.bumperR[0] + 0.12;
    out.append(plate(0, fy, kit.frontZ(0, fy) + 0.012, true, variant));
    out.append(plate(0, ry, kit.rearZ(0, ry) - 0.012, false, (variant + 3) % 8));
  }
  // mirrors and handles ride on the doors
  s.doors.forEach(([z0, z1], row) => {
    for (const sg of [1, -1] as const) {
      const bone = doorBone(row, sg);
      if (row === 0) {
        const mz = z1 - 0.13, my = yT(mz) + 0.1, mx = kit.sideX(mz, yT(mz) - 0.06);
        const housing = blob(0.1, 0.065, 0.055, 2.6, s.type === 'car' && kind(s) !== 'fbi' ? paint : trim, at(sg * (mx + 0.11), my, mz), 12, 8);
        const arm = rbox(0.12, 0.035, 0.05, 0.012, trim, at(sg * (mx + 0.03), my - 0.03, mz + 0.01));
        const glassM = blob(0.085, 0.052, 0.01, 3, { kind: K.MIRROR, color: '#ffffff' }, at(sg * (mx + 0.11), my, mz - 0.048), 10, 6);
        out.append(housing.paint({ bone })).append(arm.paint({ bone })).append(glassM.paint({ bone }));
      }
      if (ex('handles')) {
        const hz = z0 + 0.2, hy = yT(hz) - 0.12, hx = kit.sideX(hz, hy);
        out.append(rbox(0.035, 0.032, 0.17, 0.012, s.bumper === 'chrome' || ex('chromebelt') ? chrome : s.type === 'car' ? paint : trim, at(sg * (hx + 0.005), hy, hz)).paint({ bone }));
      }
    }
  });
  // interior
  if (gh) {
    const G = ghGeom(kit);
    const sg = seats.map(st => ({ x: st.x, y: st.y - GROUND, z: st.z }));
    out.append(interiorSoup(s, sg, { zA: gh.zA, zC: Math.max(gh.zC, sg[sg.length - 1].z - 0.6), hw: G.hwB, floor: s.clear + 0.12, dashY: yT(gh.zA) + 0.02 }, lod));
    if (!lod && ex('wipers')) for (const x of [0.32, -0.18]) out.append(rbox(0.5, 0.012, 0.02, 0.005, trim, at(x, yT(gh.zA) + 0.025, gh.zA + 0.04, 0, 0.12, 0.05)));
  }
  return out.append(extras(kit, seats, lod));
}
const kind = (s: CarShape): VehicleKind => (Object.keys(SHAPES) as VehicleKind[]).find(k => SHAPES[k] === s) ?? 'sedan';


function extras(kit: BodyKit, seats: SeatDef[], lod: number): Soup {
  const { s, zf, zr, yT } = kit;
  const out = new Soup();
  const ex = (n: string) => s.extras.includes(n);
  const W2 = s.W / 2, gh = s.gh;
  const trim: Paint = { kind: K.TRIM, color: '#141416' };
  const plastic: Paint = { kind: K.PLASTIC, color: '#1d1e20' };
  const metal: Paint = { kind: K.METAL, color: '#202124' };
  const chrome: Paint = { kind: K.CHROME };
  const paint: Paint = { kind: K.PAINT };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const roofY = gh ? gh.roof : 1.4, roofZ = gh ? (gh.zR1 + gh.zR2) / 2 : 0;
  if (ex('lightbar')) {
    const y = (s.cargo && s.type === 'boxvan' ? Math.max(roofY, 0) : roofY) + 0.035, z = s.type === 'boxvan' ? (gh!.zR1 + gh!.zR2) / 2 : roofZ + 0.1;
    out.append(rbox(1.3, 0.05, 0.3, 0.02, trim, at(0, y, z)));
    out.append(rbox(0.6, 0.1, 0.26, 0.04, { kind: K.BAR_RED, color: '#ffffff' }, at(0.32, y + 0.07, z)));
    out.append(rbox(0.6, 0.1, 0.26, 0.04, { kind: K.BAR_BLUE, color: '#ffffff' }, at(-0.32, y + 0.07, z)));
    for (const x of [0.62, -0.62]) out.append(rbox(0.06, 0.06, 0.06, 0.01, trim, at(x * 0.9, y - 0.02, z)));
  }
  if (ex('taxisign')) {
    const y = roofY + 0.1, z = roofZ;
    out.append(rbox(0.7, 0.18, 0.22, 0.05, { kind: K.LIGHT, color: '#ffd84a' }, at(0, y, z)));
    out.append(decalQuad(0.52, 0.12, [0, 0.625, 0.25, 0.75], K.DECAL, at(0, y, z + 0.112)));
    out.append(decalQuad(0.52, 0.12, [0, 0.625, 0.25, 0.75], K.DECAL, at(0, y, z - 0.112, 0, Math.PI, 0)));
  }
  if (ex('grillelights')) for (const [x, k] of [[0.16, K.BAR_RED], [-0.16, K.BAR_BLUE]] as const) out.append(blob(0.06, 0.03, 0.02, 3, { kind: k, color: '#ffffff' }, at(x, s.grille.y, kit.frontZ(x, s.grille.y) + 0.0)));
  if (ex('pushbar')) {
    const z = zf + 0.12, y0 = s.bumperF[0] + 0.05, y1 = Math.min(yT(zf) + 0.05, s.bumperF[1] + 0.4);
    for (const x of [0.38, -0.38]) out.append(tube([V(x, y0, z - 0.15), V(x, y0 + 0.02, z), V(x, y1, z), V(x, y1 - 0.02, z - 0.15)], 0.03, metal));
    out.append(tube([V(0.42, y0 + 0.2, z + 0.01), V(-0.42, y0 + 0.2, z + 0.01)], 0.026, metal));
    out.append(tube([V(0.42, y1 - 0.03, z + 0.01), V(-0.42, y1 - 0.03, z + 0.01)], 0.026, metal));
  }
  if (ex('antenna')) { const z = zr + 0.45, y = kit.topY(-0.45, z); out.append(cyl(0.004, 0.006, 0.7, trim, at(-0.45, y + 0.35, z), 5)); }
  if (ex('spot') && gh) out.append(blob(0.06, 0.06, 0.08, 2, chrome, at(kitHW(kit) + 0.06, yT(gh.zA) + 0.18, gh.zA - 0.15), 10, 6));
  if (ex('rails') && gh) for (const x of [gh.roofW - 0.16, -(gh.roofW - 0.16)]) out.append(tube([V(x, roofY - 0.04, gh.zR1 - 0.12), V(x, roofY + 0.015, gh.zR1 - 0.25), V(x, roofY + 0.015, gh.zR2 + 0.25), V(x, roofY - 0.04, gh.zR2 + 0.12)], 0.018, plastic, 6));
  if (ex('steps')) {
    const a = axlesOf(s), z0 = a[a.length - 1] + s.R + 0.15, z1 = a[0] - s.R - 0.15;
    for (const sg of [1, -1]) out.append(rbox(0.16, 0.05, z1 - z0, 0.02, plastic, at(sg * (W2 - 0.02), s.clear + 0.02, (z0 + z1) / 2)));
  }
  if (ex('exhaust2')) for (const x of [0.42, 0.28]) out.append(cyl(0.035, 0.035, 0.18, chrome, at(-x, s.bumperR[0] + 0.02, zr + 0.06, Math.PI / 2), 12, true));
  if (ex('diffuser')) out.append(rbox(s.W * 0.7, 0.06, 0.45, 0.02, plastic, at(0, s.clear + 0.03, zr + 0.25)));
  if (ex('splitter')) out.append(rbox(s.W * 0.8, 0.02, 0.16, 0.01, plastic, at(0, s.clear - 0.01, zf - 0.12)));
  if (ex('lip') && gh) { const z = zr + 0.22, y = kit.topY(0, z); out.append(rbox(s.W * 0.66, 0.03, 0.14, 0.012, paint, at(0, y + 0.02, z, -0.25))); }
  if (ex('ducktail')) { const z = zr + 0.2, y = kit.topY(0, z); out.append(rbox(s.W * 0.78, 0.05, 0.16, 0.02, paint, at(0, y + 0.025, z, -0.3))); }
  if (ex('wing') || ex('bigwing')) {
    const big = ex('bigwing'), z = zr + (big ? 0.28 : 0.32), yb = kit.topY(0.5, z), y = yb + (big ? 0.42 : 0.2), w = s.W * (big ? 0.95 : 0.8);
    out.append(rbox(w, 0.035, big ? 0.32 : 0.24, 0.015, big ? { kind: K.PAINT2 } : paint, at(0, y, z, 0.12)));
    for (const x of [0.45, -0.45]) out.append(rbox(0.03, y - yb + 0.02, 0.12, 0.01, trim, at(x * s.W / 1.8, (y + yb) / 2, z + 0.02)));
    if (big) for (const x of [w / 2, -w / 2]) out.append(rbox(0.012, 0.18, 0.4, 0.01, trim, at(x, y + 0.02, z)));
  }
  if (ex('scoop') && gh) { const z = (gh.zA + zf) / 2 + 0.05, y = yT(z); out.append(blob(0.28, 0.07, 0.42, 3, paint, at(0, y + 0.015, z), 14, 8)); out.append(rbox(0.36, 0.05, 0.02, 0.01, { kind: K.GRILLE, color: '#0b0b0b' }, at(0, y + 0.04, z + 0.38))); }
  if (ex('pins')) for (const x of [0.5, -0.5]) out.append(cyl(0.015, 0.015, 0.012, chrome, at(x, yT(zf - 0.25) + 0.005, zf - 0.25), 8));
  if (ex('ornament')) out.append(blob(0.02, 0.05, 0.04, 2.5, chrome, at(0, yT(zf - 0.12) + 0.04, zf - 0.12), 8, 6));
  if (ex('boot') && gh) { const r = seats[seats.length - 1], z0 = r.z - 0.35, z1 = gh.zC + 0.05; out.append(blob(ghGeom(kit).hwB - 0.02, 0.08, Math.max(0.12, (z0 - z1) / 2), 3, { kind: K.PLASTIC, color: '#18181a' }, at(0, yT((z0 + z1) / 2) + 0.01, (z0 + z1) / 2), 14, 6)); }
  if (ex('mudflaps')) { const a = axlesOf(s); for (const sg of [1, -1]) out.append(rbox(s.tw + 0.06, 0.32, 0.015, 0.005, plastic, at(sg * (W2 - s.tw / 2 - 0.04), s.clear + 0.05, a[a.length - 1] - s.R - 0.15))); }
  if (s.cargo && s.type === 'pickup') {
    const c = s.cargo, len = c.z1 - c.z0, zc = (c.z0 + c.z1) / 2;
    out.append(rbox(c.hw * 2, 0.03, len, 0.01, { kind: K.PLASTIC, color: '#202022' }, at(0, c.y0 + 0.06, zc)));
    for (const sg of [1, -1]) {
      out.append(rbox(0.03, c.y1 - c.y0 - 0.02, len, 0.01, paint, at(sg * (c.hw - 0.015), (c.y0 + c.y1) / 2, zc)));
      out.append(rbox(W2 - c.hw + 0.02, 0.025, len + 0.02, 0.01, plastic, at(sg * (c.hw + W2) / 2, c.y1 - 0.005, zc)));
    }
    out.append(rbox(c.hw * 2, c.y1 - c.y0, 0.03, 0.01, paint, at(0, (c.y0 + c.y1) / 2, c.z1 - 0.015)));
    out.append(rbox(c.hw * 2, c.y1 - c.y0, 0.03, 0.01, paint, at(0, (c.y0 + c.y1) / 2, c.z0 + 0.015)));
  }
  if (s.cargo && s.type === 'boxvan') {
    const c = s.cargo, h = c.y1 - c.y0, len = c.z1 - c.z0, zc = (c.z0 + c.z1) / 2, yc = (c.y0 + c.y1) / 2;
    out.append(rbox(c.hw * 2, h, len, ex('slits') ? 0.12 : 0.05, kind(s) === 'van' ? { kind: K.PAINT2 } : paint, at(0, yc, zc), lod ? 1 : 3));
    out.append(rbox(0.012, h - 0.12, 0.006, 0.002, { kind: K.SEAM }, at(0, yc, c.z0 - 0.001)));
    out.append(rbox(c.hw * 2 - 0.1, 0.03, 0.02, 0.01, chrome, at(0, c.y0 + 0.12, c.z0 - 0.01)));
    for (const sg of [1, -1]) for (const t of [0.25, 0.5, 0.75]) out.append(rbox(0.012, h - 0.1, 0.03, 0.005, kind(s) === 'van' ? { kind: K.PAINT2 } : paint, at(sg * (c.hw + 0.004), yc, c.z0 + len * t)));
    if (ex('busglass')) { // city bus: tinted window band down both sides, rear window, white roof cap and a destination sign
      const win: Paint = { kind: K.MIRROR, color: '#10161c' }, band = (c.y0 + 1.45 + c.y1 - 0.5) / 2;
      for (const sg of [1, -1]) for (let z = c.z0 + 1.0; z < c.z1 - 0.7; z += 1.5) out.append(rbox(0.01, 1.0, 1.2, 0.04, win, at(sg * (c.hw + 0.004), band, z)));
      out.append(rbox(c.hw * 2 - 0.5, 0.9, 0.01, 0.04, win, at(0, band, c.z0 - 0.003)));
      out.append(rbox(c.hw * 2 - 0.2, 0.06, len, 0.02, { kind: K.PAINT2 }, at(0, c.y1 + 0.01, zc)));
      for (const sg of [1, -1]) out.append(rbox(0.012, 0.22, len - 0.4, 0.01, { kind: K.PAINT2 }, at(sg * (c.hw + 0.005), c.y0 + 0.9, zc)));
    }
    if (ex('slits')) for (const sg of [1, -1]) for (const t of [0.3, 0.65]) out.append(rbox(0.01, 0.1, 0.5, 0.02, { kind: K.MIRROR, color: '#0a0b0c' }, at(sg * (c.hw + 0.003), c.y1 - 0.55, c.z0 + len * t)));
    if (ex('slits')) for (const x of [0.4, -0.4]) out.append(rbox(0.36, 0.1, 0.01, 0.02, { kind: K.MIRROR, color: '#0a0b0c' }, at(x, c.y1 - 0.6, c.z0 - 0.003)));
  }
  if (s.cargo && s.type === 'truck') {
    const c = s.cargo, len = c.z1 - c.z0, zc = (c.z0 + c.z1) / 2;
    out.append(rbox(c.hw * 2 + 0.06, 0.08, len, 0.01, metal, at(0, c.y0 + 0.02, zc)));
    for (const sg of [1, -1]) out.append(rbox(0.05, 0.5, len, 0.01, paint, at(sg * (c.hw + 0.02), c.y0 + 0.28, zc)));
    out.append(rbox(c.hw * 2 + 0.1, 0.5, 0.05, 0.01, paint, at(0, c.y0 + 0.28, c.z0 + 0.02)));
    out.append(rbox(c.hw * 2 + 0.12, c.y1 - c.y0 - 0.4, len - 0.04, 0.22, { kind: K.CANVAS, color: '#8a8660' }, at(0, (c.y0 + 0.4 + c.y1) / 2, zc), lod ? 2 : 4));
  }
  void seats; void lod;
  return out;
}
function kitHW(kit: BodyKit) { return ghGeom(kit).hwB; }

/** Tank: tracks (scrolling tread via uv.x), road wheels, skirts, turret + gun on their bones. Returns the track loop length. */
function tankParts(kit: BodyKit, out: Soup, lod: number, bl: ReturnType<typeof boneLayout>): number {
  const { s, zf, zr } = kit;
  const W2 = s.W / 2, tw = s.tw;
  const paint: Paint = { kind: K.PAINT };
  const dark: Paint = { kind: K.METAL, color: '#2b2c26' };
  const r = 0.46, zF = zf - 0.55, zR = zr + 0.5, yc = 0.5;
  // stadium loop in (z, y)
  const pts: [number, number][] = [];
  const n = lod ? 40 : 96;
  const straight = zF - zR, total = 2 * straight + 2 * Math.PI * r;
  for (let i = 0; i < n; i++) {
    let d = (i / n) * total;
    if (d < straight) { pts.push([zR + d, yc - r]); continue; } d -= straight;
    if (d < Math.PI * r) { const a = -Math.PI / 2 + d / r; pts.push([zF + Math.cos(a) * r, yc + Math.sin(a) * r]); continue; } d -= Math.PI * r;
    if (d < straight) { pts.push([zF - d, yc + r]); continue; } d -= straight;
    const a = Math.PI / 2 + d / r; pts.push([zR + Math.cos(a) * r, yc + Math.sin(a) * r]);
  }
  for (const sg of [1, -1]) {
    const xc = sg * (W2 + tw / 2 - 0.02), x0 = xc - tw / 2, x1 = xc + tw / 2;
    const band = new Soup();
    let acc = 0;
    for (let i = 0; i < n; i++) {
      const p = pts[i], q = pts[(i + 1) % n], len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const nz = (q[1] - p[1]) / len, ny = -(q[0] - p[0]) / len; // outward for a counter-clockwise loop
      const u0 = acc / total * 40, u1 = (acc + len) / total * 40; acc += len;
      const v = (x: number, z: number, y: number, u: number, w: number, sx = 0, sy = ny, sz = nz) => band.vert(x, y, z, sx, sy, sz, u, w, 0.14, 0.14, 0.13, 0, K.TRACK, 0);
      // outer face
      v(x0, p[0], p[1], u0, 0); v(x1, q[0], q[1], u1, 1); v(x1, p[0], p[1], u0, 1);
      v(x0, p[0], p[1], u0, 0); v(x0, q[0], q[1], u1, 0); v(x1, q[0], q[1], u1, 1);
      // side faces
      for (const [x, nx] of [[x0, -1], [x1, 1]] as const) {
        const ip = [p[0] - nz * 0.09, p[1] - ny * 0.09], iq = [q[0] - nz * 0.09, q[1] - ny * 0.09];
        if (nx > 0) { v(x, p[0], p[1], u0, 2, 1, 0, 0); v(x, iq[0], iq[1], u1, 2, 1, 0, 0); v(x, q[0], q[1], u1, 2, 1, 0, 0); v(x, p[0], p[1], u0, 2, 1, 0, 0); v(x, ip[0], ip[1], u0, 2, 1, 0, 0); v(x, iq[0], iq[1], u1, 2, 1, 0, 0); }
        else { v(x, p[0], p[1], u0, 2, -1, 0, 0); v(x, q[0], q[1], u1, 2, -1, 0, 0); v(x, iq[0], iq[1], u1, 2, -1, 0, 0); v(x, p[0], p[1], u0, 2, -1, 0, 0); v(x, iq[0], iq[1], u1, 2, -1, 0, 0); v(x, ip[0], ip[1], u0, 2, -1, 0, 0); }
      }
    }
    // the winding above assumes y-up loops; make sure faces point outward
    const fixed = band.partition((_x, y, z, _nx, ny, nz) => (y - yc) * ny + (z - (zF + zR) / 2) * nz * 0.2 >= -0.01 || Math.abs(_nx) > 0.5);
    out.append(fixed[0]).append(fixed[1].flipped());
    const nw = 6;
    for (let i = 0; i < nw; i++) {
      const z = zR + 0.15 + (straight - 0.3) * i / (nw - 1);
      out.append(cyl(0.34, 0.34, tw * 0.75, { kind: K.METAL, color: '#3f4433' }, at(xc, yc - r + 0.36, z, 0, 0, Math.PI / 2), lod ? 10 : 20));
      if (!lod) out.append(cyl(0.12, 0.12, tw * 0.8, dark, at(xc, yc - r + 0.36, z, 0, 0, Math.PI / 2), 10));
    }
    for (const z of [zF, zR]) out.append(cyl(r - 0.06, r - 0.06, tw * 0.7, dark, at(xc, yc, z, 0, 0, Math.PI / 2), lod ? 12 : 24));
    // fender and skirt
    out.append(rbox(tw + 0.12, 0.05, zf - zr - 0.1, 0.02, paint, at(xc, yc + r + 0.1, (zf + zr) / 2)));
    out.append(rbox(0.04, 0.42, straight + 0.4, 0.015, paint, at(xc + sg * (tw / 2 + 0.04), yc + r - 0.12, (zF + zR) / 2)));
  }
  // engine deck grilles and lamps
  out.append(rbox(1.6, 0.03, 1.2, 0.01, { kind: K.GRILLE, color: '#111' }, at(0, 1.73, zr + 1.0)));
  // turret, mantlet, gun
  const tb = bl.turretBone, gb = bl.gunBone;
  const tp = bl.bones[tb].pos, gp = bl.bones[gb].pos;
  const tY = tp[1] - GROUND, gY = gp[1] - GROUND;
  const turret = blob(1.42, 0.46, 1.9, 2.7, paint, at(0, tY + 0.4, tp[2]), lod ? 16 : 32, lod ? 8 : 14);
  turret.append(cyl(0.34, 0.34, 0.1, paint, at(0.45, tY + 0.72, tp[2] - 0.5), 16));
  turret.append(cyl(0.3, 0.3, 0.08, paint, at(-0.5, tY + 0.7, tp[2] - 0.3), 16));
  turret.append(cyl(0.02, 0.02, 0.9, dark, at(0.45, tY + 0.95, tp[2] - 0.2, Math.PI / 2 - 0.1), 6));
  for (const sg of [1, -1]) for (let i = 0; i < 3; i++) turret.append(cyl(0.05, 0.05, 0.22, dark, at(sg * 1.05, tY + 0.48 + i * 0.07, tp[2] + 1.05, Math.PI / 2 - 0.4, 0, -sg * 0.3), 8));
  turret.append(rbox(0.9, 0.25, 0.8, 0.06, paint, at(0, tY + 0.38, tp[2] - 1.85)));
  out.append(turret.paint({ bone: tb }));
  const gun = rbox(0.62, 0.42, 0.36, 0.08, paint, at(0, gY, gp[2]));
  gun.append(cyl(0.085, 0.1, 4.4, paint, at(0, gY, gp[2] + 2.3, Math.PI / 2), lod ? 10 : 18));
  gun.append(cyl(0.12, 0.12, 0.4, dark, at(0, gY, gp[2] + 4.3, Math.PI / 2), lod ? 10 : 18));
  gun.append(cyl(0.14, 0.14, 0.9, paint, at(0, gY, gp[2] + 1.8, Math.PI / 2), lod ? 10 : 18));
  out.append(gun.paint({ bone: gb }));
  return total;
}
