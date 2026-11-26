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
/**
 * Builds albedo + normal + roughness textures from per-pixel albedo/height/roughness buffers.
 * paint() fills col (rgb 0..1), h (metres-ish) and rough (0..1); strokes may also be drawn on the 2D context `g`
 * (it is composited over col first).
 */
function surface(size: number, bumpScale: number, paint: (col: Float32Array, h: Float32Array, rough: Float32Array, overlay: CanvasRenderingContext2D) => void): Surface {
  const n = size * size;
  const col = new Float32Array(n * 3), h = new Float32Array(n), rough = new Float32Array(n).fill(0.9);
  const ov = canvas(size, size);
  paint(col, h, rough, ov.g);
  // composite overlay strokes (alpha = darkening/colour, blue channel encodes depth)
  const od = ov.g.getImageData(0, 0, size, size).data;
  const { c, g } = canvas(size, size); const img = g.createImageData(size, size); const d = img.data;
  for (let i = 0; i < n; i++) {
    const a = od[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) { const v = col[i * 3 + k] * (1 - a) + (od[i * 4 + k] / 255) * a; d[i * 4 + k] = Math.max(0, Math.min(255, Math.round(Math.pow(Math.max(0, v), 1 / 2.2) * 255))); }
    d[i * 4 + 3] = 255;
    h[i] -= a * 0.6;
  }
  g.putImageData(img, 0, 0);
  // Round 12: one 3x3 box blur of the height field before deriving normals. Per-texel white-noise heights made per-texel
  // random normals, which sparkled like glitter under headlights at grazing angles (the night streets looked like snow).
  const hb = new Float32Array(n);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let acc = 0;
    for (let dy = -1; dy <= 1; dy++) { const row = ((y + dy + size) % size) * size; for (let dx = -1; dx <= 1; dx++) acc += h[row + ((x + dx + size) % size)]; }
    hb[y * size + x] = acc / 9;
  }
  h.set(hb);
  const nc = canvas(size, size), nimg = nc.g.createImageData(size, size), nd = nimg.data;
  const rc = canvas(size, size), rimg = rc.g.createImageData(size, size), rd = rimg.data;
  const H = (x: number, y: number) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const i = y * size + x;
    const dx = (H(x + 1, y) - H(x - 1, y)) * bumpScale, dy = (H(x, y + 1) - H(x, y - 1)) * bumpScale;
    const l = Math.hypot(dx, dy, 1);
    nd[i * 4] = Math.round((-dx / l * 0.5 + 0.5) * 255); nd[i * 4 + 1] = Math.round((dy / l * 0.5 + 0.5) * 255); nd[i * 4 + 2] = Math.round((1 / l * 0.5 + 0.5) * 255); nd[i * 4 + 3] = 255;
    const r = Math.round(Math.max(0, Math.min(1, rough[i])) * 255); rd[i * 4] = r; rd[i * 4 + 1] = r; rd[i * 4 + 2] = r; rd[i * 4 + 3] = 255;
  }
  nc.g.putImageData(nimg, 0, 0); rc.g.putImageData(rimg, 0, 0);
  return { map: tex(c), normalMap: tex(nc.c, true, false), roughnessMap: tex(rc.c, true, false) };
}

/** Road asphalt: aggregate, tar-sealed cracks, repair patches, oil stains. One tile covers 12 m. */
export function asphaltSurface(): Surface {
  const S = 1024, r = new Rng(3);
  return surface(S, 3.0, (col, h, rough, g) => {
    const big = fbmField(S, r, 4), mid = fbmField(S, r, 16), fine = noiseField(S, 256, r);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const b = big(x, y), m = mid(x, y), f = fine(x, y);
      const grain = r.next();
      let v = 0.085 + b * 0.035 + m * 0.03 + (grain > 0.93 ? 0.06 : grain < 0.08 ? -0.02 : 0) + f * 0.015;
      const worn = Math.max(0, b - 0.55) * 0.12; v += worn; // polished lighter wheel tracks feel
      col[i * 3] = v * 0.98; col[i * 3 + 1] = v; col[i * 3 + 2] = v * 1.04;
      h[i] = grain * 0.35 + m * 0.6;
      rough[i] = 0.82 + grain * 0.12 - worn;
    }
    // repair patches: slightly darker, crisp edges
    for (let k = 0; k < 7; k++) {
      const px = r.range(0, S), py = r.range(0, S), pw = r.range(60, 220), ph = r.range(40, 160);
      for (let y = Math.floor(py); y < py + ph; y++) for (let x = Math.floor(px); x < px + pw; x++) {
        const i = ((y % S) * S + (x % S)); const tone = k % 2 ? 0.75 : 1.18;
        col[i * 3] *= tone; col[i * 3 + 1] *= tone; col[i * 3 + 2] *= tone; h[i] += 0.25;
      }
    }
    // oil stains
    for (let k = 0; k < 18; k++) {
      const cx = r.range(0, S), cy = r.range(0, S), rad = r.range(10, 46), sq = r.range(0.5, 1);
      for (let y = Math.floor(cy - rad); y < cy + rad; y++) for (let x = Math.floor(cx - rad); x < cx + rad; x++) {
        const d = Math.hypot((x - cx) / rad, (y - cy) / (rad * sq)); if (d > 1) continue;
        const i = (((y % S) + S) % S) * S + (((x % S) + S) % S); const a = (1 - d) * 0.55;
        col[i * 3] *= 1 - a; col[i * 3 + 1] *= 1 - a; col[i * 3 + 2] *= 1 - a * 0.9; rough[i] = Math.min(rough[i], 0.55 + d * 0.3);
      }
    }
    // tar-sealed cracks: branching dark lines
    g.lineCap = 'round'; g.lineJoin = 'round';
    for (let k = 0; k < 34; k++) {
      let x = r.range(0, S), y = r.range(0, S), a = r.range(0, Math.PI * 2);
      g.strokeStyle = `rgba(14,14,15,${r.range(0.55, 0.9)})`; g.lineWidth = r.range(1.2, 3.2);
      g.beginPath(); g.moveTo(x, y);
      for (let s = 0; s < r.int(6, 18); s++) {
        a += r.range(-0.6, 0.6); x += Math.cos(a) * r.range(8, 22); y += Math.sin(a) * r.range(8, 22); g.lineTo(x, y);
        if (r.chance(0.15)) { g.stroke(); g.beginPath(); g.moveTo(x, y); }
      }
      g.stroke();
    }
  });
}
/** Concrete sidewalk slabs (1.5 m) with joints, stains, gum and occasional cracks. One tile covers 6 m. */
export function pavementSurface(): Surface {
  const S = 512, r = new Rng(5), slabs = 4, sp = S / slabs;
  return surface(S, 4.0, (col, h, rough, g) => {
    const mid = fbmField(S, r, 8), fine = noiseField(S, 128, r);
    const tones: number[] = []; for (let k = 0; k < slabs * slabs; k++) tones.push(r.range(0.9, 1.08));
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const sx = Math.floor(x / sp), sy = Math.floor(y / sp);
      const jx = Math.min(x % sp, sp - (x % sp)), jy = Math.min(y % sp, sp - (y % sp));
      const joint = Math.min(jx, jy) < 1.6 ? 1 : 0;
      const edge = Math.min(jx, jy) < 4 ? 0.96 : 1;
      const v = (0.42 + mid(x, y) * 0.1 + fine(x, y) * 0.04 + (r.next() - 0.5) * 0.04) * tones[sy * slabs + sx] * edge * (joint ? 0.55 : 1);
      col[i * 3] = v * 1.0; col[i * 3 + 1] = v * 0.985; col[i * 3 + 2] = v * 0.95;
      h[i] = joint ? -0.5 : fine(x, y) * 0.1;
      rough[i] = 0.88;
    }
    for (let k = 0; k < 40; k++) { const x = r.range(0, S), y = r.range(0, S); g.fillStyle = `rgba(40,38,36,${r.range(0.15, 0.45)})`; g.beginPath(); g.arc(x, y, r.range(1, 2.6), 0, 7); g.fill(); }
    for (let k = 0; k < 8; k++) { const x = r.range(0, S), y = r.range(0, S); const gr = g.createRadialGradient(x, y, 0, x, y, r.range(12, 40)); gr.addColorStop(0, 'rgba(60,52,44,0.25)'); gr.addColorStop(1, 'rgba(60,52,44,0)'); g.fillStyle = gr; g.fillRect(x - 40, y - 40, 80, 80); }
    g.strokeStyle = 'rgba(30,30,30,0.5)'; g.lineWidth = 1;
    for (let k = 0; k < 5; k++) { let x = r.range(0, S), y = r.range(0, S); g.beginPath(); g.moveTo(x, y); for (let s = 0; s < 6; s++) { x += r.range(-14, 14); y += r.range(-14, 14); g.lineTo(x, y); } g.stroke(); }
  });
}
export function grassSurface(): Surface {
  const S = 512, r = new Rng(7);
  return surface(S, 2.0, (col, h, rough) => {
    const big = fbmField(S, r, 4), mid = fbmField(S, r, 24);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x; const b = big(x, y), m = mid(x, y), blade = r.next();
      const dry = Math.max(0, b - 0.55) * 1.6;
      const v = 0.75 + blade * 0.45 + m * 0.2;
      col[i * 3] = (0.12 + dry * 0.12) * v; col[i * 3 + 1] = (0.2 + dry * 0.06) * v; col[i * 3 + 2] = (0.07 + dry * 0.02) * v;
      if (blade > 0.985) { col[i * 3] *= 0.5; col[i * 3 + 1] *= 0.5; col[i * 3 + 2] *= 0.5; }
      h[i] = blade * 0.5; rough[i] = 0.95;
    }
  });
}
export function sandSurface(): Surface {
  const S = 256, r = new Rng(11);
  return surface(S, 1.5, (col, h, rough) => {
    const mid = fbmField(S, r, 8), rip = noiseField(S, 32, r);
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      const i = y * S + x; const v = 0.62 + mid(x, y) * 0.12 + (r.next() - 0.5) * 0.08;
      col[i * 3] = v * 0.93; col[i * 3 + 1] = v * 0.8; col[i * 3 + 2] = v * 0.6;
      h[i] = Math.sin((y + rip(x, y) * 30) * 0.35) * 0.3 + r.next() * 0.2; rough[i] = 0.97;
    }
  });
}
/** Back-compat helpers returning only the albedo. */
export function grassTexture(): THREE.Texture { return grassSurface().map; }
export function sandTexture(): THREE.Texture { return sandSurface().map; }

/** World-space macro variation (breaks texture tiling) for ground materials using map uv in metres / tile. */
export function addMacroVariation(m: THREE.MeshStandardMaterial, strength = 0.18, scale = 0.012, key = 'macro') {
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
        diffuseColor.rgb *= 1.0 + (mv - 0.5) * ${(strength * 2).toFixed(3)}; }`);
  };
  m.customProgramCacheKey = () => key;
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
  const S = kind === 'broad' ? 512 : 256, r = new Rng(kind === 'broad' ? 23 : 29); const { c, g } = canvas(S, S);
  if (kind === 'broad') {
    // a leafy sprig: ~70 individual pointed leaves on short stalks, back (dark, small) to front (bright), with gaps between
    // twigs so the alpha-tested card shows sky holes. Canvas edges are antialiased -> soft alpha edge before the alphaTest cut.
    const cx = S / 2, cy = S / 2;
    const leaf = (x: number, y: number, ang: number, len: number, wid: number, col: string, vein: string) => {
      g.save(); g.translate(x, y); g.rotate(ang);
      g.fillStyle = col; g.beginPath(); g.moveTo(0, 0);
      g.bezierCurveTo(len * 0.25, -wid, len * 0.7, -wid * 0.8, len, 0);
      g.bezierCurveTo(len * 0.7, wid * 0.8, len * 0.25, wid, 0, 0); g.fill();
      g.strokeStyle = vein; g.lineWidth = 1.4; g.beginPath(); g.moveTo(0, 0); g.lineTo(len * 0.92, 0); g.stroke();
      g.restore();
    };
    for (let layer = 0; layer < 3; layer++) {
      const n = layer === 0 ? 34 : layer === 1 ? 30 : 22;
      for (let k = 0; k < n; k++) {
        const a = r.range(0, Math.PI * 2), rad = Math.pow(r.next(), 0.7) * S * 0.3;
        const x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad * 0.92;
        if (rad < S * 0.07 && r.next() < 0.6) continue; // open centre: sky shows through
        const edge = rad / (S * 0.3);
        const light = (layer === 0 ? 0.2 : layer === 1 ? 0.3 : 0.4) + r.range(-0.03, 0.05) + edge * 0.04;
        const hue = r.range(0.2, 0.31) + (r.next() < 0.18 ? 0.04 : 0);
        const col = new THREE.Color().setHSL(hue, r.range(0.4, 0.62), light);
        const vein = new THREE.Color().setHSL(hue + 0.02, 0.4, light + 0.1);
        const len = S * r.range(0.14, 0.21) * (layer === 0 ? 0.9 : 1), wid = len * r.range(0.26, 0.38);
        leaf(x, y, a + r.range(-0.9, 0.9), len, wid, `#${col.getHexString()}`, `#${vein.getHexString()}`);
      }
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
