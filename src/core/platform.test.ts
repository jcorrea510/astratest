import { afterEach, describe, expect, it } from 'vitest';
import { isStandalone } from './platform';

describe('isStandalone', () => {
  afterEach(() => { delete (globalThis as { __nativeApp?: string }).__nativeApp; });
  it('is false in a plain environment', () => { expect(isStandalone()).toBe(false); });
  it('is true inside a native wrapper (window.__nativeApp set)', () => {
    (globalThis as { __nativeApp?: string }).__nativeApp = 'ios';
    expect(isStandalone()).toBe(true);
  });
});
