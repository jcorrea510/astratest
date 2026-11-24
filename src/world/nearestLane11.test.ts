import { it, expect } from 'vitest';
import { generateCity, nearestLane, nearestLaneScan } from './citymap';

// Round 11 perf: the grid-indexed lookup must give exactly the full scan's answer
it('nearestLane (grid) matches the full scan everywhere, connectors on and off', () => {
  const city = generateCity();
  let n = 0;
  for (let i = 0; i < 1500; i++) {
    const x = Math.sin(i * 12.9898) * 900, z = Math.cos(i * 78.233) * 900, roadOnly = i % 3 !== 0;
    const a = nearestLane(city, x, z, roadOnly), b = nearestLaneScan(city, x, z, roadOnly);
    expect(a?.lane.id).toBe(b?.lane.id); expect(a?.dist).toBeCloseTo(b!.dist, 9); expect(a?.s).toBeCloseTo(b!.s, 9); n++;
  }
  expect(n).toBe(1500);
});
