import { describe, it, expect } from 'vitest';
import type * as THREE from 'three';
import { streetLightGeo, hydrantGeo, benchGeo, binGeo, phoneGeo, meterGeo, mailboxGeo, newsBoxesGeo, utilityBoxGeo, bollardGeo, castsSunShadow, treeGeos, weather, leafMaterial } from './props';

const tris = (g: THREE.BufferGeometry) => (g.index ? g.index.count : g.attributes.position.count) / 3;

describe('street prop cost budgets (R14 ST)', () => {
  const budgets: [string, THREE.BufferGeometry, number][] = [
    ['streetlight', streetLightGeo(), 700], ['hydrant', hydrantGeo(), 450], ['bench', benchGeo(), 450], ['bin', binGeo(), 300],
    ['phone', phoneGeo(), 150], ['meter', meterGeo(), 200], ['mailbox', mailboxGeo(), 300], ['news', newsBoxesGeo(1), 150],
    ['utilbox', utilityBoxGeo(2), 150], ['bollard', bollardGeo(), 200],
  ];
  for (const [n, g, b] of budgets) it(`${n} stays under ${b} triangles`, () => expect(tris(g)).toBeLessThanOrEqual(b));
  it('only tall/large props and trees cast sun shadows', () => {
    for (const k of ['hydrant', 'bench', 'bin', 'phone', 'meter', 'mailbox', 'bollard', 'news0', 'shrub0']) expect(castsSunShadow(k), k).toBe(false);
    for (const k of ['streetlight', 'pole', 'tree0', 'leaf3', 'palm1', 'frond2', 'busstop']) expect(castsSunShadow(k), k).toBe(true);
  });
  it('grime darkens the base more than the top', () => {
    const g = binGeo(), c = g.attributes.color, p = g.attributes.position; let lo = 0, nl = 0, hi = 0, nh = 0;
    for (let i = 0; i < c.count; i++) { if (p.getY(i) < 0.1) { lo += c.getY(i); nl++; } else if (p.getY(i) > 0.8) { hi += c.getY(i); nh++; } }
    expect(lo / nl).toBeLessThan(hi / nh);
    expect(weather(binGeo(), 1)).toBeTruthy();
  });
  it('tree trunk bark varies in colour and leaf material avoids blending', () => {
    const t = treeGeos(100).trunk.attributes.color; let mn = 9, mx = 0;
    for (let i = 0; i < t.count; i++) { mn = Math.min(mn, t.getX(i)); mx = Math.max(mx, t.getX(i)); }
    expect(mx / mn).toBeGreaterThan(1.25);
    const m = leafMaterial({} as THREE.Texture); expect(m.transparent).toBe(false); expect(m.alphaTest).toBeGreaterThan(0);
  });
});
