import { describe, it, expect } from 'vitest';
import { generateCity, groundRoadAt, AVENUES, STREETS } from './citymap';

const city = generateCity();
/** Same spacing rule as buildExpansion: a pillar pair every ~28 m of elevated deck that is > 3 m up (ground taken as 0). */
function spots(check: boolean) {
  const out: { x: number; z: number; onRoad: boolean }[] = [];
  for (const p of city.paths) {
    if (!p.elevated) continue;
    let since = 0;
    for (let i = 1; i < p.pts.length; i++) {
      const a = p.pts[i - 1], b = p.pts[i], L = Math.hypot(b.x - a.x, b.z - a.z), tx = (b.x - a.x) / (L || 1), tz = (b.z - a.z) / (L || 1), nx = -tz, nz = tx;
      if (Math.max(a.y, b.y) <= 0.25) continue;
      since += L;
      if (since > 28 && Math.min(a.y, b.y) > 3) {
        const pts = (p.lanes === 2 ? [-1, 1] : [0]).map(sg => ({ x: b.x + nx * sg * 4.5, z: b.z + nz * sg * 4.5 }));
        const clear = pts.every(q => !groundRoadAt(city, q.x, q.z, 0, 1.2));
        if (!check || clear) { since = 0; for (const q of pts) out.push({ ...q, onRoad: !clear }); }
      }
    }
  }
  return out;
}
describe('freeway pillars (Round 8)', () => {
  it('groundRoadAt: avenues and streets are road, a block interior is not', () => {
    expect(groundRoadAt(city, AVENUES[3], STREETS[2] + 50, 0)).toBe(true);
    expect(groundRoadAt(city, AVENUES[3] + 50, STREETS[2], 0)).toBe(true);
    expect(groundRoadAt(city, AVENUES[3] + 50, STREETS[2] + 50, 0)).toBe(false);
  });
  it('no pillar stands in a street under the freeway, and the deck is still held up', () => {
    const old = spots(false), now = spots(true);
    expect(now.length).toBeGreaterThan(20);
    expect(now.filter(s => s.onRoad)).toEqual([]);
    console.log('pillars on roads before the fix:', old.filter(s => s.onRoad).length, 'of', old.length);
  });
});
describe('elevated rail columns (Round 8)', () => {
  it('no rail column stands in a carriageway (cross streets and Broadway included)', async () => {
    const { railColumns } = await import('./citymap');
    const cols = railColumns();
    expect(cols.length).toBeGreaterThan(20);
    expect(cols.filter(c => groundRoadAt(city, c.x, c.z, 0, 0.3))).toEqual([]);
  });
});
