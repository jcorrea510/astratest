import { describe, it, expect } from 'vitest';
import { FACE_PARS, EYES_GLSL } from './face';

const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '');
const balanced = (s: string, o: string, c: string) => {
  let d = 0;
  for (const ch of s) { if (ch === o) d++; else if (ch === c) { d--; if (d < 0) return false; } }
  return d === 0;
};
/** names declared with a type keyword (float/vec2/vec3/vec4/int/bool) in a chunk */
const declared = (s: string) => [...strip(s).matchAll(/(?:^|[;{}\s(,])(?:float|vec2|vec3|vec4|int|bool)\s+([A-Za-z_]\w*)\s*(?==|;|,|\))/g)].map(m => m[1]);

describe('face shader chunks (GLSL ES 3.00 sanity, no compiler available)', () => {
  for (const [name, src] of [['FACE_PARS', FACE_PARS], ['EYES_GLSL', EYES_GLSL]] as const) {
    it(`${name}: balanced braces, parens, brackets`, () => {
      const s = strip(src);
      expect(balanced(s, '{', '}')).toBe(true);
      expect(balanced(s, '(', ')')).toBe(true);
      expect(balanced(s, '[', ']')).toBe(true);
      expect(src).not.toContain('${');
      expect(src).not.toContain('`');
    });
    it(`${name}: every number is a float literal (no bare ints) and statements end properly`, () => {
      const s = strip(src);
      expect(s.replace(/\[\d+\]/g, "").match(/(?<![\w.])\d+(?![\w.])/g) ?? []).toEqual([]); // array indices like uC[9] are ints
      expect(s.match(/\d\.\d*\.\d/g)).toBeNull();
      expect(s).not.toMatch(/\b(?:float|vec[234])\s+\w+\s*=\s*[^;]*\bint\b/);
    });
    it(`${name}: no uniform/attribute/varying declarations (they live in humanMaterial.ts)`, () => {
      expect(strip(src)).not.toMatch(/\b(uniform|attribute|varying)\b/);
    });
    it(`${name}: no variable declared twice in the chunk`, () => {
      const names = declared(src);
      expect(new Set(names).size).toBe(names.length);
    });
  }

  it('faceDetail keeps its signature and is defined exactly once', () => {
    const sig = 'void faceDetail(inout vec3 col, inout float rough, vec3 hn, vec3 atlas)';
    expect(FACE_PARS.split(sig).length - 1).toBe(1);
    // skin.ts calls it as faceDetail(col, rough, vHn, tx.rgb)
    expect(FACE_PARS).toMatch(/void faceDetail\(inout vec3 col, inout float rough, vec3 hn, vec3 atlas\) \{/);
  });

  it('helper function names are unique and do not clash with the shared header functions', () => {
    const fns = [...strip(FACE_PARS).matchAll(/^\s*(?:float|void|vec[234])\s+(\w+)\s*\(/gm)].map(m => m[1]);
    expect(new Set(fns).size).toBe(fns.length);
    for (const f of fns) expect(['hsh', 'vnoise', 'hairlineF']).not.toContain(f);
  });

  it('smoothstep edges are ascending (reversed edges are undefined in GLSL)', () => {
    for (const src of [FACE_PARS, EYES_GLSL]) {
      for (const m of strip(src).matchAll(/smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g)) expect(parseFloat(m[1])).toBeLessThan(parseFloat(m[2]));
    }
  });

  it('pow() is never given a possibly negative base and divisions guard zero', () => {
    for (const src of [FACE_PARS, EYES_GLSL]) expect(strip(src)).not.toMatch(/\bpow\(/);
    expect(EYES_GLSL).toContain('max(er, 0.0001)');
  });

  it('eyes write col, rough and flatN, and read only names the person shader provides', () => {
    for (const w of ['col =', 'rough =', 'flatN =']) expect(EYES_GLSL).toContain(w);
    const provided = new Set(['vMapUv', 'vHn', 'uC', 'vnoise', 'col', 'rough', 'flatN', 'bumpH', 'tx', 'ri', 'edir', 'euv', 'er', 'et']);
    const own = new Set(declared(EYES_GLSL));
    const ids = new Set(strip(EYES_GLSL).match(/\b[A-Za-z_]\w*\b/g));
    const glsl = new Set(['vec2', 'vec3', 'vec4', 'float', 'length', 'max', 'min', 'mix', 'clamp', 'smoothstep', 'abs', 'x', 'y', 'z', 'xy', 'rgb']);
    for (const id of ids) if (!own.has(id) && !provided.has(id) && !glsl.has(id)) throw new Error(`unknown identifier in EYES_GLSL: ${id}`);
    // eye colour comes from the look (uC[9])
    expect(EYES_GLSL).toContain('uC[9]');
  });

  it('iris geometry is sane: pupil inside iris, limbal ring at the iris edge, iris smaller than the visible lid slit', () => {
    const pupilEdge = 0.4, irisEdge = 1.02, irisUvRadius = 0.092;
    expect(EYES_GLSL).toContain('et = er / 0.092');
    expect(pupilEdge).toBeLessThan(irisEdge);
    // uv radius 0.2 per radian => iris half-angle 0.46 rad = 26 deg (real iris ~ 25-30 deg)
    const halfAngle = irisUvRadius / 0.2;
    expect(halfAngle).toBeGreaterThan(0.4); expect(halfAngle).toBeLessThan(0.6);
  });
});
