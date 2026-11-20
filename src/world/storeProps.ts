/**
 * Shared bits for the walk-in store interiors: a procedural product atlas (bags, boxes, cans, bottles, liquor, tickets, ...),
 * a builder that merges textured products into one mesh, and per-kind floor textures. All brands are invented.
 */
import * as THREE from 'three';

export type Shape = 'box' | 'cyl';
interface CellDef { shape: Shape; bg: string; ac: string; label: string; style: 'bag' | 'box' | 'can' | 'bottle' | 'wine' | 'tin' | 'carton' | 'ticket' | 'ring' | 'velvet' | 'jar' | 'cup'; dim: [number, number, number]; }
const COLS = 8, ROWS = 4, CELL = 128;
const bag = (bg: string, ac: string, label: string): CellDef => ({ shape: 'box', bg, ac, label, style: 'bag', dim: [0.22, 0.3, 0.07] });
const box = (bg: string, ac: string, label: string): CellDef => ({ shape: 'box', bg, ac, label, style: 'box', dim: [0.2, 0.3, 0.08] });
const can = (bg: string, ac: string, label: string): CellDef => ({ shape: 'cyl', bg, ac, label, style: 'can', dim: [0.034, 0.12, 0.034] });
const btl = (bg: string, ac: string, label: string, h = 0.26): CellDef => ({ shape: 'cyl', bg, ac, label, style: 'bottle', dim: [0.04, h, 0.04] });
const wine = (bg: string, ac: string, label: string): CellDef => ({ shape: 'cyl', bg, ac, label, style: 'wine', dim: [0.04, 0.31, 0.04] });
export const CELLS: CellDef[] = [
  bag('#d83a2e', '#ffd23f', 'CRUNCH'), bag('#f2b705', '#c0392b', 'SALT&'), bag('#2f6fbf', '#e9f1ff', 'WAVES'), bag('#2f9e5a', '#f6e27a', 'KALE-O'), bag('#e8742a', '#fff1d6', 'FIRE'), bag('#7a3fa8', '#ffd1f5', 'GRAPE'), box('#f0c34a', '#d9482b', 'OATY'), box('#3a86d1', '#ffffff', 'FROSTO'),
  box('#e04f7a', '#ffe9a8', 'POPPS'), box('#4aa36b', '#ffffff', 'BRAN'), can('#c8372f', '#ffffff', 'COLA'), can('#2f8f4f', '#e8ffd8', 'LIMEY'), can('#e8a21a', '#3b2300', 'ORANGE'), can('#3a4a9e', '#d7e2ff', 'VOLT'), btl('#4a2a1a', '#d83a2e', 'COLA'), btl('#9fd8f0', '#2f6fbf', 'SPRING'),
  btl('#f0a21a', '#ffffff', 'JUICE'), btl('#1f2a33', '#37d6ff', 'RUSH'), btl('#b56a1c', '#f3e3b8', 'RYE', 0.3), btl('#d9e8ee', '#1f4fa8', 'POLAR', 0.32), wine('#1d3a22', '#d6b25e', 'MERLOT'), wine('#b9c96a', '#f6f1dc', 'BLANC'),
  { shape: 'box', bg: '#d8d0c0', ac: '#9a1f2b', label: 'HAWTHORN', style: 'carton', dim: [0.2, 0.11, 0.06] },
  { shape: 'box', bg: '#2f2f6f', ac: '#ffd23f', label: 'SCRATCH', style: 'ticket', dim: [0.11, 0.17, 0.01] },
  bag('#f4f0e6', '#2a2a2a', 'MINTS'), bag('#8b4a2b', '#f6d9a8', 'JERKY'), { shape: 'cyl', bg: '#f2c400', ac: '#222222', label: '10W-30', style: 'jar', dim: [0.05, 0.22, 0.05] }, { shape: 'cyl', bg: '#b9bcc0', ac: '#c0392b', label: 'SOUP', style: 'tin', dim: [0.042, 0.1, 0.042] },
  { shape: 'box', bg: '#f1e6c9', ac: '#8b5a2b', label: 'LOAF', style: 'bag', dim: [0.26, 0.2, 0.1] }, { shape: 'box', bg: '#241a1f', ac: '#d4af37', label: '', style: 'ring', dim: [0.1, 0.07, 0.1] }, { shape: 'box', bg: '#142a52', ac: '#d4af37', label: '', style: 'velvet', dim: [0.2, 0.01, 0.12] }, { shape: 'cyl', bg: '#ffffff', ac: '#8b5a2b', label: 'COFFEE', style: 'cup', dim: [0.04, 0.1, 0.04] },
];
export const C_BAGS = [0, 1, 2, 3, 4, 5, 24, 25], C_BOXES = [6, 7, 8, 9], C_CANS = [10, 11, 12, 13], C_SOFT = [14, 15, 16, 17], C_LIQ = [18, 19, 20, 21], C_CARTON = 22, C_TICKET = 23, C_OIL = 26, C_TIN = 27, C_LOAF = 28, C_RING = 29, C_VELVET = 30, C_CUP = 31;
export const C_SNACK = [...C_BAGS, ...C_BOXES, 6, 7];
export const C_DRINK = [...C_CANS, ...C_SOFT];

let atlas: THREE.CanvasTexture | null = null;
function drawCell(g: CanvasRenderingContext2D, d: CellDef) {
  const W = CELL;
  g.fillStyle = d.bg; g.fillRect(0, 0, W, W);
  g.textAlign = 'center'; g.textBaseline = 'middle';
  const txt = (s: string, y: number, size: number, col: string) => { g.fillStyle = col; g.font = `900 ${size}px Arial, sans-serif`; g.fillText(s, W / 2, y, W - 16); };
  switch (d.style) {
    case 'bag': {
      g.fillStyle = 'rgba(255,255,255,0.35)'; for (let k = 0; k < 16; k++) { g.fillRect(k * 8, 0, 4, 12); g.fillRect(k * 8 + 4, W - 12, 4, 12); }
      g.fillStyle = d.ac; g.beginPath(); g.ellipse(W / 2, 64, 46, 36, -0.15, 0, 7); g.fill();
      g.fillStyle = d.bg; g.beginPath(); g.ellipse(W / 2 + 6, 58, 40, 28, -0.15, 0, 7); g.globalAlpha = 0.25; g.fill(); g.globalAlpha = 1;
      txt(d.label, 62, 24, d.bg); g.fillStyle = d.ac; g.fillRect(14, 102, 100, 6); break;
    }
    case 'box': {
      const gr = g.createLinearGradient(0, 0, 0, W); gr.addColorStop(0, d.bg); gr.addColorStop(1, 'rgba(0,0,0,0.35)'); g.fillStyle = gr; g.fillRect(0, 0, W, W);
      g.fillStyle = d.ac; g.beginPath(); g.moveTo(0, 90); g.lineTo(W, 50); g.lineTo(W, 84); g.lineTo(0, 124); g.fill();
      g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 34, 20, 0, 7); g.fill(); g.fillStyle = d.ac; g.beginPath(); g.arc(64, 34, 12, 0, 7); g.fill();
      txt(d.label, 76, 22, '#ffffff'); break;
    }
    case 'can': {
      const gr = g.createLinearGradient(0, 0, W, 0); gr.addColorStop(0, 'rgba(0,0,0,0.4)'); gr.addColorStop(0.35, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(0,0,0,0.45)'); g.fillStyle = gr; g.fillRect(0, 0, W, W);
      g.fillStyle = '#c9ccd0'; g.fillRect(0, 0, W, 12); g.fillRect(0, W - 10, W, 10); g.fillStyle = d.ac; g.fillRect(0, 56, W, 10); txt(d.label, 90, 30, d.ac); break;
    }
    case 'bottle': {
      g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 0, W, 30); g.fillStyle = d.ac; g.fillRect(0, 0, W, 16);
      g.fillStyle = '#f5efe0'; g.fillRect(8, 48, W - 16, 56); g.fillStyle = d.ac; g.fillRect(8, 48, W - 16, 8); txt(d.label, 82, 24, '#222'); break;
    }
    case 'wine': {
      g.fillStyle = '#0d1a10'; g.fillRect(0, 0, W, 34); g.fillStyle = d.ac; g.fillRect(0, 26, W, 6);
      g.fillStyle = '#efe6cf'; g.fillRect(14, 54, W - 28, 52); g.strokeStyle = d.ac; g.lineWidth = 3; g.strokeRect(18, 58, W - 36, 44); txt(d.label, 82, 18, '#333'); break;
    }
    case 'tin': { g.fillStyle = '#eee'; g.fillRect(0, 0, W, 14); g.fillStyle = d.ac; g.fillRect(0, 22, W, 84); txt(d.label, 64, 28, '#fff'); break; }
    case 'jar': { g.fillStyle = '#111'; g.fillRect(0, 0, W, 30); g.fillStyle = d.ac; g.fillRect(0, 54, W, 8); txt(d.label, 90, 26, '#222'); break; }
    case 'carton': { g.fillStyle = d.ac; g.fillRect(0, 0, W, 50); g.fillStyle = '#fff'; g.fillRect(0, 50, W, 78); txt(d.label, 26, 20, '#fff'); g.fillStyle = d.ac; g.fillRect(40, 70, 48, 34); break; }
    case 'ticket': { for (let k = 0; k < 6; k++) { g.fillStyle = ['#ffd23f', '#ff5a5f', '#37d6a0', '#6ab0ff', '#ff9f1c', '#c77dff'][k]; g.fillRect(0, k * 21, W, 21); } g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(20, 20, 88, 88); txt(d.label, 64, 20, '#fff'); break; }
    case 'ring': { g.fillStyle = '#35202a'; g.fillRect(0, 0, W, W); g.fillStyle = d.ac; g.beginPath(); g.arc(64, 70, 22, 0, 7); g.lineWidth = 8; g.strokeStyle = d.ac; g.stroke(); g.fillStyle = '#bfefff'; g.beginPath(); g.moveTo(64, 34); g.lineTo(78, 46); g.lineTo(64, 56); g.lineTo(50, 46); g.fill(); break; }
    case 'velvet': { g.fillStyle = d.bg; g.fillRect(0, 0, W, W); g.strokeStyle = d.ac; g.lineWidth = 4; g.strokeRect(6, 6, W - 12, W - 12); break; }
    case 'cup': { g.fillStyle = '#fff'; g.fillRect(0, 0, W, W); g.fillStyle = d.ac; g.fillRect(0, 40, W, 50); txt(d.label, 66, 20, '#fff'); break; }
  }
}
export function productAtlas(): THREE.CanvasTexture {
  if (atlas) return atlas;
  const c = document.createElement('canvas'); c.width = COLS * CELL; c.height = ROWS * CELL; const g = c.getContext('2d')!;
  CELLS.forEach((d, i) => { g.save(); g.translate((i % COLS) * CELL, Math.floor(i / COLS) * CELL); g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip(); drawCell(g, d); g.restore(); });
  atlas = new THREE.CanvasTexture(c); atlas.colorSpace = THREE.SRGBColorSpace; atlas.anisotropy = 4; atlas.generateMipmaps = true; atlas.minFilter = THREE.LinearMipmapLinearFilter;
  return atlas;
}
let prodMat: THREE.MeshStandardMaterial | null = null;
export function productMaterial() { return prodMat ??= new THREE.MeshStandardMaterial({ map: productAtlas(), roughness: 0.55, metalness: 0.05 }); }

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3(), _nm = new THREE.Matrix3(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
let boxT: THREE.BufferGeometry | null = null, cylT: THREE.BufferGeometry | null = null;
/** Merges textured products (each takes one atlas cell) into a single mesh geometry. */
export class ProdBuilder {
  pos: number[] = []; nor: number[] = []; uv: number[] = [];
  get count() { return this.pos.length / 3; }
  private put(g: THREE.BufferGeometry, m: THREE.Matrix4, cell: number) {
    const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv, cx = cell % COLS, cy = Math.floor(cell / COLS), ins = 0.012;
    _nm.getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) {
      _v.fromBufferAttribute(p, i).applyMatrix4(m); _w.fromBufferAttribute(n, i).applyMatrix3(_nm).normalize();
      this.pos.push(_v.x, _v.y, _v.z); this.nor.push(_w.x, _w.y, _w.z);
      const u = ins + uv.getX(i) * (1 - 2 * ins), v = ins + uv.getY(i) * (1 - 2 * ins);
      this.uv.push((cx + u) / COLS, 1 - (cy + 1) / ROWS + v / ROWS);
    }
  }
  /** One product with its base centre at (x, y, z), its front facing yaw (0 = +z). Size comes from the cell unless scaled. */
  item(cell: number, x: number, y: number, z: number, yaw = 0, k = 1) {
    const d = CELLS[cell];
    _q.setFromEuler(_e.set(0, yaw + (d.shape === 'cyl' ? Math.PI : 0), 0)); // a cylinder's label sits at u = 0.5, which faces -z
    if (d.shape === 'box') {
      boxT ??= new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
      _m.compose(_p.set(x, y + d.dim[1] * k / 2, z), _q, _s.set(d.dim[0] * k, d.dim[1] * k, d.dim[2] * k));
      this.put(boxT, _m, cell);
    } else {
      cylT ??= new THREE.CylinderGeometry(1, 1, 1, 10, 1).translate(0, 0.5, 0).toNonIndexed();
      _m.compose(_p.set(x, y, z), _q, _s.set(d.dim[0] * k, d.dim[1] * k, d.dim[2] * k));
      this.put(cylT, _m, cell);
    }
  }
  /** A free-size box with the cell texture (display pads, cartons...). */
  slab(cell: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0) {
    boxT ??= new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    _q.setFromEuler(_e.set(0, yaw, 0)); _m.compose(_p.set(x, y, z), _q, _s.set(sx, sy, sz)); this.put(boxT, _m, cell);
  }
  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeBoundingSphere(); this.pos = []; this.nor = []; this.uv = [];
    return g;
  }
}

// ---- floors ----
export type FloorKind = 'vinyl' | 'wood' | 'marble' | 'concrete' | 'checker' | 'darkwood' | 'carpet';
const floorCache = new Map<string, THREE.MeshStandardMaterial>();
export function floorMaterial(kind: FloorKind, a: string, b: string): THREE.MeshStandardMaterial {
  const key = `${kind}${a}${b}`; let m = floorCache.get(key); if (m) return m;
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d')!;
  let s = 99; const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  let rough = 0.3;
  if (kind === 'vinyl' || kind === 'checker') {
    const n = kind === 'checker' ? 4 : 2, w = 256 / n;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { g.fillStyle = (x + y) % 2 ? a : b; g.fillRect(x * w, y * w, w, w); }
    g.strokeStyle = 'rgba(70,70,70,0.35)'; g.lineWidth = 1.5; for (let k = 0; k <= n; k++) { g.beginPath(); g.moveTo(k * w, 0); g.lineTo(k * w, 256); g.stroke(); g.beginPath(); g.moveTo(0, k * w); g.lineTo(256, k * w); g.stroke(); }
    for (let k = 0; k < 260; k++) { g.fillStyle = `rgba(40,30,20,${0.02 + rnd() * 0.05})`; g.fillRect(rnd() * 256, rnd() * 256, 3 + rnd() * 16, 2 + rnd() * 5); }
    rough = 0.28;
  } else if (kind === 'wood' || kind === 'darkwood') {
    const pw = 32; for (let i = 0; i < 8; i++) { const off = rnd() * 256; for (let j = 0; j < 3; j++) { const sh = (rnd() - 0.5) * 22; g.fillStyle = shade(i % 2 ? a : b, sh); const x0 = off % 256; g.fillRect(0, i * pw, 256, pw - 1); void x0; g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect((off + j * 90) % 256, i * pw, 1.5, pw); } for (let k = 0; k < 30; k++) { g.strokeStyle = `rgba(0,0,0,${0.03 + rnd() * 0.06})`; g.beginPath(); g.moveTo(rnd() * 256, i * pw + rnd() * pw); g.lineTo(rnd() * 256, i * pw + rnd() * pw); g.stroke(); } g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, i * pw + pw - 1.5, 256, 1.5); }
    rough = kind === 'wood' ? 0.45 : 0.35;
  } else if (kind === 'marble') {
    g.fillStyle = a; g.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) { g.fillStyle = shade((x + y) % 2 ? a : b, (rnd() - 0.5) * 10); g.fillRect(x * 128, y * 128, 128, 128); for (let k = 0; k < 9; k++) { g.strokeStyle = `rgba(90,90,100,${0.08 + rnd() * 0.12})`; g.lineWidth = 0.7 + rnd(); g.beginPath(); let px = x * 128 + rnd() * 128, py = y * 128 + rnd() * 128; g.moveTo(px, py); for (let j = 0; j < 4; j++) { px += (rnd() - 0.3) * 30; py += (rnd() - 0.5) * 30; g.lineTo(Math.min(x * 128 + 128, Math.max(x * 128, px)), Math.min(y * 128 + 128, Math.max(y * 128, py))); } g.stroke(); } }
    g.strokeStyle = 'rgba(40,40,40,0.5)'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256); g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke(); rough = 0.12;
  } else if (kind === 'carpet') {
    g.fillStyle = a; g.fillRect(0, 0, 256, 256); for (let k = 0; k < 4000; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${rnd() * 0.07})`; g.fillRect(rnd() * 256, rnd() * 256, 2, 2); } rough = 0.95;
  } else { // concrete tile
    g.fillStyle = a; g.fillRect(0, 0, 256, 256); for (let k = 0; k < 900; k++) { g.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${rnd() * 0.06})`; g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 10, 2 + rnd() * 6); }
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 2; g.strokeRect(0, 0, 256, 256); g.beginPath(); g.moveTo(128, 0); g.lineTo(128, 256); g.moveTo(0, 128); g.lineTo(256, 128); g.stroke();
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(20,20,20,0.12)'; g.beginPath(); g.ellipse(rnd() * 256, rnd() * 256, 10 + rnd() * 30, 5 + rnd() * 10, rnd() * 3, 0, 7); g.fill(); } rough = 0.5;
  }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  m = new THREE.MeshStandardMaterial({ map: t, roughness: rough, metalness: kind === 'marble' ? 0.1 : 0 });
  floorCache.set(key, m); return m;
}
function shade(hex: string, d: number): string {
  const c = new THREE.Color(hex); c.r = Math.min(1, Math.max(0, c.r + d / 255)); c.g = Math.min(1, Math.max(0, c.g + d / 255)); c.b = Math.min(1, Math.max(0, c.b + d / 255)); return '#' + c.getHexString();
}

/** Bright neon-style sign texture (OPEN, WE BUY GOLD...). */
const neonCache = new Map<string, THREE.MeshBasicMaterial>();
export function neonMaterial(text: string, col: string, bg = '#10101a'): THREE.MeshBasicMaterial {
  const key = text + col; let m = neonCache.get(key); if (m) return m;
  const c = document.createElement('canvas'); c.width = 256; c.height = 96; const g = c.getContext('2d')!;
  g.fillStyle = bg; g.fillRect(0, 0, 256, 96); g.strokeStyle = col; g.lineWidth = 4; g.shadowColor = col; g.shadowBlur = 14; g.strokeRect(6, 6, 244, 84);
  g.fillStyle = col; g.font = '900 38px Arial, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 128, 50, 220);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  m = new THREE.MeshBasicMaterial({ map: t, toneMapped: false }); neonCache.set(key, m); return m;
}
