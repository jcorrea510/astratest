/** Canvas textures for the highway cockpit: grain / leather / carpet / dash skin, the instrument cluster face and the live infotainment screen. */
import * as THREE from 'three';
import { clockText, nextExit, tripText } from './infotext';

const D2R = Math.PI / 180;
/** Dial layout shared by the cluster paint and the needles (angles ccw from straight up). */
const DIAL_START = 135 * D2R, DIAL_SWEEP = 270 * D2R;
export const needleAngle = (frac: number): number => DIAL_START - Math.min(1, Math.max(0, frac)) * DIAL_SWEEP;

export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d')!];
}
export function tex(c: HTMLCanvasElement, srgb = true, rep = 0, aniso = 4): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rep, rep); }
  t.anisotropy = aniso; return t;
}
/** Tiny deterministic noise so the grain is stable between runs. */
export function noise(seed: number): () => number { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** Fine pebbled plastic grain (bump) for dash and door skins. */
export function grainBump(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128), r = noise(7);
  g.fillStyle = '#808080'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 2600; i++) { const v = 90 + r() * 90; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(r() * 128, r() * 128, 1 + r() * 1.6, 1 + r() * 1.6); }
  return tex(c, false, 6);
}
/** Perforated, stitched leather colour map. */
export function leatherMap(base: string): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256), r = noise(21);
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 5200; i++) { const a = r() * 0.12; g.fillStyle = r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.6})`; g.fillRect(r() * 256, r() * 256, 2, 2); }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
  for (let i = 0; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  g.strokeStyle = 'rgba(190,175,150,0.22)'; g.setLineDash([5, 4]);
  for (let i = 4; i <= 256; i += 64) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 256); g.stroke(); }
  return tex(c, true, 2);
}
export function carpetMap(): THREE.CanvasTexture {
  const [c, g] = canvas(128, 128), r = noise(3);
  g.fillStyle = '#1d1d20'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 3000; i++) { const v = 20 + r() * 26; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(r() * 128, r() * 128, 1, 2); }
  return tex(c, true, 8);
}

/** Instrument cluster face: two dials, warning-light strip and trip display, lit from within (drawn bright on black). */
export function clusterFace(): THREE.CanvasTexture {
  const W = 720, H = 256, [c, g] = canvas(W, H);
  g.fillStyle = '#05070a'; g.fillRect(0, 0, W, H);
  const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, 'rgba(60,90,120,0.16)'); grad.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = grad; g.fillRect(0, 0, W, H);
  const dial = (cx: number, cy: number, R: number, max: number, step: number, label: string, unit: string, redFrom: number, labelDiv: number) => {
    g.save(); g.translate(cx, cy);
    const ring = g.createRadialGradient(0, 0, R * 0.2, 0, 0, R); ring.addColorStop(0, '#0b1118'); ring.addColorStop(1, '#10161e');
    g.fillStyle = ring; g.beginPath(); g.arc(0, 0, R, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#2a3440'; g.lineWidth = 3; g.beginPath(); g.arc(0, 0, R - 2, 0, Math.PI * 2); g.stroke();
    const pt = (rot: number, rr: number): [number, number] => [-Math.sin(rot) * rr, -Math.cos(rot) * rr];
    for (let v = 0; v <= max; v += step / 2) {
      const major = Math.abs(v / step - Math.round(v / step)) < 1e-6, rot = needleAngle(v / max);
      const [x0, y0] = pt(rot, R - 8), [x1, y1] = pt(rot, R - (major ? 28 : 18));
      g.strokeStyle = v >= redFrom ? '#ff4a3a' : (major ? '#eaf4ff' : '#7f93a8'); g.lineWidth = major ? 3.5 : 2;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
      if (major) {
        const [tx, ty] = pt(rot, R - 46);
        g.fillStyle = v >= redFrom ? '#ff6a5a' : '#dcecff'; g.font = `600 ${Math.round(R * 0.17)}px "Barlow Condensed", "Arial Narrow", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(String(Math.round(v / labelDiv)), tx, ty);
      }
    }
    g.fillStyle = '#7fb4ff'; g.font = `600 ${Math.round(R * 0.13)}px "Barlow Condensed", "Arial Narrow", sans-serif`; g.textAlign = 'center';
    g.fillText(label, 0, R * 0.52); g.fillStyle = '#6b7e92'; g.fillText(unit, 0, R * 0.7);
    g.restore();
  };
  dial(176, 130, 112, 8000, 1000, 'RPM', 'x1000', 6500, 1000);
  dial(544, 130, 112, 160, 20, 'MPH', '', 140, 1);
  // centre: fuel / temp bars, gear, trip
  g.fillStyle = '#9fd0ff'; g.font = '600 20px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center';
  g.fillText('FUEL', 300, 54); g.fillText('TEMP', 420, 54);
  for (const [x, f, col] of [[270, 0.62, '#59d78a'], [390, 0.5, '#59a8ff']] as [number, number, string][]) {
    g.fillStyle = '#18222c'; g.fillRect(x, 66, 60, 8);
    g.fillStyle = col; g.fillRect(x, 66, 60 * f, 8);
  }
  g.fillStyle = '#e8f3ff'; g.font = '700 44px "Barlow Condensed", "Arial Narrow", sans-serif'; g.fillText('D', 360, 150);
  // warning lights strip (dim, ready)
  const lamps: [string, number][] = [['#3cff7a', 296], ['#2f88ff', 328], ['#3cff7a', 392], ['#ffb02e', 424]];
  for (const [col, x] of lamps) { g.fillStyle = col; g.globalAlpha = 0.8; g.beginPath(); g.arc(x, 232, 5, 0, Math.PI * 2); g.fill(); }
  g.globalAlpha = 1;
  return tex(c, true, 0, 8);
}

/** seconds between repaints of the live screens */
export const SCREEN_PERIOD = 0.25;
export const FONT = '"Barlow Condensed", "Arial Narrow", sans-serif';
export interface ScreenState { hour: number; meters: number; mph: number; time: number }
/** Infotainment screen: moving map (roads scroll with the distance driven), next-exit countdown, clock, trip and a media bar. Cheap enough to repaint a few times a second. */
export function drawInfotainment(g: CanvasRenderingContext2D, st: ScreenState): void {
  const W = 640, H = 360, ex = nextExit(st.meters);
  g.fillStyle = '#0b1219'; g.fillRect(0, 0, W, H);
  // map viewport (clipped): blocks and roads scroll toward the bottom as the car drives
  g.save(); g.beginPath(); g.rect(0, 40, 430, 282); g.clip();
  g.fillStyle = '#121d27'; g.fillRect(0, 40, 430, 282);
  const scroll = (st.meters * 0.09) % 120, row0 = Math.floor((st.meters * 0.09) / 120);
  for (let r = -1; r < 4; r++) {
    const y = 40 + r * 120 + scroll, rr = noise(row0 * 7 - r * 7 + 1000);
    for (let i = 0; i < 9; i++) { g.fillStyle = `rgba(${30 + rr() * 20},${46 + rr() * 24},${60 + rr() * 26},1)`; g.fillRect(rr() * 400, y + rr() * 90, 18 + rr() * 50, 12 + rr() * 40); }
    g.strokeStyle = '#26394a'; g.lineWidth = 9; g.beginPath(); g.moveTo(0, y + 112); g.lineTo(430, y + 112); g.stroke();
  }
  g.strokeStyle = '#26394a'; g.lineWidth = 12; g.beginPath(); g.moveTo(190, 40); g.lineTo(190, 322); g.stroke();
  g.strokeStyle = '#2f465a'; g.lineWidth = 2; g.setLineDash([10, 12]); g.lineDashOffset = -(st.meters * 0.09) % 22; g.beginPath(); g.moveTo(190, 40); g.lineTo(190, 322); g.stroke(); g.setLineDash([]);
  // route: straight up the highway, then peeling off at the exit that gets nearer as the trip counter climbs
  const by = 70 + (1 - ex.frac) * 200;
  g.strokeStyle = '#3d9bff'; g.lineWidth = 8; g.lineCap = 'round'; g.lineJoin = 'round'; g.beginPath(); g.moveTo(190, 296); g.lineTo(190, by); g.lineTo(300, by - 50); g.lineTo(330, 48); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.moveTo(190, 262); g.lineTo(177, 292); g.lineTo(203, 292); g.closePath(); g.fill();
  g.restore();
  // header
  g.fillStyle = '#0f1822'; g.fillRect(0, 0, W, 40);
  g.fillStyle = '#cfe6ff'; g.font = `600 24px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'middle';
  g.fillText(clockText(st.hour), 16, 21); g.textAlign = 'right'; g.fillText('72 F   LTE', W - 16, 21);
  // side card: next exit + media
  g.fillStyle = '#101b26'; g.fillRect(430, 40, 210, 320);
  g.textAlign = 'left'; g.fillStyle = '#7fb4ff'; g.font = `600 20px ${FONT}`; g.fillText('NEXT EXIT', 446, 70);
  g.fillStyle = '#ffffff'; g.font = `700 46px ${FONT}`; g.fillText(ex.dist, 446, 110);
  g.fillStyle = '#9fb3c6'; g.font = `600 22px ${FONT}`; g.fillText(`${ex.exit}  ${ex.road}`, 446, 142);
  g.fillStyle = '#9fb3c6'; g.font = `600 18px ${FONT}`; g.fillText(`TRIP ${tripText(st.meters)}   ${Math.round(st.mph)} mph`, 446, 166);
  g.fillStyle = '#1b2a39'; g.fillRect(446, 180, 178, 1);
  g.fillStyle = '#7fb4ff'; g.font = `600 20px ${FONT}`; g.fillText('NOW PLAYING', 446, 204);
  const track = Math.floor(st.time / 210) % 3;
  g.fillStyle = '#ffffff'; g.font = `600 26px ${FONT}`; g.fillText(['Afterglow Drive', 'Long Way Home', 'Neon Overpass'][track], 446, 234);
  g.fillStyle = '#9fb3c6'; g.font = `500 20px ${FONT}`; g.fillText('Night Shift Radio', 446, 260);
  g.fillStyle = '#233446'; g.fillRect(446, 284, 178, 5); g.fillStyle = '#3d9bff'; g.fillRect(446, 284, 178 * ((st.time % 210) / 210), 5);
  // dock
  g.fillStyle = '#0f1822'; g.fillRect(0, 322, 430, 38);
  g.fillStyle = '#9fb3c6'; g.font = `600 18px ${FONT}`; g.textAlign = 'center';
  ['NAV', 'MEDIA', 'PHONE', 'CLIMATE', 'CAR'].forEach((t, i) => g.fillText(t, 43 + i * 86, 342));
}


/** Soft-touch dash skin: near-black with faint low-frequency mottling and a fine pebble grain (colour map, u wraps across the car). */
export function dashSkin(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256), r = noise(11);
  g.fillStyle = '#26272a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 40; i++) {
    const x = r() * 256, y = r() * 256, rad = 20 + r() * 50, a = 0.025 + r() * 0.03, gr = g.createRadialGradient(x, y, 0, x, y, rad);
    gr.addColorStop(0, r() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a * 0.6})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  for (let i = 0; i < 9000; i++) { const v = r(); g.fillStyle = v < 0.5 ? `rgba(0,0,0,${0.05 + v * 0.1})` : `rgba(255,255,255,${(v - 0.5) * 0.06})`; g.fillRect(r() * 256, r() * 256, 1 + r(), 1 + r()); }
  return tex(c, true, 1, 8);
}
/** Pebbled leather-grain bump for the dash / door skins (finer cells than grainBump). */
export function pebbleBump(): THREE.CanvasTexture {
  const [c, g] = canvas(256, 256), r = noise(29);
  g.fillStyle = '#7a7a7a'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {
    const x = r() * 256, y = r() * 256, rad = 1.5 + r() * 2.6, gr = g.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
    gr.addColorStop(0, '#b4b4b4'); gr.addColorStop(1, 'rgba(122,122,122,0)'); g.fillStyle = gr; g.beginPath(); g.arc(x, y, rad, 0, Math.PI * 2); g.fill();
  }
  return tex(c, false, 1, 8);
}
