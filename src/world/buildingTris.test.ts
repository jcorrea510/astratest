import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Chunked, FacadeBuilder, TrimBuilder } from './builders';
import { streetBuilding, tower, house, warehouse, type BuildCtx, type StreetBuildingSpec } from './buildings';

function ctx(): BuildCtx {
  const physics = new Proxy({}, { get: () => () => 0 }) as never;
  return { fac: new Chunked(150, () => new FacadeBuilder()), trim: new Chunked(80, () => new TrimBuilder()), fine: new Chunked(80, () => new TrimBuilder()), physics, signs: [], billboards: [], helipads: [], exposed: () => true } as unknown as BuildCtx;
}
const tris = (c: Chunked<TrimBuilder | FacadeBuilder>) => { let n = 0; for (const b of c.map.values()) n += b.pos.length / 9; return n; };
const base = (o: Partial<StreetBuildingSpec> = {}): StreetBuildingSpec => ({ cx: 10, cz: 10, yaw: 0, w: 14, d: 14, base: 0, floors: 5, floorH: 3.4, groundH: 4.2, mat: 0, color: new THREE.Color('#7d4636'), seed: 5, ground: 'shop', winW: 1.4, winH: 1.9, sill: 0.9, cellW: 3, cornice: 'heavy', fireEscape: true, lit: 0.5, exposed: [true, true, true, true], roofItems: 4, awning: true, brand: 1, balconies: false, trimColor: new THREE.Color('#ccc'), ...o });

/** [facade shell tris, always-on trim tris, near-only fine trim tris] per building kind */
export function measure() {
  const rows: Record<string, [number, number, number]> = {};
  const run = (name: string, f: (c: BuildCtx) => void) => { const c = ctx(); f(c); rows[name] = [tris(c.fac), tris(c.trim), tris(c.fine!)]; };
  run('walkup', c => streetBuilding(c, base()));
  run('midrise', c => streetBuilding(c, base({ floors: 8, balconies: true, fireEscape: false, ground: 'lobby', cornice: 'simple' })));
  run('tower', c => tower(c, { cx: 0, cz: 0, w: 30, d: 30, base: 0, height: 120, seed: 4, helipad: null }));
  run('house', c => house(c, { cx: 0, cz: 0, yaw: 0, w: 10, d: 8, base: 0, seed: 3, lotW: 16, lotD: 20 }));
  run('warehouse', c => warehouse(c, { cx: 0, cz: 0, w: 40, d: 24, base: 0, h: 8, seed: 3 }));
  return rows;
}

/** Before Round 14 everything went into the always-drawn trim chunks (measured on the same specs). */
const BEFORE: Record<string, number> = { walkup: 2456, midrise: 2832, tower: 1428, house: 428, warehouse: 324 };

describe('building triangle budget', () => {
  const rows = measure();
  it('far buildings (shell + coarse trim) cost a fraction of the old trim', () => {
    for (const k of Object.keys(BEFORE)) {
      const [shell, coarse, fine] = rows[k];
      expect(shell + coarse, k).toBeLessThan(BEFORE[k] * 0.4);
      // the near look keeps its detail (minus the hidden undersides)
      expect(coarse + fine, k).toBeGreaterThan(BEFORE[k] * 0.9);
      expect(coarse + fine, k).toBeLessThanOrEqual(BEFORE[k]);
    }
  });
  it('a walk-up beyond the fine reach is under 200 triangles', () => {
    expect(rows.walkup[0] + rows.walkup[1]).toBeLessThan(200);
  });
  it('boxUp drops only the underside', () => {
    const a = new TrimBuilder(), b = new TrimBuilder(), c = new THREE.Color('#fff');
    a.box(0, 0, 0, 1, 1, 1, 0.3, c, [0.5, 0, 0, 0]); b.boxUp(0, 0, 0, 1, 1, 1, 0.3, c, [0.5, 0, 0, 0]);
    expect(a.pos.length / 9).toBe(12); expect(b.pos.length / 9).toBe(10);
    for (let i = 0; i < b.nor.length; i += 3) expect(b.nor[i + 1]).toBeGreaterThan(-0.5);
  });
});
