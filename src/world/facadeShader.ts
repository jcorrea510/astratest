/**
 * GLSL for the procedural building surfaces: brick, plaster, concrete, stone, siding and corrugated walls with
 * weathering; punched windows with frames, lintels and reveals; glass curtain walls; shopfronts; roofs.
 * Glass uses interior mapping (a ray traced fake room behind every window) so windows read as real rooms by
 * day and light up individually at night, while the PBR environment adds Fresnel reflections on top.
 *
 * Per-vertex attributes (metre-space uv: u along the wall, v up the wall):
 *   facade  = (kind, seed, cellW, cellH)
 *   facade2 = (winW, winH, sill, wallMat)
 *   facade3 = (gridOriginV, baseY, litProb, floors)
 * kind: 0 plain, 1 glass curtain wall, 2 punched windows, 3 solid wall, 4 shopfront, 5 flat roof, 6 shingle roof,
 *       7 roll-up door, 8 glass-block/vents band
 * wallMat: 0 brick, 1 plaster, 2 concrete, 3 stone, 4 wood siding, 5 corrugated metal, 6 painted brick, 7 metal panel
 */
export const FACADE_VERT_PARS = /* glsl */`
attribute vec4 facade; attribute vec4 facade2; attribute vec4 facade3;
flat varying vec4 vFacade; flat varying vec4 vFacade2; flat varying vec4 vFacade3;
varying vec2 vFUv; varying vec3 vWPos; varying vec3 vWN;
`;
export const FACADE_VERT_MAIN = /* glsl */`
vFacade = facade; vFacade2 = facade2; vFacade3 = facade3; vFUv = uv;
vWN = normalize(mat3(modelMatrix) * objectNormal);
`;
export const FACADE_VERT_WORLD = /* glsl */`
vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
`;

export const FACADE_FRAG_PARS = /* glsl */`
uniform float uNight;
flat varying vec4 vFacade; flat varying vec4 vFacade2; flat varying vec4 vFacade3;
varying vec2 vFUv; varying vec3 vWPos; varying vec3 vWN;
float fH(vec2 p){ p = mod(p, 289.0); vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float fN(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(fH(i), fH(i + vec2(1.0, 0.0)), f.x), mix(fH(i + vec2(0.0, 1.0)), fH(i + vec2(1.0, 1.0)), f.x), f.y); }
float fBm(vec2 p){ return fN(p) * 0.55 + fN(p * 2.07 + 3.1) * 0.28 + fN(p * 4.13 + 7.7) * 0.17; }
float boxMask(vec2 p, vec2 lo, vec2 hi, float aa){ vec2 d = min(p - lo, hi - p); return smoothstep(-aa, aa, min(d.x, d.y)); }

// wall material: albedo (modulates the vertex tint), bump height and roughness
void wallMaterial(float m, vec2 p, float pix, float seed, inout vec3 col, inout float h, inout float rough, inout float metal){
  float far = smoothstep(0.012, 0.05, pix);
  if (m < 0.5 || (m > 5.5 && m < 6.5)) { // brick (6: painted brick)
    vec2 bs = vec2(0.24, 0.078); vec2 q = p / bs; float row = floor(q.y); q.x += mod(row, 2.0) * 0.5;
    vec2 id = floor(q); vec2 f = fract(q);
    vec2 mw = vec2(0.012 / bs.x, 0.012 / bs.y);
    float aaX = pix / bs.x, aaY = pix / bs.y;
    float brick = smoothstep(mw.x - aaX, mw.x + aaX, f.x) * smoothstep(mw.x - aaX, mw.x + aaX, 1.0 - f.x) * smoothstep(mw.y - aaY, mw.y + aaY, f.y) * smoothstep(mw.y - aaY, mw.y + aaY, 1.0 - f.y);
    float v = fH(id + seed * 0.37);
    vec3 bc = col * (m < 0.5 ? mix(0.72, 1.14, v) * vec3(1.0 + (fH(id * 1.3) - 0.5) * 0.12, 1.0, 1.0 - (fH(id * 2.1) - 0.5) * 0.1) : vec3(mix(0.93, 1.04, v)));
    vec3 mort = m < 0.5 ? vec3(0.6, 0.57, 0.52) : col * 0.92;
    vec3 detail = mix(mort, bc, brick);
    vec3 avg = mix(mort, col * (m < 0.5 ? 0.93 : 0.99), 0.86);
    col = mix(detail, avg, far);
    h += (brick - 1.0) * 0.006 * (1.0 - far);
    rough = 0.9;
  } else if (m < 1.5) { // plaster / stucco
    col *= 0.9 + 0.16 * fBm(p * 0.6 + seed);
    h += fN(p * 9.0) * 0.0025 * (1.0 - far);
    rough = 0.93;
  } else if (m < 2.5) { // concrete panels
    vec2 ps = vec2(3.0, 1.5); vec2 f = fract(p / ps); vec2 id = floor(p / ps);
    float aa = pix / 1.5;
    float joint = 1.0 - smoothstep(0.006 - aa, 0.006 + aa, f.x) * smoothstep(0.006 - aa, 0.006 + aa, f.y);
    col *= (0.86 + 0.12 * fH(id + seed)) * (0.88 + 0.18 * fBm(p * 0.8 + seed));
    vec2 tf = fract(p / vec2(0.6, 0.5)) - 0.5; float tie = 1.0 - smoothstep(0.02, 0.035, length(tf * vec2(0.6, 0.5)));
    col *= 1.0 - (joint * 0.35 + tie * 0.25) * (1.0 - far);
    h -= (joint * 0.01 + tie * 0.004) * (1.0 - far);
    rough = 0.88;
  } else if (m < 3.5) { // dressed stone (ashlar)
    vec2 bs = vec2(0.9, 0.42); vec2 q = p / bs; q.x += mod(floor(q.y), 2.0) * 0.5; vec2 id = floor(q), f = fract(q);
    float aa = pix / bs.y;
    float stone = smoothstep(0.012 - aa, 0.012 + aa, min(min(f.x, 1.0 - f.x) * bs.x / bs.y, min(f.y, 1.0 - f.y)));
    col *= mix(0.88, 1.08, fH(id + seed)) * (0.94 + 0.1 * fN(p * 3.0));
    col = mix(col * 0.8, col, mix(stone, 1.0, far));
    h += (stone - 1.0) * 0.008 * (1.0 - far);
    rough = 0.85;
  } else if (m < 4.5) { // horizontal lap siding
    float f = fract(p.y / 0.2); float aa = pix / 0.2;
    float lip = smoothstep(0.0, 0.18 + aa, f);
    col *= mix(mix(0.72, 1.0, lip), 0.92, far) * (0.95 + 0.06 * fN(vec2(p.x * 0.4, floor(p.y / 0.2) * 7.0)));
    h += f * 0.012 * (1.0 - far);
    rough = 0.8;
  } else if (m < 5.5) { // corrugated metal
    float rib = sin(p.x * 6.2831 / 0.152);
    col *= mix(0.86 + 0.14 * rib, 0.93, far);
    float rust = smoothstep(0.55, 0.85, fBm(vec2(p.x * 0.9, p.y * 0.12) + seed));
    col = mix(col, vec3(0.42, 0.25, 0.15), rust * 0.55);
    h += rib * 0.012 * (1.0 - far);
    rough = mix(0.45, 0.85, rust); metal = 0.55 * (1.0 - rust);
  } else { // metal panel cladding
    vec2 ps = vec2(1.2, 0.6); vec2 f = fract(p / ps); float aa = pix / 0.6;
    float seam = 1.0 - smoothstep(0.01 - aa, 0.01 + aa, f.x) * smoothstep(0.015 - aa, 0.015 + aa, f.y);
    col *= (0.92 + 0.08 * fH(floor(p / ps) + seed)) * (1.0 - seam * 0.3 * (1.0 - far));
    h -= seam * 0.004 * (1.0 - far);
    rough = 0.5; metal = 0.4;
  }
}

// interior mapping: trace a view ray into a box room behind the window; returns lit interior colour
vec3 gGlow;
// shop dressing by store style: 0 convenience 1 gas 2 liquor 3 jewelry 4 pawn 5 bank 6 clothing 7 barber 8 diner 9 electronics 10 office lobby
vec3 shopWall(vec2 q, vec3 hp, vec3 room, float st, float rs, vec3 base, bool side){
  vec3 c = base; float u = hp.x; float h = hp.y; if (side) u = hp.z;
  float cell = floor(u * 5.0); float fx = fract(u * 5.0); float hs = fH(vec2(cell, st + rs));
  if (st < 1.5) { // fridge wall + snack racks, lit sign band
    vec3 tint = st < 0.5 ? vec3(0.8, 0.12, 0.15) : vec3(0.05, 0.5, 0.3);
    if (h > 2.3 && h < 2.75) { c = tint; gGlow += tint * 0.9; }
    else if (!side && h < 2.2) { float door = fract(u / 1.0); float frame = step(0.06, door) * step(door, 0.94);
      float row = fract(h * 3.4); vec3 drink = 0.25 + 0.7 * vec3(fH(vec2(cell, floor(h * 3.4))), fH(vec2(cell + 3.0, floor(h * 3.4))), fH(vec2(cell, floor(h * 3.4) + 5.0)));
      vec3 fr = mix(vec3(0.7, 0.85, 0.95), drink, step(0.2, row) * step(0.25, fx) * step(h, 2.0));
      c = mix(vec3(0.12), fr, frame); gGlow += c * 0.5 * frame; }
    else if (side && h < 2.1) { float row = fract(h * 2.6); float pi = fH(vec2(cell, floor(h * 2.6) + 9.0));
      vec3 pk = pi < 0.25 ? vec3(0.75, 0.15, 0.12) : pi < 0.5 ? vec3(0.9, 0.75, 0.2) : pi < 0.75 ? vec3(0.85, 0.85, 0.8) : vec3(0.15, 0.3, 0.55);
      c = mix(vec3(0.45, 0.47, 0.5), pk * 0.85, step(0.3, row) * step(0.15, fx) * step(fx, 0.85)); }
  } else if (st < 2.5) { // liquor: bottle shelves, warm
    if (h < 2.5 && h > 0.2) { float row = fract(h * 3.2); float bi = floor(h * 3.2); float amber = fH(vec2(cell, bi + 1.0));
      vec3 bottle = amber < 0.4 ? vec3(0.45, 0.22, 0.06) : amber < 0.7 ? vec3(0.12, 0.35, 0.16) : vec3(0.75, 0.8, 0.85);
      float bw = step(0.2, row) * (row < 0.62 ? step(0.18, fx) * step(fx, 0.82) : step(0.4, fx) * step(fx, 0.6)) * step(0.15, fH(vec2(cell, bi + 7.0)));
      c = mix(vec3(0.16, 0.1, 0.06) + vec3(0.25, 0.18, 0.1) * step(row, 0.2), bottle * (0.7 + 0.5 * row), bw); gGlow += bottle * bw * 0.35; }
  } else if (st < 3.5) { // jewelry: dark wall, glittering lit cases
    c = vec3(0.04, 0.035, 0.04);
    float caseM = step(0.12, fract(u / 1.6)) * step(fract(u / 1.6), 0.88) * step(0.7, h) * step(h, 1.15);
    c = mix(c, vec3(0.9, 0.8, 0.5), caseM); gGlow += vec3(1.0, 0.85, 0.5) * caseM * 0.9;
    float gem = step(0.93, fH(floor(vec2(u * 12.0, h * 12.0)))) * caseM; gGlow += vec3(1.0) * gem * 1.5;
    if (h > 1.5 && h < 2.4) { float spot = step(0.35, fract(u / 0.9)) * step(fract(u / 0.9), 0.65); c = mix(c, vec3(0.5, 0.42, 0.3), spot * 0.7); gGlow += vec3(0.9, 0.75, 0.4) * spot * 0.35; }
  } else if (st < 4.5) { // pawn: guitars and TVs
    c = vec3(0.3, 0.22, 0.16);
    float g = fract(u / 0.7); float gx = abs(g - 0.5);
    float body = step(gx, 0.2 * smoothstep(1.1, 1.5, h) + 0.09 * step(1.5, h)) * step(0.9, h) * step(h, 1.55);
    float neck = step(gx, 0.035) * step(1.55, h) * step(h, 2.4);
    vec3 gc = hs < 0.33 ? vec3(0.7, 0.15, 0.1) : hs < 0.66 ? vec3(0.8, 0.6, 0.2) : vec3(0.15, 0.2, 0.5);
    if (fract(u / 3.2) > 0.45) c = mix(c, gc, max(body, neck)); else { float tv = step(0.1, fract(u / 1.6)) * step(fract(u / 1.6), 0.9) * step(1.0, h) * step(h, 2.0); c = mix(c, vec3(0.02, 0.03, 0.05), tv); gGlow += vec3(0.1, 0.25, 0.4) * tv * 0.6; }
  } else if (st < 5.5) { // bank: marble wall, teller counter with glass partition
    c = vec3(0.8, 0.78, 0.72);
    float counter = step(h, 1.05) * step(0.2, hp.z) ; c = mix(c, vec3(0.35, 0.22, 0.12), counter * step(h, 1.0));
    float glassP = step(1.05, h) * step(h, 2.1) * step(0.1, fract(u / 2.0)) ; c = mix(c, vec3(0.55, 0.7, 0.75), glassP * 0.5);
    float bar = step(fract(u / 2.0), 0.05) * step(1.0, h) * step(h, 2.2); c = mix(c, vec3(0.6, 0.5, 0.2), bar);
    gGlow += vec3(0.5, 0.6, 0.7) * glassP * 0.15;
  } else if (st < 6.5) { // clothing: mannequins and rails
    c = vec3(0.86, 0.84, 0.82);
    float railY = step(abs(h - 1.7), 0.03); c = mix(c, vec3(0.6), railY);
    vec3 cl = hs < 0.25 ? vec3(0.7, 0.15, 0.2) : hs < 0.5 ? vec3(0.15, 0.3, 0.6) : hs < 0.75 ? vec3(0.9, 0.8, 0.5) : vec3(0.15);
    float garment = step(abs(fract(u / 0.3) - 0.5), 0.35) * step(1.0, h) * step(h, 1.68); c = mix(c, cl, garment * step(0.5, fract(u / 4.0)));
    float mq = fract(u / 4.0); float mx = abs(mq - 0.25); // mannequin silhouette
    float torso = step(mx, 0.14) * step(1.1, h) * step(h, 1.75) + step(mx, 0.05) * step(1.75, h) * step(h, 1.98) + step(mx, 0.12) * step(0.0, h) * step(h, 1.1) * 0.6;
    if (mq < 0.5) { c = mix(c, hs < 0.5 ? vec3(0.8, 0.75, 0.7) : cl, clamp(torso, 0.0, 1.0)); } gGlow += vec3(0.4) * 0.15;
  } else if (st < 7.5) { // barber: mirror wall with chair
    c = vec3(0.7, 0.62, 0.55);
    float mir = step(0.15, fract(u / 2.2)) * step(fract(u / 2.2), 0.85) * step(0.9, h) * step(h, 2.1);
    c = mix(c, vec3(0.65, 0.78, 0.85), mir); gGlow += vec3(0.7, 0.85, 0.95) * mir * 0.5;
    float chairX = abs(fract(u / 2.2) - 0.5); float chair = (step(chairX, 0.22) * step(0.4, h) * step(h, 0.75) + step(chairX, 0.2) * step(0.75, h) * step(h, 1.4)); c = mix(c, vec3(0.65, 0.08, 0.08), chair * (mir + step(h, 0.75)));
    float pole = step(abs(fract(u / 4.4) - 0.9), 0.04) * step(h, 1.8); c = mix(c, mix(vec3(0.9), vec3(0.8, 0.1, 0.1), step(0.5, fract(h * 6.0))), pole);
  } else if (st < 8.5) { // diner: red booths, counter stools
    c = vec3(0.9, 0.86, 0.75);
    float booth = step(h, 1.15) * step(0.0, 1.0); vec3 vinyl = vec3(0.65, 0.08, 0.1);
    c = mix(c, vinyl, booth * step(0.12, fract(u / 1.8)) * step(fract(u / 1.8), 0.9));
    float tbl = step(0.72, h) * step(h, 0.78) * step(0.2, fract(u / 1.8)) * step(fract(u / 1.8), 0.8); c = mix(c, vec3(0.85), tbl);
    float sgn = step(1.9, h) * step(h, 2.4) * step(0.2, fract(u / 5.0)) * step(fract(u / 5.0), 0.8); c = mix(c, vec3(1.0, 0.3, 0.2), sgn); gGlow += vec3(1.0, 0.3, 0.2) * sgn * 0.8;
  } else if (st < 9.5) { // electronics: banks of screens
    c = vec3(0.08, 0.09, 0.11);
    vec2 sc = vec2(fract(u / 1.1), fract((h - 0.5) / 0.7)); float scr = step(0.06, sc.x) * step(sc.x, 0.94) * step(0.08, sc.y) * step(sc.y, 0.92) * step(0.5, h) * step(h, 2.3);
    float sid = fH(floor(vec2(u / 1.1, (h - 0.5) / 0.7)) + rs); vec3 pic = mix(vec3(0.1, 0.4, 0.9), mix(vec3(0.9, 0.35, 0.15), vec3(0.2, 0.8, 0.5), step(0.5, sid)), step(0.33, sid));
    c = mix(c, pic, scr); gGlow += pic * scr * 0.9;
  } else { // office lobby: pale wall, reception desk, plants
    c = vec3(0.82, 0.82, 0.8);
    float desk = step(h, 1.1) * step(0.2, fract(u / 6.0)) * step(fract(u / 6.0), 0.75); c = mix(c, vec3(0.3, 0.26, 0.22), desk);
    float logo = step(1.8, h) * step(h, 2.3) * step(0.35, fract(u / 6.0)) * step(fract(u / 6.0), 0.6); c = mix(c, vec3(0.2, 0.3, 0.45), logo); gGlow += vec3(0.2, 0.35, 0.6) * logo * 0.4;
    float pl = step(abs(fract(u / 6.0) - 0.9), 0.05) * step(h, 1.2); c = mix(c, vec3(0.15, 0.4, 0.2), pl);
  }
  return c;
}
vec3 roomColor(vec3 p0, vec3 v, vec3 room, float rs, float type, float lit, float night){
  v.z = max(v.z, 0.05);
  float tx = v.x > 0.0 ? (room.x - p0.x) / max(v.x, 1e-4) : -p0.x / min(v.x, -1e-4);
  float ty = v.y > 0.0 ? (room.y - p0.y) / max(v.y, 1e-4) : -p0.y / min(v.y, -1e-4);
  float tz = (room.z - p0.z) / v.z;
  float t = min(min(tx, ty), tz);
  vec3 hp = p0 + v * t;
  vec3 wallC = mix(vec3(0.78, 0.74, 0.66), vec3(0.62, 0.7, 0.72), step(0.5, fH(vec2(rs, 1.7))));
  if (type > 0.5) wallC = vec3(0.82, 0.83, 0.82);
  if (type > 1.5) wallC = mix(vec3(0.9, 0.9, 0.86), vec3(0.95, 0.88, 0.8), fH(vec2(rs, 5.3)));
  float st = type - 2.0; gGlow = vec3(0.0);
  vec3 floorC = mix(vec3(0.42, 0.3, 0.2), vec3(0.35, 0.36, 0.38), step(0.6, fH(vec2(rs, 3.1))));
  if (type > 0.5) floorC = vec3(0.28, 0.3, 0.33);
  if (type > 1.5) { floorC = vec3(0.75, 0.74, 0.7); vec2 fc = floor(hp.xz * 1.6); float chk = mod(fc.x + fc.y, 2.0);
    if (st < 1.5) floorC = mix(vec3(0.82, 0.86, 0.88), vec3(0.5, 0.58, 0.62), chk);
    else if (st < 2.5) floorC = vec3(0.18, 0.11, 0.07);
    else if (st < 3.5) floorC = mix(vec3(0.05), vec3(0.85), chk);
    else if (st < 4.5) floorC = vec3(0.28, 0.27, 0.26);
    else if (st < 5.5) floorC = mix(vec3(0.78, 0.74, 0.66), vec3(0.6, 0.57, 0.5), chk);
    else if (st < 7.5) floorC = mix(vec3(0.6, 0.5, 0.4), vec3(0.2, 0.2, 0.22), chk * step(6.5, st));
    else if (st < 8.5) floorC = mix(vec3(0.9), vec3(0.15), chk);
    else if (st < 9.5) floorC = vec3(0.2, 0.21, 0.23); }
  vec3 c;
  float lightAt = 0.0;
  if (t == tz) {
    c = wallC;
    vec2 q = hp.xy / room.xy;
    if (type < 0.5) {
      // furniture silhouettes and a picture on the back wall
      float sofa = boxMask(q, vec2(0.15 + fH(vec2(rs, 9.0)) * 0.3, 0.0), vec2(0.55 + fH(vec2(rs, 9.0)) * 0.3, 0.3), 0.01);
      c = mix(c, mix(vec3(0.35, 0.25, 0.2), vec3(0.25, 0.3, 0.4), fH(vec2(rs, 11.0))), sofa);
      float pic = boxMask(q, vec2(0.3, 0.5), vec2(0.6, 0.75), 0.005);
      c = mix(c, mix(vec3(0.6, 0.4, 0.3), vec3(0.3, 0.5, 0.6), fH(vec2(rs, 13.0))), pic * step(0.4, fH(vec2(rs, 14.0))));
    } else if (type < 1.5) {
      float desk = boxMask(q, vec2(0.05, 0.0), vec2(0.95, 0.27), 0.01);
      c = mix(c, vec3(0.3, 0.3, 0.32), desk);
      float scr = boxMask(fract(q * vec2(3.0, 1.0)), vec2(0.35, 0.28), vec2(0.65, 0.42), 0.02);
      c = mix(c, vec3(0.1, 0.12, 0.16) + night * vec3(0.2, 0.3, 0.5) * lit, scr);
    } else {
      c = shopWall(q * room.xy, hp, room, st, rs, wallC, false);
    }
  } else if (t == ty) {
    if (v.y < 0.0) { c = floorC * (type > 1.5 ? 1.0 : (0.8 + 0.2 * fH(floor(hp.xz * 2.0)))); }
    else {
      c = wallC * 1.05;
      // ceiling lights
      vec2 lp2 = hp.xz;
      float panel = type > 0.5 ? boxMask(fract(lp2 / vec2(1.6, 2.4)), vec2(0.2, 0.35), vec2(0.8, 0.65), 0.02) : 1.0 - smoothstep(0.1, 0.18, length(hp.xz - vec2(room.x * 0.5, room.z * 0.5)) / room.x);
      lightAt = panel;
    }
  } else {
    c = wallC * 0.85;
    if (type > 1.5) c = shopWall(vec2(0.0), hp, room, st, rs, wallC * 0.85, true) * 0.85;
  }
  // light falloff: brighter near the ceiling, darker deep in the room
  float depthK = mix(1.0, 0.55, clamp(hp.z / room.z, 0.0, 1.0));
  float hk = mix(0.7, 1.0, clamp(hp.y / room.y, 0.0, 1.0));
  vec3 lightC = mix(vec3(1.0, 0.78, 0.52), vec3(0.85, 0.92, 1.0), step(0.75, fH(vec2(rs, 21.0))));
  if (type > 0.5) lightC = vec3(0.92, 0.96, 1.0);
  float dayL = 0.22;
  float nightL = lit * 1.1;
  float L = mix(dayL, nightL, night);
  return c * depthK * hk * L * mix(vec3(1.0), lightC, night) + lightC * lightAt * mix(0.4, 2.5 * lit, night) + gGlow * lit * mix(0.35, 1.0, night) * depthK;
}
`;

/** Inserted after color_fragment. Produces: fRough, fMetal, fEmis, fBump. */
export const FACADE_FRAG_COLOR = /* glsl */`
float fKind = floor(vFacade.x + 0.5); float fSeed = vFacade.y;
vec2 fCs = vec2(max(vFacade.z, 0.5), max(vFacade.w, 0.5));
vec2 fP = vFUv;
vec2 fFw = fwidth(fP); float fPix = max(max(fFw.x, fFw.y), 1e-4);
float fRough = 0.85, fMetal = 0.0, fBump = 0.0; vec3 fEmis = vec3(0.0);
float fGlass = 0.0;
vec3 fV = normalize(vWPos - cameraPosition);
vec3 fN3 = normalize(vWN);
vec3 fT = normalize(vec3(fN3.z, 0.0, -fN3.x) + vec3(1e-5));
vec3 fVt = vec3(dot(fV, fT), dot(fV, vec3(0.0, 1.0, 0.0)), dot(fV, -fN3));
float fNight = uNight;
if (fKind < 0.5) {
  diffuseColor.rgb *= 0.93 + 0.1 * fN(fP * 1.3 + fSeed);
} else if (fKind < 4.5 || fKind > 6.5) {
  vec3 wallC = diffuseColor.rgb; float wallH = 0.0, wr = 0.85, wm = 0.0;
  float m = vFacade2.w;
  wallMaterial(m, fP, fPix, fSeed, wallC, wallH, wr, wm);
  // weathering: streaks, splash at the base, blotches
  float streak = fBm(vec2(fP.x * 0.9 + fSeed, fP.y * 0.07));
  wallC *= mix(1.0, 0.8, smoothstep(0.5, 0.85, streak));
  wallC *= mix(0.78, 1.0, smoothstep(0.0, 1.3, vWPos.y - vFacade3.y));
  wallC *= 0.92 + 0.12 * fN(fP * 0.25 + fSeed * 3.0);
  vec3 col = wallC; float h = wallH; float rough = wr, metal = wm;
  vec2 gp = vec2(fP.x, fP.y - vFacade3.x);
  vec2 cell = floor(gp / fCs); vec2 lp = gp - cell * fCs;
  float cellSeed = fH(cell + vec2(fSeed, fSeed * 0.31));
  float inGrid = step(0.0, gp.y) * step(cell.y, vFacade3.w - 0.5);
  vec3 frameC = mix(vec3(0.93, 0.92, 0.88), vec3(0.16, 0.16, 0.17), step(0.5, fract(fSeed * 0.173)));
  float far = smoothstep(0.12, 0.34, fPix);
  if (fKind > 0.5 && fKind < 1.5) {
    // glass curtain wall: mullions, spandrels, offices behind
    float mw = 0.045;
    float aa = fPix;
    float glassM = boxMask(lp, vec2(mw), fCs - vec2(mw), aa);
    float spandrel = 1.0 - step(0.95, lp.y);
    vec3 tint = diffuseColor.rgb;
    vec3 mull = tint * 0.35 + vec3(0.06);
    float roomW = fCs.x * 3.0;
    float rx = mod(cell.x, 3.0) * fCs.x + lp.x;
    float rs = fH(vec2(floor(cell.x / 3.0), cell.y) + fSeed);
    float lit = step(1.0 - vFacade3.z, fH(vec2(floor(cell.x / 3.0), cell.y) * 1.37 + fSeed)) * (0.6 + 0.4 * rs);
    vec3 inter = roomColor(vec3(rx, lp.y, 0.0), fVt, vec3(roomW, fCs.y, 6.0), rs, 1.0, lit, fNight);
    float g = glassM * (1.0 - spandrel);
    float glassAvg = 0.72;
    float litAvg = vFacade3.z * 0.8;
    vec3 avgEm = vec3(0.92, 0.95, 1.0) * mix(0.22 * 0.35, litAvg * 0.7, fNight) * glassAvg;
    col = mix(mull, tint * 0.25, glassM);
    fEmis = mix(inter * g * 0.9, avgEm * 0.5, far);
    fGlass = mix(g, 0.75, far) + spandrel * glassM * 0.6;
    rough = mix(0.35, 0.04, max(fGlass, glassM)); metal = mix(0.6, 0.85, glassM) * mix(1.0, 0.6, far * fNight);
    col = mix(col, tint * 0.22, far);
    h += (1.0 - glassM) * 0.012;
  } else if (fKind < 2.5 || fKind > 7.5) {
    // punched windows in a masonry wall
    float ww = vFacade2.x, wh = vFacade2.y, sill = vFacade2.z;
    vec2 lo = vec2((fCs.x - ww) * 0.5, sill), hi = lo + vec2(ww, wh);
    float aa = fPix;
    float win = boxMask(lp, lo, hi, aa) * inGrid;
    // lintel and sill band (stone) on brick
    float lintel = boxMask(lp, lo + vec2(-0.1, wh), hi + vec2(0.1, 0.2), aa) * inGrid * step(m, 0.5);
    col = mix(col, vec3(0.78, 0.74, 0.66) * (0.9 + 0.1 * fN(fP * 4.0)), lintel);
    h += lintel * 0.01;
    float fwid = 0.07;
    float glassM = boxMask(lp, lo + fwid, hi - fwid, aa);
    // sash rail / mullion
    float rail = boxMask(lp, vec2(lo.x, lo.y + wh * 0.55 - 0.03), vec2(hi.x, lo.y + wh * 0.55 + 0.03), aa);
    float mull = ww > 1.3 ? boxMask(lp, vec2(fCs.x * 0.5 - 0.03, lo.y), vec2(fCs.x * 0.5 + 0.03, hi.y), aa) : 0.0;
    glassM *= (1.0 - rail) * (1.0 - mull);
    float rs = cellSeed;
    float lit = step(1.0 - vFacade3.z, fH(cell * 1.91 + fSeed)) * (0.55 + 0.45 * fH(cell * 3.7 + fSeed));
    vec3 inter = roomColor(vec3(lp.x - lo.x + 0.4, lp.y, 0.0), fVt, vec3(ww + 0.8, fCs.y, 4.5), rs, 0.0, lit, fNight);
    // blinds / curtains on the glass plane
    vec2 wq = (lp - lo) / vec2(ww, wh);
    float blindTop = mix(1.0, 0.35, step(0.45, fH(cell * 5.3 + fSeed)) * fH(cell * 7.1 + fSeed));
    float blind = step(blindTop, wq.y) * glassM;
    float curt = step(0.6, fH(cell * 9.7 + fSeed)) * (1.0 - smoothstep(0.16, 0.2, min(wq.x, 1.0 - wq.x))) * glassM;
    vec3 blindC = mix(vec3(0.86, 0.83, 0.76), vec3(0.75, 0.62, 0.5), fH(cell * 4.4 + fSeed));
    float shade = max(blind * (0.75 + 0.25 * step(0.5, fract(wq.y * wh / 0.05))), curt);
    // reveal shadow inside the opening (top and one side)
    float reveal = mix(0.5, 1.0, smoothstep(0.0, 0.22, hi.y - lp.y)) * mix(0.75, 1.0, smoothstep(0.0, 0.12, lp.x - lo.x));
    vec3 frameCol = frameC * reveal;
    vec3 glassCol = vec3(0.02, 0.025, 0.03);
    col = mix(col, frameCol, win);
    col = mix(col, glassCol, win * glassM * (1.0 - shade));
    col = mix(col, blindC * reveal, win * shade);
    fEmis = inter * win * glassM * (1.0 - shade) * reveal + blindC * win * shade * lit * fNight * 0.5;
    fGlass = win * glassM * (1.0 - shade);
    rough = mix(rough, 0.05, fGlass); rough = mix(rough, 0.6, win * (1.0 - glassM)); metal = mix(metal, 0.0, win);
    h -= win * 0.04;
    // far: average the grid
    float frac = (ww * wh) / (fCs.x * fCs.y) * inGrid;
    vec3 farCol = mix(diffuseColor.rgb * 0.9, vec3(0.06), frac * 0.75);
    vec3 farEm = vec3(1.0, 0.8, 0.55) * frac * mix(0.05, vFacade3.z * 0.5, fNight);
    col = mix(col, farCol, far); fEmis = mix(fEmis, farEm, far); fGlass = mix(fGlass, frac * 0.6, far);
  } else if (fKind < 3.5) {
    // solid wall: nothing more
  } else if (fKind < 4.5) {
    // shopfront: tall glazed bays with a kickplate and transom; a door in the first bay
    float aa = fPix;
    vec2 lo = vec2(0.12, 0.45), hi = vec2(fCs.x - 0.12, fCs.y - 0.35);
    float door = step(cell.x, 0.5) * step(-0.5, cell.x);
    if (door > 0.5) lo.y = 0.02;
    float win = boxMask(lp, lo, hi, aa) * step(0.0, gp.y) * step(gp.y, fCs.y);
    float glassM = boxMask(lp, lo + 0.06, hi - 0.06, aa);
    float transom = boxMask(lp, vec2(lo.x, hi.y - 0.55), vec2(hi.x, hi.y - 0.5), aa);
    glassM *= 1.0 - transom;
    float rs = fH(vec2(fSeed, 3.0));
    float open = step(0.25, fH(vec2(fSeed, 8.0)));
    float lit = open * (0.85 + 0.15 * rs);
    vec3 inter = roomColor(vec3(lp.x + mod(cell.x, 4.0) * fCs.x, lp.y, 0.0), fVt, vec3(fCs.x * 4.0, fCs.y + 0.3, 7.0), rs, 2.0 + floor(vFacade2.x + 0.5), lit, fNight);
    // closed shops at night show roll-down grilles
    float grille = (1.0 - open) * fNight * win;
    vec3 frameCol = mix(vec3(0.12, 0.12, 0.13), vec3(0.55, 0.4, 0.25), step(0.6, fract(fSeed * 0.71)));
    col = mix(col, frameCol, win);
    col = mix(col, vec3(0.02), win * glassM);
    fEmis = inter * win * glassM * mix(1.3, 0.45, fNight) * (1.0 - grille);
    col = mix(col, vec3(0.42, 0.43, 0.44) * (0.75 + 0.25 * step(0.5, fract(lp.y / 0.09))), grille);
    fGlass = win * glassM * (1.0 - grille);
    rough = mix(rough, 0.05, fGlass); metal = mix(metal, 0.5, win * (1.0 - glassM));
    h -= win * 0.05;
  } else if (fKind < 7.5) {
    // roll-up / garage door: horizontal slats
    float f = fract(fP.y / 0.45);
    col = diffuseColor.rgb * (0.82 + 0.18 * smoothstep(0.0, 0.12, f)) * (0.9 + 0.1 * fN(fP * 2.0 + fSeed));
    h += f * 0.01; rough = 0.55; metal = 0.5;
  }
  diffuseColor.rgb = col;
  fRough = rough; fMetal = metal; fBump = h;
} else if (fKind < 5.5) {
  // flat roof: tar and gravel with patches
  vec3 c = diffuseColor.rgb * (0.85 + 0.2 * fBm(fP * 0.5 + fSeed)) * (0.9 + 0.12 * fH(floor(fP * 30.0)));
  float patchM = step(0.72, fN(fP * 0.18 + fSeed));
  c = mix(c, c * 0.72, patchM);
  diffuseColor.rgb = c; fRough = 0.95; fBump = fH(floor(fP * 40.0)) * 0.002;
} else {
  // shingle roof (uv: x along the eave, y up the slope)
  float rowH = 0.22; float row = floor(fP.y / rowH); float f = fract(fP.y / rowH);
  float tab = fract(fP.x / 0.33 + row * 0.5); float aa = fPix / 0.33;
  float id = fH(vec2(floor(fP.x / 0.33 + row * 0.5), row) + fSeed);
  vec3 c = diffuseColor.rgb * mix(0.78, 1.12, id) * mix(0.7, 1.0, smoothstep(0.0, 0.25, f));
  c *= 1.0 - (1.0 - smoothstep(0.0, 0.04 + aa, min(tab, 1.0 - tab))) * 0.35 * step(0.3, f);
  float farR = smoothstep(0.03, 0.1, fPix);
  diffuseColor.rgb = mix(c, diffuseColor.rgb * 0.9, farR);
  fRough = 0.88; fBump = f * 0.015 * (1.0 - farR);
}
`;
