import { describe, it, expect } from 'vitest';
import { roadAt, worldAt, heightAt, curvature, hash, OUTER, laneU, NL, LANE_W } from './road';

describe('highway road', () => {
  it('is continuous and deterministic over a long distance', () => {
    let prev = roadAt(0), maxGrade = 0;
    for (let s = 5; s < 60000; s += 5) {
      const p = roadAt(s);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeGreaterThan(4.5);
      expect(Math.hypot(p.x - prev.x, p.z - prev.z)).toBeLessThan(5.5);
      expect(Math.abs(p.theta - prev.theta)).toBeLessThan(0.02);
      maxGrade = Math.max(maxGrade, Math.abs(p.slope));
      prev = p;
    }
    expect(maxGrade).toBeLessThan(0.045);
    expect(roadAt(1234).x).toBe(roadAt(1234).x);
  });
  it('curves stay gentle (radius > 450 m) and the start is straight', () => {
    let k = 0;
    for (let s = 0; s < 40000; s += 7) k = Math.max(k, Math.abs(curvature(s)));
    expect(k).toBeLessThan(1 / 450);
    expect(Math.abs(roadAt(250).theta)).toBeLessThan(1e-9);
    expect(Math.abs(heightAt(0))).toBeLessThan(1e-9);
  });
  it('lanes sit right of the median and offset along the right-hand normal', () => {
    expect(laneU(0)).toBeGreaterThan(1.8);
    expect(laneU(NL - 1) + LANE_W / 2).toBeCloseTo(OUTER, 5);
    const a = worldAt(100, 0), b = worldAt(100, 10);
    expect(b.x - a.x).toBeCloseTo(10, 5); // straight start: +u is +x, travel is -z
  });
  it('hash is stable and spread', () => {
    expect(hash(5, 1)).toBe(hash(5, 1));
    let sum = 0; for (let i = 0; i < 1000; i++) sum += hash(i, 3);
    expect(sum / 1000).toBeGreaterThan(0.4); expect(sum / 1000).toBeLessThan(0.6);
  });
});
