/**
 * Person shader, BOTTOMS and SHOES (part 3: jeans, trousers, shorts, skirts, sweats; part 4: shoes uC[4];
 * part 5: soles uC[5]). bs = uBottom.y (BOTTOM_IDS), uPat.w = shoe style (0 sneaker, 1 boot, 2 formal).
 * Write col, rough and bumpH (metres). BOTTOM_PARS goes in the fragment header (after hsh/vnoise).
 *
 * Coordinates: vBind is the bind-pose position (metres, y up, body faces +z, left leg at +x); bn is the smooth bind
 * normal (so bn.x is 0 on the front/back centre line of a leg and +-1 on its side seams); vCloth runs 0 (hip) to 0.5
 * (knee) to 1.0 (ankle) on a leg and 1.0..1.2 down the foot; on the pelvis it is the torso height (waist = uBottom.w).
 * Every high-frequency pattern fades to its mean with fwidth so distant legs do not shimmer. No `if` wraps a call that
 * takes derivatives (masks multiply instead), except on uniform values.
 */
export const BOTTOM_PARS = /* glsl */ `
// 1 where a pattern of frequency f (cycles per metre) is still resolved, fading to 0 when sub-pixel
float btAA(vec3 q, float f) {
  float fw = max(fwidth(q.x), max(fwidth(q.y), fwidth(q.z))) * f;
  return 1.0 - smoothstep(0.35, 1.0, fw);
}
// anti-aliased line of half width hw centred on c (same units as v)
float btLine(float v, float c, float hw) {
  float fw = fwidth(v) + 0.00001;
  return clamp((hw + 0.5 * fw - abs(v - c)) / fw, 0.0, 1.0);
}
// dashed stitching along u (metres) with pitch p; a faint solid line once the dashes are sub-pixel
float btDash(float u, float p) {
  float fw = fwidth(u) / p + 0.00001;
  float f = fract(u / p);
  float d = smoothstep(0.1, 0.1 + fw, f) * (1.0 - smoothstep(0.7, 0.7 + fw, f));
  return mix(d, 0.65, smoothstep(0.35, 0.9, fw));
}
// diagonal twill height 0..1 at yarn pitch p (metres), faded to its mean when the weave is sub-pixel
float btTwill(vec3 q, float p) {
  float d = (q.y + 0.6 * (q.x + q.z)) / p;
  float e = (q.x + q.z) / (p * 0.8);
  float a = 1.0 - smoothstep(0.35, 0.9, max(fwidth(d), fwidth(e)));
  float t = 0.7 * abs(fract(d) - 0.5) * 2.0 + 0.3 * abs(fract(e) - 0.5) * 2.0;
  return mix(0.5, t, a);
}
`;

export const BOTTOM_GLSL = /* glsl */ `  col = uC[3];
  float bs = uBottom.y, wl = uBottom.w, lc = vCloth;
  float lgF = ri == 3 ? 1.0 : 0.0, plF = 1.0 - lgF;
  float px = abs(vBind.x);
  float hm = lgF > 0.5 ? (uBottom.x - lc) * 0.85 : 1.0;
  float bkF = 1.0 - smoothstep(-0.5, -0.15, bn.z);
  float ou = step(0.0, bn.x * vBind.x);
  float ang = atan(bn.z, bn.x + 0.0001);
  float bl = dot(col, vec3(0.299, 0.587, 0.114));
  float jn = 1.0 - step(0.5, bs);
  float bsC = 1.0 - step(2.5, bs);
  float aaS = btAA(vBind, 260.0);
  float aaH = btAA(vBind, 340.0);
  float wear = 0.0, stitch = 0.0, rivet = 0.0, crease = 0.0, ro = 0.88;
  vec3 thread = col * 1.3 + vec3(0.02);
  if (bs < 0.5) { // denim: indigo twill, slubby, worn at thighs, knees, crotch whiskers and behind the knee
    float wv = btTwill(vBind, 0.0012);
    float sl = mix(0.5, vnoise(vec3(vBind.x * 300.0, vBind.y * 16.0, vBind.z * 300.0)), aaS);
    col *= (0.8 + 0.2 * wv) * (0.88 + 0.24 * sl);
    thread = vec3(0.62, 0.3, 0.035);
    wear = front * lgF * (1.0 - smoothstep(0.1, 0.42, lc)) * 0.6;
    wear += front * lgF * (1.0 - smoothstep(0.0, 0.1, abs(lc - 0.5))) * 0.75;
    float cr = front * (1.0 - smoothstep(0.03, 0.2, lc));
    wear += cr * smoothstep(0.6, 0.95, sin((vBind.y + px * 2.2) * 210.0)) * aaS * 0.8;
    float hc = 0.5 + 0.5 * sin((vBind.y + 0.012 * sin(vBind.x * 110.0)) * 330.0);
    wear += bkF * lgF * (1.0 - smoothstep(0.0, 0.1, abs(lc - 0.46))) * smoothstep(0.55, 0.9, hc) * aaH * 0.8;
    wear *= 0.55 + 0.9 * sl;
    col = mix(col, col * 0.7 + vec3(0.09, 0.11, 0.14), clamp(wear, 0.0, 1.0));
    bumpH += 0.0004 * (wv - 0.5) * (0.6 + 0.4 * sl);
    ro = 0.92;
  } else if (bs < 2.5) { // chino / dress trousers / shorts: fine twill, pressed crease on trousers
    float wv = btTwill(vBind, 0.0008);
    col *= (0.9 + 0.12 * wv) * (0.96 + 0.08 * mix(0.5, vnoise(vBind * 220.0), btAA(vBind, 220.0)));
    float dress = (1.0 - smoothstep(0.04, 0.12, bl)) * 0.65 + 0.35;
    crease = dress * lgF * smoothstep(0.04, 0.1, lc) * (1.0 - step(1.5, bs)) * btLine(bn.x, 0.0, 0.045);
    bumpH += 0.0003 * (wv - 0.5);
    ro = 0.84;
  } else if (bs < 3.5) { // skirt: light woven cloth with soft pleat folds
    float wv = btTwill(vBind, 0.0009);
    col *= 0.92 + 0.12 * wv;
    float pa = ang * 16.0;
    float pl = sin(pa + 0.8 * sin(vBind.y * 7.0)) * (1.0 - smoothstep(0.4, 1.0, fwidth(pa)));
    col *= 0.94 + 0.06 * pl;
    bumpH += 0.0008 * pl;
    ro = 0.8;
  } else { // sweats: brushed fleece, ribbed cuffs and waistband, drawstring, side stripe
    float fz = mix(0.5, vnoise(vBind * 700.0), btAA(vBind, 700.0));
    col *= 0.9 + 0.16 * grain + 0.1 * (fz - 0.5);
    bumpH += 0.0004 * (fz - 0.5);
    float cuf = lgF * step(0.9, uBottom.x) * (1.0 - smoothstep(0.055, 0.075, hm));
    float ribA = sin(ang * 40.0) * (1.0 - smoothstep(0.35, 0.9, fwidth(ang * 40.0)));
    col *= 1.0 - cuf * (0.12 + 0.1 * (0.5 - 0.5 * ribA));
    bumpH += 0.0011 * cuf * ribA;
    float wb = plF * smoothstep(wl - 0.075, wl - 0.07, lc);
    float ribW = sin(ang * 56.0) * (1.0 - smoothstep(0.35, 0.9, fwidth(ang * 56.0)));
    col *= 1.0 - wb * (0.06 + 0.06 * (0.5 - 0.5 * ribW));
    bumpH += 0.0008 * wb * ribW;
    float cordV = smoothstep(wl - 0.17, wl - 0.16, lc) * (1.0 - smoothstep(wl - 0.04, wl - 0.035, lc));
    float cord = plF * front * cordV * btLine(px, 0.022, 0.0035);
    col = mix(col, col * 1.4 + vec3(0.05), cord * 0.9);
    bumpH += 0.0008 * cord;
    float eye = plF * front * btLine(length(vec2(px - 0.05, (lc - (wl - 0.04)) * 0.55)), 0.0, 0.004);
    col = mix(col, vec3(0.012), eye * 0.85);
    float ss = lgF * smoothstep(0.6, 0.8, abs(bn.x)) * ou * btLine(bn.z, 0.0, 0.2);
    col = mix(col, uC[2], ss);
    ro = 0.97;
  }
  // belt loops, waistband seam, pockets, rivets (jeans, trousers, shorts)
  float lpx = min(abs(px - 0.075), abs(px - 0.17));
  float loopX = max(btLine(lpx, 0.0, 0.0065), bkF * btLine(px, 0.0, 0.0065));
  float loopV = smoothstep(wl - 0.125, wl - 0.115, lc) * (1.0 - smoothstep(wl - 0.04, wl - 0.03, lc));
  float loops = bsC * plF * loopX * loopV;
  col *= 1.0 - 0.1 * loops;
  bumpH += 0.0012 * loops;
  float wbU = mix(vBind.z, vBind.x, step(0.5, abs(bn.z)));
  stitch += jn * plF * btLine(lc, wl - 0.1, 0.0016) * btDash(wbU, 0.0045);
  float pd = (lc - (wl - 0.045 - 0.9 * clamp(px - 0.07, 0.0, 0.1))) * 0.55;
  float pk = plF * front * bsC * smoothstep(0.06, 0.07, px) * (1.0 - smoothstep(0.18, 0.2, px));
  float pdash = btDash(px, 0.0045);
  stitch += jn * pk * max(btLine(pd, 0.0, 0.0011), btLine(pd, -0.007, 0.0011)) * pdash;
  col *= 1.0 - 0.3 * (1.0 - jn) * pk * btLine(pd, 0.0, 0.0008);
  bumpH += 0.0006 * pk * btLine(pd, 0.0, 0.002);
  float bpx = px - 0.085;
  float bpy = (lc - (wl - 0.15)) * 0.55;
  float ybt = -0.045 - 0.04 * (1.0 - clamp(abs(bpx) / 0.058, 0.0, 1.0));
  float bpd = max(max(abs(bpx) - 0.058, bpy - 0.045), ybt - bpy);
  float bpm = plF * bkF * bsC;
  stitch += jn * bpm * btLine(bpd, -0.004, 0.0011) * btDash(vBind.x * 0.7 + vBind.y * 0.7, 0.0045);
  bumpH += 0.0007 * jn * bpm * btLine(bpd, 0.0, 0.0015);
  float welt = (1.0 - jn) * bpm * btLine(bpy, 0.035, 0.0025) * btLine(bpx, 0.0, 0.05);
  col *= 1.0 - 0.55 * welt;
  float rdB = min(length(vec2(bpx - 0.058, bpy - 0.045)), length(vec2(bpx + 0.058, bpy - 0.045)));
  float rdF = min(length(vec2(px - 0.07, (lc - (wl - 0.045)) * 0.55)), length(vec2(px - 0.17, (lc - (wl - 0.135)) * 0.55)));
  float rdW = length(vec2(vBind.x, (lc - (wl - 0.06)) * 0.55));
  rivet = jn * (bpm * btLine(rdB, 0.0, 0.0035) + plF * front * btLine(rdF, 0.0, 0.0035) + plF * front * btLine(rdW, 0.0, 0.0085));
  // side seams: topstitched twin rows on jeans (the outer seam gets a second pair), a ridge on everything
  float sd = smoothstep(0.55, 0.8, abs(bn.x));
  float ab = abs(bn.z);
  float rows = btLine(ab, 0.1, 0.012) + ou * btLine(ab, 0.17, 0.012);
  stitch += jn * sd * min(rows, 1.0) * btDash(vBind.y, 0.0045);
  bumpH += 0.0007 * sd * (1.0 - smoothstep(0.0, 0.07, ab)) * (0.4 + 0.6 * jn);
  // hem: turned-up band with a stitch row, rolled edge
  float hemRow = lgF * btLine(hm, 0.022, 0.0009) * btDash(ang * 0.075, 0.0045);
  stitch += hemRow * (jn + 0.35 * (1.0 - jn));
  float inHem = lgF * (1.0 - smoothstep(0.0205, 0.0235, hm)) * step(0.0, hm);
  col *= 1.0 - 0.07 * inHem;
  bumpH += lgF * (0.0006 * inHem + 0.0007 * btLine(hm, 0.022, 0.002));
  col *= 1.0 + 0.1 * lgF * btLine(hm, 0.0015, 0.0015);
  // road dirt on the hem of long legs
  float longF = lgF * step(0.9, uBottom.x);
  float dirt = longF * (1.0 - smoothstep(0.0, 0.1, hm)) * (0.35 + 0.65 * vnoise(vBind * vec3(40.0, 22.0, 40.0)));
  col = mix(col, col * 0.55 + vec3(0.02, 0.015, 0.008), dirt * 0.5);
  // bunching above the shoe and creases at the knee
  float bun = longF * smoothstep(0.76, 0.94, lc);
  float fl = sin(vBind.y * 150.0 + 4.0 * vnoise(vBind * 14.0)) * (1.0 - smoothstep(0.35, 0.9, fwidth(vBind.y * 150.0)));
  float kn = lgF * (1.0 - smoothstep(0.0, 0.1, abs(lc - 0.5)));
  float fk = sin((vBind.y + 0.01 * sin(vBind.x * 60.0)) * 190.0 + 3.0 * vnoise(vBind * 10.0)) * (1.0 - smoothstep(0.35, 0.9, fwidth(vBind.y * 190.0)));
  float fa = bun * fl + 0.8 * kn * fk;
  col *= 1.0 + 0.07 * fa - 0.04 * (bun + kn);
  bumpH += 0.0012 * fa;
  // pressed crease, thread, rivets
  col *= 1.0 + 0.1 * crease;
  bumpH += 0.0008 * crease;
  col = mix(col, thread, clamp(stitch, 0.0, 1.0) * 0.9);
  float rv = clamp(rivet, 0.0, 1.0);
  col = mix(col, vec3(0.42, 0.2, 0.09), rv);
  rough = clamp(ro - 0.1 * wear + 0.08 * dirt - 0.12 * crease, 0.2, 1.0);
  rough = mix(rough, 0.38, rv);
  gSheen = uBottom.y < 0.5 ? 0.04 : uBottom.y < 1.5 ? 0.24 : uBottom.y < 2.5 ? 0.2 : uBottom.y < 3.5 ? 0.2 : 0.06; // denim twill barely, wool trousers and skirts more
`;

export const SHOE_GLSL = /* glsl */ `  col = uC[4];
  float s = uPat.w;
  float h = vBind.y - uBody.x;
  float sn = 1.0 - step(0.5, s), sB = step(0.5, s) * (1.0 - step(1.5, s)), sF = step(1.5, s);
  float aaG = btAA(vBind, 650.0);
  float lea = mix(0.5, vnoise(vBind * 650.0), aaG);
  float lea2 = mix(0.5, vnoise(vBind * 120.0), btAA(vBind, 120.0));
  float toe = smoothstep(0.35, 0.7, bn.z);
  float upW = smoothstep(0.045, 0.06, h);
  float inst = smoothstep(0.45, 0.7, bn.y);
  float heel = 1.0 - smoothstep(-0.7, -0.35, bn.z);
  float shaft = step(vCloth, 1.0);
  // sneakers: breathable mesh on the side panels, leather heel counter, rubber toe bumper, off-white midsole
  float g = sin(vBind.z * 800.0) * sin(vBind.y * 800.0 + vBind.x * 300.0);
  float aaM = 1.0 - smoothstep(0.35, 0.9, fwidth(vBind.z * 800.0) + fwidth(vBind.y * 800.0));
  float meshM = sn * smoothstep(0.35, 0.5, abs(bn.x)) * (1.0 - toe) * (1.0 - heel) * upW;
  float hole = smoothstep(0.55, 0.85, g) * aaM;
  col = mix(col, col * 0.55, hole * meshM);
  col = mix(col, uC[2], sn * heel * upW * 0.85);
  float toeB = smoothstep(0.3, 0.6, bn.z) * (1.0 - smoothstep(0.05, 0.075, h));
  col = mix(col, uC[5], toeB * sn);
  float midS = sn * (1.0 - smoothstep(0.046, 0.052, h));
  col = mix(col, uC[5] * 0.97, midS);
  col *= 1.0 - 0.45 * sn * btLine(h, 0.04, 0.0007);
  // laces: crossing bars over the instep (sneaker, boot, formal) and up the boot shaft, eyelet rows
  float lz = vBind.z / 0.021;
  float lzf = fract(lz + abs(bn.x) * 1.4);
  float lzw = smoothstep(0.25, 0.6, fwidth(lz));
  float lace1 = mix(smoothstep(0.12, 0.22, lzf) * (1.0 - smoothstep(0.55, 0.65, lzf)), 0.43, lzw);
  float laceM = inst * upW * (1.0 - toe) * (1.0 - heel) * (1.0 - shaft * sB);
  float ly = vBind.y / 0.021;
  float lyf = fract(ly + abs(bn.x) * 1.4);
  float lyw = smoothstep(0.25, 0.6, fwidth(ly));
  float lace2 = mix(smoothstep(0.12, 0.22, lyf) * (1.0 - smoothstep(0.55, 0.65, lyf)), 0.43, lyw);
  float laceS = sB * shaft * smoothstep(0.3, 0.6, bn.z) * (1.0 - smoothstep(0.55, 0.8, abs(bn.x)));
  vec3 laceC = sn * vec3(0.78, 0.77, 0.74) + sB * vec3(0.3, 0.22, 0.12) + sF * (col * 1.15 + vec3(0.01));
  col = mix(col, laceC, clamp(laceM * lace1 * 0.9 + laceS * lace2 * 0.9, 0.0, 1.0));
  float eyeD = length(vec2((fract(lz) - 0.5) * 0.021, (abs(bn.x) - 0.5) * 0.05));
  float eyes = laceM * btLine(eyeD, 0.0, 0.0028);
  col = mix(col, vec3(0.02), eyes * 0.8);
  // leather: pebbled grain, collar, ankle wrinkles on boots, toe flex crease, welt stitching
  float crs = btLine(bn.z, 0.45, 0.05);
  col *= 1.0 - 0.12 * crs * (1.0 - sF * 0.5);
  float wr = sin(vBind.y * 170.0 + 3.0 * vnoise(vBind * 11.0)) * (1.0 - smoothstep(0.35, 0.9, fwidth(vBind.y * 170.0)));
  float ank = sB * shaft * smoothstep(0.88, 1.0, vCloth);
  col *= 1.0 + 0.06 * ank * wr;
  float collar = sB * shaft * (1.0 - smoothstep(0.8, 0.84, vCloth));
  col *= 1.0 - 0.25 * collar;
  float cap = sF * btLine(bn.z, 0.5, 0.012);
  col *= 1.0 - 0.5 * cap;
  col *= 1.0 - 0.2 * sF * smoothstep(0.55, 0.95, bn.z);
  float welt = (sB + sF) * btLine(h, 0.036, 0.0007) * btDash(vBind.z + vBind.x * 0.8, 0.004);
  col = mix(col, vec3(0.35, 0.25, 0.12), welt * 0.8);
  bumpH += (sB * 0.00025 + sF * 0.00012 + sn * 0.00005) * (lea - 0.5) * aaG;
  bumpH += 0.0005 * crs + 0.0012 * ank * wr + 0.0006 * collar;
  // scuffs on the toe and near the ground, grime on the midsole
  float scuff = smoothstep(0.62, 0.85, lea2) * clamp((1.0 - smoothstep(0.03, 0.09, h)) + toe * 0.8 * (1.0 - smoothstep(0.05, 0.12, h)), 0.0, 1.0);
  col = mix(col, col * 1.5 + vec3(0.03), scuff * 0.45);
  float grime = (1.0 - smoothstep(0.03, 0.07, h)) * lea2;
  col = mix(col, vec3(0.08, 0.065, 0.05), grime * 0.35 * sn);
  rough = sn * 0.68 + sB * 0.6 + sF * 0.28;
  rough += 0.2 * meshM * sn + 0.25 * scuff - 0.1 * sF * smoothstep(0.45, 0.75, bn.z);
  rough = clamp(rough, 0.15, 1.0);
`;

export const SOLE_GLSL = /* glsl */ `col = uC[5];
  float sa = btAA(vBind, 420.0);
  float sdn = smoothstep(0.4, 0.75, -bn.y);
  float sgr = sin((vBind.z + vBind.x * 0.7) * 380.0) * sa;
  float chev = (step(0.5, fract(abs(vBind.x) * 110.0 + vBind.z * 90.0)) - 0.5) * sa;
  float sgh = btLine(vBind.y - uBody.x, 0.012, 0.0008);
  col *= 1.0 - 0.08 * (1.0 - sdn) * (0.5 - 0.5 * sgr) - 0.25 * sdn * (0.5 + chev) - 0.18 * sgh;
  float sdt = mix(0.5, vnoise(vBind * 70.0), btAA(vBind, 70.0));
  col = mix(col, col * 0.5 + vec3(0.02, 0.016, 0.012), 0.1 + 0.3 * sdt);
  bumpH += 0.0004 * (1.0 - sdn) * sgr - 0.0012 * sdn * (0.5 + chev) - 0.0005 * sgh;
  rough = 0.82;
`;
