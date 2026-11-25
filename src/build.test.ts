import { describe, it, expect } from 'vitest';
import pkg from '../package.json';
import { VERSION, VERSION_LABEL, BUILD, formatVersion } from './build';

describe('build version', () => {
  it('comes from package.json and is formatted once', () => {
    expect(VERSION).toBe(pkg.version);
    expect(VERSION_LABEL).toBe(formatVersion(pkg.version));
    expect(BUILD.startsWith(VERSION_LABEL)).toBe(true);
  });
  it('has no stale hard-coded versions', () => {
    expect(BUILD).not.toMatch(/0\.3\.0|0\.8\.70/);
  });
});
