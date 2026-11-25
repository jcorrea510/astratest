import { describe, expect, it } from 'vitest';
import { DUCK_BLAST_DB, DUCK_GUN_DB, DuckState, UI_SOUNDS, busGains, channelsFromSettings, dbToLin, defaultChannels, duckDepthDb, isUiSound, sliderGain } from './mixer';
import { VoicePool } from './voicepool';
import { registerUiAudio, uiSound } from './uiSounds';

describe('channel gain math', () => {
  it('squares sliders and clamps junk', () => {
    expect(sliderGain(0.5)).toBeCloseTo(0.25);
    expect(sliderGain(5)).toBe(1); expect(sliderGain(-1)).toBe(0); expect(sliderGain(NaN)).toBe(1);
  });
  it('defaults leave the legacy mix unchanged', () => {
    const b = busGains({ master: 1, music: 0.7, sfx: 1 }, defaultChannels());
    expect(b.master).toBe(1); expect(b.music).toBeCloseTo(0.49); expect(b.sfx).toBe(1); expect(b.ui).toBe(1); expect(b.ambience).toBe(1);
  });
  it('channels multiply the legacy sliders independently', () => {
    const b = busGains({ master: 1, music: 1, sfx: 0.5 }, { music: 0.5, sfx: 1, ambience: 0, voice: 0.5, ui: 1 });
    expect(b.music).toBeCloseTo(0.25); expect(b.sfx).toBeCloseTo(0.25); expect(b.ambience).toBe(0); expect(b.voice).toBeCloseTo(0.0625); expect(b.ui).toBeCloseTo(0.25);
  });
  it('reads settings defensively', () => {
    expect(channelsFromSettings(undefined)).toEqual(defaultChannels());
    expect(channelsFromSettings({ musicVolume: 0.3, uiVolume: 'x', voiceVolume: NaN })).toMatchObject({ music: 0.3, ui: 1, voice: 1 });
  });
});

describe('ducking', () => {
  it('ducks 4 dB for guns and 6 dB for blasts, none for footsteps', () => {
    expect(duckDepthDb('gun_pistol', 6, 1)).toBe(DUCK_GUN_DB);
    expect(duckDepthDb('explosion', 9, 0)).toBe(DUCK_BLAST_DB);
    expect(duckDepthDb('footstep', 1, 0)).toBe(0);
    expect(dbToLin(DUCK_GUN_DB)).toBeGreaterThan(dbToLin(DUCK_BLAST_DB));
  });
  it('re-triggers only for deeper or expired ducks (no automation spam)', () => {
    const d = new DuckState();
    expect(d.hit(0, DUCK_GUN_DB)).toBeCloseTo(dbToLin(DUCK_GUN_DB));
    expect(d.hit(0.05, DUCK_GUN_DB)).toBe(0);
    expect(d.hit(0.06, DUCK_BLAST_DB)).toBeCloseTo(dbToLin(DUCK_BLAST_DB));
    expect(d.hit(0.07, DUCK_GUN_DB)).toBe(0);
    expect(d.hit(5, DUCK_GUN_DB)).toBeGreaterThan(0);
    expect(d.hit(6, 0)).toBe(0);
  });
});

describe('ui sounds + voice cap', () => {
  it('defines all six sounds with sane recipes', () => {
    for (const n of ['hover', 'select', 'back', 'purchase', 'error', 'notification']) {
      expect(isUiSound(n)).toBe(true);
      for (const note of UI_SOUNDS[n as keyof typeof UI_SOUNDS].notes) { expect(note.peak).toBeLessThan(0.2); expect(note.dec).toBeLessThan(0.4); }
    }
    expect(isUiSound('constructor')).toBe(false);
  });
  it('uiSound is a safe no-op until audio is registered, then forwards', () => {
    expect(() => uiSound('select')).not.toThrow();
    const calls: string[] = []; registerUiAudio({ ui: n => { calls.push(n); } });
    uiSound('purchase'); expect(calls).toEqual(['purchase']);
    registerUiAudio(null);
  });
  it('a 500-shot firefight never holds more than the pool max (oldest stolen)', () => {
    const p = new VoicePool<number>(32, () => 7);
    for (let i = 0; i < 500; i++) {
      const t = i * 0.01, r = p.admit(`k${i % 10}`, 6, t);
      if (r.ok) p.add({ key: `k${i % 10}`, start: t, end: t + 5, priority: 6, handle: i });
      expect(p.size).toBeLessThanOrEqual(32);
    }
  });
});
