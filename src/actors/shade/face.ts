/**
 * Person shader, FACE: faceDetail() refines the skin of the head (ri == 0) after skin.ts has coloured it (feathered brows,
 * orbital socket & lashline depth, sculpted nose bridge/wings/philtrum, nasolabial & cheekbone contour, natural multi-tone
 * lips with Cupid's bow and under-lip chin shadow, ears).
 * EYES_GLSL is part 9 (eyeballs): realistic warm-ivory sclera, tear-duct caruncle, layered radial iris fibres with limbal
 * ring & warm collarette, deep pupil, soft upper-lid cast shadow, and crisp dual wet corneal specular catchlights.
 */
export const FACE_PARS = /* glsl */ `float fcG(float d, float w) { float q = d / w; return exp(-q * q); }
void faceDetail(inout vec3 col, inout float rough, vec3 hn, vec3 atlas) {
  float ax = abs(hn.x);
  float fz = smoothstep(0.32, 0.64, hn.z); // front of the face

  // Natural multi-strand eyebrows following realistic brow arch (tapered tail, softer inner head)
  if (fz > 0.0 && hn.y > 0.04 && hn.y < 0.39) {
    float byc = 0.122 + 0.094 * fcG(ax - 0.46, 0.27);
    float bw = 0.017 + 0.032 * fcG(ax - 0.38, 0.28);
    float bm = (1.0 - smoothstep(bw * 0.6, bw * 1.45, abs(hn.y - byc))) * smoothstep(0.11, 0.20, ax) * (1.0 - smoothstep(0.70, 0.87, ax)) * fz;
    float bs1 = vnoise(vec3(hn.x * 42.0 - hn.y * 28.0, hn.y * 165.0, 1.7));
    float bs2 = vnoise(vec3(hn.x * 110.0, hn.y * 95.0, 4.3));
    vec3 browCol = mix(uC[6] * 0.72, uC[6] * 0.92, bs1);
    col = mix(col, browCol, bm * (0.28 + 0.44 * bs1 * (0.7 + 0.3 * bs2)));
    rough = mix(rough, 0.82, bm * 0.6);
  }

  // Eye sockets: realistic orbital depth, subtle tear-trough warmth, upper lid crease, crisp upper & lower lashlines
  if (fz > 0.0 && hn.y > -0.24 && hn.y < 0.24) {
    float orb = fcG(ax - 0.37, 0.22) * fcG(hn.y - 0.02, 0.12) * fz;
    col *= mix(vec3(1.0), vec3(0.92, 0.87, 0.86), orb * 0.35);
    float ue = fcG(ax - 0.36, 0.19) * fcG(hn.y + 0.09, 0.042);
    col *= mix(vec3(1.0), vec3(0.87, 0.81, 0.83), ue * 0.55 * fz);
    float cq = (ax - 0.39) / 0.23;
    float arch = 1.0 - min(1.0, cq * cq);
    float yc = 0.108 + 0.034 * arch;
    float cl = fcG(hn.y - yc, 0.010) * smoothstep(0.15, 0.23, ax) * (1.0 - smoothstep(0.52, 0.61, ax)) * fz;
    col = mix(col, col * vec3(0.54, 0.42, 0.40), cl * 0.65);
    // Crisp dark upper lashline + subtle lower lashline framing the eyeball
    float lashY = 0.056 + 0.022 * arch;
    float lashU = fcG(hn.y - lashY, 0.0085) * smoothstep(0.15, 0.23, ax) * (1.0 - smoothstep(0.51, 0.60, ax)) * fz;
    float lashL = fcG(hn.y + 0.024 + 0.012 * arch, 0.007) * smoothstep(0.18, 0.26, ax) * (1.0 - smoothstep(0.49, 0.58, ax)) * fz;
    col = mix(col, col * vec3(0.24, 0.20, 0.20), lashU * 0.68);
    col = mix(col, col * vec3(0.58, 0.48, 0.46), lashL * 0.38);
  }

  // Sculpted mid-face: cheekbones, nose dorsal highlight, alar wings, nostril underside, philtrum & nasolabial contour
  if (fz > 0.0 && hn.y > -0.56 && hn.y < 0.52) {
    // Natural cheek warmth + subtle cheekbone highlight
    float ch = fcG(ax - 0.50, 0.21) * fcG(hn.y + 0.26, 0.16);
    col *= mix(vec3(1.0), vec3(1.07, 0.91, 0.90), ch * 0.46 * fz);
    float chHi = fcG(ax - 0.52, 0.14) * fcG(hn.y + 0.16, 0.08) * fz;
    rough -= 0.08 * chHi;

    // Nose bridge specular line + warm nose tip + alar wing shadows + nostril underside AO
    float bridge = fcG(hn.x, 0.055) * smoothstep(-0.34, -0.22, hn.y) * (1.0 - smoothstep(0.02, 0.14, hn.y)) * fz;
    col *= 1.0 + 0.045 * bridge;
    rough -= 0.11 * bridge;
    float ns = fcG(hn.x, 0.105) * fcG(hn.y + 0.33, 0.08) * fz;
    col *= mix(vec3(1.0), vec3(1.06, 0.90, 0.88), ns * 0.42);
    float nSide = fcG(ax - 0.155, 0.052) * fcG(hn.y + 0.355, 0.058) * fz;
    col *= mix(vec3(1.0), vec3(0.76, 0.66, 0.64), nSide * 0.50);
    float nUnder = fcG(hn.x, 0.12) * fcG(hn.y + 0.41, 0.028) * fz;
    col *= mix(vec3(1.0), vec3(0.62, 0.50, 0.48), nUnder * 0.45);
    // Subtle philtrum dimple between nose and upper lip
    float phil = fcG(hn.x, 0.032) * fcG(hn.y + 0.47, 0.042) * fz;
    col *= 1.0 - 0.09 * phil;
    // Soft nasolabial fold contour
    float nlf = fcG(ax - (0.20 + max(0.0, -(hn.y + 0.35)) * 0.48), 0.035) * smoothstep(-0.58, -0.48, hn.y) * (1.0 - smoothstep(-0.36, -0.26, hn.y)) * fz;
    col *= mix(vec3(1.0), vec3(0.86, 0.78, 0.76), nlf * 0.35);

    float tz = fcG(hn.x, 0.24) * fcG(hn.y - 0.34, 0.20) * fz;
    rough = rough - 0.06 * tz - 0.10 * ns;
  }

  // Realistic multi-tone lips: Cupid's bow upper arch, fuller lower lip, wet sheen, crisp parting shadow & under-lip hollow
  if (fz > 0.0 && hn.y > -0.84 && hn.y < -0.38) {
    float cupid = 0.016 * fcG(ax - 0.065, 0.055) - 0.012 * fcG(hn.x, 0.035);
    float lx = ax / 0.305;
    float ly = (hn.y + 0.584 - cupid) / 0.084;
    float lip = (1.0 - smoothstep(0.76, 1.04, sqrt(lx * lx + ly * ly))) * fz;
    float lowerBias = 1.0 - smoothstep(-0.625, -0.578, hn.y);
    // Natural vermilion derived from complexion so lips look genuine across light, olive, brown, and dark skin
    vec3 lipTone = mix(col * vec3(1.16, 0.72, 0.74), col * vec3(1.22, 0.76, 0.79), lowerBias);
    col = mix(col, lipTone, lip * (0.34 + 0.18 * lowerBias));
    float ls = vnoise(vec3(hn.x * 95.0, hn.y * 7.0, 4.0));
    col *= 1.0 - lip * 0.08 * ls;
    // Lip parting line & mouth corner shadow
    float ml = fcG(hn.y + 0.578, 0.010) * (1.0 - smoothstep(0.55, 0.96, lx)) * fz;
    float mCorner = fcG(ax - 0.295, 0.038) * fcG(hn.y + 0.582, 0.025) * fz;
    col = mix(col, col * vec3(0.46, 0.31, 0.31), clamp(ml * 0.78 + mCorner * 0.45, 0.0, 0.85));
    // Natural lower-lip highlight & soft under-lip chin shadow
    float lowHi = fcG(hn.x, 0.13) * fcG(hn.y + 0.628, 0.024) * lip;
    col *= 1.0 + 0.06 * lowHi;
    float underLip = fcG(hn.x, 0.16) * fcG(hn.y + 0.695, 0.032) * fz;
    col *= mix(vec3(1.0), vec3(0.80, 0.72, 0.70), underLip * 0.46);
    rough = mix(rough, 0.28, lip * 0.78);
  }

  // Ears: natural capillary warmth + inner ear concha depth
  float ear = smoothstep(0.84, 0.93, ax) * smoothstep(-0.55, -0.4, hn.y) * (1.0 - smoothstep(0.1, 0.25, hn.y));
  if (ear > 0.0) {
    col = mix(col, col * vec3(1.12, 0.81, 0.77), ear * 0.5);
    col *= 1.0 - 0.28 * fcG(ax - 0.97, 0.07) * fcG(hn.y + 0.17, 0.12) * ear;
  }
  rough = clamp(rough, 0.22, 0.92);
}
`;

export const EYES_GLSL = /* glsl */ `
  // Photorealistic eyeball: warm-ivory sclera, caruncle, layered radial iris fibres + collarette + dark limbal ring,
  // deep pupil, soft upper-lid cast shadow, and crisp dual wet corneal catchlights.
  vec2 euv = (vMapUv - vec2(0.5, 0.875)) * 8.0 - vec2(0.497, 0.5);
  float er = length(euv);
  vec2 edir = euv / max(er, 0.0001);
  float et = er / 0.092; // 0 pupil centre .. 1 iris edge
  float efib = vnoise(vec3(edir * 8.5, et * 3.0));
  float efib2 = vnoise(vec3(edir * 22.0, et * 6.0 + 3.1));
  float efv = 0.58 + 0.58 * efib + 0.34 * (efib2 - 0.5);
  vec3 eic = max(uC[9], vec3(0.035, 0.025, 0.018));
  vec3 eiris = eic * mix(2.35, 1.15, smoothstep(0.38, 0.94, et)) * efv;
  // Warm sunlit inner collarette ring around the pupil
  eiris += (eic * 0.95 + vec3(0.055, 0.034, 0.012)) * smoothstep(0.32, 0.44, et) * (1.0 - smoothstep(0.48, 0.68, et));
  // Crisp dark limbal ring framing the outer iris boundary
  eiris *= 1.0 - 0.78 * smoothstep(0.76, 0.99, et);
  float eir = 1.0 - smoothstep(0.95, 1.02, et);

  // Realistic bright warm-ivory sclera with subtle corner vascularity & pink inner caruncle
  float eedge = smoothstep(0.15, 0.30, er);
  float eveins = 1.0 - abs(2.0 * vnoise(vHn * 58.0) - 1.0);
  eveins = eveins * eveins * eveins * eveins;
  vec3 esc = vec3(0.86, 0.84, 0.81);
  esc = mix(esc, vec3(0.76, 0.42, 0.38), clamp(eveins * eedge * 0.48 + eedge * 0.09, 0.0, 1.0));
  esc *= mix(1.0, 0.76, eedge);
  esc = mix(esc, vec3(0.64, 0.27, 0.24), (1.0 - smoothstep(0.19, 0.29, abs(vHn.x))) * 0.75);

  vec3 ecol = mix(esc, eiris, eir);
  // Crisp deep jet-black pupil
  ecol = mix(ecol, vec3(0.003), (1.0 - smoothstep(0.33, 0.39, et)) * eir);
  // Natural soft cast shadow from upper eyelid & lower lid ambient occlusion
  float elid = 1.0 - 0.46 * smoothstep(0.014, 0.072, vHn.y) - 0.14 * (1.0 - smoothstep(-0.052, -0.012, vHn.y));
  // Dual wet corneal catchlights (primary sky window glint + secondary bounce pinpoint) so eyes look truly alive
  float egl1 = 1.0 - smoothstep(0.0, 0.020, length(euv - vec2(0.026, 0.028)));
  float egl2 = 1.0 - smoothstep(0.0, 0.012, length(euv - vec2(-0.028, -0.022)));
  col = ecol * elid + vec3(0.95, 0.97, 1.0) * (egl1 * egl1 * 0.82 * eir + egl2 * egl2 * 0.28 * eir);
  rough = mix(0.10, 0.025, eir);
  flatN = 1.0;
  bumpH = 0.0011 * (1.0 - min(et * et, 1.0));
`;
