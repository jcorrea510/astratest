import { describe, it, expect } from 'vitest';
import { generateCity, surfaceAt } from './citymap';
import { bwDist } from './broadway';

/** Round 7 (owner): around Broadway's junctions peds walked through the roadway (nodes in the road, sidewalk edges across it). */
const city = generateCity();
describe('pedestrian lines near Broadway', () => {
  it('no pedestrian node near Broadway stands in a road, and walking edges (not crosswalks) stay off the road', () => {
    const near = (x: number, z: number) => bwDist(x, z) < 40;
    const badNodes = city.pedNodes.filter(n => near(n.x, n.z) && surfaceAt(city, n.x, n.z) === 'road');
    let badEdges = 0;
    for (const n of city.pedNodes) for (const e of n.edges) {
      if (e.crossing || e.to < n.id) continue;
      const m = city.pedNodes[e.to]; if (!near(n.x, n.z) && !near(m.x, m.z)) continue;
      for (const t of [0.25, 0.5, 0.75]) if (surfaceAt(city, n.x + (m.x - n.x) * t, n.z + (m.z - n.z) * t) === 'road') { badEdges++; break; }
    }
    expect(badNodes.length, JSON.stringify(badNodes.slice(0, 3).map(n => [n.x, n.z]))).toBe(0);
    expect(badEdges).toBe(0);
  });
});
