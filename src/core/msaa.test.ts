import { it, expect } from 'vitest';
import { safeMsaa } from './platform';
it('no MSAA render targets on iPad (green bar on High, Round 8); Mac keeps the preset', () => {
  expect(safeMsaa(2, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari', platform: 'MacIntel', maxTouchPoints: 5 })).toBe(0);
  expect(safeMsaa(2, { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' })).toBe(0);
  expect(safeMsaa(2, { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome', platform: 'MacIntel', maxTouchPoints: 0 })).toBe(2);
});
