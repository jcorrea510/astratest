/**
 * Round 9: the two drive-in garages (Glow Garage and the Fuel Stop service bay). A real hall: block walls, steel roof beams, an epoxy
 * floor with bay lines, a tool wall, bench, tyre stacks and drums, strip lights (emissive only: no runtime lights) and a roll-up door
 * (its own mesh, animated by game/garageBay.ts). Everything static is merged into the trim chunks; colliders keep cars out of the walls.
 */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { type Chunked, type TrimBuilder, T_STONE, T_METAL, T_PAINT, T_GLOW } from './builders';
import { BAYS, type BaySpec } from '../game/bays';

const C = (h: string) => new THREE.Color(h);
/** The animated roll-up door of each bay (index = BAYS index). Filled by buildGarages. */
export const BAY_DOORS: THREE.Mesh[] = [];

function doorTexture(w: number, h: number, accent: string): THREE.CanvasTexture {
  const PX = 96, c = document.createElement('canvas'); c.width = Math.round(w * PX / 2); c.height = Math.round(h * PX / 2);
  const g = c.getContext('2d')!, S = PX / 2;
  g.fillStyle = '#a9aeb3'; g.fillRect(0, 0, c.width, c.height);
  for (let y = 0; y < h; y += 0.22) { // slats: a lit top edge and a dark shadow line each
    g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(0, y * S, c.width, 1.5);
    g.fillStyle = 'rgba(20,24,28,0.45)'; g.fillRect(0, (y + 0.17) * S, c.width, 2.5);
  }
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(40,44,48,${0.02 + (i % 4) * 0.012})`; g.fillRect((i * 97) % c.width, (i * 53) % c.height, 3 + (i % 9), 1); }
  // a row of small windows in the third slat band
  g.fillStyle = '#1d2a35'; for (let k = 0; k < 4; k++) g.fillRect((0.45 + k * (w - 0.9) / 4) * S, 1.25 * S, ((w - 0.9) / 4 - 0.18) * S, 0.5 * S);
  g.fillStyle = 'rgba(160,200,230,0.18)'; for (let k = 0; k < 4; k++) g.fillRect((0.45 + k * (w - 0.9) / 4) * S, 1.25 * S, ((w - 0.9) / 4 - 0.18) * S, 0.14 * S);
  // hazard stripe on the bottom bar
  g.save(); g.beginPath(); g.rect(0, c.height - 0.36 * S, c.width, 0.36 * S); g.clip(); g.fillStyle = '#e8b830'; g.fillRect(0, c.height - 0.36 * S, c.width, 0.36 * S);
  g.fillStyle = '#1c1c1c'; for (let x = -1; x < w * 2; x += 0.5) { g.beginPath(); g.moveTo(x * S, c.height); g.lineTo((x + 0.25) * S, c.height); g.lineTo((x + 0.55) * S, c.height - 0.36 * S); g.lineTo((x + 0.3) * S, c.height - 0.36 * S); g.fill(); } g.restore();
  g.fillStyle = accent; g.globalAlpha = 0.7; g.fillRect(0, 0.0, c.width, 0.08 * S); g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function signTexture(b: BaySpec): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 160; const g = c.getContext('2d')!;
  g.fillStyle = b.signBg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = b.accent; g.fillRect(0, 0, c.width, 8); g.fillRect(0, c.height - 8, c.width, 8);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = '800 82px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'; g.shadowColor = b.signFg; g.shadowBlur = 14; g.fillStyle = b.signFg;
  g.fillText(b.sign, c.width / 2, 62);
  g.shadowBlur = 0; g.font = '700 32px "Barlow Condensed", "Arial Narrow", Arial, sans-serif'; g.fillStyle = 'rgba(255,255,255,0.82)'; g.fillText(b.sub, c.width / 2, 122);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

function glowMat(map: THREE.Texture, night: { value: number }, day: number, nightK: number): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ map, emissiveMap: map, emissive: new THREE.Color(1, 1, 1), roughness: 0.5 });
  m.onBeforeCompile = sh => { sh.uniforms.uNight = night; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\ntotalEmissiveRadiance *= ${day.toFixed(2)} + uNight * ${nightK.toFixed(2)};`); };
  return m;
}

export function buildGarages(o: { root: THREE.Object3D; physics: Physics; trim: Chunked<TrimBuilder>; curb: number; nightUniform: { value: number } }) {
  BAY_DOORS.length = 0;
  for (const b of BAYS) buildBay(o, b);
}

function buildBay(o: { root: THREE.Object3D; physics: Physics; trim: Chunked<TrimBuilder>; curb: number; nightUniform: { value: number } }, b: BaySpec) {
  const { root, physics, curb: y0 } = o;
  const cz = b.zf + b.d / 2, tb = o.trim.at(b.cx, cz);
  const wall = C(b.wall), dark = C('#3b3e43'), accent = C(b.accent), steel = C('#565b61'), ceil = C('#d8d6cf');
  const T = 0.4, H = b.h, pierW = (b.w - b.openW) / 2;
  const solid = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col: THREE.Color, tex = T_STONE) => { tb.box(x, y0 + y, z, sx, sy, sz, 0, col, tex); physics.addStaticBox(x, y0 + y, z, sx / 2, sy / 2, sz / 2); };
  // floor slab (epoxy), apron and the yellow bay lines
  const FILL = T_GLOW(0.42), FILL_LO = T_GLOW(0.3);
  tb.box(b.cx, y0 + 0.015, cz, b.w - 2 * T, 0.03, b.d - T, 0, C('#7a7f86'), FILL_LO);
  tb.box(b.cx, y0 + 0.012, b.zf - 3.2, b.openW + 3, 0.024, 6.4, 0, C('#8f8d86'), T_STONE);
  const lineY = y0 + 0.035;
  for (const sx of [-1, 1]) tb.box(b.cx + sx * 1.75, lineY, b.zf + 6.4, 0.1, 0.01, 6.6, 0, C('#e8b830'), T_PAINT);
  for (const sz of [-1, 1]) tb.box(b.cx, lineY, b.zf + 6.4 + sz * 3.3, 3.6, 0.01, 0.1, 0, C('#e8b830'), T_PAINT);
  tb.box(b.cx, lineY, b.zf + 1.1, b.openW - 0.4, 0.01, 0.3, 0, C('#1c1c1c'), T_PAINT);
  for (let k = 0; k < 11; k++) tb.box(b.cx - b.openW / 2 + 0.55 + k * 0.4, lineY + 0.002, b.zf + 1.1, 0.2, 0.01, 0.3, 0, C('#e8b830'), T_PAINT);
  // drain grate
  tb.box(b.cx, lineY, b.zf + 6.4, 0.9, 0.012, 0.5, 0, C('#2a2c2f'), T_METAL);
  // walls
  solid(b.cx, H / 2, b.zf + b.d - T / 2, b.w, H, T, wall);
  for (const sx of [-1, 1]) solid(b.cx + sx * (b.w / 2 - T / 2), H / 2, cz, T, H, b.d, wall);
  // front piers and lintel (the door housing sits inside the lintel)
  for (const sx of [-1, 1]) solid(b.cx + sx * (b.openW / 2 + pierW / 2), H / 2, b.zf + 0.3, pierW, H, 0.6, wall);
  solid(b.cx, b.openH + (H - b.openH) / 2, b.zf + 0.3, b.openW, H - b.openH, 0.6, wall);
  // roof slab with a parapet, and a coloured band along the front
  solid(b.cx, H + 0.15, cz, b.w + 0.5, 0.3, b.d + 0.5, ceil);
  tb.box(b.cx, y0 + H + 0.45, b.zf - 0.1, b.w + 0.5, 0.3, 0.25, 0, dark, T_STONE);
  tb.box(b.cx, y0 + H - 0.55, b.zf - 0.01, b.w, 0.18, 0.04, 0, accent, T_GLOW(0.6));
  tb.box(b.cx, y0 + 0.6, b.zf - 0.02, b.w, 1.2, 0.05, 0, C('#6c6e70'), T_STONE); // block plinth on the front
  // door tracks and a coil housing above the opening
  for (const sx of [-1, 1]) tb.box(b.cx + sx * (b.openW / 2 - 0.04), y0 + b.openH / 2, b.zf + 0.55, 0.1, b.openH, 0.14, 0, steel, T_METAL);
  tb.box(b.cx, y0 + b.openH + 0.2, b.zf + 0.62, b.openW, 0.4, 0.5, 0, steel, T_METAL);
  // interior: lit liners (wainscot, cream upper wall, accent stripe, ceiling) so the hall reads as a lit workshop
  const uw = C('#e6e1d3'), lw = C('#8b9096');
  for (const sx of [-1, 1]) {
    const x = b.cx + sx * (b.w / 2 - T - 0.02);
    tb.box(x, y0 + 0.65, cz, 0.04, 1.3, b.d - 2 * T, 0, lw, FILL);
    tb.box(x, y0 + 1.36, cz, 0.05, 0.14, b.d - 2 * T, 0, accent, T_GLOW(0.8));
    tb.box(x, y0 + 3.05, cz, 0.04, H - 1.43, b.d - 2 * T, 0, uw, FILL);
  }
  tb.box(b.cx, y0 + 0.65, b.zf + b.d - T - 0.02, b.w - 2 * T, 1.3, 0.04, 0, lw, FILL);
  tb.box(b.cx, y0 + 1.36, b.zf + b.d - T - 0.03, b.w - 2 * T, 0.14, 0.05, 0, accent, T_GLOW(0.8));
  tb.box(b.cx, y0 + 3.05, b.zf + b.d - T - 0.02, b.w - 2 * T, H - 1.43, 0.04, 0, uw, FILL);
  tb.box(b.cx, y0 + H - 0.02, cz, b.w - 2 * T, 0.04, b.d - T, 0, C('#f2efe6'), FILL);
  for (let z = b.zf + 2; z < b.zf + b.d; z += 3.4) tb.box(b.cx, y0 + H - 0.22, z, b.w - 2 * T, 0.3, 0.22, 0, steel, T_METAL);
  for (const z of [b.zf + 3.4, b.zf + 7, b.zf + 10.6]) for (const sx of [-1, 1]) {
    tb.box(b.cx + sx * 2.2, y0 + H - 0.5, z, 0.2, 0.07, 2.6, 0, C('#fff7e6'), T_GLOW(3));
    for (const dz of [-1.1, 1.1]) tb.box(b.cx + sx * 2.2, y0 + H - 0.4, z + dz, 0.03, 0.14, 0.03, 0, dark, T_METAL);
  }
  // back wall: pegboard with tools, a bench, a red tool chest, a roller cabinet, a wall clock
  const bz = b.zf + b.d - T - 0.1;
  tb.box(b.cx - 1.4, y0 + 2.0, bz + 0.03, 3.0, 1.1, 0.05, 0, C('#a88252'), FILL_LO);
  for (let i = 0; i < 9; i++) { const x = b.cx - 2.6 + i * 0.32; tb.box(x, y0 + 2.1 + ((i * 7) % 3) * 0.1, bz - 0.01, 0.05, 0.4 + (i % 3) * 0.1, 0.03, 0, i % 2 ? C('#c9ccd0') : C('#d04b3a'), T_METAL); }
  tb.box(b.cx - 1.4, y0 + 0.9, bz - 0.3, 3.0, 0.08, 0.7, 0, C('#b89868'), FILL_LO);
  for (const sx of [-1.4, 1.4]) tb.box(b.cx - 1.4 + sx, y0 + 0.43, bz - 0.3, 0.1, 0.86, 0.6, 0, dark, T_METAL);
  tb.box(b.cx - 1.4, y0 + 0.2, bz - 0.3, 2.7, 0.06, 0.55, 0, dark, T_METAL);
  tb.box(b.cx + 1.9, y0 + 0.55, bz - 0.35, 1.0, 1.1, 0.65, 0, C('#c8392e'), FILL_LO);
  for (let i = 0; i < 4; i++) tb.box(b.cx + 1.9, y0 + 0.2 + i * 0.26, bz - 0.69, 0.9, 0.2, 0.03, 0, C('#8f261f'), FILL_LO);
  tb.box(b.cx + 1.9, y0 + 1.14, bz - 0.35, 1.04, 0.05, 0.69, 0, C('#2c2e31'), T_METAL);
  tb.cyl(b.cx + 3.4, y0, bz - 0.3, 0.3, 0.3, 1.0, 14, C('#2a62ad'), FILL_LO); tb.cyl(b.cx + 3.4, y0 + 0.35, bz - 0.3, 0.31, 0.31, 0.04, 14, C('#143760'), T_METAL);
  physics.addStaticBox(b.cx - 1.4, y0 + 0.5, bz - 0.3, 1.5, 0.5, 0.35); physics.addStaticBox(b.cx + 1.9, y0 + 0.55, bz - 0.35, 0.5, 0.55, 0.33);
  tb.cyl(b.cx + 3.8, y0 + 0.01, bz - 0.9, 0.29, 0.29, 0.9, 12, C('#4a8a48'), FILL_LO);
  // west wall: tyre stacks and a lift column pair; east wall: shelving with boxes
  const wx = b.cx - (b.w / 2 - T - 0.5);
  for (const [dz, n] of [[3.3, 4], [4.4, 3]] as const) for (let i = 0; i < n; i++) tb.cyl(wx, y0 + i * 0.22, b.zf + dz, 0.34, 0.34, 0.21, 16, C('#2a2b2e'), FILL_LO);
  physics.addStaticBox(wx, y0 + 0.5, b.zf + 3.85, 0.4, 0.5, 0.95);
  const ex = b.cx + (b.w / 2 - T - 0.35);
  tb.box(ex, y0 + 1.0, b.zf + 8.8, 0.5, 2.0, 2.8, 0, steel, T_METAL);
  for (let i = 0; i < 4; i++) { tb.box(ex, y0 + 0.4 + i * 0.5, b.zf + 8.8, 0.52, 0.05, 2.8, 0, C('#cfa13a'), FILL_LO); for (let k = 0; k < 3; k++) tb.box(ex, y0 + 0.6 + i * 0.5, b.zf + 7.8 + k * 0.95, 0.38, 0.3, 0.6, 0, k % 2 ? C('#c09a68') : C('#8d9aa6'), FILL_LO); }
  physics.addStaticBox(ex, y0 + 1.0, b.zf + 8.8, 0.26, 1.0, 1.4);
  for (const sx of [-1, 1]) { tb.box(b.cx + sx * 3.1, y0 + 1.1, b.zf + 2.2, 0.3, 2.2, 0.3, 0, C('#d14b2f'), FILL_LO); }
  physics.addStaticBox(b.cx - 3.1, y0 + 1.1, b.zf + 2.2, 0.15, 1.1, 0.15); physics.addStaticBox(b.cx + 3.1, y0 + 1.1, b.zf + 2.2, 0.15, 1.1, 0.15);
  // exterior: bollards flanking the door, wall lamps, a bright sign above the lintel
  for (const sx of [-1, 1]) { const x = b.cx + sx * (b.openW / 2 + 0.7); tb.cyl(x, y0, b.zf - 1.4, 0.11, 0.11, 0.9, 8, C('#e8b830'), T_PAINT); physics.addStaticCylinder(x, y0 + 0.45, b.zf - 1.4, 0.45, 0.12); tb.box(x, y0 + 4.4, b.zf - 0.14, 0.22, 0.16, 0.24, 0, dark, T_METAL); tb.box(x, y0 + 4.27, b.zf - 0.14, 0.18, 0.04, 0.2, 0, C('#fff2c8'), T_GLOW(3)); }
  const st = signTexture(b), sm = glowMat(st, o.nightUniform, 0.28, 2.0);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(b.w - 1.2, (b.w - 1.2) * 160 / 1024), sm); sign.rotation.y = Math.PI;
  sign.position.set(b.cx, y0 + b.openH + (H - b.openH) / 2 + 0.05, b.zf - 0.04); root.add(sign);
  // the roll-up door: top-anchored so scale.y squashes it up into the coil housing
  const dt = doorTexture(b.openW - 0.2, b.openH, b.accent);
  const dg = new THREE.BoxGeometry(b.openW - 0.16, b.openH, 0.08); dg.translate(0, -b.openH / 2, 0);
  const door = new THREE.Mesh(dg, new THREE.MeshStandardMaterial({ map: dt, roughness: 0.55, metalness: 0.35 }));
  door.position.set(b.cx, y0 + b.openH, b.zf + 0.55); door.scale.y = 0.04; door.castShadow = false; door.receiveShadow = true; door.name = `bayDoor:${b.name}`;
  root.add(door); BAY_DOORS.push(door);
}
