/**
 * Person material: realistic skin from the body texture tinted to any skin tone, painted hair/stubble on the scalp
 * and face, and procedurally painted clothes (cut lines, seams, denim/knit grain, stripes/plaid/prints, lapels,
 * pockets, badges) chosen per person through uniforms, plus garment thickness, belly/hips and head shape in the
 * vertex shader. One program is shared by everyone; each person owns only uniform values.
 */
import * as THREE from 'three';
import { SKIN_PARS, SKIN_LIGHT_PARS, SKIN_GLSL } from './shade/skin';
import { FACE_PARS, EYES_GLSL } from './shade/face';
import { TOP_PARS, TOP_GLSL } from './shade/top';
import { BOTTOM_PARS, BOTTOM_GLSL, SHOE_GLSL, SOLE_GLSL } from './shade/bottom';
import { patchHair } from './shade/hair';
import type { FullLook } from './look';
import type { BodyBase } from './humanAssets';

export const TOP_IDS: Record<FullLook['topStyle'], number> = { tee: 0, tank: 1, longsleeve: 2, hoodie: 3, jacket: 4, suit: 5, shirt: 6, polo: 7, dress: 8, uniform: 9, blouse: 10 };
const BOTTOM_IDS: Record<FullLook['bottomStyle'], number> = { jeans: 0, trousers: 1, shorts: 2, skirt: 3, sweats: 4 };
const PATTERN_IDS: Record<FullLook['pattern'], number> = { plain: 0, stripes: 1, plaid: 2, graphic: 3, twotone: 4, pinstripe: 5, camo: 6, houndstooth: 7 };
const HAIR_PAINT: Partial<Record<FullLook['hairStyle'], number>> = { buzz: 2, fade: 3, bald: 0, cornrows: 5, braids: 5, crew: 2, long: 6, bob: 6, buns: 6, parted: 6, pixie: 6 };
const FACIAL: Record<FullLook['facial'], number> = { none: 0, stubble: 1, beard: 2, moustache: 3, goatee: 4 };
const SHOE_IDS: Record<FullLook['shoeStyle'], number> = { sneakers: 0, boots: 1, formal: 2 };


export interface PersonUniforms {
  uC: { value: THREE.Color[] };
  uTop: { value: THREE.Vector4 }; uBottom: { value: THREE.Vector4 }; uThick: { value: THREE.Vector4 };
  uPat: { value: THREE.Vector4 }; uShape: { value: THREE.Vector4 }; uHeadJoint: { value: THREE.Vector3 };
  uBody: { value: THREE.Vector4 }; uNeck: { value: THREE.Vector4 }; uFlash: { value: number };
}

export function personMaterial(base: BodyBase, map: THREE.Texture, normalMap: THREE.Texture): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, normalMap, roughness: 0.8, metalness: 0 });
  m.normalScale.set(0.8, 0.8);
  const u: PersonUniforms = {
    uC: { value: Array.from({ length: 12 }, () => new THREE.Color()) },
    uTop: { value: new THREE.Vector4() }, uBottom: { value: new THREE.Vector4() }, uThick: { value: new THREE.Vector4() },
    uPat: { value: new THREE.Vector4() }, uShape: { value: new THREE.Vector4(0, 0, 1, 0) }, uHeadJoint: { value: base.head.joint.clone() },
    uBody: { value: new THREE.Vector4(base.groundY, base.J.spine003.y, base.J.neck.y, base.J.spine001.z) }, uNeck: { value: new THREE.Vector4(base.J.neck.x, base.J.neck.z, 0.085, 0) }, uFlash: { value: 0 },
  };
  m.userData.uniforms = u;
  m.onBeforeCompile = sh => patchPerson(sh, u, false);
  m.customProgramCacheKey = () => 'person-ubc-1';
  return m;
}

/**
 * The hair shells' material for a person: the same program family and the same uniform values as the person's body
 * material (hair colour, head scale, hit flash), with the HAIR shader variant (see hairShells.ts). Not shadow casting.
 */
export function hairMaterialFor(person: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
  const cached = person.userData.hairMat as THREE.MeshStandardMaterial | undefined; if (cached) return cached;
  const u = person.userData.uniforms as PersonUniforms;
  const m = new THREE.MeshStandardMaterial({ map: person.map, roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
  m.userData.uniforms = u;
  m.onBeforeCompile = sh => patchPerson(sh, u, true);
  m.customProgramCacheKey = () => 'person-hair-1';
  person.userData.hairMat = m;
  return m;
}

function patchPerson(sh: THREE.WebGLProgramParametersWithUniforms, u: PersonUniforms, hair: boolean) {
    Object.assign(sh.uniforms, u);
    if (hair) { patchHair(sh); return; }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
attribute float region; attribute float cloth; attribute vec3 hpos; attribute vec4 shape; attribute vec3 sdelta; attribute vec3 snormal;
uniform vec4 uTop; uniform vec4 uBottom; uniform vec4 uThick; uniform vec4 uShape; uniform vec3 uHeadJoint; uniform vec4 uNeck;
flat varying float vRegion; varying float vCloth; varying vec3 vHn; varying vec3 vBind; varying vec3 vBN;`)
      .replace('#include <beginnormal_vertex>', `
int ri = int(region + 0.5);
// garment coverage (0..1, soft at the cut lines) and thickness
float covTop = 0.0, covBot = 0.0, covShoe = 0.0;
if (ri == 1) {
  float nd = length((position.xz - uNeck.xy) * vec2(1.0, 1.2));
  covTop = smoothstep(uTop.y - 0.06, uTop.y, cloth) * max(1.0 - smoothstep(uTop.z, uTop.z + 0.05, cloth), smoothstep(uNeck.z, uNeck.z + 0.03, nd));
  covBot = 1.0 - smoothstep(uBottom.w, uBottom.w + 0.05, cloth);
} else if (ri == 2) { covTop = (1.0 - smoothstep(uTop.x, uTop.x + 0.05, cloth)) * (1.0 - step(1.05, cloth)); }
else if (ri == 3) { covBot = 1.0 - smoothstep(uBottom.x, uBottom.x + 0.05, cloth); covShoe = smoothstep(uBottom.z - 0.05, uBottom.z, cloth); }
float cov = max(max(covTop, covBot), covShoe);
float th = max(covTop * uThick.x, covBot * uThick.y * (ri == 3 ? 1.0 + 0.9 * smoothstep(0.45, 0.95, cloth) : 1.0));
th = max(th, covShoe * uThick.z);
vec3 objectNormal = normalize(mix(normal, snormal, cov));`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
vRegion = region; vCloth = cloth; vHn = hpos; vBind = position; vBN = objectNormal;
transformed += sdelta * cov + objectNormal * th;
transformed += normal * (shape.x * uShape.x + shape.y * uShape.y);
transformed.x *= 1.0 + shape.w * uShape.w;
transformed = mix(transformed, uHeadJoint + (transformed - uHeadJoint) * uShape.z, shape.z);`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform vec3 uC[12]; uniform vec4 uTop; uniform vec4 uBottom; uniform vec4 uPat; uniform vec4 uBody; uniform vec4 uNeck; uniform float uFlash;
flat varying float vRegion; varying float vCloth; varying vec3 vHn; varying vec3 vBind; varying vec3 vBN;
float hsh(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float vnoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(hsh(i), hsh(i + vec3(1,0,0)), f.x), mix(hsh(i + vec3(0,1,0)), hsh(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(hsh(i + vec3(0,0,1)), hsh(i + vec3(1,0,1)), f.x), mix(hsh(i + vec3(0,1,1)), hsh(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float hairlineF(float x, float z) {
  float front = smoothstep(0.15, 0.8, z); float h = -0.42 + 1.0 * front;
  float ear = smoothstep(0.55, 0.8, abs(x)) * (1.0 - smoothstep(0.3, 0.5, abs(z - 0.05)));
  return max(h, -0.42 + ear * 0.5);
}
${SKIN_PARS}
${FACE_PARS}
${TOP_PARS}
${BOTTOM_PARS}`)
      .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
${SKIN_LIGHT_PARS}`)
      .replace('#include <map_fragment>', `
vec4 tx = texture2D(map, vMapUv);
int ri = int(vRegion + 0.5);
float lum = dot(tx.rgb, vec3(0.299, 0.587, 0.114));
vec3 bn = normalize(vBN);
float front = smoothstep(0.1, 0.5, bn.z);
float grain = vnoise(vBind * 420.0);
float topId = uTop.w;
int part = 0;
if (ri == 1) {
  float nd = length((vBind.xz - uNeck.xy) * vec2(1.0, 1.2));
  float vdeep = (topId > 0.5 && topId < 1.5) || (topId > 7.5 && topId < 8.5) || topId > 9.5 ? smoothstep(0.3, 0.9, bn.z) * 0.06 : 0.0;
  if (vCloth > uTop.z - vdeep && nd < uNeck.z + vdeep * 0.5) part = 0;
  else if (vCloth >= uTop.y) part = 1;
  else if (vCloth < uBottom.w) part = (vCloth > uBottom.w - 0.035 && uBottom.y < 2.5) ? 8 : 3;
} else if (ri == 2) { part = (vCloth < uTop.x && vCloth < 1.05) ? 1 : 0; }
else if (ri == 3) { part = vCloth > uBottom.z ? 4 : (vCloth < uBottom.x ? 3 : 0); if (part == 4 && vBind.y < uBody.x + 0.028) part = 5; }
else if (ri == 4 || ri == 5 || ri == 8) part = 6;
else if (ri == 6) part = 1; else if (ri == 7) part = 3; else if (ri == 9) part = 9; else if (ri == 10) part = 7; else if (ri == 11) part = 8; else if (ri == 12) part = 5;
vec3 col = tx.rgb; float rough = 0.85; float flatN = 1.0;
float bumpH = 0.0; // optional micro height (m) a chunk may set (pores, weave, seams); applied as a bump after the normal map
if (part == 0) {
${SKIN_GLSL}} else if (part == 1) {
${TOP_GLSL}} else if (part == 3) {
${BOTTOM_GLSL}} else if (part == 4) {
${SHOE_GLSL}} else if (part == 5) {${SOLE_GLSL}}
else if (part == 6) { col = uC[6] * (0.38 + 2.4 * lum); rough = 0.5; flatN = ri == 8 ? 0.0 : 0.0; }
else if (part == 7) { col = uC[7] * (0.9 + 0.15 * vnoise(vBind * 300.0)); rough = 0.85; }
else if (part == 8) { col = uC[8]; rough = 0.45; }
else if (part == 9) {${EYES_GLSL}}
col = mix(col, vec3(1.0, 0.8, 0.75), uFlash);
diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rough;')
      .replace('#include <normal_fragment_maps>', `if (flatN < 0.5) {
#include <normal_fragment_maps>
}
{ // micro bump from bumpH (three's perturbNormalArb, screen-space derivatives)
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  vec2 dh = vec2(dFdx(bumpH), dFdy(bumpH));
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  if (abs(det) > 1e-12 && dot(dh, dh) > 0.0) normal = normalize(abs(det) * normal - sign(det) * (dh.x * r1 + dh.y * r2));
}`);
}

/** HAIR variant: layered strand shells with a strand-aligned highlight (see hairShells.ts for the attributes). */

/** Hex (sRGB) to a linear working-space colour (THREE.Color already converts with colour management on). */
const lin = (c: string) => new THREE.Color(c);

/** Writes a look into a person material's uniforms. */
export function applyLookUniforms(m: THREE.MeshStandardMaterial, base: BodyBase, l: FullLook) {
  const u = m.userData.uniforms as PersonUniforms;
  const C = u.uC.value;
  C[0].copy(lin(l.skin));
  C[1].copy(lin(l.top)); C[2].copy(lin(l.accent)); C[3].copy(lin(l.bottom)); C[4].copy(lin(l.shoes));
  C[5].copy(lin(l.shoeStyle === 'sneakers' ? '#efede6' : l.shoeStyle === 'boots' ? '#2a211b' : '#151515'));
  C[6].copy(lin(l.hair)); C[7].copy(lin(l.hat)); C[8].copy(lin(l.detail)); C[9].copy(lin(l.eyes));
  const top = l.topStyle;
  const sleeve = l.sleeves === 'tank' || top === 'tank' ? -1 : l.sleeves === 'short' && !['hoodie', 'jacket', 'suit', 'longsleeve'].includes(top) ? (top === 'polo' || top === 'uniform' ? 0.33 : 0.28) : 0.985;
  const waist = base.waistT;
  const hem = top === 'jacket' ? waist - 0.17 : top === 'suit' ? waist - 0.24 : top === 'hoodie' ? waist - 0.16 : top === 'dress' ? -0.2 : ['shirt', 'uniform'].includes(top) ? waist - 0.02 : waist - 0.1;
  const neckline = top === 'tank' ? 0.9 : top === 'dress' || top === 'blouse' ? 0.93 : top === 'suit' || top === 'jacket' ? 1.03 : ['shirt', 'polo', 'uniform', 'hoodie'].includes(top) ? 1.0 : 0.96;
  u.uTop.value.set(sleeve, hem, neckline, TOP_IDS[top]);
  u.uNeck.value.z = top === 'tank' ? 0.1 : top === 'dress' || top === 'blouse' ? 0.095 : ['shirt', 'polo', 'uniform', 'jacket', 'suit', 'hoodie'].includes(top) ? 0.07 : 0.082;
  const b = l.bottomStyle;
  const legEnd = b === 'skirt' || top === 'dress' ? 0.2 : b === 'shorts' ? 0.43 : 0.99;
  const shoeTop = l.shoeStyle === 'boots' ? 0.8 : 0.995;
  u.uBottom.value.set(legEnd, BOTTOM_IDS[b], shoeTop, top === 'dress' ? 0.05 : waist + 0.04);
  if (top === 'dress') C[3].copy(C[1]);
  const tThick = top === 'jacket' ? 0.022 : top === 'hoodie' ? 0.02 : top === 'suit' ? 0.017 : top === 'tank' || top === 'dress' ? 0.005 : 0.011;
  u.uThick.value.set(tThick, b === 'sweats' ? 0.02 : b === 'shorts' ? 0.016 : b === 'skirt' ? 0.008 : 0.015, l.shoeStyle === 'boots' ? 0.016 : 0.013, 0);
  const shell = ['short', 'crew', 'slick', 'curly', 'afro', 'pixie', 'bob', 'ponytail', 'bun', 'long', 'buns', 'parted'].includes(l.hairStyle);
  u.uPat.value.set(PATTERN_IDS[l.pattern], HAIR_PAINT[l.hairStyle] ?? (shell ? 1 : 0), FACIAL[l.facial], SHOE_IDS[l.shoeStyle]);
  u.uShape.value.set(l.weight * 0.045, (l.sex === 'f' ? 0.012 : 0) + l.weight * 0.012, l.headScale, l.jaw * 0.06);
}
