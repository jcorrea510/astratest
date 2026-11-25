import { describe, it, expect } from 'vitest';
import { loadSettings, QUALITY, DEFAULT_BINDINGS } from './settings';

const store = (v: unknown) => ({ getItem: () => JSON.stringify(v) });

describe('settings', () => {
  it('density grows with the graphics preset only (there are no separate density settings)', () => {
    expect(QUALITY.low.pedestrians).toBeLessThan(QUALITY.medium.pedestrians);
    expect(QUALITY.medium.pedestrians).toBeLessThan(QUALITY.high.pedestrians);
    expect(QUALITY.low.traffic).toBeLessThan(QUALITY.medium.traffic);
    expect(QUALITY.medium.traffic).toBeLessThan(QUALITY.high.traffic);
  });
  it('migrates old saves: legacy density fields are dropped and P is added to the pause keys', () => {
    const s = loadSettings(store({ quality: 'high', pedDensity: 3, trafficDensity: 0.2, bindings: { pause: ['Escape'] } })) as unknown as Record<string, unknown> & ReturnType<typeof loadSettings>;
    expect(s.quality).toBe('high');
    expect(s.pedDensity).toBeUndefined(); expect(s.trafficDensity).toBeUndefined();
    expect(s.bindings.pause).toContain('Escape'); expect(s.bindings.pause).toContain('KeyP');
  });
  it('pause defaults to P first, Escape second', () => { expect(DEFAULT_BINDINGS.pause).toEqual(['KeyP', 'Escape']); });
});

describe('Round 12 settings model', () => {
  it('old saves get the new fields with defaults', () => {
    const s = loadSettings(store({ quality: 'high', sensitivity: 1.5 }));
    expect(s.quality).toBe('high');
    expect(s.padSensitivity).toBe(1); expect(s.padDeadzone).toBeCloseTo(0.12); expect(s.vibration).toBe(true);
    expect(s.speedBlur).toBe(true); expect(s.colorblind).toBe('off'); expect(s.uiScale).toBe(1);
    expect(s.resolutionScale).toBe(1); expect(s.fpsCap).toBe(0); expect(s.adsSensitivity).toBeGreaterThan(0);
    expect(s.ambience).toBeGreaterThan(0); expect(s.voice).toBeGreaterThan(0); expect(s.uiVolume).toBeGreaterThan(0);
  });
  it('clamps and validates the new fields', () => {
    const s = loadSettings(store({ uiScale: 9, resolutionScale: 0.1, padDeadzone: 5, padSensitivity: -1, fpsCap: 45, colorblind: 'nope', vibration: 'yes' }));
    expect(s.uiScale).toBe(1.4); expect(s.resolutionScale).toBe(0.5); expect(s.padDeadzone).toBe(0.3); expect(s.padSensitivity).toBe(0.3);
    expect(s.fpsCap).toBe(0); expect(s.colorblind).toBe('off'); expect(s.vibration).toBe(true);
  });
  it('keeps valid new values', () => {
    const s = loadSettings(store({ fpsCap: 30, colorblind: 'tritanopia', uiScale: 1.2, speedBlur: false }));
    expect(s.fpsCap).toBe(30); expect(s.colorblind).toBe('tritanopia'); expect(s.uiScale).toBe(1.2); expect(s.speedBlur).toBe(false);
  });
  it('migrates saved bindings that still hold the old clashing defaults, keeps custom ones', () => {
    const old = loadSettings(store({ bindings: { crouch: ['KeyC', 'AltLeft'], wheel: ['Tab', 'KeyQ'] } }));
    expect(old.bindings.crouch).toEqual(['KeyC']); expect(old.bindings.wheel).toEqual(DEFAULT_BINDINGS.wheel);
    const custom = loadSettings(store({ bindings: { crouch: ['AltLeft'], wheel: ['KeyQ'] } }));
    expect(custom.bindings.crouch).toEqual(['AltLeft']); expect(custom.bindings.wheel).toEqual(['KeyQ']);
  });
});
