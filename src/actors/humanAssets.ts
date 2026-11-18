/**
 * Human body assets: loads the CC0 Quaternius Universal Base Characters (realistic male/female bodies with faces,
 * plus rigged hair meshes), renames their Unreal-style bones to the Universal Animation Library rig names, retargets
 * every UAL clip onto each body (world-space rotation deltas, hip motion scaled by leg length), and builds:
 *  - one shared, region-tagged body geometry per sex (clothes are painted per person in the shader), and
 *  - cached "extras" geometry per hairstyle/facial hair/hat/garment combination (hair shells generated from the
 *    actual scalp, hoods, collars, skirts, caps), skinned to the same skeleton so each person is two draw calls.
 */
import { freeAfterUpload } from '../world/builders';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { FullLook, Sex, HairStyle } from './look';

/** Vertex regions (shader branches on these). */
export const R = { SKIN: 0, TORSO: 1, ARM: 2, LEG: 3, HAIR: 4, BROW: 5, CTOP: 6, CBOT: 7, HAIRP: 8, EYES: 9, HAT: 10, DETAIL: 11, SOLE: 12 } as const;

/** Atlas slots [u, v, w, h] (glTF convention, v down) in public/assets/ubc/atlas_*.jpg. */
const SLOT = { m: [0, 0, 0.5, 0.5], f: [0.5, 0, 0.5, 0.5], hair1: [0, 0.5, 0.5, 0.5], hair2: [0.5, 0.5, 0.5, 0.375], eye: [0.5, 0.875, 0.125, 0.125] } as const;

const UE_TO_UAL: Record<string, string> = {
  pelvis: 'DEF-hips', spine_01: 'DEF-spine001', spine_02: 'DEF-spine002', spine_03: 'DEF-spine003', neck_01: 'DEF-neck', Head: 'DEF-head',
};
for (const [s, S] of [['l', 'L'], ['r', 'R']]) {
  Object.assign(UE_TO_UAL, {
    [`clavicle_${s}`]: `DEF-shoulder${S}`, [`upperarm_${s}`]: `DEF-upper_arm${S}`, [`lowerarm_${s}`]: `DEF-forearm${S}`, [`hand_${s}`]: `DEF-hand${S}`,
    [`thigh_${s}`]: `DEF-thigh${S}`, [`calf_${s}`]: `DEF-shin${S}`, [`foot_${s}`]: `DEF-foot${S}`, [`ball_${s}`]: `DEF-toe${S}`,
  });
  for (let n = 1; n <= 3; n++) {
    UE_TO_UAL[`thumb_0${n}_${s}`] = `DEF-thumb0${n}${S}`;
    for (const f of ['index', 'middle', 'ring', 'pinky']) UE_TO_UAL[`${f}_0${n}_${s}`] = `DEF-f_${f}0${n}${S}`;
  }
}

const UPPER_PREFIX = ['DEF-spine002', 'DEF-spine003', 'DEF-neck', 'DEF-head', 'DEF-shoulder', 'DEF-upper_arm', 'DEF-forearm', 'DEF-hand', 'DEF-f_', 'DEF-thumb'];
const isUpperTrack = (trackName: string) => UPPER_PREFIX.some(p => trackName.startsWith(p));

export interface LocoClip { name: string; speed: number; duration: number }
export interface HeadFrame { center: THREE.Vector3; half: THREE.Vector3; joint: THREE.Vector3 }
export interface BodyBase {
  sex: Sex;
  scene: THREE.Object3D;
  geo: THREE.BufferGeometry;
  boneNames: string[];
  clips: Map<string, THREE.AnimationClip>;
  upper: Map<string, THREE.AnimationClip>;
  lower: Map<string, THREE.AnimationClip>;
  loco: LocoClip[];
  height: number;
  groundY: number;
  waistT: number;
  head: HeadFrame;
  J: Record<string, THREE.Vector3>;
  /** Welded scalp/head surface (positions + normals) used to grow hair shells and hats. */
  scalp: THREE.BufferGeometry;
  /** For nearest-vertex skin weight transfer: body positions/skin data (indexed, original). */
  skinSrc: { pos: Float32Array; si: Float32Array; sw: Float32Array };
  extras: Map<string, THREE.BufferGeometry | null>;
  /** The indexed body with all attributes (for garment bands grown from the body surface). */
  bodyIdx: THREE.BufferGeometry;
}
export interface HumanAssets {
  bodies: Record<Sex, BodyBase>;
  map: THREE.Texture;
  normalMap: THREE.Texture;
  hair: Map<string, { geo: THREE.BufferGeometry; headJoint: THREE.Vector3; slot: readonly number[] }>;
  ualClipNames: string[];
}

const HAIR_FILES = { long: 'Hair_Long', buns: 'Hair_Buns', parted: 'Hair_SimpleParted', buzz: 'Hair_Buzzed', buzzF: 'Hair_BuzzedFemale', beard: 'Hair_Beard' } as const;

/** Loads and prepares everything (call once). `base` is the URL prefix of public/assets/ubc/. */
export async function loadHumanAssets(ual: GLTF, base: string): Promise<HumanAssets> {
  const loader = new GLTFLoader();
  const tl = new THREE.TextureLoader();
  const tex = (n: string, srgb: boolean) => tl.loadAsync(base + n).then(t => { t.flipY = false; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.anisotropy = 4; return t; });
  const [m, f, map, normalMap, ...hairG] = await Promise.all([
    loader.loadAsync(base + 'Superhero_Male_FullBody.gltf'), loader.loadAsync(base + 'Superhero_Female_FullBody.gltf'),
    tex('atlas_albedo.jpg', true), tex('atlas_normal.jpg', false),
    ...Object.values(HAIR_FILES).map(n => loader.loadAsync(base + n + '.gltf')),
  ]);
  const hair = new Map<string, { geo: THREE.BufferGeometry; headJoint: THREE.Vector3; slot: readonly number[] }>();
  Object.keys(HAIR_FILES).forEach((k, i) => {
    const g = hairG[i];
    let sm: THREE.SkinnedMesh | null = null;
    g.scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh && !sm) sm = o as THREE.SkinnedMesh; });
    const mesh = sm as unknown as THREE.SkinnedMesh;
    const hi = mesh.skeleton.bones.findIndex(b => b.name === 'Head');
    const headJoint = new THREE.Vector3().setFromMatrixPosition(mesh.skeleton.boneInverses[hi].clone().invert());
    const geo = mesh.geometry.clone();
    for (const a of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(a)) geo.deleteAttribute(a);
    hair.set(k, { geo, headJoint, slot: ['long', 'buns', 'buzzF'].includes(k) ? SLOT.hair2 : SLOT.hair1 });
  });
  return { bodies: { m: buildBody(m, 'm', ual), f: buildBody(f, 'f', ual) }, map, normalMap, hair, ualClipNames: ual.animations.map(a => a.name) };
}

function remapUV(geo: THREE.BufferGeometry, slot: readonly number[]) {
  const uv = geo.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) {
    const u = THREE.MathUtils.clamp(uv.getX(i), 0.002, 0.998), v = THREE.MathUtils.clamp(uv.getY(i), 0.002, 0.998);
    uv.setXY(i, slot[0] + u * slot[2], slot[1] + v * slot[3]);
  }
}

/** Normalised head coordinates (x left, y up, z forward; ~-1..1 over the head). */
export function headCoords(h: HeadFrame, p: THREE.Vector3, out = new THREE.Vector3()) {
  return out.set((p.x - h.center.x) / h.half.x, (p.y - h.center.y) / h.half.y, (p.z - h.center.z) / h.half.z);
}
/** Normalised height of the hairline at a point on the head (same formula as the shader). */
export function hairline(x: number, z: number) {
  const front = THREE.MathUtils.smoothstep(z, 0.15, 0.8);
  let h = -0.42 + 0.84 * front;
  const ear = THREE.MathUtils.smoothstep(Math.abs(x), 0.55, 0.8) * (1 - THREE.MathUtils.smoothstep(Math.abs(z - 0.05), 0.3, 0.5));
  h = Math.max(h, -0.42 + ear * 0.5);
  return h;
}

function buildBody(gltf: GLTF, sex: Sex, ual: GLTF): BodyBase {
  const scene = gltf.scene;
  scene.traverse(o => { const n = UE_TO_UAL[o.name]; if (n) o.name = n; });
  const meshes: THREE.SkinnedMesh[] = [];
  scene.traverse(o => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) meshes.push(o as THREE.SkinnedMesh); });
  meshes.sort((a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count);
  const [bodyM, ...small] = meshes;
  const eyesM = small.find(s => s.geometry.attributes.position.count === 556) ?? small[0];
  const browM = small.find(s => s !== eyesM)!;
  const skeleton = bodyM.skeleton;
  const boneNames = skeleton.bones.map(b => b.name);
  const joint = (n: string) => {
    const i = boneNames.indexOf(n); if (i < 0) throw new Error(`missing bone ${n}`);
    return new THREE.Vector3().setFromMatrixPosition(skeleton.boneInverses[i].clone().invert()).applyMatrix4(bodyM.bindMatrixInverse);
  };
  const J: Record<string, THREE.Vector3> = {};
  for (const n of ['neck', 'head', 'spine001', 'spine003', 'hips', 'upper_armL', 'forearmL', 'handL', 'upper_armR', 'forearmR', 'handR', 'thighL', 'shinL', 'footL', 'toeL', 'thighR', 'shinR', 'footR', 'toeR']) J[n] = joint('DEF-' + n);

  const prep = (m: THREE.SkinnedMesh) => {
    const g = m.geometry.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'skinIndex', 'skinWeight'].includes(k)) g.deleteAttribute(k);
    // normalise attribute types so the parts merge
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
    const siF = new Float32Array(si.count * 4), swF = new Float32Array(sw.count * 4);
    for (let i = 0; i < si.count; i++) for (let k = 0; k < 4; k++) { siF[i * 4 + k] = si.getComponent(i, k); swF[i * 4 + k] = sw.getComponent(i, k); }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(siF), 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(swF, 4));
    return g;
  };
  const bodyG = prep(bodyM), eyesG = prep(eyesM), browG = prep(browM);
  remapUV(bodyG, sex === 'm' ? SLOT.m : SLOT.f); remapUV(eyesG, SLOT.eye); remapUV(browG, sex === 'm' ? SLOT.hair1 : SLOT.hair2);

  // Head frame from the body's head-dominant vertices.
  const headIdx = boneNames.indexOf('DEF-head');
  const dominantOf = (g: THREE.BufferGeometry, i: number) => {
    const si = g.attributes.skinIndex, sw = g.attributes.skinWeight; let best = 0, bw = -1;
    for (let k = 0; k < 4; k++) { const w = sw.getComponent(i, k); if (w > bw) { bw = w; best = si.getComponent(i, k); } }
    return best;
  };
  const bp = bodyG.attributes.position as THREE.BufferAttribute;
  const headBox = new THREE.Box3(), all = new THREE.Box3(); const v = new THREE.Vector3();
  for (let i = 0; i < bp.count; i++) { v.fromBufferAttribute(bp, i); all.expandByPoint(v); if (dominantOf(bodyG, i) === headIdx) headBox.expandByPoint(v); }
  const head: HeadFrame = { center: headBox.getCenter(new THREE.Vector3()), half: headBox.getSize(new THREE.Vector3()).multiplyScalar(0.5), joint: J.head.clone() };
  const groundY = all.min.y, height = all.max.y - all.min.y;

  // Regions and garment parameters per vertex.
  const crotchY = J.thighL.y - 0.07, neckY = J.neck.y;
  const segT = (p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3) => { const ab = b.clone().sub(a); return THREE.MathUtils.clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), -0.5, 1.5); };
  const paramFor = (reg: number, p: THREE.Vector3, left: boolean): number => {
    if (reg === R.TORSO) return (p.y - crotchY) / (neckY - crotchY);
    if (reg === R.ARM) {
      const sh = left ? J.upper_armL : J.upper_armR, el = left ? J.forearmL : J.forearmR, wr = left ? J.handL : J.handR;
      const t1 = segT(p, sh, el); if (t1 < 1) return t1 * 0.5;
      const t2 = segT(p, el, wr); return t2 <= 1 ? 0.5 + t2 * 0.5 : 1.2;
    }
    if (reg === R.LEG) {
      const hp = left ? J.thighL : J.thighR, kn = left ? J.shinL : J.shinR, an = left ? J.footL : J.footR;
      const t1 = segT(p, hp, kn); if (t1 < 1) return t1 * 0.5;
      const t2 = segT(p, kn, an); return t2 <= 1.0 ? 0.5 + t2 * 0.5 : 1.0 + (an.y - p.y) / Math.max(0.01, an.y - groundY) * 0.2 + 0.001;
    }
    return 2;
  };
  const leftSide = (p: THREE.Vector3) => p.x > 0; // the body faces +Z, so its left is +X
  const regionOf = (name: string): number => {
    if (name === 'DEF-head') return R.SKIN;
    if (/^DEF-(upper_arm|forearm|hand|f_|thumb)/.test(name)) return R.ARM;
    if (/^DEF-(thigh|shin|foot|toe)/.test(name)) return R.LEG;
    if (name.startsWith('DEF-neck')) return R.SKIN;
    return R.TORSO;
  };
  const navelY = THREE.MathUtils.lerp(crotchY, neckY, 0.42), spineZ = J.spine001.z;
  const addAttrs = (g: THREE.BufferGeometry, fixed: number | null) => {
    const p = g.attributes.position as THREE.BufferAttribute, n = p.count;
    const region = new Float32Array(n), cloth = new Float32Array(n), hpos = new Float32Array(n * 3), shape = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      v.fromBufferAttribute(p, i);
      const name = boneNames[dominantOf(g, i)] ?? '';
      let reg = fixed ?? regionOf(name);
      // the neck below the jaw belongs to the torso param space (collars), but stays skin unless covered
      if (fixed === null && name.startsWith('DEF-neck')) reg = R.TORSO;
      region[i] = reg;
      cloth[i] = reg === R.SKIN || fixed !== null ? 2 : paramFor(reg, v, leftSide(v));
      const hn = headCoords(head, v);
      hpos[i * 3] = hn.x; hpos[i * 3 + 1] = hn.y; hpos[i * 3 + 2] = hn.z;
      const front = THREE.MathUtils.smoothstep(v.z - spineZ, 0.0, 0.08);
      shape[i * 4] = reg === R.TORSO ? Math.exp(-(((v.y - navelY) / 0.13) ** 2)) * front : 0;
      shape[i * 4 + 1] = reg === R.TORSO || (reg === R.LEG && cloth[i] < 0.3) ? Math.exp(-(((v.y - J.thighL.y) / 0.11) ** 2)) : 0;
      const isHead = name === 'DEF-head' || fixed !== null;
      shape[i * 4 + 2] = isHead ? THREE.MathUtils.clamp((hn.y + 1.1) / 0.5, 0, 1) : 0;
      shape[i * 4 + 3] = isHead ? THREE.MathUtils.smoothstep(-hn.y, -0.05, 0.6) * THREE.MathUtils.smoothstep(hn.z, -0.3, 0.4) : 0;
    }
    g.setAttribute('region', new THREE.BufferAttribute(region, 1));
    g.setAttribute('cloth', new THREE.BufferAttribute(cloth, 1));
    g.setAttribute('hpos', new THREE.BufferAttribute(hpos, 3));
    g.setAttribute('shape', new THREE.BufferAttribute(shape, 4));
  };
  addAttrs(bodyG, null); addAttrs(eyesG, R.EYES); addAttrs(browG, R.BROW);
  smoothedShape(bodyG, i => { const nm = boneNames[dominantOf(bodyG, i)] ?? ''; return nm === 'DEF-head' || /^DEF-(hand|f_|thumb)/.test(nm) ? 0 : 1; });
  for (const g of [eyesG, browG]) { g.setAttribute('sdelta', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3), 3)); g.setAttribute('snormal', g.attributes.normal.clone()); }

  // Scalp surface for hair shells: head triangles of the body, welded.
  const scalp = (() => {
    const idx = bodyG.index!.array; const pos: number[] = []; const keep: number[] = [];
    for (let t = 0; t < idx.length; t += 3) {
      const a = idx[t], b = idx[t + 1], c = idx[t + 2];
      if ([a, b, c].every(k => dominantOf(bodyG, k) === headIdx)) keep.push(a, b, c);
    }
    for (const k of keep) pos.push(bp.getX(k), bp.getY(k), bp.getZ(k));
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const w = mergeVertices(g, 1e-5); w.computeVertexNormals(); return w;
  })();
  const skinSrc = {
    pos: Float32Array.from(bp.array as ArrayLike<number>),
    si: Float32Array.from(bodyG.attributes.skinIndex.array as ArrayLike<number>), sw: Float32Array.from(bodyG.attributes.skinWeight.array as ArrayLike<number>),
  };
  // Non-indexed with per-triangle region consistency, so clothing borders are smooth iso-lines.
  const flat = bodyG.toNonIndexed();
  const fp = flat.attributes.position, fr = flat.attributes.region as THREE.BufferAttribute, fc = flat.attributes.cloth as THREE.BufferAttribute;
  for (let t = 0; t < fp.count; t += 3) {
    const r = [fr.getX(t), fr.getX(t + 1), fr.getX(t + 2)];
    if (r[0] === r[1] && r[1] === r[2]) continue;
    const chosen = r[0] === r[1] || r[0] === r[2] ? r[0] : r[1] === r[2] ? r[1] : Math.max(...r);
    const cx = (fp.getX(t) + fp.getX(t + 1) + fp.getX(t + 2)) / 3;
    for (let k = 0; k < 3; k++) {
      if (r[k] === chosen) continue;
      v.fromBufferAttribute(fp, t + k);
      fr.setX(t + k, chosen); fc.setX(t + k, chosen === R.SKIN ? 2 : paramFor(chosen, v, cx > 0));
    }
  }
  const geo = mergeGeometries([flat, eyesG.toNonIndexed(), browG.toNonIndexed()], false)!;
  geo.computeBoundingSphere();
  const waistT = (J.spine001.y - crotchY) / (neckY - crotchY);

  // Animations retargeted onto this body.
  const clips = retargetClips(ual, scene, bodyM);
  const upper = new Map<string, THREE.AnimationClip>(), lower = new Map<string, THREE.AnimationClip>();
  for (const c of clips.values()) {
    upper.set(c.name, new THREE.AnimationClip(c.name + '_U', c.duration, c.tracks.filter(t => isUpperTrack(t.name))));
    lower.set(c.name, new THREE.AnimationClip(c.name + '_L', c.duration, c.tracks.filter(t => !isUpperTrack(t.name))));
  }
  const loco = ['Walk_Loop', 'Jog_Fwd_Loop', 'Sprint_Loop'].map(n => ({ name: n, duration: clips.get(n)!.duration, speed: measureSpeed(scene, clips.get(n)!) }));
  return { sex, scene, geo, boneNames, clips, upper, lower, loco, height, groundY, waistT, head, J, scalp, skinSrc, extras: new Map(), bodyIdx: bodyG };
}

/**
 * Clothes hide muscle definition: computes a Taubin-smoothed copy of the body (welded across UV seams) and stores
 * the offset to it (`sdelta`) and its normals (`snormal`); the shader blends towards it wherever a garment covers.
 */
function smoothedShape(geo: THREE.BufferGeometry, mobile: (i: number) => number) {
  const pos = geo.attributes.position as THREE.BufferAttribute, n = pos.count;
  const key = (i: number) => `${Math.round(pos.getX(i) * 2e4)},${Math.round(pos.getY(i) * 2e4)},${Math.round(pos.getZ(i) * 2e4)}`;
  const weld = new Int32Array(n); const uniq: number[] = []; const map = new Map<string, number>();
  for (let i = 0; i < n; i++) { const k = key(i); let u = map.get(k); if (u === undefined) { u = uniq.length; map.set(k, u); uniq.push(i); } weld[i] = u; }
  const U = uniq.length, P = new Float32Array(U * 3), M = new Float32Array(U);
  for (let u = 0; u < U; u++) { const i = uniq[u]; P[u * 3] = pos.getX(i); P[u * 3 + 1] = pos.getY(i); P[u * 3 + 2] = pos.getZ(i); M[u] = mobile(i); }
  const idx = geo.index!.array;
  const nbr: Set<number>[] = Array.from({ length: U }, () => new Set<number>());
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
    nbr[a].add(b); nbr[a].add(c); nbr[b].add(a); nbr[b].add(c); nbr[c].add(a); nbr[c].add(b);
  }
  const P0 = P.slice();
  const step = (f: number) => {
    const out = P.slice();
    for (let u = 0; u < U; u++) {
      if (!M[u] || nbr[u].size === 0) continue;
      let x = 0, y = 0, z = 0; for (const v of nbr[u]) { x += P[v * 3]; y += P[v * 3 + 1]; z += P[v * 3 + 2]; }
      const k = nbr[u].size;
      out[u * 3] += (x / k - P[u * 3]) * f * M[u]; out[u * 3 + 1] += (y / k - P[u * 3 + 1]) * f * M[u]; out[u * 3 + 2] += (z / k - P[u * 3 + 2]) * f * M[u];
    }
    P.set(out);
  };
  for (let it = 0; it < 26; it++) { step(0.6); step(-0.63); }
  const N = new Float32Array(U * 3);
  const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
  for (let t = 0; t < idx.length; t += 3) {
    const a = weld[idx[t]], b = weld[idx[t + 1]], c = weld[idx[t + 2]];
    va.fromArray(P, a * 3); vb.fromArray(P, b * 3); vc.fromArray(P, c * 3);
    e1.subVectors(vb, va); e2.subVectors(vc, va); e1.cross(e2);
    for (const w of [a, b, c]) { N[w * 3] += e1.x; N[w * 3 + 1] += e1.y; N[w * 3 + 2] += e1.z; }
  }
  const sd = new Float32Array(n * 3), sn = new Float32Array(n * 3);
  const nor = geo.attributes.normal as THREE.BufferAttribute;
  for (let i = 0; i < n; i++) {
    const u = weld[i]; const l = Math.hypot(N[u * 3], N[u * 3 + 1], N[u * 3 + 2]) || 1;
    // keep only the normal component of the move: garments flatten bumps without sliding the surface sideways
    // (sideways slide would bend the painted cut lines)
    const nx = nor.getX(i), ny = nor.getY(i), nz = nor.getZ(i);
    const d = (P[u * 3] - P0[u * 3]) * nx + (P[u * 3 + 1] - P0[u * 3 + 1]) * ny + (P[u * 3 + 2] - P0[u * 3 + 2]) * nz;
    sd[i * 3] = nx * d; sd[i * 3 + 1] = ny * d; sd[i * 3 + 2] = nz * d;
    for (let k = 0; k < 3; k++) sn[i * 3 + k] = N[u * 3 + k] / l;
  }
  geo.setAttribute('sdelta', new THREE.BufferAttribute(sd, 3));
  geo.setAttribute('snormal', new THREE.BufferAttribute(sn, 3));
}

/**
 * Retargets the UAL clips onto a body whose bones carry the same names. Each target bone gets the source bone's
 * world-space rotation change from rest applied to its own rest orientation; the hips translation is scaled by
 * the ratio of hip heights.
 */
function retargetClips(ual: GLTF, tgtScene: THREE.Object3D, tgtMesh: THREE.SkinnedMesh): Map<string, THREE.AnimationClip> {
  const src = SkeletonUtils.clone(ual.scene);
  src.updateMatrixWorld(true); tgtScene.updateMatrixWorld(true);
  const tgtBones = tgtMesh.skeleton.bones;
  const pairs: { name: string; s: THREE.Object3D; t: THREE.Object3D; restS: THREE.Quaternion; restT: THREE.Quaternion; parentIdx: number; parentRest: THREE.Quaternion }[] = [];
  // parent-first order
  const order: THREE.Object3D[] = [];
  const root = tgtBones.find(b => !(b.parent as THREE.Bone)?.isBone) ?? tgtBones[0];
  root.traverse(o => { if ((o as THREE.Bone).isBone) order.push(o); });
  for (const t of order) {
    const s = src.getObjectByName(t.name);
    if (!s || !t.name.startsWith('DEF-')) continue;
    const pi = pairs.findIndex(p => p.t === t.parent);
    pairs.push({ name: t.name, s, t, restS: s.getWorldQuaternion(new THREE.Quaternion()), restT: t.getWorldQuaternion(new THREE.Quaternion()), parentIdx: pi, parentRest: t.parent!.getWorldQuaternion(new THREE.Quaternion()) });
  }
  const hipsS = src.getObjectByName('DEF-hips')!, hipsT = tgtScene.getObjectByName('DEF-hips')!;
  const hipRatio = hipsT.getWorldPosition(new THREE.Vector3()).y / Math.max(0.1, hipsS.getWorldPosition(new THREE.Vector3()).y);
  const restPosS = hipsS.position.clone(), restPosT = hipsT.position.clone();
  const mixer = new THREE.AnimationMixer(src);
  const out = new Map<string, THREE.AnimationClip>();
  const W = pairs.map(() => new THREE.Quaternion()), q = new THREE.Quaternion(), inv = new THREE.Quaternion();
  for (const clip of ual.animations) {
    const n = Math.max(2, Math.ceil(clip.duration * 30) + 1);
    const times = new Float32Array(n);
    const vals = pairs.map(() => new Float32Array(n * 4));
    const hipPos = new Float32Array(n * 3);
    const action = mixer.clipAction(clip); action.play();
    for (let f = 0; f < n; f++) {
      const t = (clip.duration * f) / (n - 1); times[f] = t;
      mixer.setTime(t); src.updateMatrixWorld(true);
      pairs.forEach((p, i) => {
        p.s.getWorldQuaternion(q);
        // world delta from rest, applied to the target rest
        W[i].copy(q).multiply(inv.copy(p.restS).invert()).multiply(p.restT);
        const parentW = p.parentIdx >= 0 ? W[p.parentIdx] : p.parentRest;
        const local = inv.copy(parentW).invert().multiply(W[i]);
        const o = f * 4, a = vals[i];
        if (f > 0 && a[o - 4] * local.x + a[o - 3] * local.y + a[o - 2] * local.z + a[o - 1] * local.w < 0) local.set(-local.x, -local.y, -local.z, -local.w);
        a[o] = local.x; a[o + 1] = local.y; a[o + 2] = local.z; a[o + 3] = local.w;
      });
      const d = hipsS.position.clone().sub(restPosS).multiplyScalar(hipRatio).add(restPosT);
      hipPos[f * 3] = d.x; hipPos[f * 3 + 1] = d.y; hipPos[f * 3 + 2] = d.z;
    }
    action.stop(); mixer.uncacheAction(clip);
    const tracks: THREE.KeyframeTrack[] = pairs.map((p, i) => new THREE.QuaternionKeyframeTrack(`${p.name}.quaternion`, times, vals[i]));
    tracks.push(new THREE.VectorKeyframeTrack('DEF-hips.position', times, hipPos));
    out.set(clip.name, new THREE.AnimationClip(clip.name, clip.duration, tracks));
  }
  return out;
}

/** Measures how fast the planted foot travels backwards in an in-place locomotion clip (m/s at body scale). */
function measureSpeed(scene0: THREE.Object3D, clip: THREE.AnimationClip): number {
  const scene = SkeletonUtils.clone(scene0);
  const mixer = new THREE.AnimationMixer(scene);
  const action = mixer.clipAction(clip); action.play();
  const footL = scene.getObjectByName('DEF-toeL')!, footR = scene.getObjectByName('DEF-toeR')!;
  const N = 90; const samples: { l: THREE.Vector3; r: THREE.Vector3 }[] = [];
  for (let i = 0; i <= N; i++) {
    mixer.setTime((clip.duration * i) / N); scene.updateMatrixWorld(true);
    samples.push({ l: footL.getWorldPosition(new THREE.Vector3()), r: footR.getWorldPosition(new THREE.Vector3()) });
  }
  const rangeX = Math.max(...samples.map(s => s.l.x)) - Math.min(...samples.map(s => s.l.x));
  const rangeZ = Math.max(...samples.map(s => s.l.z)) - Math.min(...samples.map(s => s.l.z));
  const ax: 'x' | 'z' = rangeX > rangeZ ? 'x' : 'z';
  const dt = clip.duration / N;
  const groups: Record<string, number[]> = { pos: [], neg: [] };
  for (const side of ['l', 'r'] as const) {
    const minY = Math.min(...samples.map(s => s[side].y));
    for (let i = 0; i < N; i++) {
      const a = samples[i][side], b = samples[i + 1][side];
      if (a.y < minY + 0.012 && b.y < minY + 0.012) { const vv = (b[ax] - a[ax]) / dt; (vv >= 0 ? groups.pos : groups.neg).push(Math.abs(vv)); }
    }
  }
  const g = groups.pos.length > groups.neg.length ? groups.pos : groups.neg;
  g.sort((a, b) => a - b);
  mixer.stopAllAction();
  return Math.max(0.6, g.length ? g[Math.floor(g.length / 2)] : 1.4);
}

// ---------------------------------------------------------------------------------------------------------------
// Extras: hair, facial hair, hats and garment pieces
// ---------------------------------------------------------------------------------------------------------------

const noise3 = (x: number, y: number, z: number) =>
  Math.sin(x * 1.7 + Math.sin(y * 2.3 + z * 1.1) * 1.3) * Math.sin(y * 1.9 + Math.sin(z * 2.9 + x * 0.7)) * Math.sin(z * 2.1 + x * 1.3);

interface Part { pos: number[]; nor: number[]; uv: number[]; region: number; bone?: number; weights?: { si: number[]; sw: number[] } }

/** Turns a set of parts into one skinned, region-tagged geometry. Parts without weights are rigid on `bone`. */
function assemble(base: BodyBase, parts: Part[]): THREE.BufferGeometry | null {
  if (!parts.length) return null;
  const geos = parts.map(p => {
    const n = p.pos.length / 3;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(p.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(p.uv, 2));
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    if (p.weights) { si.set(p.weights.si); sw.set(p.weights.sw); } else for (let i = 0; i < n; i++) { si[i * 4] = p.bone ?? 0; sw[i * 4] = 1; }
    g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
    g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
    g.setAttribute('region', new THREE.BufferAttribute(new Float32Array(n).fill(p.region), 1));
    g.setAttribute('cloth', new THREE.BufferAttribute(new Float32Array(n).fill(2), 1));
    const hp = new Float32Array(n * 3), sh = new Float32Array(n * 4); const v = new THREE.Vector3(), h = new THREE.Vector3();
    const headRigid = p.bone === base.boneNames.indexOf('DEF-head') && !p.weights;
    for (let i = 0; i < n; i++) {
      v.set(p.pos[i * 3], p.pos[i * 3 + 1], p.pos[i * 3 + 2]); headCoords(base.head, v, h);
      hp[i * 3] = h.x; hp[i * 3 + 1] = h.y; hp[i * 3 + 2] = h.z;
      if (headRigid) sh[i * 4 + 2] = 1;
    }
    g.setAttribute('hpos', new THREE.BufferAttribute(hp, 3));
    g.setAttribute('shape', new THREE.BufferAttribute(sh, 4));
    g.setAttribute('sdelta', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute('snormal', g.attributes.normal.clone());
    return g;
  });
  const g = mergeGeometries(geos, false)!;
  g.computeBoundingSphere();
  return g;
}

/** Copies skin weights from the nearest body vertex. */
function transferWeights(base: BodyBase, pos: number[]): { si: number[]; sw: number[] } {
  const S = base.skinSrc, n = pos.length / 3, nb = S.pos.length / 3;
  const si: number[] = [], sw: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = pos[i * 3], y = pos[i * 3 + 1], z = pos[i * 3 + 2];
    let best = 0, bd = Infinity;
    for (let j = 0; j < nb; j++) { const dx = S.pos[j * 3] - x, dy = S.pos[j * 3 + 1] - y, dz = S.pos[j * 3 + 2] - z; const d = dx * dx + dy * dy + dz * dz; if (d < bd) { bd = d; best = j; } }
    for (let k = 0; k < 4; k++) { si.push(S.si[best * 4 + k]); sw.push(S.sw[best * 4 + k]); }
  }
  return { si, sw };
}

const hairUV = (base: BodyBase, x: number, y: number, z: number, out: number[], slot: readonly number[] = SLOT.hair1, along = false) => {
  const h = base.head;
  const a = Math.atan2(x - h.center.x, z - h.center.z) / Math.PI; // -1..1 around the head
  const yy = (y - h.center.y) / h.half.y;
  let u = (a * 0.5 + 0.5) * 2.0, vv = yy * 0.35 + 0.5;
  if (along) { const t = u; u = vv; vv = t; }
  u = u - Math.floor(u); vv = Math.min(0.998, Math.max(0.002, vv - Math.floor(vv)));
  out.push(slot[0] + Math.min(0.998, Math.max(0.002, u)) * slot[2], slot[1] + vv * slot[3]);
};

/**
 * Grows a shell from the scalp: every scalp vertex above the hairline is pushed out along its normal by
 * thick(hn) metres (tapering to zero at the hairline so the shell meets the skin without a seam).
 */
function scalpShell(base: BodyBase, line: (x: number, z: number) => number, thick: (hn: THREE.Vector3, p: THREE.Vector3) => number, region: number, margin = 0.1, along = false): Part {
  const g = base.scalp, P = g.attributes.position, N = g.attributes.normal, idx = g.index!.array;
  const hn = new THREE.Vector3(), p = new THREE.Vector3();
  const out = new Float32Array(P.count * 3), inside = new Uint8Array(P.count);
  for (let i = 0; i < P.count; i++) {
    p.fromBufferAttribute(P, i); headCoords(base.head, p, hn);
    const h = line(hn.x, hn.z);
    inside[i] = hn.y > h - 0.02 ? 1 : 0;
    const taper = THREE.MathUtils.smoothstep(hn.y, h - 0.02, h + margin);
    const t = Math.max(0, thick(hn, p)) * taper + 0.0015;
    out[i * 3] = p.x + N.getX(i) * t; out[i * 3 + 1] = p.y + N.getY(i) * t; out[i * 3 + 2] = p.z + N.getZ(i) * t;
  }
  const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.BufferAttribute(out, 3));
  const tri: number[] = [];
  for (let t = 0; t < idx.length; t += 3) if (inside[idx[t]] && inside[idx[t + 1]] && inside[idx[t + 2]]) tri.push(idx[t], idx[t + 1], idx[t + 2]);
  sg.setIndex(tri); sg.computeVertexNormals();
  const flat = sg.toNonIndexed();
  const fp = flat.attributes.position, fn = flat.attributes.normal;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let i = 0; i < fp.count; i++) {
    pos.push(fp.getX(i), fp.getY(i), fp.getZ(i)); nor.push(fn.getX(i), fn.getY(i), fn.getZ(i));
    hairUV(base, fp.getX(i), fp.getY(i), fp.getZ(i), uv, SLOT.hair1, along);
  }
  return { pos, nor, uv, region, bone: base.boneNames.indexOf('DEF-head') };
}

/**
 * A garment band grown from the body surface: every body triangle whose three corners get an offset >= 0 from
 * `offset(region, clothParam, position, normal)` is copied, pushed out along the normal, and keeps the body's skin
 * weights (so it moves exactly with the body).
 */
function bodyBand(base: BodyBase, offset: (reg: number, cloth: number, p: THREE.Vector3, n: THREE.Vector3) => number, region: number): Part {
  const g = base.bodyIdx, P = g.attributes.position, N = g.attributes.normal, RG = g.attributes.region, C = g.attributes.cloth;
  const SI = g.attributes.skinIndex, SW = g.attributes.skinWeight, idx = g.index!.array;
  const off = new Float32Array(P.count).fill(-2);
  const p = new THREE.Vector3(), n = new THREE.Vector3();
  const get = (i: number) => { if (off[i] === -2) { p.fromBufferAttribute(P, i); n.fromBufferAttribute(N, i); off[i] = offset(RG.getX(i), C.getX(i), p, n); } return off[i]; };
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], si: number[] = [], sw: number[] = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t], b = idx[t + 1], c = idx[t + 2];
    if (get(a) < 0 || get(b) < 0 || get(c) < 0) continue;
    for (const i of [a, b, c]) {
      const o = off[i];
      pos.push(P.getX(i) + N.getX(i) * o, P.getY(i) + N.getY(i) * o, P.getZ(i) + N.getZ(i) * o);
      nor.push(N.getX(i), N.getY(i), N.getZ(i)); uv.push(0.25, 0.25);
      for (let k = 0; k < 4; k++) { si.push(SI.getComponent(i, k)); sw.push(SW.getComponent(i, k)); }
    }
  }
  return { pos, nor, uv, region, weights: { si, sw } };
}

/** Converts a THREE geometry placed in head-normalised coordinates into a rigid head part. */
function headPart(base: BodyBase, g: THREE.BufferGeometry, region: number, slot: readonly number[] = SLOT.hair1): Part {
  const f = g.index ? g.toNonIndexed() : g; f.computeVertexNormals();
  const h = base.head, P = f.attributes.position, N = f.attributes.normal;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let i = 0; i < P.count; i++) {
    const x = h.center.x + P.getX(i) * h.half.x, y = h.center.y + P.getY(i) * h.half.y, z = h.center.z + P.getZ(i) * h.half.z;
    pos.push(x, y, z);
    const nx = N.getX(i) / h.half.x, ny = N.getY(i) / h.half.y, nz = N.getZ(i) / h.half.z, l = Math.hypot(nx, ny, nz) || 1;
    nor.push(nx / l, ny / l, nz / l);
    hairUV(base, x, y, z, uv, slot);
  }
  return { pos, nor, uv, region, bone: base.boneNames.indexOf('DEF-head') };
}

/** A tube along a polyline in head-normalised coordinates (ponytails, braids). Radius in metres. */
function tube(points: THREE.Vector3[], radius: (t: number) => number, base: BodyBase, region = R.HAIRP, seg = 8): Part {
  const h = base.head;
  const pts = points.map(p => new THREE.Vector3(h.center.x + p.x * h.half.x, h.center.y + p.y * h.half.y, h.center.z + p.z * h.half.z));
  const curve = new THREE.CatmullRomCurve3(pts);
  const tubeG = new THREE.TubeGeometry(curve, Math.max(6, points.length * 4), 1, seg, false);
  // scale radius along the tube
  const P = tubeG.attributes.position, uvA = tubeG.attributes.uv;
  const steps = Math.max(6, points.length * 4);
  for (let i = 0; i < P.count; i++) {
    const t = uvA.getX(i);
    const c = curve.getPointAt(Math.min(1, Math.round(t * steps) / steps));
    const r = radius(t);
    P.setXYZ(i, c.x + (P.getX(i) - c.x) * r, c.y + (P.getY(i) - c.y) * r, c.z + (P.getZ(i) - c.z) * r);
  }
  tubeG.computeVertexNormals();
  const f = tubeG.toNonIndexed(), FP = f.attributes.position, FN = f.attributes.normal, FU = f.attributes.uv;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let i = 0; i < FP.count; i++) {
    pos.push(FP.getX(i), FP.getY(i), FP.getZ(i)); nor.push(FN.getX(i), FN.getY(i), FN.getZ(i));
    uv.push(SLOT.hair1[0] + (0.1 + FU.getY(i) * 0.3) * SLOT.hair1[2], SLOT.hair1[1] + (0.05 + FU.getX(i) * 0.9) * SLOT.hair1[3]);
  }
  return { pos, nor, uv, region, bone: base.boneNames.indexOf('DEF-head') };
}

/** Rebinds a Quaternius rigged hair mesh onto this body (rigid on the head; translated by the head joint offset). */
function ubcHair(base: BodyBase, assets: HumanAssets, key: string, region: number = R.HAIR, filter?: (x: number, y: number, z: number) => boolean): Part {
  const src = assets.hair.get(key)!;
  const g = src.geo.toNonIndexed();
  const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
  const d = base.head.joint.clone().sub(src.headJoint);
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let t = 0; t < P.count; t += 3) {
    if (filter) { let ok = true; for (let k = 0; k < 3; k++) if (!filter(P.getX(t + k) + d.x, P.getY(t + k) + d.y, P.getZ(t + k) + d.z)) ok = false; if (!ok) continue; }
    for (let k = t; k < t + 3; k++) {
      pos.push(P.getX(k) + d.x, P.getY(k) + d.y, P.getZ(k) + d.z); nor.push(N.getX(k), N.getY(k), N.getZ(k));
      const s = src.slot; uv.push(s[0] + THREE.MathUtils.clamp(U.getX(k), 0.002, 0.998) * s[2], s[1] + THREE.MathUtils.clamp(U.getY(k), 0.002, 0.998) * s[3]);
    }
  }
  return { pos, nor, uv, region, bone: base.boneNames.indexOf('DEF-head') };
}

/** A garment piece in body space, skinned by nearest-body-vertex weights (or explicit weights). */
function garment(base: BodyBase, g: THREE.BufferGeometry, region: number, weights?: (p: THREE.Vector3) => { si: number[]; sw: number[] }): Part {
  const f = g.index ? g.toNonIndexed() : g; f.computeVertexNormals();
  const P = f.attributes.position, N = f.attributes.normal;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [];
  for (let i = 0; i < P.count; i++) { pos.push(P.getX(i), P.getY(i), P.getZ(i)); nor.push(N.getX(i), N.getY(i), N.getZ(i)); uv.push(0.25, 0.25); }
  let w: { si: number[]; sw: number[] };
  if (weights) { w = { si: [], sw: [] }; const v = new THREE.Vector3(); for (let i = 0; i < P.count; i++) { const r = weights(v.fromBufferAttribute(P, i)); w.si.push(...r.si); w.sw.push(...r.sw); } }
  else w = transferWeights(base, pos);
  return { pos, nor, uv, region, weights: w };
}

const HAIR_SHELL: Partial<Record<HairStyle, { thick: (hn: THREE.Vector3, p: THREE.Vector3) => number; along?: boolean; line?: (x: number, z: number) => number }>> = {
  crew: { thick: hn => 0.006 + 0.012 * THREE.MathUtils.smoothstep(hn.y, 0.2, 0.75) },
  fade: { thick: hn => 0.003 + 0.014 * THREE.MathUtils.smoothstep(hn.y, 0.45, 0.8), line: (x, z) => Math.max(hairline(x, z), 0.42) },
  short: { thick: hn => 0.01 + 0.016 * THREE.MathUtils.smoothstep(hn.y, 0.1, 0.8) + 0.004 * noise3(hn.x * 9, hn.y * 9, hn.z * 9) },
  pixie: { thick: hn => 0.012 + 0.016 * THREE.MathUtils.smoothstep(hn.y, 0.0, 0.8) + 0.006 * Math.max(0, hn.z) + 0.004 * noise3(hn.x * 8, hn.y * 8, hn.z * 8) },
  slick: { thick: hn => 0.011 + 0.01 * THREE.MathUtils.smoothstep(hn.y, 0.2, 0.9) + 0.006 * THREE.MathUtils.smoothstep(hn.z, 0.3, 0.9), along: true },
  curly: { thick: hn => 0.026 + 0.012 * THREE.MathUtils.smoothstep(hn.y, 0.0, 0.8) + 0.008 * noise3(hn.x * 11, hn.y * 11, hn.z * 11) },
  afro: { thick: hn => 0.05 + 0.035 * THREE.MathUtils.smoothstep(hn.y, -0.3, 0.7) + 0.008 * noise3(hn.x * 7, hn.y * 7, hn.z * 7), line: (x, z) => hairline(x, z) - 0.05 },
  cornrows: { thick: hn => 0.003 + 0.0035 * Math.abs(Math.sin(hn.x * 22)), along: true },
  braids: { thick: hn => 0.004 + 0.004 * Math.abs(Math.sin(hn.x * 18)), along: true },
  ponytail: { thick: () => 0.01, along: true },
  bun: { thick: () => 0.01, along: true },
  bob: { thick: hn => 0.016 + 0.01 * THREE.MathUtils.smoothstep(hn.y, 0.1, 0.8) },
};

/** Builds (and caches) the extras geometry for a look. */
export function extrasGeometries(base: BodyBase, assets: HumanAssets, look: FullLook): THREE.BufferGeometry[] {
  const out: THREE.BufferGeometry[] = [];
  const ubc = ['long', 'buns', 'parted', 'buzz'].includes(look.hairStyle);
  // The scanned (UBC) hair/beard meshes are ~100k vertices (7 MB) each: they are cached on their own so every person with
  // that hair shares one copy, instead of one per hair x hat x garment combination.
  for (const [kind, key] of [['hair', ubc ? `hair|${look.hairStyle}` : ''], ['facial', look.facial !== 'none' ? `facial|${look.facial}` : ''], ['misc', `${ubc ? 'ubc' : look.hairStyle}|${look.hatStyle}|${look.topStyle}|${look.bottomStyle}`]] as const) {
    if (!key) continue;
    const g = extrasPart(base, assets, look, kind, key); if (g) out.push(g);
  }
  return out;
}
function extrasPart(base: BodyBase, assets: HumanAssets, look: FullLook, kind: 'hair' | 'facial' | 'misc', key: string): THREE.BufferGeometry | null {
  const hat = look.hatStyle, hairS = look.hairStyle;
  if (base.extras.has(key)) return base.extras.get(key)!;
  const parts: Part[] = [];
  const hairOnly = kind === 'hair', facialOnly = kind === 'facial', misc = kind === 'misc';
  const hairThick = (hn: THREE.Vector3, p: THREE.Vector3) => HAIR_SHELL[hairS]?.thick(hn, p) ?? 0.012;
  // ---- hair
  const shell = HAIR_SHELL[hairS];
  if (misc && shell && !(hat !== 'none' && ['crew', 'fade', 'cornrows'].includes(hairS))) parts.push(scalpShell(base, shell.line ?? hairline, shell.thick, R.HAIRP, 0.1, shell.along));
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  if (hairOnly || misc) switch (hairS) {
    case 'long': if (hairOnly) parts.push(ubcHair(base, assets, 'long')); break;
    case 'buns': if (hairOnly) parts.push(ubcHair(base, assets, 'buns')); break;
    case 'parted': if (hairOnly) parts.push(ubcHair(base, assets, 'parted')); break;
    case 'buzz': if (hairOnly) parts.push(ubcHair(base, assets, base.sex === 'f' ? 'buzzF' : 'buzz')); break;
    case 'ponytail': {
      if (!misc) break;
      parts.push(tube([V(0, 0.35, -1.0), V(0, 0.18, -1.22), V(0, -0.3, -1.25), V(0, -0.9, -1.15), V(0, -1.5, -1.05)], t => 0.026 * (1 - t * 0.55) + 0.01 * Math.sin(t * 3.14), base));
      parts.push(headPart(base, new THREE.TorusGeometry(0.19, 0.06, 6, 12).rotateX(0.5).translate(0, 0.3, -1.03), R.HAT));
      break;
    }
    case 'bun': if (misc) parts.push(headPart(base, new THREE.SphereGeometry(0.38, 14, 10).scale(1, 0.85, 0.85).translate(0, 0.72, -0.95), R.HAIRP)); break;
    case 'braids': {
      if (!misc) break;
      for (let i = 0; i < 14; i++) {
        const a = -2.2 + (i / 13) * 4.4; const sx = Math.sin(a) * 1.02, sz = -Math.cos(a) * 1.02;
        const len = 1.9 + (i % 3) * 0.15;
        parts.push(tube([V(sx, 0.05, sz - 0.05), V(sx * 1.08, -0.4, sz * 1.06 - 0.08), V(sx * 1.05, -1.0, sz - 0.2), V(sx * 0.95, -len, sz - 0.3)], t => 0.011 * (1 - t * 0.3), base, R.HAIRP, 5));
      }
      break;
    }
    case 'bob': {
      if (!misc) break;
      // a curtain of hair from the hairline down to the jaw, open at the face
      const ring = new THREE.CylinderGeometry(1.1, 1.18, 1.0, 22, 3, true, Math.PI * 0.32, Math.PI * 1.36);
      ring.translate(0, -0.22, -0.06);
      parts.push(headPart(base, ring, R.HAIRP));
      break;
    }
  }
  // ---- facial hair
  if (!facialOnly) { /* no facial hair here */ } else if (look.facial === 'beard') parts.push(ubcHair(base, assets, 'beard'));
  else if (look.facial === 'goatee') parts.push(ubcHair(base, assets, 'beard', R.HAIR, (x, y) => Math.abs(x - base.head.center.x) < 0.028 && y < base.head.joint.y + 0.07));
  else if (look.facial === 'moustache') parts.push(ubcHair(base, assets, 'beard', R.HAIR, (x, y, z) => Math.abs(x - base.head.center.x) < 0.035 && y > base.head.joint.y + 0.045 && z > base.head.center.z + 0.06));
  // ---- hats
  if (!misc) { /* hats are in the misc part */ } else if (hat === 'cap' || hat === 'police') {
    const capLine = (_x: number, z: number) => THREE.MathUtils.lerp(0.02, 0.36, THREE.MathUtils.smoothstep(z, 0.1, 0.75));
    parts.push(scalpShell(base, capLine, (hn, p) => hairThick(hn, p) * 0.6 + 0.009, R.HAT, 0.04));
    const brim = new THREE.CylinderGeometry(0.9, 0.9, 0.04, 18, 1, false, -Math.PI / 2, Math.PI).scale(0.95, 1, 0.75).rotateX(-0.12).translate(0, 0.3, 0.72);
    parts.push(headPart(base, brim, hat === 'police' ? R.DETAIL : R.HAT));
    if (hat === 'police') parts.push(headPart(base, new THREE.CylinderGeometry(1.16, 1.05, 0.38, 22).translate(0, 0.86, -0.04), R.HAT));
  } else if (hat === 'beanie') {
    parts.push(scalpShell(base, (_x, z) => THREE.MathUtils.lerp(-0.1, 0.4, THREE.MathUtils.smoothstep(z, 0.1, 0.75)), (hn, p) => hairThick(hn, p) * 0.5 + 0.012 + 0.006 * THREE.MathUtils.smoothstep(hn.y, 0.6, 1), R.HAT, 0.03));
    parts.push(headPart(base, new THREE.TorusGeometry(1.04, 0.1, 6, 26).rotateX(Math.PI / 2 - 0.42).translate(0, 0.22, -0.02), R.HAT));
  }
  // ---- garments
  const gl = (misc ? look : { topStyle: '', bottomStyle: '' }) as { topStyle: string; bottomStyle: string };
  const J = base.J;
  const T = (p: number) => p; // torso param helper (0 crotch .. 1 neck base)
  const sm = THREE.MathUtils.smoothstep;
  if (gl.topStyle === 'hoodie') {
    // hood: a soft roll of fabric lying around the back of the neck and over the upper back
    parts.push(bodyBand(base, (reg, c, p, n) => reg === R.TORSO && n.z < 0.35 && c > T(0.86) && c < 1.1
      ? 0.04 * sm(c, 0.86, 0.95) * (1 - sm(c, 1.02, 1.1)) * sm(-n.z, -0.35, 0.2) + 0.02 : -1, R.CTOP));
  }
  if (['shirt', 'polo', 'uniform', 'jacket', 'suit', 'blouse'].includes(gl.topStyle)) {
    const big = gl.topStyle === 'jacket' || gl.topStyle === 'suit';
    parts.push(bodyBand(base, (reg, c, p, n) => {
      if (reg !== R.TORSO || c < 0.985 || c > (big ? 1.11 : 1.08)) return -1;
      if (n.z > 0.6 && Math.abs(p.x) < (big ? 0.035 : 0.018)) return -1; // open at the throat
      return (big ? 0.03 : 0.017) * (1 - sm(c, big ? 1.07 : 1.05, big ? 1.11 : 1.08) * 0.5);
    }, R.CTOP));
  }
  if (gl.topStyle === 'hoodie' || gl.topStyle === 'jacket') {
    // ribbed cuffs and waistband
    parts.push(bodyBand(base, (reg, c) => reg === R.ARM && c > 0.93 && c < 0.985 ? 0.026 : -1, R.CTOP));
  }
  if (gl.bottomStyle === 'skirt' || gl.topStyle === 'dress') {
    const hipY = J.thighL.y + 0.02, kneeY = J.shinL.y + (gl.topStyle === 'dress' ? 0.02 : 0.07);
    const hipR = Math.abs(J.thighL.x) + 0.115, len = hipY - kneeY;
    const sk = new THREE.CylinderGeometry(hipR, hipR + 0.11, len, 24, 4, true);
    sk.scale(1, 1, 0.82).translate(0, (hipY + kneeY) / 2, J.hips.z - 0.005);
    const hipsI = base.boneNames.indexOf('DEF-hips'), tl = base.boneNames.indexOf('DEF-thighL'), tr = base.boneNames.indexOf('DEF-thighR');
    parts.push(garment(base, sk, gl.topStyle === 'dress' ? R.CTOP : R.CBOT, p => {
      const down = THREE.MathUtils.clamp((hipY - p.y) / len, 0, 1) * 0.75;
      const side = THREE.MathUtils.clamp(p.x / (hipR * 0.8), -1, 1) * 0.5 + 0.5; // 1 = left
      return { si: [hipsI, tl, tr, 0], sw: [1 - down, down * side, down * (1 - side), 0] };
    }));
  }
  const g = assemble(base, parts);
  if (g) freeAfterUpload(g); // extras are never read on the CPU again (frustumCulled is off): keep only the GPU copy
  base.extras.set(key, g);
  return g;
}
