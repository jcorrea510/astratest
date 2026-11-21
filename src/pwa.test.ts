import { describe, it, expect } from 'vitest';
import { shouldRegisterSW } from './pwa';

const ok = { hasSW: true, webdriver: false, dev: false, secure: true, optOut: false };
describe('service worker registration guard', () => {
  it('registers on a normal secure production page', () => { expect(shouldRegisterSW(ok)).toBe(true); });
  it('stays out of automation, dev, insecure origins, ?nosw and browsers without SW', () => {
    expect(shouldRegisterSW({ ...ok, webdriver: true })).toBe(false);
    expect(shouldRegisterSW({ ...ok, dev: true })).toBe(false);
    expect(shouldRegisterSW({ ...ok, secure: false })).toBe(false);
    expect(shouldRegisterSW({ ...ok, optOut: true })).toBe(false);
    expect(shouldRegisterSW({ ...ok, hasSW: false })).toBe(false);
  });
});
