/** Static sanity checks for the bottoms/shoes GLSL (no GLSL compiler is available in CI-less review). */
import { describe, it, expect } from 'vitest';
import { BOTTOM_PARS, BOTTOM_GLSL, SHOE_GLSL, SOLE_GLSL } from './bottom';

const ALL = { BOTTOM_PARS, BOTTOM_GLSL, SHOE_GLSL, SOLE_GLSL };
const strip = (s: string) => s.replace(/\/\/.*$/gm, '');

// names provided by the enclosing fragment shader (humanMaterial.ts) or GLSL itself
const OUTER = new Set(['uC', 'uBottom', 'uPat', 'uBody', 'vBind', 'vCloth', 'ri', 'bn', 'front', 'grain', 'flatN', 'bumpH', 'vnoise', 'hsh', 'col', 'rough']);
const BUILTIN = new Set(['float', 'vec2', 'vec3', 'vec4', 'int', 'bool', 'if', 'else', 'return', 'step', 'smoothstep', 'mix', 'clamp', 'min', 'max', 'abs', 'sin', 'fract', 'length', 'dot', 'atan', 'fwidth']);

describe('bottom/shoe shader chunks', () => {
  it('has balanced braces, parens and brackets', () => {
    for (const [name, src] of Object.entries(ALL)) {
      const t = strip(src);
      for (const [o, c] of [['{', '}'], ['(', ')'], ['[', ']']] as const) {
        expect(t.split(o).length, `${name} ${o}${c}`).toBe(t.split(c).length);
      }
      expect(t.includes('`') || t.includes('${')).toBe(false);
    }
  });

  it('writes only float literals with a dot (no int/float mixing)', () => {
    for (const [name, src] of Object.entries(ALL)) {
      const t = strip(src).replace(/uC\[\d+\]/g, 'uC[i]').replace(/ri == \d/g, 'ri == i');
      const bad = t.match(/(?<![\w.])\d+(?![\w.])/g);
      expect(bad, `${name} has integer-looking literals`).toBeNull();
      expect(/\d\.(?![\d])/.test(t) && /\d\.[^\d\w]/.test(t) ? t.match(/\d\.[^\d\w]/g) : null, `${name} trailing-dot literal`).toBeNull();
      expect(/\d+\.?\d*f\b/.test(t), `${name} f suffix`).toBe(false);
    }
  });

  it('smoothstep edges with literal bounds ascend', () => {
    for (const [name, src] of Object.entries(ALL)) {
      const re = /smoothstep\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(strip(src)))) expect(parseFloat(m[1]), `${name}: ${m[0]}`).toBeLessThan(parseFloat(m[2]));
    }
  });

  it('every identifier is declared, an outer-shader name, or a builtin', () => {
    const decl = new Set<string>();
    const text = Object.values(ALL).map(strip).join('\n');
    // declarations: "float a = f(x, y), b = ...;" (split on top-level commas), function names and parameters
    for (const stmt of text.split(/[;{}]/)) {
      const m = stmt.trim().match(/^(?:float|vec[234]|int|bool)\s+([\s\S]*)$/);
      if (!m) continue;
      let depth = 0, cur = '';
      const parts: string[] = [];
      for (const ch of m[1]) { if (ch === '(' || ch === '[') depth++; if (ch === ')' || ch === ']') depth--; if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch; }
      parts.push(cur);
      for (const part of parts) { const n = part.trim().match(/^(\w+)/); if (n) decl.add(n[1]); }
    }
    for (const m of text.matchAll(/\b(?:float|vec[234])\s+(\w+)\s*\(/g)) decl.add(m[1]);
    for (const m of text.matchAll(/\b(?:float|vec[234])\s+(\w+)\s*[,)]/g)) decl.add(m[1]); // params
    const unknown = new Set<string>();
    for (const m of text.matchAll(/(?<![\w.])([A-Za-z_]\w*)/g)) {
      const id = m[1];
      if (!decl.has(id) && !OUTER.has(id) && !BUILTIN.has(id)) unknown.add(id);
    }
    expect([...unknown]).toEqual([]);
  });

  it('every bt* helper that is called is defined in BOTTOM_PARS', () => {
    const defined = new Set([...BOTTOM_PARS.matchAll(/float (bt\w+)\(/g)].map(m => m[1]));
    for (const src of [BOTTOM_GLSL, SHOE_GLSL, SOLE_GLSL]) for (const m of src.matchAll(/\b(bt[A-Z]\w*)\(/g)) expect(defined.has(m[1]), m[1]).toBe(true);
    expect(defined.size).toBeGreaterThanOrEqual(4);
  });

  it('never redeclares names the person shader already owns in its enclosing scope', () => {
    for (const bad of ['tx', 'lum', 'topId', 'part', 'vec3 col', 'float rough', 'float flatN', 'float bumpH']) {
      const re = new RegExp(`(?:float|vec3|int)\\s+${bad.replace(/^\w+ /, '')}\\b`);
      if (/^(float|vec3) /.test(bad)) expect(re.test(Object.values(ALL).join('\n')), bad).toBe(false);
      else expect(new RegExp(`(?:float|int|vec\\d)\\s+${bad}\\b`).test(BOTTOM_GLSL + SHOE_GLSL + SOLE_GLSL), bad).toBe(false);
    }
  });

  it('sets colour, roughness and the bump hook for every material', () => {
    for (const src of [BOTTOM_GLSL, SHOE_GLSL, SOLE_GLSL]) { expect(src).toMatch(/\bcol\b/); expect(src).toMatch(/\brough\b/); }
    expect(BOTTOM_GLSL).toMatch(/bumpH \+=/);
    expect(SHOE_GLSL).toMatch(/bumpH \+=/);
    expect(SOLE_GLSL).toMatch(/bumpH \+=/);
  });
});
