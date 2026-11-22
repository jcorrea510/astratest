import { describe, it, expect } from 'vitest';
import { generateCity, type Lane } from './citymap';

/** Round 7 (owner): crashes came from right turns out of the inner lane and left turns out of the kerb lane. */
const city = generateCity();
const dir = (l: Lane, end: boolean) => { const p = l.points, a = end ? p[p.length - 2] : p[0], b = end ? p[p.length - 1] : p[1]; const d = Math.hypot(b.x - a.x, b.z - a.z) || 1; return { x: (b.x - a.x) / d, z: (b.z - a.z) / d }; };
const cross = (a: { x: number; z: number }, b: { x: number; z: number }) => a.x * b.z - a.z * b.x;
function segX(p: { x: number; z: number }[], q: { x: number; z: number }[]): boolean {
  const o = (a: { x: number; z: number }, b: { x: number; z: number }, c: { x: number; z: number }) => (b.x - a.x) * (c.z - a.z) - (b.z - a.z) * (c.x - a.x);
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) {
    const a = p[i - 1], b = p[i], c = q[j - 1], d = q[j];
    const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
    if (((d1 > 1e-6 && d2 < -1e-6) || (d1 < -1e-6 && d2 > 1e-6)) && ((d3 > 1e-6 && d4 < -1e-6) || (d3 < -1e-6 && d4 > 1e-6))) return true;
  }
  return false;
}
describe('turn lanes', () => {
  const turns: { from: Lane; c: Lane; to: Lane; side: number }[] = [];
  for (const a of city.lanes) {
    if (a.connector) continue;
    for (const ci of a.next) {
      const c = city.lanes[ci]; if (!c.connector || !c.next.length) continue;
      const b = city.lanes[c.next[0]];
      const s = cross(dir(a, true), dir(b, false));
      turns.push({ from: a, c, to: b, side: Math.abs(s) < 0.3 ? 0 : s > 0 ? 1 : -1 }); // +1 = right (x east, z south)
    }
  }
  it('right turns leave from the kerb lane, left turns from the inner lane (when the road has a choice)', () => {
    const bad = turns.filter(t => t.from.lanes > 1 && t.from.next.length > 1 && ((t.side === 1 && t.from.lane !== t.from.lanes - 1) || (t.side === -1 && t.from.lane !== 0)));
    expect(bad.length, `${bad.length} wrong-lane turns`).toBe(0);
  });
  it('a turn never cuts across a straight path from the same approach', () => {
    let n = 0;
    for (const t of turns) if (t.side !== 0) for (const s of turns) if (s.side === 0 && s.from !== t.from && s.from.intersection === t.from.intersection && s.from.axis === t.from.axis && Math.abs(dir(s.from, true).x - dir(t.from, true).x) < 0.1 && Math.abs(dir(s.from, true).z - dir(t.from, true).z) < 0.1 && segX(t.c.points, s.c.points)) n++;
    expect(n).toBe(0);
  });
});
