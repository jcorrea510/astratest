import { describe, it, expect } from 'vitest';
import { adsAssist, makeAssistOut, ASSIST_CONE, ASSIST_FRICTION } from './aimAssist';

describe('adsAssist', () => {
  const o = makeAssistOut();
  it('slows look at the reticle centre and never exceeds the friction floor', () => {
    adsAssist(0, 0, 0, 0, 0, 0, 0, -20, false, 1 / 60, o);
    expect(o.friction).toBeCloseTo(ASSIST_FRICTION, 5);
    expect(o.dYaw).toBe(0);
  });
  it('does nothing outside the cone, beyond range, or too close', () => {
    adsAssist(0, 0, 0, 0, 0, 5, 0, -20, false, 1 / 60, o); expect(o.friction).toBe(1);
    adsAssist(0, 0, 0, 0, 0, 0, 0, -80, true, 1 / 60, o); expect(o.friction).toBe(1); expect(o.dYaw).toBe(0);
    adsAssist(0, 0, 0, 0, 0, 0, 0, -0.5, true, 1 / 60, o); expect(o.friction).toBe(1);
  });
  it('friction eases in smoothly across the cone', () => {
    let prev = 1;
    for (let i = 0; i <= 10; i++) {
      const a = ASSIST_CONE * (1 - i / 10) * 0.999;
      adsAssist(0, 0, 0, 0, 0, -Math.sin(a) * 20, 0, -Math.cos(a) * 20, false, 1 / 60, o);
      expect(o.friction).toBeLessThanOrEqual(prev + 1e-9); prev = o.friction;
    }
  });
  it('pad pull is gentle, toward the target, and never overshoots', () => {
    const a = 0.02; // target slightly left (yaw increases to the left): inside cone
    adsAssist(0, 0, 0, 0, 0, -Math.sin(a) * 20, 0, -Math.cos(a) * 20, true, 1 / 60, o);
    expect(o.dYaw).toBeGreaterThan(0); expect(o.dYaw).toBeLessThan(0.01); expect(o.dYaw).toBeLessThanOrEqual(a);
    adsAssist(0, 0, 0, 0, 0, -Math.sin(a) * 20, 0, -Math.cos(a) * 20, false, 1 / 60, o);
    expect(o.dYaw).toBe(0); // mouse: friction only
    adsAssist(0, 0, 0, 0, 0, 0, 0, -20, true, 10, o);
    expect(Math.abs(o.dYaw)).toBe(0); expect(Math.abs(o.dPitch)).toBe(0); // already on target
  });
});

import { DEFAULT_BINDINGS } from '../core/settings';
import { findConflicts } from '../ui/bindings';
describe('shoulder swap binding', () => {
  it('defaults to T without clashing with other bindings', () => {
    expect(DEFAULT_BINDINGS.shoulder).toEqual(['KeyT']);
    expect(findConflicts(DEFAULT_BINDINGS).size).toBe(0);
  });
});
