/** Hitscan shooting, melee, tracers and impact effects shared by the player and AI. */
import * as THREE from 'three';
import { RAPIER, type Physics, type ColliderTag, groups, G_STATIC, G_VEHICLE, G_CHAR, G_PROP } from '../core/physics';
import type { Character } from '../actors/character';
import type { Vehicle } from '../vehicles/vehicle';
import type { ImpactKind, Particles } from '../render/particles';
import type { GameAudio, SfxName } from '../ui/contracts';
import type { AudioExtras, ExtraSfx } from '../audio/sfx';
import { falloffAt, type WeaponDef } from './weapons';
import { WATER_LEVEL } from '../world/citymap';

export interface HitInfo { point: THREE.Vector3; target: Character | Vehicle | null; kind: 'character' | 'vehicle' | 'static' | 'none'; headshot: boolean; killed: boolean; damage?: number; surface?: ImpactKind }
export interface ShotEvent { shooter: Character; weapon: WeaponDef; origin: THREE.Vector3; hits: HitInfo[] }

const TRACER_SPEED = 520; // m/s (visual)
const TRACER_LEN = 7;
/** Bullet tracers: short bright streaks that fly down the shot path (a few frames), additive, head bright, tail faded. */
class Tracers {
  mesh: THREE.LineSegments; private pos: Float32Array; private alpha: Float32Array;
  private seg: { ax: number; ay: number; az: number; dx: number; dy: number; dz: number; len: number; t: number; start: number; bright: number }[] = [];
  private i = 0;
  constructor(scene: THREE.Scene, private max = 64) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 6); this.alpha = new Float32Array(max * 2);
    for (let k = 0; k < max; k++) this.seg.push({ ax: 0, ay: 0, az: 0, dx: 0, dy: 0, dz: 1, len: 0, t: 1e9, start: 0, bright: 0 });
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('alpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(1.0, 0.86, 0.6, vA); }', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    this.mesh = new THREE.LineSegments(g, m); this.mesh.frustumCulled = false; scene.add(this.mesh);
  }
  /** start: metres from `a` where the streak may begin (keeps it out of the gun). */
  add(a: THREE.Vector3, b: THREE.Vector3, start = 0.8, bright = 1) {
    const s = this.seg[this.i]; this.i = (this.i + 1) % this.max;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) || 1;
    s.ax = a.x; s.ay = a.y; s.az = a.z; s.dx = dx / len; s.dy = dy / len; s.dz = dz / len; s.len = len; s.t = 0; s.start = Math.min(start, len * 0.5); s.bright = bright;
  }
  update(dt: number) {
    for (let k = 0; k < this.max; k++) {
      const s = this.seg[k]; s.t += dt;
      const head = Math.min(s.len, s.start + TRACER_SPEED * s.t), tail = Math.max(s.start, head - TRACER_LEN);
      const alive = s.t < 1e8 && tail < s.len - 0.01 && head > tail;
      const o = k * 6;
      this.pos[o] = s.ax + s.dx * tail; this.pos[o + 1] = s.ay + s.dy * tail; this.pos[o + 2] = s.az + s.dz * tail;
      this.pos[o + 3] = s.ax + s.dx * head; this.pos[o + 4] = s.ay + s.dy * head; this.pos[o + 5] = s.az + s.dz * head;
      this.alpha[k * 2] = 0; this.alpha[k * 2 + 1] = alive ? 0.95 * s.bright : 0;
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; (this.mesh.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

const FLASH_T = 0.06;
const EJECT_BACK: Record<string, number> = { pistol: 0.1, smg: 0.2, shotgun: 0.32, rifle: 0.36 };
type Snd = { extra?: ExtraSfx; base: SfxName; vol: number; pitch?: number };
const IMPACT_SND: Record<ImpactKind, Snd> = {
  concrete: { base: 'hitConcrete', vol: 0.55 }, metal: { base: 'hitMetal', vol: 0.6 }, body: { base: 'hitBody', vol: 0.75 },
  wood: { extra: 'hitWood', base: 'hitConcrete', vol: 0.55, pitch: 0.7 }, dirt: { extra: 'hitDirt', base: 'hitConcrete', vol: 0.45, pitch: 0.6 },
  water: { extra: 'hitWater', base: 'splash', vol: 0.4 }, glass: { extra: 'hitGlass', base: 'glass', vol: 0.45 },
};

export class Combat {
  tracers: Tracers;
  flash: THREE.PointLight;
  private flashT = 0; private flashPeak = 0;
  onHit: ((target: Character, damage: number, from: Character, headshot: boolean, killed: boolean, weapon: WeaponDef) => void) | null = null;
  onShot: ((e: ShotEvent) => void) | null = null;
  onVehicleHit: ((v: Vehicle, from: Character) => void) | null = null;
  time = 0;
  /** The local player (set by PlayerCombat): enemy rounds that pass close by whizz past them. */
  player: Character | null = null;
  /** Optional ground material lookup (e.g. surfaceAt from the city map): 'park' / 'beach' give dirt, 'water' splashes. */
  groundSurface: ((x: number, z: number) => string) | null = null;
  private pending: { at: number; fn: () => void }[] = [];
  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3();
  constructor(private physics: Physics, private particles: Particles, private audio: GameAudio, scene: THREE.Scene) {
    this.tracers = new Tracers(scene);
    this.flash = new THREE.PointLight(0xffb36b, 0, 12, 2); scene.add(this.flash);
  }
  private get ax(): Partial<AudioExtras> { return this.audio as GameAudio & Partial<AudioExtras>; }
  /** Plays a weapon-foley extra when the engine supports it, else the closest contract sound. */
  private sfx(s: Snd, pos: THREE.Vector3, vol = 1, pitch = 1) {
    if (s.extra && this.ax.playExtra) this.ax.playExtra(s.extra, { pos, volume: s.vol * vol, pitch });
    else this.audio.play(s.base, { pos, volume: s.vol * vol, pitch: (s.pitch ?? 1) * pitch });
  }
  update(dt: number) {
    this.time += dt;
    this.tracers.update(dt);
    this.flashT = Math.max(0, this.flashT - dt);
    const k = this.flashT / FLASH_T;
    this.flash.intensity = k > 0 ? this.flashPeak * k * k : 0;
    if (this.pending.length) {
      const due = this.pending.filter(p => p.at <= this.time); this.pending = this.pending.filter(p => p.at > this.time);
      for (const p of due) p.fn();
    }
  }
  /** Fires a ranged weapon. dir must be normalised. spread is the cone radius (radians-ish offset on the unit dir). */
  shoot(shooter: Character, w: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, spread: number, excludeVehicle?: Vehicle | null): HitInfo[] {
    const hits: HitInfo[] = [];
    const isPlayer = shooter === this.player;
    this.audio.play(w.sound, { pos: origin, pitch: 0.97 + Math.random() * 0.06 });
    this.particles.muzzle(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, w.id === 'shotgun', w.flash || 1);
    this.flash.position.copy(origin).addScaledVector(dir, 0.25); this.flashT = FLASH_T; this.flashPeak = (w.light || 30) * (isPlayer ? 1 : 0.8);
    this.ejectCase(shooter, w, origin, dir);
    const right = new THREE.Vector3(dir.z, 0, -dir.x).normalize(), up = new THREE.Vector3().crossVectors(right, dir).normalize();
    const rot = Math.random() * Math.PI * 2;
    let whizzed = false, impactSounds = 0;
    for (let p = 0; p < w.pellets; p++) {
      let a: number, r: number;
      if (w.pellets > 1) {
        // shotgun: one pellet near the centre, the rest in a jittered ring (a readable, fair pattern)
        if (p === 0) { a = Math.random() * Math.PI * 2; r = spread * 0.15 * Math.random(); }
        else { a = rot + (p - 1) / (w.pellets - 1) * Math.PI * 2 + (Math.random() - 0.5) * 0.5; r = spread * (0.5 + 0.5 * Math.random()); }
      } else { a = Math.random() * Math.PI * 2; r = spread * Math.pow(Math.random(), 0.75); }
      const d = dir.clone().addScaledVector(right, Math.cos(a) * r).addScaledVector(up, Math.sin(a) * r).normalize();
      const hit = this.physics.ray(origin.x, origin.y, origin.z, d.x, d.y, d.z, w.range, groups(0xffff, G_STATIC | G_VEHICLE | G_CHAR | G_PROP), shooter.collider, excludeVehicle?.phys.body ?? null);
      const end = origin.clone().addScaledVector(d, hit ? hit.toi : w.range);
      const info: HitInfo = { point: end, target: null, kind: 'none', headshot: false, killed: false };
      const strength = w.pellets > 1 ? 0.55 : 1;
      const loud = impactSounds < (w.pellets > 1 ? 2 : 1);
      if (hit) {
        const tag = this.physics.tagOf(hit.collider);
        const n = hit.normal;
        if (tag?.kind === 'character') {
          const c = tag.ref as Character;
          const head = end.y > c.headY - 0.22;
          const vsPlayer = c.isPlayer && !shooter.isPlayer;
          const dmg = w.damage * (head && !vsPlayer ? w.headMul : 1) * (vsPlayer ? 0.42 : 1) * (0.92 + Math.random() * 0.16) * falloffAt(w, hit.toi);
          const killed = c.damage(dmg, shooter, this.time);
          info.kind = 'character'; info.target = c; info.headshot = head; info.killed = killed; info.damage = dmg; info.surface = 'body';
          this.particles.impact(end.x, end.y, end.z, -d.x, -d.y, -d.z, 'body', strength);
          if (loud) { this.sfx(IMPACT_SND.body, end, head ? 1.1 : 1, head ? 1.15 : 1); impactSounds++; }
          if (c.alive && !c.human.busy) c.human.playOnce(head ? 'Hit_Head' : 'Hit_Chest', 'upper', 0.06);
          if (w.knockback > 0) { const kb = w.knockback / Math.max(1, w.pellets * 0.6); c.vel.x += d.x * kb; c.vel.z += d.z * kb; }
          this.onHit?.(c, dmg, shooter, head, killed, w);
        } else if (tag?.kind === 'vehicle') {
          const v = tag.ref as Vehicle;
          v.damage(w.damage * 0.7 * falloffAt(w, hit.toi), end, d, shooter);
          v.flashT = 0.05;
          const glass = end.y - v.position.y > 0.55 && n.y < 0.6;
          info.kind = 'vehicle'; info.target = v; info.surface = glass ? 'glass' : 'metal';
          this.particles.impact(end.x, end.y, end.z, n.x, n.y, n.z, info.surface, strength);
          if (loud) { if (!glass && Math.random() < 0.25) this.audio.play('ricochet', { pos: end, volume: 0.5 }); else this.sfx(IMPACT_SND[info.surface], end); impactSounds++; }
          this.onVehicleHit?.(v, shooter);
        } else {
          info.kind = 'static';
          if (origin.y > WATER_LEVEL && end.y < WATER_LEVEL + 0.02 && d.y < 0) {
            // went into the water first
            const t = (WATER_LEVEL - origin.y) / d.y; const wp = origin.clone().addScaledVector(d, t);
            info.surface = 'water'; this.particles.impact(wp.x, wp.y, wp.z, 0, 1, 0, 'water', strength);
            if (loud) { this.sfx(IMPACT_SND.water, wp); impactSounds++; }
          } else {
            const s = info.surface = this.surfaceOf(hit.collider, tag, end, n);
            this.particles.impact(end.x, end.y, end.z, n.x, n.y, n.z, s, strength);
            if (loud) {
              const ric = s === 'metal' ? 0.4 : s === 'concrete' ? 0.18 : 0;
              if (Math.random() < ric) this.audio.play('ricochet', { pos: end, volume: 0.45 }); else this.sfx(IMPACT_SND[s], end);
              impactSounds++;
            }
          }
        }
      } else if (d.y < 0) {
        // shooting into the sea
        const t = (WATER_LEVEL - origin.y) / d.y;
        if (t > 0 && t < w.range) { const wp = origin.clone().addScaledVector(d, t); info.surface = 'water'; this.particles.impact(wp.x, wp.y, wp.z, 0, 1, 0, 'water', strength); if (loud) { this.sfx(IMPACT_SND.water, wp); impactSounds++; } }
      }
      if (p < (w.pellets > 1 ? 4 : 1)) this.tracers.add(origin, end, isPlayer ? 1.2 : 0.4, w.pellets > 1 ? 0.7 : 1);
      if (!whizzed && !isPlayer) whizzed = this.nearMiss(w, origin, d, hit ? hit.toi : w.range, info.target);
      hits.push(info);
    }
    this.onShot?.({ shooter, weapon: w, origin: origin.clone(), hits });
    return hits;
  }
  /** Material of a static surface: thin poles are metal, trunks wood, open ground from the map, everything else masonry. */
  private surfaceOf(col: RAPIER.Collider, tag: ColliderTag | undefined, p: THREE.Vector3, n: { x: number; y: number; z: number }): ImpactKind {
    if (tag?.kind === 'water') return 'water';
    try {
      const sh = col.shape;
      if (sh.type === RAPIER.ShapeType.Cylinder) return (sh as RAPIER.Cylinder).radius < 0.2 ? 'metal' : 'wood';
    } catch { /* shape access is best-effort */ }
    if (n.y > 0.7 && this.groundSurface) {
      const s = this.groundSurface(p.x, p.z);
      if (s === 'park' || s === 'beach' || s === 'offmap') return 'dirt';
      if (s === 'water') return 'water';
    }
    return 'concrete';
  }
  /** A round passing within ~2.5 m of the player's head (without hitting them) whizzes by; rifle rounds also snap. */
  private nearMiss(w: WeaponDef, o: THREE.Vector3, d: THREE.Vector3, len: number, target: Character | Vehicle | null): boolean {
    const pl = this.player; if (!pl || !pl.alive || target === pl) return false;
    const head = this.v1.set(pl.pos.x, pl.headY - 0.1, pl.pos.z);
    const s = this.v2.copy(head).sub(o).dot(d);
    if (s < 2 || s > len + 1.5) return false;
    const closest = this.v2.copy(o).addScaledVector(d, s); const miss = closest.distanceTo(head);
    if (miss > 2.5) return false;
    const near = 1 - miss / 2.5;
    const at = closest.clone();
    if (this.ax.playExtra) {
      this.ax.playExtra('whizz', { pos: at, volume: 0.45 + 0.55 * near, pitch: 0.9 + Math.random() * 0.2 });
      if (w.id === 'rifle') this.ax.playExtra('crackBy', { pos: at, volume: 0.5 + 0.5 * near });
    } else this.audio.play('whoosh', { pos: at, volume: 0.3 + 0.4 * near, pitch: 2.2 });
    return true;
  }
  /** Shell casing out of the ejection port (shotguns eject the hull when pumped). */
  private ejectCase(shooter: Character, w: WeaponDef, origin0: THREE.Vector3, dir0: THREE.Vector3) {
    if (w.melee) return;
    const origin = origin0.clone(), dir = dir0.clone();
    const fn = () => {
      if (!shooter.alive || shooter.inVehicle) return;
      const back = EJECT_BACK[w.id] ?? 0.15;
      const o = w.eject > 0 ? this.v1.set(shooter.pos.x + Math.sin(shooter.yaw) * 0.35, shooter.pos.y + 1.3, shooter.pos.z + Math.cos(shooter.yaw) * 0.35) : this.v1.copy(origin).addScaledVector(dir, -back);
      const rx = dir.z, rz = -dir.x, rl = Math.hypot(rx, rz) || 1; // right of the barrel
      const sp = 1.8 + Math.random() * 1.2;
      this.particles.casing(o.x, o.y + 0.03, o.z, -rx / rl * sp + shooter.vel.x - dir.x * 0.4, 1.6 + Math.random() * 1.2, -rz / rl * sp + shooter.vel.z - dir.z * 0.4, shooter.pos.y, w.id === 'shotgun');
      const feet = this.v2.set(o.x, shooter.pos.y, o.z);
      if (w.id === 'shotgun' && this.ax.playExtra) this.ax.playExtra('casingHull', { pos: feet, volume: 0.45 });
      else if (w.id !== 'shotgun') this.audio.play('shellCasing', { pos: feet, volume: 0.4 });
    };
    if (w.eject > 0) this.pending.push({ at: this.time + w.eject, fn }); else fn();
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
      this.particles.impact(best.pos.x, best.headY - 0.3, best.pos.z, -fx, 0, -fz, 'body', 0.6);
      this.onHit?.(best, w.damage, attacker, false, killed, w);
      return best;
    }
    for (const v of vehicles) {
      if (v.position.distanceTo(new THREE.Vector3(cx, v.position.y, cz)) < 2.4) { v.damage(4, new THREE.Vector3(cx, attacker.pos.y + 1, cz), undefined, attacker); this.audio.play('hitMetal', { pos: v.position, volume: 0.4 }); this.onVehicleHit?.(v, attacker); break; }
    }
    this.audio.play('punch', { pos: attacker.pos, volume: 0.6 });
    return null;
  }
}
