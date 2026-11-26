/**
 * Person shader, FACE: faceDetail() refines the skin of the head (ri == 0) after skin.ts has coloured it (lips, cheeks,
 * nose, brows, eye sockets, ears; vHn = head-space position: x right, y up (0 at brow, ~-1 at chin), z forward).
 * EYES_GLSL is part 9 (eyeballs): write col / rough / flatN. FACE_PARS goes in the fragment header.
 *
 * Measured on the UBC meshes (head coords = (p - headBoxCentre) / headBoxHalf; man and woman agree within ~0.02):
 *   eyes: centres (+-0.38, 0.04, 0.54), lid slit y -0.03..0.07, |x| 0.14..0.55; brows (mesh) y 0.11..0.27, arch peak |x| ~0.45;
 *   nose tip (0, -0.33); mouth line y -0.58, mouth corners |x| 0.30; ears |x| > 0.9, y -0.45..0.15.
 * Eyeball: a sphere (r 14.7 mm male / 16.2 mm female) whose atlas UV is azimuthal around the front pole (u,v) = (0.5, 0.5)
 * of its own 0.125 x 0.125 atlas slot at (0.5, 0.875): uv radius = 0.2 * angle-from-front (rad), so the iris (angle ~0.46 rad)
 * ends at uv radius 0.092.
 */
export const FACE_PARS = /* glsl */ `float fcG(float d, float w) { float q = d / w; return exp(-q * q); }
void faceDetail(inout vec3 col, inout float rough, vec3 hn, vec3 atlas) {
  float ax = abs(hn.x);
  float fz = smoothstep(0.35, 0.65, hn.z); // the front of the face only
  // eyebrows: soft hair-coloured haze under the brow mesh (arch above each eye socket, strand noise)
  if (fz > 0.0 && hn.y > 0.04 && hn.y < 0.38) {
    float byc = 0.115 + 0.095 * fcG(ax - 0.45, 0.28);
    float bw = 0.02 + 0.03 * fcG(ax - 0.4, 0.3);
    float bm = (1.0 - smoothstep(bw * 0.7, bw * 1.5, abs(hn.y - byc))) * smoothstep(0.1, 0.2, ax) * (1.0 - smoothstep(0.72, 0.88, ax)) * fz;
    float bs = vnoise(vec3(hn.x * 34.0 - hn.y * 22.0, hn.y * 150.0, 1.7));
    col = mix(col, uC[6] * 0.85, bm * (0.14 + 0.32 * bs));
  }
  // eye sockets: under-eye shadow, upper-lid crease
  if (fz > 0.0 && hn.y > -0.2 && hn.y < 0.2) {
    float ue = fcG(ax - 0.36, 0.2) * fcG(hn.y + 0.085, 0.045);
    col *= mix(vec3(1.0), vec3(0.9, 0.86, 0.9), ue * 0.55 * fz);
    float cq = (ax - 0.4) / 0.24;
    float yc = 0.108 + 0.035 * (1.0 - min(1.0, cq * cq));
    float cl = fcG(hn.y - yc, 0.011) * smoothstep(0.16, 0.24, ax) * (1.0 - smoothstep(0.52, 0.6, ax)) * fz;
    col = mix(col, col * vec3(0.62, 0.5, 0.46), cl * 0.55);
  }
  // cheeks blush, nose tip warmth, oily T-zone
  if (fz > 0.0 && hn.y > -0.5 && hn.y < 0.5) {
    float ch = fcG(ax - 0.5, 0.2) * fcG(hn.y + 0.27, 0.16);
    col *= mix(vec3(1.0), vec3(1.06, 0.93, 0.92), ch * 0.45 * fz);
    float ns = fcG(hn.x, 0.11) * fcG(hn.y + 0.33, 0.085) * fz;
    col *= mix(vec3(1.0), vec3(1.05, 0.92, 0.9), ns * 0.4);
    float tz = fcG(hn.x, 0.25) * fcG(hn.y - 0.35, 0.2) * fz;
    rough = rough - 0.05 * tz - 0.1 * ns;
  }
  // lips: colour, wet sheen, fine vertical lines, a darker line between the lips (pinched at the corners)
  if (fz > 0.0 && hn.y > -0.8 && hn.y < -0.38) {
    float lx = ax / 0.31;
    float ly = (hn.y + 0.585) / 0.088;
    float lip = (1.0 - smoothstep(0.8, 1.05, sqrt(lx * lx + ly * ly))) * fz;
    float lowerBias = 1.0 - smoothstep(-0.62, -0.58, hn.y);
    col = mix(col, col * vec3(1.12, 0.74, 0.76), lip * (0.28 + 0.18 * lowerBias));
    float ls = vnoise(vec3(hn.x * 90.0, hn.y * 6.0, 4.0));
    col *= 1.0 - lip * 0.09 * ls;
    float ml = fcG(hn.y + 0.578, 0.011) * (1.0 - smoothstep(0.55, 0.95, lx)) * fz;
    col = mix(col, col * vec3(0.55, 0.38, 0.38), ml * 0.7);
    rough = mix(rough, 0.34, lip * 0.75);
  }
  // ears: redder (blood shows through the thin cartilage), darker towards the canal
  float ear = smoothstep(0.84, 0.93, ax) * smoothstep(-0.55, -0.4, hn.y) * (1.0 - smoothstep(0.1, 0.25, hn.y));
  if (ear > 0.0) {
    col = mix(col, col * vec3(1.12, 0.8, 0.76), ear * 0.5);
    col *= 1.0 - 0.25 * fcG(ax - 0.97, 0.07) * fcG(hn.y + 0.17, 0.12) * ear;
  }
}
`;

export const EYES_GLSL = /* glsl */ `
  // eyeball: sclera, iris with radial fibres + limbal ring, pupil, wet glossy cornea. The atlas UV is azimuthal around the
  // front pole, so the radius from the slot centre is the angle from the gaze axis (iris edge at 0.092).
  vec2 euv = (vMapUv - vec2(0.5, 0.875)) * 8.0 - vec2(0.497, 0.5);
  float er = length(euv);
  vec2 edir = euv / max(er, 0.0001);
  float et = er / 0.092; // 0 pupil centre .. 1 iris edge
  float efib = vnoise(vec3(edir * 7.0, et * 2.5));
  float efib2 = vnoise(vec3(edir * 19.0, et * 5.0 + 3.1));
  float efv = 0.62 + 0.55 * efib + 0.3 * (efib2 - 0.5);
  vec3 eic = uC[9];
  vec3 eiris = eic * mix(2.1, 1.1, smoothstep(0.4, 0.95, et)) * efv;
  eiris += (eic * 0.9 + vec3(0.02, 0.012, 0.004)) * (1.0 - smoothstep(0.38, 0.65, et));
  eiris *= 1.0 - 0.7 * smoothstep(0.72, 1.0, et);
  float eir = 1.0 - smoothstep(0.96, 1.02, et);
  float eedge = smoothstep(0.16, 0.3, er);
  float eveins = 1.0 - abs(2.0 * vnoise(vHn * 55.0) - 1.0);
  eveins = eveins * eveins * eveins * eveins;
  vec3 esc = vec3(0.62, 0.59, 0.54);
  esc = mix(esc, vec3(0.62, 0.34, 0.3), clamp(eveins * eedge * 0.55 + eedge * 0.1, 0.0, 1.0));
  esc *= mix(1.0, 0.72, eedge);
  esc = mix(esc, vec3(0.55, 0.2, 0.17), (1.0 - smoothstep(0.2, 0.3, abs(vHn.x))) * 0.8);
  vec3 ecol = mix(esc, eiris, eir);
  ecol = mix(ecol, vec3(0.004), (1.0 - smoothstep(0.34, 0.4, et)) * eir);
  float elid = 1.0 - 0.55 * smoothstep(0.015, 0.07, vHn.y) - 0.12 * (1.0 - smoothstep(-0.05, -0.01, vHn.y));
  col = ecol * elid;
  rough = mix(0.16, 0.05, eir);
  flatN = 1.0;
  bumpH = 0.0009 * (1.0 - min(et * et, 1.0));
`;
