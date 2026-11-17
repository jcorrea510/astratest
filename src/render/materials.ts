/** Procedural textures and shared materials. Everything here is generated in code (no external files). */
import * as THREE from 'three';
import { Rng } from '../core/rng';

/** Night factor shared by every material that glows after dusk. */
export const nightUniform = { value: 0 };
export const timeUniform = { value: 0 };

function canvas(w: number, h: number) { const c = document.createElement('canvas'); c.width = w; c.height = h; return { c, g: c.getContext('2d')! }; }
function tex(c: HTMLCanvasElement, repeat = true, srgb = true) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 4; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

export function asphaltTexture(): THREE.Texture {
  const { c, g } = canvas(512, 512); const r = new Rng(3);
  g.fillStyle = '#5d6266'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 9000; i++) { const v = r.range(-22, 22); g.fillStyle = `rgba(${128 + v},${132 + v},${138 + v},0.09)`; g.fillRect(r.range(0, 512), r.range(0, 512), r.range(1, 3), r.range(1, 3)); }
  for (let i = 0; i < 26; i++) { g.strokeStyle = 'rgba(20,22,26,0.18)'; g.lineWidth = r.range(1, 3); g.beginPath(); let x = r.range(0, 512), y = r.range(0, 512); g.moveTo(x, y); for (let k = 0; k < 6; k++) { x += r.range(-40, 40); y += r.range(-40, 40); g.lineTo(x, y); } g.stroke(); }
  for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(25,28,32,0.14)'; g.beginPath(); g.ellipse(r.range(0, 512), r.range(0, 512), r.range(10, 50), r.range(8, 30), r.range(0, 3), 0, Math.PI * 2); g.fill(); }
  return tex(c);
}
export function pavementTexture(): THREE.Texture {
  const { c, g } = canvas(256, 256); const r = new Rng(5);
  g.fillStyle = '#b9b1a6'; g.fillRect(0, 0, 256, 256);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) {
    const v = r.range(-10, 10); g.fillStyle = `rgb(${186 + v},${178 + v},${168 + v})`; g.fillRect(x * 64 + 1.5, y * 64 + 1.5, 61, 61);
  }
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(90,80,70,${r.range(0.03, 0.09)})`; g.fillRect(r.range(0, 256), r.range(0, 256), 2, 2); }
  return tex(c);
}
export function grassTexture(): THREE.Texture {
  const { c, g } = canvas(256, 256); const r = new Rng(9);
  g.fillStyle = '#6f9a4c'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5000; i++) { const v = r.range(-25, 25); g.fillStyle = `rgba(${100 + v},${150 + v},${70 + v * 0.5},0.25)`; g.fillRect(r.range(0, 256), r.range(0, 256), 1.5, r.range(2, 5)); }
  return tex(c);
}
export function sandTexture(): THREE.Texture {
  const { c, g } = canvas(256, 256); const r = new Rng(11);
  g.fillStyle = '#e8cf9e'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 6000; i++) { const v = r.range(-20, 20); g.fillStyle = `rgba(${210 + v},${185 + v},${140 + v},0.25)`; g.fillRect(r.range(0, 256), r.range(0, 256), 1.5, 1.5); }
  return tex(c);
}

/** Facade material: windows, frames and night lights computed per pixel from metre-space UVs. */
export function facadeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05 });
  m.onBeforeCompile = shader => {
    shader.uniforms.uNight = nightUniform;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 facade;\nvarying vec4 vFacade;\nvarying vec2 vFUv;\nvarying vec3 vWPos;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\nvFacade = facade; vFUv = uv;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uNight; varying vec4 vFacade; varying vec2 vFUv; varying vec3 vWPos;
        float fh(vec2 p){ p = mod(p, 61.0); vec3 q = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        // vFacade: x = style (0 none/roof, 1 glass grid, 2 punched windows, 3 corrugated, 4 storefront band), y = seed, z = cell width, w = floor height
        float style = vFacade.x; float glow = 0.0; float glass = 0.0; vec3 fGlowC = vec3(0.0);
        if (style > 0.5) {
          vec2 cs = vec2(vFacade.z, vFacade.w);
          vec2 cell = floor(vFUv / cs); vec2 f = fract(vFUv / cs);
          if (style < 1.5) {
            float frame = step(0.06, f.x) * step(f.x, 0.94) * step(0.1, f.y) * step(f.y, 0.92);
            glass = frame;
            float mull = 1.0 - step(0.48, f.x) * step(f.x, 0.52);
            glass *= mull;
          } else if (style < 2.5) {
            glass = step(0.24, f.x) * step(f.x, 0.76) * step(0.3, f.y) * step(f.y, 0.86);
            float sill = step(0.2, f.x) * step(f.x, 0.8) * step(0.24, f.y) * step(f.y, 0.3);
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92, 0.9, 0.86), sill);
          } else if (style < 3.5) {
            float rib = 0.5 + 0.5 * sin(vFUv.x * 6.2831 * 2.5);
            diffuseColor.rgb *= 0.86 + 0.14 * rib;
            glass = step(0.94, f.y) * step(mod(cell.x, 3.0), 0.5) * step(0.15, f.x) * step(f.x, 0.85);
          }
          if (cell.y < 0.5 && style < 2.5) { glass = step(0.04, f.x) * step(f.x, 0.96) * step(0.08, f.y) * step(f.y, 0.8); }
          float lit = step(0.64, fh(cell + vec2(mod(vFacade.y, 37.0), floor(mod(vWPos.x * 0.01 + vWPos.z * 0.013, 17.0)))));
          float warm = fh(cell * 1.7 + vec2(mod(vFacade.y, 29.0), 3.0));
          vec3 day = mix(vec3(0.22, 0.34, 0.4), vec3(0.5, 0.66, 0.74), clamp(f.y * 0.8 + 0.1, 0.0, 1.0));
          vec3 litCol = mix(vec3(1.0, 0.78, 0.45), vec3(0.75, 0.9, 1.0), step(0.82, warm));
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(day, day * 0.35, uNight), glass);
          glow = glass * lit * uNight;
          if (cell.y < 0.5) { glow = glass * uNight * 0.32; litCol = vec3(1.0, 0.72, 0.42); }
          fGlowC = litCol * glow;
        }
        vec3 fGlow = fGlowC;
        float fGlass = glass;`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.18, fGlass);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.6, fGlass);')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += fGlow * 0.75;');
  };
  return m;
}

/** KayKit atlas variants: the same models in a different palette per district, plus night window glow. */
export function atlasVariant(base: THREE.Texture, kind: 'original' | 'pastel' | 'muted'): THREE.Texture {
  if (kind === 'original') return base;
  const img = base.image as HTMLImageElement | ImageBitmap;
  const { c, g } = canvas(img.width, img.height);
  g.drawImage(img as CanvasImageSource, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
    const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
    const sat = mx - mn;
    if (sat < 0.12) continue; // keep neutrals (frames, glass, roofs)
    const col = new THREE.Color(r, gg, b); const hsl = { h: 0, s: 0, l: 0 }; col.getHSL(hsl);
    if (kind === 'pastel') { hsl.l = 0.55 + hsl.l * 0.35; hsl.s *= 0.62; hsl.h = (hsl.h + 0.02) % 1; }
    else { hsl.s *= 0.6; hsl.l = 0.2 + hsl.l * 0.7; }
    col.setHSL(hsl.h, hsl.s, hsl.l);
    d[i] = col.r * 255; d[i + 1] = col.g * 255; d[i + 2] = col.b * 255;
  }
  g.putImageData(data, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = base.flipY; t.magFilter = base.magFilter; t.minFilter = base.minFilter;
  return t;
}
/** Emissive mask for the KayKit atlas: the dark glass swatch glows warm at night. */
export function atlasEmissive(base: THREE.Texture): THREE.Texture {
  const img = base.image as HTMLImageElement;
  const { c, g } = canvas(img.width, img.height);
  g.fillStyle = '#000'; g.fillRect(0, 0, c.width, c.height);
  const cw = c.width / 8, ch = c.height / 4;
  const grad = g.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, '#ffd08a'); grad.addColorStop(1, '#ff9f4a');
  g.fillStyle = grad; g.fillRect(0, 0, cw * 0.84, ch);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.flipY = base.flipY;
  return t;
}
export function kaykitMaterial(map: THREE.Texture, emissive: THREE.Texture | null): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, roughness: 0.82, metalness: 0.0 });
  if (emissive) {
    m.emissiveMap = emissive; m.emissive = new THREE.Color(1, 1, 1); m.emissiveIntensity = 0;
    m.onBeforeCompile = shader => {
      shader.uniforms.uNight = nightUniform;
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWPos2;').replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos2 = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight; varying vec3 vWPos2; float kh(vec3 p){ return fract(sin(dot(p, vec3(12.7, 78.2, 37.9))) * 43758.5); }')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
          float wl = step(0.45, kh(floor(vWPos2 * vec3(0.55, 0.32, 0.55))));
          totalEmissiveRadiance = texture2D(emissiveMap, vEmissiveMapUv).rgb * uNight * wl * 0.9;`);
    };
    m.customProgramCacheKey = () => 'kaykit-night';
  }
  return m;
}

export const BRANDS = [
  { name: 'TIDEWATER ARMS', bg: '#1f3b40', fg: '#ffcf7a' }, { name: 'GLOW GARAGE', bg: '#2a1e3f', fg: '#7ff3ff' },
  { name: 'JUNIPER COFFEE', bg: '#244234', fg: '#f6e7c8' }, { name: "SAL'S NOODLES", bg: '#7a2b25', fg: '#ffe0a3' },
  { name: 'KESTREL MART', bg: '#173a5c', fg: '#ffffff' }, { name: 'NEON LAGOON', bg: '#14142a', fg: '#ff6fb5' },
  { name: 'PIER 9 FISH', bg: '#0f4c5c', fg: '#ffd166' }, { name: 'HALYARD HOTEL', bg: '#3b2a1e', fg: '#f2c14e' },
  { name: 'COBALT CINEMA', bg: '#1b2a6b', fg: '#ffe066' }, { name: 'BASIL & BRINE', bg: '#38502e', fg: '#fdf0d5' },
  { name: 'SUNDIAL BOOKS', bg: '#6b3d1e', fg: '#ffe8c2' }, { name: 'MERIDIAN BANK', bg: '#20343c', fg: '#d9f0f2' },
  { name: 'FIZZWELL SODA', bg: '#c4433a', fg: '#fff7e0' }, { name: 'ORBIT LAUNDRY', bg: '#3a6d8c', fg: '#ffffff' },
  { name: 'SALT & SAGE', bg: '#5a5d3a', fg: '#fff1d0' }, { name: 'COASTLINE FM', bg: '#2b1b33', fg: '#ff9e5e' },
];
/** A 4x4 atlas of illuminated shop signs for invented brands. */
export function signAtlas(): THREE.Texture {
  const { c, g } = canvas(1024, 256);
  BRANDS.forEach((b, i) => {
    const x = (i % 4) * 256, y = Math.floor(i / 4) * 64;
    g.fillStyle = b.bg; g.fillRect(x + 2, y + 2, 252, 60);
    g.strokeStyle = b.fg; g.globalAlpha = 0.5; g.lineWidth = 2; g.strokeRect(x + 7, y + 7, 242, 50); g.globalAlpha = 1;
    g.fillStyle = b.fg; g.font = '700 26px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    let size = 26; while (g.measureText(b.name).width > 228 && size > 14) { size--; g.font = `700 ${size}px "Arial Narrow", Arial, sans-serif`; }
    g.fillText(b.name, x + 128, y + 33);
  });
  const t = tex(c, false); t.anisotropy = 8; return t;
}
/** Billboard posters for rooftops. */
export function billboardAtlas(): THREE.Texture {
  const { c, g } = canvas(1024, 512);
  const ads = [
    { t: 'FIZZWELL', s: 'Taste the tide.', a: '#ff6b4a', b: '#ffd166' },
    { t: 'COASTLINE FM', s: '98.6 · Afterglow hits', a: '#2b1b6b', b: '#ff7ab6' },
    { t: 'HALYARD', s: 'Rooms with a view', a: '#14535c', b: '#f6e7c8' },
    { t: 'ORBITAL', s: 'Phones that listen less', a: '#1d1d1d', b: '#7ff3ff' },
  ];
  ads.forEach((ad, i) => {
    const x = (i % 2) * 512, y = Math.floor(i / 2) * 256;
    const gr = g.createLinearGradient(x, y, x + 512, y + 256); gr.addColorStop(0, ad.a); gr.addColorStop(1, ad.b);
    g.fillStyle = gr; g.fillRect(x, y, 512, 256);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.beginPath(); g.arc(x + 420, y + 60, 120, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.font = '900 64px Arial, sans-serif'; g.textAlign = 'left'; g.fillText(ad.t, x + 30, y + 130);
    g.font = '500 30px Arial, sans-serif'; g.fillText(ad.s, x + 32, y + 185);
  });
  return tex(c, false);
}
/** Soft radial gradient used for light pools, glows and particles. */
export function glowTexture(): THREE.Texture {
  const { c, g } = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
