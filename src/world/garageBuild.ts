/**
 * AAA Drive-In Custom Garages: architectural concrete & ribbed steel exterior, cantilevered service canopy with LED downlights,
 * framed 3D illuminated fascia & blade sign, glazed office window, rooftop HVAC, polished slate-epoxy workshop floor with recessed
 * drainage & chevron apron, two-tone paneled interior walls with steel trusses & suspended linear light rigs, 2-post hydraulic
 * lift with swing arms, rolling diagnostic tool chests, workbench with vise & monitor, alloy/tire racks, compressor, and animated
 * glass-vision roll-up door. Static parts merge into the trim chunks; colliders keep vehicles cleanly bounded.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Physics } from '../core/physics';
import { type Chunked, type TrimBuilder, T_STONE, T_METAL, T_IRON, T_PAINT, T_GLOW } from './builders';
import { BAYS, type BaySpec } from '../game/bays';

const C = (h: string) => new THREE.Color(h);
const T_EPOXY: [number, number, number, number] = [0.22, 0.12, 0, 0];
const T_GLASS_DARK: [number, number, number, number] = [0.1, 0.45, 0, 0];

/** The animated roll-up door of each bay (index = BAYS index). Filled by buildGarages. */
export const BAY_DOORS: THREE.Mesh[] = [];

function doorTexture(w: number, h: number, accent: string): THREE.CanvasTexture {
  const PX = 112, c = document.createElement('canvas');
  c.width = Math.round(w * PX / 2); c.height = Math.round(h * PX / 2);
  const g = c.getContext('2d')!, S = PX / 2;
  // Brushed dark aluminum sectional door
  const baseGrad = g.createLinearGradient(0, 0, 0, c.height);
  baseGrad.addColorStop(0, '#3a4048');
  baseGrad.addColorStop(0.5, '#30353d');
  baseGrad.addColorStop(1, '#262a30');
  g.fillStyle = baseGrad;
  g.fillRect(0, 0, c.width, c.height);

  // Horizontal insulated steel slats with bevel highlight + recess shadow
  for (let y = 0; y < h; y += 0.28) {
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(0, y * S, c.width, 1.5);
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, (y + 0.23) * S, c.width, 3);
    g.fillStyle = 'rgba(255,255,255,0.04)'; g.fillRect(0, (y + 0.06) * S, c.width, 4);
  }
  // Subtle brushed metal micro-grain
  for (let i = 0; i < 650; i++) {
    g.fillStyle = `rgba(255,255,255,${0.015 + (i % 3) * 0.008})`;
    g.fillRect((i * 89) % c.width, (i * 47) % c.height, 8 + (i % 18), 1);
  }
  // Full-width architectural frosted glass vision band (2 rows of dark framed panes)
  const panes = 5, pad = 0.34, gap = 0.14, paneW = (w - pad * 2 - gap * (panes - 1)) / panes;
  for (let k = 0; k < panes; k++) {
    const px = (pad + k * (paneW + gap)) * S, py = 1.18 * S, pw = paneW * S, ph = 0.62 * S;
    g.fillStyle = '#11151a'; g.fillRect(px - 3, py - 3, pw + 6, ph + 6);
    const gl = g.createLinearGradient(px, py, px, py + ph);
    gl.addColorStop(0, '#2a3e4f'); gl.addColorStop(0.45, '#192632'); gl.addColorStop(1, '#101820');
    g.fillStyle = gl; g.fillRect(px, py, pw, ph);
    g.fillStyle = 'rgba(180,220,255,0.16)';
    g.beginPath(); g.moveTo(px + 2, py + 2); g.lineTo(px + pw * 0.65, py + 2); g.lineTo(px + pw * 0.35, py + ph - 2); g.lineTo(px + 2, py + ph - 2); g.closePath(); g.fill();
  }
  // Crisp brand accent stripe above bottom bumper
  g.fillStyle = accent; g.globalAlpha = 0.85; g.fillRect(0, c.height - 0.42 * S, c.width, 0.08 * S); g.globalAlpha = 1;
  // Industrial black/amber safety bumper on bottom rail
  g.save(); g.beginPath(); g.rect(0, c.height - 0.32 * S, c.width, 0.32 * S); g.clip();
  g.fillStyle = '#181a1d'; g.fillRect(0, c.height - 0.32 * S, c.width, 0.32 * S);
  g.fillStyle = '#e5a928';
  for (let x = -1; x < w * 2; x += 0.55) {
    g.beginPath(); g.moveTo(x * S, c.height); g.lineTo((x + 0.24) * S, c.height);
    g.lineTo((x + 0.5) * S, c.height - 0.32 * S); g.lineTo((x + 0.26) * S, c.height - 0.32 * S); g.fill();
  }
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function signTexture(b: BaySpec): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 192;
  const g = c.getContext('2d')!;
  // Architectural brushed dark-metal backing plate with subtle radial spotlight falloff
  const bg = g.createLinearGradient(0, 0, 0, c.height);
  bg.addColorStop(0, b.signBg); bg.addColorStop(1, '#090b0f');
  g.fillStyle = bg; g.fillRect(0, 0, c.width, c.height);
  // Subtle geometric chevron pattern on left & right wings
  g.fillStyle = 'rgba(255,255,255,0.035)';
  for (let i = 0; i < 4; i++) {
    g.beginPath(); g.moveTo(26 + i * 24, 0); g.lineTo(42 + i * 24, 0); g.lineTo(18 + i * 24, c.height); g.lineTo(2 + i * 24, c.height); g.fill();
    g.beginPath(); g.moveTo(c.width - 26 - i * 24, 0); g.lineTo(c.width - 42 - i * 24, 0); g.lineTo(c.width - 18 - i * 24, c.height); g.lineTo(c.width - 2 - i * 24, c.height); g.fill();
  }
  // Hairline metallic border + crisp accent bars
  g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 3; g.strokeRect(6, 6, c.width - 12, c.height - 12);
  g.fillStyle = b.accent; g.fillRect(0, 0, c.width, 7); g.fillRect(0, c.height - 7, c.width, 7);
  // Main illuminated title
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 84px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.shadowColor = b.accent; g.shadowBlur = 18; g.fillStyle = b.signFg;
  g.fillText(b.sign, c.width / 2, 74);
  g.shadowBlur = 0;
  // Crisp sub-bar
  g.font = '700 28px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.fillStyle = 'rgba(240,244,250,0.84)';
  g.fillText(b.sub, c.width / 2, 144);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function bladeTexture(b: BaySpec): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = b.signBg; g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = b.accent; g.lineWidth = 6; g.strokeRect(4, 4, c.width - 8, c.height - 8);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 42px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.shadowColor = b.accent; g.shadowBlur = 10; g.fillStyle = b.signFg;
  g.fillText('CUSTOMS', c.width / 2, 46);
  g.shadowBlur = 0;
  g.font = '700 24px "Barlow Condensed", "Arial Narrow", Arial, sans-serif';
  g.fillStyle = '#e8edf4';
  g.fillText('24H SERVICE', c.width / 2, 92);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function glowMat(map: THREE.Texture, night: { value: number }, day: number, nightK: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color(1, 1, 1), roughness: 0.38, metalness: 0.15 });
  m.onBeforeCompile = sh => {
    sh.uniforms.uNight = night;
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uNight;')
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= ${day.toFixed(2)} + uNight * ${nightK.toFixed(2)};`);
  };
  return m;
}

export function buildGarages(o: { root: THREE.Object3D; physics: Physics; trim: Chunked<TrimBuilder>; curb: number; nightUniform: { value: number } }) {
  BAY_DOORS.length = 0;
  for (const b of BAYS) buildBay(o, b);
}

function buildBay(o: { root: THREE.Object3D; physics: Physics; trim: Chunked<TrimBuilder>; curb: number; nightUniform: { value: number } }, b: BaySpec) {
  const { root, physics, curb: y0 } = o;
  const cz = b.zf + b.d / 2, tb = o.trim.at(b.cx, cz);
  const wall = C(b.wall), dark = C('#1c1f24'), charcoal = C('#272b32'), accent = C(b.accent), steel = C('#495059'), chrome = C('#b8c0c8'), concrete = C('#6a6e73');
  const T = 0.42, H = b.h, pierW = (b.w - b.openW) / 2;
  const solid = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col: THREE.Color, tex = T_STONE) => {
    tb.box(x, y0 + y, z, sx, sy, sz, 0, col, tex);
    physics.addStaticBox(x, y0 + y, z, sx / 2, sy / 2, sz / 2);
  };

  // ---------- 1. Showroom Epoxy Floor, Recessed Drain & Exterior Apron ----------
  // Polished slate-epoxy workshop floor (true reflective sheen, NOT washed-out T_GLOW!)
  tb.box(b.cx, y0 + 0.018, cz, b.w - 2 * T, 0.036, b.d - T, 0, C('#2c3037'), T_EPOXY);
  // Subtle lighter center work pad under the vehicle
  tb.box(b.cx, y0 + 0.038, b.zf + 6.6, 4.1, 0.008, 7.2, 0, C('#363b44'), T_EPOXY);
  // Clean concrete driveway apron extending north toward the street
  tb.box(b.cx, y0 + 0.012, b.zf - 3.6, b.w + 1.8, 0.024, 7.2, 0, C('#5c6066'), T_STONE);
  // Subtle dark expansion joints on apron
  for (const sx of [-2.8, 0, 2.8]) tb.box(b.cx + sx, y0 + 0.026, b.zf - 3.6, 0.05, 0.005, 7.0, 0, C('#36393e'), T_STONE);
  // Crisp bay framing safety markings (amber + white)
  const lineY = y0 + 0.044;
  for (const sx of [-1, 1]) tb.box(b.cx + sx * 2.05, lineY, b.zf + 6.6, 0.09, 0.008, 7.2, 0, C('#e5a928'), T_PAINT);
  for (const sz of [-1, 1]) tb.box(b.cx, lineY, b.zf + 6.6 + sz * 3.6, 4.18, 0.008, 0.09, 0, C('#e5a928'), T_PAINT);
  // Corner L-markers on the epoxy pad
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    tb.box(b.cx + sx * 1.75, lineY + 0.002, b.zf + 6.6 + sz * 3.1, 0.45, 0.006, 0.06, 0, C('#e8edf2'), T_PAINT);
  }
  // Entry threshold hazard strip
  tb.box(b.cx, lineY, b.zf + 0.95, b.openW - 0.3, 0.008, 0.32, 0, C('#16181c'), T_PAINT);
  for (let k = 0; k < 12; k++) tb.box(b.cx - b.openW / 2 + 0.45 + k * 0.42, lineY + 0.003, b.zf + 0.95, 0.19, 0.008, 0.32, 0, C('#e5a928'), T_PAINT);
  // Approach guide chevrons on the exterior apron
  for (let k = 0; k < 2; k++) {
    const az = b.zf - 2.2 - k * 2.1;
    tb.box(b.cx - 0.65, y0 + 0.028, az, 1.4, 0.008, 0.16, 0.35, accent, T_PAINT);
    tb.box(b.cx + 0.65, y0 + 0.028, az, 1.4, 0.008, 0.16, -0.35, accent, T_PAINT);
  }
  // Recessed stainless center floor drainage grate
  tb.box(b.cx, lineY, b.zf + 6.6, 0.72, 0.012, 1.4, 0, C('#1a1d21'), T_IRON);
  for (let i = -3; i <= 3; i++) tb.box(b.cx, lineY + 0.008, b.zf + 6.6 + i * 0.19, 0.64, 0.006, 0.04, 0, steel, T_METAL);

  // ---------- 2. Architectural Outer Shell, Ribs, Parapet & Rooftop HVAC ----------
  solid(b.cx, H / 2, b.zf + b.d - T / 2, b.w, H, T, wall, T_STONE);
  for (const sx of [-1, 1]) solid(b.cx + sx * (b.w / 2 - T / 2), H / 2, cz, T, H, b.d, wall, T_STONE);
  for (const sx of [-1, 1]) solid(b.cx + sx * (b.openW / 2 + pierW / 2), H / 2, b.zf + 0.32, pierW, H, 0.64, wall, T_STONE);
  solid(b.cx, b.openH + (H - b.openH) / 2, b.zf + 0.32, b.openW, H - b.openH, 0.64, wall, T_STONE);

  // Architectural exterior ribbed metal cladding columns + concrete plinth
  for (const sx of [-1, 1]) {
    const px = b.cx + sx * (b.w / 2 + 0.03);
    tb.box(px, y0 + 0.55, cz, 0.08, 1.1, b.d + 0.1, 0, concrete, T_STONE);
    for (let z = b.zf + 1.2; z < b.zf + b.d - 0.6; z += 2.2) {
      tb.box(px, y0 + H * 0.54, z, 0.1, H * 0.88, 0.22, 0, dark, T_METAL);
    }
    // Glowing vertical edge trim along front facade corners
    tb.box(b.cx + sx * (b.w / 2 - 0.08), y0 + H * 0.52, b.zf - 0.04, 0.07, H - 0.8, 0.06, 0, accent, T_GLOW(1.8));
  }
  // Front concrete plinth + brushed steel jamb trim around the bay door
  for (const sx of [-1, 1]) {
    tb.box(b.cx + sx * (b.openW / 2 + pierW / 2), y0 + 0.5, b.zf - 0.03, pierW + 0.04, 1.0, 0.08, 0, concrete, T_STONE);
    tb.box(b.cx + sx * (b.openW / 2 + 0.08), y0 + b.openH / 2, b.zf - 0.02, 0.16, b.openH + 0.12, 0.14, 0, dark, T_METAL);
  }
  tb.box(b.cx, y0 + b.openH + 0.08, b.zf - 0.02, b.openW + 0.32, 0.16, 0.14, 0, dark, T_METAL);

  // Glazed reception office window on the right front pier (with warm lit interior backing & mullions)
  const winX = b.cx + b.openW / 2 + pierW / 2;
  tb.box(winX, y0 + 2.05, b.zf - 0.02, pierW * 0.68, 1.55, 0.06, 0, dark, T_IRON);
  tb.box(winX, y0 + 2.05, b.zf - 0.035, pierW * 0.60, 1.4, 0.04, 0, C('#203344'), T_GLASS_DARK);
  tb.box(winX, y0 + 1.58, b.zf - 0.04, pierW * 0.56, 0.22, 0.02, 0, C('#ffd99e'), T_GLOW(0.65)); // warm interior desk glow
  tb.box(winX, y0 + 2.05, b.zf - 0.055, 0.06, 1.48, 0.05, 0, dark, T_IRON); // center mullion
  // Left pier service board / menu plaque
  const menuX = b.cx - (b.openW / 2 + pierW / 2);
  tb.box(menuX, y0 + 2.0, b.zf - 0.04, pierW * 0.58, 1.35, 0.06, 0, dark, T_METAL);
  tb.box(menuX, y0 + 2.0, b.zf - 0.075, pierW * 0.5, 1.22, 0.02, 0, C('#1b222c'), T_GLOW(0.35));
  tb.box(menuX, y0 + 2.52, b.zf - 0.085, pierW * 0.46, 0.08, 0.02, 0, accent, T_GLOW(1.5));

  // Roof slab, dark architectural parapet coping, and rooftop HVAC + exhaust stacks
  solid(b.cx, H + 0.18, cz, b.w + 0.4, 0.36, b.d + 0.4, C('#3a3e44'), T_STONE);
  tb.box(b.cx, y0 + H + 0.58, b.zf - 0.05, b.w + 0.5, 0.48, 0.26, 0, dark, T_METAL);
  tb.box(b.cx, y0 + H + 0.52, b.zf + b.d + 0.05, b.w + 0.5, 0.36, 0.22, 0, dark, T_METAL);
  for (const sx of [-1, 1]) tb.box(b.cx + sx * (b.w / 2 + 0.1), y0 + H + 0.52, cz, 0.22, 0.36, b.d + 0.4, 0, dark, T_METAL);
  // Rooftop HVAC unit + galvanized ducts
  tb.box(b.cx + 2.2, y0 + H + 0.85, cz + 1.8, 2.3, 1.0, 1.7, 0, C('#7e848b'), T_METAL);
  tb.box(b.cx + 2.2, y0 + H + 1.38, cz + 1.8, 1.6, 0.08, 1.2, 0, dark, T_IRON);
  tb.box(b.cx + 0.5, y0 + H + 0.62, cz + 1.8, 1.4, 0.42, 0.55, 0, C('#9ba1a8'), T_METAL);
  tb.cyl(b.cx - 2.6, y0 + H + 0.36, cz + 3.2, 0.28, 0.28, 1.2, 12, C('#8c9298'), T_METAL);
  tb.cyl(b.cx - 2.6, y0 + H + 1.56, cz + 3.2, 0.42, 0.18, 0.24, 12, dark, T_METAL);

  // Cantilevered steel entrance canopy with neon accent strip + recessed LED downlights
  const canY = y0 + b.openH + 0.28;
  tb.box(b.cx, canY, b.zf - 1.1, b.w + 0.2, 0.24, 2.2, 0, dark, T_METAL);
  tb.box(b.cx, canY - 0.02, b.zf - 2.22, b.w + 0.24, 0.08, 0.06, 0, accent, T_GLOW(2.4));
  // Steel tie-rods anchoring canopy to parapet
  for (const sx of [-3.4, 3.4]) tb.beam(b.cx + sx, canY + 0.1, b.zf - 1.8, b.cx + sx, y0 + H + 0.2, b.zf - 0.05, 0.05, 0.05, steel, T_METAL);
  // Recessed canopy soffit LED downlights
  for (const sx of [-3.2, -1.1, 1.1, 3.2]) {
    tb.box(b.cx + sx, canY - 0.13, b.zf - 1.05, 0.52, 0.03, 0.28, 0, C('#fff6e5'), T_GLOW(3.6));
  }

  // ---------- 3. Interior Architectural Finishes, Trusses & Linear LED Rigs ----------
  const upperWall = C('#484e57'), lowerDado = C('#23272e'), ceilC = C('#1e2228');
  for (const sx of [-1, 1]) {
    const x = b.cx + sx * (b.w / 2 - T - 0.02);
    tb.box(x, y0 + 0.72, cz, 0.05, 1.44, b.d - 2 * T, 0, lowerDado, T_STONE);
    tb.box(x, y0 + 1.48, cz, 0.07, 0.11, b.d - 2 * T, 0, accent, T_GLOW(1.5));
    tb.box(x, y0 + 1.56, cz, 0.06, 0.04, b.d - 2 * T, 0, chrome, T_METAL);
    tb.box(x, y0 + 3.35, cz, 0.05, H - 1.6, b.d - 2 * T, 0, upperWall, T_STONE);
    // Vertical architectural steel pilasters along interior walls
    for (let z = b.zf + 2.4; z < b.zf + b.d - 1.0; z += 3.2) {
      tb.box(x - sx * 0.06, y0 + H / 2, z, 0.14, H - 0.1, 0.18, 0, charcoal, T_METAL);
    }
  }
  const backInnerZ = b.zf + b.d - T - 0.02;
  tb.box(b.cx, y0 + 0.72, backInnerZ, b.w - 2 * T, 1.44, 0.05, 0, lowerDado, T_STONE);
  tb.box(b.cx, y0 + 1.48, backInnerZ - 0.01, b.w - 2 * T, 0.11, 0.07, 0, accent, T_GLOW(1.5));
  tb.box(b.cx, y0 + 1.56, backInnerZ - 0.01, b.w - 2 * T, 0.04, 0.06, 0, chrome, T_METAL);
  tb.box(b.cx, y0 + 3.35, backInnerZ, b.w - 2 * T, H - 1.6, 0.05, 0, upperWall, T_STONE);
  // Subtle illuminated back-wall brand feature panel
  tb.box(b.cx, y0 + 3.55, backInnerZ - 0.05, 4.6, 0.9, 0.06, 0, dark, T_METAL);
  tb.box(b.cx, y0 + 3.12, backInnerZ - 0.08, 4.4, 0.05, 0.04, 0, accent, T_GLOW(2.0));
  tb.box(b.cx, y0 + 3.98, backInnerZ - 0.08, 4.4, 0.05, 0.04, 0, accent, T_GLOW(2.0));

  // Ceiling deck, exposed dark steel I-beam trusses, and suspended industrial LED light bars
  tb.box(b.cx, y0 + H - 0.03, cz, b.w - 2 * T, 0.06, b.d - T, 0, ceilC, T_METAL);
  for (let z = b.zf + 2.2; z < b.zf + b.d - 0.8; z += 2.8) {
    tb.box(b.cx, y0 + H - 0.24, z, b.w - 2 * T, 0.28, 0.16, 0, charcoal, T_IRON);
    tb.box(b.cx, y0 + H - 0.39, z, b.w - 2 * T, 0.04, 0.26, 0, steel, T_METAL);
  }
  // 2 rows of 3 industrial LED studio fixtures + center accent bar
  for (const z of [b.zf + 3.2, b.zf + 6.6, b.zf + 10.0]) {
    for (const sx of [-1, 1]) {
      const lx = b.cx + sx * 2.15;
      tb.box(lx, y0 + H - 0.54, z, 0.32, 0.07, 2.5, 0, dark, T_METAL);
      tb.box(lx, y0 + H - 0.585, z, 0.24, 0.03, 2.4, 0, C('#f8fbff'), T_GLOW(4.0));
      for (const dz of [-1.0, 1.0]) tb.box(lx, y0 + H - 0.42, z + dz, 0.025, 0.2, 0.025, 0, steel, T_METAL);
    }
  }
  // Overhead hexagonal/linear detail light right above the car showcase spot
  tb.box(b.cx, y0 + H - 0.56, b.zf + 6.6, 1.5, 0.06, 4.4, 0, dark, T_METAL);
  tb.box(b.cx, y0 + H - 0.60, b.zf + 6.6, 1.32, 0.03, 4.2, 0, C('#ffffff'), T_GLOW(4.5));

  // Door tracks & motor coil housing
  for (const sx of [-1, 1]) tb.box(b.cx + sx * (b.openW / 2 - 0.05), y0 + b.openH / 2, b.zf + 0.58, 0.1, b.openH, 0.14, 0, steel, T_METAL);
  tb.box(b.cx, y0 + b.openH + 0.24, b.zf + 0.66, b.openW + 0.2, 0.44, 0.52, 0, charcoal, T_METAL);

  // ---------- 4. Realistic 2-Post Hydraulic Car Lift (framing the car without colliding!) ----------
  const liftZ = b.zf + 6.6, liftX = 3.18;
  const liftCol = C('#c83428');
  for (const sx of [-1, 1]) {
    const px = b.cx + sx * liftX;
    // Heavy bolted steel baseplate + upright H-column + carriage
    tb.box(px, y0 + 0.04, liftZ, 0.58, 0.08, 0.68, 0, dark, T_IRON);
    tb.box(px, y0 + 1.85, liftZ, 0.28, 3.65, 0.34, 0, liftCol, T_PAINT);
    tb.box(px - sx * 0.14, y0 + 1.85, liftZ, 0.06, 3.55, 0.22, 0, dark, T_IRON); // inner track channel
    // Lifting carriage + stowed rubber lift pads
    tb.box(px - sx * 0.18, y0 + 0.52, liftZ, 0.16, 0.65, 0.46, 0, dark, T_METAL);
    tb.box(px - sx * 0.42, y0 + 0.22, liftZ - 0.38, 0.52, 0.09, 0.1, sx * 0.45, charcoal, T_METAL);
    tb.box(px - sx * 0.42, y0 + 0.22, liftZ + 0.38, 0.52, 0.09, 0.1, -sx * 0.45, charcoal, T_METAL);
    physics.addStaticBox(px, y0 + 1.8, liftZ, 0.2, 1.8, 0.22);
  }
  // Hydraulic power unit motor mounted on right lift column + overhead equalizer beam
  tb.box(b.cx + liftX + 0.24, y0 + 1.55, liftZ, 0.26, 0.55, 0.28, 0, dark, T_METAL);
  tb.cyl(b.cx + liftX + 0.24, y0 + 1.82, liftZ, 0.11, 0.11, 0.38, 10, chrome, T_METAL);
  tb.box(b.cx, y0 + 3.68, liftZ, liftX * 2 + 0.28, 0.18, 0.24, 0, liftCol, T_PAINT);

  // ---------- 5. Back Wall Workshop Bay: Workbench, Diagnostic Cart, Tool Chest, Compressor ----------
  const bz = b.zf + b.d - T - 0.12;
  // Steel workbench with butcher-block top, pegboard tool wall, bench vise & diagnostic monitor
  tb.box(b.cx - 1.55, y0 + 2.02, bz + 0.04, 3.2, 1.15, 0.05, 0, C('#20242a'), T_METAL); // dark perforated pegboard
  for (let i = 0; i < 11; i++) {
    const tx = b.cx - 2.9 + i * 0.27;
    tb.box(tx, y0 + 2.12 + ((i * 5) % 3) * 0.09, bz - 0.01, 0.045, 0.34 + (i % 3) * 0.11, 0.025, 0, i % 3 === 0 ? C('#d94638') : chrome, T_METAL);
  }
  tb.box(b.cx - 1.55, y0 + 0.92, bz - 0.34, 3.2, 0.08, 0.76, 0, C('#9e7a4e'), T_STONE); // solid oak worktop
  for (const sx of [-1.5, 0, 1.5]) tb.box(b.cx - 1.55 + sx, y0 + 0.44, bz - 0.34, 0.09, 0.88, 0.68, 0, dark, T_IRON);
  tb.box(b.cx - 1.55, y0 + 0.2, bz - 0.34, 3.0, 0.06, 0.6, 0, charcoal, T_METAL);
  // Bench vise + diagnostic computer screen glowing softly
  tb.box(b.cx - 2.75, y0 + 1.05, bz - 0.58, 0.22, 0.18, 0.26, 0, C('#285796'), T_IRON);
  tb.box(b.cx - 0.55, y0 + 1.24, bz - 0.25, 0.68, 0.42, 0.05, -0.18, dark, T_METAL);
  tb.box(b.cx - 0.55, y0 + 1.24, bz - 0.28, 0.6, 0.34, 0.02, -0.18, C('#2d89b8'), T_GLOW(1.2));
  physics.addStaticBox(b.cx - 1.55, y0 + 0.5, bz - 0.34, 1.6, 0.5, 0.38);

  // Pro rolling red & obsidian mechanic tool chest with brushed aluminum drawer pulls
  const cxTool = b.cx + 1.75;
  tb.box(cxTool, y0 + 0.62, bz - 0.38, 1.35, 1.12, 0.68, 0, C('#b82822'), T_PAINT);
  for (let i = 0; i < 5; i++) {
    tb.box(cxTool, y0 + 0.2 + i * 0.21, bz - 0.73, 1.22, 0.16, 0.03, 0, C('#911d18'), T_PAINT);
    tb.box(cxTool, y0 + 0.24 + i * 0.21, bz - 0.75, 1.14, 0.03, 0.03, 0, chrome, T_METAL);
  }
  tb.box(cxTool, y0 + 1.2, bz - 0.38, 1.39, 0.06, 0.72, 0, dark, T_IRON);
  // Top chest hutch
  tb.box(cxTool, y0 + 1.55, bz - 0.34, 1.28, 0.64, 0.56, 0, C('#b82822'), T_PAINT);
  for (let i = 0; i < 3; i++) tb.box(cxTool, y0 + 1.36 + i * 0.18, bz - 0.63, 1.15, 0.03, 0.03, 0, chrome, T_METAL);
  physics.addStaticBox(cxTool, y0 + 0.9, bz - 0.38, 0.7, 0.9, 0.36);

  // Vertical industrial air compressor tank + pressure manifold in back-right corner
  const compX = b.cx + 3.65, compZ = bz - 0.45;
  tb.cyl(compX, y0 + 0.08, compZ, 0.32, 0.32, 1.48, 16, C('#1f518f'), T_PAINT);
  tb.box(compX, y0 + 1.66, compZ, 0.48, 0.24, 0.38, 0, dark, T_IRON);
  tb.cyl(compX - 0.12, y0 + 1.78, compZ, 0.12, 0.12, 0.2, 10, chrome, T_METAL);
  physics.addStaticCylinder(compX, y0 + 0.9, compZ, 0.9, 0.36);

  // ---------- 6. Side Wall Equipment: Alloy/Tire Racks, Shelving, Oil Drums ----------
  const wx = b.cx - (b.w / 2 - T - 0.52);
  // West wall steel tire rack holding performance tires + silver rims
  tb.box(wx, y0 + 1.25, b.zf + 3.5, 0.56, 2.5, 0.1, 0, dark, T_IRON);
  tb.box(wx, y0 + 1.25, b.zf + 5.7, 0.56, 2.5, 0.1, 0, dark, T_IRON);
  for (const ry of [0.95, 1.85]) {
    tb.box(wx, y0 + ry, b.zf + 4.6, 0.5, 0.06, 2.2, 0, C('#d49a2a'), T_METAL);
    for (let k = 0; k < 5; k++) {
      tb.cyl(wx + 0.04, y0 + ry + 0.04, b.zf + 3.78 + k * 0.41, 0.31, 0.31, 0.24, 14, C('#1b1d20'), T_STONE);
    }
  }
  physics.addStaticBox(wx, y0 + 1.25, b.zf + 4.6, 0.35, 1.25, 1.15);

  // West rear oil drums + safety cones
  for (const [dz, col] of [[9.4, '#1d4f8a'], [10.3, '#2d6e46']] as const) {
    tb.cyl(wx, y0, b.zf + dz, 0.3, 0.3, 0.94, 14, C(col), T_PAINT);
    tb.cyl(wx, y0 + 0.32, b.zf + dz, 0.315, 0.315, 0.04, 14, dark, T_IRON);
    tb.cyl(wx, y0 + 0.64, b.zf + dz, 0.315, 0.315, 0.04, 14, dark, T_IRON);
  }
  physics.addStaticBox(wx, y0 + 0.5, b.zf + 9.85, 0.36, 0.5, 0.85);

  // East wall parts shelving with color-coded bins & paint cans
  const ex = b.cx + (b.w / 2 - T - 0.36);
  tb.box(ex, y0 + 1.15, b.zf + 9.4, 0.54, 2.3, 2.8, 0, dark, T_IRON);
  for (let i = 0; i < 4; i++) {
    tb.box(ex, y0 + 0.38 + i * 0.54, b.zf + 9.4, 0.56, 0.05, 2.8, 0, steel, T_METAL);
    for (let k = 0; k < 4; k++) {
      tb.box(ex - 0.04, y0 + 0.56 + i * 0.54, b.zf + 8.3 + k * 0.72, 0.42, 0.28, 0.52, 0, k % 2 === 0 ? C('#2f5e94') : C('#b59058'), T_PAINT);
    }
  }
  physics.addStaticBox(ex, y0 + 1.15, b.zf + 9.4, 0.3, 1.15, 1.42);

  // ---------- 7. Exterior Dressing: Heavy Bollards, Tire Stack, Framed 3D Fascia Sign & Blade Sign ----------
  for (const sx of [-1, 1]) {
    const bx = b.cx + sx * (b.openW / 2 + 0.72);
    tb.cyl(bx, y0, b.zf - 1.5, 0.11, 0.11, 0.92, 10, C('#e5a928'), T_PAINT);
    tb.cyl(bx, y0 + 0.72, b.zf - 1.5, 0.116, 0.116, 0.12, 10, C('#181a1d'), T_PAINT);
    physics.addStaticCylinder(bx, y0 + 0.46, b.zf - 1.5, 0.46, 0.13);
  }
  // Exterior stacked tire display beside left front corner
  const extX = b.cx - b.w / 2 + 0.85, extZ = b.zf - 0.7;
  for (let i = 0; i < 3; i++) tb.cyl(extX, y0 + i * 0.24, extZ, 0.34, 0.34, 0.22, 14, C('#1b1d20'), T_STONE);
  physics.addStaticCylinder(extX, y0 + 0.38, extZ, 0.38, 0.36);

  // Framed 3D illuminated fascia lightbox mounted cleanly above the canopy
  const signW = b.w - 0.6, signH = signW * 192 / 1024;
  const signY = y0 + b.openH + (H - b.openH) * 0.66 + 0.35;
  tb.box(b.cx, signY, b.zf - 0.14, signW + 0.22, signH + 0.2, 0.24, 0, dark, T_METAL);
  const st = signTexture(b), sm = glowMat(st, o.nightUniform, 0.42, 2.2);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), sm);
  sign.rotation.y = Math.PI;
  sign.position.set(b.cx, signY, b.zf - 0.27);
  root.add(sign);

  // Perpendicular illuminated projecting blade sign on the front-west corner (visible down the avenue!)
  const blX = b.cx - b.w / 2 - 0.92, blY = y0 + H - 0.55, blZ = b.zf - 0.22;
  tb.box(b.cx - b.w / 2 - 0.18, blY + 0.32, blZ, 0.4, 0.08, 0.08, 0, dark, T_IRON);
  tb.box(b.cx - b.w / 2 - 0.18, blY - 0.32, blZ, 0.4, 0.08, 0.08, 0, dark, T_IRON);
  tb.box(blX, blY, blZ, 1.56, 0.82, 0.14, 0, dark, T_METAL);
  const bt = bladeTexture(b), bm = glowMat(bt, o.nightUniform, 0.42, 2.2);
  // both faces in one mesh: one draw call per bay (27 Nov draw-call budget)
  const bFace = new THREE.PlaneGeometry(1.48, 0.74).rotateY(Math.PI).translate(blX, blY, blZ - 0.08);
  const bBackFace = new THREE.PlaneGeometry(1.48, 0.74).translate(blX, blY, blZ + 0.08);
  const blade = new THREE.Mesh(mergeGeometries([bFace, bBackFace]), bm); blade.name = 'garage-blade';
  bFace.dispose(); bBackFace.dispose(); root.add(blade);

  // ---------- 8. Animated Glass-Vision Roll-Up Door ----------
  const dt = doorTexture(b.openW - 0.18, b.openH, b.accent);
  const dg = new THREE.BoxGeometry(b.openW - 0.14, b.openH, 0.08);
  dg.translate(0, -b.openH / 2, 0);
  const door = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ map: dt, roughness: 0.44, metalness: 0.48 }));
  door.position.set(b.cx, y0 + b.openH, b.zf + 0.58);
  door.scale.y = 0.04;
  door.castShadow = false;
  door.receiveShadow = true;
  door.name = `bayDoor:${b.name}`;
  root.add(door);
  BAY_DOORS.push(door);
}
