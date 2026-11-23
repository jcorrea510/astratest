import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { WEAPONS } from '../combat/weapons';
import { GUNS } from './gunsynth';
import { GUN_SAMPLE_DIR, GUN_SAMPLE_NAMES, GUN_SETS, gunSampleBuf, registerGunSample, gunSamplesPlayed } from './gunSamples';
import type { Kit } from './dsp';

const DIR = `public/${GUN_SAMPLE_DIR}`;

describe('recorded gunshot sets', () => {
  it('maps every firearm in WEAPONS to a sample set with near and far takes', () => {
    for (const w of Object.values(WEAPONS)) {
      if (w.sound === 'punch') continue;
      const set = GUN_SETS[w.sound];
      expect(set, `${w.id} -> ${w.sound}`).toBeTruthy();
      expect(set.near.files.length).toBeGreaterThan(0);
      expect(set.far.files.length).toBeGreaterThan(0);
      expect(set.near.rate).toBeGreaterThan(0.7); expect(set.near.rate).toBeLessThan(1.3);
    }
  });
  it('covers every synth gun voice', () => { expect(Object.keys(GUN_SETS).sort()).toEqual(Object.keys(GUNS).sort()); });
  it('ships every referenced file, and nothing else, under 3 MB', () => {
    const onDisk = readdirSync(DIR).filter(f => f.endsWith('.mp3')).map(f => f.replace(/\.mp3$/, '')).sort();
    expect(onDisk).toEqual([...GUN_SAMPLE_NAMES]);
    for (const n of GUN_SAMPLE_NAMES) expect(existsSync(`${DIR}${n}.mp3`)).toBe(true);
    const total = onDisk.reduce((a, n) => a + statSync(`${DIR}${n}.mp3`).size, 0);
    expect(total).toBeLessThan(3 * 1024 * 1024);
  });
  it('round-robins takes without immediate repeats and falls back to null when nothing is decoded', () => {
    let seed = 1; const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const k = { rand } as unknown as Kit;
    expect(gunSampleBuf(k, 'pistol', false)).toBeNull();
    for (const f of GUN_SETS.pistol.near.files) registerGunSample(k, f, { duration: 1 } as AudioBuffer);
    let prev: unknown = null;
    for (let i = 0; i < 50; i++) { const s = gunSampleBuf(k, 'pistol', false)!; expect(s.buf).not.toBe(prev); prev = s.buf; }
    expect(gunSampleBuf(k, 'pistol', true)).toBeNull(); // far takes not decoded
    expect(gunSamplesPlayed(k)).toBe(50);
  });
});
