import { describe, it, expect } from 'vitest';
import { randomLook, resolveLook, SKIN_TONES, PLAYER_DEFAULT_LOOK, nailPolish } from './look';
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

const hsv = (hex: string) => {
  const n = parseInt(hex.slice(1), 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  return { s: mx === 0 ? 0 : (mx - mn) / mx, v: mx };
};

describe('crowd palettes and outfit rules', () => {
  const L = Array.from({ length: 2000 }, (_, i) => randomLook(i));
  it('clothes are real-world colours: capped saturation, no pure white/black', () => {
    for (const l of L) {
      for (const c of [l.top, l.bottom, l.shoes, l.accent, l.hat]) {
        const { s, v } = hsv(c);
        expect(s, c).toBeLessThanOrEqual(0.6); expect(v, c).toBeLessThanOrEqual(0.93); expect(v, c).toBeGreaterThanOrEqual(0.07);
      }
    }
  });
  it('most tops are neutral/earth/denim, accent colours are a minority', () => {
    const sat = L.filter(l => hsv(l.top).s > 0.38 && hsv(l.top).v > 0.5).length / L.length;
    expect(sat).toBeLessThan(0.2);
  });
  it('outfits are coherent', () => {
    for (const l of L) {
      if (l.topStyle === 'suit') { expect(l.bottomStyle).toBe('trousers'); expect(l.shoeStyle).toBe('formal'); expect(l.bottom).toBe(l.top); expect(l.hatStyle).toBe('none'); }
      if (l.topStyle === 'dress') { expect(l.bottomStyle).toBe('skirt'); expect(l.sex).toBe('f'); }
      if (l.topStyle === 'hoodie') { expect(['jeans', 'sweats', 'shorts']).toContain(l.bottomStyle); expect(l.shoeStyle).not.toBe('formal'); }
      if (l.bottomStyle === 'shorts' || l.bottomStyle === 'sweats') expect(l.shoeStyle).not.toBe('formal');
      if (l.bottomStyle === 'skirt') expect(['dress', 'tee', 'blouse', 'tank', 'longsleeve']).toContain(l.topStyle);
      expect(l.legs).toBe(l.bottomStyle === 'shorts' ? 'shorts' : 'pants');
      if (l.pattern !== 'plain') expect(['suit', 'tee', 'shirt', 'polo', 'longsleeve', 'blouse', 'dress', 'hoodie']).toContain(l.topStyle);
    }
    expect(L.filter(l => l.pattern !== 'plain').length / L.length).toBeLessThan(0.15);
  });
  it('skin and hair follow a realistic spread', () => {
    const idx = L.map(l => SKIN_TONES.indexOf(l.skin));
    expect(idx.every(i => i >= 0)).toBe(true);
    const mid = idx.filter(i => i >= 2 && i <= 6).length / L.length;
    expect(mid).toBeGreaterThan(0.45);
    const natural = new Set(['#16110f', '#1d1612', '#271b14', '#33241a', '#3f2b1e', '#4f3523', '#5f412a', '#6e4b2f', '#7d6040', '#94724a', '#a98a5c', '#b99a62', '#cdb27a', '#d9c392', '#6e3220', '#84401f', '#9a5026', '#7f7b76', '#9a9690', '#bdbab4']);
    expect(L.every(l => natural.has(l.hair))).toBe(true);
    expect(L.filter(l => ['#b99a62', '#cdb27a', '#d9c392'].includes(l.hair)).length / L.length).toBeLessThan(0.06);
  });
  it('is deterministic per seed', () => {
    for (let i = 0; i < 50; i++) expect(randomLook(i * 37)).toEqual(randomLook(i * 37));
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

describe('people defect fixes (P7)', () => {
  const L = Array.from({ length: 3000 }, (_, i) => randomLook(i));
  it('most suits are solid, pinstripe is rare', () => {
    const suits = L.filter(l => l.topStyle === 'suit');
    expect(suits.length).toBeGreaterThan(100);
    expect(suits.filter(l => l.pattern === 'pinstripe').length / suits.length).toBeLessThan(0.3);
  });
  it('nail polish only on some women, natural otherwise', () => {
    const men = L.filter(l => l.sex === 'm'), women = L.filter(l => l.sex === 'f');
    expect(men.every(l => nailPolish(l) === null)).toBe(true);
    const share = women.filter(l => nailPolish(l) !== null).length / women.length;
    expect(share).toBeGreaterThan(0.1); expect(share).toBeLessThan(0.4);
  });
  it('the top under an open jacket or hoodie is never near-white', () => {
    for (const l of L.filter(x => x.topStyle === 'jacket' || x.topStyle === 'hoodie')) {
      const n = parseInt(l.accent.slice(1), 16);
      expect(Math.max(n >> 16, (n >> 8) & 255, n & 255)).toBeLessThan(0xd0);
    }
  });
});
