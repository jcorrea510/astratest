/**
 * Shared gun materials (one set for every weapon model; NPCs holding guns share them). Per-gun files only pick a
 * material name; they never make their own materials.
 *
 * Look: every surface gets a procedural *solid* (gun-space, metres) micro detail patched into MeshStandardMaterial via
 * onBeforeCompile: no textures, no UVs (the parts' UVs are unreliable), no per-frame work, one program per material.
 *  steel   - parkerized/nitride: fine grain, streaks along the bore axis, edge wear to bright metal
 *  polymer - fine stipple (roughness + bump), faint sheen
 *  wood    - walnut: grain along the stock, growth rings, pores, oiled (low roughness)
 *  tan/olive - cerakote: matte micro texture, edge wear to bare steel
 *  chrome  - hazy micro scratches; lens - coated blue-green/violet reflection; glass - fresnel opacity
 *  cloth   - woven web/sling; brass - tarnish patches, polished edges
 */
import * as THREE from 'three';

export type Mat = 'steel' | 'polymer' | 'wood' | 'tan' | 'chrome' | 'lens' | 'bore' | 'olive' | 'glass' | 'cloth' | 'brass';

/** Shared GLSL ES 3.00 helpers (fragment). gmP = gun-space position (m), gmN = gun-space normal. */
const FRAG_PARS = /* glsl */ `
varying vec3 gmP;
varying vec3 gmN;
float gmHash(vec3 p) {
  p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}
float gmNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(gmHash(i), gmHash(i + vec3(1.0, 0.0, 0.0)), f.x),
                 mix(gmHash(i + vec3(0.0, 1.0, 0.0)), gmHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
             mix(mix(gmHash(i + vec3(0.0, 0.0, 1.0)), gmHash(i + vec3(1.0, 0.0, 1.0)), f.x),
                 mix(gmHash(i + vec3(0.0, 1.0, 1.0)), gmHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
`;

const VERT_PARS = /* glsl */ `
varying vec3 gmP;
varying vec3 gmN;
`;

/** Declared right after colour_fragment so every kind can read them. Kinds then adjust diffuseColor / gm* outputs. */
const FRAG_COMMON = /* glsl */ `
float gmRough = 0.0;
float gmMetal = 0.0;
float gmBump = 0.0;
vec3 gmUnitN = normalize(gmN);
float gmEdge = smoothstep(0.04, 0.22, length(fwidth(gmUnitN)));
float gmFine = gmNoise(gmP * 900.0);
float gmMid = gmNoise(gmP * 160.0);
`;

const KIND: Partial<Record<Mat, string>> = {
  // GM_STEEL
  steel: /* glsl */ `
float gmStreak = gmNoise(vec3(gmP.x * 1400.0, gmP.y * 1400.0, gmP.z * 45.0));
float gmWear = gmEdge * smoothstep(0.3, 0.75, gmMid);
diffuseColor.rgb *= 0.8 + 0.32 * gmStreak * (0.6 + 0.4 * gmFine);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.5, 0.51, 0.53), gmWear * 0.75);
gmRough = (gmStreak - 0.5) * 0.2 + (gmFine - 0.5) * 0.08 - gmWear * 0.14;
gmBump = (gmStreak * 0.6 + gmFine * 0.4) * 0.00004;
`,
  // GM_POLYMER
  polymer: /* glsl */ `
float gmStip = smoothstep(0.45, 0.7, gmNoise(gmP * 1500.0));
float gmStip2 = gmNoise(gmP * 2600.0);
diffuseColor.rgb *= 0.86 + 0.2 * gmMid + 0.1 * gmStip;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.1, 0.1, 0.11), gmEdge * 0.4);
gmRough = (gmStip - 0.5) * 0.18 + (gmStip2 - 0.5) * 0.06;
gmBump = (gmStip * 0.7 + gmStip2 * 0.3) * 0.00012;
`,
  // GM_WOOD
  wood: /* glsl */ `
vec3 gmWp = gmP + vec3(0.0, 0.0, 0.0);
float gmWarp = gmNoise(gmP * 35.0) * 0.012;
float gmRing = sin((gmWp.x + gmWp.y * 0.6 + gmWarp) * 420.0 + gmNoise(vec3(gmWp.x * 60.0, gmWp.y * 60.0, gmWp.z * 4.0)) * 5.0);
float gmGrain = gmNoise(vec3(gmWp.x * 900.0, gmWp.y * 900.0, gmWp.z * 22.0));
float gmPore = smoothstep(0.62, 0.8, gmNoise(vec3(gmWp.x * 1600.0, gmWp.y * 1600.0, gmWp.z * 55.0)));
vec3 gmDark = vec3(0.045, 0.02, 0.01);
vec3 gmLight = vec3(0.2, 0.1, 0.045);
vec3 gmWood = mix(gmDark, gmLight, clamp(0.5 + 0.28 * gmRing + 0.35 * (gmGrain - 0.5), 0.0, 1.0));
gmWood *= 1.0 - 0.35 * gmPore;
diffuseColor.rgb = mix(diffuseColor.rgb * 0.5, gmWood, 0.9);
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.5 + 0.02, gmEdge * 0.35);
gmRough = -0.12 + gmPore * 0.18 + (gmGrain - 0.5) * 0.08;
gmBump = (gmGrain * 0.5 + gmPore * -0.8) * 0.00008;
`,
  // GM_CERAKOTE (tan)
  tan: /* glsl */ `
float gmWearT = gmEdge * smoothstep(0.35, 0.7, gmMid);
diffuseColor.rgb *= 0.92 + 0.14 * gmFine + 0.06 * gmMid;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.2, 0.21), gmWearT * 0.8);
gmMetal = gmWearT * 0.8;
gmRough = 0.12 + (gmFine - 0.5) * 0.1 - gmWearT * 0.3;
gmBump = gmFine * 0.00006;
`,
  // GM_CERAKOTE (olive)
  olive: /* glsl */ `
float gmWearO = gmEdge * smoothstep(0.35, 0.7, gmMid);
diffuseColor.rgb *= 0.9 + 0.16 * gmFine + 0.06 * gmMid;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.18, 0.18, 0.19), gmWearO * 0.8);
gmMetal = gmWearO * 0.8;
gmRough = 0.12 + (gmFine - 0.5) * 0.1 - gmWearO * 0.3;
gmBump = gmFine * 0.00006;
`,
  // GM_CHROME
  chrome: /* glsl */ `
float gmScr = gmNoise(vec3(gmP.x * 1800.0, gmP.y * 90.0, gmP.z * 1800.0));
float gmScr2 = gmNoise(vec3(gmP.x * 90.0, gmP.y * 1800.0, gmP.z * 1800.0));
diffuseColor.rgb *= 0.9 + 0.1 * gmMid;
gmRough = max(gmScr, gmScr2) * 0.12 - 0.02;
gmBump = (gmScr + gmScr2) * 0.00002;
`,
  // GM_LENS
  lens: '',
  // GM_GLASS
  glass: /* glsl */ `
gmRough = (gmMid - 0.5) * 0.03;
`,
  // GM_CLOTH
  cloth: /* glsl */ `
vec3 gmAn = abs(gmUnitN);
vec2 gmUv = gmAn.y > gmAn.x && gmAn.y > gmAn.z ? gmP.xz : (gmAn.x > gmAn.z ? gmP.yz : gmP.xy);
float gmWeave = 0.5 + 0.5 * sin(gmUv.x * 2200.0) * sin(gmUv.y * 2200.0);
diffuseColor.rgb *= 0.78 + 0.28 * gmWeave + 0.1 * (gmMid - 0.5);
gmBump = gmWeave * 0.00018;
gmRough = (gmFine - 0.5) * 0.06;
`,
  // GM_BRASS
  brass: /* glsl */ `
float gmTarn = smoothstep(0.4, 0.75, gmNoise(gmP * 70.0)) * (0.6 + 0.4 * gmMid);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.12, 0.05), gmTarn * 0.55);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.95, 0.72, 0.35), gmEdge * 0.35);
gmRough = gmTarn * 0.3 + (gmFine - 0.5) * 0.06 - gmEdge * 0.1;
gmBump = gmFine * 0.00003;
`,
};

/** Coated lens: blue-green to violet reflection with angle (emissive stays low so it never glows). */
const LENS_EMISSIVE = /* glsl */ `
{
  float gmNdv = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
  vec3 gmCoat = mix(vec3(0.5, 0.12, 0.45), vec3(0.04, 0.5, 0.42), smoothstep(0.1, 0.85, gmNdv));
  totalEmissiveRadiance = totalEmissiveRadiance * 0.55 + gmCoat * (0.05 + 0.5 * pow(1.0 - gmNdv, 2.0));
}
`;

const GLASS_ALPHA = /* glsl */ `
{
  float gmNdvG = clamp(dot(normalize(vViewPosition), normal), 0.0, 1.0);
  diffuseColor.a = clamp(mix(0.88, 0.35, gmNdvG), 0.0, 1.0);
}
`;

const BUMP = /* glsl */ `
{ // micro bump from gmBump (metres), screen-space derivatives (same method as three's perturbNormalArb)
  vec3 gmDpx = dFdx(-vViewPosition);
  vec3 gmDpy = dFdy(-vViewPosition);
  vec2 gmDh = vec2(dFdx(gmBump), dFdy(gmBump));
  vec3 gmR1 = cross(gmDpy, normal);
  vec3 gmR2 = cross(normal, gmDpx);
  float gmDet = dot(gmDpx, gmR1);
  if (abs(gmDet) > 1e-12) normal = normalize(abs(gmDet) * normal - sign(gmDet) * (gmDh.x * gmR1 + gmDh.y * gmR2));
}
`;

/** Patches a MeshStandardMaterial with the gun-space procedural detail for `name`. Exported for tests. */
export function patchGunMaterial(m: THREE.MeshStandardMaterial, name: Mat) {
  const kind = KIND[name];
  if (kind === undefined) return;
  m.customProgramCacheKey = () => `gunmat-${name}-v1`;
  m.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ngmP = position;\ngmN = normal;');
    let f = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n/* GM_${name.toUpperCase()} */${FRAG_COMMON}${kind}`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor + gmRough, 0.04, 1.0);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = clamp(metalnessFactor + gmMetal, 0.0, 1.0);')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${BUMP}`);
    if (name === 'lens') f = f.replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${LENS_EMISSIVE}`);
    if (name === 'glass') f = f.replace('#include <opaque_fragment>', `${GLASS_ALPHA}\n#include <opaque_fragment>`);
    sh.fragmentShader = f;
  };
}

let MATS: Record<Mat, THREE.Material> | null = null;
export function mats(): Record<Mat, THREE.Material> {
  if (MATS) return MATS;
  const std = (color: string, metalness: number, roughness: number, extra: Partial<THREE.MeshStandardMaterialParameters> = {}) => new THREE.MeshStandardMaterial({ color, metalness, roughness, ...extra });
  MATS = {
    steel: std('#2b2e33', 0.85, 0.4), polymer: std('#1c1d20', 0.05, 0.62), wood: std('#6e4628', 0.05, 0.5), tan: std('#9b8664', 0.05, 0.7),
    chrome: std('#b8bcc2', 0.95, 0.2), lens: std('#1b3550', 0.4, 0.05, { emissive: new THREE.Color('#0c2236'), emissiveIntensity: 0.6 }), bore: std('#050505', 0, 1),
    olive: std('#4d5638', 0.1, 0.65), glass: std('#5f8a6a', 0.1, 0.08, { transparent: true, opacity: 0.75 }), cloth: std('#c9b48a', 0, 0.95), brass: std('#b8893a', 0.9, 0.3),
  };
  for (const [k, m] of Object.entries(MATS) as [Mat, THREE.MeshStandardMaterial][]) { m.userData.shared = true; patchGunMaterial(m, k); }
  return MATS;
}
