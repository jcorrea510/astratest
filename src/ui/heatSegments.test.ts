import { describe, it, expect } from 'vitest';
import { heatFilled, heatSegments, heatMode, HEAT_RISE_MS } from './heatSegments';

describe('heatSegments', () => {
  it('fills left to right', () => {
    expect(heatSegments(0)).toEqual([false, false, false, false, false]);
    expect(heatSegments(3)).toEqual([true, true, true, false, false]);
    expect(heatSegments(5)).toEqual([true, true, true, true, true]);
  });
  it('clamps and ignores tiny fractions and NaN', () => {
    expect(heatFilled(0.04)).toBe(0);
    expect(heatFilled(0.5)).toBe(1);
    expect(heatFilled(9)).toBe(5);
    expect(heatFilled(-2)).toBe(0);
    expect(heatFilled(NaN)).toBe(0);
  });
  it('picks the mode', () => {
    expect(heatMode(0, true, 0)).toBe('idle');
    expect(heatMode(2, false, 100)).toBe('rising');
    expect(heatMode(2, true, 100)).toBe('rising');
    expect(heatMode(2, true, HEAT_RISE_MS + 1)).toBe('search');
    expect(heatMode(2, false, HEAT_RISE_MS + 1)).toBe('idle');
    expect(heatMode(2, true, -1)).toBe('search');
  });
});
