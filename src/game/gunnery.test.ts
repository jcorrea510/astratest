import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { Gunner, mulberry32, rayMiss, GUNNER_REACT } from './gunnery';

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
/** 10 s of an attack-helicopter gunner against a car weaving at `speed` m/s, 60 m away: bursts like ArmyAir (cooldown 2.6-4.6 s, 0.45-0.9 s at 10 Hz). */
function fight(seed: number, dist = 60, speed = 15, seconds = 10) {
  const r = mulberry32(seed), g = new Gunner(r);
  const eye = V(0, 30, 0); let shots = 0, hits = 0, burst = 0, cd = 2, acc = 0, firstShot = -1;
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    const a = t * 0.9, pos = V(Math.sin(a) * 20, 0, dist + Math.cos(a * 0.7) * 8), vel = V(Math.cos(a) * 20 * 0.9, 0, -Math.sin(a * 0.7) * 5.6 * 0.9).setLength(speed);
    const ready = g.track(dt, true, dist, speed);
    cd -= dt;
    if (ready && burst <= 0 && cd <= 0) { burst = 0.45 + r() * 0.45; cd = 2.6 + r() * 2; }
    if (ready && burst > 0) {
      burst -= dt; acc += dt * 10;
      while (acc >= 1) {
        acc -= 1; shots++; if (firstShot < 0) firstShot = t;
        const d = g.aim(eye, pos.clone().setY(0.9), vel);
        if (rayMiss(eye, d, pos.clone().setY(0.9)) < 2.3) hits++;
      }
    }
  }
  return { shots, hits, firstShot };
}
describe('army gunship gunnery (no aimbot)', () => {
  it('reacts for a moment before the first round', () => {
    for (let s = 1; s <= 5; s++) expect(fight(s).firstShot).toBeGreaterThanOrEqual(GUNNER_REACT - 0.02);
  });
  it('hit rate on a moving target at 60 m over 10 s is between 10% and 40%', () => {
    let shots = 0, hits = 0;
    for (let s = 1; s <= 60; s++) { const f = fight(s * 7919); shots += f.shots; hits += f.hits; }
    const rate = hits / shots;
    expect(shots).toBeGreaterThan(500);
    expect(rate).toBeGreaterThan(0.1); expect(rate).toBeLessThan(0.4);
  });
  it('a distant target is hit less often than a near one', () => {
    let near = 0, far = 0, n1 = 0, n2 = 0;
    for (let s = 1; s <= 40; s++) { const a = fight(s * 31, 40), b = fight(s * 31, 120); near += a.hits; n1 += a.shots; far += b.hits; n2 += b.shots; }
    expect(far / n2).toBeLessThan(near / n1);
  });
});
