import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { sampleSky, kelvinHex } from './sky';

const warmth = (c: THREE.Color) => (c.r + 1e-6) / (c.b + 1e-6); // red/blue ratio: higher = warmer
describe('sampleSky (Round 14 LK)', () => {
  it('kelvinHex: 2000K is orange, 6500K near white', () => {
    const w = new THREE.Color(kelvinHex(6500)), o = new THREE.Color(kelvinHex(2000));
    expect(Math.abs(w.r - w.b)).toBeLessThan(0.1); expect(o.r).toBeGreaterThan(o.b * 4);
  });
  it('sun warmth by elevation: low sun warmer than midday, midday near-white', () => {
    const noon = sampleSky(12.5).sun, morning = sampleSky(7.2).sun, eve = sampleSky(19.4).sun;
    expect(warmth(morning)).toBeGreaterThan(warmth(noon));
    expect(warmth(eve)).toBeGreaterThan(warmth(morning));
    expect(warmth(noon)).toBeLessThan(1.8);
  });
  it('sun intensity rises to midday and falls to night; stays within sane ranges', () => {
    expect(sampleSky(9).sunI).toBeGreaterThan(sampleSky(7).sunI);
    expect(sampleSky(12).sunI).toBeGreaterThan(sampleSky(18.5).sunI);
    expect(sampleSky(18.5).sunI).toBeGreaterThan(sampleSky(22).sunI);
    for (let h = 0; h < 24; h += 0.25) {
      const s = sampleSky(h);
      expect(s.exposure).toBeGreaterThan(0.8); expect(s.exposure).toBeLessThan(1.35);
      expect(s.hemiI).toBeGreaterThan(0.3); expect(s.hemiI).toBeLessThan(0.8);
      expect(s.sunI).toBeLessThan(4);
    }
  });
  it('daytime shadows: sky fill is cooler than ground bounce, nothing is black', () => {
    const s = sampleSky(12);
    expect(s.hemiSky.b / s.hemiSky.r).toBeGreaterThan(s.hemiGround.b / s.hemiGround.r);
    expect(s.hemiGround.r + s.hemiGround.g + s.hemiGround.b).toBeGreaterThan(0.2);
  });
  it('fog matches the horizon haze by day (aerial perspective)', () => {
    for (const h of [10, 12, 15]) {
      const s = sampleSky(h);
      expect(Math.abs(s.fog.r - s.horizon.r) + Math.abs(s.fog.g - s.horizon.g) + Math.abs(s.fog.b - s.horizon.b)).toBeLessThan(0.15);
    }
  });
  it('night is dark but fog stays lifted', () => {
    const s = sampleSky(1); expect(s.night).toBe(1); expect(s.fog.b).toBeGreaterThan(0.015);
  });
});
