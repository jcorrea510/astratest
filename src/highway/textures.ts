/** Procedural canvas textures for the highway: asphalt with lane paint, the overhead sign atlas, light pools and headlight beams. */
import * as THREE from 'three';
import { INNER, LANE_W, NL, OUTER, SHOULDER } from './road';

export const DASH_CYCLE = 12.192; // 40 ft: 10 ft stripe + 30 ft gap
function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
function tex(c: HTMLCanvasElement, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; return t;
}

/** Cross-section texture: u across the whole paved width (both carriageways), v along the road repeating every DASH_CYCLE metres. */
export function roadTexture(aniso: number): THREE.CanvasTexture {
  const W = 2048, H = 256, [c, g] = canvas(W, H);
  const px = (u: number) => ((u + SHOULDER) / (2 * SHOULDER)) * W; // metres -> pixel
  g.fillStyle = '#34363a'; g.fillRect(0, 0, W, H);
  // paved median + shoulders a touch lighter than the lanes
  g.fillStyle = '#3d3f42'; g.fillRect(px(-INNER), 0, px(INNER) - px(-INNER), H);
  g.fillRect(0, 0, px(-OUTER), H); g.fillRect(px(OUTER), 0, W - px(OUTER), H);
  // grain
  let seed = 7; const r = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 26000; i++) { const v = 40 + r() * 44; g.fillStyle = `rgba(${v},${v},${v + 3},${0.18 + r() * 0.25})`; g.fillRect(r() * W, r() * H, 1 + r() * 2, 1 + r() * 2); }
  // tyre wear: darker polished bands in each lane, oil spots
  for (const sg of [-1, 1]) for (let k = 0; k < NL; k++) {
    const cu = sg * (INNER + (k + 0.5) * LANE_W);
    for (const off of [-0.85, 0.85]) { g.fillStyle = 'rgba(8,8,10,0.16)'; g.fillRect(px(cu + off) - 0.35 * 26, 0, 0.7 * 52, H); }
    g.fillStyle = 'rgba(8,8,10,0.2)'; g.fillRect(px(cu) - 6, 0, 12, H);
  }
  // paint
  const line = (u: number, wM: number, color: string, dash = false) => {
    g.fillStyle = color;
    if (!dash) g.fillRect(px(u) - (wM * 52) / 2, 0, wM * 52, H);
    else g.fillRect(px(u) - (wM * 52) / 2, 0, wM * 52, H * (3.05 / DASH_CYCLE));
  };
  for (const sg of [-1, 1]) {
    line(sg * INNER, 0.16, '#d8a928'); // yellow edge next to the median
    line(sg * OUTER, 0.16, '#d9d9d4'); // white edge line
    for (let k = 1; k < NL; k++) line(sg * (INNER + k * LANE_W), 0.14, '#d9d9d4', true);
  }
  // worn paint: knock out random flecks
  for (let i = 0; i < 700; i++) { g.fillStyle = 'rgba(52,54,58,0.7)'; g.fillRect(r() * W, r() * H, 3 + r() * 5, 2 + r() * 6); }
  const t = tex(c); t.wrapT = THREE.RepeatWrapping; t.wrapS = THREE.ClampToEdgeWrapping; t.anisotropy = aniso;
  return t;
}

export const SIGN_CELLS = 8; // atlas 2 columns x 4 rows
/** Sign atlas: cells 0-3 are overhead green panels, 4-7 roadside signs. All names are invented. */
export function signAtlas(aniso: number): THREE.CanvasTexture {
  const [c, g] = canvas(1024, 1024);
  const cell = (i: number) => ({ x: (i % 2) * 512, y: Math.floor(i / 2) * 256 });
  const panel = (i: number, bg: string, fg: string, draw: (x: number, y: number) => void) => {
    const { x, y } = cell(i);
    g.fillStyle = bg; g.fillRect(x, y, 512, 256);
    g.strokeStyle = fg; g.lineWidth = 7; g.strokeRect(x + 9, y + 9, 494, 238);
    g.fillStyle = fg; g.strokeStyle = fg; g.textBaseline = 'middle'; draw(x, y);
  };
  const GREEN = '#0b6b3a', WHITE = '#f1f1ea', BLUE = '#12508f';
  panel(0, GREEN, WHITE, (x, y) => {
    g.font = '800 54px "Barlow Condensed", Arial Narrow, sans-serif'; g.textAlign = 'left';
    g.fillStyle = '#ffd21f'; g.fillRect(x + 28, y + 26, 150, 52); g.fillStyle = '#111'; g.fillText('EXIT 12', x + 36, y + 53);
    g.fillStyle = WHITE; g.font = '700 62px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Harbor Bridge', x + 28, y + 128);
    g.font = '600 40px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Port Meridian', x + 28, y + 186);
    g.textAlign = 'right'; g.font = '700 46px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('1 MILE', x + 484, y + 53);
    g.beginPath(); g.moveTo(x + 400, y + 178); g.lineTo(x + 470, y + 148); g.lineTo(x + 470, y + 208); g.closePath(); g.fill();
  });
  panel(1, GREEN, WHITE, (x, y) => {
    g.textAlign = 'left'; g.font = '800 70px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Downtown', x + 30, y + 64);
    g.font = '700 54px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Midtown  Docks', x + 30, y + 132);
    g.font = '600 40px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Left 2 lanes', x + 30, y + 196);
    g.textAlign = 'right'; g.font = '800 64px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('24', x + 484, y + 196);
  });
  panel(2, GREEN, WHITE, (x, y) => {
    g.textAlign = 'center'; g.font = '800 62px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Lantern Airport', x + 256, y + 70);
    g.font = '700 50px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Cargo  Terminals', x + 256, y + 138);
    g.font = '800 58px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('18 mi', x + 256, y + 200);
  });
  panel(3, GREEN, WHITE, (x, y) => {
    g.textAlign = 'left'; g.font = '800 56px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Junction 31', x + 30, y + 60);
    g.font = '700 50px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Cedar Hollow', x + 30, y + 128); g.fillText('Ridgeline', x + 30, y + 190);
    g.textAlign = 'right'; g.font = '700 44px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('3 mi', x + 484, y + 190);
  });
  panel(4, WHITE, '#111', (x, y) => {
    g.textAlign = 'center'; g.font = '700 54px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('SPEED', x + 256, y + 60); g.fillText('LIMIT', x + 256, y + 112);
    g.font = '800 120px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('65', x + 256, y + 192);
  });
  panel(5, WHITE, '#111', (x, y) => {
    g.textAlign = 'center'; g.font = '800 54px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('SLOWER TRAFFIC', x + 256, y + 70);
    g.fillText('KEEP RIGHT', x + 256, y + 132); g.font = '600 40px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Pass on the left', x + 256, y + 200);
  });
  panel(6, BLUE, WHITE, (x, y) => {
    g.textAlign = 'center'; g.font = '800 64px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('REST AREA', x + 256, y + 78);
    g.font = '700 54px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Fuel  Food  Restrooms', x + 256, y + 146); g.fillText('2 MILES', x + 256, y + 204);
  });
  panel(7, '#f2b81f', '#111', (x, y) => {
    g.textAlign = 'center'; g.font = '800 62px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('TRUCKS', x + 256, y + 76);
    g.fillText('RIGHT 2 LANES', x + 256, y + 150); g.font = '700 42px "Barlow Condensed", Arial Narrow, sans-serif'; g.fillText('Next 6 miles', x + 256, y + 210);
  });
  const t = tex(c); t.anisotropy = aniso;
  return t;
}
export function cellUV(i: number): [number, number, number, number] { // u0,v0,u1,v1 in atlas space (v up)
  const col = i % 2, row = Math.floor(i / 2);
  return [col * 0.5, 1 - (row + 1) * 0.25, col * 0.5 + 0.5, 1 - row * 0.25];
}

/** Soft radial glow (street-lamp pools on the road, additive). */
export function glowTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128);
  const gr = g.createRadialGradient(64, 64, 2, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  return tex(c);
}
/** Headlight beam footprint on the road: u across, v along (0 = at the car, 1 = far end). */
export function beamTexture(): THREE.CanvasTexture {
  const [c, g] = canvas(64, 128);
  const img = g.createImageData(64, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 64; x++) {
    const v = 1 - y / 127, u = (x / 63) * 2 - 1;
    const width = 0.28 + v * 0.72, a = Math.max(0, 1 - Math.abs(u) / width), fall = Math.pow(1 - v, 1.5) * Math.min(1, v * 14);
    const o = (y * 64 + x) * 4, k = Math.round(255 * Math.pow(a, 1.2) * fall);
    img.data[o] = k; img.data[o + 1] = k; img.data[o + 2] = k; img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.NoColorSpace; return t;
}
