/**
 * R9-W street character: sidewalk and road dressing that costs (almost) nothing at run time.
 * Everything is planned as pure data (`planStreetscape`, unit tested) and baked into the existing merged trim chunks
 * (`emitStreetscape`), so it adds triangles but no draw calls, no lights and no per-frame work.
 * Solid pieces keep to the kerb strip (0.5-1.8 m in from the kerb): the pedestrian walking line runs at ~2.25 m, doors sit at 4.5 m.
 */
import * as THREE from 'three';
import { Rng } from '../core/rng';
import type { Physics } from '../core/physics';
import { type CityMap, type Block, type Road, CURB_HEIGHT, STREETS, AVENUES } from './citymap';
import { type Chunked, type TrimBuilder, T_STONE, T_METAL, T_IRON, T_ROUGH, T_FABRIC, T_PAINT } from './builders';

export type PieceKind = 'bikerack' | 'bags' | 'planter' | 'kiosk' | 'shed' | 'guard' | 'plate' | 'manhole' | 'patch' | 'crack';
export interface Piece {
  kind: PieceKind; x: number; z: number; /** along-edge axis of the block edge it sits on */ ax: 'x' | 'z'; /** unit normal pointing to the road */ nx: number; nz: number;
  /** size along the edge (m) for sheds / patches */ len: number; seed: number; /** solid pieces get a small collider */ solid: boolean;
}
export interface Taken { x: number; z: number }
export interface StreetscapePlan { pieces: Piece[]; quality: number }

/** 0.35 low, 0.7 medium, 1 high. */
export function densityFor(q: string): number { return q === 'low' ? 0.35 : q === 'high' ? 1 : 0.7; }

class Grid {
  private cells = new Map<string, Taken[]>();
  constructor(private cell = 8) { }
  private key(x: number, z: number) { return `${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`; }
  add(p: Taken) { const k = this.key(p.x, p.z); const a = this.cells.get(k); if (a) a.push(p); else this.cells.set(k, [p]); }
  near(x: number, z: number, r: number): boolean {
    const c = this.cell, x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), z0 = Math.floor((z - r) / c), z1 = Math.floor((z + r) / c);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) { const a = this.cells.get(`${i},${j}`); if (a && a.some(p => Math.hypot(p.x - x, p.z - z) < r)) return true; }
    return false;
  }
}

const BUSY = new Set(['midtown', 'heights', 'financial', 'brickline', 'oldtown', 'juniper', 'eastbank']);
const DOWNTOWN = new Set(['midtown', 'heights', 'financial']);
const OLD = new Set(['brickline', 'oldtown', 'juniper']);

/** Plans the street dressing for every grid block. `taken` = existing furniture (lamps, trees, hydrants...), `trees` = tree positions (for tree guards). */
export function planStreetscape(city: CityMap, density: number, taken: Taken[], trees: Taken[] = []): StreetscapePlan {
  const grid = new Grid(); for (const t of taken) grid.add(t);
  const pieces: Piece[] = [];
  const roadAt = (ax: 'x' | 'z', fixed: number): Road | undefined => {
    let best: Road | undefined, bd = 1e9;
    for (const r of city.roads) { if (r.axis !== ax) continue; const d = Math.abs(r.coord - fixed); if (d < bd) { bd = d; best = r; } }
    return best && bd < best.half + 2 ? best : undefined;
  };
  for (const b of city.blocks) {
    if (b.kind === 'park' || b.kind === 'docks' || b.diag || b.district === 'hillside' || b.district === 'airfield' || b.district === 'vista') continue;
    if (b.x0 < AVENUES[0] || b.x1 > AVENUES[AVENUES.length - 1] || b.z0 < STREETS[0] || b.z1 > STREETS[STREETS.length - 1]) continue;
    planBlock(b, city, density, grid, pieces, roadAt);
  }
  // tree guards (iron fence around a pit): every other tree on busy streets
  const gr = new Rng(4242);
  for (const t of trees) if (density >= 0.7 && gr.chance(0.45 * density)) pieces.push({ kind: 'guard', x: t.x, z: t.z, ax: 'x', nx: 0, nz: 0, len: 1.5, seed: gr.int(1, 99999), solid: false });
  return { pieces, quality: density };
}

function planBlock(b: Block, city: CityMap, density: number, grid: Grid, out: Piece[], roadAt: (ax: 'x' | 'z', f: number) => Road | undefined) {
  const r = new Rng(b.id * 131 + 11);
  void city;
  const edges = [
    { ax: 'x' as const, fixed: b.z0, from: b.x0, to: b.x1, nx: 0, nz: -1 }, { ax: 'x' as const, fixed: b.z1, from: b.x0, to: b.x1, nx: 0, nz: 1 },
    { ax: 'z' as const, fixed: b.x0, from: b.z0, to: b.z1, nx: -1, nz: 0 }, { ax: 'z' as const, fixed: b.x1, from: b.z0, to: b.z1, nx: 1, nz: 0 },
  ];
  const busy = BUSY.has(b.district), downtown = DOWNTOWN.has(b.district), old = OLD.has(b.district);
  let shedBudget = (old || b.district === 'midtown') && density >= 0.7 && r.chance(0.4) ? 1 : 0;
  for (const e of edges) {
    const P = (s: number, inset: number) => e.ax === 'x' ? { x: s, z: e.fixed - e.nz * inset } : { x: e.fixed - e.nx * inset, z: s };
    const len = e.to - e.from;
    const mk = (kind: PieceKind, s: number, inset: number, l: number, solid: boolean): Piece => { const p = P(s, inset); return { kind, x: p.x, z: p.z, ax: e.ax, nx: e.nx, nz: e.nz, len: l, seed: r.int(1, 99999), solid }; };
    const road = roadAt(e.ax, e.ax === 'x' ? e.fixed + e.nz * 1 : e.fixed + e.nx * 1);
    // sidewalk shed + scaffold on a stretch with nothing else in it
    if (shedBudget > 0 && len > 50) {
      const L = 12;
      for (let attempt = 0; attempt < 8 && shedBudget > 0; attempt++) {
        const s0 = r.range(e.from + 14, e.to - 14 - L);
        let clear = true;
        for (let s = s0 - 1; s <= s0 + L + 1 && clear; s += 1) for (const inset of [0.6, 1.5, 2.5, 3.5, 4.3]) { const p = P(s, inset); if (grid.near(p.x, p.z, 1.1)) { clear = false; break; } }
        if (!clear) continue;
        const c = P(s0 + L / 2, 0); out.push({ kind: 'shed', x: c.x, z: c.z, ax: e.ax, nx: e.nx, nz: e.nz, len: L, seed: r.int(1, 9999), solid: true });
        for (let s = s0 - 1; s <= s0 + L + 1; s += 1) for (const inset of [0.6, 2.5, 4.3]) grid.add(P(s, inset));
        shedBudget--;
      }
    }
    // kerb-side dressing
    const n = Math.floor(len / 9);
    for (let k = 0; k < n; k++) {
      const s = r.range(e.from + 10, e.to - 10);
      const roll = r.next();
      const inset = r.range(0.8, 1.2);
      const p = P(s, inset);
      if (grid.near(p.x, p.z, 2.4)) continue;
      let piece: Piece | null = null;
      if (!busy) { if (roll < 0.2 * density) piece = mk('bags', s, 0.9, 1, false); }
      else if (downtown) {
        if (roll < 0.28 * density) piece = mk('planter', s, 1.1, 1.9, true);
        else if (roll < 0.4 * density) piece = mk('bikerack', s, 0.9, 2.4, false);
        else if (roll < 0.43 * density && len > 50) piece = mk('kiosk', s, 1.4, 1.8, true);
      } else if (old) {
        if (roll < 0.26 * density) piece = mk('bags', s, 0.9, 1, false);
        else if (roll < 0.38 * density) piece = mk('bikerack', s, 0.9, 2.4, false);
        else if (roll < 0.45 * density) piece = mk('planter', s, 1.1, 1.6, true);
        else if (roll < 0.47 * density && len > 50) piece = mk('kiosk', s, 1.4, 1.8, true);
      } else if (roll < 0.15 * density) piece = mk('bags', s, 0.9, 1, false);
      if (piece) { out.push(piece); grid.add({ x: piece.x, z: piece.z }); }
    }
    // utility plates + hatches in the sidewalk
    for (let k = 0; k < Math.floor(len / 30) * density; k++) {
      const s = r.range(e.from + 12, e.to - 12); const p = P(s, r.range(0.9, 3.6));
      out.push({ kind: 'plate', x: p.x, z: p.z, ax: e.ax, nx: e.nx, nz: e.nz, len: r.range(0.6, 1.2), seed: r.int(1, 99999), solid: false });
    }
    // road dressing in the lane next to this edge (kerb + lane centre region; never within 12 m of a junction)
    if (road) {
      const half = road.half;
      const lane = (d: number) => { const q = P(0, 0); void q; return e.ax === 'x' ? { x: 0, z: e.fixed + e.nz * d } : { x: e.fixed + e.nx * d, z: 0 }; };
      for (let k = 0; k < Math.floor(len / 70 * (0.5 + density)); k++) {
        const s = r.range(e.from + 14, e.to - 14), d = r.range(1.2, Math.max(1.5, half - 1.6)), l = lane(d);
        const x = e.ax === 'x' ? s : l.x, z = e.ax === 'x' ? l.z : s;
        const roll = r.next();
        out.push({ kind: roll < 0.4 ? 'manhole' : roll < 0.75 ? 'patch' : 'crack', x, z, ax: e.ax, nx: e.nx, nz: e.nz, len: r.range(1.2, 3.2), seed: r.int(1, 99999), solid: false });
        if (density < 0.7 && k >= 1) break;
      }
    }
  }
}

const col = (h: string) => new THREE.Color(h);
const BAG = ['#1c1d1f', '#23262a', '#2a3028', '#33322f'];

/** Bakes the plan into the trim chunks; solid pieces get small static colliders. */
export function emitStreetscape(plan: StreetscapePlan, trim: Chunked<TrimBuilder>, physics: Physics) {
  const y0 = CURB_HEIGHT;
  const counts: Record<string, number> = {}; for (const p of plan.pieces) counts[p.kind] = (counts[p.kind] ?? 0) + 1;
  (globalThis as { __streetscape?: Record<string, number> }).__streetscape = counts; // debug hook (e2e)
  (globalThis as { __streetscapeSheds?: Piece[] }).__streetscapeSheds = plan.pieces.filter(q => q.kind === 'shed');
  for (const p of plan.pieces) {
    const tb = trim.at(p.x, p.z), r = new Rng(p.seed);
    const along = p.ax === 'x' ? { x: 1, z: 0 } : { x: 0, z: 1 };
    // size mapper: length along the edge, depth across it
    const sz = (l: number, d: number): [number, number] => p.ax === 'x' ? [l, d] : [d, l];
    switch (p.kind) {
      case 'bikerack': {
        const iron = col('#2b2d30');
        // three inverted-U hoops running across the edge
        for (let i = -1; i <= 1; i++) {
          const cx = p.x + along.x * i * 0.6, cz = p.z + along.z * i * 0.6, ox = p.ax === 'x' ? 0 : 0.28, oz = p.ax === 'x' ? 0.28 : 0;
          tb.beam(cx - ox, y0, cz - oz, cx - ox, y0 + 0.75, cz - oz, 0.045, 0.045, iron, T_METAL);
          tb.beam(cx + ox, y0, cz + oz, cx + ox, y0 + 0.75, cz + oz, 0.045, 0.045, iron, T_METAL);
          tb.beam(cx - ox, y0 + 0.75, cz - oz, cx + ox, y0 + 0.75, cz + oz, 0.045, 0.045, iron, T_METAL);
        }
        if (r.chance(0.5)) { // a locked bike
          const bx = p.x + along.x * 0.3, bz = p.z + along.z * 0.3, c = col(r.pick(['#a02a2a', '#2a4f8a', '#2f2f31', '#d9d2c3']));
          tb.beam(bx - along.x * 0.45, y0 + 0.35, bz - along.z * 0.45, bx + along.x * 0.45, y0 + 0.55, bz + along.z * 0.45, 0.04, 0.04, c, T_METAL);
          tb.cyl(bx - along.x * 0.45, y0 + 0.02, bz - along.z * 0.45, 0.33, 0.33, 0.03, 10, col('#1b1b1c'), T_ROUGH);
        }
        break;
      }
      case 'bags': {
        const n = r.int(2, 4);
        for (let i = 0; i < n; i++) tb.sphere(p.x + along.x * (i - n / 2) * 0.45 + r.range(-0.1, 0.1), y0 + 0.28, p.z + along.z * (i - n / 2) * 0.45 + r.range(-0.1, 0.1), r.range(0.28, 0.42), col(r.pick(BAG)), T_FABRIC, 0.85);
        if (r.chance(0.5)) tb.box(p.x - p.nx * 0.5, y0 + 0.25, p.z - p.nz * 0.5, 0.5, 0.5, 0.4, r.range(0, 3), col('#a58a63'), T_ROUGH);
        break;
      }
      case 'planter': {
        const [sx, sz2] = sz(p.len, 0.8);
        tb.box(p.x, y0 + 0.3, p.z, sx, 0.6, sz2, 0, col('#a9a396'), T_STONE);
        tb.box(p.x, y0 + 0.62, p.z, sx + 0.1, 0.06, sz2 + 0.1, 0, col('#bdb8ab'), T_STONE);
        tb.box(p.x, y0 + 0.58, p.z, sx - 0.15, 0.1, sz2 - 0.15, 0, col('#3a3026'), T_ROUGH);
        for (let i = 0; i < 4; i++) tb.sphere(p.x + along.x * r.range(-p.len / 2 + 0.3, p.len / 2 - 0.3), y0 + 1.0 + r.range(0, 0.15), p.z + along.z * r.range(-p.len / 2 + 0.3, p.len / 2 - 0.3), r.range(0.3, 0.45), col(r.pick(['#3f5a34', '#4a6b3a', '#34502e'])), T_FABRIC, 0.9);
        physics.addStaticBox(p.x, y0 + 0.3, p.z, sx / 2, 0.3, sz2 / 2);
        break;
      }
      case 'kiosk': {
        const body = col(r.pick(['#2f4a3a', '#6b2a2a', '#2c3a52', '#3a3a3c'])), [sx, sz2] = sz(1.8, 1.0);
        tb.box(p.x, y0 + 1.1, p.z, sx, 2.2, sz2, 0, body, [0.55, 0.2, 0, 0]);
        const [ax2, az2] = sz(1.9, 0.8);
        tb.box(p.x + p.nx * 0.0, y0 + 1.1, p.z + p.nz * 0.0, ax2 * 0.0 + sx + 0.05, 0.9, sz2 + 0.05, 0, col('#c9c2b0'), T_FABRIC); // counter / shelf band
        const [rx, rz] = sz(2.1, 1.3);
        tb.box(p.x, y0 + 2.28, p.z, rx, 0.1, rz, 0, col('#1f2022'), T_METAL);
        tb.box(p.x, y0 + 0.9, p.z, sx + 0.02, 0.5, sz2 + 0.02, 0, col('#d4cfc2'), T_PAINT);
        void az2;
        physics.addStaticBox(p.x, y0 + 1.1, p.z, sx / 2, 1.1, sz2 / 2);
        break;
      }
      case 'guard': {
        const iron = col('#222426'), h = 0.55, s = 0.75;
        for (const [ox, oz] of [[-s, -s], [s, -s], [s, s], [-s, s]]) tb.beam(p.x + ox, y0, p.z + oz, p.x + ox, y0 + h + 0.12, p.z + oz, 0.05, 0.05, iron, T_IRON);
        for (let i = 0; i < 4; i++) {
          const [ax, az] = [[-s, -s], [s, -s], [s, s], [-s, s]][i], [bx, bz] = [[-s, -s], [s, -s], [s, s], [-s, s]][(i + 1) % 4];
          tb.beam(p.x + ax, y0 + h, p.z + az, p.x + bx, y0 + h, p.z + bz, 0.03, 0.03, iron, T_IRON);
          tb.beam(p.x + ax, y0 + 0.25, p.z + az, p.x + bx, y0 + 0.25, p.z + bz, 0.025, 0.025, iron, T_IRON);
        }
        break;
      }
      case 'plate': {
        const w = p.len; const yaw = r.pick([0, Math.PI / 2]);
        if (r.chance(0.5)) tb.cyl(p.x, y0 + 0.002, p.z, w * 0.45, w * 0.45, 0.012, 12, col('#4a4743'), T_IRON);
        else tb.box(p.x, y0 + 0.008, p.z, w, 0.014, w * r.range(0.6, 1.1), yaw, col('#5a5753'), T_IRON);
        break;
      }
      case 'manhole': tb.cyl(p.x, 0.003, p.z, 0.42, 0.42, 0.016, 14, col('#3a3836'), T_IRON); tb.cyl(p.x, 0.012, p.z, 0.3, 0.3, 0.008, 12, col('#2b2a29'), T_IRON); break;
      case 'patch': {
        const [sx, sz2] = sz(p.len, p.len * r.range(0.45, 0.8));
        const dark = r.chance(0.7);
        tb.box(p.x, 0.007, p.z, sx, 0.012, sz2, r.range(-0.08, 0.08), col(dark ? '#242426' : '#4a4a4c'), T_ROUGH);
        break;
      }
      case 'crack': {
        let cx = p.x, cz = p.z, ang = r.range(0, 6.28); const c = col('#1a1a1b');
        for (let i = 0; i < 6; i++) { ang += r.range(-0.7, 0.7); const nx = cx + Math.cos(ang) * 0.6, nz = cz + Math.sin(ang) * 0.6; tb.beam(cx, 0.006, cz, nx, 0.006, nz, 0.045, 0.01, c, T_ROUGH); cx = nx; cz = nz; }
        break;
      }
      case 'shed': {
        const L = p.len, depth = 3.9, inset0 = 0.5;
        const at = (s: number, inset: number) => p.ax === 'x' ? { x: p.x + s, z: p.z - p.nz * inset } : { x: p.x - p.nx * inset, z: p.z + s };
        const green = col('#2b5a45'), steel = col('#6a6d70'), ply = col('#8a7a5e');
        const [rx, rz] = sz(L, depth);
        const mid = at(0, inset0 + depth / 2);
        tb.box(mid.x, y0 + 3.4, mid.z, rx, 0.14, rz, 0, green, T_PAINT);
        const f = at(0, inset0); const [fx, fz] = sz(L, 0.06);
        tb.box(f.x, y0 + 3.0, f.z, fx, 0.8, fz, 0, green, T_PAINT); // fascia board
        for (let s = -L / 2; s <= L / 2 + 0.01; s += L / 5) {
          const a = at(s, inset0); tb.box(a.x, y0 + 1.6, a.z, 0.14, 3.2, 0.14, 0, steel, T_METAL);
          physics.addStaticCylinder(a.x, y0 + 1.6, a.z, 1.6, 0.1);
          const q = at(s, inset0 + depth - 0.1); tb.box(q.x, y0 + 1.6, q.z, 0.12, 3.2, 0.12, 0, steel, T_METAL);
        }
        // plywood hoarding panels between the posts on the kerb side (lower half only, open above for the lamp-lit look)
        for (let s = -L / 2 + L / 10; s < L / 2; s += L / 5) { const a = at(s, inset0 + 0.02); const [qx, qz] = sz(L / 5 - 0.2, 0.04); tb.box(a.x, y0 + 0.55, a.z, qx, 1.1, qz, 0, ply, T_ROUGH); }
        // scaffold tower above the shed: standards, ledgers, planks and netting
        for (let s = -L / 2; s <= L / 2 + 0.01; s += L / 5) { const q = at(s, inset0 + depth - 0.2); tb.box(q.x, y0 + 3.4 + 4.2, q.z, 0.09, 8.4, 0.09, 0, steel, T_METAL); }
        for (let h = 5.6; h < 11.6; h += 2.2) { const a = at(0, inset0 + depth - 0.2); const [lx, lz] = sz(L, 0.07); tb.box(a.x, y0 + h, a.z, lx, 0.07, lz, 0, steel, T_METAL); const b = at(0, inset0 + depth - 0.6); const [px, pz] = sz(L, 0.8); tb.box(b.x, y0 + h + 0.05, b.z, px, 0.06, pz, 0, ply, T_ROUGH); }
        const nt = at(0, inset0 + depth - 0.12); const [nx2, nz2] = sz(L, 0.02); tb.box(nt.x, y0 + 3.5 + 3.9, nt.z, nx2, 7.8, nz2, 0, col('#46604f'), T_PAINT);
        break;
      }
    }
  }
}
