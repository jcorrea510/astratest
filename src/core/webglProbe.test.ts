import { describe, expect, it, vi } from 'vitest';
import { probeWebgl2 } from './webglProbe';

describe('probeWebgl2', () => {
  it('releases the probe context after a successful probe', () => {
    const loseContext = vi.fn();
    const gl = { getExtension: (n: string) => (n === 'WEBGL_lose_context' ? { loseContext } : null) };
    expect(probeWebgl2(() => ({ getContext: () => gl }))).toBe(true);
    expect(loseContext).toHaveBeenCalledTimes(1);
  });
  it('is true even when the context-loss extension is missing', () => {
    expect(probeWebgl2(() => ({ getContext: () => ({ getExtension: () => null }) }))).toBe(true);
  });
  it('is false when webgl2 is unavailable or throws', () => {
    expect(probeWebgl2(() => ({ getContext: () => null }))).toBe(false);
    expect(probeWebgl2(() => ({ getContext: () => { throw new Error('x'); } }))).toBe(false);
  });
});
