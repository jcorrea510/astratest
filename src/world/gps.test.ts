import { describe, it, expect } from 'vitest';
import { generateCity, surfaceAt } from './citymap';
import { gpsRoute } from './gps';

const city = generateCity();
const onRoad = (p: { x: number; z: number }) => surfaceAt(city, p.x, p.z) === 'road';

describe('GPS routing', () => {
  it('stays on roads when the waypoint is across the water (bridge, not a straight line)', () => {
    // from the Cannery docks (east of the grid) to the airfield on the far side of the channel
    const from = { x: 440, z: 100 }, to = { x: 840, z: -300 };
    const r = gpsRoute(city, from.x, from.z, to.x, to.z)!;
    expect(r).toBeDefined();
    expect(r.length).toBeGreaterThan(8);
    // every interior point (not the player / waypoint ends) is on tarmac
    const bad = r.slice(1, -1).filter(p => !onRoad(p));
    expect(bad.length, JSON.stringify(bad.slice(0, 3))).toBe(0);
    // it crosses the channel only where the bridge is (freeway z = -480), never over open water
    const crossing = r.slice(1, -1).filter(p => p.x > 495 && p.x < 558);
    expect(crossing.length).toBeGreaterThan(0);
    for (const p of crossing) expect(Math.abs(p.z - -480)).toBeLessThan(12);
  });
  it('routes to a waypoint in the sea by ending at the shore road', () => {
    const r = gpsRoute(city, -100, 0, 100, 560)!;
    expect(r).toBeDefined();
    expect(r.slice(1, -1).every(onRoad)).toBe(true);
  });
});

describe('GPS routing in the south extension', () => {
  it('routes from the centre down to the Anchor Row financial district over roads only', () => {
    const r = gpsRoute(city, 0, 0, 90, 860)!;
    expect(r).toBeDefined();
    expect(r.length).toBeGreaterThan(10);
    expect(r.slice(1, -1).every(onRoad)).toBe(true);
    expect(Math.max(...r.map(p => p.z))).toBeGreaterThan(780);
  });
  it('routes onto the Harbor Drive waterfront highway', () => {
    const r = gpsRoute(city, 100, 100, 522, 500)!;
    expect(r).toBeDefined();
    expect(r.slice(1, -1).every(onRoad)).toBe(true);
  });
});

describe('GPS across the western river', () => {
  it('routes from the mainland to the island over a bridge and never over open water', () => {
    const r = gpsRoute(city, -800, 150, 0, 150)!;
    expect(r).toBeDefined();
    expect(r.slice(1, -1).every(onRoad)).toBe(true);
    expect(r.some(p => p.x > -526 && p.x < -464)).toBe(true);
  });
});
