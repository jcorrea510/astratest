/**
 * Person material: realistic skin from the body texture tinted to any skin tone, painted hair/stubble on the scalp
 * and face, and procedurally painted clothes (cut lines, seams, denim/knit grain, stripes/plaid/prints, lapels,
 * pockets, badges) chosen per person through uniforms, plus garment thickness, belly/hips and head shape in the
 * vertex shader. One program is shared by everyone; each person owns only uniform values.
 */
import * as THREE from 'three';
import type { FullLook } from './look';
import type { BodyBase } from './humanAssets';

export const TOP_IDS: Record<FullLook['topStyle'], number> = { tee: 0, tank: 1, longsleeve: 2, hoodie: 3, jacket: 4, suit: 5, shirt: 6, polo: 7, dress: 8, uniform: 9, blouse: 10 };
const BOTTOM_IDS: Record<FullLook['bottomStyle'], number> = { jeans: 0, trousers: 1, shorts: 2, skirt: 3, sweats: 4 };
const PATTERN_IDS: Record<FullLook['pattern'], number> = { plain: 0, stripes: 1, plaid: 2, graphic: 3, twotone: 4 };
const HAIR_PAINT: Partial<Record<FullLook['hairStyle'], number>> = { buzz: 2, fade: 3, bald: 0, cornrows: 5, braids: 5, crew: 2 };
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
  const m = new THREE.MeshStandardMaterial({ roughness: 0.72, metalness: 0, side: THREE.DoubleSide });
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
  float front = smoothstep(0.15, 0.8, z); float h = -0.42 + 0.84 * front;
  float ear = smoothstep(0.55, 0.8, abs(x)) * (1.0 - smoothstep(0.3, 0.5, abs(z - 0.05)));
  return max(h, -0.42 + ear * 0.5);
}`)
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
if (part == 0) {
  // keep the texture's local detail (lips, shading, pores) but take the tone from the wanted skin colour
  vec3 ratio = clamp(tx.rgb / vec3(0.397, 0.153, 0.072), vec3(0.05), vec3(3.0));
  float lr = dot(ratio, vec3(0.3, 0.5, 0.2));
  col = uC[0] * (0.25 + 0.85 * lr) * mix(vec3(1.0), ratio / max(lr, 0.05), 0.28); rough = 0.6; flatN = 0.0;
  if (ri == 0 && vHn.y > -1.5) {
    vec3 hc = uC[6];
    float h = hairlineF(vHn.x, vHn.z);
    float scalp = smoothstep(h - 0.04, h + 0.05, vHn.y);
    float mode = uPat.y;
    float n = vnoise(vHn * 60.0);
    float a = 0.0;
    if (mode > 0.5 && mode < 1.5) a = scalp * 0.95;
    else if (mode > 1.5 && mode < 2.5) a = scalp * (0.72 + 0.2 * n);
    else if (mode > 2.5 && mode < 3.5) a = scalp * mix(0.25 + 0.15 * n, 0.85 + 0.1 * n, smoothstep(h + 0.05, h + 0.55, vHn.y));
    else if (mode > 4.5) a = scalp * (0.55 + 0.45 * abs(sin(vHn.x * 22.0))) ;
    else if (mode > 3.5) a = scalp * 0.0;
    col = mix(col, hc * (0.75 + 0.5 * n), a);
    // facial hair paint (lower face, below the cheekbones; lips kept clear)
    float fm = uPat.z;
    if (fm > 0.5) {
      float jaw = smoothstep(0.05, -0.2, vHn.y) * smoothstep(-0.05, 0.35, vHn.z) * smoothstep(-1.05, -0.8, vHn.y);
      float lips = smoothstep(0.42, 0.28, abs(vHn.x)) * smoothstep(-0.78, -0.66, vHn.y) * smoothstep(-0.3, -0.42, vHn.y) * smoothstep(0.7, 0.85, vHn.z);
      float mous = smoothstep(0.42, 0.3, abs(vHn.x)) * smoothstep(-0.48, -0.42, vHn.y) * smoothstep(-0.22, -0.3, vHn.y) * smoothstep(0.7, 0.85, vHn.z);
      float chin = smoothstep(0.3, 0.18, abs(vHn.x)) * smoothstep(-0.6, -0.75, vHn.y) * smoothstep(0.3, 0.6, vHn.z);
      float b = 0.0;
      if (fm < 1.5) b = jaw * 0.32 * (0.7 + 0.6 * n);
      else if (fm < 2.5) b = jaw * 0.75;
      else if (fm < 3.5) b = max(mous * 0.9, jaw * 0.15);
      else b = max(max(mous, chin) * 0.85, jaw * 0.12);
      b *= 1.0 - lips;
      col = mix(col, hc * 0.8, clamp(b, 0.0, 1.0));
    }
  }
} else if (part == 1) {
  col = uC[1];
  float pat = uPat.x;
  if (pat > 0.5 && pat < 1.5) col = mix(uC[1], uC[2], step(0.62, fract(vBind.y * 16.0)));
  else if (pat > 1.5 && pat < 2.5) { float a = step(0.5, fract(vBind.x * 11.0 + 0.25)), b = step(0.5, fract(vBind.y * 11.0)); col = mix(uC[1], uC[2], (a + b) * 0.3); col = mix(col, uC[8], step(0.93, fract(vBind.x * 22.0)) * 0.25 + step(0.93, fract(vBind.y * 22.0)) * 0.25); }
  else if (pat > 2.5 && pat < 3.5 && ri == 1) {
    vec2 c = vec2(vBind.x, vBind.y - (uBody.y + 0.02));
    float r = length(c / vec2(1.0, 1.15));
    float print = front * step(r, 0.07) * (step(0.045, r) + step(r, 0.028));
    col = mix(col, uC[2], print);
  } else if (pat > 3.5 && ri == 2) col = uC[2];
  // garment construction details
  if (ri == 1) {
    float cx = abs(vBind.x);
    if (topId > 2.5 && topId < 3.5) { // hoodie: kangaroo pocket + drawstrings
      float pocket = front * step(cx, 0.11) * step(0.17, vCloth) * step(vCloth, 0.34);
      col *= 1.0 - pocket * 0.12;
      col = mix(col, uC[2], front * step(abs(cx - 0.035), 0.004) * step(0.72, vCloth) * step(vCloth, 0.9));
    } else if (topId > 3.5 && topId < 4.5) { // open jacket over a tee
      float open = front * step(cx, 0.045 + 0.03 * smoothstep(0.75, 0.98, vCloth));
      col = mix(col, uC[2], open);
      col *= 1.0 - front * smoothstep(0.006, 0.0, abs(cx - 0.045 - 0.03 * smoothstep(0.75, 0.98, vCloth))) * 0.4;
      col *= 1.0 - smoothstep(0.012, 0.0, abs(vCloth - uTop.y - 0.025)) * 0.25; // ribbed hem
    } else if (topId > 4.5 && topId < 5.5) { // suit: lapels, shirt, tie, buttons
      float v = (uBody.z - vBind.y) * 0.38 + 0.012;
      float shirt = front * step(cx, v) * step(0.55, vCloth);
      col = mix(col, uC[2], shirt);
      col = mix(col, uC[8], shirt * step(cx, 0.011 + 0.006 * smoothstep(0.9, 0.62, vCloth)));
      col *= 1.0 - front * smoothstep(0.005, 0.0, abs(cx - v)) * 0.5 * step(0.55, vCloth);
      col = mix(col, uC[8] * 0.6, front * step(length(vec2(cx, vCloth - 0.42)), 0.008));
    } else if ((topId > 5.5 && topId < 7.5) || topId > 8.5) { // shirt / polo / uniform / blouse: placket and buttons
      float pl = front * step(cx, 0.012) * step(topId > 6.5 && topId < 7.5 ? 0.78 : 0.0, vCloth);
      col *= 1.0 - pl * 0.1;
      col = mix(col, vec3(0.85), front * step(cx, 0.004) * step(0.5, fract(vCloth * 14.0)) * step(0.47, fract(vCloth * 14.0 + 0.5)) * pl * 0.0);
      float btn = front * step(length(vec2(cx, (fract(vCloth * 9.0) - 0.5) * 0.11)), 0.0045) * step(topId > 6.5 && topId < 7.5 ? 0.8 : 0.1, vCloth);
      col = mix(col, uC[2] * 0.9, btn);
      if (topId > 8.5 && topId < 9.5) { // police uniform: badge on the left chest, name bar on the right
        float badge = front * step(length(vec2(vBind.x - 0.09, vBind.y - uBody.y - 0.05) * vec2(1.0, 0.85)), 0.022);
        col = mix(col, uC[2], badge);
        col = mix(col, vec3(0.9), front * step(abs(vBind.x + 0.09), 0.03) * step(abs(vBind.y - uBody.y - 0.04), 0.006));
      }
    }
  }
  col *= 0.94 + 0.1 * grain;
  rough = topId > 4.5 && topId < 5.5 ? 0.7 : 0.9;
} else if (part == 3) {
  col = uC[3];
  float bs = uBottom.y;
  if (bs < 0.5) { // denim: twill, worn thighs, outer seams
    float tw = sin((vBind.y * 1.0 + vBind.x * 0.6 + vBind.z * 0.6) * 1700.0) * 0.5 + 0.5;
    col *= 0.86 + 0.2 * tw * (0.6 + 0.4 * grain);
    if (ri == 3) col *= 1.0 + 0.16 * front * smoothstep(0.45, 0.15, vCloth) * (0.6 + 0.4 * vnoise(vBind * 60.0));
    col = mix(col, uC[3] * 0.55 + vec3(0.05, 0.035, 0.0), smoothstep(0.985, 1.0, abs(bn.x)) * 0.6);
  } else if (bs > 3.5) { // sweats: knit and side stripe
    col *= 0.92 + 0.12 * grain;
    if (ri == 3) col = mix(col, uC[2], smoothstep(0.93, 0.96, abs(bn.x)));
  } else col *= 0.93 + 0.1 * grain;
  rough = 0.9;
} else if (part == 4) {
  col = uC[4]; float s = uPat.w;
  rough = s > 1.5 ? 0.3 : s > 0.5 ? 0.55 : 0.7;
  if (s < 0.5) col = mix(col, uC[2], smoothstep(0.55, 0.6, abs(bn.x)) * step(vBind.y, uBody.x + 0.06) * step(uBody.x + 0.04, vBind.y) * 0.8);
} else if (part == 5) { col = uC[5]; rough = 0.8; }
else if (part == 6) { col = uC[6] * (0.38 + 2.4 * lum); rough = 0.5; flatN = ri == 8 ? 0.0 : 0.0; }
else if (part == 7) { col = uC[7] * (0.9 + 0.15 * vnoise(vBind * 300.0)); rough = 0.85; }
else if (part == 8) { col = uC[8]; rough = 0.45; }
else if (part == 9) { col = tx.rgb; rough = 0.12; flatN = 0.0; }
col = mix(col, vec3(1.0, 0.8, 0.75), uFlash);
diffuseColor.rgb *= col;`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rough;')
      .replace('#include <normal_fragment_maps>', 'if (flatN < 0.5) {\n#include <normal_fragment_maps>\n}');
}

/** HAIR variant: layered strand shells with a strand-aligned highlight (see hairShells.ts for the attributes). */
function patchHair(sh: THREE.WebGLProgramParametersWithUniforms) {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', `#include <common>
attribute vec4 hs; attribute vec4 hd;
uniform vec4 uShape; uniform vec3 uHeadJoint;
varying vec4 vHs; varying vec4 vHd; varying vec3 vHairT;`)
    .replace('#include <skinnormal_vertex>', `#include <skinnormal_vertex>
vec3 hT = hd.xyz;
#ifdef USE_SKINNING
hT = (skinMatrix * vec4(hT, 0.0)).xyz;
#endif
vHairT = normalize((modelViewMatrix * vec4(hT, 0.0)).xyz);`)
    .replace('#include <begin_vertex>', `#include <begin_vertex>
vHs = hs; vHd = hd;
transformed = uHeadJoint + (transformed - uHeadJoint) * uShape.z;`);
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', `#include <common>
uniform vec3 uC[12]; uniform float uFlash;
varying vec4 vHs; varying vec4 vHd; varying vec3 vHairT;
float hairSpec = 1.0, hairTilt = 0.0;
float h11(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
    .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
// Hair lighting: wrapped diffuse plus two Kajiya-Kay lobes along the strand (primary white, secondary tinted, shifted).
void RE_Direct_Hair(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  float nl = dot(geometryNormal, directLight.direction);
  reflectedLight.directDiffuse += clamp((nl + 0.35) / 1.35, 0.0, 1.0) * directLight.color * BRDF_Lambert(material.diffuseColor);
  vec3 T = normalize(vHairT), H = normalize(directLight.direction + geometryViewDir);
  float d1 = dot(normalize(T - geometryNormal * 0.1), H), d2 = dot(normalize(T + geometryNormal * 0.15), H);
  float s1 = pow(max(0.0, 1.0 - d1 * d1), 90.0), s2 = pow(max(0.0, 1.0 - d2 * d2), 18.0);
  vec3 tint = material.diffuseColor / max(max(material.diffuseColor.r, material.diffuseColor.g), max(material.diffuseColor.b, 0.03));
  reflectedLight.directSpecular += directLight.color * smoothstep(-0.1, 0.35, nl) * hairSpec * (0.09 * s1 + 0.06 * s2 * tint);
}
#undef RE_Direct
#define RE_Direct RE_Direct_Hair`)
    .replace('#include <map_fragment>', `
float lay = vHs.z, dens = vHs.w, u = vHs.x, v = vHs.y;
float sc = floor(vHd.w / 8.0 + 0.01), fl = vHd.w - sc * 8.0;
bool solidLod = fl > 3.5;
float mode = solidLod ? fl - 4.0 : fl;
float li = floor(lay * 40.0 + 0.5);
float a = 0.0, b = 1.0, r1 = 0.5, farK = 0.0;
if (mode < 0.5) {
  // locks: round bundles of ~8 strands lying along the surface, waving together; their height varies along their length,
  // so the layers carve real relief (lower layers show between locks, darker)
  float lu = u / 8.0, l0 = mod(floor(lu), 90.0);
  float lw = lu + sin(v * 48.0 + h11(l0) * 6.283) * 0.3 + sin(v * 15.0 + l0 * 1.3) * 0.45;
  float lk = mod(floor(lw), 90.0), x = fract(lw) * 2.0 - 1.0;
  float segL = 0.028 + 0.03 * h11(lk + 3.1), sv = v / segL + h11(lk + 9.7), sg = floor(sv);
  float hg = mix(mix(0.5, 1.0, h21(vec2(lk, sg))), mix(0.5, 1.0, h21(vec2(lk, sg + 1.0))), smoothstep(0.0, 1.0, fract(sv)));
  float top = hg * mix(0.3, 1.0, sqrt(max(0.0, 1.0 - x * x))) * dens;
  farK = solidLod ? 1.0 : smoothstep(0.22, 0.55, fwidth(lw));
  float fu = max(fwidth(u), 1e-4), sf = 1.0 - smoothstep(0.35, 0.9, fu);
  // single strands: fine albedo striation, a few strays above the locks
  float uu = u + (lw - lu) * 8.0, cell = mod(floor(uu), 720.0);
  r1 = h21(vec2(cell, lk)); float r3 = h21(vec2(cell + 41.3, sg));
  float stray = sf * step(r3, 0.05 * dens) * step(lay, top + 0.3) * (1.0 - smoothstep(0.18 - fu, 0.18 + fu, abs(fract(uu) - 0.5)));
  a = max(step(lay, top), stray);
  if (lay < 0.01) a = step(0.5 + 0.4 * (h11(lk + sg) - 0.5), dens);   // opaque core with ragged tips
  b = mix(1.0, mix(0.74, 1.2, r1), sf) * mix(0.85, 1.12, h11(lk + 21.0));
  hairTilt = x * 0.75;
} else if (mode < 1.5) {
  // coils standing out of the surface (curls, afro, short fuzz); cell size from the style
  float cs = 1.0 + sc * 0.5;
  vec2 g = vec2(u, v / 0.00087) / cs;
  vec2 c = floor(g); r1 = h21(c); float r2 = h21(c + 7.1), r3 = h21(c + 3.3);
  vec2 pc = floor(g / 5.0);
  float puff = mix(0.62, 1.0, h21(pc)) ;
  float len = mix(0.55, 1.0, r2) * puff * dens;
  float ph = lay * 14.0 + r1 * 6.283;
  vec2 o = fract(g) - 0.5 - 0.17 * vec2(cos(ph), sin(ph));
  float fg = max(fwidth(g.x), 1e-4);
  farK = solidLod ? 1.0 : smoothstep(0.3, 0.8, fg);
  float w = 0.36 * (1.0 - 0.5 * lay / max(len, 0.05));
  a = lay < 0.3 * dens ? 1.0 : step(lay, len) * (1.0 - smoothstep(w - fg, w + fg, length(o)));
  b = mix(0.72, 1.15, r3) * mix(0.9, 1.08, h21(pc + 1.7));
  hairTilt = o.x * 1.4;
} else {
  // cornrows: raised braided rows running along v
  float ru = u / 16.0, rc = fract(ru) - 0.5;
  float prof = sqrt(max(0.0, 1.0 - rc * rc * 5.0));
  a = step(lay, prof * dens);
  float zz = fract(v / 0.0055 + abs(rc) * 1.8 + floor(ru) * 0.5);
  b = 0.55 + 0.6 * smoothstep(0.0, 0.6, zz) * (1.0 - smoothstep(0.85, 1.0, zz));
  farK = solidLod ? 1.0 : smoothstep(0.25, 0.6, fwidth(ru));
  hairTilt = rc * 2.2;
}
a = mix(a, lay < 0.01 ? step(0.5, dens) : step(lay, 0.65 * dens), farK);
if (a < 0.5) discard;
b = mix(b, 1.0, farK * 0.7); hairTilt *= 1.0 - farK;
float ao = lay < 0.01 ? 0.4 : mix(0.38, 1.0, smoothstep(0.0, 0.95, lay));
hairSpec = mix(0.6, 1.3, r1) * mix(0.5, 1.0, ao) * (mode > 0.5 && mode < 1.5 ? 0.45 : 1.0);
vec3 col = uC[6] * b * ao;
col = mix(col, vec3(1.0, 0.8, 0.75), uFlash);
diffuseColor.rgb *= col;`)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = 0.72;')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(normal + cross(normalize(vHairT), normal) * hairTilt);`);
}

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
