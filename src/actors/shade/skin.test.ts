import { describe, it, expect } from 'vitest';
import { SKIN_PARS, SKIN_LIGHT_PARS, SKIN_GLSL } from './skin';

const all = [SKIN_PARS, SKIN_LIGHT_PARS, SKIN_GLSL];
const strip = (s: string) => s.replace(/\/\/.*$/gm, '');

describe('skin shader chunks', () => {
  it('has balanced braces, parens and brackets', () => {
    for (const src of all.map(strip)) {
      for (const [o, c] of [['{', '}'], ['(', ')'], ['[', ']']]) {
        expect(src.split(o).length).toBe(src.split(c).length);
      }
    }
  });
  it('declares no uniforms or attributes (all inputs come from humanMaterial)', () => {
    for (const src of all) expect(src).not.toMatch(/\b(uniform|attribute|varying)\b/);
  });
  it('uses float literals with a dot (no bare integers in arithmetic)', () => {
    for (const src of all.map(strip)) {
      const t = src.replace(/\bri\s*==\s*\d+/g, 'ri == K').replace(/\[\d+\]/g, '[I]');
      const bare = t.match(/(?<![\w.])\d+(?![\w.])/g);
      expect(bare).toBeNull();
    }
  });
  it('defines and redirects the skin direct-light function, guarded for non-skin', () => {
    expect(SKIN_LIGHT_PARS).toContain('void RE_Direct_Person(');
    expect(SKIN_LIGHT_PARS).toContain('#undef RE_Direct');
    expect(SKIN_LIGHT_PARS).toContain('#define RE_Direct RE_Direct_Person');
    expect(SKIN_LIGHT_PARS).toContain('RE_Direct_Physical(');
    expect(SKIN_LIGHT_PARS).toContain('0.028');
    expect(SKIN_LIGHT_PARS).toContain('if ( !gSkin )');
  });
  it('skin main enables the skin lighting and sets micro bump, keeping scalp and beard paint', () => {
    expect(SKIN_GLSL).toContain('gSkin = true');
    expect(SKIN_GLSL).toContain('bumpH =');
    expect(SKIN_GLSL).toContain('hairlineF(');
    expect(SKIN_GLSL).toContain('faceDetail(col, rough, vHn, tx.rgb)');
  });
  it('declares each global/local name once per scope level', () => {
    const decls = [...SKIN_GLSL.matchAll(/^\s{2}(?:float|vec3)\s+(\w+)/gm)].map(m => m[1]);
    expect(new Set(decls).size).toBe(decls.length);
  });
});
