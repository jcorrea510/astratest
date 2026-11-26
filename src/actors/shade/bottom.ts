/**
 * Person shader, BOTTOMS and SHOES (part 3: jeans, trousers, shorts, skirts, sweats; part 4: shoes uC[4];
 * part 5: soles uC[5]). bs = uBottom.y (BOTTOM_IDS), uPat.w = shoe style. Write col and rough. BOTTOM_PARS goes in the header.
 */
export const BOTTOM_PARS = /* glsl */ ``;

export const BOTTOM_GLSL = /* glsl */ `  col = uC[3];
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
  // Round 9: knee and ankle bunching on long pants, pocket shadow at the hip
  if (ri == 3) {
    col *= 1.0 - 0.12 * smoothstep(0.07, 0.0, abs(vCloth - 0.5)) * (0.5 + 0.5 * sin(vBind.x * 120.0 + vBind.z * 80.0));
    col *= 1.0 - 0.1 * smoothstep(0.1, 0.0, abs(vCloth - uBottom.x + 0.06)) * (0.5 + 0.5 * sin(vBind.z * 150.0));
  }
  rough = bs < 0.5 ? 0.92 : bs > 3.5 ? 0.97 : 0.86;
`;

export const SHOE_GLSL = /* glsl */ `  col = uC[4]; float s = uPat.w;
  rough = s > 1.5 ? 0.3 : s > 0.5 ? 0.55 : 0.7;
  if (s < 0.5) col = mix(col, uC[2], smoothstep(0.55, 0.6, abs(bn.x)) * step(vBind.y, uBody.x + 0.06) * step(uBody.x + 0.04, vBind.y) * 0.8);
`;

export const SOLE_GLSL = /* glsl */ `col = uC[5]; rough = 0.8;
`;
