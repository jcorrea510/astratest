import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Tracers, TRACER_LIFE } from './combat';

describe('bullet tracers', () => {
  it('are gone within TRACER_LIFE even for a shot into the sky', () => {
    const t = new Tracers(new THREE.Scene());
    t.add(new THREE.Vector3(0, 2, 0), new THREE.Vector3(0, 400, 900), 0.12, 1);
    t.update(0.016); expect(t.live).toBe(1);
    for (let i = 0; i < 20; i++) t.update(0.016);
    expect(t.live).toBe(0);
    const a = t.mesh.geometry.getAttribute('alpha');
    for (let i = 0; i < a.count; i++) expect(a.getX(i)).toBe(0);
    expect(TRACER_LIFE).toBeLessThanOrEqual(0.2);
  });
});
