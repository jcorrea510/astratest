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
