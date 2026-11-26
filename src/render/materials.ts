/** Procedural textures and shared materials. Everything here is generated in code (no external files). */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import { FACADE_FRAG_COLOR, FACADE_FRAG_PARS, FACADE_VERT_MAIN, FACADE_VERT_PARS, FACADE_VERT_WORLD } from '../world/facadeShader';

/** Night factor shared by every material that glows after dusk. */
export const nightUniform = { value: 0 };
export const timeUniform = { value: 0 };

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d', { willReadFrequently: true })! }; }
function tex(c: HTMLCanvasElement, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

/** Tileable value noise on an n x n lattice. */
function noiseField(size: number, cells: number, rng: Rng): (x: number, y: number) => number {
  const g = new Float32Array(cells * cells); for (let i = 0; i < g.length; i++) g[i] = rng.next();
  return (x: number, y: number) => {
    const fx = (x / size) * cells, fy = (y / size) * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy); let tx = fx - ix, ty = fy - iy;
    tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
    const a = (i: number, j: number) => g[((j % cells + cells) % cells) * cells + ((i % cells + cells) % cells)];
    return (a(ix, iy) * (1 - tx) + a(ix + 1, iy) * tx) * (1 - ty) + (a(ix, iy + 1) * (1 - tx) + a(ix + 1, iy + 1) * tx) * ty;
  };
}
function fbmField(size: number, rng: Rng, base: number, oct = 4) {
  const fs = Array.from({ length: oct }, (_, i) => noiseField(size, base << i, rng));
  return (x: number, y: number) => { let v = 0, a = 0.5, n = 0; for (const f of fs) { v += f(x, y) * a; n += a; a *= 0.5; } return v / n; };
}

export interface Surface { map: THREE.Texture; normalMap: THREE.Texture; roughnessMap: THREE.Texture }
/** Per-pixel painter: col = linear rgb 0..1, h = height (arbitrary units), rough = 0..1. `g` is the stroke overlay (absent in node). */
export type SurfacePainter = (col: Float32Array, h: Float32Array, rough: Float32Array, overlay: CanvasRenderingContext2D | null) => void;
const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
function dataTex(rgba: Uint8ClampedArray, size: number, srgb: boolean) {
  const t = new THREE.DataTexture(new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.length), size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.needsUpdate = true; return t;
}
/**
 * Builds albedo + normal + roughness textures from per-pixel albedo/height/roughness buffers.
 * paint() fills col (rgb 0..1), h (metres-ish) and rough (0..1); strokes may also be drawn on the 2D context `g`
 * (it is composited over col first). Without a DOM (node tests) the overlay is null and DataTextures are returned.
 */
function surface(size: number, bumpScale: number, paint: SurfacePainter): Surface {
  const n = size * size, hasDom = typeof document !== 'undefined';
  const col = new Float32Array(n * 3), h = new Float32Array(n), rough = new Float32Array(n).fill(0.9);
  const ov = hasDom ? canvas(size, size) : null;
  paint(col, h, rough, ov ? ov.g : null);
  const out = new Uint8ClampedArray(n * 4);
  const od = ov ? ov.g.getImageData(0, 0, size, size).data : null;
  for (let i = 0; i < n; i++) {
    const a = od ? od[i * 4 + 3] / 255 : 0;
    for (let k = 0; k < 3; k++) { const v = col[i * 3 + k] * (1 - a) + (od ? od[i * 4 + k] / 255 : 0) * a; out[i * 4 + k] = Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255))); }
    out[i * 4 + 3] = 255;
    h[i] -= a * 0.6;
  }
  // Round 12: one 3x3 box blur of the height field before deriving normals. Per-texel white-noise heights made per-texel
  // random normals, which sparkled like glitter under headlights at grazing angles (the night streets looked like snow).
  const hb = new Float32Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let dy = -1; dy <= 1; dy++) { const row = ((y + dy + size) % size) * size; for (let dx = -1; dx <= 1; dx++) acc += h[row + ((x + dx + size) % size)]; }
    hb[y * size + x] = acc / 9;
  }
  h.set(hb);
  const nd = new Uint8ClampedArray(n * 4), rd = new Uint8ClampedArray(n * 4);
  const H = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const dx = (H(x + 1, y) - H(x - 1, y)) * bumpScale, dy = (H(x, y + 1) - H(x, y - 1)) * bumpScale;
    const l = Math.hypot(dx, dy, 1);
    nd[i * 4] = Math.round((-dx / l * 0.5 + 0.5) * 255); nd[i * 4 + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); nd[i * 4 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); nd[i * 4 + 3] = 255;
    const r = Math.round(Math.max(0, Math.min(1, rough[i])) * 255); rd[i * 4] = r; rd[i * 4 + 1] = r; rd[i * 4 + 2] = r; rd[i * 4 + 3] = 255;
  }
  if (!hasDom) return { map: dataTex(out, size, true), normalMap: dataTex(nd, size, false), roughnessMap: dataTex(rd, size, false) };
  const put = (data: Uint8ClampedArray) => { const c = canvas(size, size); const im = c.g.createImageData(size, size); im.data.set(data); c.g.putImageData(im, 0, 0); return c.c; };
  return { map: tex(put(out)), normalMap: tex(put(nd), true, false), roughnessMap: tex(put(rd), true, false) };
}

/**
 * Asphalt painter (exported for tests). One tile covers 12 m (about 1.2 cm per texel at 1024).
 * Warm-neutral dark grey (R >= G >= B): bitumen-bound fine stones, lighter quartz chips, dark binder pits, wear patches.
 */
export function paintAsphalt(S: number, col: Float32Array, h: Float32Array, rough: Float32Array, g: CanvasRenderingContext2D | null, seed = 3) {
  const r = new Rng(seed);
  const big = fbmField(S, r, 4), mid = fbmField(S, r, 16), fine = noiseField(S, 256, r), stoneN = noiseField(S, 512, r), stoneM = noiseField(S, 170, r), streak = noiseField(S, 6, r), warp = fbmField(S, r, 8);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const b = big(x, y), m = mid(x, y), f = fine(x, y);
    const grain = r.next();
    const st = stoneN(x, y), sm = stoneM(x, y);
    // aggregate: clustered stones (dark mass, lighter quartz/limestone chips, dark binder pits)
    const chip = smooth(0.74, 0.92, st) * (0.6 + 0.4 * sm);
    const pit = smooth(0.8, 0.95, 1 - st) * 0.5;
    // broad wear: patchy, fades between fresh dark and sun-bleached grey (no single direction, so no visible tracks)
    const wear = smooth(0.4, 0.75, b) * 0.6 + smooth(0.45, 0.8, streak(x, y * 0.35)) * 0.25;
    let v = 0.092 + b * 0.03 + m * 0.026 + f * 0.012 + wear * 0.038 + chip * 0.05 - pit * 0.03 + (grain - 0.5) * 0.024;
    if (grain > 0.985) v += 0.05; // sparkling chip
    // warm-neutral: slightly red/yellow, never blue
    col[i * 3] = v * 1.035; col[i * 3 + 1] = v * 1.0; col[i * 3 + 2] = v * 0.955;
    h[i] = chip * 0.55 - pit * 0.4 + m * 0.5 + grain * 0.25;
    rough[i] = Math.max(0.8, Math.min(0.95, 0.9 - wear * 0.07 + (grain - 0.5) * 0.06 + (b - 0.5) * 0.06 - chip * 0.02));
  }
  // repair patches: utility cuts, darker (fresh) or lighter (aged), irregular warped edges, sealed seam
  for (let k = 0; k < 6; k++) {
    const px = r.range(0, S), py = r.range(0, S), pw = r.range(70, 240), ph = r.range(40, 170), fresh = k % 2 === 0;
    const tone = fresh ? 0.72 : 1.16;
    for (let y = Math.floor(py) - 3; y < py + ph + 3; y++) for (let x = Math.floor(px) - 3; x < px + pw + 3; x++) {
      const wx = (warp(x, y) - 0.5) * 7, wy = (warp(y + 77, x) - 0.5) * 7;
      const dx = Math.min(x + wx - px, px + pw - (x + wx)), dy = Math.min(y + wy - py, py + ph - (y + wy));
      const d = Math.min(dx, dy);
      const i = (((y % S) + S) % S) * S + (((x % S) + S) % S);
      if (d > 0) { col[i * 3] *= tone; col[i * 3 + 1] *= tone; col[i * 3 + 2] *= tone * (fresh ? 1.0 : 0.98); h[i] += 0.22; rough[i] = Math.max(0.8, Math.min(0.95, rough[i] + (fresh ? 0.02 : -0.02))); }
      if (Math.abs(d) < 1.4) { col[i * 3] *= 0.45; col[i * 3 + 1] *= 0.45; col[i * 3 + 2] *= 0.45; h[i] -= 0.5; rough[i] = 0.8; } // tar seam
    }
  }
  // oil / fluid stains: irregular, dark, a little glossier
  for (let k = 0; k < 22; k++) {
    const cx = r.range(0, S), cy = r.range(0, S), rad = r.range(8, 52), sq = r.range(0.35, 1), ang = r.range(0, Math.PI);
    const ca = Math.cos(ang), sa = Math.sin(ang);
    for (let y = Math.floor(cy - rad); y < cy + rad; y++) for (let x = Math.floor(cx - rad); x < cx + rad; x++) {
      const ux = x - cx, uy = y - cy; const px = (ux * ca + uy * sa) / rad, py = (-ux * sa + uy * ca) / (rad * sq);
      const d = Math.hypot(px, py) * (0.8 + 0.4 * warp(x, y)); if (d > 1) continue;
      const i = (((y % S) + S) % S) * S + (((x % S) + S) % S); const a = Math.pow(1 - d, 1.4) * 0.6;
      col[i * 3] *= 1 - a * 0.85; col[i * 3 + 1] *= 1 - a * 0.9; col[i * 3 + 2] *= 1 - a; rough[i] = Math.max(0.8, rough[i] - a * 0.12);
    }
  }
  if (!g) return;
  g.lineCap = 'round'; g.lineJoin = 'round';
  // tar-sealed cracks (thick, dark) and open hairline cracks
  for (let k = 0; k < 30; k++) {
    let x = r.range(0, S), y = r.range(0, S), a = r.range(0, Math.PI * 2);
    const sealed = r.chance(0.45), lw = sealed ? r.range(2.4, 4.2) : r.range(0.8, 1.8);
    g.strokeStyle = sealed ? `rgba(22,21,20,${r.range(0.7, 0.9)})` : `rgba(18,17,16,${r.range(0.45, 0.75)})`; g.lineWidth = lw;
    g.beginPath(); g.moveTo(x, y);
    const steps = r.int(6, 20);
    for (let s = 0; s < steps; s++) {
      a += r.range(-0.55, 0.55); x += Math.cos(a) * r.range(7, 20); y += Math.sin(a) * r.range(7, 20); g.lineTo(x, y);
      if (r.chance(0.15)) { g.stroke(); g.beginPath(); g.moveTo(x, y); }
    }
    g.stroke();
  }
  // faint rubber scuff arcs
  g.strokeStyle = 'rgba(12,12,12,0.12)'; g.lineWidth = 6;
  for (let k = 0; k < 8; k++) { const x = r.range(0, S), y = r.range(0, S), a = r.range(0, 6.28); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a) * 60, y + Math.sin(a) * 60, x + Math.cos(a + 0.4) * 140, y + Math.sin(a + 0.4) * 140); g.stroke(); }
}
/** Road asphalt: aggregate, tar-sealed cracks, repair patches, oil stains. One tile covers 12 m. */
export function asphaltSurface(): Surface {
  const S = 1024;
  return surface(S, 2.6, (col, h, rough, g) => paintAsphalt(S, col, h, rough, g));
}

/**
 * Sidewalk painter (exported for tests). One tile covers 6 m = 4 x 4 slabs of 1.5 m: tooled joints, per-slab tone/tint/tilt,
 * broom finish, chipped joint edges, rust/oil stains, gum, hairline cracks.
 */
export function paintPavement(S: number, col: Float32Array, h: Float32Array, rough: Float32Array, g: CanvasRenderingContext2D | null, seed = 5) {
  const r = new Rng(seed), slabs = 4, sp = S / slabs;
  const mid = fbmField(S, r, 8), fine = noiseField(S, 256, r), mottle = fbmField(S, r, 24), chipN = noiseField(S, 64, r), jn = noiseField(S, 96, r);
  const tone: number[] = [], tint: number[] = [], broomX: number[] = [], score: number[] = [], tiltX: number[] = [], tiltY: number[] = [];
  for (let k = 0; k < slabs * slabs; k++) { tone.push(r.range(0.84, 1.1)); tint.push(r.range(-1, 1)); broomX.push(r.chance(0.5) ? 1 : 0); score.push(r.chance(0.35) ? 1 : 0); tiltX.push(r.range(-0.05, 0.05)); tiltY.push(r.range(-0.05, 0.05)); }
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    const sx = Math.floor(x / sp), sy = Math.floor(y / sp), si = sy * slabs + sx;
    const lx = x - sx * sp, ly = y - sy * sp;
    const jx = Math.min(lx, sp - lx), jy = Math.min(ly, sp - ly), jd = Math.min(jx, jy);
    // wobbling joint width 1.6..4 px
    const jw = 1.6 + jn(x, y) * 2.4;
    const joint = jd < jw;
    const lip = smooth(jw + 7, jw, jd); // tooled rounded edge: lighter lip next to the joint
    const f = fine(x, y), mt = mottle(x, y);
    // broom finish: fine parallel ridges across the slab, varying phase
    const bp = broomX[si] ? y : x; const broom = Math.sin(bp * 1.9 + mid(x, y) * 8 + si * 3.1) * 0.5 + Math.sin(bp * 0.83 + f * 4) * 0.5;
    const grain = r.next();
    let v = (0.33 + mid(x, y) * 0.09 + mt * 0.05 + f * 0.03 + broom * 0.012 + (grain - 0.5) * 0.045) * tone[si];
    v *= 1 + (lx / sp - 0.5) * tiltX[si] + (ly / sp - 0.5) * tiltY[si];
    v *= 1 + lip * 0.05;
    // chipped joint edge: random spalls beside the joint
    const chip = smooth(0.78, 0.9, chipN(x, y)) * smooth(10, 1, jd);
    v *= 1 - chip * 0.2;
    let sc = 1; if (score[si] && Math.abs(lx - sp / 2) < 1.2 && ly > 10 && ly < sp - 10) sc = 0.72; // saw-cut control joint
    v *= sc;
    if (joint) v *= 0.4 + 0.2 * f;
    const t = tint[si];
    col[i * 3] = v * (1.0 + t * 0.02); col[i * 3 + 1] = v * 0.985; col[i * 3 + 2] = v * (0.955 - t * 0.02);
    h[i] = joint ? -1.1 : (f * 0.18 + broom * 0.07 + grain * 0.1 - chip * 0.4 + (sc < 1 ? -0.5 : 0));
    rough[i] = joint ? 0.95 : Math.max(0.8, Math.min(0.95, 0.88 + (grain - 0.5) * 0.06 - mt * 0.04));
  }
  // damp/oil/rust stains (soft blobs written into col so they exist without a DOM)
  const blob = (cx: number, cy: number, rad: number, dark: number, cr: number, cg: number, cb: number) => {
    for (let y = Math.floor(cy - rad); y < cy + rad; y++) for (let x = Math.floor(cx - rad); x < cx + rad; x++) {
      const d = Math.hypot(x - cx, y - cy) / rad; if (d > 1) continue;
      const a = Math.pow(1 - d, 1.6) * dark; const i = (((y % S) + S) % S) * S + (((x % S) + S) % S);
      col[i * 3] = col[i * 3] * (1 - a) + col[i * 3] * cr * a; col[i * 3 + 1] = col[i * 3 + 1] * (1 - a) + col[i * 3 + 1] * cg * a; col[i * 3 + 2] = col[i * 3 + 2] * (1 - a) + col[i * 3 + 2] * cb * a;
    }
  };
  for (let k = 0; k < 14; k++) blob(r.range(0, S), r.range(0, S), r.range(20, 90), r.range(0.25, 0.55), 0.55, 0.52, 0.5);
  for (let k = 0; k < 4; k++) blob(r.range(0, S), r.range(0, S), r.range(10, 30), r.range(0.3, 0.6), 0.9, 0.62, 0.4);
  // gum spots: small flat grey-black discs with a slightly lighter rim
  for (let k = 0; k < 70; k++) {
    const cx = r.range(0, S), cy = r.range(0, S), rad = r.range(2, 4.2);
    for (let y = Math.floor(cy - rad - 1); y < cy + rad + 1; y++) for (let x = Math.floor(cx - rad - 1); x < cx + rad + 1; x++) {
      const d = Math.hypot(x - cx, y - cy); if (d > rad + 0.5) continue;
      const i = (((y % S) + S) % S) * S + (((x % S) + S) % S); const rim = d > rad - 0.9;
      const gv = rim ? 0.2 : 0.13; col[i * 3] = col[i * 3] * 0.3 + gv * 0.7; col[i * 3 + 1] = col[i * 3 + 1] * 0.3 + gv * 0.68; col[i * 3 + 2] = col[i * 3 + 2] * 0.3 + gv * 0.65; rough[i] = 0.6; h[i] += 0.3;
    }
  }
  if (!g) return;
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let k = 0; k < 9; k++) {
    let x = r.range(0, S), y = r.range(0, S); g.strokeStyle = `rgba(28,26,25,${r.range(0.3, 0.55)})`; g.lineWidth = r.range(0.8, 1.6);
    g.beginPath(); g.moveTo(x, y); const st = r.int(5, 12); for (let s = 0; s < st; s++) { x += r.range(-22, 22); y += r.range(-22, 22); g.lineTo(x, y); } g.stroke();
  }
}
/** Concrete sidewalk slabs (1.5 m) with joints, stains, gum and occasional cracks. One tile covers 6 m. */
export function pavementSurface(): Surface {
  const S = 1024;
  return surface(S, 3.4, (col, h, rough, g) => paintPavement(S, col, h, rough, g));
}
export function paintGrass(S: number, col: Float32Array, h: Float32Array, rough: Float32Array, seed = 7) {
  const r = new Rng(seed);
  const big = fbmField(S, r, 4), mid = fbmField(S, r, 24), patch = fbmField(S, r, 10), clump = noiseField(S, 96, r), streakN = noiseField(S, 128, r);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x; const b = big(x, y), m = mid(x, y), blade = r.next(), p = patch(x, y), cl = clump(x, y);
    const dry = smooth(0.52, 0.78, b) * 0.9 + smooth(0.6, 0.8, p) * 0.3; // sun-bleached straw patches
    const lush = smooth(0.35, 0.6, 1 - p) * 0.35;
    const streak = streakN(x * 0.35, y); // vertical blade streaks
    const v = 0.62 + blade * 0.4 + m * 0.22 + cl * 0.18 + (streak - 0.5) * 0.25;
    // deep green <-> olive <-> straw
    const rr = 0.095 + dry * 0.17 - lush * 0.015, gg = 0.17 + dry * 0.07 + lush * 0.04, bb = 0.05 + dry * 0.015;
    col[i * 3] = rr * v; col[i * 3 + 1] = gg * v; col[i * 3 + 2] = bb * v;
    if (blade > 0.985) { col[i * 3] *= 0.45; col[i * 3 + 1] *= 0.45; col[i * 3 + 2] *= 0.45; }
    else if (blade < 0.012) { col[i * 3] = 0.2; col[i * 3 + 1] = 0.17; col[i * 3 + 2] = 0.08; } // bare soil / dead blade specks
    h[i] = blade * 0.45 + cl * 0.5 + m * 0.3; rough[i] = Math.min(0.95, 0.88 + blade * 0.07);
  }
}
export function grassSurface(): Surface {
  const S = 512;
  return surface(S, 2.0, (col, h, rough) => paintGrass(S, col, h, rough));
}
export function paintSand(S: number, col: Float32Array, h: Float32Array, rough: Float32Array, seed = 11) {
  const r = new Rng(seed);
  const mid = fbmField(S, r, 8), rip = noiseField(S, 24, r), damp = fbmField(S, r, 5);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x; const gr = r.next(); const dp = smooth(0.55, 0.8, damp(x, y));
    const v = (0.6 + mid(x, y) * 0.14 + (gr - 0.5) * 0.12) * (1 - dp * 0.22);
    col[i * 3] = v * 0.93; col[i * 3 + 1] = v * 0.81; col[i * 3 + 2] = v * 0.6;
    if (gr > 0.992) { col[i * 3] *= 0.55; col[i * 3 + 1] *= 0.55; col[i * 3 + 2] *= 0.55; } // dark mineral grains
    else if (gr < 0.004) { col[i * 3] = 0.8; col[i * 3 + 1] = 0.76; col[i * 3 + 2] = 0.68; } // shell fragments
    h[i] = Math.sin((y + rip(x, y) * 30 + mid(x, y) * 10) * 0.35) * 0.3 + gr * 0.2; rough[i] = 0.97 - dp * 0.08;
  }
}
export function sandSurface(): Surface {
  const S = 512;
  return surface(S, 1.5, (col, h, rough) => paintSand(S, col, h, rough));
}
/** Back-compat helpers returning only the albedo. */
export function grassTexture(): THREE.Texture { return grassSurface().map; }
export function sandTexture(): THREE.Texture { return sandSurface().map; }

/**
 * World-space macro variation (breaks texture tiling) for ground materials using map uv in metres / tile.
 * Two scales of brightness + a very large scale warm/cool tint. `grain` > 0 adds close-range world-space fine grain
 * (about 4 cm and 1.6 cm features) that fades out with distance, giving asphalt/concrete detail finer than one texel.
 */
export function addMacroVariation(m: THREE.MeshStandardMaterial, strength = 0.18, scale = 0.012, key = 'macro', grain = 0) {
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.call(m, sh, r);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vMW;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvMW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vMW;
      float mh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float mn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(mh(i), mh(i + vec2(1, 0)), f.x), mix(mh(i + vec2(0, 1)), mh(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <map_fragment>', `#include <map_fragment>
      { float mv = mn(vMW.xz * ${scale.toFixed(4)}) * 0.6 + mn(vMW.xz * ${(scale * 4.1).toFixed(4)}) * 0.4;
        float mt = mn(vMW.xz * ${(scale * 0.23).toFixed(4)} + vec2(17.0, 5.0)) - 0.5;
        diffuseColor.rgb *= 1.0 + (mv - 0.5) * ${(strength * 2).toFixed(3)};
        diffuseColor.rgb *= vec3(1.0 + mt * 0.07, 1.0, 1.0 - mt * 0.07);${grain > 0 ? `
        float gd = mn(vMW.xz * 24.0) * 0.55 + mn(vMW.xz * 63.0) * 0.45;
        float gf = 1.0 - smoothstep(18.0, 70.0, length(vViewPosition));
        diffuseColor.rgb *= 1.0 + (gd - 0.5) * ${(grain * 2).toFixed(3)} * gf;` : ''} }`);
  };
  m.customProgramCacheKey = () => key + (grain > 0 ? '-g' : '');
  return m;
}

/** Shared procedural building surface material (see world/facadeShader.ts). */
export function buildingMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\n' + FACADE_VERT_PARS)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n' + FACADE_VERT_MAIN)
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\n' + FACADE_VERT_WORLD);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + FACADE_FRAG_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FACADE_FRAG_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = fRough;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = fMetal;')
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        { vec3 sp = -vViewPosition; vec3 sx = dFdx(sp), sy = dFdy(sp);
          float dhx = dFdx(fBump), dhy = dFdy(fBump);
          vec3 r1 = cross(sy, normal), r2 = cross(normal, sx);
          float det = dot(sx, r1) * faceDirection;
          vec3 grad = sign(det) * (dhx * r1 + dhy * r2);
          normal = normalize(abs(det) * normal - grad); }`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fEmis;');
  };
  m.customProgramCacheKey = () => 'meridian-building';
  return m;
}

/**
 * Trim / prop material: vertex colour plus a `trim` attribute (roughness, metalness, pattern, glow).
 * pattern: 0 plain, 1 awning stripes (uv.x), 2 grime noise, 3 glows only at night, 4 always glows.
 */
export function trimMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = nightUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec4 trim; flat varying vec4 vTrim; varying vec2 vTUv; varying vec3 vTW;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvTrim = vec4(trim.xy / 255.0, trim.z, trim.w / 10.0); vTUv = uv; // Round 11: packed bytes (builders.ts packTrim)')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvTW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uNight; flat varying vec4 vTrim; varying vec2 vTUv; varying vec3 vTW;
      float th(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      float tn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(th(i), th(i + vec2(1, 0)), f.x), mix(th(i + vec2(0, 1)), th(i + vec2(1, 1)), f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float tp = floor(vTrim.z + 0.5);
        if (tp > 0.5 && tp < 1.5) { float st = step(0.5, fract(vTUv.x / 0.6)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.85), st); }
        if (tp > 1.5 && tp < 2.5) { diffuseColor.rgb *= 0.8 + 0.3 * tn(vTW.xz * 1.7 + vTW.y * 2.3); }
        diffuseColor.rgb *= 0.94 + 0.08 * tn(vTW.xz * 0.9 + vTW.yy * 1.3);`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vTrim.x;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vTrim.y;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        float tg = tp > 3.5 ? 1.0 : (tp > 2.5 ? smoothstep(0.1, 0.6, uNight) : 0.0);
        totalEmissiveRadiance += diffuseColor.rgb * vTrim.w * tg;`);
  };
  m.customProgramCacheKey = () => 'meridian-trim';
  return m;
}

/** Invented shop brands for signs (never real companies). */
export const BRANDS = [
  { name: 'TIDEWATER ARMS', bg: '#1f3b40', fg: '#ffcf7a' }, { name: 'GLOW GARAGE', bg: '#2a1e3f', fg: '#7ff3ff' },
  { name: 'JUNIPER COFFEE', bg: '#244234', fg: '#f6e7c8' }, { name: "SAL'S NOODLES", bg: '#7a2b25', fg: '#ffe0a3' },
  { name: 'KESTREL MART', bg: '#173a5c', fg: '#ffffff' }, { name: 'NEON LAGOON', bg: '#14142a', fg: '#ff6fb5' },
  { name: 'PIER 9 FISH', bg: '#0f4c5c', fg: '#ffd166' }, { name: 'HALYARD HOTEL', bg: '#3b2a1e', fg: '#f2c14e' },
  { name: 'COBALT CINEMA', bg: '#1b2a6b', fg: '#ffe066' }, { name: 'BASIL & BRINE', bg: '#38502e', fg: '#fdf0d5' },
  { name: 'SUNDIAL BOOKS', bg: '#6b3d1e', fg: '#ffe8c2' }, { name: 'MERIDIAN BANK', bg: '#20343c', fg: '#d9f0f2' },
  { name: 'FIZZWELL SODA', bg: '#c4433a', fg: '#fff7e0' }, { name: 'ORBIT LAUNDRY', bg: '#3a6d8c', fg: '#ffffff' },
  { name: 'SALT & SAGE', bg: '#5a5d3a', fg: '#fff1d0' }, { name: 'COASTLINE FM', bg: '#2b1b33', fg: '#ff9e5e' },
  { name: 'DOUBLE DOWN PAWN', bg: '#1c1c1c', fg: '#ffd84d' }, { name: 'HOT PLATE DINER', bg: '#8c1c22', fg: '#fff2d6' },
  { name: 'BRASS KEY LOCKS', bg: '#3a3020', fg: '#e8c26a' }, { name: 'VELVET NAILS', bg: '#5c2346', fg: '#ffd1ec' },
  { name: 'MOTOR CITY TIRES', bg: '#222831', fg: '#f05454' }, { name: 'CHECK CASHING', bg: '#0e5132', fg: '#d8ffcf' },
  { name: 'TAQUERIA SOL', bg: '#d17b0f', fg: '#2a1400' }, { name: 'PIXEL ARCADE', bg: '#101030', fg: '#6af0ff' },
  { name: 'GOLDLEAF JEWELERS', bg: '#141414', fg: '#e9c46a' }, { name: 'HARBOR LIQUOR', bg: '#29335c', fg: '#f3d34a' },
  { name: 'SUDS & DUDS', bg: '#d8e2dc', fg: '#2b4162' }, { name: 'IRONWORKS GYM', bg: '#232323', fg: '#ff6b35' },
  { name: 'DRAGON WOK', bg: '#a4161a', fg: '#ffd166' }, { name: 'FRESH CUTS', bg: '#f1faee', fg: '#1d3557' },
  { name: 'QUICK FIX PHONES', bg: '#1d3557', fg: '#a8dadc' }, { name: 'PALM TREE MOTEL', bg: '#ff7b9c', fg: '#ffffff' },
];
/** An 4x8 atlas of shop signs for invented brands (lit at night). */
export function signAtlas(): THREE.Texture {
  const { c, g } = canvas(1024, 512);
  BRANDS.forEach((b, i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 64;
    const gr = g.createLinearGradient(0, y, 0, y + 64); gr.addColorStop(0, b.bg); gr.addColorStop(1, shade(b.bg, -0.25));
    g.fillStyle = gr; g.fillRect(x + 2, y + 2, 252, 60);
    g.strokeStyle = shade(b.bg, 0.25); g.lineWidth = 3; g.strokeRect(x + 4, y + 4, 248, 56);
    g.fillStyle = b.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 30; g.font = `800 ${size}px "Arial Narrow", Arial, sans-serif`;
    while (g.measureText(b.name).width > 226 && size > 13) { size--; g.font = `800 ${size}px "Arial Narrow", Arial, sans-serif`; }
    g.shadowColor = b.fg; g.shadowBlur = 6; g.fillText(b.name, x + 128, y + 34); g.shadowBlur = 0;
  });
  const t = tex(c, false); t.anisotropy = 8; return t;
}
function shade(hex: string, k: number) { const c = new THREE.Color(hex); if (k > 0) c.lerp(new THREE.Color(1, 1, 1), k); else c.multiplyScalar(1 + k); return `#${c.getHexString()}`; }

export const BILLBOARD_COUNT = 8;
/** Billboard posters (2 x 4 atlas) for invented products. */
export function billboardAtlas(): THREE.Texture {
  const { c, g } = canvas(2048, 1024);
  const ads = [
    { t: 'FIZZWELL', s: 'Taste the tide.', a: '#ff6b4a', b: '#ffd166', shape: 'can' },
    { t: 'COASTLINE FM', s: '98.6 · Afterglow hits all night', a: '#2b1b6b', b: '#ff7ab6', shape: 'wave' },
    { t: 'HALYARD HOTEL', s: 'Rooms with a view of everything', a: '#14535c', b: '#f6e7c8', shape: 'tower' },
    { t: 'ORBITAL', s: 'Phones that listen less.', a: '#121212', b: '#7ff3ff', shape: 'phone' },
    { t: 'VANTA MOTORS', s: 'The new Stallion GT. Unreasonable.', a: '#0c0c0c', b: '#d62828', shape: 'car' },
    { t: 'CLUCK SHACK', s: 'Fried. Fast. Forgiven.', a: '#f77f00', b: '#fcbf49', shape: 'bucket' },
    { t: 'BLUE MARLIN', s: 'Island rum for city nights', a: '#003049', b: '#2a9d8f', shape: 'bottle' },
    { t: 'SECOND CHANCE LAW', s: 'Arrested? Call 555-0199', a: '#e9ecef', b: '#adb5bd', shape: 'scale' },
  ];
  ads.forEach((ad, i) => {
    const x = (i % 4) * 512, y = Math.floor(i / 4) * 512, W = 512, H = 256, oy = y + 128;
    const gr = g.createLinearGradient(x, oy, x + W, oy + H); gr.addColorStop(0, ad.a); gr.addColorStop(1, ad.b);
    g.fillStyle = gr; g.fillRect(x, oy, W, H);
    const dark = ad.shape === 'scale';
    g.fillStyle = dark ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(x + 410, oy + 90, 120, 0, Math.PI * 2); g.fill();
    // product glyph
    g.save(); g.translate(x + 400, oy + 140); g.fillStyle = dark ? '#343a40' : 'rgba(255,255,255,0.9)';
    if (ad.shape === 'can') { g.fillRect(-35, -70, 70, 130); g.fillStyle = ad.a; g.fillRect(-35, -20, 70, 30); }
    else if (ad.shape === 'car') { g.beginPath(); g.moveTo(-110, 30); g.lineTo(-90, -5); g.lineTo(-30, -25); g.lineTo(40, -25); g.lineTo(90, 0); g.lineTo(110, 30); g.closePath(); g.fill(); g.fillStyle = '#222'; g.beginPath(); g.arc(-60, 32, 18, 0, 7); g.arc(60, 32, 18, 0, 7); g.fill(); }
    else if (ad.shape === 'phone') { g.fillRect(-40, -80, 80, 150); g.fillStyle = ad.b; g.fillRect(-32, -66, 64, 116); }
    else if (ad.shape === 'tower') { g.fillRect(-30, -90, 60, 170); g.fillRect(-55, 10, 110, 70); }
    else if (ad.shape === 'bottle') { g.fillRect(-14, -90, 28, 40); g.beginPath(); g.moveTo(-14, -50); g.lineTo(-40, -10); g.lineTo(-40, 80); g.lineTo(40, 80); g.lineTo(40, -10); g.lineTo(14, -50); g.fill(); }
    else if (ad.shape === 'bucket') { g.beginPath(); g.moveTo(-60, -50); g.lineTo(60, -50); g.lineTo(45, 70); g.lineTo(-45, 70); g.closePath(); g.fill(); g.fillStyle = ad.a; g.fillRect(-55, -20, 110, 22); }
    else if (ad.shape === 'scale') { g.fillRect(-4, -80, 8, 150); g.fillRect(-70, -70, 140, 8); g.beginPath(); g.arc(-60, -20, 26, 0, Math.PI); g.arc(60, -20, 26, 0, Math.PI); g.fill(); }
    else { for (let k = 0; k < 4; k++) { g.beginPath(); g.arc(0, 40 + k * 10, 90 - k * 14, Math.PI, 0); g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,0.8)'; g.stroke(); } }
    g.restore();
    g.fillStyle = dark ? '#1d1d1d' : '#fff'; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
    let size = 62; g.font = `900 ${size}px Arial, sans-serif`; while (g.measureText(ad.t).width > 300 && size > 30) { size--; g.font = `900 ${size}px Arial, sans-serif`; }
    g.fillText(ad.t, x + 28, oy + 120);
    g.font = '600 24px Arial, sans-serif'; g.fillText(ad.s, x + 30, oy + 170, 330);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, oy + H - 6, W, 6);
  });
  const t = tex(c, false); t.anisotropy = 8; return t;
}
/** Soft radial gradient used for light pools, glows and particles. */
export function glowTexture(): THREE.Texture {
  const { c, g } = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
/** Worn paint mask for road markings (white = paint present). */
export function paintWearTexture(): THREE.Texture {
  const S = 256, r = new Rng(19); const { c, g } = canvas(S, S); const img = g.createImageData(S, S); const d = img.data;
  const f = fbmField(S, r, 16), fine = noiseField(S, 128, r);
  for (let i = 0; i < S * S; i++) { const x = i % S, y = Math.floor(i / S); const v = f(x, y) * 0.75 + fine(x, y) * 0.25 + (r.next() - 0.5) * 0.15; const a = v > 0.36 ? 255 : 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255; d[i * 4 + 3] = a; }
  g.putImageData(img, 0, 0);
  return tex(c, true, true);
}
/** Leaf cluster card (alpha) for trees. */
export function leafTexture(kind: 'broad' | 'palm' = 'broad'): THREE.Texture {
  const S = 256, r = new Rng(kind === 'broad' ? 23 : 29); const { c, g } = canvas(S, S);
  if (kind === 'broad') {
    for (let k = 0; k < 420; k++) {
      const a = r.range(0, Math.PI * 2), rad = Math.sqrt(r.next()) * 112;
      const x = 128 + Math.cos(a) * rad, y = 128 + Math.sin(a) * rad * 0.9;
      const l = r.range(0.55, 1.05), hue = r.range(0.22, 0.3);
      const col = new THREE.Color().setHSL(hue, r.range(0.35, 0.6), 0.16 + l * 0.18 * (1 - rad / 200));
      g.fillStyle = `#${col.getHexString()}`;
      g.save(); g.translate(x, y); g.rotate(r.range(0, Math.PI * 2)); g.beginPath(); g.ellipse(0, 0, r.range(5, 10), r.range(3, 5), 0, 0, Math.PI * 2); g.fill(); g.restore();
    }
  } else {
    // a single frond: central rib with leaflets
    g.strokeStyle = '#5a6b2e'; g.lineWidth = 4; g.beginPath(); g.moveTo(8, 128); g.quadraticCurveTo(128, 100, 250, 140); g.stroke();
    for (let k = 0; k < 46; k++) {
      const t = k / 46, x = 8 + t * 240, y = 128 - Math.sin(t * Math.PI) * 22 + t * 12;
      const len = Math.sin(Math.min(1, t * 1.3) * Math.PI) * 70 + 10;
      for (const s of [-1, 1]) { g.strokeStyle = `hsl(${r.range(80, 100)}, ${r.range(35, 55)}%, ${r.range(22, 34)}%)`; g.lineWidth = 3.2; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 14, y + s * len * 0.5, x + 26, y + s * len); g.stroke(); }
    }
  }
  const t = tex(c, false, true); return t;
}
