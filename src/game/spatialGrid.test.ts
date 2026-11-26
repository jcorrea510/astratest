import { describe, it, expect } from 'vitest';
import { SpatialGrid } from './spatialGrid';
describe('SpatialGrid', () => {
  it('returns every item within r and is reusable after clear', () => {
    const g = new SpatialGrid<{ x: number; z: number }>(32);
    const pts = Array.from({ length: 500 }, (_, i) => ({ x: (i * 37) % 400 - 200, z: (i * 91) % 400 - 200 }));
    for (const p of pts) g.insert(p, p.x, p.z);
    const out: typeof pts = [];
    g.query(10, -20, 30, out);
    for (const p of pts) if (Math.abs(p.x - 10) <= 30 && Math.abs(p.z + 20) <= 30) expect(out).toContain(p);
    expect(out.length).toBeLessThan(pts.length / 4);
    g.clear(); out.length = 0; g.query(10, -20, 30, out); expect(out.length).toBe(0);
  });
  it('benchmark: grid query vs full scan at 300 obstacles x 60 cars', () => {
    const pts = Array.from({ length: 300 }, (_, i) => ({ x: (i * 37) % 600 - 300, z: (i * 91) % 600 - 300 }));
    const g = new SpatialGrid<typeof pts[0]>(32); for (const p of pts) g.insert(p, p.x, p.z);
    const out: typeof pts = []; let hits = 0;
    const t0 = performance.now();
    for (let r = 0; r < 200; r++) for (let c = 0; c < 60; c++) { let n = 0; for (const p of pts) if (Math.abs(p.x - c * 9) < 30 && Math.abs(p.z) < 30) n++; hits += n; }
    const t1 = performance.now();
    for (let r = 0; r < 200; r++) for (let c = 0; c < 60; c++) { out.length = 0; g.query(c * 9, 0, 30, out); hits += out.length; }
    const t2 = performance.now();
    console.log(`scan ${(t1 - t0).toFixed(1)} ms vs grid ${(t2 - t1).toFixed(1)} ms (12000 car-steps)`);
    expect(hits).toBeGreaterThan(0);
  });
});
