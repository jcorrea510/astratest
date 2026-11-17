import { describe, it, expect } from 'vitest';
import { generateCity, signalState, pedestrianMayCross, SIGNAL_PERIOD, surfaceAt, samplePath, nearestLane, routeField } from './citymap';

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

// Bug-bash 1 #3: race rivals took wrong turns because turns were scored by a lane's end point only.
describe('lane routing', () => {
  const RACE = [{ x: -350, z: 403 }, { x: -150, z: 403 }, { x: -50, z: 300 }, { x: 50, z: 200 }, { x: 150, z: 100 }, { x: 250, z: 2 }, { x: 350, z: -100 }, { x: 446, z: 0 }, { x: 446, z: 200 }, { x: 250, z: 396 }, { x: 52, z: 404 }];
  it('following the route field reaches every race checkpoint by a short path', () => {
    let cur = nearestLane(city, -420, 403.5)!.lane;
    for (const t of RACE) {
      const field = routeField(city, t.x, t.z);
      expect(Number.isFinite(field[cur.id]), `reachable ${t.x},${t.z}`).toBe(true);
      let driven = 0, steps = 0, reached = false;
      const p = { x: 0, z: 0, dx: 0, dz: 0 };
      while (steps++ < 200) {
        // close enough along this lane?
        for (let s = 0; s <= cur.length; s += 2) { samplePath(cur, s, p); if (Math.hypot(p.x - t.x, p.z - t.z) < 14) { reached = true; break; } }
        if (reached) break;
        driven += cur.length;
        let best = cur.next[0]; for (const n of cur.next) if (field[n] < field[best]) best = n;
        cur = city.lanes[best];
      }
      expect(reached, `reached ${t.x},${t.z}`).toBe(true);
      expect(driven).toBeLessThan(500);
    }
  });
});
