import { describe, it, expect } from 'vitest';
import { generateCity, surfaceAt, SIDEWALK } from './citymap';
import { planStreetscape, type Piece } from './streetscape';

const city = generateCity();
const grid = city.blocks.filter(b => b.kind !== 'park');
/** Distance in from the nearest block edge (the kerb) and the along-edge distance to the nearest block corner. */
function locate(p: Piece) {
  let best: { inset: number; cornerDist: number; blockId: number } | null = null;
  for (const b of city.blocks) {
    if (p.x < b.x0 - 0.01 || p.x > b.x1 + 0.01 || p.z < b.z0 - 0.01 || p.z > b.z1 + 0.01) continue;
    const insets = [p.z - b.z0, b.z1 - p.z, p.x - b.x0, b.x1 - p.x];
    const inset = Math.min(...insets);
    const alongX = Math.min(Math.abs(p.x - b.x0), Math.abs(p.x - b.x1)), alongZ = Math.min(Math.abs(p.z - b.z0), Math.abs(p.z - b.z1));
    const cornerDist = insets[0] === inset || insets[1] === inset ? alongX : alongZ;
    best = { inset, cornerDist, blockId: b.id };
  }
  return best;
}
const plan = (d: number) => planStreetscape(city, d, []);

describe('streetscape plan', () => {
  it('has pieces, and low < medium < high', () => {
    const lo = plan(0.35).pieces.length, me = plan(0.7).pieces.length, hi = plan(1).pieces.length;
    expect(lo).toBeGreaterThan(50); expect(me).toBeGreaterThan(lo); expect(hi).toBeGreaterThan(me);
  });
  it('sidewalk pieces stay on the sidewalk, off the walking line and away from crosswalks', () => {
    const { pieces } = plan(1);
    const road = new Set(['manhole', 'patch', 'crack']);
    let checked = 0;
    for (const p of pieces) {
      if (p.kind === 'guard') continue;
      if (road.has(p.kind)) { expect(surfaceAt(city, p.x, p.z), `${p.kind} ${p.x},${p.z}`).toBe('road'); continue; }
      expect(surfaceAt(city, p.x, p.z), `${p.kind} ${p.x},${p.z}`).toBe('sidewalk');
      const loc = locate(p); if (!loc) continue; checked++;
      expect(loc.inset, p.kind).toBeLessThan(SIDEWALK);
      expect(loc.cornerDist, `${p.kind} near a corner`).toBeGreaterThan(9);
      if (p.solid && p.kind !== 'shed') expect(Math.abs(loc.inset - 2.2), `${p.kind} blocks the ped line`).toBeGreaterThan(0.75);
    }
    expect(checked).toBeGreaterThan(100);
  });
  it('road dressing stays clear of junctions (crosswalks and stop lines)', () => {
    for (const p of plan(1).pieces.filter(q => q.kind === 'manhole' || q.kind === 'patch' || q.kind === 'crack')) {
      const along = p.ax === 'x' ? p.x : p.z;
      const blk = grid.find(b => (p.ax === 'x' ? along >= b.x0 && along <= b.x1 : along >= b.z0 && along <= b.z1));
      if (!blk) continue;
      const lo = p.ax === 'x' ? blk.x0 : blk.z0, hi = p.ax === 'x' ? blk.x1 : blk.z1;
      expect(Math.min(along - lo, hi - along)).toBeGreaterThan(12);
    }
  });
  it('sheds sit on stretches with no other furniture and do not touch the kerb strip lamp line', () => {
    const taken = [{ x: -1000, z: -1000 }];
    for (const s of planStreetscape(city, 1, taken).pieces.filter(q => q.kind === 'shed')) expect(s.len).toBe(12);
  });
});

describe('streetscape mix', () => {
  it('includes every piece kind at high', () => {
    const kinds = new Set(planStreetscape(city, 1, [], [{ x: 0, z: 0 }, { x: 10, z: 0 }, { x: 20, z: 0 }]).pieces.map(p => p.kind));
    for (const k of ['bikerack', 'bags', 'planter', 'plate', 'manhole', 'patch', 'crack', 'shed', 'kiosk']) expect(kinds.has(k as Piece['kind']), k).toBe(true);
  });
});
