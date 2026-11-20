/** Shadow frame: the shadow camera follows the player without its texel grid sliding (no swimming / flickering edges). */
import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { shadowFrame } from './renderer';

describe('shadowFrame', () => {
  const sun = new THREE.Vector3(0.45, 0.7, -0.55).normalize(), texel = 0.05;
  // light-space coordinates of a world point as three's shadow camera sees them (lookAt from the sun to the target)
  const lightXY = (target: THREE.Vector3, dir: THREE.Vector3, p: THREE.Vector3) => {
    const cam = new THREE.OrthographicCamera(); cam.position.copy(target).addScaledVector(dir, 180); cam.lookAt(target); cam.updateMatrixWorld(true);
    return p.clone().applyMatrix4(cam.matrixWorldInverse);
  };
  it('keeps a fixed world point on the same sub-texel offset while the centre moves (snapped in light space)', () => {
    const dir = new THREE.Vector3(0, 1, 0), out = new THREE.Vector3(), probe = new THREE.Vector3(3.17, 0.4, -8.9);
    const fracs: number[][] = [];
    for (let i = 0; i < 40; i++) {
      shadowFrame(sun, 12 + i * 0.137, -40 + i * 0.291, texel, dir, out);
      const l = lightXY(out, dir, probe);
      fracs.push([((l.x / texel) % 1 + 1) % 1, ((l.y / texel) % 1 + 1) % 1]);
    }
    for (const f of fracs) { expect(Math.abs(f[0] - fracs[0][0]) % 1).toBeLessThan(1e-3); expect(Math.abs(f[1] - fracs[0][1]) % 1).toBeLessThan(1e-3); }
  });
  it('world-x/z snapping (the old way) does slide against the light-space grid', () => {
    const dir = sun.clone(), probe = new THREE.Vector3(3.17, 0.4, -8.9), seen = new Set<string>();
    for (let i = 0; i < 40; i++) {
      const t = new THREE.Vector3(Math.round((12 + i * 0.137) / texel) * texel, 0, Math.round((-40 + i * 0.291) / texel) * texel);
      const l = lightXY(t, dir, probe); seen.add((((l.x / texel) % 1 + 1) % 1).toFixed(2));
    }
    expect(seen.size).toBeGreaterThan(3);
  });
  it('moves the sun direction in small steps, not every frame', () => {
    const dir = sun.clone(), out = new THREE.Vector3();
    const want = sun.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.001);
    shadowFrame(want, 0, 0, texel, dir, out); expect(dir.equals(sun)).toBe(true);
    const far = sun.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.02);
    shadowFrame(far, 0, 0, texel, dir, out); expect(dir.angleTo(far)).toBeLessThan(1e-6);
  });
});
