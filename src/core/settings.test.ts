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
