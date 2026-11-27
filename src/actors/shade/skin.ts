/**
 * Person shader, SKIN (part 0: face, neck, hands, bare limbs, scalp paint and facial-hair paint). GLSL pasted into the
 * fragment main() of the person material (see humanMaterial.ts). In scope: tx (atlas texel), ri (region), vHn (head-space
 * position), vBind (bind position), bn (bind normal), front, grain, uC[] colours (uC[0] skin, uC[6] hair), uPat. Write col,
 * rough (roughness) and flatN (0 = use the atlas normal map). SKIN_PARS goes in the fragment header (functions/uniforms);
 * SKIN_LIGHT_PARS after lights_physical_pars_fragment (redefines RE_Direct for pre-integrated SSS skin + dual-lobe spec,
 * guarded by gSkin); faceDetail() (face.ts) is called at the end for ri == 0.
 */
export const SKIN_PARS = /* glsl */ ``;

/**
 * Photorealistic skin lighting: RE_Direct is redirected to RE_Direct_Person. Non-skin fragments call Three's
 * RE_Direct_Physical with optional cloth grazing sheen. Skin fragments get:
 *  - Smooth pre-integrated per-channel wrapped diffuse (no shadow-crushing squaring) + warm hemoglobin terminator
 *    subsurface scatter across the light-shadow boundary so cheeks, noses, and jaws look like living flesh,
 *  - Physically grounded dual-lobe GGX specular (fine sebum sheen + broad velvet scatter, Fresnel f0 0.028),
 *  - Subtle grazing translucent back-scatter on ears, nose wings, cheeks, and fingers.
 */
export const SKIN_LIGHT_PARS = /* glsl */ `bool gSkin = false;
float gSkinSss = 1.0;
float gSkinShine = 1.0;
float gSheen = 0.0; // cloth sheen strength (0 matte cotton .. 0.36 wool/satin); subtle grazing rim
void RE_Direct_Person( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  if ( !gSkin ) {
    RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    if ( gSheen > 0.0 ) {
      float sNv = saturate( dot( geometryNormal, geometryViewDir ) );
      float sNl = saturate( dot( geometryNormal, directLight.direction ) );
      float sRim = pow( 1.0 - sNv, 3.0 );
      reflectedLight.directSpecular += directLight.color * ( material.diffuseContribution * 0.65 + vec3( 0.07 ) ) * ( gSheen * sRim * ( 0.22 + 0.78 * sNl ) );
    }
    return;
  }
  vec3 L = directLight.direction;
  float ndl = dot( geometryNormal, L );
  // Smooth pre-integrated skin wrap (red wraps deepest through dermis, green medium, blue tightest)
  vec3 wr = vec3( 0.52, 0.24, 0.12 ) * gSkinSss;
  vec3 wd = clamp( ( vec3( ndl ) + wr ) / ( vec3( 1.0 ) + wr ), vec3( 0.0 ), vec3( 1.0 ) );
  // Gentle contrast curve preserving warm mid-tones without crushing shadows into plastic
  wd = mix( wd, wd * wd * ( 3.0 - 2.0 * wd ), 0.35 );
  // Warm blood-rich hemoglobin glow along the light-shadow terminator
  float term = exp( -pow( ( ndl + 0.08 ) * 2.6, 2.0 ) ) * gSkinSss;
  vec3 sssTint = wd + vec3( 0.22, 0.055, 0.018 ) * term;
  reflectedLight.directDiffuse += directLight.color * sssTint * BRDF_Lambert( material.diffuseContribution );

  float dotNL = saturate( ndl );
  float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
  vec3 H = normalize( L + geometryViewDir );
  float dotNH = saturate( dot( geometryNormal, H ) );
  float dotVH = saturate( dot( geometryViewDir, H ) );
  float fx = 1.0 - dotVH;
  float F = 0.028 + 0.972 * fx * fx * fx * fx * fx;
  float rS = clamp( material.roughness * 0.56, 0.20, 0.42 );
  float rB = clamp( material.roughness * 1.18, 0.46, 0.92 );
  float aS = rS * rS;
  float aB = rB * rB;
  float lobeS = D_GGX( aS, dotNH ) * V_GGX_SmithCorrelated( aS, dotNL, dotNV );
  float lobeB = D_GGX( aB, dotNH ) * V_GGX_SmithCorrelated( aB, dotNL, dotNV );
  float spec = F * ( 0.22 * gSkinShine * lobeS + 0.44 * lobeB );
  reflectedLight.directSpecular += directLight.color * dotNL * spec;

  // Soft translucent back-scatter along grazing edges (ears, nose wings, cheeks, fingers)
  float backRim = pow( 1.0 - dotNV, 3.2 ) * pow( saturate( dot( -L, geometryViewDir ) * 0.5 + 0.5 ), 2.2 );
  reflectedLight.directDiffuse += directLight.color * vec3( 0.94, 0.32, 0.15 ) * ( 0.14 * gSkinSss * backRim ) * material.diffuseContribution;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Person
`;

export const SKIN_GLSL = /* glsl */ `  // Preserve atlas anatomical detail (pores, creases, natural colour variation) while matching the person's complexion
  vec3 ratio = clamp(tx.rgb / vec3(0.397, 0.153, 0.072), vec3(0.08), vec3(2.8));
  float lr = dot(ratio, vec3(0.3, 0.5, 0.2));
  lr = ri == 0 ? lr : clamp(lr, 0.45, 1.1);
  col = uC[0] * (0.28 + 0.80 * lr) * mix(vec3(1.0), ratio / max(lr, 0.06), 0.26);
  rough = 0.56; flatN = 0.0;

  // Warm blood saturation in deeper skin crevices (prevents dead grey shadows)
  float skDeep = 1.0 - smoothstep(0.16, 0.78, lr);
  float skLum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(skLum), col, 1.0 + 0.38 * skDeep);
  col *= mix(vec3(1.0), vec3(1.02, 0.86, 0.80), skDeep * 0.48);

  // Organic multi-frequency complexion micro-variation (subtle melanin & capillary mottling)
  float skMottle = (vnoise(vBind * 9.5) - 0.5) * 0.42 + (vnoise(vBind * 34.0 + vec3(7.3)) - 0.5) * 0.24;
  col *= vec3(1.0 + 0.085 * skMottle, 1.0 - 0.055 * skMottle, 1.0 - 0.075 * skMottle);

  // Subtle anatomical capillary warmth: ears, cheekbones, nose tip/wings, knuckles & fingertips
  float skFlush = 0.0;
  if (ri == 0) {
    float skEar = smoothstep(0.75, 0.91, abs(vHn.x)) * (1.0 - smoothstep(0.2, 0.46, abs(vHn.z - 0.05)));
    float skCheek = smoothstep(0.24, 0.45, abs(vHn.x)) * (1.0 - smoothstep(0.62, 0.86, abs(vHn.x))) * smoothstep(-0.46, -0.24, vHn.y) * (1.0 - smoothstep(-0.04, 0.14, vHn.y)) * smoothstep(0.35, 0.72, vHn.z);
    float skNose = (1.0 - smoothstep(0.1, 0.28, abs(vHn.x))) * smoothstep(-0.68, -0.48, vHn.y) * (1.0 - smoothstep(-0.38, -0.2, vHn.y)) * smoothstep(0.74, 0.92, vHn.z);
    skFlush = skEar * 0.13 + skCheek * 0.075 + skNose * 0.085 * (0.65 + 0.7 * vnoise(vBind * 24.0));
  } else if (ri == 2) {
    skFlush = smoothstep(0.92, 1.0, vCloth) * 0.09;
  }
  col *= vec3(1.0 + 0.45 * skFlush, 1.0 - 0.78 * skFlush, 1.0 - 0.95 * skFlush);

  // Realistic skin roughness variation: slightly oilier T-zone (forehead, nose bridge, chin), softer matte cheeks
  rough = 0.55 + 0.14 * (vnoise(vBind * 15.0) - 0.5) + 0.05 * (vnoise(vBind * 3.2) - 0.5);
  gSkin = true; gSkinSss = 1.0; gSkinShine = 1.0;
  if (ri == 0) {
    float skTz = (1.0 - smoothstep(0.15, 0.4, abs(vHn.x))) * smoothstep(0.22, 0.62, vHn.z) * (smoothstep(0.0, 0.22, vHn.y) * (1.0 - smoothstep(0.5, 0.82, vHn.y)) + 0.65 * smoothstep(-0.7, -0.86, vHn.y));
    rough -= 0.13 * skTz; gSkinShine = 1.0 + 0.65 * skTz;
  }

  // Micro skin relief (distance-faded so zero aliasing/shimmer): close-up pores & fine skin grain
  float skD = length(vViewPosition);
  float skPoreF = 1.0 - smoothstep(0.35, 1.4, skD);
  float skFineF = 1.0 - smoothstep(1.1, 4.2, skD);
  float skPn = vnoise(vBind * 1050.0);
  float skW = vnoise(vBind * vec3(155.0, 58.0, 155.0) + vec3(vnoise(vBind * 36.0) * 2.8));
  float skRidge = 1.0 - smoothstep(0.0, 0.075, abs(skW - 0.5));
  bumpH = -0.00013 * smoothstep(0.54, 0.84, skPn) * skPoreF - 0.00024 * skRidge * skFineF;
  col *= 1.0 - 0.09 * skRidge * skFineF - 0.035 * smoothstep(0.54, 0.84, skPn) * skPoreF;
  rough += 0.07 * skRidge * skFineF;

  // Anatomical contact ambient occlusion: collar/neckline shadow + natural under-jaw & chin shadow
  if (ri == 1) {
    float skNd = length((vBind.xz - uNeck.xy) * vec2(1.0, 1.2)) - uNeck.z;
    col *= 1.0 - 0.24 * smoothstep(-0.035, 0.0, skNd);
    // Subtle sternocleidomastoid / collarbone shadow depth at front of lower neck
    float clav = smoothstep(0.35, 0.85, bn.z) * (1.0 - smoothstep(0.86, 0.98, vCloth)) * smoothstep(0.02, 0.09, abs(vBind.x));
    col *= 1.0 - 0.10 * clav;
  } else if (ri == 0) {
    float jawAo = smoothstep(-0.74, -1.02, vHn.y) * (1.0 - smoothstep(0.62, 0.94, vHn.z));
    col *= mix(vec3(1.0), vec3(0.82, 0.74, 0.71), jawAo * 0.58);
  }

  // Natural fingernails / nail polish
  float nlM = ri == 2 ? smoothstep(0.5, 0.85, tx.b / max(tx.r, 0.03)) : 0.0;
  vec3 nlC = uNeck.w > 0.5 ? uC[10] : uC[0] * vec3(1.12, 0.92, 0.9);
  col = mix(col, nlC, nlM);
  rough = mix(rough, uNeck.w > 0.5 ? 0.18 : 0.36, nlM);

  // Scalp hair paint & realistic facial hair (stubble, beard, moustache, goatee)
  if (ri == 0 && vHn.y > -1.5) {
    vec3 hc = uC[6];
    float h = hairlineF(vHn.x, vHn.z);
    float scalp = smoothstep(h - 0.035, h + 0.11, vHn.y);
    float mode = uPat.y;
    float n = vnoise(vHn * 62.0);
    float a = 0.0;
    if (mode > 0.5 && mode < 1.5) a = scalp * 0.95;
    else if (mode > 1.5 && mode < 2.5) a = scalp * (0.74 + 0.2 * n);
    else if (mode > 2.5 && mode < 3.5) a = scalp * mix(0.24 + 0.16 * n, 0.86 + 0.1 * n, smoothstep(h + 0.05, h + 0.55, vHn.y));
    else if (mode > 5.5) a = scalp * 0.9 * (1.0 - smoothstep(0.1, 0.5, vHn.z));
    else if (mode > 4.5) a = scalp * (0.55 + 0.45 * abs(sin(vHn.x * 22.0)));
    else if (mode > 3.5) a = scalp * 0.0;
    col = mix(col, hc * (0.74 + 0.48 * n), a);
    rough = mix(rough, 0.82, a); gSkinSss *= 1.0 - 0.72 * a; gSkinShine *= 1.0 - 0.85 * a;

    float fm = uPat.z;
    if (fm > 0.5) {
      float jaw = smoothstep(0.05, -0.2, vHn.y) * smoothstep(-0.05, 0.35, vHn.z) * smoothstep(-1.05, -0.8, vHn.y);
      float jawS = smoothstep(-0.12, -0.34, vHn.y) * smoothstep(-0.05, 0.35, vHn.z) * smoothstep(-1.05, -0.8, vHn.y);
      float lips = smoothstep(0.42, 0.28, abs(vHn.x)) * smoothstep(-0.78, -0.66, vHn.y) * smoothstep(-0.3, -0.42, vHn.y) * smoothstep(0.7, 0.85, vHn.z);
      float mous = smoothstep(0.42, 0.3, abs(vHn.x)) * smoothstep(-0.48, -0.42, vHn.y) * smoothstep(-0.22, -0.3, vHn.y) * smoothstep(0.7, 0.85, vHn.z);
      float chin = smoothstep(0.3, 0.18, abs(vHn.x)) * smoothstep(-0.6, -0.75, vHn.y) * smoothstep(0.3, 0.6, vHn.z);
      float b = 0.0;
      if (fm < 1.5) b = max(jawS, mous * 0.9) * (0.36 + 0.32 * (vnoise(vHn * 175.0) - 0.5) + 0.08 * (n - 0.5));
      else if (fm < 2.5) b = jaw * 0.78;
      else if (fm < 3.5) b = max(mous * 0.9, jaw * 0.15);
      else b = max(max(mous, chin) * 0.85, jaw * 0.12);
      b *= 1.0 - lips;
      float bc = clamp(b, 0.0, 1.0);
      col = mix(col, hc * 0.78, bc);
      rough = mix(rough, 0.82, bc); gSkinSss *= 1.0 - 0.55 * bc; gSkinShine *= 1.0 - 0.72 * bc;
    }
  }
  if (ri == 0) faceDetail(col, rough, vHn, tx.rgb);
`;
