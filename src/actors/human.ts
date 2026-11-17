/**
 * Stylised people built on the CC0 Quaternius Universal Animation Library rig.
 * Outfits are painted per body region (derived from skin weights), accessories are skinned to the head,
 * and animation runs in two layers (lower/upper body) with phase-synced locomotion so feet never slide.
 */
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { Rng } from '../core/rng';

export const R_SKIN = 0, R_TORSO = 1, R_ARM = 2, R_LEG = 3, R_HAIR = 4, R_EYES = 9, R_HAT = 10, R_DETAIL = 11;
/** Colour slots */
const C_SKIN = 0, C_TOP = 1, C_BOTTOM = 2, C_SHOES = 3, C_HAIR = 4, C_BELT = 5, C_EYES = 9, C_HAT = 10, C_DETAIL = 11;
const SLOTS = 12;

export type HairStyle = 'short' | 'buzz' | 'long' | 'bun' | 'ponytail' | 'bald' | 'curly';
export type HatStyle = 'none' | 'cap' | 'beanie' | 'police';
export interface Look {
  skin: string; top: string; bottom: string; shoes: string; hair: string; hat: string; detail: string;
  sleeves: 'short' | 'long' | 'tank'; legs: 'pants' | 'shorts'; hairStyle: HairStyle; hatStyle: HatStyle; height: number; build: number;
}
const SKINS = ['#f1c9a5', '#e0ac85', '#c68c63', '#a8714c', '#8a5a3b', '#6b4430', '#f5d6bd', '#d29b74'];
const HAIRS = ['#1f1a17', '#3b2a20', '#5a3d28', '#7a5230', '#a8774a', '#d9b77a', '#8f8a84', '#2a2a2e'];
const TOPS = ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f', '#f4f1de', '#2a9d8f', '#e76f51', '#264653', '#b56576', '#6d597a', '#ffb4a2', '#90be6d', '#577590', '#d8d0c0', '#1d3557'];
const BOTTOMS = ['#2b2d42', '#3d5a80', '#5c4d3c', '#8d99ae', '#283618', '#463f3a', '#bcb8b1', '#1b263b', '#6b705c'];
const SHOES = ['#f8f9fa', '#212529', '#6c584c', '#e63946', '#343a40', '#ced4da'];

export function randomLook(seed: number): Look {
  const r = new Rng(Math.imul(seed + 1, 2654435761) ^ 0x5bd1e995);
  const fem = r.chance(0.5);
  return {
    skin: r.pick(SKINS), top: r.pick(TOPS), bottom: r.pick(BOTTOMS), shoes: r.pick(SHOES), hair: r.chance(0.06) ? r.pick(['#2a9d8f', '#e56b6f', '#7b2cbf']) : r.pick(HAIRS),
    hat: r.pick(['#264653', '#e76f51', '#1d3557', '#f4a261', '#3a3a3a']), detail: r.pick(['#3a2e26', '#1f1f1f', '#8a6a3a']),
    sleeves: r.pick(['short', 'short', 'long', 'tank'] as const), legs: r.chance(0.25) ? 'shorts' : 'pants',
    hairStyle: fem ? r.pick(['long', 'bun', 'ponytail', 'curly', 'short'] as const) : r.pick(['short', 'buzz', 'bald', 'curly', 'short'] as const),
    hatStyle: r.chance(0.15) ? r.pick(['cap', 'beanie'] as const) : 'none',
    height: r.range(0.92, 1.06) * (fem ? 0.95 : 1.0), build: r.range(0.9, 1.04) * (fem ? 0.94 : 1),
  };
}

const UPPER_PREFIX = ['DEF-spine002', 'DEF-spine003', 'DEF-neck', 'DEF-head', 'DEF-shoulder', 'DEF-upper_arm', 'DEF-forearm', 'DEF-hand', 'DEF-f_', 'DEF-thumb'];
const isUpperTrack = (trackName: string) => UPPER_PREFIX.some(p => trackName.startsWith(p));

interface LocoClip { name: string; speed: number; duration: number }
export interface HumanTemplate {
  gltf: GLTF;
  clips: Map<string, THREE.AnimationClip>;
  upper: Map<string, THREE.AnimationClip>;
  lower: Map<string, THREE.AnimationClip>;
  loco: LocoClip[];
  baseGeo: THREE.BufferGeometry;
  variants: Map<string, THREE.BufferGeometry>;
  headIndex: number;
  frame: { up: THREE.Vector3; fwd: THREE.Vector3; right: THREE.Vector3; headCenter: THREE.Vector3; headSize: THREE.Vector3; faceDepth: number };
  height: number;
  waistT: number;
}

/** Prepares the shared template (geometry regions, filtered clips, measured locomotion speeds). */
export function createHumanTemplate(gltf: GLTF): HumanTemplate {
  const skinned: THREE.SkinnedMesh[] = [];
  gltf.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh); });
  const skeleton = skinned[0].skeleton;
  const boneNames = skeleton.bones.map(b => b.name);
  const geos = skinned.map(m => {
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    return g;
  });
  let baseGeo = mergeGeometries(geos, false)!;
  // Joint positions in geometry space (from inverse bind matrices).
  const joint = (n: string) => {
    const i = boneNames.indexOf(n); if (i < 0) throw new Error(`missing bone ${n}`);
    const m = skeleton.boneInverses[i].clone().invert();
    return new THREE.Vector3().setFromMatrixPosition(m).applyMatrix4(skinned[0].bindMatrixInverse);
  };
  const J = {
    neck: joint('DEF-neck'), head: joint('DEF-head'), waist: joint('DEF-spine001'), hips: joint('DEF-hips'),
    shL: joint('DEF-upper_armL'), elL: joint('DEF-forearmL'), wrL: joint('DEF-handL'), shR: joint('DEF-upper_armR'), elR: joint('DEF-forearmR'), wrR: joint('DEF-handR'),
    hipL: joint('DEF-thighL'), kneeL: joint('DEF-shinL'), ankL: joint('DEF-footL'), hipR: joint('DEF-thighR'), kneeR: joint('DEF-shinR'), ankR: joint('DEF-footR'),
  };
  const si = baseGeo.attributes.skinIndex, sw = baseGeo.attributes.skinWeight, pos = baseGeo.attributes.position;
  const region = new Float32Array(si.count), param = new Float32Array(si.count);
  const headBox = new THREE.Box3();
  let minY = Infinity, maxY = -Infinity;
  const up = J.head.clone().sub(J.hips).normalize();
  const segT = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => { const ab = b.clone().sub(a); return THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), -0.5, 1.5); };
  const crotchY = J.hipL.clone().sub(J.hips).dot(up) - 0.06, neckY = J.neck.clone().sub(J.hips).dot(up);
  const dominant: string[] = [];
  for (let i = 0; i < si.count; i++) {
    let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    const name = boneNames[best] ?? '';
    dominant.push(name);
    const p = new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (name === 'DEF-head') headBox.expandByPoint(p);
    minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y);
    const side = name.endsWith('L') ? 'L' : 'R';
    if (name === 'DEF-head') { region[i] = R_SKIN; param[i] = 2; }
    else if (name.startsWith('DEF-upper_arm')) { region[i] = R_ARM; param[i] = segT(p, side === 'L' ? J.shL : J.shR, side === 'L' ? J.elL : J.elR) * 0.5; }
    else if (name.startsWith('DEF-forearm')) { region[i] = R_ARM; param[i] = 0.5 + segT(p, side === 'L' ? J.elL : J.elR, side === 'L' ? J.wrL : J.wrR) * 0.5; }
    else if (name.startsWith('DEF-hand') || name.startsWith('DEF-f_') || name.startsWith('DEF-thumb')) { region[i] = R_ARM; param[i] = 1.2; }
    else if (name.startsWith('DEF-thigh')) { region[i] = R_LEG; param[i] = segT(p, side === 'L' ? J.hipL : J.hipR, side === 'L' ? J.kneeL : J.kneeR) * 0.5; }
    else if (name.startsWith('DEF-shin')) { region[i] = R_LEG; param[i] = 0.5 + segT(p, side === 'L' ? J.kneeL : J.kneeR, side === 'L' ? J.ankL : J.ankR) * 0.5; }
    else if (name.startsWith('DEF-foot') || name.startsWith('DEF-toe')) { region[i] = R_LEG; param[i] = 1.2; }
    else { region[i] = R_TORSO; param[i] = (p.clone().sub(J.hips).dot(up) - crotchY) / (neckY - crotchY); }
  }
  // Leg parameter just above the crotch blends into the torso so trousers stay continuous.
  baseGeo.setAttribute('region', new THREE.BufferAttribute(region, 1));
  baseGeo.setAttribute('cloth', new THREE.BufferAttribute(param, 1));
  softenBody(baseGeo, region, param, maxY - minY);
  const fwdRaw = joint('DEF-toeL').sub(J.ankL);
  const fwd = fwdRaw.sub(up.clone().multiplyScalar(fwdRaw.dot(up))).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, up).normalize();
  const headCenter = headBox.getCenter(new THREE.Vector3()), headSize = headBox.getSize(new THREE.Vector3());
  {
    // Shrink the mannequin's faceless head inside the new sculpted head.
    const c0 = headCenter.clone().addScaledVector(up, -0.03);
    for (let i = 0; i < si.count; i++) if (dominant[i] === 'DEF-head') {
      pos.setXYZ(i, c0.x + (pos.getX(i) - c0.x) * 0.55, c0.y + (pos.getY(i) - c0.y) * 0.55, c0.z + (pos.getZ(i) - c0.z) * 0.55);
    }
    pos.needsUpdate = true;
  }
  const waistT = (J.waist.clone().sub(J.hips).dot(up) - crotchY) / (neckY - crotchY);
  // Per-triangle region consistency: every corner of a triangle gets its parameter in the triangle's region space,
  // so clothing borders are smooth iso-lines instead of jagged triangle edges.
  const flat = baseGeo.toNonIndexed();
  const fp = flat.attributes.position, fr = flat.attributes.region as THREE.BufferAttribute, fc = flat.attributes.cloth as THREE.BufferAttribute;
  const lSign = Math.sign(J.shL.clone().sub(J.hips).dot(right)) || 1;
  const v = new THREE.Vector3();
  const paramFor = (reg: number, p: THREE.Vector3, sideL: boolean): number => {
    if (reg === R_TORSO) return (p.clone().sub(J.hips).dot(up) - crotchY) / (neckY - crotchY);
    if (reg === R_ARM) {
      const sh = sideL ? J.shL : J.shR, el = sideL ? J.elL : J.elR, wr = sideL ? J.wrL : J.wrR;
      const t1 = segT(p, sh, el); if (t1 < 1) return t1 * 0.5;
      const t2 = segT(p, el, wr); return t2 <= 1 ? 0.5 + t2 * 0.5 : 1.2;
    }
    if (reg === R_LEG) {
      const hp = sideL ? J.hipL : J.hipR, kn = sideL ? J.kneeL : J.kneeR, an = sideL ? J.ankL : J.ankR;
      const t1 = segT(p, hp, kn); if (t1 < 1) return t1 * 0.5;
      const t2 = segT(p, kn, an); return t2 <= 1.02 ? 0.5 + t2 * 0.5 : 1.2;
    }
    return 2;
  };
  for (let t = 0; t < fp.count; t += 3) {
    const r = [fr.getX(t), fr.getX(t + 1), fr.getX(t + 2)];
    if (r[0] === r[1] && r[1] === r[2]) continue;
    const chosen = r[0] === r[1] || r[0] === r[2] ? r[0] : r[1] === r[2] ? r[1] : Math.max(...r);
    // side from the triangle centroid
    const cx = (fp.getX(t) + fp.getX(t + 1) + fp.getX(t + 2)) / 3, cy = (fp.getY(t) + fp.getY(t + 1) + fp.getY(t + 2)) / 3, cz = (fp.getZ(t) + fp.getZ(t + 1) + fp.getZ(t + 2)) / 3;
    const sideL = Math.sign(new THREE.Vector3(cx, cy, cz).sub(J.hips).dot(right)) === lSign;
    for (let k = 0; k < 3; k++) {
      if (r[k] === chosen) continue;
      v.set(fp.getX(t + k), fp.getY(t + k), fp.getZ(t + k));
      fr.setX(t + k, chosen); fc.setX(t + k, chosen === R_SKIN ? 2 : paramFor(chosen, v, sideL));
    }
  }
  baseGeo = flat;
  const faceDepth = headSize.z / 2;

  const clips = new Map<string, THREE.AnimationClip>();
  const upper = new Map<string, THREE.AnimationClip>(), lower = new Map<string, THREE.AnimationClip>();
  for (const c of gltf.animations) {
    clips.set(c.name, c);
    // Strip root translation drift so in-place clips stay in place; keep hips bob.
    const tracks = c.tracks.filter(t => !t.name.endsWith('.scale'));
    upper.set(c.name, new THREE.AnimationClip(c.name + '_U', c.duration, tracks.filter(t => isUpperTrack(t.name))));
    lower.set(c.name, new THREE.AnimationClip(c.name + '_L', c.duration, tracks.filter(t => !isUpperTrack(t.name))));
  }
  const tpl: HumanTemplate = {
    gltf, clips, upper, lower, loco: [], baseGeo, variants: new Map(), headIndex: boneNames.indexOf('DEF-head'),
    frame: { up, fwd, right, headCenter, headSize, faceDepth }, height: maxY - minY, waistT,
  };
  tpl.loco = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'].map(n => ({ name: n, duration: clips.get(n)!.duration, speed: measureSpeed(gltf, clips.get(n)!) }));
  return tpl;
}

/**
 * Turns the muscular mannequin into a clothed figure: welds seams, Taubin-smooths clothing regions
 * (removing abs/pecs definition), inflates garments slightly and recomputes seamless normals.
 */
function softenBody(geo: THREE.BufferGeometry, region: Float32Array, param: Float32Array, height: number) {
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const n = pos.count;
  const key = (i: number) => `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
  const weld = new Int32Array(n); const uniq: number[] = []; const map = new Map<string, number>();
  for (let i = 0; i < n; i++) { const k = key(i); let u = map.get(k); if (u === undefined) { u = uniq.length; map.set(k, u); uniq.push(i); } weld[i] = u; }
  const U = uniq.length;
  const P = new Float32Array(U * 3);
  for (let u = 0; u < U; u++) { const i = uniq[u]; P[u * 3] = pos.getX(i); P[u * 3 + 1] = pos.getY(i); P[u * 3 + 2] = pos.getZ(i); }
  const idx = geo.index ? (geo.index.array as ArrayLike<number>) : Array.from({ length: n }, (_, i) => i);
  const nbr: Set<number>[] = Array.from({ length: U }, () => new Set<number>());
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  const reg = new Float32Array(U), par = new Float32Array(U); for (let u = 0; u < U; u++) { reg[u] = region[uniq[u]]; par[u] = param[uniq[u]]; }
  const clothU = (u: number) => (reg[u] === R_TORSO && par[u] < 1.02) || ((reg[u] === R_ARM || reg[u] === R_LEG) && par[u] < 0.97);
  const step = (f: number) => {
    const out = P.slice();
    for (let u = 0; u < U; u++) {
      if (!clothU(u) || nbr[u].size === 0) continue;
      let x = 0, y = 0, z = 0; for (const v of nbr[u]) { x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; }
      const k = nbr[u].size;
      out[u * 3] += (x / k - P[u * 3]) * f; out[u * 3 + 1] += (y / k - P[u * 3 + 1]) * f; out[u * 3 + 2] += (z / k - P[u * 3 + 2]) * f;
    }
    P.set(out);
  };
  for (let it = 0; it < 10; it++) { step(0.5); step(-0.53); }
  // seamless normals from welded positions
  const N = new Float32Array(U * 3);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
    va.fromArray(P, a * 3); vb.fromArray(P, b * 3); vc.fromArray(P, c * 3);
    e1.subVectors(vb, va); e2.subVectors(vc, va); e1.cross(e2);
    for (const w of [a, b, c]) { N[w * 3] += e1.x; N[w * 3 + 1] += e1.y; N[w * 3 + 2] += e1.z; }
  }
  const inflate = height * 0.006;
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const u = weld[i];
    const nx = N[u * 3], ny = N[u * 3 + 1], nz = N[u * 3 + 2]; const l = Math.hypot(nx, ny, nz) || 1;
    const inf = clothU(u) ? inflate * (reg[u] === R_TORSO ? 1.4 : 1) : 0;
    pos.setXYZ(i, P[u * 3] + (nx / l) * inf, P[u * 3 + 1] + (ny / l) * inf, P[u * 3 + 2] + (nz / l) * inf);
    nor.setXYZ(i, nx / l, ny / l, nz / l);
  }
  pos.needsUpdate = true; nor.needsUpdate = true;
}

/** Measures how fast the planted foot travels backwards in an in-place locomotion clip (m/s at template scale). */
function measureSpeed(gltf: GLTF, clip: THREE.AnimationClip): number {
  const scene = SkeletonUtils.clone(gltf.scene);
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip); action.play();
  const footL = scene.getObjectByName('DEF-toeL')!, footR = scene.getObjectByName('DEF-toeR')!;
  const N = 90; const samples: { l: THREE.Vector3; r: THREE.Vector3 }[] = [];
  for (let i = 0; i <= N; i++) {
    mixer.setTime((clip.duration * i) / N); scene.updateMatrixWorld(true);
    samples.push({ l: footL.getWorldPosition(new THREE.Vector3()), r: footR.getWorldPosition(new THREE.Vector3()) });
  }
  // Dominant horizontal axis of toe motion
  const rangeX = Math.max(...samples.map(s => s.l.x)) - Math.min(...samples.map(s => s.l.x));
  const rangeZ = Math.max(...samples.map(s => s.l.z)) - Math.min(...samples.map(s => s.l.z));
  const ax: 'x' | 'z' = rangeX > rangeZ ? 'x' : 'z';
  const dt = clip.duration / N;
  const groupsBySign: Record<string, number[]> = { pos: [], neg: [] };
  for (const side of ['l', 'r'] as const) {
    const minY = Math.min(...samples.map(s => s[side].y));
    for (let i = 0; i < N; i++) {
      const a = samples[i][side], b = samples[i + 1][side];
      if (a.y < minY + 0.012 && b.y < minY + 0.012) { const v = (b[ax] - a[ax]) / dt; (v >= 0 ? groupsBySign.pos : groupsBySign.neg).push(Math.abs(v)); }
    }
  }
  const g = groupsBySign.pos.length > groupsBySign.neg.length ? groupsBySign.pos : groupsBySign.neg;
  g.sort((a, b) => a - b);
  mixer.stopAllAction();
  const med = g.length ? g[Math.floor(g.length / 2)] : 1.4;
  return Math.max(0.6, med);
}

/** Builds (and caches) a body geometry variant with hair/hat/eyes skinned to the head bone. */
function variantGeometry(tpl: HumanTemplate, hair: HairStyle, hat: HatStyle): THREE.BufferGeometry {
  const key = `${hair}|${hat}`;
  const cached = tpl.variants.get(key); if (cached) return cached;
  const { up, fwd, right, headCenter: hc, headSize: hs } = tpl.frame;
  const parts: THREE.BufferGeometry[] = [tpl.baseGeo];
  const basis = new THREE.Matrix4().makeBasis(right, up, fwd);
  // head radius in the local frame (x = right, y = up, z = forward)
  const rx = Math.abs(hs.clone().dot(right)) / 2 || hs.x / 2;
  const add = (g: THREE.BufferGeometry, reg: number, lx = 0, ly = 0, lz = 0) => {
    g.translate(lx, ly, lz); g.applyMatrix4(basis); g.translate(hc.x, hc.y, hc.z);
    const geo = g.index ? g.toNonIndexed() : g;
    for (const k of Object.keys(geo.attributes)) if (!['position', 'normal'].includes(k)) geo.deleteAttribute(k);
    const n = geo.attributes.position.count;
    const bsi = tpl.baseGeo.attributes.skinIndex as THREE.BufferAttribute, bsw = tpl.baseGeo.attributes.skinWeight as THREE.BufferAttribute;
    type TA = { new(n: number): THREE.TypedArray };
    const si = new (bsi.array.constructor as TA)(n * 4), sw = new (bsw.array.constructor as TA)(n * 4), rg = new Float32Array(n);
    const one = bsw.normalized ? (bsw.array instanceof Uint8Array ? 255 : 65535) : 1;
    for (let i = 0; i < n; i++) { si[i * 4] = tpl.headIndex; sw[i * 4] = one; rg[i] = reg; }
    geo.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4, bsi.normalized)); geo.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4, bsw.normalized)); geo.setAttribute('region', new THREE.BufferAttribute(rg, 1)); geo.setAttribute('cloth', new THREE.BufferAttribute(new Float32Array(n), 1));
    parts.push(geo);
  };
  // Sculpted stylised head (local frame: x right, y up, z forward; metres around the old head centre).
  const S = Math.max(rx, 0.06) / 0.087; // keep proportions if the rig scale differs
  const skull = new THREE.SphereGeometry(1, 20, 16);
  { const p = skull.attributes.position; for (let i = 0; i < p.count; i++) { let x = p.getX(i), z = p.getZ(i); const y = p.getY(i); if (y < 0) { const t = -y; x *= 1 - 0.32 * t ** 1.4; z *= 1 - 0.08 * t; z += 0.12 * t * Math.max(0, z); } if (z > 0.6 && y > -0.2 && y < 0.35) z *= 0.97; p.setXYZ(i, x * 0.084 * S, y * 0.112 * S, z * 0.1 * S); } skull.computeVertexNormals(); }
  add(skull, R_SKIN, 0, -0.005 * S, 0.006 * S);
  for (const s of [-1, 1]) {
    add(new THREE.SphereGeometry(1, 8, 6).scale(0.012 * S, 0.026 * S, 0.02 * S), R_SKIN, s * 0.083 * S, -0.008 * S, 0.0);
    add(new THREE.SphereGeometry(1, 10, 8).scale(0.0135 * S, 0.0175 * S, 0.009 * S), R_EYES, s * 0.031 * S, 0.012 * S, 0.094 * S);
    add(new THREE.BoxGeometry(0.03 * S, 0.0065 * S, 0.012 * S).rotateZ(s * -0.14), R_HAIR, s * 0.032 * S, 0.04 * S, 0.096 * S);
  }
  add(new THREE.SphereGeometry(1, 8, 6).scale(0.013 * S, 0.02 * S, 0.02 * S), R_SKIN, 0, -0.016 * S, 0.105 * S); // nose
  add(new THREE.BoxGeometry(0.03 * S, 0.006 * S, 0.01 * S), R_DETAIL, 0, -0.05 * S, 0.094 * S); // mouth
  const hairCap = (sx: number, sy: number, sz: number, theta: number, tilt: number, reg: number, dy = 0.014, dz = -0.008) => {
    const g = new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, theta).scale(sx * S, sy * S, sz * S); g.rotateX(-tilt);
    add(g, reg, 0, dy * S, dz * S);
  };
  switch (hair) {
    case 'short': hairCap(0.094, 0.121, 0.109, Math.PI * 0.62, 0.5, R_HAIR); break;
    case 'buzz': hairCap(0.09, 0.118, 0.105, Math.PI * 0.6, 0.52, R_HAIR); break;
    case 'curly': hairCap(0.099, 0.125, 0.113, Math.PI * 0.63, 0.48, R_HAIR); for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2; add(new THREE.SphereGeometry(1, 8, 6).scale(0.035 * S, 0.033 * S, 0.035 * S), R_HAIR, Math.cos(a) * 0.07 * S, 0.075 * S + Math.sin(a * 3) * 0.008 * S, Math.sin(a) * 0.065 * S - 0.015 * S); } break;
    case 'long': hairCap(0.098, 0.125, 0.113, Math.PI * 0.64, 0.46, R_HAIR); add(new THREE.CylinderGeometry(0.085 * S, 0.075 * S, 0.2 * S, 14, 1, true, Math.PI * 0.55, Math.PI * 0.9).rotateY(Math.PI), R_HAIR, 0, -0.06 * S, -0.012 * S); add(new THREE.BoxGeometry(0.15 * S, 0.19 * S, 0.035 * S), R_HAIR, 0, -0.07 * S, -0.075 * S); break;
    case 'bun': hairCap(0.095, 0.121, 0.109, Math.PI * 0.62, 0.5, R_HAIR); add(new THREE.SphereGeometry(1, 10, 8).scale(0.045 * S, 0.042 * S, 0.045 * S), R_HAIR, 0, 0.1 * S, -0.065 * S); break;
    case 'ponytail': hairCap(0.095, 0.121, 0.109, Math.PI * 0.62, 0.5, R_HAIR); add(new THREE.CylinderGeometry(0.022 * S, 0.012 * S, 0.17 * S, 8).rotateX(0.35), R_HAIR, 0, -0.04 * S, -0.12 * S); break;
    case 'bald': break;
  }
  if (hat === 'cap' || hat === 'police') {
    hairCap(0.1, 0.126, 0.114, Math.PI * 0.45, 0.25, R_HAT, 0.02, -0.004);
    add(new THREE.CylinderGeometry(0.075 * S, 0.075 * S, 0.008 * S, 16, 1, false, -Math.PI / 2, Math.PI).scale(1, 1, 1.25), hat === 'police' ? R_DETAIL : R_HAT, 0, 0.06 * S, 0.06 * S);
    if (hat === 'police') add(new THREE.CylinderGeometry(0.105 * S, 0.1 * S, 0.05 * S, 16), R_HAT, 0, 0.1 * S, -0.005 * S);
  } else if (hat === 'beanie') {
    hairCap(0.101, 0.128, 0.115, Math.PI * 0.52, 0.3, R_HAT, 0.018, -0.01);
    add(new THREE.TorusGeometry(0.098 * S, 0.012 * S, 6, 20).rotateX(Math.PI / 2 - 0.3), R_HAT, 0, 0.035 * S, -0.012 * S);
  }
  const merged = mergeGeometries(parts.map(p => (p.index ? p.toNonIndexed() : p)), false)!;
  merged.computeBoundingSphere();
  tpl.variants.set(key, merged);
  return merged;
}

function outfitMaterial(colors: THREE.Color[], params: THREE.Vector4): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
  const uniforms = { uColors: { value: colors }, uFlash: { value: 0 }, uCloth: { value: params } };
  m.userData.uniforms = uniforms;
  m.onBeforeCompile = sh => {
    sh.uniforms.uColors = uniforms.uColors; sh.uniforms.uFlash = uniforms.uFlash; sh.uniforms.uCloth = uniforms.uCloth;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float region; attribute float cloth; flat varying float vRegion; varying float vCloth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegion = region; vCloth = cloth;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\nuniform vec3 uColors[${SLOTS}]; uniform float uFlash; uniform vec4 uCloth; flat varying float vRegion; varying float vCloth;`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // uCloth: x = sleeve length (arm param), y = trouser length (leg param), z = waist (torso param), w = neckline
        int ri = int(vRegion + 0.5);
        vec3 rc = uColors[0]; float rough = 0.85;
        if (ri == 1) {
          if (vCloth > uCloth.w) { rc = uColors[0]; rough = 0.55; }
          else if (vCloth > uCloth.z + 0.035) rc = uColors[1];
          else if (vCloth > uCloth.z - 0.035) rc = uColors[5];
          else rc = uColors[2];
        } else if (ri == 2) {
          if (vCloth < uCloth.x) rc = uColors[1]; else { rc = uColors[0]; rough = 0.55; }
          if (vCloth < uCloth.x && vCloth > uCloth.x - 0.04 && uCloth.x > 0.1) rc *= 0.85;
        } else if (ri == 3) {
          if (vCloth > 1.0) { rc = uColors[3]; rough = 0.6; }
          else if (vCloth < uCloth.y) rc = uColors[2]; else { rc = uColors[0]; rough = 0.55; }
        } else {
          for (int i = 0; i < ${SLOTS}; i++) if (i == ri) rc = uColors[i];
          if (ri == 0) rough = 0.55; if (ri == 9) rough = 0.2; if (ri == 4) rough = 0.75;
        }
        diffuseColor.rgb = rc;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 0.85, 0.8), uFlash);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = rough;');
  };
  m.customProgramCacheKey = () => 'human-outfit-2';
  return m;
}

type UpperMode = 'loco' | 'pistol' | 'rifle' | 'carry' | 'none';
interface Slot { action: THREE.AnimationAction; weight: number; target: number }

/** One animated person. */
export class Human {
  root = new THREE.Group();
  model: THREE.Object3D;
  mesh: THREE.SkinnedMesh;
  mixer: THREE.AnimationMixer;
  material: THREE.MeshStandardMaterial;
  rightHand: THREE.Object3D;
  leftHand: THREE.Object3D;
  head: THREE.Object3D;
  spine: THREE.Object3D;
  look: Look;
  private lower = new Map<string, Slot>();
  private upper = new Map<string, Slot>();
  private phase = 0;
  private locoWeights = [0, 0, 0, 0];
  private state: string = 'loco';
  private upperMode: UpperMode = 'loco';
  private oneShot: { name: string; layer: 'upper' | 'full'; t: number; dur: number; fade: number; weight: number; soft: boolean } | null = null;
  aimPitch = 0;
  speed = 0;
  scale: number;
  private flashT = 0;
  private stateTime = 0;
  private colors: THREE.Color[];
  private clothParams: THREE.Vector4;

  constructor(private tpl: HumanTemplate, look: Look) {
    this.look = look;
    this.model = SkeletonUtils.clone(tpl.gltf.scene);
    const meshes: THREE.SkinnedMesh[] = [];
    this.model.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
    this.mesh = meshes[0];
    for (let i = 1; i < meshes.length; i++) meshes[i].removeFromParent();
    this.mesh.geometry = variantGeometry(tpl, look.hairStyle, look.hatStyle);
    this.colors = Array.from({ length: SLOTS }, () => new THREE.Color());
    this.clothParams = new THREE.Vector4();
    this.material = outfitMaterial(this.colors, this.clothParams);
    this.applyLook(look);
    this.mesh.material = this.material;
    this.mesh.castShadow = true; this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.scale = look.height * (1.78 / tpl.height);
    this.model.scale.set(this.scale * look.build, this.scale, this.scale * (0.5 + look.build * 0.5));
    this.root.add(this.model);
    this.rightHand = this.model.getObjectByName('DEF-handR')!;
    this.leftHand = this.model.getObjectByName('DEF-handL')!;
    this.head = this.model.getObjectByName('DEF-head')!;
    this.spine = this.model.getObjectByName('DEF-spine003')!;
    this.mixer = new THREE.AnimationMixer(this.model);
    const addSlot = (layer: Map<string, Slot>, src: Map<string, THREE.AnimationClip>, name: string, loop = true) => {
      const clip = src.get(name); if (!clip) throw new Error(`missing clip ${name}`);
      const a = this.mixer.clipAction(clip);
      a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity); a.clampWhenFinished = !loop; a.enabled = true; a.setEffectiveWeight(0); a.play();
      layer.set(name, { action: a, weight: 0, target: 0 });
    };
    const fullBody = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop', 'Jump_Loop', 'Driving_Loop', 'Swim_Idle_Loop', 'Swim_Fwd_Loop', 'Sitting_Idle_Loop', 'Crouch_Idle_Loop', 'Idle_Talking_Loop', 'Dance_Loop'];
    const once = ['Jump_Start', 'Jump_Land', 'Death01', 'Roll', 'Hit_Chest', 'Hit_Head', 'Punch_Jab', 'Punch_Cross', 'Pistol_Reload', 'Pistol_Shoot', 'Interact', 'PickUp_Table', 'Sitting_Enter', 'Sitting_Exit'];
    for (const n of fullBody) { addSlot(this.lower, tpl.lower, n); addSlot(this.upper, tpl.upper, n); }
    for (const n of once) { addSlot(this.lower, tpl.lower, n, false); addSlot(this.upper, tpl.upper, n, false); }
    for (const n of ['Pistol_Idle_Loop', 'Pistol_Aim_Neutral', 'Pistol_Aim_Up', 'Pistol_Aim_Down']) addSlot(this.upper, tpl.upper, n);
    for (const loco of ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop']) { this.lower.get(loco)!.action.timeScale = 0; this.upper.get(loco)!.action.timeScale = 0; }
    this.lower.get('Idle_Loop')!.target = 1; this.upper.get('Idle_Loop')!.target = 1;
    this.lower.get('Idle_Loop')!.weight = 1; this.upper.get('Idle_Loop')!.weight = 1;
    this.phase = Math.random();
    this.update(0);
  }
  applyLook(look: Look) {
    const c = this.colors;
    c[C_SKIN].set(look.skin); c[C_TOP].set(look.top); c[C_BOTTOM].set(look.bottom); c[C_SHOES].set(look.shoes); c[C_HAIR].set(look.hair);
    c[C_BELT].set(look.detail); c[C_EYES].set('#1b1b1f'); c[C_HAT].set(look.hat); c[C_DETAIL].set(look.detail);
    for (const col of c) col.convertSRGBToLinear();
    this.clothParams.set(look.sleeves === 'long' ? 0.97 : look.sleeves === 'short' ? 0.3 : -1, look.legs === 'shorts' ? 0.42 : 0.985, this.tpl.waistT, 0.97);
  }
  /** Stride-synced locomotion cycle 0..1 (left foot plants near 0.08, right near 0.58). */
  get locoPhase() { return this.phase; }
  /** Locomotion speed in m/s (world). */
  setSpeed(v: number) { this.speed = v; }
  /** Full-body state: loco, jump, drive, swim, sit, dead, crouch, talk, dance */
  setState(s: string) { if (s !== this.state) { this.state = s; this.stateTime = 0; if (s === 'dead') this.playOnce('Death01', 'full', 0.12); } }
  get currentState() { return this.state; }
  setUpperMode(m: UpperMode) { this.upperMode = m; }
  /**
   * Plays a one-shot over the given layer(s). Options: `from` starts part-way into the clip (s), `to` ends early (s),
   * `rate` scales playback, `weight` < 1 blends it over the current pose (e.g. a light landing),
   * and `soft` one-shots never count as busy (they may be interrupted by anything).
   */
  playOnce(name: string, layer: 'upper' | 'full', fade = 0.1, opts: { from?: number; to?: number; rate?: number; weight?: number; soft?: boolean } = {}) {
    const clipDur = this.tpl.clips.get(name)!.duration;
    const from = Math.max(0, Math.min(clipDur, opts.from ?? 0)), to = Math.max(from, Math.min(clipDur, opts.to ?? clipDur));
    const rate = opts.rate ?? 1;
    const dur = (to - from) / rate;
    this.oneShot = { name, layer, t: 0, dur, fade: Math.min(fade, dur * 0.5), weight: Math.max(0, Math.min(1, opts.weight ?? 1)), soft: !!opts.soft };
    for (const l of layer === 'full' ? [this.lower, this.upper] : [this.upper]) { const s = l.get(name)!; s.action.reset(); s.action.timeScale = rate; s.action.time = from; s.action.play(); }
  }
  /** Name of the playing one-shot (null when none). */
  get oneShotName() { return this.oneShot ? this.oneShot.name : null; }
  /** Ends the current one-shot early with a short blend (e.g. a jump pose cut by landing). */
  stopOnce(name?: string) { const os = this.oneShot; if (os && (!name || os.name === name)) os.dur = Math.min(os.dur, os.t + os.fade); }
  get busy() { return !!this.oneShot && !this.oneShot.soft && this.oneShot.t < this.oneShot.dur - this.oneShot.fade; }
  flash() { this.flashT = 0.12; }
  update(dt: number) {
    this.stateTime += dt;
    const tpl = this.tpl;
    // Locomotion blend weights from speed (template speeds scaled by body scale).
    const sc = this.scale;
    const [walk, jog, sprint] = tpl.loco.map(l => l.speed * sc);
    const v = this.speed;
    const w = this.locoWeights; w.fill(0);
    if (v < 0.15) w[0] = 1;
    else if (v < walk) { const t = v / walk; w[0] = 1 - t; w[1] = t; }
    else if (v < jog) { const t = (v - walk) / (jog - walk); w[1] = 1 - t; w[2] = t; }
    else if (v < sprint) { const t = (v - jog) / (sprint - jog); w[2] = 1 - t; w[3] = t; }
    else w[3] = 1;
    // Stride-matched cycle: phase advances by distance / blended stride length.
    const strides = tpl.loco.map((l, i) => l.speed * sc * l.duration * (i === 0 ? 1 : 1));
    const movingW = w[1] + w[2] + w[3];
    if (movingW > 0.001) {
      const stride = (w[1] * strides[0] + w[2] * strides[1] + w[3] * strides[2]) / movingW;
      this.phase = (this.phase + (Math.max(v, 0.4) * dt) / stride) % 1;
    } else this.phase = (this.phase + dt / 4) % 1;
    const locoNames = ['Idle_Loop', 'Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'];
    for (let i = 0; i < 4; i++) {
      const n = locoNames[i], dur = i === 0 ? tpl.clips.get(n)!.duration : tpl.loco[i - 1].duration;
      const time = i === 0 ? (this.stateTime % dur) : this.phase * dur;
      this.lower.get(n)!.action.time = time; this.upper.get(n)!.action.time = time;
    }
    // Targets
    for (const s of this.lower.values()) s.target = 0;
    for (const s of this.upper.values()) s.target = 0;
    const L = (n: string, t = 1) => { this.lower.get(n)!.target += t; };
    const U = (n: string, t = 1) => { this.upper.get(n)!.target += t; };
    let fullOverride = false;
    switch (this.state) {
      case 'loco': locoNames.forEach((n, i) => { L(n, w[i]); U(n, w[i]); }); break;
      case 'jump': L('Jump_Loop'); U('Jump_Loop'); break;
      case 'drive': L('Driving_Loop'); U('Driving_Loop'); fullOverride = true; break;
      case 'swim': { const f = Math.min(1, v / 1.5); L('Swim_Idle_Loop', 1 - f); L('Swim_Fwd_Loop', f); U('Swim_Idle_Loop', 1 - f); U('Swim_Fwd_Loop', f); fullOverride = true; break; }
      case 'sit': L('Sitting_Idle_Loop'); U('Sitting_Idle_Loop'); break;
      case 'crouch': L('Crouch_Idle_Loop'); U('Crouch_Idle_Loop'); break;
      case 'talk': L('Idle_Loop'); U('Idle_Talking_Loop'); break;
      case 'dance': L('Dance_Loop'); U('Dance_Loop'); fullOverride = true; break;
      case 'dead': L('Death01'); U('Death01'); fullOverride = true; break;
    }
    if (!fullOverride && this.state !== 'dead') {
      if (this.upperMode === 'pistol' || this.upperMode === 'rifle') {
        for (const s of this.upper.values()) s.target = 0;
        const p = THREE.MathUtils.clamp(this.aimPitch / 0.9, -1, 1);
        if (p >= 0) { U('Pistol_Aim_Neutral', 1 - p); U('Pistol_Aim_Up', p); } else { U('Pistol_Aim_Neutral', 1 + p); U('Pistol_Aim_Down', -p); }
      } else if (this.upperMode === 'carry') { for (const s of this.upper.values()) s.target = 0; U('Pistol_Idle_Loop'); }
    }
    // One-shots override their layer(s).
    if (this.oneShot) {
      const os = this.oneShot; os.t += dt;
      const fadeIn = Math.min(1, os.t / os.fade), fadeOut = Math.min(1, Math.max(0, (os.dur - os.t) / os.fade));
      const k = Math.min(fadeIn, fadeOut) * os.weight;
      const layers = os.layer === 'full' ? [this.lower, this.upper] : [this.upper];
      for (const l of layers) { for (const s of l.values()) s.target *= 1 - k; l.get(os.name)!.target = k; }
      if (os.t >= os.dur) this.oneShot = null;
    }
    if (this.state === 'dead' && !this.oneShot) { for (const l of [this.lower, this.upper]) { for (const s of l.values()) s.target = 0; l.get('Death01')!.target = 1; } }
    // Smooth weights (fast enough to feel responsive, slow enough to never pop).
    const rate = 1 - Math.exp(-dt * 14);
    for (const l of [this.lower, this.upper]) for (const s of l.values()) {
      s.weight += (s.target - s.weight) * (dt === 0 ? 1 : rate);
      if (s.weight < 0.001 && s.target === 0) s.weight = 0;
      s.action.setEffectiveWeight(s.weight);
    }
    if (this.flashT > 0) { this.flashT -= dt; (this.material.userData.uniforms.uFlash as { value: number }).value = Math.max(0, this.flashT / 0.12) * 0.6; }
    this.mixer.update(dt);
  }
  dispose() { this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); this.material.dispose(); this.root.removeFromParent(); this.mesh.skeleton.dispose(); }
}
