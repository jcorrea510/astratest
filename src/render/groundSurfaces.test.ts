import { describe, expect, it } from 'vitest';
import { asphaltSurface, grassSurface, paintAsphalt, paintPavement, pavementSurface, sandSurface } from './materials';

function stats(S: number, col: Float32Array) {
  const n = S * S; const mean = [0, 0, 0];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) mean[k] += col[i * 3 + k] / n;
  const m = (mean[0] + mean[1] + mean[2]) / 3; let vr = 0;
  for (let i = 0; i < n; i++) { const l = (col[i * 3] + col[i * 3 + 1] + col[i * 3 + 2]) / 3; vr += (l - m) ** 2; }
  return { mean, sd: Math.sqrt(vr / n) };
}
function paint(fn: typeof paintAsphalt, S: number) {
  const col = new Float32Array(S * S * 3), h = new Float32Array(S * S), rough = new Float32Array(S * S).fill(0.9);
  fn(S, col, h, rough, null); return { col, h, rough };
}
describe('ground surfaces (Round 13 W2)', () => {
  it('asphalt is warm-neutral dark grey with real grain variance and rough 0.8-0.95', () => {
    const S = 512, { col, rough } = paint(paintAsphalt, S), { mean, sd } = stats(S, col);
    expect(mean[0]).toBeGreaterThanOrEqual(mean[2]); // never blue
    expect(mean[2] / mean[0]).toBeGreaterThan(0.88); // but neutral, not orange
    const lum = (mean[0] + mean[1] + mean[2]) / 3; expect(lum).toBeGreaterThan(0.07); expect(lum).toBeLessThan(0.2);
    expect(sd).toBeGreaterThan(0.012);
    let lo = 1, hi = 0; for (const r of rough) { lo = Math.min(lo, r); hi = Math.max(hi, r); }
    expect(lo).toBeGreaterThanOrEqual(0.79); expect(hi).toBeLessThanOrEqual(0.951);
  });
  it('sidewalk slabs differ in tone and joints are dark', () => {
    const S = 512, { col } = paint(paintPavement, S), { mean, sd } = stats(S, col);
    expect(mean[0]).toBeGreaterThanOrEqual(mean[2]);
    expect(sd).toBeGreaterThan(0.025);
    const sp = S / 4, lum = (x: number, y: number) => col[(y * S + x) * 3 + 1];
    const slab: number[] = []; for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) slab.push(lum(sx * sp + sp / 2 + 5, sy * sp + sp / 2 - 7));
    expect(Math.max(...slab) - Math.min(...slab)).toBeGreaterThan(0.03);
    expect(lum(0, 40)).toBeLessThan(lum(sp / 2, 40) * 0.7); // vertical joint at x=0
  });
  it('surfaces build in node with <=1024 textures', () => {
    for (const [fn, size] of [[asphaltSurface, 1024], [pavementSurface, 1024], [grassSurface, 512], [sandSurface, 512]] as const) {
      const s = fn(); for (const t of [s.map, s.normalMap, s.roughnessMap]) { const im = t.image as { width: number }; expect(im.width).toBe(size); expect(im.width).toBeLessThanOrEqual(1024); }
    }
  }, 60000);
});

it('Round 14: ground shader is sin-free, LOD-gated, and roads get oil patches', async () => {
  const THREE = await import('three');
  const { addMacroVariation } = await import('./materials');
  const grab = (key: string, grain: number) => {
    const m = addMacroVariation(new THREE.MeshStandardMaterial(), 0.2, 0.011, key, grain);
    const sh = { uniforms: {}, vertexShader: '#include <common>\n#include <worldpos_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <roughnessmap_fragment>' };
    m.onBeforeCompile!(sh as never, null as never); return sh.fragmentShader;
  };
  const road = grab('asphalt', 0.07), grass = grab('grass', 0);
  expect(road).not.toContain('sin(');
  expect(road).toContain('if (mvd < 70.0)'); expect(road).toContain('mOil');
  expect(grass).not.toContain('mOil = smoothstep');
});
