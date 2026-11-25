import { describe, it, expect } from 'vitest';
import { publishRuntime, speedBlurAmount, motionScale, frameDue } from './runtime';
import { planRumble, type RumbleState } from './haptics';
import { radialDeadzone, lookStick } from './gamepad';

describe('speed blur gate', () => {
  it('passes through by default, off with speedBlur=false or reduceMotion', () => {
    expect(speedBlurAmount(0.8, { speedBlur: true, reduceMotion: false })).toBe(0.8);
    expect(speedBlurAmount(0.8, { speedBlur: false, reduceMotion: false })).toBe(0);
    expect(speedBlurAmount(0.8, { speedBlur: true, reduceMotion: true })).toBe(0);
  });
  it('reduce motion tones motion down to a quarter', () => {
    expect(motionScale({ reduceMotion: true })).toBe(0.25);
    expect(motionScale({ reduceMotion: false })).toBe(1);
  });
  it('publishRuntime reads settings with defaults and clamps', () => {
    const o = { speedBlur: true, reduceMotion: false, vibration: true, resolutionScale: 1, fpsCap: 0 };
    publishRuntime({ resolutionScale: 0.2, fpsCap: 60, speedBlur: false }, o);
    expect(o).toMatchObject({ resolutionScale: 0.5, fpsCap: 60, speedBlur: false, vibration: true });
    publishRuntime({}, o);
    expect(o).toMatchObject({ resolutionScale: 1, fpsCap: 0, speedBlur: true });
  });
});

describe('fps cap', () => {
  it('is always due when off, and spaces frames when set', () => {
    expect(frameDue(5, 4, 0)).toBe(true);
    expect(frameDue(10, 0, 30)).toBe(false);
    expect(frameDue(33.4, 0, 30)).toBe(true);
    expect(frameDue(16, 0, 60)).toBe(true); // 60 Hz display does not skip every other frame
  });
});

describe('rumble gating and cooldown', () => {
  const fresh = (): RumbleState => ({ until: 0, strength: 0 });
  it('does nothing when vibration is off or the strength is negligible', () => {
    expect(planRumble(0.8, 100, 0, fresh(), false)).toBeNull();
    expect(planRumble(0.01, 100, 0, fresh(), true)).toBeNull();
  });
  it('plays once, drops equal requests inside the cooldown, lets a clearly stronger one through, then resets', () => {
    const st = fresh();
    expect(planRumble(0.3, 100, 1000, st, true)).not.toBeNull();
    expect(planRumble(0.3, 100, 1050, st, true)).toBeNull();
    expect(planRumble(0.9, 300, 1060, st, true)).not.toBeNull();
    expect(planRumble(0.5, 100, 1200, st, true)).toBeNull(); // still inside the explosion's 300 ms
    expect(planRumble(0.3, 100, 1400, st, true)).not.toBeNull();
  });
  it('strong shocks use the strong motor more than taps', () => {
    const tap = planRumble(0.2, 50, 0, fresh(), true)!, boom = planRumble(1, 300, 0, fresh(), true)!;
    expect(boom.strong).toBeGreaterThan(tap.strong * 3);
  });
});

describe('gamepad deadzone math', () => {
  it('is radial: inside the zone is dead on both axes, outside rescales from 0 along the direction', () => {
    expect(radialDeadzone(0.1, 0.1, 0.2)).toEqual({ x: 0, y: 0 });
    const full = radialDeadzone(0.6, 0.8, 0.2);
    expect(Math.hypot(full.x, full.y)).toBeCloseTo(1, 5);
    expect(full.x / full.y).toBeCloseTo(0.75, 5); // direction preserved
    const mid = radialDeadzone(0.6, 0, 0.2);
    expect(mid.x).toBeCloseTo(0.5, 5);
  });
  it('a larger deadzone setting needs a bigger push; look curve is finer near centre', () => {
    expect(radialDeadzone(0.25, 0, 0.3).x).toBe(0);
    expect(radialDeadzone(0.25, 0, 0.1).x).toBeGreaterThan(0);
    const small = lookStick(0.4, 0, 0.1).x, lin = radialDeadzone(0.4, 0, 0.1).x;
    expect(small).toBeLessThan(lin);
    expect(lookStick(1, 0, 0.1).x).toBeCloseTo(1, 5);
  });
});
