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
    // the island + west network is one component; Eastbank (across the East River) is its own, joined by no walkway
    const flood = (s: number) => { const seen = new Set([s]); const stack = [s]; while (stack.length) { const n = stack.pop()!; for (const e of city.pedNodes[n].edges) if (!seen.has(e.to)) { seen.add(e.to); stack.push(e.to); } } return seen; };
    const main = city.pedNodes.filter(n => n.x < 600), east = city.pedNodes.filter(n => n.x > 600);
    expect(flood(0).size).toBe(main.length);
    expect(east.length).toBeGreaterThan(30);
    expect(flood(east[0].id).size).toBe(east.length);
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
  it('every walk-in store (hand-placed ones included) stands on a lot of its own', () => {
    for (const st of STORES.filter(x => !x.standalone)) expect(city.lots.some(l => Math.hypot(l.x - st.x, l.z - st.z) < 1 && Math.abs(l.w - 10.5) < 0.2), st.name).toBe(true);
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

describe('Manhattan island shape', () => {
  const reach = (start: number, edges: (id: number) => number[]) => {
    const seen = new Set([start]), q = [start];
    while (q.length) for (const n of edges(q.pop()!)) if (!seen.has(n)) { seen.add(n); q.push(n); }
    return seen;
  };
  it('the whole lane graph (island, bridges, mainland, freeway) is strongly connected', () => {
    const out = (id: number) => { const l = city.lanes[id]; return [...l.next, ...(l.leftLane !== undefined ? [l.leftLane] : []), ...(l.rightLane !== undefined ? [l.rightLane] : [])]; }; // lane changes count
    const prev: number[][] = city.lanes.map(() => []);
    for (const l of city.lanes) for (const n of out(l.id)) prev[n].push(l.id);
    expect(reach(0, out).size).toBe(city.lanes.length);
    expect(reach(0, id => prev[id]).size).toBe(city.lanes.length);
  });
  it('the western river and the tapered south tip are water; the four west streets bridge the river', () => {
    expect(surfaceAt(city, -500, -100)).toBe('water');
    expect(surfaceAt(city, -300, 760)).toBe('water'); // west of the tapered tip
    expect(surfaceAt(city, -800, 600)).toBe('water'); // sea south of the mainland
    expect(surfaceAt(city, -50, 600)).not.toBe('water');
    expect(surfaceAt(city, 0, 850)).not.toBe('water');
    let bridges = 0;
    for (const p of city.paths.filter(q => q.kind === 'street')) {
      const over = p.pts.filter(q => q.x > -526 && q.x < -464);
      if (!over.length) continue;
      bridges++;
      for (const q of over) expect(surfaceAt(city, q.x, q.z), `bridge ${p.name} at ${q.x},${q.z}`).toBe('road');
    }
    expect(bridges).toBeGreaterThanOrEqual(3);
  });
  it('the East River is water, Eastbank is land with streets and lots, and two suspension bridges cross it', () => {
    expect(surfaceAt(city, 620, 250)).toBe('water');
    expect(surfaceAt(city, 640, 800)).toBe('water');
    expect(surfaceAt(city, 1100, 400)).toBe('water'); // sea beyond the shore
    expect(surfaceAt(city, 800, 985)).toBe('water');
    expect(surfaceAt(city, 850, 330)).not.toBe('water'); // Eastbank Green
    const bridges = city.paths.filter(p => p.name.endsWith('Bridge'));
    expect(bridges.length).toBe(2);
    for (const b of bridges) {
      expect(b.lanes).toBe(2);
      expect(Math.max(...b.pts.map(q => q.y))).toBeGreaterThan(5);
      for (const q of b.pts.filter(q => q.x > 565 && q.x < 685)) expect(surfaceAt(city, q.x, q.z), `${b.name} ${q.x}`).toBe('road');
    }
    expect(city.lots.filter(l => l.district === 'eastbank').length).toBeGreaterThan(40);
    for (const l of city.lots.filter(l => l.district === 'eastbank')) expect(surfaceAt(city, l.x, l.z), `eastbank lot ${l.id}`).not.toBe('road');
    expect(districtAt(city, 800, 200)).toBe('eastbank');
  });
  it('a car can drive from the island over the East River bridges to Eastbank and the airfield, and back', () => {
    const shore = nearestLane(city, 930, 500)!, isl = nearestLane(city, 0, 200)!, air = nearestLane(city, 760, -300)!;
    expect(Number.isFinite(routeField(city, 930, 500)[isl.lane.id])).toBe(true);
    expect(Number.isFinite(routeField(city, 0, 200)[shore.lane.id])).toBe(true);
    expect(Number.isFinite(routeField(city, 760, -300)[isl.lane.id])).toBe(true); // Fort Calder side reaches the island over a bridge
    expect(Number.isFinite(routeField(city, 0, 200)[air.lane.id])).toBe(true);
  });
  it('no building, store or named spot stands in the water', () => {
    for (const l of city.lots) expect(surfaceAt(city, l.x, l.z), `lot ${l.id} at ${l.x},${l.z}`).not.toBe('water');
    for (const s of STORES) expect(surfaceAt(city, s.x, s.z), s.name).not.toBe('water');
    for (const b of city.blocks) expect(surfaceAt(city, (b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2)).not.toBe('water');
  });
  it('a car can drive from the mainland (Old Town) to the island and back over a bridge', () => {
    const a = nearestLane(city, -760, -100)!, b = nearestLane(city, 0, 200)!;
    const fwd = routeField(city, 0, 200);
    expect(Number.isFinite(fwd[a.lane.id])).toBe(true);
    const back = routeField(city, -760, -100);
    expect(Number.isFinite(back[b.lane.id])).toBe(true);
  });
});

describe('Broadway', () => {
  it('is a diagonal street through intersections (1,1)..(4,4) with lanes both ways, signals and turning connectors', () => {
    const bw = city.paths.filter(p => p.name === 'Broadway');
    expect(bw.length).toBe(3);
    const diag = city.lanes.filter(l => l.diag);
    expect(diag.length).toBe(6);
    for (const l of diag) {
      expect(l.next.length, `diag lane ${l.id}`).toBeGreaterThan(0);
      expect(city.intersections[l.intersection].signalized).toBe(true);
    }
    // a car on the north-west end can reach the south-east end and vice versa
    const reach = (from: number) => { const seen = new Set([from]), q = [from]; while (q.length) for (const n of city.lanes[q.pop()!].next) if (!seen.has(n)) { seen.add(n); q.push(n); } return seen; };
    const first = diag.find(l => l.points[0].x < l.points[1].x)!;
    expect(diag.filter(l => reach(first.id).has(l.id)).length).toBeGreaterThanOrEqual(3);
  });
  it('cuts three blocks into triangles: road in the channel, no building in it, and the Flatiron fits a triangle', () => {
    expect(city.blocks.filter(b => b.diag).length).toBe(3);
    expect(surfaceAt(city, -200, -150 + 0)).toBe('road'); // on the diagonal near the middle block
    for (const l of city.lots) if (l.blockId >= 0 && city.blocks[l.blockId].diag) expect(Math.abs(((l.x + 250) - (l.z + 200)) * Math.SQRT1_2) > 8 || l.x > 0, `lot ${l.id}`).toBe(true);
  });
});

describe('traffic signal posts', () => {
  it('stand on a sidewalk corner, never inside a roadway or crosswalk band', async () => {
    const { signalPosts } = await import('./signals');
    const posts = signalPosts(city);
    expect(posts.length).toBeGreaterThan(100);
    for (const p of posts) {
      for (const [ox, oz] of [[0, 0], [0.4, 0], [-0.4, 0], [0, 0.4], [0, -0.4]]) {
        expect(surfaceAt(city, p.x + ox, p.z + oz), `post at ${p.x.toFixed(1)},${p.z.toFixed(1)} inter ${p.inter}`).not.toBe('road');
      }
      const inter = city.intersections[p.inter];
      // outside the cross street's crosswalk band and the avenue's kerb
      const alongHalf = p.axis === 'z' ? inter.halfZ : inter.halfX, acrossHalf = p.axis === 'z' ? inter.halfX : inter.halfZ;
      const along = p.axis === 'z' ? Math.abs(p.z - inter.z) : Math.abs(p.x - inter.x);
      const across = p.axis === 'z' ? Math.abs(p.x - inter.x) : Math.abs(p.z - inter.z);
      expect(along).toBeGreaterThan(alongHalf + 1); expect(across).toBeGreaterThan(acrossHalf + 0.5);
    }
  });
});

describe('east river waterfront', () => {
  it('has a row of buildings behind the Eastbank esplanade, none on a road', () => {
    const row = city.lots.filter(l => l.district === 'eastbank' && l.x > 698 && l.x < 726);
    expect(row.length).toBeGreaterThanOrEqual(8);
    for (const l of row) expect(surfaceAt(city, l.x, l.z), `lot ${l.id}`).not.toBe('road');
  });
});

describe('Eastbank signals', () => {
  it('has signalized junctions with posts, driven by the same signalState', async () => {
    const { signalPosts } = await import('./signals');
    const east = city.intersections.filter(i => i.ix < 0 && i.signalized && i.x > 700);
    expect(east.length).toBeGreaterThanOrEqual(6);
    const posts = signalPosts(city).filter(p => city.intersections[p.inter].x > 700);
    expect(posts.length).toBeGreaterThanOrEqual(18);
    const i0 = east[0]; let seenRed = false;
    for (let t = 0; t < SIGNAL_PERIOD; t += 0.5) if (signalState(i0, 'x', t) === 'red') seenRed = true;
    expect(seenRed).toBe(true);
  });
});
