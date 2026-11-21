/**
 * Procedural architecture for Port Meridian: brick walk-ups with cornices and fire escapes, stone and concrete
 * mid-rises, glass office towers with setbacks, stucco beach blocks with balconies, pitched-roof houses with porches,
 * and corrugated warehouses. Surfaces go into chunked FacadeBuilders (procedural facade shader), details into
 * chunked TrimBuilders (cornices, sills, awnings, fire escapes, rooftop plant), plus sign/billboard placements.
 */
import { worldGlass } from './glass';
import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Physics } from '../core/physics';
import { Chunked, FacadeBuilder, TrimBuilder, ROOF, SOLID, type WallSpec, T_PAINT, T_STONE, T_METAL, T_IRON, T_ROUGH, T_FABRIC, T_GLASS, T_NIGHTGLOW, T_GLOW, type TrimParams } from './builders';

export interface SignSpec { x: number; y: number; z: number; yaw: number; w: number; h: number; idx: number; blade?: boolean }
export interface BillboardSpec { x: number; y: number; z: number; yaw: number; idx: number; w: number }
export interface Helipad { x: number; y: number; z: number; name: string }
export interface BuildCtx {
  fac: Chunked<FacadeBuilder>;
  trim: Chunked<TrimBuilder>;
  physics: Physics;
  signs: SignSpec[];
  billboards: BillboardSpec[];
  helipads: Helipad[];
  /** True when the point is open ground (street, sidewalk, yard), i.e. a wall facing it is visible. */
  exposed: (x: number, z: number) => boolean;
}

const C = (h: string) => new THREE.Color(h);
export const BRICK_COLORS = ['#8e4a37', '#9a5640', '#7d3f30', '#a8664c', '#6e3b2f', '#b07454', '#84503e', '#94604a', '#5f4a42'];
export const PLASTER_COLORS = ['#d8cbb3', '#c9b89a', '#e3d9c6', '#bfae94', '#d1c2a8', '#a99f92', '#cfc8bb'];
export const PASTEL_COLORS = ['#e9c6a8', '#f0d9b5', '#a9d3c9', '#f2b5a7', '#d8c3e0', '#f4e1a1', '#b8d8e8', '#f5cfc0', '#e6e0cf'];
export const CONCRETE_COLORS = ['#a8a59e', '#b9b4aa', '#9c9a95', '#c4beb2', '#8f8d88'];
export const STONE_COLORS = ['#c9bea8', '#b8ab92', '#d6cdb9', '#a89a84'];
export const GLASS_TINTS = ['#5d7f8f', '#47677a', '#6f8790', '#3a5566', '#7a8f88', '#6a6a72', '#4f6b5e', '#5c7590'];
export const SIDING_COLORS = ['#e8e4da', '#c9d4d8', '#d9c7a6', '#a9b8a0', '#e2d2b8', '#b4c3cc', '#efe7d2', '#c97b63'];
export const ROOF_COLORS = ['#4a4644', '#5a4d43', '#6b3f32', '#3f4448', '#7a5a46', '#58534d'];

/** Local -> world helper for a footprint centred at (cx,cz) with yaw (local +z = front). */
function frame(cx: number, cz: number, yaw: number) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  return { c, s, L: (lx: number, lz: number) => ({ x: cx + lx * c + lz * s, z: cz - lx * s + lz * c }) };
}
function innerWalls(fb: FacadeBuilder, cx: number, cz: number, w: number, d: number, y0: number, y1: number, yaw: number, color: THREE.Color, spec: WallSpec) {
  const { L } = frame(cx, cz, yaw); const hw = w / 2, hd = d / 2;
  const k = [L(-hw, hd), L(hw, hd), L(hw, -hd), L(-hw, -hd)];
  for (let i = 0; i < 4; i++) { const a = k[i], b = k[(i + 1) % 4]; fb.wall(b.x, b.z, a.x, a.z, y0, y1, color, spec); }
}
/** Bay centres along a face of length len for a cell width. */
function bays(len: number, cellW: number) { const n = Math.max(1, Math.round(len / cellW)); const cw = len / n; return { n, cw, at: (i: number) => -len / 2 + cw * (i + 0.5) }; }

export interface StreetBuildingSpec {
  cx: number; cz: number; yaw: number; w: number; d: number; base: number;
  floors: number; floorH: number; groundH: number;
  mat: number; color: THREE.Color; seed: number;
  ground: 'shop' | 'resi' | 'lobby' | 'blank';
  winW: number; winH: number; sill: number; cellW: number;
  cornice: 'heavy' | 'simple' | 'bands' | 'none';
  fireEscape: boolean; lit: number;
  /** exposed faces: front, right, back, left */
  exposed: [boolean, boolean, boolean, boolean];
  roofItems: number; awning: boolean; brand: number; balconies: boolean; trimColor: THREE.Color;
  /** ground floor left open for a walk-in store built elsewhere */
  hollow?: boolean;
  /** brownstone stoop: raised parlour door with a stair and railings */
  stoop?: boolean;
}

/** Mid-block street building (walk-up, mid-rise, beach block). Tall ones step back in wedding-cake tiers. */
export function streetBuilding(ctx: BuildCtx, s: StreetBuildingSpec) {
  if (s.floors < 9 || s.hollow || s.w < 8.5) { streetBuildingBlock(ctx, s); return; }
  const r = new Rng(s.seed + 91);
  const cuts = s.floors >= 15 ? [Math.round(s.floors * 0.45), Math.round(s.floors * 0.75)] : [Math.round(s.floors * r.range(0.55, 0.7))];
  let cur = { ...s };
  let used = 0;
  for (let t = 0; t <= cuts.length; t++) {
    const end = t < cuts.length ? cuts[t] : s.floors;
    const fl = end - used;
    if (t === 0) streetBuildingBlock(ctx, { ...cur, floors: fl, roofItems: 0, fireEscape: s.fireEscape && fl >= 3, cornice: s.cornice === 'none' ? 'none' : 'simple' });
    else streetBuildingBlock(ctx, { ...cur, floors: fl, groundH: 0, ground: 'blank', awning: false, balconies: false, fireEscape: false, stoop: false, roofItems: t === cuts.length ? s.roofItems : 0, cornice: t === cuts.length ? s.cornice : 'simple' });
    used = end;
    if (t < cuts.length) {
      const fi = r.range(1.6, 3.2), ri = r.range(0.6, 1.6);
      const sl = cur.exposed[3] ? r.range(1.2, 2.6) : 0, sr = cur.exposed[1] ? r.range(1.2, 2.6) : 0;
      const nw = cur.w - sl - sr, nd = cur.d - fi - ri;
      const Hcur = cur.base + cur.groundH + fl * cur.floorH;
      if (nw < 5 || nd < 5) { streetBuildingBlock(ctx, { ...cur, floors: s.floors - used, groundH: 0, ground: 'blank', awning: false, balconies: false, fireEscape: false, stoop: false, roofItems: s.roofItems, base: Hcur }); return; }
      const top = Hcur;
      const ox = (sl - sr) / 2, oz = (ri - fi) / 2;
      const c = Math.cos(cur.yaw), sn = Math.sin(cur.yaw);
      cur = { ...cur, cx: cur.cx + ox * c + oz * sn, cz: cur.cz - ox * sn + oz * c, w: nw, d: nd, base: top, groundH: 0, ground: 'blank' };
    }
  }
}

function streetBuildingBlock(ctx: BuildCtx, s: StreetBuildingSpec) {
  const r = new Rng(s.seed);
  const fb = ctx.fac.at(s.cx, s.cz), tb = ctx.trim.at(s.cx, s.cz);
  const { L, c: cy, s: sy } = frame(s.cx, s.cz, s.yaw);
  const H = s.base + s.groundH + s.floors * s.floorH;
  const top = H + 0.9;
  const upper: WallSpec = { kind: 2, seed: s.seed % 9973, cellW: s.cellW, cellH: s.floorH, winW: s.winW, winH: s.winH, sill: s.sill, mat: s.mat, originV: s.groundH, baseY: s.base, lit: s.lit, floors: s.floors };
  const back: WallSpec = { ...upper, winW: Math.min(s.winW, 1.0), winH: s.winH * 0.85, cellW: Math.max(2.6, s.cellW) };
  const solid = SOLID(s.mat, s.seed % 9973, s.base);
  const groundShop: WallSpec = { kind: 4, seed: s.seed % 9973, cellW: 2.6, cellH: s.groundH - 0.75, winW: (s.seed * 7 + 3) % 10, winH: 0, sill: 0, mat: s.mat, originV: 0, baseY: s.base, lit: 1, floors: 1 };
  const groundResi: WallSpec = { kind: 2, seed: (s.seed + 7) % 9973, cellW: s.cellW, cellH: s.groundH, winW: s.winW, winH: Math.min(s.winH, s.groundH - 1.4), sill: 1.0, mat: s.mat, originV: 0, baseY: s.base, lit: s.lit, floors: 1 };
  const groundLobby: WallSpec = { ...groundShop, winW: 10, cellW: 3.2, seed: (s.seed + 3) % 9973 };
  const groundSpec = s.ground === 'shop' ? groundShop : s.ground === 'lobby' ? groundLobby : s.ground === 'resi' ? groundResi : solid;
  // faces: ground band and upper band per face
  const hw = s.w / 2, hd = s.d / 2;
  const K = [L(-hw, hd), L(hw, hd), L(hw, -hd), L(-hw, -hd)];
  for (let i = 0; i < 4; i++) {
    const a = K[i], b = K[(i + 1) % 4];
    const ex = s.exposed[i];
    const g = i === 0 ? groundSpec : ex ? (i === 2 ? solid : groundResi) : solid;
    const u = i === 0 ? upper : i === 2 ? (ex ? back : solid) : ex ? upper : solid;
    if (!s.hollow) fb.wall(a.x, a.z, b.x, b.z, s.base, s.base + s.groundH, s.color, g);
    fb.wall(a.x, a.z, b.x, b.z, s.base + s.groundH, top, s.color, u);
  }
  // roof inside the parapet
  fb.flat(s.cx, s.cz, s.w, s.d, H, s.yaw, C('#5f5c58'), { ...ROOF, seed: s.seed % 997 });
  innerWalls(fb, s.cx, s.cz, s.w - 0.5, s.d - 0.5, H, top, s.yaw, s.color, solid);
  if (s.hollow) ctx.physics.addStaticBox(s.cx, (top + s.base + s.groundH) / 2, s.cz, hw, (top - s.base - s.groundH) / 2, hd, s.yaw);
  else if (s.groundH === 0) ctx.physics.addStaticBox(s.cx, (top + s.base) / 2, s.cz, hw, (top - s.base) / 2, hd, s.yaw);
  else ctx.physics.addStaticBox(s.cx, top / 2, s.cz, hw, top / 2, hd, s.yaw);

  const tc = s.trimColor;
  const pt = (lx: number, y: number, lz: number, sx: number, syy: number, sz: number, col: THREE.Color, t: TrimParams, pitch = 0) => { const p = L(lx, lz); tb.box(p.x, y, p.z, sx, syy, sz, s.yaw, col, t, pitch); };
  // parapet cap
  pt(0, top + 0.06, hd - 0.12, s.w + 0.04, 0.12, 0.32, tc, T_STONE); pt(0, top + 0.06, -hd + 0.12, s.w + 0.04, 0.12, 0.32, tc, T_STONE);
  { const p1 = L(hw - 0.12, 0), p2 = L(-hw + 0.12, 0); tb.box(p1.x, top + 0.06, p1.z, 0.32, 0.12, s.d - 0.6, s.yaw, tc, T_STONE); tb.box(p2.x, top + 0.06, p2.z, 0.32, 0.12, s.d - 0.6, s.yaw, tc, T_STONE); } // side caps stop short of the front/back caps (no coplanar overlap at the corners)
  // cornice / bands on the front (and exposed sides)
  if (s.cornice === 'heavy') {
    pt(0, top - 0.35, hd + 0.25, s.w + 0.5, 0.55, 0.5, tc, T_STONE);
    pt(0, top - 0.82, hd + 0.08, s.w, 0.35, 0.16, tc, T_STONE);
    const nb = Math.floor(s.w / 1.1);
    for (let k = 0; k < nb; k++) pt(-s.w / 2 + 0.55 + k * (s.w - 1.1) / Math.max(1, nb - 1), top - 0.78, hd + 0.2, 0.16, 0.4, 0.3, tc, T_STONE);
    for (const side of [1, 3]) if (s.exposed[side]) { const sx = side === 1 ? 1 : -1; const p = L(sx * (hw + 0.25), 0); tb.box(p.x, top - 0.35, p.z, 0.5, 0.55, s.d + 0.5, s.yaw, tc, T_STONE); }
  } else if (s.cornice === 'simple') {
    pt(0, top - 0.1, hd + 0.12, s.w + 0.2, 0.3, 0.24, tc, T_STONE);
  } else if (s.cornice === 'bands') {
    for (let f = 1; f <= s.floors; f++) pt(0, s.base + s.groundH + f * s.floorH - 0.05, hd + 0.06, s.w + 0.04, 0.16, 0.12, tc, T_PAINT);
  }
  // belt course over the ground floor
  pt(0, s.base + s.groundH - 0.05, hd + 0.08, s.w, 0.28, 0.16, tc, T_STONE);
  // window sills on the front (and exposed sides)
  if (s.mat !== 5) {
    const B = bays(s.w, s.cellW);
    const winW = Math.min(s.winW, B.cw - 0.4);
    for (let f = 0; f < s.floors; f++) {
      const y = s.base + s.groundH + f * s.floorH + s.sill - 0.04;
      for (let i = 0; i < B.n; i++) pt(B.at(i), y, hd + 0.07, winW + 0.18, 0.08, 0.16, tc, T_STONE);
    }
    for (const side of [1, 3]) if (s.exposed[side]) {
      const SB = bays(s.d, s.cellW); const sw = Math.min(s.winW, SB.cw - 0.4);
      for (let f = 0; f < s.floors; f++) for (let i = 0; i < SB.n; i++) {
        const lz = side === 1 ? -SB.at(i) : SB.at(i); const lx = side === 1 ? hw + 0.07 : -hw - 0.07;
        const p = L(lx, lz); tb.box(p.x, s.base + s.groundH + f * s.floorH + s.sill - 0.04, p.z, 0.16, 0.08, sw + 0.18, s.yaw, tc, T_STONE);
      }
    }
  }
  // ground floor: shop sign, awning, door
  if (s.hollow) { /* the store builds its own front */ } else if (s.ground === 'shop') {
    const sw = Math.min(s.w - 1.2, 8.5);
    const p = L(0, hd + 0.1);
    ctx.signs.push({ x: p.x, y: s.base + s.groundH - 0.42, z: p.z, yaw: s.yaw, w: sw, h: sw * 0.25 > 0.75 ? 0.75 : sw * 0.25, idx: s.brand });
    pt(0, s.base + s.groundH - 0.42, hd + 0.05, sw + 0.2, 0.86, 0.08, C('#1e1e1e'), T_METAL);
    { // real shop glass: one pane per bay (street side), shattered by bullets via worldGlass
      const B = bays(s.w - 0.4, 2.6); const gy0 = s.base + 0.55, gy1 = s.base + s.groundH - 0.95;
      for (let i = 0; i < B.n; i++) { const q = L(B.at(i), hd + 0.04); worldGlass.addOverlay(q.x, (gy0 + gy1) / 2, q.z, s.yaw, B.cw - 0.25, gy1 - gy0); }
    }
    if (s.awning) {
      const ac = C(['#7a1f1f', '#1f4e3d', '#22305a', '#5a3a1f', '#6b1f4f', '#2b2b2b', '#a8551c'][r.int(0, 6)]);
      const aw = s.w - 0.6, depth = 1.5, y = s.base + s.groundH - 1.05;
      pt(0, y, hd + depth / 2, aw, 0.05, depth + 0.1, ac, T_FABRIC, 0.35);
      pt(0, y - 0.38, hd + depth - 0.02, aw, 0.32, 0.03, ac, T_FABRIC);
    }
    if (r.chance(0.35)) ctx.signs.push({ ...(L(hw - 0.6, hd + 0.75)), y: s.base + s.groundH + 1.6, yaw: s.yaw + Math.PI / 2, w: 1.5, h: 0.5, idx: (s.brand + 5) % 32, blade: true });
  } else if (s.ground === 'resi' || s.ground === 'lobby') {
    // entrance door with a lit transom and a hood
    const B = bays(s.w, s.cellW); const dx = B.at(Math.floor(B.n / 2));
    pt(dx, s.base + 1.15, hd + 0.03, 1.15, 2.3, 0.08, C(['#2b2420', '#3a2a22', '#1f2a24', '#3b1f1f'][r.int(0, 3)]), [0.5, 0.1, 0, 0]);
    pt(dx, s.base + 2.45, hd + 0.04, 1.15, 0.28, 0.06, C('#f3d9a0'), T_NIGHTGLOW(1.6));
    pt(dx, s.base + 2.75, hd + 0.3, 1.6, 0.12, 0.6, tc, T_STONE);
    pt(dx, s.base + 0.08, hd + 0.35, 1.6, 0.16, 0.7, C('#9a958c'), T_STONE);
    if (s.stoop && s.ground === 'resi') {
      // brownstone stoop: raised parlour door, stone stair with cheek walls and iron railings
      const stone = C('#8f877b'), iron = C('#1f1f21');
      pt(dx, s.base + 1.2 + 1.15, hd + 0.05, 1.15, 2.3, 0.08, C('#2a1d17'), [0.5, 0.1, 0, 0]);
      pt(dx, s.base + 0.6, hd + 0.5, 1.9, 1.2, 1.0, stone, T_STONE);
      for (let k = 0; k < 6; k++) pt(dx, s.base + (6 - k) * 0.1, hd + 1.0 + k * 0.3 + 0.15, 1.7, (6 - k) * 0.2, 0.3, stone, T_STONE);
      for (const sx of [-0.88, 0.88]) {
        const pa = L(dx + sx, hd + 1.0), pb = L(dx + sx, hd + 2.8);
        tb.beam(pa.x, s.base + 2.15, pa.z, pb.x, s.base + 0.95, pb.z, 0.025, 0.025, iron, T_IRON);
        tb.beam(pa.x, s.base + 1.2, pa.z, pa.x, s.base + 2.2, pa.z, 0.03, 0.03, iron, T_IRON);
        tb.beam(pb.x, s.base + 0.0, pb.z, pb.x, s.base + 1.0, pb.z, 0.03, 0.03, iron, T_IRON);
      }
    }
    if (s.ground === 'lobby') ctx.signs.push({ ...(L(dx, hd + 0.62)), y: s.base + 3.1, yaw: s.yaw, w: 2.4, h: 0.4, idx: s.brand });
  }
  // fire escape on the front
  if (s.fireEscape && s.floors >= 3 && s.w >= 9) {
    const B = bays(s.w, s.cellW); const w = Math.min(s.w - 1.0, B.cw * 2 + 0.6); const x0 = B.n >= 3 ? (B.at(1) + B.at(Math.min(B.n - 1, 2))) / 2 : 0;
    const iron = C('#2a2a2c'), dep = 1.15, zf = hd + dep;
    for (let f = 0; f < s.floors; f++) {
      const y = s.base + s.groundH + f * s.floorH + 0.05;
      pt(x0, y, hd + dep / 2, w, 0.06, dep, iron, T_IRON);
      pt(x0, y + 1.0, zf, w, 0.04, 0.04, iron, T_IRON);
      pt(x0, y + 0.5, zf, w, 0.03, 0.03, iron, T_IRON);
      for (const sx of [-1, 1]) { pt(x0 + sx * w / 2, y + 1.0, hd + dep / 2, 0.04, 0.04, dep, iron, T_IRON); pt(x0 + sx * w / 2, y + 0.5, zf, 0.04, 1.0, 0.04, iron, T_IRON); }
      pt(x0, y + 0.5, zf, 0.04, 1.0, 0.04, iron, T_IRON);
      if (f < s.floors - 1) {
        // stair flight between platforms, alternating direction
        const dir = f % 2 === 0 ? 1 : -1; const run = w - 1.4, rise = s.floorH;
        const ax = x0 - dir * run / 2, bx = x0 + dir * run / 2;
        for (const oz of [hd + 0.3, hd + 0.85]) { const pa = L(ax, oz), pb = L(bx, oz); tb.beam(pa.x, y + 0.05, pa.z, pb.x, y + rise, pb.z, 0.05, 0.22, iron, T_IRON); }
        const pa = L(ax, hd + 0.58), pb = L(bx, hd + 0.58); tb.beam(pa.x, y + 0.95, pa.z, pb.x, y + rise + 0.95, pb.z, 0.04, 0.04, iron, T_IRON);
        void cy; void sy;
      }
    }
    // drop ladder
    const yl = s.base + s.groundH + 0.05;
    for (const sx of [-0.25, 0.25]) pt(x0 + w / 2 - 0.5 + sx, yl - 1.0, zf - 0.1, 0.04, 2.0, 0.04, iron, T_IRON);
  }
  // balconies (mid-rise and beach blocks)
  if (s.balconies) {
    const B = bays(s.w, s.cellW);
    for (let f = 1; f < s.floors; f++) for (let i = 0; i < B.n; i++) {
      if ((i + f) % 2 === 1 && B.n > 2) continue;
      const y = s.base + s.groundH + f * s.floorH;
      const bw = Math.min(B.cw - 0.2, 3.2);
      pt(B.at(i), y, hd + 0.6, bw, 0.18, 1.2, tc, T_STONE);
      pt(B.at(i), y + 0.6, hd + 1.18, bw, 0.95, 0.04, C('#9fb4bb'), T_GLASS);
      pt(B.at(i), y + 1.08, hd + 1.18, bw, 0.05, 0.07, C('#3b3b3d'), T_METAL);
    }
  }
  rooftop(ctx, tb, fb, s.cx, s.cz, s.w, s.d, s.yaw, H, s.roofItems, r, s.mat, s.color);
}

/** Rooftop plant: water tanks, AC units, bulkheads, chimneys, antennas, dishes, skylights. */
export function rooftop(ctx: BuildCtx, tb: TrimBuilder, fb: FacadeBuilder, cx: number, cz: number, w: number, d: number, yaw: number, H: number, items: number, r: Rng, mat: number, color: THREE.Color) {
  const { L } = frame(cx, cz, yaw);
  const free = (m: number) => ({ lx: r.range(-w / 2 + m, w / 2 - m), lz: r.range(-d / 2 + m, d / 2 - m) });
  const metal = C('#b3b5b4'), dark = C('#3a3b3d');
  if (w < 4 || d < 4) return;
  // stair bulkhead
  if (items >= 1 && w > 7) {
    const q = free(2.2); const p = L(q.lx, q.lz);
    fb.box(p.x, p.z, 2.4, 2.6, H, H + 2.6, yaw, color, [SOLID(mat, 7, H)], { ...ROOF, seed: 3 }, C('#5a5754'));
    const dp = L(q.lx, q.lz + 1.31); tb.box(dp.x, H + 1.05, dp.z, 0.9, 2.05, 0.05, yaw, C('#4b4f52'), T_METAL);
  }
  for (let k = 0; k < items; k++) {
    const roll = r.next();
    const q = free(1.6); const p = L(q.lx, q.lz);
    if (roll < 0.35) {
      // AC unit with a fan
      const ry = yaw + (r.chance(0.5) ? 0 : Math.PI / 2);
      tb.box(p.x, H + 0.55, p.z, 1.5, 1.1, 1.1, ry, metal, [0.5, 0.6, 2, 0]);
      tb.cyl(p.x, H + 1.1, p.z, 0.42, 0.42, 0.06, 10, dark, T_METAL);
      tb.box(p.x, H + 0.04, p.z, 1.7, 0.08, 1.3, ry, C('#6b6b6b'), T_METAL);
    } else if (roll < 0.52 && w > 8) {
      // wooden water tank on a steel stand
      const wood = C(['#6b4e36', '#5e4634', '#7a5a3e'][r.int(0, 2)]);
      for (const [ox, oz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const lp = L(q.lx + ox * 1.1, q.lz + oz * 1.1); tb.box(lp.x, H + 1.5, lp.z, 0.14, 3, 0.14, yaw, dark, T_IRON); }
      tb.cyl(p.x, H + 3, p.z, 1.7, 1.7, 3.6, 14, wood, [0.9, 0, 2, 0]);
      for (const hy of [0.6, 1.8, 3.0]) tb.cyl(p.x, H + 3 + hy, p.z, 1.73, 1.73, 0.06, 14, dark, T_IRON);
      tb.cyl(p.x, H + 6.6, p.z, 1.85, 0.12, 1.1, 14, C('#4a4a48'), T_ROUGH);
    } else if (roll < 0.66) {
      // chimney / vent stack
      tb.box(p.x, H + 0.8, p.z, 0.7, 1.6, 0.7, yaw, C('#7a4434'), T_ROUGH);
      tb.box(p.x, H + 1.65, p.z, 0.82, 0.12, 0.82, yaw, C('#8f8a80'), T_STONE);
    } else if (roll < 0.78) {
      // antenna mast
      tb.cyl(p.x, H, p.z, 0.05, 0.03, 5.5, 5, dark, T_METAL);
      for (const hy of [3.2, 4.2, 5.0]) { const a = L(q.lx - 0.7, q.lz), b = L(q.lx + 0.7, q.lz); tb.beam(a.x, H + hy, a.z, b.x, H + hy, b.z, 0.03, 0.03, dark, T_METAL); }
      tb.sphere(p.x, H + 5.55, p.z, 0.07, C('#ff3020'), T_GLOW(3));
    } else if (roll < 0.88) {
      // satellite dish
      tb.cyl(p.x, H, p.z, 0.05, 0.05, 0.9, 5, dark, T_METAL);
      tb.cyl(p.x, H + 0.9, p.z, 0.45, 0.05, 0.25, 12, C('#e4e2dc'), T_PAINT, yaw + r.range(0, 6), -1.0);
    } else {
      // skylight
      tb.box(p.x, H + 0.25, p.z, 1.6, 0.5, 1.6, yaw, C('#2c3438'), T_GLASS);
      tb.box(p.x, H + 0.1, p.z, 1.8, 0.2, 1.8, yaw, C('#8a8580'), T_STONE);
    }
  }
  // vent pipes
  for (let k = 0; k < 3; k++) { const q = free(0.8); const p = L(q.lx, q.lz); tb.cyl(p.x, H, p.z, 0.08, 0.08, 0.7, 6, C('#55585a'), T_METAL); }
  void ctx;
}

export interface TowerSpec { cx: number; cz: number; w: number; d: number; base: number; height: number; seed: number; helipad: string | null; yaw?: number }
/** Downtown tower: podium with lobby glazing, shaft (curtain wall or ribbon windows), setbacks, crown and roof plant. */
export function tower(ctx: BuildCtx, t: TowerSpec) {
  const r = new Rng(t.seed);
  const yaw = t.yaw ?? 0;
  const fb = ctx.fac.at(t.cx, t.cz), tb = ctx.trim.at(t.cx, t.cz);
  const style = r.next() < 0.6 ? 'glass' : r.chance(0.5) ? 'ribbon' : 'stone';
  const tint = C(r.pick(GLASS_TINTS));
  const stone = C(r.pick(style === 'stone' ? STONE_COLORS : CONCRETE_COLORS));
  const seed = t.seed % 9973;
  const podiumH = 9.2;
  const lobby: WallSpec = { kind: 4, seed, cellW: 3.4, cellH: 5.2, winW: 10, winH: 0, sill: 0, mat: 3, originV: 0, baseY: t.base, lit: 1, floors: 1 };
  const podUpper: WallSpec = { kind: 2, seed, cellW: 3.0, cellH: 4.0, winW: 2.4, winH: 2.4, sill: 0.8, mat: 3, originV: 5.2, baseY: t.base, lit: 0.6, floors: 1 };
  fb.box(t.cx, t.cz, t.w, t.d, t.base, t.base + 5.2, yaw, stone, [lobby], null);
  fb.box(t.cx, t.cz, t.w, t.d, t.base + 5.2, t.base + podiumH, yaw, stone, [podUpper], { ...ROOF, seed }, C('#6a6763'));
  // canopy over the lobby on the front faces
  const { L } = frame(t.cx, t.cz, yaw);
  for (let i = 0; i < 4; i++) {
    const ang = yaw + i * Math.PI / 2; const len = i % 2 === 0 ? t.w : t.d, off = i % 2 === 0 ? t.d / 2 : t.w / 2;
    const p = { x: t.cx + Math.sin(ang) * (off + 1.4), z: t.cz + Math.cos(ang) * (off + 1.4) };
    tb.box(p.x, t.base + 5.4, p.z, Math.min(len * 0.45, 12), 0.3, 2.8, ang, C('#2e3134'), T_METAL);
    if (i === 0) ctx.signs.push({ x: t.cx + Math.sin(ang) * (off + 0.08), y: t.base + 6.4, z: t.cz + Math.cos(ang) * (off + 0.08), yaw: ang, w: 6, h: 0.9, idx: [7, 11, 8, 2][seed % 4] });
  }
  // shaft with setbacks
  const inset = r.range(1.0, 2.5);
  let w = t.w - inset * 2, d = t.d - inset * 2, y = t.base + podiumH;
  const tiers = t.height > 70 ? r.int(1, 3) : 1;
  const floorH = 3.7;
  for (let k = 0; k < tiers; k++) {
    const yTop = k === tiers - 1 ? t.base + t.height : y + (t.base + t.height - y) * r.range(0.45, 0.65);
    const floors = Math.max(1, Math.floor((yTop - y - 1.5) / floorH));
    const spec: WallSpec = style === 'glass'
      ? { kind: 1, seed: seed + k, cellW: 1.6, cellH: floorH, winW: 0, winH: 0, sill: 0, mat: 7, originV: y - t.base, baseY: t.base, lit: r.range(0.35, 0.65), floors }
      : style === 'ribbon'
        ? { kind: 2, seed: seed + k, cellW: 4.5, cellH: floorH, winW: 4.1, winH: 1.9, sill: 1.0, mat: 2, originV: y - t.base, baseY: t.base, lit: r.range(0.35, 0.6), floors }
        : { kind: 2, seed: seed + k, cellW: 2.2, cellH: floorH, winW: 1.3, winH: 2.2, sill: 0.7, mat: 3, originV: y - t.base, baseY: t.base, lit: r.range(0.3, 0.55), floors };
    const col = style === 'glass' ? tint : stone;
    fb.box(t.cx, t.cz, w, d, y, yTop, yaw, col, [spec], { ...ROOF, seed: seed + 11 }, C('#5d5a57'));
    // crown band / spandrel at the top of each tier
    fb.box(t.cx, t.cz, w + 0.3, d + 0.3, yTop - 0.2, yTop + 1.4, yaw, style === 'glass' ? C('#8d9294') : stone, [SOLID(7, seed, t.base)], { ...ROOF, seed: seed + 13 }, C('#5d5a57'));
    if (style === 'glass' && r.chance(0.45)) {
      // vertical fins
      for (let i = 0; i < 4; i++) {
        const len = i % 2 === 0 ? w : d, off = (i % 2 === 0 ? d : w) / 2; const ang = yaw + i * Math.PI / 2;
        const n = Math.floor(len / 3.2);
        for (let j = 0; j <= n; j++) {
          const lat = -len / 2 + (len / n) * j;
          const px = t.cx + Math.sin(ang) * (off + 0.2) + Math.cos(ang) * lat, pz = t.cz + Math.cos(ang) * (off + 0.2) - Math.sin(ang) * lat;
          tb.box(px, (y + yTop) / 2, pz, 0.16, yTop - y, 0.4, ang, C('#cfd3d4'), T_METAL);
        }
      }
    }
    if (k === tiers - 1) {
      // roof plant / helipad
      if (t.helipad) {
        const hp = { x: t.cx, z: t.cz };
        tb.cyl(hp.x, yTop + 1.4, hp.z, Math.min(w, d) * 0.42, Math.min(w, d) * 0.42, 0.2, 24, C('#3c3f42'), T_ROUGH);
        const hy = yTop + 1.62;
        tb.box(hp.x - 1.6 * Math.cos(yaw), hy, hp.z + 1.6 * Math.sin(yaw), 0.7, 0.02, 5, yaw, C('#f2f2f2'), T_PAINT);
        tb.box(hp.x + 1.6 * Math.cos(yaw), hy, hp.z - 1.6 * Math.sin(yaw), 0.7, 0.02, 5, yaw, C('#f2f2f2'), T_PAINT);
        tb.box(hp.x, hy, hp.z, 3.9, 0.02, 0.7, yaw, C('#f2f2f2'), T_PAINT);
        const R = Math.min(w, d) * 0.42;
        for (let a = 0; a < 12; a++) tb.sphere(hp.x + Math.cos(a / 12 * 6.283) * R, hy + 0.05, hp.z + Math.sin(a / 12 * 6.283) * R, 0.1, C('#ffd060'), T_NIGHTGLOW(4));
        ctx.helipads.push({ x: hp.x, y: hy, z: hp.z, name: t.helipad });
        ctx.physics.addStaticBox(hp.x, yTop + 1.45, hp.z, R * 0.7, 0.1, R * 0.7, yaw);
      } else {
        const pw = w * r.range(0.35, 0.55), pd = d * r.range(0.35, 0.55);
        fb.box(t.cx, t.cz, pw, pd, yTop + 1.4, yTop + 1.4 + r.range(3, 6), yaw, C('#7c8084'), [SOLID(7, seed, t.base)], { ...ROOF, seed: seed + 17 }, C('#555'));
        rooftop(ctx, tb, fb, t.cx, t.cz, w - 2, d - 2, yaw, yTop + 1.4, r.int(2, 4), r, 2, stone);
        if (t.height > 90 && r.chance(0.6)) { tb.cyl(t.cx + pw * 0.3, yTop + 1.4, t.cz, 0.3, 0.06, r.range(12, 22), 6, C('#b9bcbe'), T_METAL); }
        if (r.chance(0.3) && w > 12) ctx.billboards.push({ x: t.cx, y: yTop + 1.4, z: t.cz - d / 4, yaw: yaw + r.int(0, 3) * Math.PI / 2, idx: r.int(0, 7), w: Math.min(14, w * 0.8) });
      }
    }
    y = yTop + 1.4; w *= r.range(0.7, 0.85); d *= r.range(0.7, 0.85);
  }
  ctx.physics.addStaticBox(t.cx, t.base + podiumH / 2, t.cz, t.w / 2, podiumH / 2, t.d / 2, yaw);
  const sw = t.w - inset * 2, sd = t.d - inset * 2;
  ctx.physics.addStaticBox(t.cx, (t.base + podiumH + t.base + t.height) / 2, t.cz, sw / 2, (t.height - podiumH) / 2, sd / 2, yaw);
  void L;
}

export interface HouseSpec { cx: number; cz: number; yaw: number; w: number; d: number; base: number; seed: number; lotW: number; lotD: number }
/** Detached house with a pitched roof, porch, chimney and front yard. */
export function house(ctx: BuildCtx, h: HouseSpec) {
  const r = new Rng(h.seed);
  const fb = ctx.fac.at(h.cx, h.cz), tb = ctx.trim.at(h.cx, h.cz);
  const { L } = frame(h.cx, h.cz, h.yaw);
  const floors = r.chance(0.6) ? 2 : 1, fH = 3.0;
  const mat = r.next() < 0.55 ? 4 : r.chance(0.6) ? 1 : 0;
  const color = C(mat === 4 ? r.pick(SIDING_COLORS) : mat === 1 ? r.pick(PASTEL_COLORS) : r.pick(BRICK_COLORS));
  const hw = h.w, hd = h.d;
  const seed = h.seed % 9973;
  const spec: WallSpec = { kind: 2, seed, cellW: 2.6, cellH: fH, winW: 1.1, winH: 1.45, sill: 0.9, mat, originV: 0.3, baseY: h.base, lit: 0.45, floors };
  const top = h.base + 0.3 + floors * fH;
  fb.box(h.cx, h.cz, hw, hd, h.base, top, h.yaw, color, [spec], null);
  // foundation band
  const tc = C('#ece8df');
  { const p = L(0, 0); tb.box(p.x, h.base + 0.15, p.z, hw + 0.08, 0.3, hd + 0.08, h.yaw, C('#8f8a82'), T_STONE); }
  const roofC = C(r.pick(ROOF_COLORS));
  const roofSpec: WallSpec = { kind: 6, seed, cellW: 1, cellH: 1, winW: 0, winH: 0, sill: 0, mat: 0, originV: 0, baseY: 0, lit: 0, floors: 0 };
  const rise = r.range(1.8, 2.8);
  if (r.chance(0.6)) fb.gable(h.cx, h.cz, hw, hd, top, top + rise, h.yaw, 0.45, roofC, roofSpec, color, SOLID(mat, seed, h.base));
  else fb.hip(h.cx, h.cz, hw, hd, top, top + rise, h.yaw, 0.45, roofC, roofSpec);
  // fascia boards and corner trims
  for (const sz of [1, -1]) { const p = L(0, sz * (hd / 2 + 0.45)); tb.box(p.x, top - 0.05 - 0.45 * rise / (hd / 2), p.z, hw + 0.9, 0.18, 0.06, h.yaw, tc, T_PAINT); }
  for (const [sx, sz] of [[-1, 1], [1, 1], [1, -1], [-1, -1]]) { const p = L(sx * (hw / 2 + 0.03), sz * (hd / 2 + 0.03)); tb.box(p.x, (h.base + top) / 2, p.z, 0.14, top - h.base, 0.14, h.yaw, tc, T_PAINT); }
  // window sills / shutters on the front
  const B = bays(hw, 2.6);
  for (let f = 0; f < floors; f++) for (let i = 0; i < B.n; i++) {
    const y = h.base + 0.3 + f * fH + 0.86; const p = L(B.at(i), hd / 2 + 0.06);
    tb.box(p.x, y, p.z, 1.3, 0.07, 0.14, h.yaw, tc, T_PAINT);
    if (mat === 4 && r.chance(0.7)) for (const sx of [-1, 1]) { const q = L(B.at(i) + sx * 0.78, hd / 2 + 0.04); tb.box(q.x, y + 0.78, q.z, 0.4, 1.5, 0.05, h.yaw, C(['#2f3e46', '#5c2a2a', '#2d4a3e', '#1f1f1f'][seed % 4]), T_PAINT); }
  }
  // porch: deck, posts, roof, steps, door
  const porchW = Math.min(hw * 0.7, 6), pz = hd / 2 + 0.9;
  { const p = L(0, pz); tb.box(p.x, h.base + 0.22, p.z, porchW, 0.44, 1.8, h.yaw, C('#8a8178'), T_STONE); }
  for (const sx of [-1, 1]) { const p = L(sx * (porchW / 2 - 0.15), hd / 2 + 1.65); tb.box(p.x, h.base + 1.7, p.z, 0.16, 2.6, 0.16, h.yaw, tc, T_PAINT); }
  { const p = L(0, pz + 0.1); tb.box(p.x, h.base + 3.05, p.z, porchW + 0.4, 0.14, 2.2, h.yaw, roofC, T_ROUGH, -0.12); }
  { const p = L(0, hd / 2 + 2.05); tb.box(p.x, h.base + 0.1, p.z, 1.4, 0.2, 0.5, h.yaw, C('#8a8178'), T_STONE); }
  { const p = L(B.n > 1 ? B.at(0) + 0.6 : 0, hd / 2 + 0.03); tb.box(p.x, h.base + 1.5, p.z, 1.0, 2.2, 0.08, h.yaw, C(['#7a2d2d', '#2c4a5a', '#3a3a3a', '#6b5a3a', '#f0ece2'][r.int(0, 4)]), T_PAINT); tb.sphere(L(B.n > 1 ? B.at(0) + 0.6 : 0, hd / 2 + 0.5).x, h.base + 2.75, L(B.n > 1 ? B.at(0) + 0.6 : 0, hd / 2 + 0.5).z, 0.1, C('#ffd9a0'), T_NIGHTGLOW(4)); }
  // chimney
  if (r.chance(0.65)) { const p = L(hw / 2 - 0.5, -hd / 4); tb.box(p.x, (h.base + top + rise + 1) / 2, p.z, 0.8, top + rise + 1 - h.base, 0.7, h.yaw, C('#7d4636'), T_ROUGH); }
  // front yard: hedge / picket fence with a gap for the path, path slab
  const yz = h.lotD / 2 - 0.25;
  const fence = r.chance(0.5);
  for (const sx of [-1, 1]) {
    const len = h.lotW / 2 - 0.8, cxl = sx * (0.8 + len / 2);
    const p = L(cxl, yz);
    if (fence) { tb.box(p.x, h.base + 0.45, p.z, len, 0.08, 0.05, h.yaw, tc, T_PAINT); tb.box(p.x, h.base + 0.85, p.z, len, 0.08, 0.05, h.yaw, tc, T_PAINT); for (let k = 0; k < len / 0.5; k++) { const q = L(sx * (0.8 + k * 0.5 + 0.25), yz); tb.box(q.x, h.base + 0.5, q.z, 0.08, 1.0, 0.04, h.yaw, tc, T_PAINT); } }
    else tb.box(p.x, h.base + 0.5, p.z, len, 1.0, 0.7, h.yaw, C('#3f5d2f'), [0.95, 0, 2, 0]);
  }
  { const p = L(0, (hd / 2 + 2.2 + yz) / 2); tb.box(p.x, h.base + 0.02, p.z, 1.2, 0.04, Math.max(0.1, yz - hd / 2 - 2.2), h.yaw, C('#a49e94'), T_STONE); }
  ctx.physics.addStaticBox(h.cx, (h.base + top) / 2, h.cz, hw / 2, (top - h.base) / 2, hd / 2, h.yaw);
  { const p = L(0, pz); ctx.physics.addStaticBox(p.x, h.base + 0.22, p.z, porchW / 2, 0.22, 0.9, h.yaw); }
}

export interface WarehouseSpec { cx: number; cz: number; w: number; d: number; base: number; h: number; seed: number; yaw?: number; color?: THREE.Color }
/** Corrugated warehouse with clerestory windows, roll-up doors, loading dock and a low gable roof. */
export function warehouse(ctx: BuildCtx, s: WarehouseSpec) {
  const r = new Rng(s.seed);
  const yaw = s.yaw ?? 0;
  const fb = ctx.fac.at(s.cx, s.cz), tb = ctx.trim.at(s.cx, s.cz);
  const { L } = frame(s.cx, s.cz, yaw);
  const col = s.color ?? C(['#8f9a9c', '#b7a48a', '#7f8f84', '#9a8a7a', '#a3a9ad', '#6f7f8f'][r.int(0, 5)]);
  const seed = s.seed % 9973;
  const wall: WallSpec = { kind: 2, seed, cellW: 4.5, cellH: s.h, winW: 3.6, winH: 1.0, sill: s.h - 1.8, mat: 5, originV: 0, baseY: s.base, lit: 0.3, floors: 1 };
  fb.box(s.cx, s.cz, s.w, s.d, s.base, s.base + s.h, yaw, col, [wall], null);
  const roofC = C('#7d817f');
  fb.gable(s.cx, s.cz, s.w, s.d, s.base + s.h, s.base + s.h + Math.min(3, s.d * 0.1), yaw, 0.3, roofC, { ...SOLID(5, seed, 0), kind: 3 }, col, SOLID(5, seed, s.base));
  // roll-up doors along the front with a loading dock
  const nDoors = Math.max(1, Math.floor(s.w / 9));
  for (let i = 0; i < nDoors; i++) {
    const lx = -s.w / 2 + (s.w / nDoors) * (i + 0.5);
    const a = L(lx - 2, s.d / 2 + 0.06), b = L(lx + 2, s.d / 2 + 0.06);
    fb.wall(a.x, a.z, b.x, b.z, s.base + 1.2, s.base + 5.4, C(['#c8b04a', '#8a9aa6', '#b55a3c', '#d8d4cc'][seed % 4]), { kind: 7, seed, cellW: 1, cellH: 1, winW: 0, winH: 0, sill: 0, mat: 7, originV: 0, baseY: s.base, lit: 0, floors: 0 });
    const p = L(lx, s.d / 2 + 0.1); tb.box(p.x, s.base + 5.6, p.z, 4.4, 0.3, 0.2, yaw, C('#3a3a3a'), T_METAL);
    const lamp = L(lx, s.d / 2 + 0.35); tb.box(lamp.x, s.base + 6.2, lamp.z, 0.5, 0.18, 0.4, yaw, C('#fff0c8'), T_NIGHTGLOW(3));
  }
  { const p = L(0, s.d / 2 + 1.2); tb.box(p.x, s.base + 0.6, p.z, s.w - 1, 1.2, 2.4, yaw, C('#8d8a84'), T_STONE); ctx.physics.addStaticBox(p.x, s.base + 0.6, p.z, (s.w - 1) / 2, 0.6, 1.2, yaw); }
  for (let i = 0; i < nDoors; i++) { const lx = -s.w / 2 + (s.w / nDoors) * (i + 0.5); for (const sx of [-1, 1]) { const p = L(lx + sx * 2.3, s.d / 2 + 2.45); tb.box(p.x, s.base + 0.65, p.z, 0.35, 1.0, 0.2, yaw, C('#1b1b1b'), [0.9, 0, 0, 0]); } }
  // roof vents
  for (let k = 0; k < Math.floor(s.w / 12); k++) { const p = L(-s.w / 2 + 6 + k * 12, 0); tb.cyl(p.x, s.base + s.h + Math.min(3, s.d * 0.1) - 0.2, p.z, 0.45, 0.35, 1.0, 10, C('#a5a8a6'), T_METAL); }
  ctx.physics.addStaticBox(s.cx, s.base + s.h / 2 + 0.6, s.cz, s.w / 2, s.h / 2 + 0.6, s.d / 2, yaw);
}
