/**
 * Metro Police Precinct 4: a brutalist civic building (board-formed concrete, ribbon windows, blue signage band), set back
 * behind an angled parking lot of patrol cars, bollards, flag pole, blue entrance lamps, sally-port door and roof antennas.
 * Front faces north (-z) onto 5th St. Everything static; textures are small canvases, geometry goes into the trim chunks.
 */
import * as THREE from 'three';
import type { Physics } from '../core/physics';
import { type Chunked, type TrimBuilder, T_STONE, T_METAL, T_PAINT, T_PLASTIC, T_GLASS, T_GLOW, T_ROUGH } from './builders';
import { helipadPad } from './expansion';
import { POLICE_STATION as PS } from '../game/places';

const C = (h: string) => new THREE.Color(h);
type Helipads = Parameters<typeof helipadPad>[6];

/** Rectangle (world xz) the precinct compound takes over from the street lots: parking lot in front plus the building. */
export function precinctFootprint() {
  return { x0: PS.x - PS.w / 2 - 5, x1: PS.x + PS.w / 2 + 5, z0: PS.z - PS.d / 2 - 13.5, z1: PS.z + PS.d / 2 + 4 };
}

function frontTexture(w: number, h: number): THREE.CanvasTexture {
  const PX = 52, c = document.createElement('canvas'); c.width = Math.round(w * PX); c.height = Math.round(h * PX);
  const g = c.getContext('2d')!;
  g.fillStyle = '#80848a'; g.fillRect(0, 0, c.width, c.height);
  // board-formed concrete: faint horizontal boards + noise
  for (let y = 0; y < c.height; y += 9) { g.fillStyle = `rgba(${y % 18 ? 255 : 0},${y % 18 ? 255 : 0},${y % 18 ? 255 : 0},0.035)`; g.fillRect(0, y, c.width, 9); }
  for (let i = 0; i < 5000; i++) { g.fillStyle = `rgba(40,44,48,${0.03 + (i % 5) * 0.012})`; g.fillRect((i * 97) % c.width, (i * 53) % c.height, 2 + (i % 5), 1); }
  g.fillStyle = 'rgba(30,32,36,0.5)'; for (let x = 0; x < w; x += 3) g.fillRect(x * PX, 0, 2, c.height); // panel joints
  const Y = (m: number) => c.height - m * PX; // metres above ground -> px
  // ground floor: plinth band, glazing slits, sally-port bay (east) and entrance (centre)
  g.fillStyle = '#5b5f64'; g.fillRect(0, Y(1.0), c.width, 1.0 * PX);
  const glass = (x0: number, x1: number, y0: number, y1: number, lit: number) => {
    const gr = g.createLinearGradient(0, Y(y1), 0, Y(y0)); gr.addColorStop(0, '#41586e'); gr.addColorStop(1, '#16222f');
    g.fillStyle = '#e8ecee'; g.fillRect(x0 * PX - 3, Y(y1) - 3, (x1 - x0) * PX + 6, (y1 - y0) * PX + 6);
    g.fillStyle = gr; g.fillRect(x0 * PX, Y(y1), (x1 - x0) * PX, (y1 - y0) * PX);
    if (lit > 0) { g.fillStyle = `rgba(255,214,140,${lit})`; g.fillRect(x0 * PX, Y(y1), (x1 - x0) * PX, (y1 - y0) * PX); }
    g.fillStyle = '#e8ecee'; for (let x = x0 + 1.5; x < x1 - 0.5; x += 1.5) g.fillRect(x * PX - 2, Y(y1), 4, (y1 - y0) * PX);
  };
  glass(1.2, 8.4, 1.3, 3.3, 0.18); // west lobby windows
  glass(11.6, 18.4, 0.0, 4.0, 0.3); // entrance bay (doors)
  g.fillStyle = '#10161c'; g.fillRect(14.9 * PX - 2, Y(2.3), 4, 2.3 * PX);
  // sally-port roll-up door at the east end
  g.fillStyle = '#9aa0a6'; g.fillRect(22.4 * PX, Y(4.0), 6.2 * PX, 4.0 * PX);
  g.fillStyle = 'rgba(30,34,38,0.7)'; for (let y = 0; y < 4.0; y += 0.22) g.fillRect(22.4 * PX, Y(4.0 - y), 6.2 * PX, 2);
  g.fillStyle = '#e8b830'; for (let k = 0; k < 20; k++) { g.save(); g.beginPath(); g.rect(22.4 * PX, Y(0.5), 6.2 * PX, 0.5 * PX); g.clip(); g.fillRect((22.4 + k * 0.34) * PX, Y(0.5), 0.17 * PX, 0.5 * PX); g.restore(); }
  g.fillStyle = '#222'; g.fillRect(22.3 * PX - 6, Y(4.0) - 6, 6.4 * PX + 12, 6);
  g.fillStyle = '#ffdc3a'; g.font = `700 ${0.42 * PX}px Arial`; g.textAlign = 'center'; g.fillText('SALLY PORT', 25.5 * PX, Y(4.0) + 0.55 * PX);
  // upper floors: two ribbon windows with deep reveals, spaced piers
  for (const [y0, y1] of [[5.9, 8.0], [9.3, 11.4]] as const) {
    for (let x = 0.6; x < w - 1; x += 4.9) glass(x, Math.min(x + 4.3, w - 0.6), y0, y1, Math.random() < 0.4 ? 0.25 : 0.05);
  }
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, Y(12.2), c.width, 0.15 * PX);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function signTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 1536; c.height = 160; const g = c.getContext('2d')!;
  g.fillStyle = '#0c3a8c'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#f1f5fb'; g.fillRect(0, 0, c.width, 10); g.fillRect(0, c.height - 10, c.width, 10);
  // blue and white checker (Battenberg) strip along the foot of the band
  for (let x = 0; x < c.width; x += 32) { g.fillStyle = (x / 32) % 2 ? '#f1f5fb' : '#1c56c0'; g.fillRect(x, c.height - 30, 32, 20); }
  // badge
  const bx = 120, by = 78; g.fillStyle = '#e8b830'; g.beginPath(); for (let k = 0; k < 10; k++) { const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? 26 : 58; g.lineTo(bx + Math.cos(a) * r, by + Math.sin(a) * r); } g.closePath(); g.fill();
  g.fillStyle = '#0c3a8c'; g.beginPath(); g.arc(bx, by, 17, 0, 7); g.fill();
  g.fillStyle = '#f1f5fb'; g.font = '800 92px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('METRO POLICE  ·  PRECINCT 4', c.width / 2 + 60, 72, 1260);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function lotTexture(): THREE.CanvasTexture {
  const PX = 24, W = 44, D = 13.5, c = document.createElement('canvas'); c.width = W * PX; c.height = Math.round(D * PX); const g = c.getContext('2d')!;
  g.fillStyle = '#33363a'; g.fillRect(0, 0, c.width, c.height);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},${i % 2 ? 255 : 0},0.04)`; g.fillRect((i * 83) % c.width, (i * 47) % c.height, 8 + (i % 13), 2 + (i % 3)); }
  g.strokeStyle = '#e8ecef'; g.lineWidth = 3;
  // 60 degree angled stalls along the kerb side (top), 4 m wide
  for (let k = 0; k <= 9; k++) { const x = 5 + k * 3.8; g.beginPath(); g.moveTo(x * PX, 0.4 * PX); g.lineTo((x + 2.6) * PX, 5.6 * PX); g.stroke(); }
  g.beginPath(); g.moveTo(5 * PX, 0.4 * PX); g.lineTo(5 * PX + 9 * 3.8 * PX + 2.6 * PX, 0.4 * PX); g.stroke();
  g.fillStyle = '#e8ecef'; g.font = `700 ${1.1 * PX}px Arial`; g.textAlign = 'center'; g.fillText('POLICE PARKING ONLY', 22 * PX, 11.6 * PX);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

/** Static patrol car: black body, white doors, blue/red light bar. Centre (x,z), heading yaw (nose along +z rotated by yaw). */
function patrolCar(tb: TrimBuilder, physics: Physics, x: number, z: number, yaw: number, y0: number) {
  const k = [C('#14171c'), C('#f0f2f4'), C('#1a2430'), C('#2a73ff'), C('#ff3a2a'), C('#0b0b0c')];
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const at = (lx: number, lz: number): [number, number] => [x + lx * c + lz * s, z - lx * s + lz * c];
  const b = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number, col: THREE.Color, t = T_PAINT) => { const [px, pz] = at(lx, lz); tb.box(px, y0 + ly, pz, sx, sy, sz, yaw, col, t); };
  b(0, 0.55, 0, 1.85, 0.55, 4.9, k[0]); // lower body
  b(0, 0.55, -0.2, 1.87, 0.5, 2.2, k[1]); // white door panel band
  b(0, 1.05, -0.15, 1.7, 0.45, 2.5, k[2], T_GLASS); // cabin glass
  b(0, 1.32, -0.15, 1.6, 0.06, 2.3, k[0]); // roof
  b(0, 0.85, 1.4, 1.8, 0.04, 1.5, k[0]); b(0, 0.82, -1.9, 1.8, 0.04, 1.0, k[0]); // hood / deck
  b(-0.32, 1.42, -0.15, 0.62, 0.12, 0.3, k[3], T_GLOW(2.2)); b(0.32, 1.42, -0.15, 0.62, 0.12, 0.3, k[4], T_GLOW(2.2)); // light bar
  b(0, 0.35, 2.5, 1.7, 0.18, 0.12, k[5], T_METAL); // push bar
  for (const sx of [-1, 1]) for (const sz of [-1.5, 1.5]) { const [px, pz] = at(sx * 0.92, sz); tb.cyl(px, y0 + 0.02, pz, 0.34, 0.34, 0.26, 10, k[5], T_PLASTIC, yaw, 0, Math.PI / 2); }
  physics.addStaticBox(x, y0 + 0.75, z, 0.95, 0.75, 2.4, yaw);
}

export function buildPrecinct(o: { root: THREE.Object3D; physics: Physics; trim: Chunked<TrimBuilder>; helipads: Helipads; curb: number; nightUniform: { value: number } }) {
  const { root, physics, trim, curb } = o;
  const W = PS.w - 1.5, D = PS.d - 2, cx = PS.x, cz = PS.z, zf = cz - D / 2; // front face z
  const H1 = 4.4, H = 12.6, y0 = curb;
  const tb = trim.at(cx, cz);
  const conc = C('#7b7f84'), dark = C('#4a4e53'), white = C('#e8ecef');
  // main mass + plinth + roof slab with parapet
  tb.box(cx, y0 + H / 2, cz, W, H, D, 0, conc, T_STONE);
  physics.addStaticBox(cx, y0 + H / 2, cz, W / 2, H / 2, D / 2);
  tb.box(cx, y0 + 0.5, cz, W + 0.6, 1.0, D + 0.6, 0, dark, T_STONE);
  tb.box(cx, y0 + H + 0.3, cz, W + 0.5, 0.6, D + 0.5, 0, dark, T_STONE);
  // cantilevered upper volume overhang (brutalist projecting band) across the front
  tb.box(cx, y0 + H1 + 0.2, zf - 0.9, W + 0.4, 0.4, 1.8, 0, dark, T_STONE);
  // front elevation (texture) sits 3 cm proud of the wall; sign band over the entrance
  const ft = frontTexture(W, H);
  const fm = new THREE.MeshStandardMaterial({ map: ft, roughness: 0.78, emissiveMap: ft, emissive: new THREE.Color(0.5, 0.45, 0.35) });
  fm.onBeforeCompile = sh => { sh.uniforms.uNight = o.nightUniform; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= uNight * 0.9;'); };
  const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), fm); front.rotation.y = Math.PI; front.position.set(cx, y0 + H / 2, zf - 0.03); root.add(front);
  const st = signTexture();
  const sm = new THREE.MeshStandardMaterial({ map: st, emissiveMap: st, emissive: new THREE.Color(1, 1, 1), roughness: 0.5 });
  sm.onBeforeCompile = sh => { sh.uniforms.uNight = o.nightUniform; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.18 + uNight * 2.2;'); };
  const signW = 21, signH = signW * 160 / 1536;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(signW, signH), sm); sign.rotation.y = Math.PI; sign.position.set(cx, y0 + 4.9 + signH / 2, zf - 0.085); root.add(sign);
  tb.box(cx, y0 + 4.9 + signH / 2, zf - 0.03, signW + 0.3, signH + 0.3, 0.04, 0, white, T_PAINT);
  // side and rear: ribbon windows as dark glass strips
  const glassC = C('#1b2733');
  for (const [fy0, fy1] of [[5.9, 8.0], [9.3, 11.4]]) {
    const hh = fy1 - fy0, cy = y0 + (fy0 + fy1) / 2;
    for (const sx of [-1, 1]) tb.box(cx + sx * (W / 2 + 0.02), cy, cz, 0.05, hh, D - 3, 0, glassC, T_GLASS);
    tb.box(cx, cy, cz + D / 2 + 0.02, W - 3, hh, 0.05, 0, glassC, T_GLASS);
  }
  // entrance canopy with blue underlight and doors recess
  const tx = (m: number) => cx + W / 2 - m; // texture x (metres from its left edge) -> world x: the front faces -z, so texture left is world +x
  const ex = tx(15); // entrance bay centre
  tb.box(ex, y0 + 4.3, zf - 2.2, 9, 0.35, 4.4, 0, white, T_PAINT);
  tb.box(ex, y0 + 4.1, zf - 2.2, 8.4, 0.04, 3.9, 0, C('#3a7bff'), T_GLOW(2.5));
  for (const dx of [-4.2, 4.2]) { tb.cyl(ex + dx, y0, zf - 4.0, 0.22, 0.22, 4.2, 10, dark, T_STONE); physics.addStaticCylinder(ex + dx, y0 + 2.1, zf - 4.0, 2.1, 0.22); }
  // entrance steps / plaza
  tb.box(ex, y0 + 0.08, zf - 2.4, 11, 0.16, 5.2, 0, C('#a9a69e'), T_STONE);
  // blue lamps beside the entrance (the classic precinct lamp) on short posts
  for (const dx of [-5.6, 5.6]) { tb.cyl(ex + dx, y0, zf - 0.9, 0.07, 0.07, 2.6, 8, C('#1b1d20'), T_METAL); tb.sphere(ex + dx, y0 + 2.9, zf - 0.9, 0.3, C('#3a7bff'), T_GLOW(5)); }
  // sally-port: ramped apron and warning bollards
  const sx = tx(25.5);
  tb.box(sx, y0 + 0.02, zf - 3, 6.4, 0.04, 6, 0, C('#2c2f33'), T_STONE);
  // flag poles (national + state/department flags) on the plaza
  for (const [fx, col] of [[ex - 9, '#b22234'], [ex - 11, '#0c3a8c']] as const) {
    tb.cyl(fx, y0, zf - 3.4, 0.09, 0.05, 11, 8, C('#d8dadc'), T_METAL); tb.sphere(fx, y0 + 11.1, zf - 3.4, 0.14, C('#e8b830'), T_METAL);
    tb.box(fx - 0.9, y0 + 10.2, zf - 3.4, 1.8, 1.1, 0.03, 0, C(col), T_PAINT, 0, 0.04);
    physics.addStaticCylinder(fx, y0 + 4, zf - 3.4, 4, 0.12);
  }
  // barrier bollards along the front plaza edge (leaving the entrance and sally port approach open)
  for (let bx = cx - W / 2 + 1; bx < cx + W / 2; bx += 1.8) {
    if (Math.abs(bx - ex) < 6 || (bx > sx - 3.8 && bx < sx + 3.8)) continue;
    tb.cyl(bx, y0, zf - 6.2, 0.16, 0.16, 0.95, 8, C('#c8ccd0'), T_METAL); tb.cyl(bx, y0 + 0.62, zf - 6.2, 0.165, 0.165, 0.1, 8, C('#e8b830'), T_PAINT);
    physics.addStaticCylinder(bx, y0 + 0.47, zf - 6.2, 0.47, 0.16);
  }
  // angled parking lot in front of the plaza
  const lx0 = cx - 22, lz0 = PS.z - PS.d / 2 - 13.5 + 0.02;
  const lm = new THREE.MeshStandardMaterial({ map: lotTexture(), roughness: 0.92 });
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(44, 13.5).rotateX(-Math.PI / 2), lm); lot.position.set(lx0 + 22, y0 + 0.012, lz0 + 6.75); lot.receiveShadow = true; root.add(lot);
  // 7 patrol cars + 1 unmarked, nosed into the angled stalls (60 deg)
  const lotTb = trim.at(cx, lz0 + 3);
  for (let k = 0; k < 8; k++) {
    if (k === 5) continue;
    const px = lx0 + 5 + 1.3 + k * 3.8 + 1.1, pz = lz0 + 3.6;
    patrolCar(lotTb, physics, px, pz, Math.PI + 0.52 * 1, y0 + 0.01);
  }
  // roof: antenna masts, dish, HVAC boxes, red aircraft light (helipad stays on the east half)
  const ry = y0 + H + 0.6;
  for (const [ax, az, hgt] of [[-9, 2.5, 14], [-12, -2.5, 9]]) {
    tb.cyl(cx + ax, ry, cz + az, 0.16, 0.06, hgt, 6, C('#c7c9cc'), T_METAL);
    for (let k = 1; k < 4; k++) tb.box(cx + ax, ry + hgt * k / 4.2, cz + az, 2.4 - k * 0.4, 0.05, 0.05, 0.6 * k, C('#c7c9cc'), T_METAL);
  }
  tb.sphere(cx - 9, ry + 14.1, cz + 2.5, 0.2, C('#ff2a1a'), T_GLOW(4));
  tb.cyl(cx - 3, ry + 0.9, cz - 3, 1.1, 0.5, 0.2, 14, C('#d4d7da'), T_METAL, 0, 0.5); // dish
  tb.box(cx - 3, ry + 0.45, cz + 3, 3.2, 0.9, 2.2, 0, C('#8f9398'), T_METAL);
  tb.box(cx - 13, ry + 0.45, cz, 2.4, 0.9, 3.6, 0, C('#8f9398'), T_METAL);
  // rooftop helipad (kept from the previous precinct)
  const Hp = y0 + H;
  tb.box(cx + 6, Hp + 1.05, cz, 10.4, 0.25, 9.6, 0, C('#55595c'), T_METAL);
  for (const dx of [-4.5, 4.5]) for (const dz of [-4, 4]) tb.box(cx + 6 + dx, Hp + 0.5, cz + dz, 0.25, 1, 0.25, 0, C('#55595c'), T_METAL);
  physics.addStaticBox(cx + 6, Hp + 1.05, cz, 5.2, 0.13, 4.8);
  helipadPad(tb, physics, cx + 6, Hp + 1.18, cz, 'Metro Police roof helipad', o.helipads, 4.7);
  void T_ROUGH;
}
