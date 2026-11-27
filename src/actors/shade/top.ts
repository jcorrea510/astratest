/**
 * Person shader, TOPS (part 1: shirts, tees, hoodies, jackets, suits, dresses, uniforms). Fabric colour/pattern,
 * fabric micro structure (metres, fades out with screen-space derivatives) and garment construction details.
 * In scope as for skin.ts plus topId (uTop.w; ids in humanMaterial TOP_IDS), uC[1] top, uC[2] accent, uC[8] detail,
 * vCloth (torso: 0 hem-side .. 1 neck; arms: 0 shoulder .. 1 wrist), bumpH (micro height in metres, applied as a bump
 * after the normal map). Regions: ri 1 torso, 2 arms, 6 trims (collar bands, rib cuffs, hood roll, dress skirt).
 * Write col, rough and bumpH. TOP_PARS goes in the fragment header (after vnoise/hsh).
 * Units: torso cloth unit ~0.6 m, arm cloth unit ~0.6 m. Never use smoothstep with edge0 >= edge1.
 */
export const TOP_PARS = /* glsl */ `
float tpFade(float fw, float pitch) { return 1.0 - smoothstep(0.3 * pitch, 0.7 * pitch, fw); }
float tpAA(float d) { float w = fwidth(d) + 0.0003; return 1.0 - smoothstep(-w, w, d); }
float tpLine(float d, float hw) {
  float aa = max(fwidth(d), 0.0001);
  return (1.0 - smoothstep(hw - aa * 0.5, hw + aa, d)) * min(1.0, hw / aa);
}
float tpDuty(float x, float duty) {
  float fw = fwidth(x);
  float aa = fw * 6.28318 * max(sin(3.14159 * duty), 0.25) + 0.0005;
  float v = smoothstep(-aa, aa, cos(6.28318 * x) - cos(3.14159 * duty));
  return mix(v, duty, smoothstep(0.35, 0.8, fw));
}
float tpBox(vec2 p, vec2 c, vec2 h) {
  vec2 q = abs(p - c) - h;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
}
vec3 tpSat(vec3 c, float s) { float l = dot(c, vec3(0.299, 0.587, 0.114)); return mix(vec3(l), c, s); }
vec3 tpFabric(float k, vec2 q, float fw) {
  float h = 0.0; float sh = 1.0; float rg = 0.88;
  if (k < 0.5) {
    float f = tpFade(fw, 0.0013);
    float c = 0.5 + 0.5 * cos(6.28318 * (q.x / 0.0013 + 0.22 * sin(6.28318 * q.y / 0.001)));
    float slub = vnoise(vec3(q.x * 260.0, q.y * 34.0, 1.7));
    h = 0.00028 * c * f;
    sh = 0.94 + 0.12 * slub - 0.06 * f * (1.0 - c);
    rg = 0.9;
  } else if (k < 1.5) {
    float f = tpFade(fw, 0.0024);
    vec2 dd = abs(fract(vec2(q.x + q.y, q.x - q.y) / 0.0034) - 0.5);
    float w = clamp(1.0 - (dd.x + dd.y) * 1.6, 0.0, 1.0);
    h = 0.0004 * w * f;
    sh = 0.93 + 0.11 * vnoise(vec3(q.x * 240.0, q.y * 40.0, 4.1)) - 0.06 * f * (1.0 - w);
    rg = 0.88;
  } else if (k < 2.5) {
    float f = tpFade(fw, 0.0009);
    float over = sin(6.28318 * q.x / 0.0009) * sin(6.28318 * q.y / 0.0009);
    float warp = vnoise(vec3(q.x * 520.0, q.y * 30.0, 2.9));
    h = 0.00016 * over * f;
    sh = 0.95 + 0.07 * warp + 0.04 * over * f;
    rg = 0.84;
  } else if (k < 3.5) {
    float f = tpFade(fw, 0.0011);
    float ridge = 0.5 + 0.5 * cos(6.28318 * (q.x + q.y) / 0.0011);
    float weft = 0.8 + 0.2 * sin(6.28318 * q.y / 0.0011);
    h = 0.0003 * ridge * weft * f;
    sh = 0.93 + 0.1 * vnoise(vec3(q.x * 300.0, q.y * 60.0, 5.2)) + 0.04 * f * (ridge - 0.5);
    rg = 0.8;
  } else if (k < 4.5) {
    float f = tpFade(fw, 0.0008);
    float ridge = 0.5 + 0.5 * cos(6.28318 * (q.x + q.y) / 0.0008);
    float fuzz = vnoise(vec3(q.x * 900.0, q.y * 900.0, 0.5));
    h = (0.00018 * ridge + 0.00014 * fuzz) * f;
    sh = 0.92 + 0.14 * vnoise(vec3(q.x * 180.0, q.y * 260.0, 9.0)) + 0.03 * f * ridge;
    rg = 0.82;
  } else if (k < 5.5) {
    float f = tpFade(fw, 0.0014);
    h = 0.00035 * vnoise(vec3(q.x * 700.0, q.y * 700.0, 3.3)) * f + 0.0009 * vnoise(vec3(q.x * 70.0, q.y * 70.0, 1.9));
    sh = 0.92 + 0.14 * vnoise(vec3(q.x * 330.0, q.y * 330.0, 7.7));
    rg = 0.97;
  } else {
    float f = tpFade(fw, 0.0026);
    float n = vnoise(vec3(q.x * 380.0, q.y * 380.0, 6.1));
    float wear = vnoise(vec3(q.x * 26.0, q.y * 26.0, 8.3));
    h = 0.00035 * (1.0 - abs(2.0 * n - 1.0)) * f;
    sh = 0.88 + 0.22 * wear;
    rg = 0.36 + 0.22 * (1.0 - wear);
  }
  return vec3(h, sh, rg);
}
`;

export const TOP_GLSL = /* glsl */ `  // fabric coordinates in metres: tq.x runs around the body, tq.y up
  vec2 tq = vec2(vBind.x * abs(bn.z) + vBind.z * abs(bn.x), vBind.y);
  float tfw = max(fwidth(tq.x), fwidth(tq.y));
  bool kJersey = topId < 2.5;
  bool kFleece = topId > 2.5 && topId < 3.5;
  bool kJacket = topId > 3.5 && topId < 4.5;
  bool kSuit = topId > 4.5 && topId < 5.5;
  bool kShirt = topId > 5.5 && topId < 6.5;
  bool kPolo = topId > 6.5 && topId < 7.5;
  bool kDress = topId > 7.5 && topId < 8.5;
  bool kUni = topId > 8.5 && topId < 9.5;
  bool kBlouse = topId > 9.5;
  bool kTank = topId > 0.5 && topId < 1.5;
  bool kButtoned = kShirt || kPolo || kUni || kBlouse;
  float fabK = kJersey ? 0.0 : kPolo ? 1.0 : (kShirt || kDress || kBlouse) ? 2.0 : (kUni || kJacket) ? 3.0 : kSuit ? 4.0 : kFleece ? 5.0 : 6.0;
  float cx = abs(vBind.x);
  float hgt = 0.0;
  float pInk = 0.0;
  col = uC[1];
  float pat = uPat.x;
  if (pat > 0.5 && pat < 1.5) col = mix(uC[1], uC[2], tpDuty(vBind.y * 16.0 - 0.81, 0.38));
  else if (pat > 1.5 && pat < 2.5) {
    float pa = tpDuty(vBind.x * 11.0 - 0.5, 0.5), pb = tpDuty(vBind.y * 11.0 - 0.75, 0.5);
    col = mix(uC[1], uC[2], (pa + pb) * 0.3);
    col = mix(col, uC[8], (tpDuty(vBind.x * 22.0 - 0.965, 0.07) + tpDuty(vBind.y * 22.0 - 0.965, 0.07)) * 0.25);
  } else if (pat > 2.5 && pat < 3.5 && ri == 1) {
    // printed graphic: ring and dot, slightly cracked ink
    vec2 gc = vec2(vBind.x, vBind.y - (uBody.y + 0.02));
    float gr = length(gc / vec2(1.0, 1.15));
    float ink = tpAA(gr - 0.07) * (1.0 - tpAA(gr - 0.045)) + tpAA(gr - 0.028);
    float crack = vnoise(vBind * 210.0);
    float crackM = smoothstep(0.16, 0.3, crack) * (0.75 + 0.25 * vnoise(vBind * 55.0 + 3.7));
    ink *= front * mix(0.85, crackM, tpFade(tfw, 0.0047));
    pInk = clamp(ink, 0.0, 1.0);
    col = mix(col, uC[2], pInk);
  } else if (pat > 3.5 && pat < 4.5 && ri == 2) col = uC[2];
  else if (pat > 4.5 && pat < 5.5) col = mix(col, clamp(col * 1.9 + 0.025, 0.0, 0.6), 0.5 * tpDuty(vBind.x * 83.0 - 0.5, 0.06)); // pinstripe: 1.2 cm pitch, 0.7 mm line, low contrast tone-on-tone
  else if (pat > 5.5 && pat < 6.5) { // woodland camo: three noise blobs
    float n1 = vnoise(vBind * 9.0), n2 = vnoise(vBind * 14.0 + 7.3), n3 = vnoise(vBind * 21.0 + 2.1);
    col = mix(col, uC[2], smoothstep(0.52, 0.56, n1)); col = mix(col, uC[2] * 0.45, smoothstep(0.58, 0.62, n2)); col = mix(col, col * 1.35 + 0.03, smoothstep(0.62, 0.66, n3));
  } else if (pat > 6.5) { // houndstooth: broken check
    vec2 hq = vec2(vBind.x, vBind.y) * 60.0;
    vec2 hf = fract(hq);
    float chk = ((hf.x > 0.5) == (hf.y > 0.5)) ? 1.0 : 0.0;
    float tooth = step(hf.x + hf.y, 0.75) * step(0.5, hf.x) * (1.0 - step(0.5, hf.y));
    float hv = mix(0.45, clamp(chk + tooth, 0.0, 1.0), tpFade(max(fwidth(hq.x), fwidth(hq.y)), 0.5));
    col = mix(col, uC[2], hv * 0.85);
  }
  // realistic dyes: slightly desaturated per fibre, never pure black or pure white
  float dyeSat = kSuit ? 0.86 : kJacket ? 0.95 : kFleece ? 0.9 : kJersey ? 0.93 : 0.91;
  col = tpSat(col, dyeSat);
  col = clamp(col, 0.02, 0.84);
  // fabric micro structure
  vec3 fb = tpFabric(fabK, tq, tfw);
  col *= fb.y; rough = fb.z; hgt = fb.x;
  if (kJacket) rough = max(rough, 0.74); // matte shell fabric, never wet-look

  if (ri == 1) {
    float dHem = (vCloth - uTop.y) * 0.6;
    float sideD = sqrt(2.0 * max(1.0 - abs(bn.x), 0.000001)) * 0.17;
    float dNeck = length((vBind.xz - uNeck.xy) * vec2(1.0, 1.2)) - uNeck.z;
    float back = 1.0 - smoothstep(-0.5, -0.1, bn.z);
    float stiff = (kJacket || kSuit) ? 0.45 : kFleece ? 0.8 : 1.0;
    // side seam (stitched groove) below the armpit
    float sSeam = tpLine(sideD, 0.0011) * (1.0 - smoothstep(0.74, 0.84, vCloth)) * smoothstep(0.0, 0.01, dHem);
    col *= 1.0 - 0.2 * sSeam; hgt -= 0.0004 * sSeam;
    // hem: double-stitched fold (rib band on hoodies and jackets)
    float hemW = (kJacket || kFleece) ? 0.075 : kSuit ? 0.0 : 0.02;
    if (hemW > 0.0) {
      float hemM = 1.0 - smoothstep(hemW, hemW + 0.01, dHem);
      float ribH = 0.5 + 0.5 * cos(6.28318 * tq.x / 0.0045);
      float ribOnH = (kJacket || kFleece) ? 1.0 : 0.0;
      float ribF = tpFade(tfw, 0.0045) * ribOnH;
      col *= 1.0 - 0.08 * hemM - 0.06 * ribF * hemM * (1.0 - ribH);
      hgt += hemM * (0.0006 + 0.0005 * ribH * ribF);
      rough = mix(rough, 0.95, ribOnH * hemM);
      col *= 1.0 - 0.22 * tpLine(abs(dHem - hemW), 0.0009) * step(0.0, dHem);
    }
    col *= 0.86 + 0.14 * smoothstep(0.0, 0.012, dHem);
    // neckband / collar stand: darker band with a stitched edge, ribbed on knits
    float neckW = (kTank || kDress) ? 0.014 : kJersey ? 0.018 : kFleece ? 0.035 : 0.03;
    float neckHi = smoothstep(0.8, 0.9, vCloth);
    float nb = (1.0 - smoothstep(neckW, neckW + 0.004, dNeck)) * neckHi;
    float nAng = atan(vBind.x - uNeck.x, vBind.z - uNeck.y) * max(uNeck.z, 0.05);
    float ribN = 0.5 + 0.5 * cos(6.28318 * nAng / 0.0035);
    float ribNOn = (kJersey || kFleece || kPolo) ? tpFade(tfw, 0.0035) : 0.0;
    col *= 1.0 - nb * (0.07 + 0.1 * (1.0 - smoothstep(0.0, 0.006, dNeck)) + 0.07 * ribNOn * (1.0 - ribN));
    hgt += nb * (0.0006 + 0.0004 * ribN * ribNOn);
    col *= 1.0 - 0.22 * tpLine(abs(dNeck - neckW), 0.0009) * neckHi;
    // shoulder seam: runs across the top of the shoulder just in front of the crest
    float shSeam = tpLine(abs(bn.z - 0.12) * 0.17, 0.0011) * smoothstep(0.86, 0.92, vCloth) * smoothstep(uNeck.z + 0.01, uNeck.z + 0.04, cx) * (1.0 - smoothstep(0.16, 0.2, cx)) * (kTank ? 0.0 : 1.0);
    col *= 1.0 - 0.18 * shSeam; hgt -= 0.0003 * shSeam;
    // soft creases: diagonal drape from the armpit, horizontal bunching above the waist
    float armM = smoothstep(0.35, 0.8, abs(bn.x)) * smoothstep(0.52, 0.66, vCloth) * (1.0 - smoothstep(0.84, 0.94, vCloth));
    float f1 = pow(0.5 + 0.5 * sin(vBind.y * 85.0 - cx * 160.0 + vnoise(vBind * 14.0) * 4.0), 3.0);
    col *= 1.0 - 0.14 * f1 * armM * stiff;
    hgt += 0.0025 * f1 * armM * stiff;
    float wM = smoothstep(0.02, 0.12, dHem) * (1.0 - smoothstep(0.14, 0.3, dHem));
    float f2 = pow(0.5 + 0.5 * sin(vBind.y * 62.0 + vnoise(vec3(vBind.x * 8.0, vBind.y * 5.0, vBind.z * 8.0)) * 6.0), 2.0);
    col *= 1.0 - 0.1 * f2 * wM * stiff * (0.6 + 0.4 * front);
    hgt += 0.002 * f2 * wM * stiff;

    if (kButtoned) {
      // placket with stitched edge, buttons (domed, plastic), pockets and badges on uniforms
      float plLo = kPolo ? 0.775 : uTop.y;
      float plM = front * step(plLo, vCloth);
      col *= 1.0 - 0.28 * tpLine(abs(cx - 0.0155), 0.0007) * plM;
      col *= 1.0 - 0.3 * tpLine(cx, 0.0006) * plM;
      hgt += 0.0005 * plM * tpAA(cx - 0.0155) * (kPolo ? 1.0 : 0.5);
      float bsp = kPolo ? 0.05 : kUni ? 0.085 : 0.078;
      float rB = kUni ? 0.0058 : kPolo ? 0.0045 : 0.005;
      float bd = length(vec2(vBind.x, (fract(vBind.y / bsp) - 0.5) * bsp));
      float bm = front * step(plLo + 0.03, vCloth) * (1.0 - step(0.955, vCloth));
      float btn = tpAA(bd - rB) * bm;
      vec3 bcol = kUni ? uC[2] * 0.9 : clamp(col * 1.3 + 0.02, 0.0, 0.8);
      bcol *= 1.0 - 0.18 * tpAA(bd - rB * 0.45);
      col *= 1.0 - 0.22 * (1.0 - smoothstep(rB, rB * 1.9, bd)) * bm * (1.0 - btn);
      col = mix(col, bcol, btn);
      rough = mix(rough, 0.34, btn);
      hgt += 0.0012 * btn * max(1.0 - (bd / rB) * (bd / rB), 0.0);
      if (kShirt || kUni) {
        vec2 pcen = vec2(0.092, uBody.y + 0.015);
        float psx = kUni ? cx : vBind.x;
        float psd = tpBox(vec2(psx, vBind.y), pcen, vec2(0.047, 0.052));
        float pk = front * (kUni ? 1.0 : step(0.0, vBind.x));
        col *= 1.0 - 0.3 * tpLine(abs(psd), 0.0009) * pk;
        col *= 1.0 - 0.26 * tpLine(abs(psd + 0.004), 0.0007) * pk;
        col *= 1.0 - 0.1 * pk * step(0.0, psd) * (1.0 - smoothstep(0.0, 0.01, psd));
        hgt += 0.0007 * pk * tpAA(psd);
        if (kUni) col *= 1.0 - 0.3 * tpLine(abs(vBind.y - (pcen.y + 0.03)), 0.0008) * pk * tpAA(psd + 0.002);
      }
      if (kUni) {
        // police uniform: shield badge on the left chest, name plate on the right
        vec2 bgd = vec2(vBind.x - 0.092, (vBind.y - uBody.y - 0.05) * 0.85);
        float br = length(bgd);
        float badge = tpAA(br - 0.022) * front;
        col = mix(col, uC[2], badge);
        col *= 1.0 - 0.35 * tpLine(abs(br - 0.0125), 0.0012) * badge;
        hgt += 0.0008 * badge;
        rough = mix(rough, 0.32, badge);
        vec2 np = vec2(vBind.x + 0.09, vBind.y - uBody.y - 0.04);
        float nplate = tpAA(tpBox(np, vec2(0.0), vec2(0.03, 0.006))) * front;
        float nx = vBind.x * 230.0;
        float ntk = step(0.45, hsh(vec3(floor(nx), 1.0, 2.0))) * step(0.3, fract(nx)) * (1.0 - step(0.75, fract(nx)));
        ntk = mix(0.35, ntk, tpFade(fwidth(nx), 1.0));
        col = mix(col, mix(vec3(0.03), vec3(0.75), ntk), nplate);
        hgt += 0.0004 * nplate;
        rough = mix(rough, 0.4, nplate);
      }
    } else if (kFleece) {
      // kangaroo pocket (stitched, slanted hand openings) and drawstrings
      float pd = tpBox(vec2(vBind.x, dHem), vec2(0.0, 0.13), vec2(0.115, 0.05));
      float pockM = front * tpAA(pd);
      col *= 1.0 - 0.1 * pockM;
      col *= 1.0 - 0.3 * tpLine(abs(pd), 0.0009) * front;
      col *= 1.0 - 0.2 * tpLine(abs(pd + 0.004), 0.0007) * front;
      hgt += 0.0009 * pockM;
      float slx = abs(cx - (0.12 - (dHem - 0.08) * 0.2));
      float slM = front * smoothstep(0.075, 0.09, dHem) * (1.0 - smoothstep(0.17, 0.185, dHem));
      float slit = tpLine(slx, 0.0035) * slM;
      col *= 1.0 - 0.5 * slit; hgt -= 0.002 * slit;
      float cordX = abs(cx - 0.037 - 0.004 * sin(vCloth * 60.0));
      float cordM = front * smoothstep(0.73, 0.745, vCloth) * (1.0 - smoothstep(0.92, 0.935, vCloth));
      float cord = tpLine(cordX, 0.0028) * cordM;
      float twist = 0.5 + 0.5 * sin(vBind.y * 700.0 + cx * 300.0);
      float twistF = tpFade(fwidth(vBind.y), 0.0045);
      col = mix(col, uC[2] * (0.85 + 0.2 * mix(0.5, twist, twistF)), cord);
      rough = mix(rough, 0.85, cord);
      hgt += 0.0007 * cord * mix(0.5, twist, twistF);
      float agl = front * step(0.73, vCloth) * (1.0 - step(0.755, vCloth)) * tpLine(cordX, 0.0032);
      col = mix(col, vec3(0.06), agl * 0.8);
      rough = mix(rough, 0.45, agl);
    } else if (kJacket) {
      // open bomber over a tee: zip tape and teeth along the opening, yoke seam, slanted slit pockets
      float eo = 0.045 + 0.03 * smoothstep(0.75, 0.98, vCloth);
      float opn = front * tpAA(cx - eo);
      vec3 teeC = clamp(tpSat(uC[2], 0.88), 0.02, 0.6) * (0.93 + 0.1 * vnoise(vec3(tq.x * 240.0, tq.y * 34.0, 1.3)));
      col = mix(col, teeC, opn);
      rough = mix(rough, 0.9, opn);
      hgt *= 1.0 - opn;
      float outer = front * (1.0 - tpAA(cx - eo));
      float zTape = outer * tpAA(cx - eo - 0.011);
      float zTeeth = outer * tpAA(cx - eo - 0.0035);
      float zt = tpDuty(vBind.y / 0.0036, 0.5);
      col = mix(col, vec3(0.045), zTape);
      col = mix(col, vec3(0.42, 0.4, 0.37) * (0.7 + 0.5 * zt), zTeeth);
      rough = mix(rough, 0.3, zTeeth);
      hgt += 0.0005 * zTeeth * zt - 0.0003 * zTape;
      col *= 1.0 - 0.42 * tpLine(abs(cx - eo), 0.0014) * front; // visible edge seam of the open front
      col *= 1.0 - 0.3 * opn * (1.0 - smoothstep(0.0, 0.022, eo - cx)); // shadow of the shell on the top beneath
      hgt += 0.0007 * front * (1.0 - opn) * (1.0 - smoothstep(0.0, 0.012, cx - eo)); // rolled edge lip
      float yd = (vCloth - 0.8) * 0.6;
      float yk = max(tpLine(abs(yd), 0.001), tpLine(abs(yd + 0.0045), 0.001)) * (1.0 - opn);
      col *= 1.0 - 0.28 * yk; hgt -= 0.0004 * yk;
      float slx = abs(cx - (0.125 - (dHem - 0.085) * 0.25));
      float slM = front * smoothstep(0.08, 0.1, dHem) * (1.0 - smoothstep(0.17, 0.19, dHem));
      float slit = tpLine(slx, 0.0025) * slM;
      col *= 1.0 - 0.55 * slit; hgt -= 0.0018 * slit;
      float bseam = tpLine(cx, 0.001) * back;
      col *= 1.0 - 0.22 * bseam; hgt -= 0.0003 * bseam;
    } else if (kSuit) {
      // suit jacket: shirt V with tie, lapels with edge stitching, buttons, flap and welt pockets, centre back seam
      float vt = clamp((vCloth - 0.5) / 0.47, 0.0, 1.0);
      float vHalf = 0.062 * vt;
      float lapW = (0.032 + 0.034 * smoothstep(0.0, 0.7, vt)) * smoothstep(0.0, 0.15, vt) * (1.0 - 0.5 * smoothstep(0.75, 1.0, vt));
      float dV = cx - vHalf;
      float dLap = cx - (vHalf + lapW);
      float above = step(0.5, vCloth);
      float fa = front * above;
      float shirtM = fa * tpAA(dV);
      float lapM = fa * (1.0 - tpAA(dV)) * tpAA(dLap) * (1.0 - step(0.99, vCloth));
      vec3 shC = tpSat(uC[2], 0.92) * (0.93 + 0.08 * vnoise(vec3(tq.x * 420.0, tq.y * 30.0, 2.2)));
      col = mix(col, shC, shirtM);
      col *= 1.0 - 0.3 * shirtM * (1.0 - smoothstep(0.0, 0.012, -dV));
      float tw = mix(0.0165, 0.009, smoothstep(0.6, 0.93, vCloth));
      float tieM = shirtM * tpAA(cx - tw);
      vec3 tieC = uC[8] * (0.82 + 0.3 * tpDuty((vBind.y + vBind.x) * 55.0, 0.35));
      col = mix(col, tieC, tieM);
      rough = mix(rough, 0.42, tieM);
      rough = mix(rough, 0.62, lapM);
      col *= 1.0 + 0.05 * lapM;
      hgt = mix(hgt, 0.0, shirtM) + 0.0012 * lapM + 0.0004 * tieM;
      col *= 1.0 - 0.32 * tpLine(abs(dV), 0.0015) * fa;
      col *= 1.0 - 0.3 * tpLine(abs(dLap), 0.0013) * fa;
      col *= 1.0 - 0.22 * tpLine(abs(dLap + 0.006), 0.0006) * lapM;
      float below = 1.0 - above;
      col *= 1.0 - 0.35 * tpLine(cx, 0.0012) * front * below;
      float bdA = length(vec2(vBind.x, (vCloth - 0.44) * 0.6));
      float bdB = length(vec2(vBind.x, (vCloth - 0.36) * 0.6));
      float bdm = min(bdA, bdB);
      float sBtn = tpAA(bdm - 0.0085) * front;
      col = mix(col, uC[8] * 0.6, sBtn);
      rough = mix(rough, 0.3, sBtn);
      hgt += 0.0014 * sBtn * max(1.0 - (bdm / 0.0085) * (bdm / 0.0085), 0.0);
      col *= 1.0 - 0.25 * tpLine(abs(bdm - 0.0085), 0.0008) * front;
      vec2 hp = vec2(cx, dHem);
      float hpd = tpBox(hp, vec2(0.115, 0.08), vec2(0.05, 0.011));
      col *= 1.0 - 0.32 * tpLine(abs(hpd), 0.0011) * front;
      col *= 1.0 - 0.15 * front * step(0.0, hpd) * (1.0 - smoothstep(0.0, 0.012, hpd)) * step(hp.y, 0.08);
      hgt += 0.0012 * front * tpAA(hpd);
      float wd = tpBox(vBind.xy, vec2(0.105, uBody.y - 0.03), vec2(0.03, 0.0035));
      col *= 1.0 - 0.5 * tpAA(wd) * front * step(0.0, vBind.x);
      float sbseam = tpLine(cx, 0.001) * back;
      col *= 1.0 - 0.25 * sbseam; hgt -= 0.0003 * sbseam;
    }
    // worn dye at the shoulders and hem edge
    float wearZ = smoothstep(0.9, 1.0, vCloth) + (1.0 - smoothstep(0.0, 0.03, dHem)) * 0.6;
    col = mix(col, tpSat(col, 0.75) * 1.1 + 0.012, 0.16 * wearZ * vnoise(vBind * 11.0));
  } else if (ri == 2) {
    // sleeves: hem fold or cuff band with stitching, armhole seam, elbow and armpit creases
    float dSl = (uTop.x - vCloth) * 0.6;
    float cw = (kJacket || kFleece) ? 0.06 : (kShirt || kUni || kBlouse) ? 0.05 : kPolo ? 0.03 : 0.0;
    float slW = max(cw, 0.02);
    float sM = 1.0 - smoothstep(slW, slW + 0.01, dSl);
    col *= 0.9 + 0.1 * smoothstep(0.0, 0.012, dSl);
    col *= 1.0 - 0.07 * sM;
    col *= 1.0 - 0.22 * tpLine(abs(dSl - slW), 0.0009) * step(0.0, dSl);
    hgt += 0.0006 * sM;
    if (cw > 0.0) {
      float cuffSh = step(cw, dSl) * (1.0 - smoothstep(cw, cw + 0.014, dSl));
      col *= 1.0 - 0.1 * cuffSh;
      rough = mix(rough, (kJacket || kFleece) ? 0.95 : rough, sM);
    }
    col *= 1.0 - 0.2 * tpLine(abs(vCloth * 0.6 - 0.016), 0.001) * (kTank ? 0.0 : 1.0);
    float stf = (kJacket || kSuit) ? 0.5 : 1.0;
    float ec = vCloth - 0.5;
    float em = 1.0 - smoothstep(0.0, 0.1, abs(ec));
    float ecr = pow(0.5 + 0.5 * sin(ec * 310.0 + 3.0 * vnoise(vBind * 22.0)), 2.0);
    float eamp = 0.55 + 0.45 * sin(vBind.x * 60.0 + vBind.z * 50.0 + vBind.y * 40.0);
    col *= 1.0 - 0.2 * ecr * em * eamp * stf;
    hgt += 0.0013 * ecr * em * eamp * stf;
    float ag = 1.0 - smoothstep(0.04, 0.16, vCloth);
    float af = pow(0.5 + 0.5 * sin(vBind.x * 70.0 + vBind.z * 70.0 + vCloth * 200.0), 2.0);
    col *= 1.0 - 0.1 * af * ag * stf;
    col = mix(col, tpSat(col, 0.75) * 1.1 + 0.012, 0.12 * em * vnoise(vBind * 11.0));
  } else if (ri == 6) {
    // trim pieces: collar bands, rib cuffs and hem bands, hood roll, dress skirt
    if (kDress) {
      float dang = atan(vBind.x, vBind.z - uBody.w);
      float dfold = pow(0.5 + 0.5 * sin(dang * 14.0 + 3.0 * vnoise(vBind * 8.0)), 2.0);
      col *= 1.0 - 0.14 * dfold;
      hgt += 0.004 * dfold;
    } else {
      float ribT = 0.5 + 0.5 * cos(6.28318 * tq.x / 0.0042);
      float ribOn = (kJersey || kFleece || kPolo || kJacket) ? 1.0 : 0.0;
      float rf = tpFade(tfw, 0.0042) * ribOn;
      col *= 0.93 - 0.07 * rf * (1.0 - ribT);
      hgt += 0.0004 * ribT * rf;
      rough = mix(rough, 0.95, ribOn);
    }
  }
  // printed ink sits on top of the weave: smoother, slightly glossy
  rough = mix(rough, 0.52, pInk);
  hgt = hgt * (1.0 - 0.75 * pInk) + 0.0002 * pInk;
  col *= 0.97 + 0.06 * grain;
  rough = clamp(rough, 0.25, 1.0);
  // fabric sheen: cotton jersey matte, shirting and fleece fuzz a little, shell/suit/dress cloth most
  gSheen = (kJersey ? 0.03 : kFleece ? 0.2 : kPolo ? 0.08 : kJacket ? 0.22 : kSuit ? 0.3 : (kShirt || kBlouse || kUni) ? 0.14 : 0.26) * (1.0 - pInk);
  bumpH = hgt;
`;
