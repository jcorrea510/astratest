/**
 * Round 11 perf (GPU): a small, fixed set of real point lights shared by every local light in the game.
 *
 * three.js shades every lit pixel once per point light in the scene, whatever its intensity: the city used to keep 14
 * point lights (8 street lamps, muzzle flash, fire, police bars, store and barber lights) in every shader at all times,
 * even on Low and in daylight. Systems now register "virtual" lights (ordinary THREE.PointLight objects that are not
 * added to the scene) and set their position / colour / intensity as before; each frame the pool copies the most
 * important ones near the camera onto its few real lights (Low 2, Medium 4, High 8). The real light count only changes
 * with the quality preset, so no shader recompiles mid-game.
 */
import * as THREE from 'three';

const _p = new THREE.Vector3();
export interface PoolCandidate { score: number }
/** Importance of a light as seen from the camera: weighted intensity, falling off past its own range. Pure (tests). */
export function lightScore(intensity: number, weight: number, dist: number, range: number): number {
  if (intensity <= 0) return 0;
  const r = range > 0 ? range : 20;
  if (dist > r + 60) return 0;
  return (intensity * weight) / (1 + (dist / r) * (dist / r));
}
/**
 * Which virtual lights get the real ones: the `n` best scores, keeping current holders unless a newcomer beats the
 * weakest holder clearly (hysteresis: lights do not flicker between two lamps at equal distance). Pure (tests).
 * `held[i]` = index of the virtual light real light i shows now (-1 none). Returns the new `held`.
 */
export function assignLights(scores: number[], held: number[], margin = 1.35): number[] {
  const n = held.length;
  const out = held.map(h => (h >= 0 && h < scores.length && scores[h] > 0 ? h : -1));
  const order = scores.map((_, i) => i).filter(i => scores[i] > 0).sort((a, b) => scores[b] - scores[a]).slice(0, n);
  for (const c of order) {
    if (out.includes(c)) continue;
    let slot = out.indexOf(-1);
    if (slot < 0) {
      let ws = Infinity;
      for (let i = 0; i < n; i++) if (scores[out[i]] < ws) { ws = scores[out[i]]; slot = i; }
      if (!(scores[c] > ws * margin)) continue;
    }
    out[slot] = c;
  }
  return out;
}

export class LightPool {
  readonly real: THREE.PointLight[] = [];
  private virt: THREE.PointLight[] = [];
  private held: number[] = [];
  private scores: number[] = [];
  constructor(private scene: THREE.Scene) {}
  /** Registers a virtual light (not added to the scene). `weight` ranks it against others (lamps 1, muzzle flash 3). */
  add(l: THREE.PointLight, weight = 1): THREE.PointLight {
    l.userData.poolWeight = weight; if (!this.virt.includes(l)) this.virt.push(l);
    return l;
  }
  remove(l: THREE.PointLight) { const i = this.virt.indexOf(l); if (i < 0) return; this.virt.splice(i, 1); this.held = this.held.map(h => (h === i ? -1 : h > i ? h - 1 : h)); }
  get count() { return this.real.length; }
  /** Number of real lights (changes shader light count: call on quality change only). */
  setCount(n: number) {
    while (this.real.length < n) { const l = new THREE.PointLight(0xffffff, 0, 20, 1.6); l.castShadow = false; l.name = 'poolLight'; this.scene.add(l); this.real.push(l); this.held.push(-1); }
    while (this.real.length > n) { const l = this.real.pop()!; this.scene.remove(l); l.dispose(); this.held.pop(); }
  }
  update(cam: THREE.Vector3) {
    const v = this.virt, s = this.scores; s.length = v.length;
    for (let i = 0; i < v.length; i++) {
      const l = v[i]; l.getWorldPosition(_p);
      s[i] = lightScore(l.intensity, (l.userData.poolWeight as number) ?? 1, _p.distanceTo(cam), l.distance);
    }
    this.held = assignLights(s, this.held);
    for (let i = 0; i < this.real.length; i++) {
      const r = this.real[i], h = this.held[i];
      if (h < 0) { r.intensity = 0; continue; }
      const l = v[h]; l.getWorldPosition(r.position);
      r.color.copy(l.color); r.intensity = l.intensity; r.distance = l.distance; r.decay = l.decay;
    }
  }
}

/** Adds a local light through the scene's light pool when it has one (else straight to the scene, e.g. tools/tests). */
export function addPooledLight(scene: THREE.Object3D, l: THREE.PointLight, weight = 1): THREE.PointLight {
  const pool = scene.userData.lightPool as LightPool | undefined;
  if (pool) pool.add(l, weight); else scene.add(l);
  return l;
}
