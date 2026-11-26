/**
 * Person shader, SKIN (part 0: face, neck, hands, bare limbs, scalp paint and facial-hair paint). GLSL pasted into the
 * fragment main() of the person material (see humanMaterial.ts). In scope: tx (atlas texel), ri (region), vHn (head-space
 * position), vBind (bind position), bn (bind normal), front, grain, uC[] colours (uC[0] skin, uC[6] hair), uPat. Write col,
 * rough (roughness) and flatN (0 = use the atlas normal map). SKIN_PARS goes in the fragment header (functions/uniforms);
 * SKIN_LIGHT_PARS after lights_physical_pars_fragment (may redefine RE_Direct for skin, e.g. wrap/SSS + dual lobe spec,
 * guarded by isSkin which is set in main); faceDetail() (face.ts) is called at the end for ri == 0.
 */
export const SKIN_PARS = /* glsl */ ``;

export const SKIN_LIGHT_PARS = /* glsl */ ``;

export const SKIN_GLSL = /* glsl */ `  // keep the texture's local detail (lips, shading, pores) but take the tone from the wanted skin colour
  vec3 ratio = clamp(tx.rgb / vec3(0.397, 0.153, 0.072), vec3(0.05), vec3(3.0));
  float lr = dot(ratio, vec3(0.3, 0.5, 0.2));
  col = uC[0] * (0.25 + 0.85 * lr) * mix(vec3(1.0), ratio / max(lr, 0.05), 0.28); rough = 0.6; flatN = 0.0;
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
      col = mix(col, hc * 0.8, clamp(b, 0.0, 1.0));
    }
  }
  if (ri == 0) faceDetail(col, rough, vHn, tx.rgb);
`;
