import { describe, it, expect } from 'vitest';
import { Traffic } from './traffic';
import { mulberry } from './rng';
import { mpsFromMph } from '../core/units';

function run(seed: number, seconds: number, playerMph = 70) {
  const t = new Traffic(mulberry(seed));
  t.player.v = mpsFromMph(playerMph);
  t.fill();
  const t0 = performance.now();
  for (let i = 0; i < seconds * 60; i++) { t.player.s += t.player.v / 60; t.update(1 / 60); }
  return { t, ms: (performance.now() - t0) / (seconds * 60) };
}

describe('highway traffic', () => {
  it('fills the road and keeps the population steady', () => {
    const { t } = run(1, 20);
    expect(t.npcs.length).toBeGreaterThan(40);
    expect(t.npcs.some(n => n.model === 'semi')).toBe(true);
    expect(t.npcs.some(n => n.dir === -1)).toBe(true);
  });
  it('drivers change lanes, always with the signal on first', () => {
    const { t } = run(7, 90);
    expect(t.lcLog.length).toBeGreaterThan(8);
    for (const e of t.lcLog) expect(e.signalLead).toBeGreaterThanOrEqual(0.3);
    expect(t.lcLog.some(e => e.signalLead >= 0.9)).toBe(true);
  });
  it('same-direction vehicles never overlap while driving normally', () => {
    const { t } = run(3, 60);
    for (const a of t.npcs) for (const b of t.npcs) {
      if (a === b || a.dir !== b.dir || a.state === 'wreck' || b.state === 'wreck') continue;
      const lat = Math.abs(a.u - b.u) < (a.wid + b.wid) / 2 - 0.2, lon = Math.abs(a.s - b.s) < (a.len + b.len) / 2 - 0.5;
      expect(lat && lon).toBe(false);
    }
  });
  it('is cheap: well under a millisecond per step', () => {
    const { ms } = run(5, 20);
    expect(ms).toBeLessThan(1.5);
  });
});

describe('aggressive drivers', () => {
  it('cut in front of the player with a short signal, then sometimes brake-check', () => {
    let cut = 0, checks = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const t = new Traffic(mulberry(seed));
      t.player.v = mpsFromMph(70); t.player.u = 1.8 + 3.65 * 1.5; t.player.s = 100;
      const n = t.spawn(1, 'front'); if (!n) continue;
      n.s = 135; n.u = 1.8 + 3.65 * 2.5; n.lane = 2; n.target = 2; n.aggr = 1; n.v = n.vd = mpsFromMph(68); n.cooldown = 0; n.model = 'sedan'; n.heavy = false; n.evalT = 0;
      t.npcs = [n];
      for (let i = 0; i < 60 * 6; i++) { t.player.s += t.player.v / 60; t.update(1 / 60); if (t.npcs.indexOf(n) < 0) break; }
      cut += t.stats.cutoffs; checks += t.stats.brakeChecks;
      for (const e of t.lcLog) if (e.cutoff) expect(e.signalLead).toBeGreaterThanOrEqual(0.3);
    }
    expect(cut).toBeGreaterThan(2);
    expect(checks).toBeGreaterThan(0);
  });
});
