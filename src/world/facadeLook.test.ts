import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BRICK_COLORS, PLASTER_COLORS, PASTEL_COLORS, CONCRETE_COLORS, STONE_COLORS, SIDING_COLORS } from './buildings';
import { FACADE_FRAG_COLOR, FACADE_FRAG_PARS, FACADE_VERT_MAIN, FACADE_VERT_PARS, FACADE_VERT_WORLD } from './facadeShader';

const hsl = (hex: string) => { const o = { h: 0, s: 0, l: 0 }; new THREE.Color(hex).getHSL(o, THREE.SRGBColorSpace); return o; };

describe('facade palettes: real-city, no candy pastels', () => {
  const groups: Record<string, string[]> = { BRICK_COLORS, PLASTER_COLORS, PASTEL_COLORS, CONCRETE_COLORS, STONE_COLORS, SIDING_COLORS };
  for (const [name, list] of Object.entries(groups)) {
    it(`${name} is desaturated and not near-white`, () => {
      for (const c of list) { const { s, l } = hsl(c); expect(s, c).toBeLessThanOrEqual(0.4); expect(l, c).toBeLessThanOrEqual(0.82); }
    });
  }
  it('no light + saturated (pastel) colour anywhere', () => {
    for (const c of [...BRICK_COLORS, ...PLASTER_COLORS, ...PASTEL_COLORS, ...CONCRETE_COLORS, ...STONE_COLORS, ...SIDING_COLORS]) {
      const { s, l } = hsl(c); expect(s > 0.22 && l > 0.68, c).toBe(false);
    }
  });
});

describe('facade shader source', () => {
  const all = FACADE_FRAG_PARS + FACADE_FRAG_COLOR + FACADE_VERT_PARS + FACADE_VERT_MAIN + FACADE_VERT_WORLD;
  it('has balanced braces and parens', () => {
    for (const [a, b] of [['{', '}'], ['(', ')'], ['[', ']']]) expect(all.split(a).length).toBe(all.split(b).length);
  });
  it('keeps the attribute/uniform contract and the new look markers', () => {
    for (const k of ['uNight', 'vFacade3', 'glassFresnel', 'glassSky', 'burnt', 'roofStreak', 'sillShadow', 'fwidth']) expect(all).toContain(k);
    expect(FACADE_FRAG_COLOR).toContain('fEmis');
  });
});

// Round 13 (CI shot signal-day): the lobby canopy's near-black metal read as a floating black slab by day
import { readFileSync } from 'node:fs';
it('lobby canopies use a mid-grey metal, not near-black', () => {
  const src = readFileSync(new URL('./buildings.ts', import.meta.url), 'utf8');
  expect(src).not.toContain("0.3, 2.8, ang, C('#2e3134')");
});

// Round 14 (fill rate): cost knobs of the facade shader
it('interior tracing is skipped on wall pixels and far away; fbm is two octaves; weathering fades with distance', () => {
  const f = FACADE_FRAG_COLOR + FACADE_FRAG_PARS;
  expect(f).toContain('if (onGlass) inter = roomColor');
  expect(f).toContain('if (g > 0.002 && far < 0.99) inter = roomColor');
  expect(f).toContain('fWx');
  expect(FACADE_FRAG_PARS).not.toContain('fN(p * 4.13 + 7.7)');
  expect((f.match(/roomColor\(vec3/g) ?? []).length).toBe(4); // definition + one guarded call per glazing kind
  expect(f).toContain('paneV'); expect(f).toContain('dirtW'); expect(f).toContain('rimW');
});
