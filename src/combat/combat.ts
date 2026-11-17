/** Hitscan shooting, melee, tracers and impact effects shared by the player and AI. */
import * as THREE from 'three';
import { type Physics, groups, G_STATIC, G_VEHICLE, G_CHAR, G_PROP } from '../core/physics';
import type { Character } from '../actors/character';
import type { Vehicle } from '../vehicles/vehicle';
import type { Particles } from '../render/particles';
import type { GameAudio } from '../ui/contracts';
import type { WeaponDef } from './weapons';
import { WATER_LEVEL } from '../world/citymap';

export interface HitInfo { point: THREE.Vector3; target: Character | Vehicle | null; kind: 'character' | 'vehicle' | 'static' | 'none'; headshot: boolean; killed: boolean }
export interface ShotEvent { shooter: Character; weapon: WeaponDef; origin: THREE.Vector3; hits: HitInfo[] }

class Tracers {
  mesh: THREE.LineSegments; private pos: Float32Array; private alpha: Float32Array; private life: Float32Array; private i = 0;
  constructor(scene: THREE.Scene, private max = 64) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 6); this.alpha = new Float32Array(max * 2); this.life = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(1.0, 0.85, 0.55, vA); }', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(g, m); this.mesh.frustumCulled = false; scene.add(this.mesh);
  }
  add(a: THREE.Vector3, b: THREE.Vector3) {
    const o = this.i * 6;
    // only draw the second half of the path so the tracer doesn't start inside the gun
    const s = a.clone().lerp(b, 0.15);
    this.pos.set([s.x, s.y, s.z, b.x, b.y, b.z], o); this.life[this.i] = 0.07;
    this.i = (this.i + 1) % this.max;
  }
  update(dt: number) {
    for (let k = 0; k < this.max; k++) { this.life[k] = Math.max(0, this.life[k] - dt); const a = this.life[k] / 0.07 * 0.8; this.alpha[k * 2] = a * 0.2; this.alpha[k * 2 + 1] = a; }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; (this.mesh.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

export class Combat {
  tracers: Tracers;
  flash: THREE.PointLight;
  private flashT = 0;
  onHit: ((target: Character, damage: number, from: Character, headshot: boolean, killed: boolean, weapon: WeaponDef) => void) | null = null;
  onShot: ((e: ShotEvent) => void) | null = null;
  onVehicleHit: ((v: Vehicle, from: Character) => void) | null = null;
  time = 0;
  constructor(private physics: Physics, private particles: Particles, private audio: GameAudio, scene: THREE.Scene) {
    this.tracers = new Tracers(scene);
    this.flash = new THREE.PointLight(0xffc27a, 0, 9, 2); scene.add(this.flash);
  }
  update(dt: number) {
    this.time += dt;
    this.tracers.update(dt);
    this.flashT = Math.max(0, this.flashT - dt);
    this.flash.intensity = this.flashT > 0 ? 18 : 0;
  }
  /** Fires a ranged weapon. dir must be normalised. spreadScale multiplies the weapon spread (AI accuracy). */
  shoot(shooter: Character, w: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, spread: number, excludeVehicle?: Vehicle | null): HitInfo[] {
    const hits: HitInfo[] = [];
    this.audio.play(w.sound, { pos: origin, pitch: 0.95 + Math.random() * 0.1 });
    if (w.id !== 'shotgun' || Math.random() < 0.5) this.audio.play('shellCasing', { pos: origin, volume: 0.35 });
    this.particles.muzzle(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, w.id === 'shotgun');
    this.flash.position.copy(origin); this.flashT = 0.05;
    const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize(), up = new THREE.Vector3().crossVectors(right, dir).normalize();
    for (let p = 0; p < w.pellets; p++) {
      const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
      const d = dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const hit = this.physics.ray(origin.x, origin.y, origin.z, d.x, d.y, d.z, w.range, groups(0xffff, G_STATIC | G_VEHICLE | G_CHAR | G_PROP), shooter.collider, excludeVehicle?.phys.body ?? null);
      const end = origin.clone().addScaledVector(d, hit ? hit.toi : w.range);
      const info: HitInfo = { point: end, target: null, kind: 'none', headshot: false, killed: false };
      if (hit) {
        const tag = this.physics.tagOf(hit.collider);
        const n = hit.normal;
        if (tag?.kind === 'character') {
          const c = tag.ref as Character;
          const head = end.y > c.headY - 0.22;
          const vsPlayer = c.isPlayer && !shooter.isPlayer;
          const dmg = w.damage * (head && !vsPlayer ? 2 : 1) * (vsPlayer ? 0.42 : 1) * (0.9 + Math.random() * 0.2) * (1 - Math.min(0.5, hit.toi / w.range * 0.5));
          const killed = c.damage(dmg, shooter, this.time);
          info.kind = 'character'; info.target = c; info.headshot = head; info.killed = killed;
          this.particles.impact(end.x, end.y, end.z, -d.x, -d.y, -d.z, 'body');
          this.audio.play('hitBody', { pos: end, volume: 0.7 });
          if (c.alive && !c.human.busy) c.human.playOnce(head ? 'Hit_Head' : 'Hit_Chest', 'upper', 0.06);
          if (w.knockback > 0) { c.vel.x += d.x * w.knockback; c.vel.z += d.z * w.knockback; }
          this.onHit?.(c, dmg, shooter, head, killed, w);
        } else if (tag?.kind === 'vehicle') {
          const v = tag.ref as Vehicle;
          v.damage(w.damage * 0.7, end, d);
          v.flashT = 0.05;
          info.kind = 'vehicle'; info.target = v;
          this.particles.impact(end.x, end.y, end.z, n.x, n.y, n.z, 'metal');
          this.audio.play(Math.random() < 0.3 ? 'ricochet' : 'hitMetal', { pos: end, volume: 0.6 });
          this.onVehicleHit?.(v, shooter);
        } else {
          info.kind = 'static';
          this.particles.impact(end.x, end.y, end.z, n.x, n.y, n.z, 'concrete');
          if (p === 0) this.audio.play(Math.random() < 0.25 ? 'ricochet' : 'hitConcrete', { pos: end, volume: 0.5 });
        }
      } else if (d.y < 0) {
        // shooting into the sea
        const t = (WATER_LEVEL - origin.y) / d.y;
        if (t > 0 && t < w.range) { const wp = origin.clone().addScaledVector(d, t); this.particles.impact(wp.x, wp.y, wp.z, 0, 1, 0, 'water'); }
      }
      if (p < 3) this.tracers.add(origin, end);
      hits.push(info);
    }
    this.onShot?.({ shooter, weapon: w, origin: origin.clone(), hits });
    return hits;
  }
  /** Melee strike in front of the attacker. */
  melee(attacker: Character, w: WeaponDef, targets: Iterable<Character>, vehicles: Iterable<Vehicle>): Character | null {
    const fx = Math.sin(attacker.yaw), fz = Math.cos(attacker.yaw);
    const cx = attacker.pos.x + fx * 0.9, cz = attacker.pos.z + fz * 0.9;
    let best: Character | null = null, bd = w.range;
    for (const c of targets) {
      if (c === attacker || !c.alive || c.inVehicle) continue;
      const d = Math.hypot(c.pos.x - cx, c.pos.z - cz);
      if (d < bd && Math.abs(c.pos.y - attacker.pos.y) < 1.2) { bd = d; best = c; }
    }
    if (best) {
      const killed = best.damage(w.damage * (0.9 + Math.random() * 0.3), attacker, this.time);
      best.vel.x += fx * w.knockback * 1.5; best.vel.z += fz * w.knockback * 1.5;
      if (best.alive) best.human.playOnce('Hit_Head', 'upper', 0.05);
      this.audio.play('punchHit', { pos: best.pos });
      this.particles.impact(best.pos.x, best.headY - 0.3, best.pos.z, -fx, 0, -fz, 'body');
      this.onHit?.(best, w.damage, attacker, false, killed, w);
      return best;
    }
    for (const v of vehicles) {
      if (v.position.distanceTo(new THREE.Vector3(cx, v.position.y, cz)) < 2.4) { v.damage(4, new THREE.Vector3(cx, attacker.pos.y + 1, cz)); this.audio.play('hitMetal', { pos: v.position, volume: 0.4 }); this.onVehicleHit?.(v, attacker); break; }
    }
    this.audio.play('punch', { pos: attacker.pos, volume: 0.6 });
    return null;
  }
}
