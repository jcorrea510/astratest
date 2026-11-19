/**
 * Walk-in store interiors: shop front with glazing and sliding doors, tiled floor, ceiling lights, shelving with
 * products, fridges, counter with register, back shelf behind the clerk, roll-down shutter. Built per store in a
 * local frame (+z = street side, origin at the footprint centre on the pavement) and returned as one group.
 */
import { worldGlass } from './glass';
import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Physics } from '../core/physics';
import { trimMaterial, nightUniform } from '../render/materials';
import { TrimBuilder, T_PAINT, T_METAL, T_PLASTIC, T_GLASS, T_GLOW, T_FABRIC, T_STONE, T_ROUGH, type TrimParams } from './builders';
import { STORE_W, STORE_D, STORE_H, type Store } from '../game/places';

export interface StoreShell {
  root: THREE.Group;
  shutter: THREE.Object3D;
  doors: THREE.Object3D[];
  /** door gap collider (enabled while the shutter is down) */
  setClosed: (closed: boolean) => void;
  setDoor: (open: number) => void;
  alarm: THREE.Mesh;
  toWorld: (lx: number, ly: number, lz: number) => THREE.Vector3;
  toLocal: (p: THREE.Vector3) => THREE.Vector3;
  clerk: THREE.Vector3; customer: THREE.Vector3; bag: THREE.Vector3; light: THREE.Vector3; counterZ: number;
}

const C = (h: string) => new THREE.Color(h);
let tileMat: THREE.MeshStandardMaterial | null = null;
let glassMat: THREE.MeshStandardMaterial | null = null;
let trimMat: THREE.MeshStandardMaterial | null = null;
const signMats = new Map<string, THREE.MeshStandardMaterial>();

function floorTiles(): THREE.MeshStandardMaterial {
  if (tileMat) return tileMat;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  const r = new Rng(41);
  for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { const v = (x + y) % 2 ? 228 : 208; const j = r.int(-6, 6); g.fillStyle = `rgb(${v + j},${v + j - 3},${v + j - 8})`; g.fillRect(x * 64, y * 64, 64, 64); }
  g.strokeStyle = 'rgba(90,85,80,0.6)'; g.lineWidth = 2; for (let k = 0; k <= 4; k++) { g.beginPath(); g.moveTo(k * 64, 0); g.lineTo(k * 64, 256); g.stroke(); g.beginPath(); g.moveTo(0, k * 64); g.lineTo(256, k * 64); g.stroke(); }
  for (let k = 0; k < 300; k++) { g.fillStyle = `rgba(60,50,40,${r.range(0.02, 0.08)})`; g.fillRect(r.range(0, 256), r.range(0, 256), r.range(2, 14), r.range(2, 8)); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  tileMat = new THREE.MeshStandardMaterial({ map: t, roughness: 0.25, metalness: 0 });
  return tileMat;
}
function signMat(name: string, color: string): THREE.MeshStandardMaterial {
  let m = signMats.get(name); if (m) return m;
  const c = document.createElement('canvas'); c.width = 512; c.height = 96; const g = c.getContext('2d')!;
  g.fillStyle = color; g.fillRect(0, 0, 512, 96);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 4; g.strokeRect(6, 6, 500, 84);
  g.fillStyle = '#fff8ec'; g.font = '800 50px "Arial Narrow", Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.shadowColor = '#fff2cf'; g.shadowBlur = 8; g.fillText(name.toUpperCase(), 256, 50, 470);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  m = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: new THREE.Color(1, 1, 1), emissiveIntensity: 0.4, roughness: 0.5 });
  m.onBeforeCompile = sh => { sh.uniforms.uNight = nightUniform; sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;').replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance *= 0.25 + uNight * 2.5;'); };
  signMats.set(name, m); return m;
}

/** Pure placement maths of a store (no meshes): lets hold-up logic work before the interior is built. */
export function storeFrame(def: Store, baseY: number) {
  const pos = new THREE.Vector3(def.x, baseY, def.z), up = new THREE.Vector3(0, 1, 0), counterZ = 1.2;
  const toWorld = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyAxisAngle(up, def.yaw).add(pos);
  const toLocal = (p: THREE.Vector3) => p.clone().sub(pos).applyAxisAngle(up, -def.yaw);
  return { toWorld, toLocal, counterZ, clerk: toWorld(-3.0, 0.05, 0.25), customer: toWorld(-3.0, 0.05, 3.0), bag: toWorld(-3.0, 0.35, counterZ + 1.0), light: toWorld(0, 3.2, 0) };
}
export type StoreFrame = ReturnType<typeof storeFrame>;

export function buildStoreShell(scene: THREE.Scene, physics: Physics, def: Store, baseY: number): StoreShell {
  const root = new THREE.Group(); root.name = `store:${def.name}`;
  root.position.set(def.x, baseY, def.z); root.rotation.y = def.yaw; scene.add(root);
  trimMat ??= trimMaterial();
  glassMat ??= new THREE.MeshStandardMaterial({ color: '#9fb8c0', roughness: 0.04, metalness: 0.1, transparent: true, opacity: 0.22, depthWrite: false });
  const r = new Rng(Math.round(def.x * 7 + def.z * 13));
  const t = new TrimBuilder();
  const W = STORE_W, D = STORE_D, H = STORE_H, ceil = 3.6, hw = W / 2, hd = D / 2;
  const WALLS: Partial<Record<Store['kind'], string>> = { diner: '#e8dcc4', pawn: '#2d2a28', liquor: '#3a4660', pharmacy: '#eef4f0', clothing: '#e9dfe8', electronics: '#262b33', barber: '#d8c9b0', bank: '#e6e0d2' };
  const wallC = C(WALLS[def.kind] ?? '#ece8e0');
  const outC = C(def.kind === 'gas' ? '#e9e5dc' : '#4b4743');
  const accent = C(def.color);
  const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, col: THREE.Color, tp: TrimParams = T_PAINT, pitch = 0) => t.box(x, y, z, sx, sy, sz, 0, col, tp, pitch);
  // walls (interior faces painted; exterior gets the outer colour via a second skin)
  box(0, H / 2, -hd + 0.12, W, H, 0.24, wallC); box(-hw + 0.12, H / 2, 0, 0.24, H, D, wallC); box(hw - 0.12, H / 2, 0, 0.24, H, D, wallC);
  box(0, H / 2, -hd - 0.01, W + 0.02, H, 0.02, outC, T_STONE); box(-hw - 0.01, H / 2, 0, 0.02, H, D, outC, T_STONE); box(hw + 0.01, H / 2, 0, 0.02, H, D, outC, T_STONE);
  const toW = (lx: number, ly: number, lz: number) => new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), def.yaw).add(root.position);
  const col = (lx: number, ly: number, lz: number, sx: number, sy: number, sz: number) => { const p = toW(lx, ly, lz); return physics.addStaticBox(p.x, p.y, p.z, sx, sy, sz, def.yaw); };
  col(0, H / 2, -hd + 0.12, hw, H / 2, 0.12); col(-hw + 0.12, H / 2, 0, 0.12, H / 2, hd); col(hw - 0.12, H / 2, 0, 0.12, H / 2, hd);
  // ceiling + lights
  box(0, ceil + 0.05, 0, W, 0.1, D, C('#e6e4de'), [0.9, 0, 0, 0]);
  box(0, (ceil + H) / 2, hd - 0.15, W, H - ceil, 0.3, outC, T_STONE);
  for (const lx of [-2.6, 0, 2.6]) for (const lz of [-2.8, 0, 2.8]) box(lx, ceil - 0.02, lz, 1.2, 0.04, 0.3, C('#fffaf0'), T_GLOW(2.2));
  if (def.standalone) { box(0, H + 0.1, 0, W + 0.3, 0.2, D + 0.3, C('#5c5a57'), T_STONE); box(0, H + 0.55, hd + 0.05, W + 0.3, 0.9, 0.2, accent, T_PAINT); }
  // shop front: kick plates, mullions, header, door gap at lx in [2.2, 4.0]
  const doorX = 3.1, doorW = 1.8;
  const fz = hd - 0.05;
  for (const [x0, x1] of [[-hw, doorX - doorW / 2], [doorX + doorW / 2, hw]]) { box((x0 + x1) / 2, 0.25, fz, x1 - x0, 0.5, 0.12, C('#2a2a2a'), T_METAL); }
  box(0, 3.35, fz, W, 0.3, 0.14, C('#2a2a2a'), T_METAL);
  for (const mx of [-hw + 0.05, -1.6, doorX - doorW / 2 - 0.05, doorX + doorW / 2 + 0.05, hw - 0.05]) box(mx, 1.75, fz, 0.1, 3.4, 0.14, C('#2a2a2a'), T_METAL);
  col((-hw + doorX - doorW / 2) / 2, 1.7, fz, (doorX - doorW / 2 + hw) / 2, 1.7, 0.08);
  col((doorX + doorW / 2 + hw) / 2, 1.7, fz, (hw - doorX - doorW / 2) / 2, 1.7, 0.08);
  // awning + sign band
  box(0, 3.75, hd + 0.75, W, 0.05, 1.5, accent, T_FABRIC, 0.3);
  box(0, 3.5, hd + 1.48, W, 0.28, 0.03, accent, T_FABRIC);
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(W * 0.8, 0.62), signMat(def.name, def.color)); sign.position.set(0, 4.05, hd + 0.08); root.add(sign);
  // interior: counter, register, back shelf, aisles, fridges, per kind
  const counterZ = 1.2;
  const wood = C(def.kind === 'diner' ? '#b23a3a' : def.kind === 'pawn' ? '#1c1c1c' : '#6b4a32');
  box(-3.0, 0.52, counterZ, 4.0, 1.04, 0.7, wood, [0.5, 0.1, 0, 0]);
  box(-3.0, 1.06, counterZ, 4.1, 0.05, 0.8, C(def.kind === 'diner' ? '#d9d4ca' : '#2b2b2b'), [0.3, 0.2, 0, 0]);
  col(-3.0, 0.52, counterZ, 2.0, 0.52, 0.35);
  // register
  box(-2.6, 1.2, counterZ - 0.05, 0.45, 0.22, 0.4, C('#2f3133'), T_PLASTIC); box(-2.6, 1.42, counterZ - 0.12, 0.38, 0.25, 0.04, C('#7fe0a0'), T_GLOW(1.2), -0.3);
  box(-3.9, 1.25, counterZ, 0.3, 0.35, 0.3, C('#cfd2d4'), T_PLASTIC);
  // back wall behind the clerk: cigarette / lottery / liquor shelving
  const backZ = -0.9;
  const stocked = def.kind !== 'bank';
  if (stocked) box(-3.0, 1.6, backZ, 4.0, 2.4, 0.4, C('#5a4a3c'));
  if (stocked) for (let row = 0; row < 5; row++) for (let k = 0; k < 14; k++) { const pc = C(['#c0392b', '#f1c40f', '#ecf0f1', '#2980b9', '#27ae60', '#8e44ad', '#d35400'][r.int(0, 6)]); box(-4.85 + k * 0.28, 0.75 + row * 0.42, backZ + 0.24, 0.22, def.kind === 'liquor' ? 0.34 : 0.18, 0.08, pc, T_PLASTIC); }
  col(-3.0, 1.6, backZ, 2.0, 1.2, 0.2);
  if (def.kind === 'diner') {
    // booths along the right wall and stools at the counter
    for (let k = 0; k < 3; k++) { const z = -3.6 + k * 2.3; box(4.2, 0.75, z, 1.4, 0.06, 0.9, C('#d9d4ca'), [0.3, 0.1, 0, 0]); box(4.2, 0.37, z, 0.12, 0.74, 0.12, C('#888'), T_METAL); for (const dz of [-0.8, 0.8]) { box(4.2, 0.45, z + dz, 1.4, 0.45, 0.5, C('#a3242b'), [0.6, 0, 0, 0]); box(4.2, 0.95, z + dz * 1.2, 1.4, 0.8, 0.15, C('#a3242b'), [0.6, 0, 0, 0]); } col(4.2, 0.6, z, 0.7, 0.6, 1.2); }
    for (let k = 0; k < 4; k++) { const x = -4.6 + k * 1.0; t.cyl(x, 0, counterZ + 0.8, 0.05, 0.05, 0.7, 6, C('#999'), T_METAL); t.cyl(x, 0.7, counterZ + 0.8, 0.2, 0.2, 0.08, 10, C('#a3242b'), [0.6, 0, 0, 0]); }
    box(0.5, 1.8, -hd + 0.3, 4.5, 0.9, 0.1, C('#202020'), T_PLASTIC); box(0.5, 1.8, -hd + 0.36, 4.3, 0.7, 0.02, C('#ffe6b0'), T_GLOW(0.8));
  } else if (def.kind === 'pawn') {
    // glass jewelry cases and wall racks (guitars, TVs, tools)
    for (const [x, z, rot] of [[1.0, -0.5, 0], [3.4, -0.5, 0], [4.4, 2.2, 1]] as const) {
      const sx = rot ? 0.8 : 2.0, sz = rot ? 2.0 : 0.8;
      box(x, 0.45, z, sx, 0.9, sz, C('#1f1f1f'), T_METAL); box(x, 1.0, z, sx, 0.2, sz, C('#bfe3ea'), T_GLASS);
      for (let k = 0; k < 8; k++) box(x + (rot ? 0 : -0.8 + k * 0.22), 0.93, z + (rot ? -0.8 + k * 0.22 : 0), 0.08, 0.04, 0.08, C(k % 2 ? '#e9c46a' : '#dfe6ea'), [0.2, 1, 0, 0]);
      col(x, 0.55, z, sx / 2, 0.55, sz / 2);
    }
    for (let k = 0; k < 5; k++) { const x = -4.0 + k * 1.9; box(x, 2.1, -hd + 0.35, 1.2, 0.8, 0.1, C('#111'), T_PLASTIC); box(x, 2.1, -hd + 0.41, 1.05, 0.65, 0.02, C('#2b3a4a'), [0.1, 0.3, 0, 0]); }
    for (let k = 0; k < 4; k++) { const x = 1.5 + k * 0.6; box(x, 1.3, -hd + 0.3, 0.35, 1.0, 0.08, C(['#a0522d', '#d2691e', '#222', '#8b0000'][k]), [0.4, 0, 0, 0]); }
  } else if (def.kind === 'clothing') {
    // hanging rails, folded stacks on the wall, mirror and fitting room
    for (const ax of [0.6, 3.0]) {
      box(ax, 1.55, -0.6, 0.06, 0.06, 4.4, C('#bfc3c6'), T_METAL); box(ax, 0.8, -2.7, 0.06, 1.6, 0.06, C('#bfc3c6'), T_METAL); box(ax, 0.8, 1.5, 0.06, 1.6, 0.06, C('#bfc3c6'), T_METAL);
      for (let k = 0; k < 9; k++) box(ax, 1.05, -2.6 + k * 0.5, 0.5, 0.9, 0.14, C(['#c0392b', '#2c3e50', '#f1c40f', '#27ae60', '#ecf0f1', '#8e44ad', '#e67e22', '#1abc9c'][r.int(0, 7)]), T_FABRIC);
      col(ax, 0.8, -0.6, 0.3, 0.8, 2.2);
    }
    box(hw - 0.45, 1.0, -0.6, 0.5, 2.0, 6.0, C('#e2dfd8'), T_PAINT);
    for (let row = 0; row < 5; row++) for (let k = 0; k < 6; k++) box(hw - 0.62, 0.3 + row * 0.38, -3.2 + k * 0.95, 0.3, 0.22, 0.8, C(['#c0392b', '#2c3e50', '#f1c40f', '#ecf0f1', '#8e44ad', '#16a085'][r.int(0, 5)]), T_FABRIC);
    col(hw - 0.45, 1.0, -0.6, 0.25, 1.0, 3.0);
    box(-1.4, 1.5, -hd + 0.3, 1.6, 2.2, 0.05, C('#b9d3dc'), T_GLASS);
    box(-4.3, 1.15, -3.7, 1.5, 2.3, 1.5, C('#7a5c7a'), T_FABRIC); col(-4.3, 1.15, -3.7, 0.75, 1.15, 0.75);
  } else if (def.kind === 'electronics') {
    // display tables with screens and a TV wall
    for (const ax of [0.6, 3.0]) {
      box(ax, 0.5, -0.8, 1.0, 1.0, 4.4, C('#1b1e24'), T_METAL); col(ax, 0.5, -0.8, 0.5, 0.5, 2.2);
      for (let k = 0; k < 4; k++) { box(ax, 1.25, -2.4 + k * 1.1, 0.12, 0.55, 0.85, C('#0a0c10'), T_PLASTIC); box(ax + 0.07, 1.25, -2.4 + k * 1.1, 0.02, 0.48, 0.76, C(['#5fb4ff', '#ff8f5f', '#7fe0a0', '#c88fff'][k]), T_GLOW(1.1)); }
    }
    for (let k = 0; k < 4; k++) for (let row = 0; row < 2; row++) { const x = -4.2 + k * 1.9; box(x, 1.9 + row * 1.0, -hd + 0.32, 1.7, 0.9, 0.08, C('#0a0c10'), T_PLASTIC); box(x, 1.9 + row * 1.0, -hd + 0.37, 1.55, 0.78, 0.02, C(['#5fb4ff', '#ff6f6f', '#7fe0a0', '#f4d35e'][(k + row) % 4]), T_GLOW(1.0)); }
  } else if (def.kind === 'barber') {
    // two barber chairs facing a mirror wall, waiting bench, pole by the door
    for (const cx of [0.8, 3.0]) {
      t.cyl(cx, 0, -2.6, 0.35, 0.3, 0.5, 10, C('#222'), T_METAL); box(cx, 0.75, -2.6, 0.8, 0.22, 0.8, C('#8c1c22'), T_FABRIC); box(cx, 1.15, -3.0, 0.8, 0.9, 0.18, C('#8c1c22'), T_FABRIC);
      box(cx, 1.6, -hd + 0.28, 1.5, 1.6, 0.05, C('#b9d3dc'), T_GLASS); col(cx, 0.8, -2.6, 0.45, 0.8, 0.45);
    }
    box(4.4, 0.35, 1.8, 0.7, 0.7, 2.2, C('#3a3a3a'), T_FABRIC); col(4.4, 0.35, 1.8, 0.35, 0.35, 1.1);
    for (let k = 0; k < 6; k++) t.cyl(-4.8 + k * 0.28, 1.07, counterZ + 0.1, 0.06, 0.05, 0.3, 8, C(['#2c7fb8', '#e67e22', '#27ae60'][k % 3]), T_PLASTIC);
    for (let k = 0; k < 8; k++) t.cyl(-hw + 0.18, 0.2 + k * 0.45, -4.0, 0.14, 0.14, 0.4, 10, C(k % 2 ? '#c0392b' : '#f4f4f4'), T_PLASTIC);
  } else if (def.kind === 'bank') {
    // teller line behind glass, vault door at the back, rope queue, ATM
    box(-3.0, 1.95, counterZ, 4.0, 1.7, 0.05, C('#bfe3ea'), T_GLASS);
    { const vx = -3.0, vz = backZ - 0.2; t.cyl(vx, 1.5, vz, 1.3, 1.3, 0.35, 24, C('#7d868c'), T_METAL, 0, Math.PI / 2, 0); t.cyl(vx, 1.5, vz + 0.2, 0.9, 0.9, 0.15, 20, C('#9aa3a8'), T_METAL, 0, Math.PI / 2, 0); for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; t.cyl(vx, 1.5, vz + 0.3, 0.05, 0.05, 0.1, 6, C('#444'), T_METAL, 0, Math.PI / 2, 0); box(vx + Math.cos(a) * 0.45, 1.5 + Math.sin(a) * 0.45, vz + 0.36, 0.1, 0.1, 0.1, C('#d4af37'), T_METAL); } }
    box(-3.0, 1.2, backZ - 0.1, 3.4, 2.6, 0.5, C('#4a5156'), T_METAL); col(-3.0, 1.3, backZ - 0.1, 1.7, 1.3, 0.25);
    for (let k = 0; k < 4; k++) { const z = 3.4 - k * 0.9; box(0.4, 0.5, z, 0.08, 1.0, 0.08, C('#d4af37'), T_METAL); box(1.8, 0.5, z, 0.08, 1.0, 0.08, C('#d4af37'), T_METAL); box(1.1, 0.8, z, 1.4, 0.04, 0.03, C('#7a1f2b'), T_FABRIC); }
    box(4.4, 1.0, -2.5, 0.8, 2.0, 0.8, C('#2f3a46'), T_METAL); box(4.4, 1.4, -2.09, 0.6, 0.4, 0.02, C('#a8e0ff'), T_GLOW(0.8)); col(4.4, 1.0, -2.5, 0.4, 1.0, 0.4);
    box(2.8, 0.45, -3.4, 2.2, 0.9, 1.0, C('#5a4a3c'), T_ROUGH); col(2.8, 0.45, -3.4, 1.1, 0.45, 0.5);
  } else {
    // aisles of shelving with products
    for (const ax of [0.6, 3.0]) {
      box(ax, 0.8, -0.6, 0.9, 1.6, 4.6, C('#d9dcdf'), T_METAL);
      col(ax, 0.8, -0.6, 0.45, 0.8, 2.3);
      for (const side of [-1, 1]) for (let row = 0; row < 4; row++) for (let k = 0; k < 16; k++) {
        const pc = C(['#e74c3c', '#f39c12', '#f1c40f', '#3498db', '#2ecc71', '#9b59b6', '#ecf0f1', '#e67e22', '#1abc9c'][r.int(0, 8)]);
        const h = r.range(0.16, 0.3);
        box(ax + side * 0.47, 0.22 + row * 0.38 + h / 2, -2.75 + k * 0.28, 0.06, h, 0.22, pc, T_PLASTIC);
      }
      box(ax, 1.75, 1.8, 0.95, 0.25, 0.05, accent, T_PAINT);
    }
    // wall shelving on the right wall
    box(hw - 0.45, 1.1, -0.6, 0.5, 2.2, 6.0, C('#d9dcdf'), T_METAL);
    for (let row = 0; row < 5; row++) for (let k = 0; k < 20; k++) box(hw - 0.72, 0.3 + row * 0.42, -3.4 + k * 0.28, 0.06, r.range(0.18, 0.3), 0.22, C(['#c0392b', '#f1c40f', '#2980b9', '#27ae60', '#ecf0f1', '#8e44ad'][r.int(0, 5)]), T_PLASTIC);
    col(hw - 0.45, 1.1, -0.6, 0.25, 1.1, 3.0);
  }
  // fridges along the back wall with lit glass doors
  if (def.kind === 'convenience' || def.kind === 'liquor' || def.kind === 'gas' || def.kind === 'diner') {
    const fx0 = def.kind === 'diner' ? -1.6 : -1.2, n = def.kind === 'diner' ? 2 : 5;
    for (let k = 0; k < n; k++) {
      const x = fx0 + k * 1.2;
      box(x, 1.1, -hd + 0.6, 1.15, 2.2, 0.9, C('#e8e8e8'), T_METAL);
      box(x, 1.15, -hd + 1.06, 1.0, 1.9, 0.02, C('#e8f4ff'), T_GLOW(0.55));
      for (let row = 0; row < 5; row++) for (let b = 0; b < 6; b++) t.cyl(x - 0.4 + b * 0.16, 0.3 + row * 0.38, -hd + 0.95, 0.05, 0.03, 0.26, 6, C(['#c0392b', '#27ae60', '#f39c12', '#2c3e50', '#16a085'][r.int(0, 4)]), T_PLASTIC);
      box(x + 0.45, 1.2, -hd + 1.09, 0.04, 0.5, 0.05, C('#bbb'), T_METAL);
    }
    col(0, 1.1, -hd + 0.6, hw - 0.3, 1.1, 0.45);
  }
  // posters, mat, ATM / lottery stand / ice chest
  box(-1.4, 2.2, -hd + 0.26, 1.0, 0.7, 0.02, accent, T_PAINT);
  box(doorX, 0.015, hd - 1.0, 1.8, 0.03, 1.2, C('#2b2b2b'), [0.95, 0, 0, 0]);
  if (def.kind === 'pharmacy') { box(0, 3.0, -hd + 0.3, 1.4, 0.4, 0.05, C('#1d8f6a'), T_GLOW(1.4)); box(0, 3.0, -hd + 0.3, 0.4, 1.4, 0.05, C('#1d8f6a'), T_GLOW(1.4)); }
  if (def.kind === 'barber') { t.cyl(-4.6, 0.6, hd + 0.35, 0.12, 0.12, 2.0, 10, C('#f4f4f4'), T_PLASTIC); for (let k = 0; k < 5; k++) t.cyl(-4.6, 0.7 + k * 0.38, hd + 0.35, 0.125, 0.125, 0.14, 10, C('#c0392b'), T_PLASTIC); }
  if (def.kind === 'gas' || def.kind === 'convenience') { box(-0.6, 0.85, hd - 1.0, 0.7, 1.7, 0.6, C('#1d4f8c'), T_PLASTIC); box(-0.6, 1.25, hd - 0.69, 0.5, 0.35, 0.02, C('#a8e0ff'), T_GLOW(0.6)); col(-0.6, 0.85, hd - 1.0, 0.35, 0.85, 0.3); }
  const mesh = new THREE.Mesh(t.build(), trimMat); mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.4, D - 0.3).rotateX(-Math.PI / 2), floorTiles());
  (floor.material as THREE.MeshStandardMaterial).map!.repeat.set(1, 1);
  const fuv = floor.geometry.attributes.uv; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) * (W - 0.4) / 2.4, fuv.getY(i) * (D - 0.3) / 2.4);
  floor.position.y = 0.02; floor.receiveShadow = true; root.add(floor);
  // glazing
  const glass = new THREE.Group(); const paneMeshes: THREE.Mesh[] = [];
  for (const [x0, x1] of [[-hw + 0.1, doorX - doorW / 2 - 0.1], [doorX + doorW / 2 + 0.1, hw - 0.1]]) { const g = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, 2.7), glassMat); g.position.set((x0 + x1) / 2, 1.85, fz); glass.add(g); paneMeshes.push(g); }
  root.add(glass);
  // sliding door leaves (glass with frames)
  const doors: THREE.Object3D[] = [];
  for (const sx of [-1, 1]) {
    const leaf = new THREE.Group();
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(doorW / 2, 2.9), glassMat); pane.position.y = 1.45; leaf.add(pane); paneMeshes.push(pane);
    const fr = new TrimBuilder();
    fr.box(0, 1.45, 0, doorW / 2, 2.9, 0.04, 0, C('#3a3a3a'), T_METAL);
    const frGeo = fr.build();
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(frGeo), new THREE.LineBasicMaterial({ color: '#2a2a2a' })); leaf.add(frame);
    leaf.position.set(doorX + sx * doorW / 4, 0, fz + 0.04); leaf.userData.closedX = doorX + sx * doorW / 4; leaf.userData.dir = sx;
    root.add(leaf); doors.push(leaf);
  }
  { // register every shopfront pane as breakable world glass (panes are shot where they currently are)
    root.updateMatrixWorld(true);
    for (const m of paneMeshes) {
      const wp = new THREE.Vector3(); m.getWorldPosition(wp); const par = (m.geometry as THREE.PlaneGeometry).parameters as { width: number; height: number };
      const id = worldGlass.add(wp.x, wp.y, wp.z, def.yaw, par.width, par.height, m);
      m.userData.paneId = id;
    }
  }
  // roll-down shutter over the whole front, hidden until the store closes
  const sh = new TrimBuilder();
  for (let k = 0; k < 34; k++) sh.box(0, 0.05 + k * 0.1, 0, W, 0.09, 0.05, 0, C(k % 2 ? '#8f969b' : '#80878c'), [0.45, 0.7, 0, 0]);
  sh.box(0, 3.45, 0.05, W + 0.2, 0.3, 0.3, 0, C('#5d6266'), T_METAL);
  const shutter = new THREE.Mesh(sh.build(), trimMat); shutter.position.set(0, 0, hd + 0.08); shutter.visible = false; shutter.castShadow = true; root.add(shutter);
  const gapCol = col(doorX, 1.7, fz, doorW / 2, 1.7, 0.08); gapCol.setEnabled(false);
  // alarm beacon over the door
  const alarm = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: '#ff2a1a', toneMapped: false }));
  alarm.position.set(doorX, 3.2, hd - 0.3); alarm.visible = false; root.add(alarm);
  const toLocal = (p: THREE.Vector3) => p.clone().sub(root.position).applyAxisAngle(new THREE.Vector3(0, 1, 0), -def.yaw);
  return {
    root, shutter, doors, alarm, toWorld: toW, toLocal, counterZ,
    setClosed: (closed: boolean) => { shutter.visible = closed; gapCol.setEnabled(closed); },
    setDoor: (open: number) => { for (const d of doors) d.position.x = d.userData.closedX + d.userData.dir * open * (doorW / 2 - 0.05); },
    clerk: toW(-3.0, 0.05, 0.25), customer: toW(-3.0, 0.05, 3.0), bag: toW(-3.0, 0.35, counterZ + 1.0), light: toW(0, 3.2, 0),
  };
}
