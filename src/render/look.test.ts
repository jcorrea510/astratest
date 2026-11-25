import { describe, it, expect } from 'vitest';
import { LOOK } from './renderer';
import { DEFAULT_SETTINGS, loadSettings } from '../core/settings';

describe('colour grade', () => {
  it('defaults to a neutral photographic look', () => {
    expect(DEFAULT_SETTINGS.look).toBe('natural');
    // Round 12: AgX tone mapping rolls saturation off, so the natural grade adds a little back (ACES needed < 1)
    expect(LOOK.natural.sat).toBeLessThanOrEqual(1.15);
    expect(LOOK.natural.split).toBeLessThan(0.35);
    expect(LOOK.natural.vignette).toBeLessThan(0.2);
    expect(LOOK.natural.nightExposure).toBeLessThan(1);
    expect(LOOK.stylised.split).toBe(1);
  });
  it('sanitises look and driving from storage', () => {
    const s = loadSettings({ getItem: () => JSON.stringify({ look: 'weird', driving: 'x' }) });
    expect(s.look).toBe('natural'); expect(s.driving).toBe('arcade');
    expect(loadSettings({ getItem: () => JSON.stringify({ look: 'stylised', driving: 'realistic' }) }).driving).toBe('realistic');
  });
});
