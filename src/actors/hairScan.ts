/**
 * Scanned hair: the Quaternius/UBC sculpted hair and beard meshes (the "super real" ones) rebound rigidly to the head and
 * recoloured by the hair material. Extra cuts are variants of the same meshes (bob = long hair taken up to the jaw,
 * ponytail = long hair gathered at the nape, pixie = the side part mirrored; goatee / moustache = parts of the beard), so
 * every scanned style shares the sculpted look. Each vertex also gets the comb direction (hd) and a strand coordinate
 * (hs.x) so the hair shader can add strand striation and a strand-aligned highlight (mode 3, see humanMaterial.ts).
 */
import * as THREE from 'three';
import { headCoords, type BodyBase } from './humanAssets';
import type { FacialHair, HairStyle } from './look';

export interface ScanSrc { geo: THREE.BufferGeometry; headJoint: THREE.Vector3; slot: readonly number[] }
export const SCAN_FILES = { long: 'Hair_Long', buns: 'Hair_Buns', parted: 'Hair_SimpleParted', beard: 'Hair_Beard' } as const;
export type ScanKey = keyof typeof SCAN_FILES;

/** Hairstyles drawn with a scanned mesh, and which one. */
export const SCAN_HAIR: Partial<Record<HairStyle, ScanKey>> = { long: 'long', bob: 'long', ponytail: 'long', buns: 'buns', parted: 'parted', pixie: 'parted' };
export const SCAN_FACIAL: Partial<Record<FacialHair, ScanKey>> = { beard: 'beard', goatee: 'beard', moustache: 'beard' };

const sstep = THREE.MathUtils.smoothstep;
/** Hair shader mode for scanned meshes (hd.w). */
const MODE_SCAN = 3;

/**
 * Builds the rigid head geometry for a scanned style. `hatOn` drops the parts a cap/beanie would cover.
 * Attributes: position, normal, uv (atlas), hs (u strand coord, v, layer = 1, density = 1), hd (comb dir, mode), skin.
 */
export function scanGeometry(base: BodyBase, src: ScanSrc, style: HairStyle | FacialHair, hatOn: boolean): THREE.BufferGeometry | null {
  const g0 = src.geo.toNonIndexed();
  const P = g0.attributes.position, N = g0.attributes.normal, U = g0.attributes.uv;
  const d = base.head.joint.clone().sub(src.headJoint), h = base.head;
  const n = P.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), keep = new Uint8Array(n);
  const p = new THREE.Vector3(), q = new THREE.Vector3(), hn = new THREE.Vector3(), nn = new THREE.Vector3();
  const mirror = style === 'pixie';
  for (let i = 0; i < n; i++) {
    p.fromBufferAttribute(P, i).add(d); nn.fromBufferAttribute(N, i);
    if (mirror) { p.x = 2 * h.center.x - p.x; nn.x = -nn.x; }
    headCoords(h, p, hn);
    keep[i] = keepVertex(style, hn) ? 1 : 0;
    if (style === 'bob') bob(hn);
    else if (style === 'ponytail') gather(hn);
    if (hatOn && hn.y > capLineScan(hn.z) - 0.02) keep[i] = 0;
    p.set(h.center.x + hn.x * h.half.x, h.center.y + hn.y * h.half.y, h.center.z + hn.z * h.half.z);
    pos.set([p.x, p.y, p.z], i * 3);
    nor.set([nn.x, nn.y, nn.z], i * 3);
  }
  // keep / drop whole triangles
  const tris: number[] = [];
  for (let t = 0; t < n; t += 3) if (keep[t] && keep[t + 1] && keep[t + 2]) tris.push(t);
  if (!tris.length) return null;
  const m = tris.length * 3;
  const oPos = new Float32Array(m * 3), oNor = new Float32Array(m * 3), oUv = new Float32Array(m * 2), hs = new Float32Array(m * 4), hd = new Float32Array(m * 4);
  const flip = mirror;
  let o = 0;
  for (const t of tris) for (let k = 0; k < 3; k++) {
    const i = t + (flip ? [0, 2, 1][k] : k);
    oPos.set(pos.subarray(i * 3, i * 3 + 3), o * 3); oNor.set(nor.subarray(i * 3, i * 3 + 3), o * 3);
    const s = src.slot; oUv[o * 2] = s[0] + THREE.MathUtils.clamp(U.getX(i), 0.002, 0.998) * s[2]; oUv[o * 2 + 1] = s[1] + THREE.MathUtils.clamp(U.getY(i), 0.002, 0.998) * s[3];
    o++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(oPos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(oNor, 3));
  const NN = g.attributes.normal;
  // comb direction: away from a pole on the head (the parting / crown), in the surface plane; strand coordinate = angle round the pole
  const facial = style === 'beard' || style === 'goatee' || style === 'moustache';
  const pole = facial ? new THREE.Vector3(0, 1, 0) : style === 'parted' || style === 'pixie' ? new THREE.Vector3(mirror ? -0.45 : 0.45, 0.85, 0.25).normalize() : new THREE.Vector3(0, 0.85, 0.5).normalize();
  const C0 = new THREE.Vector3(0, 0.1, -0.05);
  const e1 = new THREE.Vector3(1, 0, 0).cross(pole).normalize(), e2 = pole.clone().cross(e1);
  const dir = new THREE.Vector3();
  for (let i = 0; i < m; i++) {
    p.fromArray(oPos, i * 3); headCoords(h, p, hn); nn.fromBufferAttribute(NN, i);
    q.copy(hn).sub(C0); const len = q.length() || 1; q.multiplyScalar(1 / len);
    // d/dtheta on the sphere away from the pole, then into body space (head coords are scaled per axis)
    dir.copy(q).multiplyScalar(q.dot(pole)).sub(pole);
    if (facial || hn.y < -0.6) dir.lerp(new THREE.Vector3(0, -1, 0), facial ? 0.7 : sstep(-hn.y, 0.6, 1.2));
    dir.multiply(h.half); dir.addScaledVector(nn, -dir.dot(nn));
    if (dir.lengthSq() < 1e-10) dir.set(0, -1, 0).addScaledVector(nn, -nn.y);
    dir.normalize();
    hd[i * 4] = dir.x; hd[i * 4 + 1] = dir.y; hd[i * 4 + 2] = dir.z; hd[i * 4 + 3] = MODE_SCAN;
    const ang = Math.atan2(q.dot(e2), q.dot(e1));
    hs[i * 4] = (ang / (Math.PI * 2) + 0.5) * (facial ? 700 : 420); hs[i * 4 + 1] = Math.acos(THREE.MathUtils.clamp(q.dot(pole), -1, 1)) * 0.1; hs[i * 4 + 2] = 1; hs[i * 4 + 3] = 1;
  }
  // the strand coordinate wraps at the back of the pole: keep each triangle's u continuous
  for (let t = 0; t < m; t += 3) {
    const a = hs[t * 4], b = hs[(t + 1) * 4], c = hs[(t + 2) * 4], P2 = facial ? 700 : 420;
    const mx = Math.max(a, b, c), mn = Math.min(a, b, c);
    if (mx - mn > P2 / 2) for (let k = 0; k < 3; k++) if (hs[(t + k) * 4] < P2 / 2) hs[(t + k) * 4] += P2;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(oUv, 2));
  g.setAttribute('hs', new THREE.BufferAttribute(hs, 4));
  g.setAttribute('hd', new THREE.BufferAttribute(hd, 4));
  const si = new Uint16Array(m * 4), sw = new Float32Array(m * 4), hb = base.boneNames.indexOf('DEF-head');
  for (let i = 0; i < m; i++) { si[i * 4] = hb; sw[i * 4] = 1; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  g.computeBoundingSphere(); g.computeBoundingBox();
  return g;
}

/** Cap line used to trim scanned hair under a hat (matches hairShells.capLine). */
const capLineScan = (z: number) => THREE.MathUtils.lerp(0.02, 0.36, sstep(z, 0.1, 0.75));

/** Bob: the long hair taken up to the jaw (a little longer at the front), strand tips kept (soft clamp, no clipping). */
export function bob(hn: THREE.Vector3) {
  const cut = THREE.MathUtils.lerp(-0.72, -0.95, sstep(hn.z, -0.6, 0.4));
  if (hn.y < cut) { const L = 0.12, e = cut - hn.y; hn.y = cut - L * (1 - Math.exp(-e / L)); }
}

/** Which vertices of the source mesh a style uses (head coordinates of the source position). */
export function keepVertex(style: HairStyle | FacialHair, hn: THREE.Vector3) {
  if (style === 'goatee') return Math.abs(hn.x) < 0.31 && hn.y < -0.2;
  if (style === 'moustache') return Math.abs(hn.x) < 0.55 && hn.y > -0.64 && hn.z > 0.4;
  if (style === 'ponytail') return hn.z < -0.3 && hn.y < 0.05; // the tail: the long hair's back below the tie (the top is a shell)
  return true;
}

/** Ponytail: the back of the long hair (below the tie) gathered into a tail hanging from the tie at the back centre. */
export function gather(hn: THREE.Vector3) {
  const t = Math.max(0, 0.05 - hn.y); // distance below the tie in the source
  hn.x *= 0.15 + 0.13 * sstep(t, 0.1, 1.8);
  hn.z = Math.min(hn.z, -1.12) - 0.08 - 0.12 * sstep(t, 0.0, 0.6);
  hn.y = TIE_Y - t * 1.15;
}
/** Height of the ponytail tie (head coordinates). */
export const TIE_Y = -0.05;
