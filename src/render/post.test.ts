import { describe, it, expect } from 'vitest';
import { projectedRadiusPx, AO_DEFAULT } from './post';
import { QUALITY } from '../core/settings';

describe('Round 12 post effects', () => {
  it('AO radius shrinks with distance', () => {
    const near = projectedRadiusPx(1, -5, 1.6, 720), far = projectedRadiusPx(1, -50, 1.6, 720);
    expect(near).toBeCloseTo(far * 10, 5);
  });
  it('AO is off on Low and fades out before the fog', () => {
    expect(QUALITY.low.ao).toBe(0);
    expect(QUALITY.medium.ao).toBeGreaterThan(0);
    expect(QUALITY.high.ao).toBeGreaterThanOrEqual(QUALITY.medium.ao);
    expect(AO_DEFAULT.fadeFar).toBeLessThan(QUALITY.medium.drawDistance);
  });
});

import { sampleSky } from './sky';
describe('Round 12 night look', () => {
  it('keeps night moon and sky fill low so lamps and headlights make the light pools (night read as grey haze)', () => {
    for (const h of [0, 2, 22.5]) {
      const s = sampleSky(h);
      expect(s.night).toBe(1);
      expect(s.hemiI).toBeLessThanOrEqual(0.55);
      expect(s.sunI).toBeLessThanOrEqual(0.45);
    }
  });
});

import * as THREE from 'three';
import { composerTargetOptions } from './renderer';
describe('composer target', () => {
  it('builds on every quality preset (Low has no AO and used to crash the load with depthTexture: undefined)', () => {
    for (const q of Object.values(QUALITY)) {
      const o = composerTargetOptions(64, 64, 0, q.ao > 0);
      expect(() => new THREE.RenderTarget(64, 64, o)).not.toThrow();
      expect('depthTexture' in o).toBe(q.ao > 0);
    }
  });
});

import { DAY_FOG_NEAR } from './renderer';
describe('Round 13 photographic daylight', () => {
  it('noon: sun is 4-8x the sky fill, ambient is not strongly blue, exposure sane', () => {
    for (const h of [10, 11, 12, 14, 15.5]) {
      const s = sampleSky(h);
      const r = s.sunI / s.hemiI;
      expect(r).toBeGreaterThan(4); expect(r).toBeLessThan(8);
      expect(s.hemiSky.b - s.hemiSky.r).toBeLessThan(0.3);
      expect(s.sun.r).toBeGreaterThanOrEqual(s.sun.b);
      expect(s.exposure).toBeGreaterThan(0.85); expect(s.exposure).toBeLessThan(1.1);
    }
  });
  it('night exposure stays modest and the ground bounce is not black', () => {
    for (const h of [0, 2, 23]) { const s = sampleSky(h); expect(s.exposure).toBeLessThanOrEqual(1.31); expect(s.hemiGround.b).toBeGreaterThan(0.03); }
  });
  it('daytime fog starts at a finite distance and is a light haze colour', () => {
    expect(DAY_FOG_NEAR).toBeGreaterThan(30); expect(DAY_FOG_NEAR).toBeLessThan(QUALITY.low.drawDistance);
    const s = sampleSky(12); expect((s.fog.r + s.fog.g + s.fog.b) / 3).toBeGreaterThan(0.5);
  });
});
