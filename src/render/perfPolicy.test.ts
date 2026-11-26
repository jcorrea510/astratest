import { describe, it, expect } from 'vitest';
import { classifyDevice, defaultQualityFor, pixelRatioFor, adaptStep, newDyn, shadowRedrawDue, shadowCasterWanted } from './perfPolicy';

const mac = { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', platform: 'MacIntel', maxTouchPoints: 0, cores: 8, dpr: 2 };
describe('device policy', () => {
  it('detects iPad (Mac UA + touch), Apple Silicon Mac, iPhone', () => {
    expect(classifyDevice({ ...mac, maxTouchPoints: 5, cores: 4 })).toBe('ipad');
    expect(classifyDevice(mac)).toBe('apple-mac');
    expect(classifyDevice({ ...mac, ua: 'iPhone', platform: 'iPhone' })).toBe('iphone');
  });
  it('defaults: iPad medium even with 4 reported cores; weak PCs low', () => {
    expect(defaultQualityFor({ ...mac, maxTouchPoints: 5, cores: 4 })).toBe('medium');
    expect(defaultQualityFor({ ua: 'x', platform: 'Win32', maxTouchPoints: 0, cores: 4, dpr: 1 })).toBe('low');
    expect(defaultQualityFor({ ua: 'x', platform: 'Win32', maxTouchPoints: 0, cores: 12, memory: 8, dpr: 1 })).toBe('medium');
  });
});
describe('pixelRatioFor', () => {
  it('iPad renders at 1.5 (not 1), M1 Air fits the budget, 1080p DPR1 stays 1', () => {
    expect(pixelRatioFor(1180, 820, 2, 1.5, 2.4e6, 1, 1)).toBeCloseTo(1.5);
    const air = pixelRatioFor(1440, 900, 2, 1.5, 2.4e6, 1, 1);
    expect(air).toBeGreaterThan(1.2); expect(air).toBeLessThan(1.5); expect(1440 * 900 * air * air).toBeLessThanOrEqual(2.41e6);
    expect(pixelRatioFor(1920, 1080, 1, 1.5, 2.4e6, 1, 1)).toBe(1);
  });
  it('adaptive scale lowers it but never below the floor', () => {
    expect(pixelRatioFor(1180, 820, 2, 1.5, 2.4e6, 1, 0.55)).toBeCloseTo(0.825);
    expect(pixelRatioFor(1180, 820, 2, 1, 1e6, 0.5, 0.55)).toBeGreaterThanOrEqual(0.5);
  });
});
function run(s: ReturnType<typeof newDyn>, ms: number, secs: number, t0: number, gpu = 0) {
  let now = t0, n = 0;
  for (let i = 0; i < (secs * 1000) / ms; i++) { now += ms; if (adaptStep(s, ms, now, true, gpu)) n++; }
  return { now, n };
}
describe('adaptive resolution targets 60 fps', () => {
  it('drops within ~2.5 s of sustained 25 ms frames and does not thrash afterwards', () => {
    const s = newDyn(); const r = run(s, 25, 2.5, 0); expect(r.n).toBeGreaterThanOrEqual(1);
    expect(r.n + run(s, 25 * s.scale * s.scale, 20, r.now).n).toBeLessThanOrEqual(8);
  });
  it('a hitch does not resize; 16.7 ms frames leave it alone', () => {
    const s = newDyn(); let now = 0, n = 0;
    for (let i = 0; i < 900; i++) { const dt = i === 300 ? 240 : 16.7; now += dt; if (adaptStep(s, dt, now, true)) n++; }
    expect(n).toBe(0);
  });
  it('CPU-bound frames (GPU timer low) do not lower resolution', () => { expect(run(newDyn(), 30, 20, 0, 6).n).toBe(0); });
  it('GPU-bound lowers, headroom raises, a failed raise sets a ceiling (no ping-pong)', () => {
    const s = newDyn(); let r = run(s, 22, 3, 0, 20); expect(s.scale).toBeLessThan(1);
    const low = s.scale; r = run(s, 16.7, 12, r.now, 8); expect(s.scale).toBeGreaterThan(low);
    const up = s.scale; r = run(s, 22, 3, r.now, 20); expect(s.scale).toBeLessThan(up); expect(s.ceil).toBe(up);
    run(s, 16.7, 30, r.now, 8); expect(s.scale).toBeLessThanOrEqual(up);
  });
  it('shadow cadence and caster rule', () => {
    expect([0, 1, 2, 3, 4].filter(f => shadowRedrawDue(f, 2, true))).toEqual([0, 2, 4]);
    expect([0, 1, 2, 3, 4].filter(f => shadowRedrawDue(f, 2, false))).toEqual([0, 4]);
    expect(shadowCasterWanted(0.2, 80, 54)).toBe(false); expect(shadowCasterWanted(0.2, 10, 54)).toBe(true);
    expect(shadowCasterWanted(5, 60, 54)).toBe(true); expect(shadowCasterWanted(1, 200, 54)).toBe(false);
  });
});
describe('output grade shader', () => {
  it('uses fxaaPlus and casSharpen', async () => {
    const { OUTPUT_GRADE_FRAG } = await import('./renderer');
    expect(OUTPUT_GRADE_FRAG).toContain('fxaaPlus(vUv');
    expect(OUTPUT_GRADE_FRAG).toContain('casSharpen(tDiffuse');
  });
});
