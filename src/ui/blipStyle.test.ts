import { describe, it, expect } from 'vitest';
import { blipStyle, blipColor } from './blipStyle';
import { savePhase, SAVE_SHOW_MS } from './saveIndicator';

describe('colour-blind blip styles', () => {
  it('default police is a flashing disc that swaps blue and red', () => {
    const a = blipStyle('police', 'off', false, 0), b = blipStyle('police', 'off', false, 0.3);
    expect(a.shape).toBe('disc'); expect(a.color).not.toBe(b.color);
  });
  it('in every colour-blind mode police is a triangle, gang a square, so shape alone separates them', () => {
    for (const m of ['deuteranopia', 'protanopia', 'tritanopia'] as const) {
      expect(blipStyle('police', m, false, 0).shape, m).toBe('triangle');
      expect(blipStyle('enemy', m, false, 0).shape, m).toBe('square');
      expect(blipStyle('shop', m, false, 0).shape, m).toBe('disc');
      expect(blipColor('police', m)).not.toBe(blipColor('enemy', m));
    }
  });
  it('the siren alternates filled / hollow (pattern) in colour-blind mode instead of only changing colour', () => {
    const on = blipStyle('police', 'deuteranopia', false, 0), off = blipStyle('police', 'deuteranopia', false, 0.3);
    expect(on.color).toBe(off.color); expect(on.hollowFlash && off.hollowFlash).toBe(true); expect(on.flashing).not.toBe(off.flashing);
  });
  it('reduce motion makes the police blip steady in every mode', () => {
    for (const m of ['off', 'deuteranopia'] as const) {
      const a = blipStyle('police', m, true, 0), b = blipStyle('police', m, true, 0.3);
      expect(a).toEqual(b); expect(a.flashing).toBe(false);
    }
  });
  it('objective and gang colours differ from shop colours in every mode', () => {
    for (const m of ['off', 'deuteranopia', 'protanopia', 'tritanopia'] as const) { expect(blipColor('target', m)).not.toBe(blipColor('shop', m)); expect(blipColor('enemy', m)).not.toBe(blipColor('police', m)); }
  });
});

describe('save indicator phases', () => {
  it('saving, then saved, then hidden at 1.5 s', () => {
    expect(savePhase(0, true)).toBe('saving'); expect(savePhase(600, true)).toBe('saved'); expect(savePhase(SAVE_SHOW_MS, true)).toBe('hidden');
  });
  it('reduce motion skips the spinner; a failed write says so', () => {
    expect(savePhase(0, true, true)).toBe('saved'); expect(savePhase(100, false)).toBe('failed');
  });
});
