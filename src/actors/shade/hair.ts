/**
 * Person shader, HAIR variant: layered strand shells and scanned hair (see actors/hairShells.ts, hairScan.ts).
 */
import type * as THREE from 'three';

export function patchHair(sh: THREE.WebGLProgramParametersWithUniforms) {
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
float hairSpec = 1.0, hairTilt = 0.0, hairLight = 0.3, hairSpark = 0.5, hairDepth = 1.0;
float h11(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
float h21(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }`)
    .replace('#include <lights_physical_pars_fragment>', `#include <lights_physical_pars_fragment>
// Hair lighting: wrapped diffuse, backlit transmission (light hair glows at the rim) and two Kajiya-Kay lobes along the strand:
// primary white and sharp, shifted towards the root; secondary tinted, broader, shifted towards the tip. Both sparkle per strand.
void RE_Direct_Hair(const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  float nl = dot(geometryNormal, directLight.direction);
  reflectedLight.directDiffuse += clamp((nl + 0.42) / 1.42, 0.0, 1.0) * directLight.color * BRDF_Lambert(material.diffuseColor);
  float back = pow(clamp(dot(-directLight.direction, geometryViewDir) * 0.5 + 0.5, 0.0, 1.0), 3.6);
  reflectedLight.directDiffuse += directLight.color * material.diffuseColor * (back * hairLight * hairDepth * 0.46 * (1.0 - 0.45 * clamp(nl, 0.0, 1.0)));
  vec3 T = normalize(vHairT), H = normalize(directLight.direction + geometryViewDir);
  float d1 = dot(normalize(T - geometryNormal * 0.1), H), d2 = dot(normalize(T + geometryNormal * 0.22), H);
  float s1 = pow(max(0.0, 1.0 - d1 * d1), 130.0), s2 = pow(max(0.0, 1.0 - d2 * d2), 18.0);
  float d3 = dot(normalize(T + geometryNormal * 0.44), H), s3 = pow(max(0.0, 1.0 - d3 * d3), 5.0);
  vec3 tint = material.diffuseColor / max(max(material.diffuseColor.r, material.diffuseColor.g), max(material.diffuseColor.b, 0.03));
  tint = mix(tint, vec3(1.0, 0.92, 0.84), 0.28);
  float spark = mix(0.55, 1.45, hairSpark);
  reflectedLight.directSpecular += directLight.color * smoothstep(-0.12, 0.34, nl) * hairSpec * (0.085 * s1 * spark + 0.065 * s2 * tint * (0.7 + 0.55 * hairSpark) + 0.018 * s3 * tint);
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
  float lenK = sc > 0.5 ? sc * 0.25 : 1.0; // short cuts: shorter, choppier locks
  float segL = (0.028 + 0.03 * h11(lk + 3.1)) * lenK, sv = v / segL + h11(lk + 9.7), sg = floor(sv);
  float hg = mix(mix(0.5, 1.0, h21(vec2(lk, sg))), mix(0.5, 1.0, h21(vec2(lk, sg + 1.0))), smoothstep(0.0, 1.0, fract(sv)));
  float top = hg * mix(0.3, 1.0, sqrt(max(0.0, 1.0 - x * x))) * dens;
  farK = solidLod ? 1.0 : smoothstep(0.22, 0.55, fwidth(lw));
  float fu = max(fwidth(u), 1e-4), sf = 1.0 - smoothstep(0.35, 0.9, fu);
  // single strands: fine albedo striation, a few strays above the locks
  float uu = u + (lw - lu) * 8.0, cell = mod(floor(uu), 720.0);
  float sw0 = 0.08 + 0.12 * h11(cell * 1.7 + lk); // strand width varies: some flyaways are hair-fine, some coarse
  r1 = h21(vec2(cell, lk)); float r3 = h21(vec2(cell + 41.3, sg));
  float stray = sf * step(r3, 0.09 * dens) * step(lay, top + 0.4) * (1.0 - smoothstep(sw0 - fu, sw0 + fu, abs(fract(uu) - 0.5)));
  a = max(step(lay, top), stray);
  a *= step((lay - 0.6) * 1.6, h21(vec2(cell, lk) + 3.7)); // outer layers: strands of different lengths, a fuzzy silhouette
  a *= step(h21(vec2(lk, sg) + 5.3), dens * 1.6 - 0.2); // locks thin out towards the hairline: soft, ragged edge
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
  a *= step(h21(c + 11.7), dens * 1.7 - 0.3); // sparse towards the hairline
  b = mix(0.72, 1.15, r3) * mix(0.9, 1.08, h21(pc + 1.7));
  hairTilt = o.x * 1.4;
} else if (mode > 2.5) {
  // scanned mesh: the sculpt's baked shading (as the body material drew it) plus fine strands across the locks
  float lum = 0.3;
#ifdef USE_MAP
  vec3 txc = texture2D(map, vMapUv).rgb; lum = dot(txc, vec3(0.299, 0.587, 0.114));
#endif
  float fu = max(fwidth(u), 1e-4), sf = 1.0 - smoothstep(0.35, 0.9, fu);
  float uu = u + sin(v * 90.0 + floor(u / 6.0)) * 0.6;
  r1 = h11(floor(uu)); float r2 = h11(floor(uu / 5.0) + 17.0);
  a = 1.0;
  b = (0.38 + 2.4 * lum) * mix(1.0, mix(0.8, 1.14, r1) * mix(0.9, 1.07, r2), sf);
  hairTilt = (fract(uu) - 0.5) * 0.5 * sf;
} else {
  // cornrows: raised braided rows running along v
  float ru = u / 16.0, rc = fract(ru) - 0.5;
  float prof = sqrt(max(0.0, 1.0 - rc * rc * 5.0));
  a = step(lay, prof * max(dens, 0.6)) * step(0.55, dens); // rows end cleanly at the hairline
  float zz = fract(v / 0.0055 + abs(rc) * 1.8 + floor(ru) * 0.5);
  b = 0.55 + 0.6 * smoothstep(0.0, 0.6, zz) * (1.0 - smoothstep(0.85, 1.0, zz));
  farK = solidLod ? 1.0 : smoothstep(0.25, 0.6, fwidth(ru));
  hairTilt = rc * 2.2;
}
a = mix(a, lay < 0.01 ? step(0.5, dens) : step(lay, 0.65 * dens), farK);
if (a < 0.5) discard;
b = mix(b, 1.0, farK * 0.7); hairTilt *= 1.0 - farK;
float depthK = smoothstep(0.0, 0.95, lay / max(dens, 0.3));
float ao = lay < 0.01 ? 0.35 : mix(0.3, 1.0, depthK); // depth relative to the local thickness: self-shadow between layers, no dark rims
hairSpec = mix(0.6, 1.3, r1) * mix(0.4, 1.0, ao) * (mode > 0.5 && mode < 1.5 ? 0.45 : mode < 0.5 && sc > 0.5 ? 0.55 : 1.0);
hairSpec *= 1.0 - 0.6 * farK; // solid (far) layers: no crisp band where the strands would have broken the highlight up
hairDepth = ao;
hairSpark = mix(h21(vec2(floor(u), floor(v / 0.004)) + r1 * 13.1), 0.5, farK);
hairSpec *= mix(0.65 + 0.7 * h21(floor(vec2(u / 18.0, v / 0.025)) + 5.5), 1.0, farK); // highlight breaks up into bands along the head, not one helmet-wide gloss
vec3 hc = uC[6];
float hl = dot(hc, vec3(0.299, 0.587, 0.114)), hmx = max(max(hc.r, hc.g), hc.b), hsat = (hmx - min(min(hc.r, hc.g), hc.b)) / max(hmx, 1e-3);
hairLight = smoothstep(0.04, 0.3, hl);
float pk = h11(r1 * 91.7 + 3.0);
// per-strand melanin: some strands warmer (pheomelanin), some ashier; outer strand ends lightened (sun, age)
hc *= mix(vec3(0.93, 0.98, 1.05), vec3(1.1, 1.0, 0.88), r1);
// root-to-tip: roots darker and richer, tips lighter, plus a slow patchy variation so the head is not one flat tone
hc *= mix(0.8, 1.08, smoothstep(0.0, 1.0, lay)) * mix(0.93, 1.07, h21(floor(vec2(u / 14.0, v / 0.03))));
hc = mix(hc, hc * vec3(1.3, 1.12, 0.9), smoothstep(0.55, 1.0, lay) * step(0.5, pk) * 0.6 * (1.0 - farK));
// grey hair (low saturation, not dark): a mix of white and darker strands
float greyK = (1.0 - smoothstep(0.08, 0.3, hsat)) * smoothstep(0.1, 0.22, hl);
hc = mix(hc, vec3(hl) * mix(0.55, 1.5, step(0.5, pk)), greyK * 0.45 * (1.0 - farK));
vec3 col = hc * b * ao;
col = mix(col, vec3(1.0, 0.8, 0.75), uFlash);
diffuseColor.rgb *= col;`)
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = 0.72;')
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
normal = normalize(normal + cross(normalize(vHairT), normal) * hairTilt);`);
}
