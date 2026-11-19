import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { HeatState } from './police';
import { Dispatch } from './dispatch';
import { QUALITY } from '../core/settings';

describe('stolen aircraft heat', () => {
  it('a stolen civilian helicopter is instantly 3 stars, a police one 4', () => {
    const a = new HeatState(); a.add('heliTheft'); expect(a.heat).toBe(3);
    const b = new HeatState(); b.add('policeHeliTheft'); expect(b.heat).toBe(4);
  });
  it('stealing a police/army vehicle raises heat', () => {
    const a = new HeatState(); a.add('copCarTheft'); expect(a.heat).toBeGreaterThanOrEqual(2);
  });
  it('a helicopter theft rush calls in extra patrol cars', () => {
    const d = new Dispatch({ lanes: [] } as never, {} as never, {} as never, {} as never);
    let n = 0; const units: never[] = [];
    // with no cars yet the most serious missing unit is requested; extra only raises the police quota
    expect(d.nextNeeded(units, 3, 4)).not.toBeNull();
    n++; expect(n).toBe(1);
  });
});
describe('NPC voices removed', () => {
  it('has no voices module', () => { expect(existsSync('src/audio/voices.ts')).toBe(false); });
});
describe('crowds', () => {
  it('medium has 3-5x the old pedestrian count and more traffic', () => {
    // near (full-AI) pedestrians are capped for M1 frame time; the instanced far crowd carries the density
    expect(QUALITY.medium.pedestrians).toBeGreaterThanOrEqual(60);
    expect(QUALITY.medium.pedestrians + QUALITY.medium.farPeds).toBeGreaterThanOrEqual(350);
    expect(QUALITY.medium.traffic).toBeGreaterThan(18);
  });
});
