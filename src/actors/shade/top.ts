/**
 * Person shader, TOPS (part 1: shirts, tees, hoodies, jackets, suits, dresses, uniforms). Fabric colour/pattern and
 * construction details. In scope as for skin.ts plus topId (uTop.w; ids in humanMaterial TOP_IDS), uC[1] top, uC[2] accent,
 * uC[8] detail, vCloth (0 hem .. 1 shoulder). Write col and rough. TOP_PARS goes in the fragment header.
 */
export const TOP_PARS = /* glsl */ ``;

export const TOP_GLSL = /* glsl */ `  col = uC[1];
  float pat = uPat.x;
  if (pat > 0.5 && pat < 1.5) col = mix(uC[1], uC[2], step(0.62, fract(vBind.y * 16.0)));
  else if (pat > 1.5 && pat < 2.5) { float a = step(0.5, fract(vBind.x * 11.0 + 0.25)), b = step(0.5, fract(vBind.y * 11.0)); col = mix(uC[1], uC[2], (a + b) * 0.3); col = mix(col, uC[8], step(0.93, fract(vBind.x * 22.0)) * 0.25 + step(0.93, fract(vBind.y * 22.0)) * 0.25); }
  else if (pat > 2.5 && pat < 3.5 && ri == 1) {
    vec2 c = vec2(vBind.x, vBind.y - (uBody.y + 0.02));
    float r = length(c / vec2(1.0, 1.15));
    float print = front * step(r, 0.07) * (step(0.045, r) + step(r, 0.028));
    col = mix(col, uC[2], print);
  } else if (pat > 3.5 && pat < 4.5 && ri == 2) col = uC[2];
  // Round 9 (owner: "make all the things in the outfit store better"): more prints
  else if (pat > 4.5 && pat < 5.5) col = mix(col, uC[2], 0.7 * smoothstep(0.0035, 0.0, abs(fract(vBind.x * 38.0) - 0.5) / 38.0)); // pinstripe
  else if (pat > 5.5 && pat < 6.5) { // woodland camo: three noise blobs
    float n1 = vnoise(vBind * 9.0), n2 = vnoise(vBind * 14.0 + 7.3), n3 = vnoise(vBind * 21.0 + 2.1);
    col = mix(col, uC[2], smoothstep(0.52, 0.56, n1)); col = mix(col, uC[2] * 0.45, smoothstep(0.58, 0.62, n2)); col = mix(col, col * 1.35 + 0.03, smoothstep(0.62, 0.66, n3));
  } else if (pat > 6.5) { // houndstooth: broken check
    vec2 q = vec2(vBind.x, vBind.y) * 60.0; vec2 f = fract(q); float chk = step(0.5, f.x) == step(0.5, f.y) ? 1.0 : 0.0;
    float tooth = step(f.x + f.y, 0.75) * step(0.5, f.x) * (1.0 - step(0.5, f.y)); col = mix(col, uC[2], clamp(chk + tooth, 0.0, 1.0) * 0.85);
  }
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
  // Round 9: cloth folds (bunching at the elbow crease and the waist, soft drape lines) and occlusion at the collar / hem
  if (ri == 2) col *= 1.0 - 0.16 * smoothstep(0.08, 0.0, abs(vCloth - 0.5)) * (0.55 + 0.45 * sin(vBind.x * 90.0 + vBind.z * 70.0));
  if (ri == 1) {
    col *= 1.0 - 0.08 * smoothstep(0.6, 1.0, sin(vCloth * 46.0 + vnoise(vBind * 18.0) * 5.0)) * (1.0 - front * 0.4);
    col *= 1.0 - 0.18 * smoothstep(0.03, 0.0, abs(vCloth - uTop.y - 0.01));
  }
  // fabric: bomber = worn leather sheen, suit = wool, hoodie / sweats = matte knit, shirts = cotton
  rough = topId > 3.5 && topId < 4.5 ? 0.48 : topId > 4.5 && topId < 5.5 ? 0.7 : topId > 2.5 && topId < 3.5 ? 0.97 : 0.88;
  if (topId > 3.5 && topId < 4.5) col *= 0.92 + 0.16 * vnoise(vBind * 120.0);
`;
