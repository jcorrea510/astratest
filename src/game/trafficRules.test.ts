import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { curbShift, yieldsToSiren, ViolationMonitor, type Violation, type LaneProbe, type PlayerSample, spawnGapClear } from './trafficRules';

const mk = () => { const out: Violation[] = []; return { out, m: new ViolationMonitor(v => out.push(v), (x, z) => new THREE.Vector3(x, 0, z)) }; };
const lane = (o: Partial<LaneProbe> = {}): LaneProbe => ({ id: 1, limit: 13, dist: 0.5, dx: 0, dz: 1, toStop: 50, signal: 'green', ...o });
const me = (o: Partial<PlayerSample> = {}): PlayerSample => ({ x: 0, z: 0, fx: 0, fz: 1, speed: 10, beta: 0, nearCars: 0, hitCar: false, ...o });
const run = (m: ViolationMonitor, secs: number, p: PlayerSample, l: LaneProbe | null) => { for (let i = 0; i < secs * 8; i++) m.update(0.125, p, l); };

describe('kerb clearance', () => {
  it('shifts away from a parked car that intrudes into the lane, not from one that does not', () => {
    expect(curbShift(-1.95, 0.95, 0.95)).toBeGreaterThan(0.1);
    expect(curbShift(-3.2, 0.95, 0.95)).toBe(0);
    expect(curbShift(1.0, 0.95, 0.95)).toBe(0); // on our left
    expect(curbShift(-0.5, 0.95, 0.95)).toBeLessThanOrEqual(1.4);
  });
});
describe('siren yielding', () => {
  it('yields to a siren coming up behind or oncoming, ignores one far or driving away', () => {
    expect(yieldsToSiren(0, 0, 0, 1, 0, -25, 0, 1, 20)).toBe(true); // behind, same way
    expect(yieldsToSiren(0, 0, 0, 1, 0, 30, 0, -1, 15)).toBe(true); // oncoming
    expect(yieldsToSiren(0, 0, 0, 1, 0, -90, 0, 1, 20)).toBe(false); // far
    expect(yieldsToSiren(0, 0, 0, 1, 0, 30, 0, 1, 15)).toBe(false); // ahead, driving away
  });
});
describe('player traffic violations', () => {
  it('reports speeding only well over the limit', () => {
    let { out, m } = mk(); run(m, 3, me({ speed: 15 }), lane()); expect(out).toHaveLength(0);
    ({ out, m } = mk()); run(m, 3, me({ speed: 30 }), lane()); expect(out.map(v => v.kind)).toEqual(['speeding']);
  });
  it('reports wrong-way driving', () => {
    const { out, m } = mk(); run(m, 3, me({ fz: -1 }), lane()); expect(out.map(v => v.kind)).toContain('wrong_way');
  });
  it('reports running a red light but not stopping for it', () => {
    let { out, m } = mk();
    for (let d = 14; d > -3; d -= 1.2) m.update(0.125, me({ speed: 10 }), lane({ toStop: d, signal: 'red' }));
    m.update(0.125, me({ speed: 10 }), lane({ id: 2, toStop: 80, signal: 'red', dist: 8 }));
    expect(out.map(v => v.kind)).toEqual(['red_light']);
    ({ out, m } = mk());
    for (let d = 14; d > 1; d -= 1) m.update(0.125, me({ speed: Math.max(0, d / 2) }), lane({ toStop: d, signal: 'red' }));
    run(m, 2, me({ speed: 0 }), lane({ toStop: 0.5, signal: 'red' }));
    expect(out).toHaveLength(0);
  });
  it('reports collisions and reckless sliding, with a position', () => {
    const { out, m } = mk();
    m.update(0.125, me({ hitCar: true, x: 5, z: 7 }), lane());
    run(m, 2, me({ speed: 20, beta: 0.8, nearCars: 2 }), lane());
    expect(out.map(v => v.kind)).toEqual(['collision', 'reckless']);
    expect(out[0].pos.x).toBe(5); expect(out[0].pos.z).toBe(7);
  });
  it('rate limits repeats', () => {
    const { out, m } = mk(); run(m, 6, me({ speed: 30 }), lane()); expect(out.length).toBe(1);
  });
});

describe('spawnGapClear (far-car spawn spacing)', () => {
  const stopped = [{ s: 50, len: 4.6 }];
  it('rejects spawning right behind or ahead of a stopped car, and inside its gap', () => {
    expect(spawnGapClear(46, 4.5, stopped)).toBe(false); // bumper-to-bumper
    expect(spawnGapClear(40, 4.5, stopped)).toBe(false); // 5.4 m bumper gap
    expect(spawnGapClear(58, 4.5, stopped)).toBe(false);
    expect(spawnGapClear(50, 4.5, stopped)).toBe(false); // on top
  });
  it('accepts >= 8 m bumper gap on either side and an empty lane', () => {
    expect(spawnGapClear(50 - 17.2, 4.5, stopped)).toBe(true);
    expect(spawnGapClear(50 + 17.2, 4.5, stopped)).toBe(true);
    expect(spawnGapClear(10, 4.5, [])).toBe(true);
  });
  it('keeps room for a long bus', () => {
    expect(spawnGapClear(66, 11.6, stopped)).toBe(false);
    expect(spawnGapClear(50 + 22, 11.6, stopped)).toBe(true);
  });
});
