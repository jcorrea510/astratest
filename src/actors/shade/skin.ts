/**
 * Person shader, SKIN (part 0: face, neck, hands, bare limbs, scalp paint and facial-hair paint). GLSL pasted into the
 * fragment main() of the person material (see humanMaterial.ts). In scope: tx (atlas texel), ri (region), vHn (head-space
 * position), vBind (bind position), bn (bind normal), front, grain, uC[] colours (uC[0] skin, uC[6] hair), uPat. Write col,
 * rough (roughness) and flatN (0 = use the atlas normal map). SKIN_PARS goes in the fragment header (functions/uniforms);
 * SKIN_LIGHT_PARS after lights_physical_pars_fragment (may redefine RE_Direct for skin, e.g. wrap/SSS + dual lobe spec,
 * guarded by isSkin which is set in main); faceDetail() (face.ts) is called at the end for ri == 0.
 */
export const SKIN_PARS = /* glsl */ ``;

/**
 * Skin lighting: RE_Direct is redirected to RE_Direct_Person. Fragments that are not skin (gSkin false) call three's own
 * RE_Direct_Physical unchanged. Skin (gSkin set in SKIN_GLSL) gets
 *  - a per-channel wrapped diffuse (red wraps furthest, blue least) = soft, red-shifted terminator (cheap pre-integrated SSS),
 *  - a dual-lobe specular (sharp oily lobe + broad lobe, Fresnel f0 0.028); gSkinSss / gSkinShine scale both per fragment.
 * Ambient / IBL are untouched.
 */
export const SKIN_LIGHT_PARS = /* glsl */ `bool gSkin = false;
float gSkinSss = 1.0;
float gSkinShine = 1.0;
void RE_Direct_Person( const in IncidentLight directLight, const in vec3 geometryPosition, const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal, const in PhysicalMaterial material, inout ReflectedLight reflectedLight ) {
  if ( !gSkin ) {
    RE_Direct_Physical( directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight );
    return;
  }
  vec3 L = directLight.direction;
  float ndl = dot( geometryNormal, L );
  vec3 wr = vec3( 0.62, 0.3, 0.16 ) * gSkinSss;
  vec3 wd = clamp( ( vec3( ndl ) + wr ) / ( vec3( 1.0 ) + wr ), vec3( 0.0 ), vec3( 1.0 ) );
  wd = wd * wd;
  reflectedLight.directDiffuse += directLight.color * wd * BRDF_Lambert( material.diffuseContribution );
  float dotNL = saturate( ndl );
  float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
  vec3 H = normalize( L + geometryViewDir );
  float dotNH = saturate( dot( geometryNormal, H ) );
  float dotVH = saturate( dot( geometryViewDir, H ) );
  float fx = 1.0 - dotVH;
  float F = 0.028 + 0.972 * fx * fx * fx * fx * fx;
  float rS = clamp( material.roughness * 0.6, 0.18, 0.4 );
  float rB = clamp( material.roughness * 1.15, 0.4, 0.9 );
  float aS = rS * rS;
  float aB = rB * rB;
  float lobeS = D_GGX( aS, dotNH ) * V_GGX_SmithCorrelated( aS, dotNL, dotNV );
  float lobeB = D_GGX( aB, dotNH ) * V_GGX_SmithCorrelated( aB, dotNL, dotNV );
  float spec = F * ( 0.3 * gSkinShine * lobeS + 0.7 * lobeB );
  reflectedLight.directSpecular += directLight.color * dotNL * spec;
}
#undef RE_Direct
#define RE_Direct RE_Direct_Person
`;

export const SKIN_GLSL = /* glsl */ `  // keep the texture's local detail (lips, shading, pores) but take the tone from the wanted skin colour
  vec3 ratio = clamp(tx.rgb / vec3(0.397, 0.153, 0.072), vec3(0.05), vec3(3.0));
  float lr = dot(ratio, vec3(0.3, 0.5, 0.2));
  lr = ri == 0 ? lr : clamp(lr, 0.45, 1.1); // neck, chest and hands keep the face tone (no pale texel patches)
  col = uC[0] * (0.25 + 0.85 * lr) * mix(vec3(1.0), ratio / max(lr, 0.05), 0.28); rough = 0.6; flatN = 0.0;
  // dark tones: re-saturate toward warm red (blood under skin) instead of going grey; creases darker and warmer
  float skDeep = 1.0 - smoothstep(0.12, 0.75, lr);
  float skLum = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(skLum), col, 1.0 + 0.45 * skDeep);
  col *= mix(vec3(1.0), vec3(1.0, 0.84, 0.78), skDeep * 0.55);
  // natural blotchy variation (slightly redder or paler patches)
  float skRed = (vnoise(vBind * 9.0) - 0.5) * 0.5 + (vnoise(vBind * 31.0 + vec3(7.3)) - 0.5) * 0.25;
  col *= vec3(1.0 + 0.1 * skRed, 1.0 - 0.07 * skRed, 1.0 - 0.09 * skRed);
  // warm flush: ears and cheek band on the head, hands (end of the arm) slightly redder
  float skFlush = 0.0;
  if (ri == 0) {
    float skEar = smoothstep(0.75, 0.9, abs(vHn.x)) * (1.0 - smoothstep(0.2, 0.45, abs(vHn.z - 0.05)));
    float skCheek = smoothstep(0.25, 0.45, abs(vHn.x)) * (1.0 - smoothstep(0.6, 0.85, abs(vHn.x))) * smoothstep(-0.45, -0.25, vHn.y) * (1.0 - smoothstep(-0.05, 0.15, vHn.y)) * smoothstep(0.35, 0.7, vHn.z);
    skFlush = skEar * 0.14 + skCheek * 0.07;
  } else if (ri == 2) skFlush = smoothstep(0.93, 1.0, vCloth) * 0.1;
  col *= vec3(1.0 + 0.5 * skFlush, 1.0 - 0.9 * skFlush, 1.0 - 1.1 * skFlush);
  // roughness: slight variation, T-zone (forehead centre, chin) shinier
  rough = 0.58 + 0.1 * (vnoise(vBind * 14.0) - 0.5);
  gSkin = true; gSkinSss = 1.0; gSkinShine = 1.0;
  if (ri == 0) {
    float skTz = (1.0 - smoothstep(0.15, 0.4, abs(vHn.x))) * smoothstep(0.2, 0.6, vHn.z) * (smoothstep(0.0, 0.2, vHn.y) * (1.0 - smoothstep(0.5, 0.8, vHn.y)) + 0.6 * smoothstep(-0.7, -0.85, vHn.y));
    rough -= 0.14 * skTz; gSkinShine = 1.0 + 0.7 * skTz;
  }
  // micro relief in metres (faded with distance so it never shimmers): pores up close, fine skin lines further out
  float skD = length(vViewPosition);
  float skPoreF = 1.0 - smoothstep(0.3, 1.0, skD);
  float skFineF = 1.0 - smoothstep(0.9, 3.5, skD);
  float skPn = vnoise(vBind * 1100.0);
  float skW = vnoise(vBind * vec3(160.0, 60.0, 160.0) + vec3(vnoise(vBind * 37.0) * 3.0));
  float skRidge = 1.0 - smoothstep(0.0, 0.07, abs(skW - 0.5));
  bumpH = -0.00011 * smoothstep(0.55, 0.85, skPn) * skPoreF - 0.00025 * skRidge * skFineF;
  col *= 1.0 - 0.05 * skRidge * skFineF;
  // contact shade where skin meets the neckline: soft, hides the pale fringe next to the collar
  if (ri == 1) {
    float skNd = length((vBind.xz - uNeck.xy) * vec2(1.0, 1.2)) - uNeck.z;
    col *= 1.0 - 0.2 * smoothstep(-0.03, 0.0, skNd);
  }
  // fingernails: texels that are not skin-toned (dark grey/blue) become a natural pink nail, or polish where uNeck.w is set
  float nlM = ri == 2 ? smoothstep(0.5, 0.85, tx.b / max(tx.r, 0.03)) : 0.0;
  vec3 nlC = uNeck.w > 0.5 ? uC[10] : uC[0] * vec3(1.12, 0.92, 0.9);
  col = mix(col, nlC, nlM);
  rough = mix(rough, uNeck.w > 0.5 ? 0.2 : 0.4, nlM);
  if (ri == 0 && vHn.y > -1.5) {
    vec3 hc = uC[6];
    float h = hairlineF(vHn.x, vHn.z);
    float scalp = smoothstep(h - 0.03, h + 0.1, vHn.y);
    float mode = uPat.y;
    float n = vnoise(vHn * 60.0);
    float a = 0.0;
    if (mode > 0.5 && mode < 1.5) a = scalp * 0.95;
    else if (mode > 1.5 && mode < 2.5) a = scalp * (0.72 + 0.2 * n);
    else if (mode > 2.5 && mode < 3.5) a = scalp * mix(0.25 + 0.15 * n, 0.85 + 0.1 * n, smoothstep(h + 0.05, h + 0.55, vHn.y));
    else if (mode > 5.5) a = scalp * 0.9 * (1.0 - smoothstep(0.1, 0.5, vHn.z)); // under scanned hair: sides and back only
    else if (mode > 4.5) a = scalp * (0.55 + 0.45 * abs(sin(vHn.x * 22.0))) ;
    else if (mode > 3.5) a = scalp * 0.0;
    col = mix(col, hc * (0.75 + 0.5 * n), a);
    rough = mix(rough, 0.82, a); gSkinSss *= 1.0 - 0.7 * a; gSkinShine *= 1.0 - 0.85 * a; // painted hair: matte, no skin glow
    // facial hair paint (lower face, below the cheekbones; lips kept clear)
    float fm = uPat.z;
    if (fm > 0.5) {
      float jaw = smoothstep(0.05, -0.2, vHn.y) * smoothstep(-0.05, 0.35, vHn.z) * smoothstep(-1.05, -0.8, vHn.y);
      float jawS = smoothstep(-0.12, -0.34, vHn.y) * smoothstep(-0.05, 0.35, vHn.z) * smoothstep(-1.05, -0.8, vHn.y); // stubble sits lower on the cheeks
      float lips = smoothstep(0.42, 0.28, abs(vHn.x)) * smoothstep(-0.78, -0.66, vHn.y) * smoothstep(-0.3, -0.42, vHn.y) * smoothstep(0.7, 0.85, vHn.z);
      float mous = smoothstep(0.42, 0.3, abs(vHn.x)) * smoothstep(-0.48, -0.42, vHn.y) * smoothstep(-0.22, -0.3, vHn.y) * smoothstep(0.7, 0.85, vHn.z);
      float chin = smoothstep(0.3, 0.18, abs(vHn.x)) * smoothstep(-0.6, -0.75, vHn.y) * smoothstep(0.3, 0.6, vHn.z);
      float b = 0.0;
      if (fm < 1.5) b = max(jawS, mous * 0.9) * (0.34 + 0.3 * (vnoise(vHn * 170.0) - 0.5) + 0.08 * (n - 0.5)); // a fine, even shadow
      else if (fm < 2.5) b = jaw * 0.75;
      else if (fm < 3.5) b = max(mous * 0.9, jaw * 0.15);
      else b = max(max(mous, chin) * 0.85, jaw * 0.12);
      b *= 1.0 - lips;
      float bc = clamp(b, 0.0, 1.0);
      col = mix(col, hc * 0.8, bc);
      rough = mix(rough, 0.8, bc); gSkinSss *= 1.0 - 0.5 * bc; gSkinShine *= 1.0 - 0.7 * bc;
    }
  }
  if (ri == 0) faceDetail(col, rough, vHn, tx.rgb);
`;
