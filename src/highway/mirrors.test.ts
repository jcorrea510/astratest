import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { mirrorDue, mirrorEvery, sideMirrorsLive, cropUv, CROP } from './mirrors';
import { clockText, nextExit, tripText } from './infotext';

describe('mirror reflection throttle', () => {
  it('renders the reflection only every 3rd frame (2nd on high), first frame included', () => {
    const run = (every: number) => Array.from({ length: 30 }, (_, f) => mirrorDue(f, every)).filter(Boolean).length;
    expect(run(mirrorEvery('medium'))).toBe(10);
    expect(run(mirrorEvery('low'))).toBe(10);
    expect(run(mirrorEvery('high'))).toBe(15);
    expect(mirrorDue(0, 3)).toBe(true);
    expect(mirrorDue(1, 3)).toBe(false);
  });
  it('side mirrors skip the reflection pass on low quality', () => {
    expect(sideMirrorsLive('low')).toBe(false);
    expect(sideMirrorsLive('medium')).toBe(true);
    expect(sideMirrorsLive('high')).toBe(true);
  });
  it('crops flip left-right like a mirror and stay inside the texture', () => {
    const g = new THREE.PlaneGeometry(1, 1); cropUv(g, CROP.rear);
    const uv = g.getAttribute('uv'), xs = Array.from({ length: uv.count }, (_, i) => uv.getX(i)), ys = Array.from({ length: uv.count }, (_, i) => uv.getY(i));
    expect(Math.min(...xs)).toBeCloseTo(0.2); expect(Math.max(...xs)).toBeCloseTo(0.8);
    expect(Math.min(...ys)).toBeCloseTo(0.29); expect(Math.max(...ys)).toBeCloseTo(0.71);
    // the plane's left edge (original u = 0) now samples the crop's right edge
    const left = Array.from({ length: uv.count }, (_, i) => i).find(i => new THREE.PlaneGeometry(1, 1).getAttribute('uv').getX(i) === 0)!;
    expect(uv.getX(left)).toBeCloseTo(0.8);
    for (const c of Object.values(CROP)) expect(c[0] >= 0 && c[1] <= 1 && c[2] >= 0 && c[3] <= 1).toBe(true);
  });
});

describe('live infotainment text', () => {
  it('clock is a 12-hour AM/PM string that advances with game time', () => {
    expect(clockText(14.2)).toBe('2:12 PM');
    expect(clockText(0.5)).toBe('12:30 AM');
    expect(clockText(12)).toBe('12:00 PM');
    expect(clockText(23.99)).toBe('11:59 PM');
    expect(clockText(14.2 + 24 * 3)).toBe('2:12 PM');
    expect(clockText(14.2)).not.toBe(clockText(14.2 + 1 / 60 * 5));
  });
  it('next exit counts down with distance driven, switching to feet when close, then moves on to the next exit', () => {
    const a = nextExit(0), b = nextExit(4000), c = nextExit(7900), d = nextExit(8100);
    expect(a.dist).toBe('5.0 mi'); expect(b.dist).toBe('2.5 mi'); expect(c.dist).toMatch(/ft$/);
    expect(a.exit).not.toBe(d.exit); expect(a.road).not.toBe(d.road);
    expect(b.frac).toBeGreaterThan(a.frac);
  });
  it('trip is miles driven', () => { expect(tripText(1609.344)).toBe('1.0 mi'); expect(tripText(0)).toBe('0.0 mi'); });
});
