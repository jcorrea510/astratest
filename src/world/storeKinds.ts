/**
 * Distinct interior layouts per store kind (store-local metres: +z = street side, door at x = 3.1, counter at x = -3, z = 1.2).
 * The shopping strip (x -4.4..2.1, z 2..4) and the door lane stay empty in every kind: shoppers walk there.
 */
import * as THREE from 'three';
import type { Rng } from '../core/rng';
import type { Store } from '../game/places';
import { TrimBuilder, T_PAINT, T_METAL, T_PLASTIC, T_GLASS, T_GLOW, T_FABRIC, T_STONE, T_ROUGH, type TrimParams } from './builders';
import { ProdBuilder, CELLS, C_BAGS, C_BOXES, C_CANS, C_SOFT, C_LIQ, C_CARTON, C_TICKET, C_OIL, C_TIN, C_LOAF, C_RING, C_VELVET, C_SNACK, C_DRINK, C_CUP, neonMaterial } from './storeProps';

const KC = new Map<string, THREE.Color>();
export const K = (h: string | THREE.Color) => typeof h !== 'string' ? h : (KC.get(h) ?? (KC.set(h, new THREE.Color(h)), KC.get(h)!));

export interface SmashCase { lx: number; ly: number; lz: number; w: number; d: number; yaw: number; value: number; glass: THREE.Mesh; loot: THREE.Mesh | null; broken: boolean }
export interface VaultParts { door: THREE.Group; lx: number; lz: number; cashLx: number; cashLz: number; colliders: { setEnabled(on: boolean): void }[]; cash: THREE.Group; rig: THREE.Group; openA: number }
export interface Extras { cases: SmashCase[]; vault: VaultParts | null; tellers: { x: number; z: number }[] }
export interface Ctx {
  def: Store; r: Rng; accent: THREE.Color; W: number; D: number; H: number; hw: number; hd: number; ceil: number; counterZ: number; backZ: number; doorX: number;
  t: TrimBuilder; p: ProdBuilder; root: THREE.Group; extras: Extras;
  box(x: number, y: number, z: number, sx: number, sy: number, sz: number, col: string | THREE.Color, tp?: TrimParams, pitch?: number): void;
  col(x: number, y: number, z: number, hx: number, hy: number, hz: number): { setEnabled(on: boolean): void };
  glassMat: THREE.Material; trimMat: THREE.Material;
}
const pick = <T,>(c: Ctx, a: T[]) => a[c.r.int(0, a.length - 1)];

/** A run of products along a line: same item in blocks of a few, like a stocked shelf. */
function row(c: Ctx, x0: number, z0: number, ux: number, uz: number, len: number, y: number, pool: number[], yaw: number, block = 4, gap = 0.012) {
  let s = 0, cell = pick(c, pool), n = 0;
  for (let guard = 0; guard < 80; guard++) {
    const d = CELLS[cell], w = d.shape === 'box' ? d.dim[0] : d.dim[0] * 2;
    if (s + w > len) break;
    const k = 0.96 + c.r.next() * 0.08;
    c.p.item(cell, x0 + ux * (s + w / 2), y, z0 + uz * (s + w / 2), yaw + (c.r.next() - 0.5) * 0.1, k);
    s += w * k + gap; if (++n % block === 0 || c.r.next() < 0.05) cell = pick(c, pool);
  }
}
/** Shelving face: boards with products, centred on (cx,cz), facing (nx,nz), `len` long, items sit `off` in front of the centre line. */
function face(c: Ctx, cx: number, cz: number, nx: number, nz: number, len: number, ys: number[], pools: number[][], off: number, boardCol: string | THREE.Color = '#cfd3d6') {
  const tx = nz, tz = -nx, yaw = Math.atan2(nx, nz);
  ys.forEach((y, i) => {
    c.box(cx + nx * off * 0.8, y - 0.012, cz + nz * off * 0.8, Math.abs(tx) > 0.5 ? len : 0.34, 0.025, Math.abs(tz) > 0.5 ? len : 0.34, boardCol, T_METAL);
    row(c, cx + nx * off - tx * len / 2, cz + nz * off - tz * len / 2, tx, tz, len - 0.04, y, pools[i % pools.length], yaw);
  });
}
/** Back-to-back gondola along z at x. */
function gondola(c: Ctx, x: number, z: number, len: number, a: number[][], b: number[][], h = 1.55, cap?: string) {
  c.box(x, h / 2, z, 0.12, h, len, '#c9ced2', T_METAL); c.box(x, 0.06, z, 0.86, 0.12, len, '#8a9096', T_METAL);
  const ys = [0.2, 0.62, 1.04, 1.44].filter(y => y < h - 0.05);
  face(c, x, z, 1, 0, len, ys, a, 0.3); face(c, x, z, -1, 0, len, ys, b, 0.3);
  c.box(x, h + 0.03, z, 0.55, 0.06, len + 0.05, cap ?? c.accent, T_PAINT);
  c.col(x, h / 2, z, 0.45, h / 2, len / 2);
}
/** Wall shelving unit against a wall. */
function wallUnit(c: Ctx, cx: number, cz: number, nx: number, nz: number, len: number, h: number, ys: number[], pools: number[][], body: string | THREE.Color = '#5a4a3c', depth = 0.42) {
  const sx = Math.abs(nx) > 0.5 ? depth : len, sz = Math.abs(nx) > 0.5 ? len : depth;
  c.box(cx, h / 2, cz, sx, h, sz, body, T_PAINT);
  face(c, cx, cz, nx, nz, len - 0.1, ys, pools, depth / 2 + 0.2, '#b9a98f');
  c.col(cx, h / 2, cz, sx / 2, h / 2, sz / 2);
}
function neonPlane(c: Ctx, text: string, color: string, x: number, y: number, z: number, w: number, yaw = 0, h = w * 0.375) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), neonMaterial(text, color)); m.position.set(x, y, z); m.rotation.y = yaw; c.root.add(m);
}
function camera(c: Ctx, x: number, z: number) { c.t.sphere(x, c.ceil - 0.08, z, 0.1, K('#15171a'), T_PLASTIC, 0.7); c.t.sphere(x, c.ceil - 0.12, z + 0.04, 0.03, K('#ff3030'), T_GLOW(1.5)); }

/** Lit glass-door cooler wall: cabinet, glowing glass doors, drinks behind the glass. */
function fridges(c: Ctx, x0: number, n: number, z: number, pools: number[][], doorW = 1.1) {
  for (let k = 0; k < n; k++) {
    const x = x0 + k * (doorW + 0.06);
    c.box(x, 1.12, z, doorW + 0.06, 2.24, 0.9, '#d9dde0', T_METAL);
    c.box(x, 1.15, z + 0.43, doorW - 0.1, 1.95, 0.03, '#dff1ff', T_GLOW(0.7));
    for (let row_ = 0; row_ < 5; row_++) row(c, x - doorW / 2 + 0.07, z + 0.3, 1, 0, doorW - 0.14, 0.2 + row_ * 0.38, pools[(k + row_) % pools.length], 0, 5);
    for (const sx of [-1, 1]) c.box(x + sx * (doorW / 2 + 0.01), 1.15, z + 0.47, 0.05, 2.05, 0.06, '#26292c', T_METAL);
    c.box(x, 2.17, z + 0.47, doorW, 0.05, 0.06, '#26292c', T_METAL); c.box(x, 0.1, z + 0.47, doorW, 0.2, 0.06, '#26292c', T_METAL);
    c.box(x + doorW / 2 - 0.12, 1.2, z + 0.52, 0.03, 0.6, 0.04, '#aaa', T_METAL);
  }
  c.col(x0 + (n - 1) * (doorW + 0.06) / 2, 1.12, z, n * (doorW + 0.06) / 2, 1.12, 0.45);
}
function counterTopStuff(c: Ctx, items: number[], x0: number, x1: number, z = 1.2) {
  for (let x = x0; x < x1; x += 0.13) c.p.item(pick(c, items), x, 1.085, z + 0.22 + c.r.next() * 0.05, 0.05);
}

/** Convenience store: lit coolers, snack aisles, tobacco / lottery wall behind the till, coffee station. */
function convenience(c: Ctx) {
  const { hd, hw } = c;
  // tobacco + lottery wall behind the clerk (lit, floor to ceiling)
  c.box(-3.0, 1.45, c.backZ - 0.1, 4.2, 2.9, 0.34, '#3a3029', T_PAINT); c.col(-3.0, 1.45, c.backZ - 0.1, 2.1, 1.45, 0.17);
  face(c, -3.0, c.backZ, 0, 1, 4.0, [1.78, 2.0, 2.22, 2.44], [[C_CARTON]], 0.15, '#6b5d4c');
  face(c, -3.0, c.backZ, 0, 1, 4.0, [1.1, 1.38, 1.62], [[C_TICKET]], 0.15, '#6b5d4c');
  face(c, -3.0, c.backZ, 0, 1, 4.0, [0.55, 0.85], [C_BAGS.slice(6), C_BOXES], 0.15, '#6b5d4c');
  c.box(-3.0, 2.78, c.backZ + 0.18, 3.8, 0.08, 0.1, '#fff6d8', T_GLOW(1.6));
  neonPlane(c, 'LOTTO', '#ffd23f', -3.0, 2.98, c.backZ + 0.2, 1.2);
  // aisles
  gondola(c, 0.6, -0.6, 4.6, [C_SNACK, C_BAGS, C_BOXES, C_CANS], [C_BAGS, [C_TIN, C_LOAF], C_BOXES, C_SNACK]);
  gondola(c, 3.0, -0.6, 4.6, [C_DRINK, C_SOFT, C_CANS, [C_TIN]], [C_SNACK, C_BAGS, C_BOXES, [C_CUP, C_TIN]]);
  for (const ax of [0.6, 3.0]) c.box(ax, 1.9, 1.75, 0.9, 0.3, 0.05, c.accent, T_PAINT);
  // coolers on the back wall + side snack wall
  fridges(c, -1.0, 5, -hd + 0.5, [C_SOFT, C_CANS, C_DRINK, C_SOFT]);
  wallUnit(c, hw - 0.3, -0.9, -1, 0, 5.6, 2.1, [0.2, 0.62, 1.04, 1.46, 1.86], [C_SNACK, C_BAGS, C_BOXES, C_SNACK]);
  // coffee + hot food bar on the front right wall
  c.box(hw - 0.4, 0.5, 3.3, 0.7, 1.0, 1.9, '#3a3a3c', T_METAL); c.col(hw - 0.4, 0.5, 3.3, 0.35, 0.5, 0.95);
  for (let k = 0; k < 3; k++) { c.t.cyl(hw - 0.4, 1.0, 2.7 + k * 0.5, 0.11, 0.11, 0.45, 10, K(k === 1 ? '#a33a2b' : '#2b2f33'), T_METAL); c.t.box(hw - 0.75, 1.1, 2.7 + k * 0.5, 0.12, 0.1, 0.08, 0, K('#dcdcdc'), T_METAL); }
  for (let k = 0; k < 6; k++) c.p.item(C_CUP, hw - 0.3, 1.0, 3.9 + (k % 2) * 0.1 - 0.3, 0);
  c.box(hw - 0.4, 2.3, 3.3, 0.06, 0.3, 1.8, '#d83a2e', T_GLOW(0.8)); neonPlane(c, 'HOT COFFEE', '#ff8a3d', hw - 0.1, 2.45, 3.3, 1.1, -Math.PI / 2);
  // counter clutter: candy rack, scratch dispenser, jerky
  counterTopStuff(c, [...C_BAGS.slice(0, 3), C_CARTON, 24], -4.9, -3.4); c.box(-1.55, 1.2, c.counterZ + 0.05, 0.3, 0.2, 0.3, '#2b2f33', T_PLASTIC); c.box(-1.55, 1.34, c.counterZ + 0.05, 0.28, 0.06, 0.28, '#37d6a0', T_GLOW(0.9));
  camera(c, -4.4, -3.8); camera(c, 4.5, 3.8);
  c.box(-hw + 0.5, 0.65, 3.6, 0.45, 1.3, 0.5, '#243a52', T_METAL); c.box(-hw + 0.5, 1.4, 3.6, 0.46, 0.4, 0.04, '#a8e0ff', T_GLOW(0.7)); c.col(-hw + 0.5, 0.65, 3.6, 0.25, 0.65, 0.3); // ATM on the left wall
  neonPlane(c, 'ICE COLD', '#6fd0ff', 1.6, 2.95, -hd + 0.2, 1.7);
}

/** Gas-station mart: green palette, car-care aisle, fountain + coffee island, roller grill. */
function gas(c: Ctx) {
  const { hd, hw } = c;
  c.box(-3.0, 1.45, c.backZ - 0.1, 4.2, 2.9, 0.34, '#2c3b34', T_PAINT); c.col(-3.0, 1.45, c.backZ - 0.1, 2.1, 1.45, 0.17);
  face(c, -3.0, c.backZ, 0, 1, 4.0, [1.7, 1.96, 2.2], [[C_CARTON]], 0.15, '#4b5b52'); face(c, -3.0, c.backZ, 0, 1, 4.0, [0.5, 0.82, 1.14, 1.42], [[C_TICKET], C_BAGS.slice(6), C_BOXES], 0.15, '#4b5b52');
  neonPlane(c, 'FUEL & GO', '#47e08a', -3.0, 2.85, c.backZ + 0.2, 1.4);
  gondola(c, 0.6, -0.6, 4.6, [[C_OIL], [C_OIL, C_TIN], [C_TIN, C_OIL], C_BOXES], [C_SNACK, C_BAGS, C_BOXES, C_SNACK], 1.55, '#0f7b4f');
  gondola(c, 3.0, -0.6, 4.6, [C_SNACK, C_BAGS, C_BOXES, C_SNACK], [C_DRINK, C_CANS, C_SOFT, [C_LOAF]], 1.55, '#0f7b4f');
  for (const ax of [0.6, 3.0]) c.box(ax, 1.9, 1.75, 0.9, 0.3, 0.05, '#0f7b4f', T_PAINT);
  fridges(c, -1.0, 5, -hd + 0.5, [C_SOFT, C_CANS, C_DRINK, C_CANS]);
  // right wall: fountain drinks + coffee island (counter along the wall)
  c.box(hw - 0.5, 0.52, -0.9, 0.7, 1.04, 5.6, '#b9c1c4', T_METAL); c.col(hw - 0.5, 0.52, -0.9, 0.35, 0.52, 2.8);
  for (let k = 0; k < 5; k++) { c.t.box(hw - 0.5, 1.2, -3.1 + k * 0.58, 0.45, 0.32, 0.4, 0, K(['#d83a2e', '#2f8f4f', '#e8a21a', '#3a4a9e', '#6b6b6b'][k]), T_PLASTIC); c.t.box(hw - 0.25, 1.05, -3.1 + k * 0.58, 0.12, 0.12, 0.22, 0, K('#222'), T_METAL); }
  for (let k = 0; k < 8; k++) c.p.item(C_CUP, hw - 0.5, 1.04, -3.0 + k * 0.1, 0, 1.2);
  wallUnit(c, hw - 0.3, 2.6, -1, 0, 1.4, 2.0, [0.3, 0.8, 1.3], [[C_OIL, C_TIN]], '#2c3b34');
  // roller grill + warmer on the counter
  c.box(-1.6, 1.2, c.counterZ, 0.9, 0.2, 0.5, '#3a3a3c', T_METAL); for (let k = 0; k < 5; k++) c.t.cyl(-1.9 + k * 0.15, 1.34, c.counterZ, 0.03, 0.03, 0.5, 8, K(k % 2 ? '#a0522d' : '#c9733a'), T_PLASTIC, 0, 0, Math.PI / 2);
  c.box(-1.6, 1.45, c.counterZ, 0.9, 0.04, 0.5, '#f5e2b8', T_GLOW(0.8));
  counterTopStuff(c, [C_CARTON, 24, 25, ...C_BAGS.slice(0, 3)], -4.9, -2.3);
  neonPlane(c, 'OPEN 24H', '#ff6a5a', -4.6, 3.0, hd - 0.4, 1.0);
  camera(c, -4.4, -3.8); camera(c, 4.5, 3.8);
  c.box(-hw + 0.55, 0.45, 3.5, 0.8, 0.9, 1.6, '#e8f2ff', T_METAL); c.col(-hw + 0.55, 0.45, 3.5, 0.4, 0.45, 0.8); for (let k = 0; k < 4; k++) c.box(-hw + 0.58, 0.92, 3.0 + k * 0.4, 0.5, 0.04, 0.34, '#bcd6ea', T_GLASS); // ice chest
}

/** Liquor: warm amber lighting, floor-to-ceiling bottle walls, wine crates, glowing beer cave. */
function liquor(c: Ctx) {
  const { hd, hw } = c;
  // bottle wall behind the counter and along the back
  c.box(-3.0, 1.45, c.backZ - 0.1, 4.2, 2.9, 0.34, '#2a1a12', T_PAINT); c.col(-3.0, 1.45, c.backZ - 0.1, 2.1, 1.45, 0.17);
  face(c, -3.0, c.backZ, 0, 1, 4.0, [0.5, 0.92, 1.34, 1.76, 2.18, 2.6], [C_LIQ], 0.15, '#6b4a2f');
  for (let k = 0; k < 6; k++) c.box(-3.0, 0.9 + k * 0.42, c.backZ + 0.12, 4.0, 0.03, 0.06, '#ffd9a0', T_GLOW(0.9));
  wallUnit(c, -1.6, -hd + 0.25, 0, 1, 3.4, 2.7, [0.25, 0.7, 1.15, 1.6, 2.05, 2.5], [C_LIQ, [C_LIQ[0], C_LIQ[1]]], '#2a1a12', 0.4);
  // beer cave: four glowing cooler doors in the back right corner + case stacks beside them
  fridges(c, 1.4, 4, -hd + 0.5, [C_CANS, C_SOFT, C_CANS, C_DRINK], 1.0);
  for (let k = 0; k < 4; k++) c.box(1.4 + k * 1.06, 2.5, -hd + 0.95, 0.9, 0.3, 0.04, '#3a7bd5', T_GLOW(1.1));
  // wine racks on the left wall (bottles lying in a grid)
  c.box(-hw + 0.3, 1.1, -1.4, 0.45, 2.2, 3.2, '#4a2f1c', T_ROUGH); c.col(-hw + 0.3, 1.1, -1.4, 0.23, 1.1, 1.6);
  face(c, -hw + 0.3, -1.4, 1, 0, 3.0, [0.25, 0.7, 1.15, 1.6, 2.05], [[C_LIQ[2], C_LIQ[3]]], 0.25, '#4a2f1c');
  // centre island: wooden crates and a barrel table
  for (const [x, z, n] of [[0.9, -0.4, 3], [2.6, 0.2, 2]] as const) {
    for (let k = 0; k < n; k++) { c.box(x - 0.55 + k * 0.55, 0.3, z, 0.5, 0.6, 0.7, '#8a5a30', T_ROUGH); row(c, x - 0.78 + k * 0.55, z + 0.05, 1, 0, 0.44, 0.6, C_LIQ.slice(0, 2).concat(C_LIQ[3]), 0, 3); }
    c.col(x, 0.3, z, n * 0.28 + 0.02, 0.3, 0.35);
  }
  c.t.cyl(-0.4, 0, -1.5, 0.45, 0.45, 1.0, 12, K('#6b4426'), T_ROUGH); c.t.cyl(-0.4, 1.0, -1.5, 0.48, 0.48, 0.05, 12, K('#3b2a1f'), T_ROUGH); c.col(-0.4, 0.5, -1.5, 0.45, 0.5, 0.45);
  for (let k = 0; k < 4; k++) c.p.item(C_LIQ[k], -0.4 + (k - 1.5) * 0.18, 1.05, -1.5, k);
  // counter: cigar box + shot-bottle impulse display
  counterTopStuff(c, [C_LIQ[0], C_LIQ[1], C_LIQ[3], C_CARTON], -4.9, -2.3); c.box(-1.7, 1.2, c.counterZ, 0.55, 0.2, 0.4, '#7a4a28', T_GLASS);
  // neon in the window + pendant lamps
  neonPlane(c, 'OPEN', '#ff4a5a', -3.9, 2.55, c.hd - 0.35, 0.95); neonPlane(c, 'COLD BEER', '#4ac8ff', 0.0, 2.5, c.hd - 0.35, 1.5);
  for (const x of [-3, 0.5, 3]) { c.t.cyl(x, 2.75, -0.2, 0.18, 0.04, 0.2, 10, K('#d9a34a'), T_METAL); c.box(x, 3.3, -0.2, 0.02, 0.6, 0.02, '#222', T_METAL); c.box(x, 2.72, -0.2, 0.2, 0.03, 0.2, '#ffe0a8', T_GLOW(1.8)); }
  camera(c, -4.4, 3.8); camera(c, 4.6, -3.9);
}

/** Pawn shop: caged counter, wall of guitars and TVs, smash-able glass cases, cluttered shelves, buy-gold neon. */
function pawn(c: Ctx) {
  const { hd, hw } = c;
  // bars above the counter (security cage with a pass-through gap)
  for (let k = 0; k < 41; k++) { const x = -4.95 + k * 0.1; if (x > -3.45 && x < -2.55) continue; c.t.box(x, 2.0, c.counterZ + 0.3, 0.025, 1.9, 0.025, 0, K('#18181a'), T_METAL); }
  c.box(-3.0, 2.97, c.counterZ + 0.3, 4.1, 0.06, 0.08, '#18181a', T_METAL); c.box(-3.0, 1.1, c.counterZ + 0.3, 4.1, 0.05, 0.08, '#18181a', T_METAL);
  // behind the counter: guitars on the back wall, shelves of junk
  c.box(-3.0, 1.45, c.backZ - 0.1, 4.2, 2.9, 0.3, '#3a2c22', T_ROUGH); c.col(-3.0, 1.45, c.backZ - 0.1, 2.1, 1.45, 0.15);
  const gcol = ['#b8532a', '#1d1d1d', '#d9b25a', '#8a1c1c', '#2a5a8a', '#c8c0aa'];
  for (let k = 0; k < 6; k++) { const x = -4.7 + k * 0.7, gc = gcol[k]; c.t.box(x, 1.95, c.backZ + 0.1, 0.28, 0.4, 0.07, 0, K(gc), T_PAINT); c.t.box(x, 1.55, c.backZ + 0.1, 0.34, 0.45, 0.07, 0, K(gc), T_PAINT); c.t.box(x, 2.45, c.backZ + 0.1, 0.06, 0.85, 0.04, 0, K('#3a2a1a'), T_ROUGH); c.t.box(x, 1.75, c.backZ + 0.145, 0.1, 0.1, 0.01, 0, K('#111'), T_PLASTIC); }
  for (let k = 0; k < 8; k++) { const y = 0.6 + (k % 2) * 0.4; c.box(-4.8 + k * 0.55, y, c.backZ + 0.15, 0.4, 0.28, 0.2, ['#2b2f33', '#8a6a3a', '#40505e', '#6e2a2a'][k % 4], T_PLASTIC); }
  // TV wall on the right: stacked screens and consoles
  c.box(hw - 0.4, 1.4, -1.0, 0.5, 2.8, 5.6, '#2d241d', T_ROUGH); c.col(hw - 0.4, 1.4, -1.0, 0.25, 1.4, 2.8);
  for (let j = 0; j < 3; j++) for (let k = 0; k < 4; k++) { const z = -3.4 + k * 1.3, y = 0.75 + j * 0.78; c.t.box(hw - 0.62, y, z, 0.12, 0.6, 1.0, 0, K('#0c0d10'), T_PLASTIC); c.t.box(hw - 0.69, y, z, 0.02, 0.52, 0.9, 0, K(['#3a4a5a', '#6a7f93', '#252d36', '#5a6f5a'][(j + k) % 4]), T_GLOW(0.5)); }
  neonPlane(c, 'WE BUY GOLD', '#ffd23f', hw - 0.7, 2.75, -1.0, 1.5, -Math.PI / 2);
  // jewelry cases (smash for loot)
  jewelCase(c, 0.8, -0.2, 1.8, 0.8, 0, 220); jewelCase(c, 0.8, -1.9, 1.8, 0.8, 0, 260); jewelCase(c, 3.4, -2.7, 0.8, 1.8, 0, 240);
  // clutter: amps, a bike, boxes, tool pegboard on the back wall
  for (let k = 0; k < 3; k++) { c.box(-0.4 + k * 0.1, 0.45 + k * 0.9, -hd + 0.45, 0.8, 0.9, 0.5, '#161616', T_PLASTIC); c.box(-0.4 + k * 0.1, 0.45 + k * 0.9, -hd + 0.72, 0.5, 0.5, 0.02, '#303030', T_FABRIC); }
  c.col(-0.4, 1.35, -hd + 0.45, 0.4, 1.35, 0.25);
  c.box(2.3, 1.7, -hd + 0.12, 2.6, 1.4, 0.05, '#6d4f33', T_ROUGH);
  for (let k = 0; k < 12; k++) c.t.box(1.2 + k * 0.2, 1.6 + (k % 3) * 0.3, -hd + 0.18, 0.04, 0.28 + (k % 2) * 0.1, 0.03, 0, K(['#b0b4b8', '#d9a34a', '#8a1c1c'][k % 3]), T_METAL);
  for (let k = 0; k < 5; k++) c.box(-4.7 + k * 0.45, 0.2, -3.6 + (k % 2) * 0.2, 0.4, 0.4, 0.4, ['#8a6a3a', '#6b4a26', '#a37f4a'][k % 3], T_ROUGH);
  c.t.cyl(1.9, 0, 1.0, 0.32, 0.32, 0.04, 8, K('#222'), T_METAL, 0, 0, 0); // bike hint
  neonPlane(c, 'PAWN', '#ff4a3a', -3.0, 3.05, c.hd - 0.35, 1.0); neonPlane(c, 'CASH 4 GOLD', '#ffd23f', 0.5, 2.6, c.hd - 0.35, 1.3);
  camera(c, 4.6, -3.9); camera(c, -4.6, 3.8);
}

/** Jewelry: black marble, spot-lit glass cases with rings and necklaces; each case can be smashed for loot. */
function jewelry(c: Ctx) {
  const { hd, hw } = c;
  // velvet wall displays behind the counter
  c.box(-3.0, 1.45, c.backZ - 0.1, 4.2, 2.9, 0.3, '#14141a', T_PAINT); c.col(-3.0, 1.45, c.backZ - 0.1, 2.1, 1.45, 0.15);
  for (let k = 0; k < 4; k++) { const x = -4.5 + k * 1.0; c.box(x, 1.6, c.backZ + 0.08, 0.8, 1.6, 0.05, '#2a1a3a', T_FABRIC); c.box(x, 2.55, c.backZ + 0.3, 0.7, 0.04, 0.5, '#ffe9b0', T_GLOW(2.0));
    for (let n = 0; n < 3; n++) { c.t.cyl(x, 1.15 + n * 0.48, c.backZ + 0.12, 0.09, 0.07, 0.34, 8, K('#2f2f38'), T_PLASTIC); c.t.sphere(x, 1.58 + n * 0.48, c.backZ + 0.12, 0.05, K('#2f2f38'), T_PLASTIC); c.t.sphere(x, 1.47 + n * 0.48, c.backZ + 0.2, 0.025, K('#e8f6ff'), T_GLOW(1.0)); } }
  // islands + wall cases (all smash-able)
  jewelCase(c, 0.5, -0.8, 1.7, 0.75, 0, 480); jewelCase(c, 2.8, -0.8, 1.7, 0.75, 0, 520); jewelCase(c, 1.0, -4.3, 2.4, 0.6, 0, 700); jewelCase(c, 4.75, -2.3, 0.6, 2.2, 0, 640);
  // gold-leaf columns, velvet stools at the counter, watch plinths
  for (const x of [-0.1, 4.0]) { c.t.cyl(x, 0, -3.1, 0.22, 0.22, 3.6, 14, K('#d9d0bd'), T_STONE); c.t.cyl(x, 3.3, -3.1, 0.3, 0.3, 0.3, 14, K('#d4af37'), T_METAL); c.col(x, 1.8, -3.1, 0.22, 1.8, 0.22); }
  for (let k = 0; k < 3; k++) { const x = -4.2 + k * 1.3; c.t.cyl(x, 0, c.counterZ + 0.95, 0.04, 0.04, 0.55, 6, K('#cfcfcf'), T_METAL); c.t.cyl(x, 0.55, c.counterZ + 0.95, 0.24, 0.24, 0.12, 12, K('#5a1f3a'), T_FABRIC); }
  // counter display under glass: rows of rings + velvet
  for (let k = 0; k < 14; k++) { const x = -4.9 + k * 0.28; if (x > -2.95 && x < -2.25) continue; c.t.box(x, 1.09, c.counterZ, 0.2, 0.01, 0.5, 0, K('#142a52'), T_FABRIC); c.t.sphere(x, 1.14, c.counterZ + (k % 2) * 0.15 - 0.07, 0.03, K(k % 3 ? '#e0c25a' : '#bfefff'), T_GLOW(0.9)); }
  // spot lights + camera
  for (let k = 0; k < 8; k++) { const x = -4 + k * 1.2, z = k % 2 ? 1.2 : -1.8; c.t.cyl(x, c.ceil - 0.15, z, 0.07, 0.07, 0.15, 8, K('#101012'), T_METAL); c.t.box(x, c.ceil - 0.17, z, 0.1, 0.02, 0.1, 0, K('#fff3d6'), T_GLOW(3)); }
  { const g = new THREE.Mesh(new THREE.BoxGeometry(4.0, 0.16, 0.6), c.glassMat); g.position.set(-3.0, 1.19, c.counterZ); c.root.add(g); }
  neonPlane(c, 'GOLDEN HOUR', '#ffcf5a', hw - 0.1, 2.4, 1.5, 1.2, -Math.PI / 2);
  camera(c, -4.6, -3.9); camera(c, 4.6, 3.9); c.box(0, 3.1, -hd + 0.15, 4.4, 0.3, 0.05, '#d4af37', T_METAL);
}

/** Free-standing or wall glass display case with jewels inside; registers a SmashCase. */
export function jewelCase(c: Ctx, x: number, z: number, w: number, d: number, yaw: number, value: number) {
  const h = 0.9, gh = 0.5;
  c.box(x, h / 2, z, w, h, d, '#17171c', T_PAINT); c.box(x, h + 0.01, z, w + 0.04, 0.03, d + 0.04, '#d4af37', T_METAL);
  c.box(x, h + 0.03, z, w - 0.12, 0.02, d - 0.12, '#12213f', T_FABRIC);
  c.col(x, (h + gh) / 2, z, w / 2, (h + gh) / 2, d / 2);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(w - 0.06, gh, d - 0.06), c.glassMat); glass.position.set(x, h + gh / 2 + 0.04, z); c.root.add(glass);
  const lt = new TrimBuilder(); const long = w >= d, n = Math.floor((long ? w : d) / 0.28);
  for (let k = 0; k < n; k++) {
    const a = -(long ? w : d) / 2 + 0.2 + k * 0.28, px = x + (long ? a : 0), pz = z + (long ? 0 : a);
    if (k % 3 === 0) { lt.cyl(px, h + 0.04, pz, 0.07, 0.05, 0.22, 8, K('#2f2f38'), T_PLASTIC); lt.sphere(px, h + 0.3, pz, 0.045, K('#2f2f38'), T_PLASTIC); lt.sphere(px, h + 0.22, pz + 0.05, 0.03, K('#e8f6ff'), T_GLOW(1.2)); }
    else { lt.box(px, h + 0.07, pz, 0.14, 0.06, 0.14, 0, K('#241a1f'), T_FABRIC); lt.sphere(px, h + 0.12, pz, 0.025, K(k % 2 ? '#e0c25a' : '#bfefff'), T_GLOW(1.4)); lt.cyl(px, h + 0.1, pz + 0.03, 0.022, 0.022, 0.01, 10, K('#e0c25a'), T_METAL); }
  }
  const loot = new THREE.Mesh(lt.build(), c.trimMat); c.root.add(loot);
  c.extras.cases.push({ lx: x, ly: h, lz: z, w, d, yaw, value, glass, loot, broken: false });
}

/** Bank: marble hall, three teller windows behind security glass, safe-deposit wall, ATM bay, a real vault room with a swinging door. */
function bank(c: Ctx) {
  const { hd, hw } = c;
  const teal = '#1d3a5c';
  // teller line: security glass above the counter with three windows
  const gl = new THREE.Mesh(new THREE.BoxGeometry(4.1, 1.5, 0.04), c.glassMat); gl.position.set(-3.0, 1.9, c.counterZ + 0.2); c.root.add(gl);
  for (const x of [-5.0, -3.65, -2.35, -1.0]) c.box(x, 1.85, c.counterZ + 0.2, 0.08, 1.6, 0.1, '#6a5a3a', T_METAL);
  c.box(-3.0, 2.68, c.counterZ + 0.2, 4.2, 0.1, 0.12, '#6a5a3a', T_METAL); c.box(-3.0, 1.12, c.counterZ + 0.2, 4.2, 0.06, 0.14, '#6a5a3a', T_METAL);
  for (const x of [-4.3, -3.0, -1.7]) { c.box(x, 1.12, c.counterZ + 0.38, 0.45, 0.03, 0.22, '#c9c9c9', T_METAL); c.box(x, 1.32, 0.98, 0.4, 0.3, 0.04, '#1a1a1a', T_PLASTIC); c.box(x, 1.32, 0.955, 0.34, 0.24, 0.01, '#6fd0ff', T_GLOW(0.8)); c.box(x, 1.14, 0.98, 0.1, 0.1, 0.06, '#1a1a1a', T_PLASTIC); }
  c.extras.tellers.push({ x: -4.3, z: 0.25 }, { x: -1.7, z: 0.25 });
  // safe-deposit wall behind the tellers
  c.box(-3.0, 1.45, c.backZ - 0.1, 4.2, 2.9, 0.3, '#4a5156', T_METAL); c.col(-3.0, 1.45, c.backZ - 0.1, 2.1, 1.45, 0.15);
  for (let j = 0; j < 6; j++) for (let k = 0; k < 14; k++) { c.t.box(-4.85 + k * 0.29, 0.55 + j * 0.34, c.backZ + 0.07, 0.25, 0.3, 0.02, 0, K((j + k) % 2 ? '#8e979d' : '#7d868c'), T_METAL); c.t.box(-4.85 + k * 0.29 + 0.06, 0.55 + j * 0.34, c.backZ + 0.09, 0.03, 0.03, 0.02, 0, K('#d4af37'), T_METAL); }
  // vault room (back right corner): walls, interior cash, door that swings open
  const vx0 = 0.8, vx1 = hw - 0.12, vz0 = -hd + 0.12, vz1 = -2.5, gap0 = 2.2, gap1 = 3.8;
  c.box((vx0 + gap0) / 2, 1.8, vz1, gap0 - vx0, 3.6, 0.35, '#5a6268', T_METAL); c.box((gap1 + vx1) / 2, 1.8, vz1, vx1 - gap1, 3.6, 0.35, '#5a6268', T_METAL);
  c.box(vx0, 1.8, (vz0 + vz1) / 2, 0.35, 3.6, vz1 - vz0, '#5a6268', T_METAL); c.box((gap0 + gap1) / 2, 3.45, vz1, gap1 - gap0, 0.3, 0.35, '#5a6268', T_METAL);
  c.col((vx0 + gap0) / 2, 1.8, vz1, (gap0 - vx0) / 2, 1.8, 0.18); c.col((gap1 + vx1) / 2, 1.8, vz1, (vx1 - gap1) / 2, 1.8, 0.18); c.col(vx0, 1.8, (vz0 + vz1) / 2, 0.18, 1.8, (vz1 - vz0) / 2);
  const cash = new THREE.Group(); const ct = new TrimBuilder();
  for (let k = 0; k < 4; k++) for (let j = 0; j < 3; j++) for (let l = 0; l < 4; l++) { ct.box(1.3 + k * 0.55, 0.12 + l * 0.2, -3.55 + j * 0.4, 0.45, 0.17, 0.32, 0, K(l % 2 ? '#5a9a62' : '#6fae72'), T_PAINT); ct.box(1.3 + k * 0.55, 0.12 + l * 0.2, -3.55 + j * 0.4, 0.46, 0.06, 0.1, 0, K('#e8e0c0'), T_PAINT); }
  for (let k = 0; k < 10; k++) ct.box(4.3 + (k % 5) * 0.2, 0.08 + Math.floor(k / 5) * 0.08, -3.4, 0.18, 0.07, 0.07, 0, K('#e8c545'), T_METAL);
  // cash racks along the vault back wall: steel uprights, shelves, banded bundles
  for (const rx of [1.5, 2.9, 4.3]) {
    for (const ux of [rx - 0.65, rx + 0.65]) c.box(ux, 1.2, vz0 + 0.3, 0.05, 2.4, 0.4, '#3c4348', T_METAL);
    for (let l = 0; l < 4; l++) { c.box(rx, 0.35 + l * 0.6, vz0 + 0.3, 1.35, 0.04, 0.4, '#59636a', T_METAL); for (let b = 0; b < 4; b++) ct.box(rx - 0.45 + b * 0.3, 0.35 + l * 0.6 + 0.12, vz0 + 0.3, 0.26, 0.2, 0.32, 0, K((b + l) % 2 ? '#5a9a62' : '#6fae72'), T_PAINT); }
  }
  const cashMesh = new THREE.Mesh(ct.build(), c.trimMat); cash.add(cashMesh); c.root.add(cash);
  c.box(2.9, 3.4, -3.7, 3.6, 0.1, 0.4, '#fff3d6', T_GLOW(2.2)); c.box(vx1 - 0.2, 1.4, -3.9, 0.3, 2.4, 2.4, '#4a5156', T_METAL);
  // recessed square steel frame around the opening (jamb + lintel + sill), bolt receivers
  const vcx = (gap0 + gap1) / 2, vw = gap1 - gap0, vzf = vz1;
  c.box(gap0 - 0.04, 1.6, vzf + 0.05, 0.16, 3.2, 0.5, '#3c4348', T_METAL); c.box(gap1 + 0.04, 1.6, vzf + 0.05, 0.16, 3.2, 0.5, '#3c4348', T_METAL);
  c.box(vcx, 3.14, vzf + 0.05, vw + 0.3, 0.2, 0.5, '#3c4348', T_METAL); c.box(vcx, 0.05, vzf + 0.05, vw + 0.3, 0.1, 0.5, '#3c4348', T_METAL);
  for (let k = 0; k < 4; k++) { const a = k / 4 * Math.PI * 2 + Math.PI / 4; c.box(vcx + Math.cos(a) * 0.62, 1.5 + Math.sin(a) * 0.62, vzf - 0.1, 0.16, 0.16, 0.16, '#222a2e', T_METAL); }
  // round door: 0.5 m thick steel, hinged on the right jamb; local origin = hinge axis
  const door = new THREE.Group(); door.position.set(gap1 - 0.05, 0, vz1 - 0.25); const dt = new TrimBuilder();
  const dcx = -(vw - 0.1) / 2, R = 0.8;
  dt.cyl(dcx, 1.5 - 0, 0.0, R, R, 0.5, 32, K('#7d878d'), T_METAL, 0, Math.PI / 2, 0);
  dt.cyl(dcx, 1.5, 0.5, R * 0.88, R * 0.88, 0.05, 32, K('#98a2a8'), T_METAL, 0, Math.PI / 2, 0);
  dt.cyl(dcx, 1.5, 0.48, R * 0.99, R * 0.99, 0.03, 32, K('#4a5258'), T_METAL, 0, Math.PI / 2, 0);
  for (let k = 0; k < 8; k++) { const a = k / 8 * Math.PI * 2; dt.cyl(dcx + Math.cos(a) * (R + 0.02), 1.5 + Math.sin(a) * (R + 0.02), -0.12, 0.07, 0.07, 0.3, 8, K('#c6cdd1'), T_METAL, 0, Math.PI / 2, 0); } // locking bolts around the rim
  dt.cyl(dcx, 1.5, 0.55, 0.2, 0.2, 0.1, 16, K('#b9a46a'), T_METAL, 0, Math.PI / 2, 0); // hub
  for (let k = 0; k < 6; k++) { const a = k / 6 * Math.PI * 2; dt.box(dcx + Math.cos(a) * 0.26, 1.5 + Math.sin(a) * 0.26, 0.66, 0.06, 0.5, 0.06, 0, K('#d4af37'), T_METAL, 0, a + Math.PI / 2); } // wheel spokes
  dt.cyl(dcx, 1.5, 0.62, 0.34, 0.34, 0.05, 24, K('#d4af37'), T_METAL, 0, Math.PI / 2, 0); // wheel rim (disc outline)
  dt.cyl(dcx, 1.5, 0.64, 0.29, 0.29, 0.02, 24, K('#7d878d'), T_METAL, 0, Math.PI / 2, 0);
  dt.box(0.02, 1.0, 0.25, 0.12, 0.3, 0.3, 0, K('#2b3236'), T_METAL); dt.box(0.02, 2.0, 0.25, 0.12, 0.3, 0.3, 0, K('#2b3236'), T_METAL); // hinge knuckles
  dt.box(dcx / 2, 1.5, 0.58, Math.abs(dcx), 0.14, 0.12, 0, K('#2b3236'), T_METAL); // hinge arm
  door.add(new THREE.Mesh(dt.build(), c.trimMat)); c.root.add(door);
  const dcol = c.col((gap0 + gap1) / 2, 1.5, vz1 + 0.05, (gap1 - gap0) / 2, 1.5, 0.12);
  const rig = new THREE.Group(); const rt = new TrimBuilder();
  rt.box(0, 0.6, 0, 0.5, 1.2, 0.4, 0, K('#d8a02a'), T_METAL); rt.cyl(0, 1.2, 0.3, 0.07, 0.07, 0.7, 8, K('#444'), T_METAL, 0, Math.PI / 2, 0); rt.sphere(0, 1.2, 0.95, 0.05, K('#ffb347'), T_GLOW(3));
  rig.add(new THREE.Mesh(rt.build(), c.trimMat)); rig.position.set((gap0 + gap1) / 2 - 0.6, 0, vz1 + 0.9); rig.visible = false; c.root.add(rig);
  c.extras.vault = { door, lx: (gap0 + gap1) / 2, lz: vz1 + 1.3, cashLx: 2.9, cashLz: -3.9, colliders: [dcol], cash, rig, openA: 0 };
  // lobby: marble columns, benches, plants, ATM bay on the right wall, check-writing desk, camera domes
  for (const x of [-0.1, 0.0]) { void x; }
  c.t.cyl(-0.2, 0, -1.5, 0.28, 0.28, 3.6, 16, K('#e6dfcf'), T_STONE); c.t.cyl(-0.2, 3.3, -1.5, 0.38, 0.38, 0.3, 16, K('#b9a46a'), T_METAL); c.col(-0.2, 1.8, -1.5, 0.28, 1.8, 0.28);
  for (const [x, z] of [[2.6, -1.4], [4.0, -0.6]] as const) { c.box(x, 0.25, z, 1.3, 0.1, 0.5, '#5a3a22', T_ROUGH); c.box(x, 0.5, z - 0.22, 1.3, 0.5, 0.08, '#5a3a22', T_ROUGH); c.box(x - 0.5, 0.12, z, 0.1, 0.24, 0.45, '#222', T_METAL); c.box(x + 0.5, 0.12, z, 0.1, 0.24, 0.45, '#222', T_METAL); c.col(x, 0.4, z, 0.65, 0.4, 0.3); }
  for (const z of [0.9, 1.6]) { c.box(hw - 0.4, 1.0, z, 0.6, 2.0, 0.6, '#2f3a46', T_METAL); c.box(hw - 0.09, 1.45, z, 0.02, 0.42, 0.44, '#a8e0ff', T_GLOW(0.9)); c.col(hw - 0.4, 1.0, z, 0.3, 1.0, 0.3); }
  c.box(4.6, 0.55, 3.2, 1.1, 1.1, 0.5, '#4a3a2a', T_ROUGH); c.col(4.6, 0.55, 3.2, 0.55, 0.55, 0.25); c.box(4.6, 1.12, 3.2, 1.2, 0.04, 0.6, '#d9d4ca', T_STONE);
  // potted plant: ceramic pot, soil, fan of leaf blades (matte, no blown-out sphere)
  c.t.cyl(-0.4, 0, 3.6, 0.24, 0.18, 0.42, 12, K('#d8d2c6'), T_STONE); c.t.cyl(-0.4, 0.4, 3.6, 0.2, 0.2, 0.03, 12, K('#2a1d14'), T_ROUGH);
  for (let k = 0; k < 9; k++) { const a = k / 9 * Math.PI * 2, tilt = 0.35 + (k % 3) * 0.2; c.t.cyl(-0.4 + Math.sin(a) * 0.03, 0.42, 3.6 + Math.cos(a) * 0.03, 0.05, 0.005, 0.55 + (k % 3) * 0.15, 5, K(k % 2 ? '#2f5a2c' : '#3a6b34'), T_ROUGH, a, tilt); }
  neonPlane(c, 'BANK', '#8fd0ff', -3.0, 3.1, c.backZ + 0.25, 1.0);
  c.box(0, 3.1, -hd + 0.15, 4.0, 0.3, 0.05, teal, T_PAINT);
  camera(c, -4.6, -3.8); camera(c, 4.6, 3.9); camera(c, -0.1, 0.8);
}

/** Pharmacy: green cross, pharmacist's counter with locked cabinets, health aisles with boxed goods. */
function pharmacy(c: Ctx) {
  const { hd, hw } = c;
  c.box(-3.0, 1.45, c.backZ - 0.1, 4.2, 2.9, 0.34, '#dfe7e2', T_PAINT); c.col(-3.0, 1.45, c.backZ - 0.1, 2.1, 1.45, 0.17);
  face(c, -3.0, c.backZ, 0, 1, 4.0, [0.5, 0.95, 1.4, 1.85, 2.3], [C_BOXES, [C_TIN], C_BOXES], 0.15, '#9fb0a8');
  c.box(-3.0, 2.8, c.backZ + 0.2, 4.0, 0.12, 0.08, '#1d8f6a', T_GLOW(1.2));
  neonPlane(c, 'PHARMACY', '#47e0a0', -3.0, 3.1, c.backZ + 0.25, 1.5);
  gondola(c, 0.6, -0.6, 4.6, [C_BOXES, [C_TIN], C_BOXES, [C_TIN, C_BAGS[6]]], [C_BAGS, C_BOXES, [C_TIN], C_BOXES], 1.55, '#1d8f6a');
  gondola(c, 3.0, -0.6, 4.6, [[C_TIN], C_BOXES, [C_TIN], C_BOXES], [C_BOXES, C_BAGS, C_BOXES, [C_TIN]], 1.55, '#1d8f6a');
  for (const ax of [0.6, 3.0]) c.box(ax, 1.9, 1.75, 0.9, 0.3, 0.05, '#1d8f6a', T_PAINT);
  fridges(c, 0.2, 3, -hd + 0.5, [C_SOFT, C_CANS]);
  wallUnit(c, hw - 0.3, -0.9, -1, 0, 5.6, 2.1, [0.2, 0.62, 1.04, 1.46, 1.86], [C_BOXES, [C_TIN], C_BAGS], '#dfe7e2');
  c.box(-hw + 0.5, 0.5, 3.3, 0.5, 1.0, 0.8, '#e8f0ec', T_PLASTIC); c.box(-hw + 0.5, 1.15, 3.3, 0.5, 0.3, 0.7, '#1d8f6a', T_GLOW(0.6)); c.col(-hw + 0.5, 0.6, 3.3, 0.25, 0.6, 0.4); // blood-pressure kiosk
  counterTopStuff(c, [C_TIN, C_BOXES[0], C_BOXES[3]], -4.9, -3.4);
  camera(c, -4.4, -3.8); camera(c, 4.5, 3.8);
}
/** The remaining specialty shops: a back-of-counter display suited to the trade (no stacks of coloured blocks). */
export function legacyBack(kind: Store['kind'], c: Ctx) {
  if (kind === 'diner') {
    c.box(-3.0, 1.0, c.backZ - 0.1, 4.2, 2.0, 0.34, '#6e2a22', T_PAINT); c.col(-3.0, 1.0, c.backZ - 0.1, 2.1, 1.0, 0.17);
    for (let k = 0; k < 2; k++) { c.box(-4.2 + k * 2.2, 1.35, c.backZ + 0.2, 1.7, 0.04, 0.4, '#d9d4ca', T_METAL); c.box(-4.2 + k * 2.2, 1.65, c.backZ + 0.2, 1.7, 0.5, 0.42, '#bfe3ea', T_GLASS); for (let p = 0; p < 4; p++) { c.t.cyl(-4.8 + k * 2.2 + p * 0.4, 1.37, c.backZ + 0.2, 0.17, 0.17, 0.08, 12, K(['#d9a05a', '#e8c9a0', '#a8472a', '#f2e6c8'][p]), T_PAINT); } }
    for (let k = 0; k < 8; k++) c.p.item(C_CUP, -4.8 + k * 0.28, 1.04, c.backZ + 0.3, 0, 1.2);
    c.t.cyl(-1.9, 1.06, c.backZ + 0.25, 0.1, 0.1, 0.35, 10, K('#222'), T_METAL); c.t.cyl(-1.6, 1.06, c.backZ + 0.25, 0.1, 0.1, 0.35, 10, K('#222'), T_METAL);
    for (let k = 0; k < 6; k++) c.p.item(C_LOAF, -4.8 + k * 0.5, 2.1, c.backZ + 0.25, 0);
  } else if (kind === 'clothing') {
    c.box(-3.0, 0.5, c.backZ - 0.1, 4.2, 1.0, 0.34, '#d9d0c4', T_PAINT); c.col(-3.0, 0.5, c.backZ - 0.1, 2.1, 0.5, 0.17);
    for (let row = 0; row < 3; row++) for (let k = 0; k < 6; k++) { const hgt = 2 + c.r.int(0, 3); for (let n = 0; n < hgt; n++) c.t.box(-4.7 + k * 0.7, 1.2 + row * 0.55 + n * 0.07, c.backZ + 0.2, 0.5, 0.06, 0.38, 0, K(['#c0392b', '#2c3e50', '#d8c9a0', '#27ae60', '#ecf0f1', '#8e44ad', '#34495e'][(k + row + n) % 7]), T_FABRIC); }
    for (let row = 0; row < 3; row++) c.box(-3.0, 1.12 + row * 0.55, c.backZ + 0.2, 4.2, 0.03, 0.42, '#b9a98f', T_ROUGH);
    c.box(-3.0, 2.85, c.backZ + 0.2, 1.8, 0.4, 0.06, K(c.def.color), T_GLOW(0.5));
  } else if (kind === 'barber') {
    c.box(-3.0, 0.5, c.backZ - 0.1, 4.2, 1.0, 0.34, '#2a2a2e', T_PAINT); c.col(-3.0, 0.5, c.backZ - 0.1, 2.1, 0.5, 0.17);
    c.box(-3.0, 1.7, c.backZ + 0.05, 3.6, 1.3, 0.05, '#b9d3dc', T_GLASS);
    face(c, -3.0, c.backZ, 0, 1, 3.6, [1.1, 1.5], [C_SOFT, C_LIQ.slice(0, 2)], 0.1, '#444');
    for (let k = 0; k < 5; k++) c.t.cyl(-4.6 + k * 0.2, 1.06, c.counterZ + 0.2, 0.05, 0.04, 0.28, 8, K(['#cfd6da', '#2c7fb8', '#e8e8e8', '#d4af37', '#cc3a2f'][k]), T_PLASTIC);
  } else if (kind === 'electronics') {
    c.box(-3.0, 0.6, c.backZ - 0.1, 4.2, 1.2, 0.34, '#1b1e24', T_METAL); c.col(-3.0, 0.6, c.backZ - 0.1, 2.1, 0.6, 0.17);
    for (let k = 0; k < 4; k++) { c.t.box(-4.5 + k * 1.0, 1.9, c.backZ + 0.1, 0.9, 0.55, 0.05, 0, K('#0a0c10'), T_PLASTIC); c.t.box(-4.5 + k * 1.0, 1.9, c.backZ + 0.14, 0.8, 0.46, 0.01, 0, K(['#5fb4ff', '#ff8f5f', '#7fe0a0', '#c88fff'][k]), T_GLOW(1.1)); }
    for (let k = 0; k < 10; k++) c.t.box(-4.8 + k * 0.4, 1.28, c.backZ + 0.15, 0.3, 0.14, 0.2, 0, K(k % 2 ? '#1f2a33' : '#cfd6da'), T_PLASTIC);
  }
}
/**
 * Round 7: wall slots of the gun store (store-local; W 10.4 x D 9.8): a pegboard on the back wall (barrel along +x) and one
 * on the right wall (barrel along z). The game hangs the real weapon models here and sells whatever the player looks at.
 */
export const GUN_SLOTS: { lx: number; ly: number; lz: number; yaw: number; wall: 'back' | 'right' }[] = (() => {
  const out: { lx: number; ly: number; lz: number; yaw: number; wall: 'back' | 'right' }[] = [];
  for (const ly of [1.95, 1.3]) for (let k = 0; k < 5; k++) out.push({ lx: 0.35 + k * 0.98, ly, lz: -4.9 + 0.3, yaw: Math.PI / 2, wall: 'back' });
  for (const ly of [1.95, 1.3]) for (let k = 0; k < 5; k++) out.push({ lx: 5.2 - 0.3, ly, lz: -3.9 + k * 1.05, yaw: 0, wall: 'right' });
  return out;
})();
/** Gun store: olive walls, pegboards of long guns and handguns, a glass pistol case, ammo shelves, range posters. */
function guns(c: Ctx) {
  const { hd, hw } = c;
  // pegboards behind the wall slots
  c.box(2.3, 1.62, -hd + 0.17, 4.9, 1.5, 0.06, '#7a6a4f', T_ROUGH); c.col(2.3, 1.62, -hd + 0.17, 2.45, 0.75, 0.05);
  c.box(hw - 0.17, 1.62, -1.8, 0.06, 1.5, 5.2, '#7a6a4f', T_ROUGH); c.col(hw - 0.17, 1.62, -1.8, 0.05, 0.75, 2.6);
  for (let k = 0; k < 40; k++) { c.t.box(0.0 + k * 0.12, 0.84, -hd + 0.21, 0.02, 0.02, 0.02, 0, K('#3a3226'), T_METAL); }
  // price rail under each board, a long red stripe on top
  c.box(2.3, 0.86, -hd + 0.24, 4.9, 0.05, 0.08, '#20221f', T_METAL); c.box(hw - 0.24, 0.86, -1.8, 0.08, 0.05, 5.2, '#20221f', T_METAL);
  c.box(2.3, 2.45, -hd + 0.2, 4.9, 0.12, 0.04, '#8a1c1c', T_PAINT); c.box(hw - 0.2, 2.45, -1.8, 0.04, 0.12, 5.2, '#8a1c1c', T_PAINT);
  // glass display case for handguns (smashable like a jewelry case, with the counter's pistols)
  jewelCase(c, 1.3, -1.4, 2.2, 0.8, 0, 380);
  // ammo shelf behind the counter: boxes in calibre colours
  c.box(-3.0, 1.45, c.backZ - 0.1, 4.2, 2.9, 0.3, '#2b2a24', T_ROUGH); c.col(-3.0, 1.45, c.backZ - 0.1, 2.1, 1.45, 0.15);
  for (let j = 0; j < 4; j++) for (let k = 0; k < 10; k++) c.t.box(-4.85 + k * 0.4, 0.55 + j * 0.55, c.backZ + 0.12, 0.3, 0.2, 0.18, 0, K(['#3d5a2a', '#8a6a1c', '#6b1f1f', '#2a3d5a'][(j + k) % 4]), T_PAINT);
  // range posters and a neon sign
  for (const x of [-1.2, 0.3]) { c.t.box(x, 2.0, c.hd - 0.25, 0.6, 0.8, 0.02, 0, K('#e8e2d0'), T_PAINT); c.t.cyl(x, 2.0, c.hd - 0.27, 0.18, 0.18, 0.01, 16, K('#8a1c1c'), T_PAINT, Math.PI / 2, 0, 0); }
  neonPlane(c, 'TIDEWATER ARMS', '#ff5a3a', -3.0, 3.05, c.hd - 0.35, 1.6); neonPlane(c, 'RANGE & GUNS', '#ffd23f', 2.4, 3.0, -hd + 0.25, 1.3);
  camera(c, 4.6, -3.9); camera(c, -4.6, 3.8);
}
export const NEW_KINDS: Partial<Record<Store['kind'], (c: Ctx) => void>> = { convenience, gas, liquor, pawn, jewelry, bank, pharmacy, guns };
export { C_RING, C_VELVET };
