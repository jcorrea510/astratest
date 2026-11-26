import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Soup, STRIDE } from './soup';

/** The original string-keyed clustering, kept as the reference the numeric-key version must match exactly. */
function refDecimate(src: Soup, cell: number): number[] {
  const d = src.d, n = src.verts, key = new Array<string>(n), acc = new Map<string, { s: number[]; c: number }>();
  for (let i = 0; i < n; i++) {
    const o = i * STRIDE, k = `${Math.floor(d[o] / cell)},${Math.floor(d[o + 1] / cell)},${Math.floor(d[o + 2] / cell)},${d[o + 12]},${d[o + 13]}`;
    key[i] = k; const a = acc.get(k);
    if (!a) acc.set(k, { s: d.slice(o, o + STRIDE), c: 1 }); else { a.c++; for (let j = 0; j < 6; j++) a.s[j] += d[o + j]; }
  }
  const out: number[] = [];
  for (let t = 0; t < n; t += 3) {
    if (key[t] === key[t + 1] || key[t + 1] === key[t + 2] || key[t] === key[t + 2]) continue;
    for (const k of [key[t], key[t + 1], key[t + 2]]) {
      const a = acc.get(k)!, v = a.s, nl = Math.hypot(v[3], v[4], v[5]) || 1;
      out.push(v[0] / a.c, v[1] / a.c, v[2] / a.c, v[3] / nl, v[4] / nl, v[5] / nl, v[6], v[7], v[8], v[9], v[10], v[11], v[12], v[13]);
    }
  }
  return out;
}

describe('Soup.split', () => {
  it('cuts a sphere at a plane: both halves lie on their own side and nothing is lost', () => {
    const s = new Soup().addGeometry(new THREE.SphereGeometry(1, 24, 16), { kind: 1 });
    const [ins, out] = s.split((x) => x - 0.2);
    expect(ins.tris).toBeGreaterThan(50); expect(out.tris).toBeGreaterThan(50);
    expect(ins.tris + out.tris).toBeGreaterThanOrEqual(s.tris);
    for (let i = 0; i < ins.d.length; i += STRIDE) expect(ins.d[i]).toBeLessThanOrEqual(0.2 + 1e-4);
    for (let i = 0; i < out.d.length; i += STRIDE) expect(out.d[i]).toBeGreaterThanOrEqual(0.2 - 1e-4);
  });
});

describe('Soup.decimate', () => {
  const soup = new Soup().addGeometry(new THREE.SphereGeometry(1.2, 40, 30), { kind: 3, bone: 2 }).addGeometry(new THREE.BoxGeometry(2, 1, 4, 8, 4, 16), { kind: 5, bone: 0 });
  it('matches the reference clustering for several cell sizes', () => {
    for (const cell of [0.05, 0.2, 0.6, 3]) expect(soup.decimate(cell).d.map(x => x + 0)).toEqual(refDecimate(soup, cell).map(x => x + 0)); // +0: -0 and 0 are the same vertex component
  });
  it('decimateTo stays within the budget', () => {
    const r = soup.decimateTo(900);
    expect(r.tris).toBeLessThanOrEqual(900);
    expect(r.tris).toBeGreaterThan(300);
  });
});
