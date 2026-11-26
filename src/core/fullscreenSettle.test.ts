import { describe, it, expect, afterEach } from 'vitest';
import { toggleFullscreen, fullscreenSettling } from './fullscreen';

const g = globalThis as unknown as Record<string, unknown>;
afterEach(() => { delete g.window; delete g.document; });

describe('fullscreen switch settling (shellfs: fullscreenchange took 30 s while the city rendered)', () => {
  it('stops drawing right after a toggle and resumes by itself within 1.5 s', () => {
    let asked = 0;
    g.window = {};
    g.document = { fullscreenElement: null, documentElement: { requestFullscreen: () => { asked++; return Promise.resolve(); } } };
    const t0 = performance.now();
    expect(fullscreenSettling(t0)).toBe(false);
    toggleFullscreen();
    expect(asked).toBe(1);
    expect(fullscreenSettling()).toBe(true);
    expect(fullscreenSettling(t0 + 1600)).toBe(false);
  });
});
