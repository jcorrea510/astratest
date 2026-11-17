import { describe, it, expect } from 'vitest';
import { generateCity, signalState, pedestrianMayCross, SIGNAL_PERIOD, surfaceAt, samplePath, nearestLane } from './citymap';

const city = generateCity();
describe('city layout', () => {
  it('is deterministic', () => {
    const again = generateCity();
    expect(again.lots.length).toBe(city.lots.length);
    expect(again.lots[10]).toEqual(city.lots[10]);
  });
  it('gives every road lane a way forward and every connector a destination', () => {
    for (const lane of city.lanes) {
      expect(lane.next.length, `lane ${lane.id}`).toBeGreaterThan(0);
      for (const n of lane.next) expect(city.lanes[n]).toBeDefined();
      expect(lane.length).toBeGreaterThan(1);
    }
  });
  it('lets a car drive for a long time without getting stuck', () => {
    let lane = city.lanes.find(l => !l.connector)!;
    let visited = 0;
    for (let i = 0; i < 2000; i++) { lane = city.lanes[lane.next[i % lane.next.length]]; visited++; }
    expect(visited).toBe(2000);
  });
  it('never shows green both ways', () => {
    const inter = city.intersections.find(i => i.signalized)!;
    for (let t = 0; t < SIGNAL_PERIOD * 2; t += 0.25) {
      const ns = signalState(inter, 'z', t), ew = signalState(inter, 'x', t);
      expect(ns !== 'red' && ew !== 'red').toBe(false);
      if (pedestrianMayCross(inter, 'z', t)) expect(ns).toBe('red');
    }
  });
  it('places buildings off the road', () => {
    for (const lot of city.lots) {
      expect(surfaceAt(city, lot.x, lot.z), `lot ${lot.id}`).not.toBe('road');
    }
  });
  it('keeps lane centres on road surface', () => {
    const out = { x: 0, z: 0, dx: 0, dz: 0 };
    for (const lane of city.lanes) {
      samplePath(lane, lane.length / 2, out);
      expect(surfaceAt(city, out.x, out.z), `lane ${lane.id}`).toBe('road');
    }
  });
  it('has a connected pedestrian network', () => {
    const seen = new Set([0]); const stack = [0];
    while (stack.length) { const n = stack.pop()!; for (const e of city.pedNodes[n].edges) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); } }
    expect(seen.size).toBe(city.pedNodes.length);
  });
  it('finds nearest lanes', () => {
    const r = nearestLane(city, -50, 37)!;
    expect(r.dist).toBeLessThan(5);
  });
});
