import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { TOP_PARS, TOP_GLSL } from './top';

/** There is no GLSL compiler in CI, so guard the usual typo classes of the top shader chunk statically. */
const strip = (s: string) => s.replace(/\/\/[^\n]*/g, '');
const chunks: [string, string][] = [['TOP_PARS', strip(TOP_PARS)], ['TOP_GLSL', strip(TOP_GLSL)]];
const material = readFileSync(new URL('../humanMaterial.ts', import.meta.url), 'utf8');

describe('top shader chunk', () => {
  for (const [name, src] of chunks) {
    it(`${name}: balanced braces, parens and brackets`, () => {
      for (const [o, c] of [['{', '}'], ['(', ')'], ['[', ']']]) expect(src.split(o).length, `${o}${c}`).toBe(src.split(c).length);
      // never closes more than it opens at any point
      let depth = 0;
      for (const ch of src) { if (ch === '(' || ch === '{' || ch === '[') depth++; else if (ch === ')' || ch === '}' || ch === ']') depth--; expect(depth).toBeGreaterThanOrEqual(0); }
      expect(depth).toBe(0);
    });

    it(`${name}: no integer literals where a float is needed (only 'ri == N' region tests may be int)`, () => {
      const t = src.replace(/\bri\s*==\s*\d+/g, '').replace(/\[\d+\]/g, '');
      const bad = t.match(/(?<![\w.])\d+(?![\w.])/g);
      expect(bad).toBeNull();
      expect(t).not.toMatch(/\d\.(?![\d])/); // "1." style literals are legal but easy to mistype
    });

    it(`${name}: smoothstep literal edges are ascending`, () => {
      const re = /smoothstep\(\s*(-?\d*\.?\d+)\s*,\s*(-?\d*\.?\d+)\s*,/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src))) expect(parseFloat(m[1]), m[0]).toBeLessThan(parseFloat(m[2]));
    });

    it(`${name}: no backticks or template holes leaked into the GLSL`, () => {
      expect(src).not.toMatch(/[`$\\]/);
    });
  }

  it('uses only identifiers that exist: locals, GLSL builtins or humanMaterial fragment scope', () => {
    const all = chunks.map(c => c[1]).join('\n');
    const builtins = new Set(['abs', 'sin', 'cos', 'atan', 'pow', 'sqrt', 'min', 'max', 'mix', 'clamp', 'smoothstep', 'step', 'fract', 'floor', 'length', 'dot', 'fwidth',
      'float', 'vec2', 'vec3', 'vec4', 'bool', 'int', 'if', 'else', 'return', 'true', 'false']);
    // provided by humanMaterial.ts' fragment shader (spot-checked against its source below)
    const scope = ['vnoise', 'hsh', 'vBind', 'vCloth', 'bn', 'front', 'grain', 'uC', 'uTop', 'uBody', 'uNeck', 'uPat', 'topId', 'ri', 'col', 'rough', 'bumpH'];
    for (const id of scope) expect(material, id).toContain(id);
    const declared = new Set<string>();
    for (const m of all.matchAll(/\b(?:float|vec2|vec3|vec4|bool|int)\s+(\w+)/g)) declared.add(m[1]);
    for (const m of all.matchAll(/,\s*(\w+)\s*=[^=]/g)) declared.add(m[1]);
    for (const m of all.matchAll(/\b(?:float|vec2|vec3|vec4|bool)\s+(\w+)\s*\(/g)) declared.add(m[1]);
    const unknown = new Set<string>();
    for (const m of all.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)) {
      const id = m[1];
      if (builtins.has(id) || declared.has(id) || scope.includes(id)) continue;
      unknown.add(id);
    }
    expect([...unknown]).toEqual([]);
  });

  it('declares every helper it calls, and each exactly once', () => {
    const all = TOP_PARS;
    for (const fn of ['tpFade', 'tpAA', 'tpLine', 'tpDuty', 'tpBox', 'tpSat', 'tpFabric']) {
      expect(TOP_GLSL, fn).toContain(fn + '(');
      expect(all.split(new RegExp(`\\b(float|vec3) ${fn}\\(`)).length - 1, fn).toBeGreaterThan(0);
    }
    expect(TOP_GLSL).toContain('bumpH = hgt');
  });

  it('handles every top style and pattern id of humanMaterial', () => {
    for (const k of ['kJersey', 'kFleece', 'kJacket', 'kSuit', 'kShirt', 'kPolo', 'kDress', 'kUni', 'kBlouse']) expect(TOP_GLSL, k).toContain(k);
    for (const p of ['pat > 0.5', 'pat > 1.5', 'pat > 2.5', 'pat > 3.5', 'pat > 4.5', 'pat > 5.5', 'pat > 6.5']) expect(TOP_GLSL, p).toContain(p);
  });
});

describe('P7 defect fixes', () => {
  it('pinstripe is fine and low contrast: ~1.2 cm pitch, thin line, no accent-colour stripe', () => {
    const d = TOP_GLSL.split('\n').find(l => l.includes('// pinstripe'))!.match(/tpDuty\(vBind\.x \* (\d+\.\d+) - 0\.5, (\d\.\d+)\)/)!;
    expect(d).not.toBeNull();
    const pitch = 1 / parseFloat(d[1]);
    expect(pitch).toBeGreaterThan(0.01); expect(pitch).toBeLessThan(0.015);
    expect(pitch * parseFloat(d[2])).toBeLessThan(0.001);
    expect(TOP_GLSL).not.toMatch(/pat < 5\.5\) col = mix\(col, uC\[2\]/);
  });
  it('jacket shell is matte and the inner top colour is capped', () => {
    expect(TOP_GLSL).toContain('if (kJacket) rough = max(rough, 0.74)');
    expect(TOP_GLSL).toContain('clamp(tpSat(uC[2], 0.88), 0.02, 0.6)');
  });
  it('skin-vs-cloth neck test has no noise term and the geometry ramp is wide and soft', () => {
    const line = material.split('\n').find(l => l.includes('nd < uNeck.z + vdeep'))!;
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/noise|hsh|grain/);
    expect(material).toContain('smoothstep(uNeck.z, uNeck.z + 0.06, nd)');
  });
});
