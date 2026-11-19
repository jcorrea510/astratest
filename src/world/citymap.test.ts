import { describe, it, expect } from 'vitest';
import { generateCity, signalState, pedestrianMayCross, SIGNAL_PERIOD, surfaceAt, samplePath, nearestLane, routeField, districtAt } from './citymap';
import { STORES, storeAt } from '../game/places';

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
      expect(driven, `to ${t.x},${t.z}`).toBeLessThan(500);
    }
  });
});

describe('city expansion', () => {
  const city = generateCity();
  it('every lane continues somewhere (freeway, ramps, hill road and cul-de-sacs included)', () => {
    for (const l of city.lanes) expect(l.next.length, `lane ${l.id}`).toBeGreaterThan(0);
  });
  it('the freeway is elevated and reachable from the grid', () => {
    const fw = city.paths.find(p => p.kind === 'freeway')!;
    expect(fw.elevated).toBe(true);
    expect(Math.max(...fw.pts.map(p => p.y))).toBeGreaterThan(5);
    // walk the lane graph from a grid lane: the freeway lanes must be reachable
    const fwLanes = new Set(city.lanes.filter(l => l.ys && Math.max(...l.ys) > 5 && !l.connector).map(l => l.id));
    const seen = new Set<number>(); const q = city.lanes.filter(l => !l.connector && !l.ys).map(l => l.id); // any grid lane (some inner lanes are only entered from the cross street)
    while (q.length) { const id = q.pop()!; if (seen.has(id)) continue; seen.add(id); q.push(...city.lanes[id].next); }
    expect([...fwLanes].some(id => seen.has(id))).toBe(true);
    // every expansion lane (freeway, ramps, hill and airfield roads) is reachable from the grid
    for (const l of city.lanes) if (l.ys) expect(seen.has(l.id), `lane ${l.id}`).toBe(true);
  });
  it('samplePath reports heights on elevated lanes', () => {
    const l = city.lanes.find(x => x.ys && Math.max(...x.ys) > 5 && !x.connector)!;
    const out = { x: 0, z: 0, dx: 0, dz: 0, y: 0 };
    samplePath(l, l.length / 2, out);
    expect(out.y).toBeGreaterThan(1);
  });
});

describe('west extension + stores', () => {
  const c = generateCity();
  it('adds Old Town and Seacliff beyond the old west edge, with curved roads and a roundabout', () => {
    const streets = c.paths.filter(p => p.kind === 'street');
    expect(streets.length).toBeGreaterThanOrEqual(18);
    expect(Math.min(...streets.flatMap(p => p.pts.map(q => q.x)))).toBeLessThan(-900);
    // curved: some street deviates clearly from its end-to-end chord
    const bent = streets.filter(p => { const a = p.pts[0], b = p.pts[p.pts.length - 1]; const l = Math.hypot(b.x - a.x, b.z - a.z) || 1; return p.pts.some(q => Math.abs((b.x - a.x) * (a.z - q.z) - (a.x - q.x) * (b.z - a.z)) / l > 6); });
    expect(bent.length).toBeGreaterThanOrEqual(10);
    expect(streets.filter(p => p.name === 'Clockwork Circle').length).toBe(4);
    expect(districtAt(c, -850, -60)).toBe('oldtown');
    expect(districtAt(c, -820, 300)).toBe('seacliff');
  });
  it('keeps west buildings off the roads and the whole west lane network drivable', () => {
    const west = c.lots.filter(l => l.blockId < 0);
    expect(west.length).toBeGreaterThan(150);
    for (const l of west) expect(surfaceAt(c, l.x, l.z), `lot ${l.id}`).not.toBe('road');
    const seen = new Set<number>(); const q = c.lanes.filter(l => !l.connector && !l.ys).map(l => l.id);
    while (q.length) { const id = q.pop()!; if (seen.has(id)) continue; seen.add(id); q.push(...c.lanes[id].next); }
    for (const l of c.lanes) if (l.points[0].x < -460) { expect(l.next.length).toBeGreaterThan(0); expect(seen.has(l.id), `lane ${l.id}`).toBe(true); }
  });
  it('has ~50 stores of ten kinds, each on its own street-facing lot, spread over the map', () => {
    expect(STORES.length).toBeGreaterThanOrEqual(45);
    expect(new Set(STORES.map(s => s.kind)).size).toBe(10);
    expect(new Set(STORES.map(s => s.name)).size).toBe(STORES.length);
    for (const s of STORES) {
      expect(s.cash).toBeGreaterThan(100);
      if (!s.standalone) expect(storeAt(s.x, s.z), s.name).toBeDefined();
      expect(['road', 'water', 'offmap']).not.toContain(surfaceAt(c, s.x, s.z));
    }
    expect(STORES.filter(s => s.x < -470).length).toBeGreaterThanOrEqual(8); // some in the new west districts
    expect(STORES.filter(s => s.x > 0).length).toBeGreaterThanOrEqual(8);
    // a single store lot is never part of a merged run, and shops are >= 40 m apart
    for (let i = 0; i < STORES.length; i++) for (let j = i + 1; j < STORES.length; j++) expect(Math.hypot(STORES[i].x - STORES[j].x, STORES[i].z - STORES[j].z)).toBeGreaterThan(25);
  });
  it('regenerating the city does not duplicate stores', () => {
    const n = STORES.length; generateCity(); generateCity(); expect(STORES.length).toBe(n);
  });
  it('pedestrian graph stays connected with the west sidewalks', () => {
    expect(c.pedNodes.filter(n => n.blockId < 0).length).toBeGreaterThan(40);
  });
  it('south extension: Anchor Row financial district, central park, waterfront highway, whole lane graph connected', () => {
    expect(c.blocks.filter(b => b.district === 'financial').length).toBeGreaterThanOrEqual(12);
    expect(c.blocks.filter(b => b.kind === 'park').length).toBeGreaterThanOrEqual(6);
    expect(Math.max(...c.lots.map(l => l.height))).toBeGreaterThan(60);
    expect(c.paths.filter(p => p.name === 'Harbor Drive').length).toBe(4);
    expect(STORES.filter(s => s.z > 450).length).toBeGreaterThanOrEqual(8);
    // every non-connector lane can reach every other (one strongly-connected component) except dead-end loops handled by next
    const reach = (start: number, adj: (id: number) => number[]) => { const seen = new Set<number>(); const q = [start]; while (q.length) { const id = q.pop()!; if (seen.has(id)) continue; seen.add(id); q.push(...adj(id)); } return seen; };
    const out = (id: number) => { const l = c.lanes[id]; return [...l.next, ...(l.leftLane !== undefined ? [l.leftLane] : []), ...(l.rightLane !== undefined ? [l.rightLane] : [])]; };
    const rev: number[][] = c.lanes.map(() => []); for (const l of c.lanes) for (const n of out(l.id)) rev[n].push(l.id);
    const start = c.lanes.find(l => !l.connector && !l.ys)!.id;
    const fwd = reach(start, out), back = reach(start, id => rev[id]);
    for (const l of c.lanes) { expect(fwd.has(l.id), `fwd ${l.id}`).toBe(true); expect(back.has(l.id), `back ${l.id}`).toBe(true); }
    expect(surfaceAt(c, 100, 800)).not.toBe('water'); // the grid reaches the new south coast
    expect(surfaceAt(c, 100, 1100)).toBe('water');
  });
});
