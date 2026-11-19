import { describe, it, expect } from 'vitest';
import { randomLook, resolveLook, SKIN_TONES, PLAYER_DEFAULT_LOOK } from './look';
import { ACTIONS, UAL_CLIPS, samplePose, sym } from './actions';

describe('people looks', () => {
  it('random pedestrians cover both sexes, realistic heights, all skin tones and many styles', () => {
    const L = Array.from({ length: 400 }, (_, i) => randomLook(i));
    expect(new Set(L.map(l => l.sex)).size).toBe(2);
    const h = L.map(l => l.height * 1.78);
    expect(Math.min(...h)).toBeGreaterThanOrEqual(1.52); expect(Math.max(...h)).toBeLessThanOrEqual(1.95);
    const avgM = L.filter(l => l.sex === 'm').reduce((a, l) => a + l.height * 1.78, 0) / L.filter(l => l.sex === 'm').length;
    const avgF = L.filter(l => l.sex === 'f').reduce((a, l) => a + l.height * 1.78, 0) / L.filter(l => l.sex === 'f').length;
    expect(avgM - avgF).toBeGreaterThan(0.08);
    expect(new Set(L.map(l => l.skin)).size).toBe(SKIN_TONES.length);
    expect(new Set(L.map(l => l.hairStyle)).size).toBeGreaterThanOrEqual(15);
    expect(new Set(L.map(l => l.topStyle)).size).toBeGreaterThanOrEqual(10);
    expect(new Set(L.map(l => l.facial)).size).toBe(5);
    expect(L.filter(l => l.sex === 'f').every(l => l.facial === 'none')).toBe(true);
    expect(randomLook(42)).toEqual(randomLook(42)); // deterministic
  });
  it('classic looks resolve to full outfits (police caps get uniforms)', () => {
    const cop = resolveLook({ skin: '#c68c63', top: '#2c3e5c', bottom: '#1e2738', shoes: '#151515', hair: '#2a2420', hat: '#1e2738', detail: '#d9b44a', sleeves: 'short', legs: 'pants', hairStyle: 'short', hatStyle: 'police', height: 1, build: 1.04 });
    expect(cop.topStyle).toBe('uniform'); expect(cop.sex).toBe('m'); expect(cop.shoeStyle).toBe('formal');
    expect(resolveLook({ ...cop, sex: undefined, hatStyle: 'none', hairStyle: 'ponytail', legs: 'shorts' }).sex).toBe('f');
    expect(PLAYER_DEFAULT_LOOK.topStyle).toBe('jacket');
  });
});

describe('actions', () => {
  it('every action references a real UAL clip and has ordered pose keys', () => {
    for (const [name, a] of Object.entries(ACTIONS)) {
      if (a.clip) expect(UAL_CLIPS as readonly string[], name).toContain(a.clip);
      if (a.poses) for (let i = 1; i < a.poses.length; i++) expect(a.poses[i][0]).toBeGreaterThanOrEqual(a.poses[i - 1][0]);
    }
    for (const m of ['punch_jab', 'punch_cross', 'punch_hook']) expect(ACTIONS[m].events?.some(e => e[1] === 'strike')).toBe(true);
  });
  it('poses interpolate and mirror', () => {
    expect(sym({ armL: [10, 20, 30] }).armR).toEqual([10, -20, -30]);
    const out = samplePose([[0, { head: [0, 0, 0] }], [1, { head: [20, 0, 0] }]], 0.5, new Map());
    expect(out.get('head')![0]).toBeCloseTo(10);
  });
});
