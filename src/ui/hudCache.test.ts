import { describe, expect, it } from 'vitest';
import { MoneyText, formatMoney } from './geometry';
import { minimapDue, MINIMAP_INTERVAL_MS } from './minimap';

describe('MoneyText cache', () => {
  it('formats a value once however many frames ask for it', () => {
    const m = new MoneyText();
    for (let i = 0; i < 100; i++) expect(m.format(12345.4)).toBe('$12,345');
    expect(m.builds).toBe(1);
    expect(m.format(12345.6)).toBe('$12,346');
    expect(m.builds).toBe(2);
    expect(m.format(-5)).toBe(formatMoney(-5));
  });
  it('sub-dollar changes do not rebuild the string', () => {
    const m = new MoneyText();
    m.format(100.1); m.format(100.2); m.format(99.9);
    expect(m.builds).toBe(1);
  });
});

describe('minimap redraw throttle', () => {
  it('redraws about 15 times a second, not every frame', () => {
    let last = -1e9, draws = 0;
    for (let t = 0; t < 1000; t += 1000 / 60) if (minimapDue(t, last)) { last = t; draws++; }
    expect(draws).toBeGreaterThanOrEqual(13);
    expect(draws).toBeLessThanOrEqual(16);
    expect(MINIMAP_INTERVAL_MS).toBeGreaterThanOrEqual(60);
  });
});
