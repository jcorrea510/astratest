import { describe, it, expect } from 'vitest';
import { generateCity, signalState, laneSigAxis, pedSignal, DIAG_PERIOD } from './citymap';
import { signalPosts } from './signals';

/** Round 9 (owner): Broadway (the diagonal) had no lights and ran on the north/south green, so it crashed into the grid. */
const city = generateCity();
const diag = city.intersections.filter(i => i.diag && i.signalized);
describe('Broadway signals', () => {
  it('every Broadway junction has a diagonal phase', () => { expect(diag.length).toBeGreaterThanOrEqual(3); });
  it('the diagonal is green only while both grid roads are red, and every group gets a green', () => {
    for (const I of diag) {
      const seen = { x: 0, z: 0, d: 0 };
      for (let t = 0; t < DIAG_PERIOD; t += 0.25) {
        const s = { x: signalState(I, 'x', t), z: signalState(I, 'z', t), d: signalState(I, 'd', t) };
        const go = (['x', 'z', 'd'] as const).filter(a => s[a] !== 'red');
        expect(go.length).toBeLessThanOrEqual(1);
        for (const a of go) if (s[a] === 'green') seen[a]++;
        if (s.d !== 'red') { expect(pedSignal(I, 'x', t)).toBe('dont'); expect(pedSignal(I, 'z', t)).toBe('dont'); }
      }
      expect(seen.x && seen.z && seen.d).toBeTruthy();
    }
  });
  it('diagonal lanes are controlled by the diagonal group', () => {
    const dl = city.lanes.filter(l => l.diag);
    expect(dl.length).toBeGreaterThan(0);
    for (const l of dl) expect(laneSigAxis(l)).toBe('d');
  });
  it('each diagonal approach into a signalised junction has a signal head', () => {
    const posts = signalPosts(city).filter(p => p.axis === 'd');
    const approaches = city.lanes.filter(l => l.diag && city.intersections[l.intersection].signalized);
    expect(posts.length).toBe(approaches.length);
  });
});
