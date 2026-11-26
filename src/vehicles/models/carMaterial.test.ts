import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { carMaterial, farCarMaterial, glassMaterial } from './carMaterial';

type Sh = { uniforms: Record<string, unknown>; vertexShader: string; fragmentShader: string };
const CHUNKS = ['common', 'color_fragment', 'roughnessmap_fragment', 'metalnessmap_fragment', 'normal_fragment_maps', 'clearcoat_normal_fragment_maps',
  'lights_physical_fragment', 'emissivemap_fragment', 'opaque_fragment'];
function compile(m: THREE.Material): Sh {
  const sh: Sh = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>\n#include <project_vertex>', fragmentShader: CHUNKS.map(c => `#include <${c}>`).join('\n') };
  (m.onBeforeCompile as unknown as (s: Sh, r: unknown) => void)(sh, null);
  return sh;
}
const balanced = (s: string) => { let d = 0; for (const c of s) { if (c === '{') d++; if (c === '}') d--; if (d < 0) return false; } return d === 0; };
// decalAtlas() draws on a 2D canvas; a no-op stub is enough for string checks
const ctx = new Proxy({}, { get: () => () => ({}), set: () => true });
(globalThis as unknown as { document: unknown }).document = { createElement: () => ({ getContext: () => ctx, width: 0, height: 0 }) };

describe('car materials', () => {
  it('body shader carries the realism markers and balanced braces', () => {
    const f = compile(carMaterial()).fragmentShader;
    for (const k of ['gFlake', 'gPeel', 'clearcoatNormal', 'h23(', 'letter', 'brush', 'streak']) expect(f).toContain(k);
    expect(balanced(f)).toBe(true);
  });
  it('keeps lamp uniforms and emissive terms', () => {
    const f = compile(carMaterial()).fragmentShader;
    for (const k of ['* uHead;', 'uTail', 'uInd', 'uRev', 'uBar']) expect(f).toContain(k);
  });
  it('far variant replace() targets still exist in the body shader', () => {
    const body = compile(carMaterial()).fragmentShader;
    for (const t of ['col = isK(K_PAINT2) ? uPaint2 : uPaint;', 'vec3(1.0, 0.93, 0.8) * uHead;', 'gEmis = vec3(1.0, 0.04, 0.03) * uTail', '        // grime low on the body']) expect(body).toContain(t);
    const far = compile(farCarMaterial()).fragmentShader;
    expect(far).toContain('vPaint.rgb');
    expect(far).toContain('uHead * vPaint.a;');
    expect(far).toContain('vKind - 60.0');
    expect(balanced(far)).toBe(true);
  });
  it('glass keeps cracks and gains fresnel + rear tint', () => {
    const f = compile(glassMaterial()).fragmentShader;
    for (const k of ['uCrack', 'web', 'rear', 'pow(1.0 - ndv, 4.0)']) expect(f).toContain(k);
  });
});
