/**
 * Shooting, melee, projectiles and explosions shared by the player and AI.
 *
 * Hitscan: a round's path is traced against the world (static / vehicles / props) with Rapier and against people's
 * bone capsules (combat/hitzones.ts), so the zone decides the damage (head = instant kill). A round that hits car glass
 * breaks the pane and carries on into the cabin, where it can hit the occupants (a killed driver slumps and the car
 * coasts). Launchers and throwables are simulated projectiles that explode (or burst into flames).
 */
import { bulletDrop, flightTime, isShallow, muzzleVelocity, penetration, reflect, roundPower } from './ballistics';
import * as THREE from 'three';
import { RAPIER, type Physics, type ColliderTag, groups, G_STATIC, G_VEHICLE, G_PROP } from '../core/physics';
import type { Character } from '../actors/character';
import type { Vehicle } from '../vehicles/vehicle';
import type { ImpactKind, Particles } from '../render/particles';
import type { GameAudio, SfxName } from '../ui/contracts';
import type { AudioExtras, ExtraSfx } from '../audio/sfx';
import { WEAPONS, type WeaponDef } from './weapons';
import { WATER_LEVEL } from '../world/citymap';
import { bodyCapsules, rayBody, zoneDamage, type Capsule, type Zone } from './hitzones';
import { coneSample } from './aim';

export interface HitInfo { point: THREE.Vector3; target: Character | Vehicle | null; kind: 'character' | 'vehicle' | 'static' | 'none'; headshot: boolean; killed: boolean; damage?: number; surface?: ImpactKind; zone?: Zone; throughGlass?: boolean; ricochet?: boolean }
export interface ShotEvent { shooter: Character; weapon: WeaponDef; origin: THREE.Vector3; hits: HitInfo[] }
/** Result of tracing one ray through the world and people. */
/** A surface the round punched through on its way (vehicle panel, thin wall). */
export interface PenHit { point: THREE.Vector3; normal: THREE.Vector3; surface: 'vehicle' | 'wood'; vehicle: Vehicle | null }
export interface TraceHit {
  t: number; point: THREE.Vector3; normal: THREE.Vector3; kind: 'character' | 'vehicle' | 'static' | 'none';
  character: Character | null; zone: Zone | null; vehicle: Vehicle | null; collider: RAPIER.Collider | null; tag: ColliderTag | undefined;
  /** vehicles whose glass the ray went through (broken when not a dry run) */ glass: Vehicle[];
  /** panels / thin walls the round penetrated, and the damage fraction it keeps after them */ pen: PenHit[]; damageMul: number;
}
/**
 * Optional vehicle glass API (implemented by the vehicles module): which pane is at a world point, and break it.
 * Without it, combat falls back to a height/normal heuristic and remembers broken panes itself.
 */
export interface GlassApi { glassAt?(worldPoint: THREE.Vector3, tol?: number, includeBroken?: boolean): string | number | null; breakGlass?(paneId: string | number): void; hitGlass?(paneId: number, at?: THREE.Vector3, hits?: number): boolean; isGlassBroken?(paneId: string | number): boolean }

const TRACER_SPEED = 900; // m/s (visual)
export const TRACER_LIFE = 0.18; // s: a streak is always gone by then
const TRACER_LEN = 7;
/** Bullet tracers: short bright streaks that fly down the shot path (a few frames), additive, head bright, tail faded. */
export class Tracers {
  mesh: THREE.LineSegments; /** live streak count (tests) */ get live() { return this.seg.filter((s) => s.t < TRACER_LIFE).length; }
  private pos: Float32Array; private alpha: Float32Array;
  private seg: { ax: number; ay: number; az: number; dx: number; dy: number; dz: number; len: number; t: number; start: number; bright: number }[] = [];
  private i = 0;
  constructor(scene: THREE.Scene, private max = 96) {
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
  /** start: metres from `a` where the streak may begin. */
  add(a: THREE.Vector3, b: THREE.Vector3, start = 0.8, bright = 1) {
    const s = this.seg[this.i]; this.i = (this.i + 1) % this.max;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, len = Math.hypot(dx, dy, dz) || 1;
    s.ax = a.x; s.ay = a.y; s.az = a.z; s.dx = dx / len; s.dy = dy / len; s.dz = dz / len; s.len = len; s.t = 0; s.start = Math.min(start, len * 0.5); s.bright = bright;
  }
  update(dt: number) {
    for (let k = 0; k < this.max; k++) {
      const s = this.seg[k]; s.t += dt;
      const head = Math.min(s.len, s.start + TRACER_SPEED * s.t), tail = Math.max(s.start, head - TRACER_LEN);
      const alive = s.t < TRACER_LIFE && tail < s.len - 0.01 && head > tail;
      const o = k * 6;
      this.pos[o] = s.ax + s.dx * tail; this.pos[o + 1] = s.ay + s.dy * tail; this.pos[o + 2] = s.az + s.dz * tail;
      this.pos[o + 3] = s.ax + s.dx * head; this.pos[o + 4] = s.ay + s.dy * head; this.pos[o + 5] = s.az + s.dz * head;
      this.alpha[k * 2] = 0; this.alpha[k * 2 + 1] = alive ? 0.95 * s.bright * Math.min(1, (TRACER_LIFE - s.t) / 0.08) : 0;
    }
    (this.mesh.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true; (this.mesh.geometry.attributes.alpha as THREE.BufferAttribute).needsUpdate = true;
  }
}

const FLASH_T = 0.06;
type Snd = { extra?: ExtraSfx; base: SfxName; vol: number; pitch?: number };
const IMPACT_SND: Record<ImpactKind, Snd> = {
  concrete: { base: 'hitConcrete', vol: 0.55 }, metal: { base: 'hitMetal', vol: 0.6 }, body: { base: 'hitBody', vol: 0.8 },
  wood: { extra: 'hitWood', base: 'hitConcrete', vol: 0.55, pitch: 0.7 }, dirt: { extra: 'hitDirt', base: 'hitConcrete', vol: 0.45, pitch: 0.6 },
  water: { extra: 'hitWater', base: 'splash', vol: 0.4 }, glass: { extra: 'hitGlass', base: 'glass', vol: 0.45 },
};
const WORLD = groups(0xffff, G_STATIC | G_VEHICLE | G_PROP);

interface Projectile { kind: WeaponDef['projectile']; pos: THREE.Vector3; vel: THREE.Vector3; owner: Character; w: WeaponDef; fuse: number; age: number; mesh: THREE.Object3D; bounces: number; trail: number }
interface FireZone { pos: THREE.Vector3; r: number; t: number; by: Character; tick: number }

/** Lightweight shared projectile meshes. */
let PROJ_GEO: Record<string, THREE.BufferGeometry> | null = null;
function projMesh(kind: string): THREE.Mesh {
  PROJ_GEO ??= {
    frag: new THREE.SphereGeometry(0.035, 10, 8).scale(1, 1.25, 1), grenade40: new THREE.CylinderGeometry(0.02, 0.02, 0.08, 10).rotateX(Math.PI / 2),
    rocket: new THREE.ConeGeometry(0.045, 0.32, 10).rotateX(Math.PI / 2), molotov: new THREE.CylinderGeometry(0.035, 0.037, 0.2, 10),
  };
  const col = kind === 'molotov' ? '#5f8a6a' : kind === 'rocket' ? '#4d5638' : '#3a4030';
  const m = new THREE.Mesh(PROJ_GEO[kind] ?? PROJ_GEO.frag, new THREE.MeshStandardMaterial({ color: col, roughness: 0.5, metalness: 0.3 })); m.castShadow = true; return m;
}

export class Combat {
  tracers: Tracers;
  flash: THREE.PointLight;
  private flashT = 0; private flashPeak = 0;
  onHit: ((target: Character, damage: number, from: Character, headshot: boolean, killed: boolean, weapon: WeaponDef, zone?: Zone) => void) | null = null;
  onShot: ((e: ShotEvent) => void) | null = null;
  onVehicleHit: ((v: Vehicle, from: Character) => void) | null = null;
  /** Explosion hook: the game damages people around `at` (and reports heat). Without it, combat damages them itself. */
  onExplosion: ((at: THREE.Vector3, by: Character | null, radius: number) => void) | null = null;
  /** Called when a vehicle occupant is killed through the glass (default: slump + coast). */
  onOccupantKilled: ((c: Character, v: Vehicle) => void) | null = null;
  time = 0;
  /** The local player (set by PlayerCombat): enemy rounds that pass close by whizz past them. */
  player: Character | null = null;
  /** Everyone who can be shot (set by PlayerCombat each frame; the player is added automatically). */
  people: () => Iterable<Character> = () => [];
  /** Vehicles (for blast damage); set by PlayerCombat each frame. */
  vehicles: () => Iterable<Vehicle> = () => [];
  /** Helicopters (damaged by explosion splash; direct bullet hits already go through the vehicle path). */
  helis: () => Iterable<{ position: THREE.Vector3; damage(amount: number, point?: THREE.Vector3, dir?: THREE.Vector3, by?: unknown): boolean }> = () => [];
  /** Listener position (camera) for near / far gunshot voices. */
  listener = new THREE.Vector3();
  /** Optional ground material lookup (e.g. surfaceAt from the city map): 'park' / 'beach' give dirt, 'water' splashes. */
  groundSurface: ((x: number, z: number) => string) | null = null;
  private pending: { at: number; fn: () => void }[] = [];
  private projectiles: Projectile[] = [];
  private fires: FireZone[] = [];
  /** world shop-glass registry (set by Game; see world/glass.ts) */
  worldGlass: GlassApi | null = null;
  /** fallback broken-pane memory when vehicles don't implement GlassApi */
  private brokenPanes = new WeakMap<object, Set<string | number>>();
  private caps: Capsule[] = [];
  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3(); private v3 = new THREE.Vector3();
  constructor(private physics: Physics, private particles: Particles, private audio: GameAudio, private scene: THREE.Scene) {
    this.tracers = new Tracers(scene);
    this.flash = new THREE.PointLight(0xffb36b, 0, 12, 2); scene.add(this.flash);
  }
  private get ax(): Partial<AudioExtras> { return this.audio as GameAudio & Partial<AudioExtras>; }
  private extra(name: ExtraSfx, pos: THREE.Vector3, volume = 1, pitch = 1, fallback?: SfxName) {
    if (this.ax.playExtra) this.ax.playExtra(name, { pos, volume, pitch }); else if (fallback) this.audio.play(fallback, { pos, volume, pitch });
  }
  /** Plays a weapon-foley extra when the engine supports it, else the closest contract sound. */
  private sfx(s: Snd, pos: THREE.Vector3, vol = 1, pitch = 1) {
    if (s.extra && this.ax.playExtra) this.ax.playExtra(s.extra, { pos, volume: s.vol * vol, pitch });
    else this.audio.play(s.base, { pos, volume: s.vol * vol, pitch: (s.pitch ?? 1) * pitch });
  }
  /** The gunshot: a close voice and, with distance, a far voice (dull report + rolling city echo). */
  playGunshot(w: WeaponDef, at: THREE.Vector3, pitch = 1) {
    if (w.sound === 'punch') return;
    if (!this.ax.playExtra) { this.audio.play(w.baseSound as SfxName, { pos: at, pitch }); return; }
    const d = this.listener.distanceTo(at);
    const far = Math.min(1, Math.max(0, (d - 35) / 110));
    if (far < 0.95) this.ax.playExtra(`gun_${w.sound}`, { pos: at, volume: (w.suppressed ? 0.35 : 1) * (1 - 0.75 * far), pitch });
    if (far > 0.05) this.ax.playExtra(`gunFar_${w.sound}`, { pos: at, volume: 0.35 + 0.9 * far, pitch });
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
    this.updateProjectiles(dt);
    this.updateFires(dt);
  }

  // ---------------------------------------------------------------- tracing
  private *targets(): Iterable<Character> { if (this.player) yield this.player; for (const c of this.people()) if (c !== this.player) yield c; }
  /**
   * Whether a world hit on a vehicle is a window (intact pane id, or 'open' for an already broken window), else null.
   * Uses the vehicle's glassAt() when available; the height/normal heuristic finds broken openings and covers vehicles
   * without the glass API.
   */
  glassPane(v: Vehicle, p: THREE.Vector3, n: { x: number; y: number; z: number }, d?: THREE.Vector3): string | number | null {
    const api = v as unknown as GlassApi;
    if (typeof api.glassAt === 'function') {
      // the physics hull is coarser than the body: look for the pane a little further along the ray
      const q = this.v2;
      for (let s = 0; s <= 0.9; s += 0.05) {
        q.copy(p); if (d) q.addScaledVector(d, s); else if (s > 0) break;
        const id = api.glassAt(q); if (id !== null && id !== undefined) return id;
      }
      const zone = this.windowZone(v, p, d && Math.abs(d.y) < 0.5 ? { x: 0, y: 0, z: 0 } : n);
      return zone !== null && this.anyBroken(v) ? 'open' : null;
    }
    return this.windowZone(v, p, n);
  }
  /** Heuristic window zone: upper body, mostly vertical surface, above the beltline. */
  private windowZone(v: Vehicle, p: THREE.Vector3, n: { x: number; y: number; z: number }): string | null {
    const local = this.v3.copy(p).sub(v.position);
    const h = local.y; const s = v.size;
    if (h < 0.78 * s || Math.abs(n.y) > 0.75) return null;
    const yaw = (v as unknown as { yaw?: number }).yaw ?? 0;
    const fx = Math.sin(yaw), fz = Math.cos(yaw), f = local.x * fx + local.z * fz, r = local.x * fz - local.z * fx;
    return Math.abs(f) > 1.0 * s ? (f > 0 ? 'front' : 'rear') : r > 0 ? 'right' : 'left';
  }
  private anyBroken(v: Vehicle): boolean {
    const mask = (v as unknown as { brokenMask?: number }).brokenMask;
    if (typeof mask === 'number') return mask !== 0;
    return (this.brokenPanes.get(v)?.size ?? 0) > 0;
  }
  private paneBroken(v: Vehicle, pane: string | number): boolean {
    if (pane === 'open') return true;
    const api = v as unknown as GlassApi; if (typeof api.isGlassBroken === 'function' && typeof pane === 'number') return api.isGlassBroken(pane);
    return this.brokenPanes.get(v)?.has(pane) ?? false;
  }
  private breakPane(v: Vehicle, pane: string | number, at: THREE.Vector3) {
    if (this.paneBroken(v, pane)) return;
    const api = v as unknown as GlassApi;
    if (typeof api.hitGlass === 'function' && typeof pane === 'number') { api.hitGlass(pane, at); return; } // first hits crack, later ones shatter
    if (typeof api.breakGlass === 'function' && typeof pane === 'number') { api.breakGlass(pane); return; } // the vehicle plays its own shatter (Vehicle.onGlassBreak)
    let set = this.brokenPanes.get(v); if (!set) this.brokenPanes.set(v, set = new Set()); set.add(pane);
    this.extra('glassShatter', at, 0.9, 0.95 + Math.random() * 0.1, 'glass');
    for (let i = 0; i < 3; i++) this.particles.impact(at.x, at.y - i * 0.12, at.z, 0, 0.3, 0, 'glass', 1);
  }
  /**
   * Traces a ray through the world and people. Rounds pass through vehicle glass into the cabin (breaking it unless
   * `dry`), where they can hit occupants. `inflate` widens people's capsules (AI shots at the player).
   */
  private vProj = new THREE.Vector3();
  trace(o: THREE.Vector3, d: THREE.Vector3, range: number, shooter: Character | null, opts: { dry?: boolean; inflate?: number; excludeVehicle?: Vehicle | null; solidGlass?: boolean; power?: number } = {}): TraceHit {
    const res: TraceHit = { t: range, point: new THREE.Vector3(), normal: new THREE.Vector3(0, 1, 0), kind: 'none', character: null, zone: null, vehicle: null, collider: null, tag: undefined, glass: [], pen: [], damageMul: 1 };
    const through = new Set<Vehicle>();
    let start = 0; let excludeRb = opts.excludeVehicle?.phys.body ?? null;
    for (let seg = 0; seg < 6; seg++) {
      const ox = o.x + d.x * start, oy = o.y + d.y * start, oz = o.z + d.z * start;
      const hit = this.physics.ray(ox, oy, oz, d.x, d.y, d.z, range - start, WORLD, shooter?.collider ?? null, excludeRb);
      const worldT = hit ? start + hit.toi : range;
      // people (bone capsules) in front of the world hit
      let best: { t: number; zone: Zone; c: Character } | null = null;
      for (const c of this.targets()) {
        if (c === shooter || !c.alive) continue;
        if (c.inVehicle && !res.glass.includes(c.inVehicle as Vehicle) && !through.has(c.inVehicle as Vehicle) && c.inVehicle !== opts.excludeVehicle) continue;
        const root = c.human.root; root.getWorldPosition(this.v1); this.v1.y += 0.9;
        // broad phase: ray vs bounding sphere
        const qx = this.v1.x - o.x, qy = this.v1.y - o.y, qz = this.v1.z - o.z; const along = qx * d.x + qy * d.y + qz * d.z;
        if (along < start - 1.2 || along > worldT + 1.2) continue;
        const px = qx - d.x * along, py = qy - d.y * along, pz = qz - d.z * along;
        if (px * px + py * py + pz * pz > 1.45 * 1.45) continue;
        const look = c.human.look as { height?: number; build?: number };
        bodyCapsules(c.human.model, c.pos, c.yaw, look.height ?? 1, look.build ?? 1, this.caps);
        const bh = rayBody(o.x, o.y, o.z, d.x, d.y, d.z, this.caps, worldT, c.isPlayer && shooter && !shooter.isPlayer ? opts.inflate ?? 0 : 0);
        if (bh && bh.t >= start && (!best || bh.t < best.t)) best = { t: bh.t, zone: bh.zone, c };
      }
      if (best) {
        res.t = best.t; res.point.copy(o).addScaledVector(d, best.t); res.normal.copy(d).negate(); res.kind = 'character'; res.character = best.c; res.zone = best.zone; return res;
      }
      if (!hit) { res.t = range; res.point.copy(o).addScaledVector(d, range); return res; }
      const tag = this.physics.tagOf(hit.collider);
      res.t = worldT; res.point.set(ox + d.x * hit.toi, oy + d.y * hit.toi, oz + d.z * hit.toi); res.normal.set(hit.normal.x, hit.normal.y, hit.normal.z); res.collider = hit.collider; res.tag = tag;
      if (tag?.kind === 'vehicle') {
        const v = tag.ref as Vehicle; res.kind = 'vehicle'; res.vehicle = v;
        const pane = !v.destroyed ? this.glassPane(v, res.point, res.normal, d) : null;
        if (pane !== null && !res.glass.includes(v) && !opts.solidGlass) {
          // through the window into the cabin
          if (!opts.dry) this.breakPane(v, pane, res.point);
          res.glass.push(v); start = worldT + 0.02; excludeRb = v.phys.body; continue;
        }
        // bullet penetration: doors and body panels let strong rounds through at reduced damage
        const pn = opts.power && !opts.dry ? penetration('vehicle', opts.power) : null;
        if (pn?.pass && !through.has(v) && !v.destroyed) {
          res.pen.push({ point: res.point.clone(), normal: res.normal.clone(), surface: 'vehicle', vehicle: v }); res.damageMul *= pn.mul;
          through.add(v); start = worldT + pn.thickness; excludeRb = v.phys.body; res.kind = 'none'; res.vehicle = null; continue;
        }
      } else {
        res.kind = 'static';
        if (opts.power && !opts.dry && this.thinWall(hit.collider)) { // drywall / plywood / fences
          const pn = penetration('wood', opts.power);
          if (pn.pass) { res.pen.push({ point: res.point.clone(), normal: res.normal.clone(), surface: 'wood', vehicle: null }); res.damageMul *= pn.mul; start = worldT + pn.thickness; res.kind = 'none'; continue; }
        }
        // WORLDGLASS hook: shop windows are real panes; a round breaks the pane and carries on
        if (this.worldGlass && !opts.solidGlass) {
          const gp = this.v2.copy(res.point).addScaledVector(d, 0.05), gid = this.worldGlass.glassAt?.(gp, 0.3, true);
          if (gid !== null && gid !== undefined) {
            if (this.worldGlass.isGlassBroken?.(gid)) { start = worldT + 0.35; continue; } // shattered pane: nothing left to stop the round
            if (!opts.dry) {
              const shattered = this.worldGlass.hitGlass ? this.worldGlass.hitGlass(gid as number) : this.worldGlass.breakGlass?.(gid);
              if (shattered) { this.extra('glassShatter', gp, 1, 0.9 + Math.random() * 0.2, 'glass'); for (let i = 0; i < 10; i++) this.particles.impact(gp.x + (Math.random() - 0.5) * 1.6, gp.y + (Math.random() - 0.3) * 1.2, gp.z, 0, 0.3, 0, 'glass', 1); }
              else { this.extra('hitGlass', gp, 0.7, 1, 'glass'); this.particles.impact(gp.x, gp.y, gp.z, -d.x, 0.1, -d.z, 'glass', 1); return res; }
            } else return res;
            start = worldT + 0.05; continue;
          }
        }
      }
      return res;
    }
    return res;
  }

  // ---------------------------------------------------------------- shooting
  /** Fires a ranged weapon. dir must be normalised. spread is the cone radius (radians-ish offset on the unit dir). */
  shoot(shooter: Character, w: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, spread: number, excludeVehicle?: Vehicle | null): HitInfo[] {
    const hits: HitInfo[] = [];
    const isPlayer = shooter === this.player;
    this.playGunshot(w, origin, 0.98 + Math.random() * 0.04);
    if (!w.suppressed) {
      this.particles.muzzle(origin.x, origin.y, origin.z, dir.x, dir.y, dir.z, w.pellets > 1, w.flash || 1);
      this.flash.position.copy(origin).addScaledVector(dir, 0.25); this.flashT = FLASH_T; this.flashPeak = (w.light || 30) * (isPlayer ? 1 : 0.8);
    }
    if (w.projectile !== 'none') { this.launch(shooter, w, origin, dir, spread); this.onShot?.({ shooter, weapon: w, origin: origin.clone(), hits }); return hits; }
    this.ejectCase(shooter, w, origin, dir);
    const rot = Math.random();
    let whizzed = false, impactSounds = 0;
    const d = new THREE.Vector3();
    const strength0 = w.pellets > 1 ? 0.55 : 1;
    for (let p = 0; p < w.pellets; p++) {
      if (w.pellets > 1) {
        // shotgun: one pellet near the centre, the rest in a jittered ring (a readable, fair pattern)
        if (p === 0) coneSample(dir, spread * 0.15, Math.random(), Math.random(), d, 1);
        else coneSample(dir, spread, rot + (p - 1) / (w.pellets - 1) + (Math.random() - 0.5) * 0.08, 0.5 + 0.5 * Math.random(), d, 1);
      } else coneSample(dir, spread, Math.random(), Math.random(), d);
      const power = roundPower(w), v0 = muzzleVelocity(w);
      let tr = this.trace(origin, d, w.range, shooter, { excludeVehicle, inflate: isPlayer ? 0 : 0.07, power });
      if (v0 > 0 && tr.t > 60) { // gravity drop at range: re-aim the round at the point it will actually fall to
        const L = tr.t, drop = bulletDrop(v0, L);
        d.set(d.x * L, d.y * L - drop, d.z * L).normalize();
        tr = this.trace(origin, d, w.range, shooter, { excludeVehicle, inflate: isPlayer ? 0 : 0.07, power });
      }
      const wHit = tr.damageMul < 1 ? { ...w, damage: w.damage * tr.damageMul, playerDamage: w.playerDamage * tr.damageMul } : w;
      for (const ph of tr.pen) { // entry marks and damage on every panel the round went through
        this.particles.impact(ph.point.x, ph.point.y, ph.point.z, ph.normal.x, ph.normal.y, ph.normal.z, ph.surface === 'vehicle' ? 'metal' : 'wood', strength0);
        if (ph.vehicle) { ph.vehicle.damage(w.damage * 0.2, ph.point, d, shooter); ph.vehicle.flashT = 0.05; this.particles.decal(ph.point.x, ph.point.y, ph.point.z, ph.normal.x, ph.normal.y, ph.normal.z, 'metal', ph.vehicle.visual); this.onVehicleHit?.(ph.vehicle, shooter); }
      }
      const end = tr.point.clone();
      const info: HitInfo = { point: end, target: null, kind: tr.kind, headshot: false, killed: false, throughGlass: tr.glass.length > 0 };
      const strength = w.pellets > 1 ? 0.55 : 1;
      const loud = impactSounds < (w.pellets > 1 ? 2 : 1);
      if (tr.kind === 'character' && tr.character) {
        const c = tr.character, zone = tr.zone!;
        const apply = () => {
          const res = this.hitPerson(c, shooter, wHit, zone, tr.t, d.clone(), end);
          this.particles.impact(end.x, end.y, end.z, -d.x, -d.y, -d.z, 'body', strength * (zone === 'head' ? 1.4 : 1));
          return res;
        };
        const delay = tr.t > 100 ? flightTime(v0, tr.t) : 0; // long shots take time to arrive
        info.target = c; info.zone = zone; info.headshot = zone === 'head'; info.surface = 'body';
        if (delay > 0) this.pending.push({ at: this.time + delay, fn: () => { if (c.alive) apply(); } });
        else { const res = apply(); info.killed = res.killed; info.damage = res.damage; }
        if (loud && delay <= 0) { this.sfx(IMPACT_SND.body, end, zone === 'head' ? 1.15 : 1, zone === 'head' ? 1.2 : 1); impactSounds++; }
      } else if (tr.kind === 'vehicle' && tr.vehicle) {
        const v = tr.vehicle, n = tr.normal;
        v.damage(w.damage * 0.35 * w.pellets ** -0.3, end, d, shooter);
        v.flashT = 0.05;
        info.target = v; info.surface = 'metal';
        this.particles.impact(end.x, end.y, end.z, n.x, n.y, n.z, 'metal', strength);
        this.particles.decal(end.x, end.y, end.z, n.x, n.y, n.z, 'metal', v.visual);
        if (loud) { if (Math.random() < 0.25) this.audio.play('ricochet', { pos: end, volume: 0.5 }); else this.sfx(IMPACT_SND.metal, end); impactSounds++; }
        this.onVehicleHit?.(v, shooter);
      } else if (tr.kind === 'static') {
        const n = tr.normal;
        if (origin.y > WATER_LEVEL && end.y < WATER_LEVEL + 0.02 && d.y < 0) {
          const t = (WATER_LEVEL - origin.y) / d.y; const wp = origin.clone().addScaledVector(d, t);
          info.surface = 'water'; this.particles.impact(wp.x, wp.y, wp.z, 0, 1, 0, 'water', strength);
          if (loud) { this.sfx(IMPACT_SND.water, wp); impactSounds++; }
        } else {
          const s = info.surface = this.surfaceOf(tr.collider!, tr.tag, end, n);
          this.particles.impact(end.x, end.y, end.z, n.x, n.y, n.z, s, strength);
          this.particles.decal(end.x, end.y, end.z, n.x, n.y, n.z, s);
          if ((s === 'metal' || s === 'concrete') && isShallow(d.x, d.y, d.z, n.x, n.y, n.z)) { // ricochet: sparks and a skipping streak
            reflect(d, n, this.v3); const r = this.v3.normalize();
            this.particles.impact(end.x, end.y, end.z, n.x, n.y, n.z, 'metal', 1.4);
            this.tracers.add(end, this.v2.copy(end).addScaledVector(r, 7), 0.1, 0.5);
            info.ricochet = true;
          }
          if (loud) {
            const ric = s === 'metal' ? 0.4 : s === 'concrete' ? 0.18 : 0;
            if (Math.random() < ric) this.audio.play('ricochet', { pos: end, volume: 0.45 }); else this.sfx(IMPACT_SND[s], end);
            impactSounds++;
          }
        }
      } else if (d.y < 0) {
        const t = (WATER_LEVEL - origin.y) / d.y;
        if (t > 0 && t < w.range) { const wp = origin.clone().addScaledVector(d, t); info.surface = 'water'; this.particles.impact(wp.x, wp.y, wp.z, 0, 1, 0, 'water', strength); if (loud) { this.sfx(IMPACT_SND.water, wp); impactSounds++; } }
      }
      if (p < (w.pellets > 1 ? 4 : 1)) this.tracers.add(origin, end, isPlayer ? 0.12 : 0.3, w.pellets > 1 ? 0.7 : 1);
      if (!whizzed && !isPlayer) whizzed = this.nearMiss(w, origin, d, tr.t, info.target);
      hits.push(info);
    }
    this.onShot?.({ shooter, weapon: w, origin: origin.clone(), hits });
    return hits;
  }

  /** Applies zone damage and the hit reaction. */
  hitPerson(c: Character, from: Character, w: WeaponDef, zone: Zone, dist: number, dir: THREE.Vector3, at: THREE.Vector3): { killed: boolean; damage: number } {
    const vest = c.team === 'police';
    const zd = zoneDamage(w, zone, dist, { isPlayer: c.isPlayer, vest }, 0.97 + Math.random() * 0.06);
    const dmg = zd.instantKill ? c.health + c.armor + 1000 : zd.damage;
    if (zd.instantKill) c.armor = 0;
    c.lastHit = { zone, dx: dir.x, dz: dir.z, power: w.knockback * (w.pellets > 1 ? 0.8 : 1) + (zone === 'head' ? 0.3 : 0), blast: false };
    const killed = c.damage(dmg, from, this.time);
    const h = c.human;
    if (c.alive && !h.busy) {
      if (zone === 'head' || zone === 'neck') h.playOnce('Hit_Head', 'upper', 0.05);
      else if (zone === 'leg') { h.playOnce('Hit_Chest', 'full', 0.05, { rate: 1.3, weight: 0.7 }); c.vel.x *= 0.3; c.vel.z *= 0.3; }
      else h.playOnce('Hit_Chest', 'upper', 0.05, { weight: zone === 'arm' ? 0.6 : 1 });
    }
    if (w.knockback > 0 && !c.inVehicle) { const kb = w.knockback / Math.max(1, w.pellets * 0.6) * (killed ? 1.6 : 1); c.vel.x += dir.x * kb; c.vel.z += dir.z * kb; }
    if (killed && c.inVehicle) { const v = c.inVehicle as Vehicle; if (this.onOccupantKilled) this.onOccupantKilled(c, v); else slumpOccupant(c, v); }
    void at;
    this.onHit?.(c, dmg, from, zone === 'head', killed, w, zone);
    return { killed, damage: dmg };
  }

  /** Material of a static surface: thin poles are metal, trunks wood, open ground from the map, everything else masonry. */
  /** A thin vertical partition (interior wall, fence, plywood hoarding): a cuboid under 20 cm thick, 0.8-3.4 m tall (facade slabs are thicker or taller). */
  private thinWall(col: RAPIER.Collider): boolean {
    try {
      const sh = col.shape;
      if (sh.type !== RAPIER.ShapeType.Cuboid) return false;
      const h = (sh as RAPIER.Cuboid).halfExtents;
      return h.y > 0.4 && h.y < 1.7 && Math.min(h.x, h.z) * 2 < 0.2 && Math.max(h.x, h.z) > 0.4;
    } catch { return false; }
  }
  private surfaceOf(col: RAPIER.Collider, tag: ColliderTag | undefined, p: THREE.Vector3, n: { x: number; y: number; z: number }): ImpactKind {
    if (tag?.kind === 'water') return 'water';
    try {
      const sh = col.shape;
      if (sh.type === RAPIER.ShapeType.Cylinder) return (sh as RAPIER.Cylinder).radius < 0.2 ? 'metal' : 'wood';
    } catch { /* shape access is best-effort */ }
    if (this.thinWall(col)) return 'wood';
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
      if (w.baseSound === 'rifle') this.ax.playExtra('crackBy', { pos: at, volume: 0.5 + 0.5 * near });
    } else this.audio.play('whoosh', { pos: at, volume: 0.3 + 0.4 * near, pitch: 2.2 });
    return true;
  }
  /** Shell casing out of the ejection port (pump / bolt guns eject on the cycle). */
  ejectCase(shooter: Character, w: WeaponDef, origin0: THREE.Vector3, dir0: THREE.Vector3, port?: THREE.Vector3) {
    if (w.melee || w.eject < 0 || w.casing === 'none') return;
    const origin = origin0.clone(), dir = dir0.clone(), portP = port?.clone();
    const fn = () => {
      if (!shooter.alive || shooter.inVehicle) return;
      const o = portP ?? this.v1.copy(origin).addScaledVector(dir, -0.25);
      const rx = dir.z, rz = -dir.x, rl = Math.hypot(rx, rz) || 1; // right of the barrel
      const sp = 1.8 + Math.random() * 1.2;
      const hull = w.casing === 'hull';
      this.particles.casing(o.x, o.y + 0.03, o.z, -rx / rl * sp + shooter.vel.x - dir.x * 0.4, 1.6 + Math.random() * 1.2, -rz / rl * sp + shooter.vel.z - dir.z * 0.4, shooter.pos.y, hull, w.casing === 'rifle');
      const feet = this.v2.set(o.x, shooter.pos.y, o.z);
      if (hull) this.extra('casingHull', feet, 0.45); else this.audio.play('shellCasing', { pos: feet, volume: 0.4 });
    };
    if (w.eject > 0) this.pending.push({ at: this.time + w.eject, fn }); else fn();
  }

  // ---------------------------------------------------------------- projectiles / explosions
  /** Launches a grenade / rocket / throwable from `origin` along `dir` (spread applied for launchers). */
  launch(owner: Character, w: WeaponDef, origin: THREE.Vector3, dir: THREE.Vector3, spread = 0, power = 1) {
    const d = new THREE.Vector3(); coneSample(dir, spread, Math.random(), Math.random(), d);
    const kind = w.projectile;
    const speed = kind === 'rocket' ? 55 : kind === 'grenade40' ? 38 : 17 * power;
    const vel = d.clone().multiplyScalar(speed); if (kind === 'frag' || kind === 'molotov') vel.y += 3.2 * power;
    vel.x += owner.vel.x * 0.5; vel.z += owner.vel.z * 0.5;
    const mesh = projMesh(kind); mesh.position.copy(origin); this.scene.add(mesh);
    this.projectiles.push({ kind, pos: origin.clone(), vel, owner, w, fuse: kind === 'frag' ? 3.2 : 8, age: 0, mesh, bounces: 0, trail: 0 });
  }
  /** Seconds until a thrown frag goes off (cooking shortens it). */
  cookFuse(seconds: number) { const p = this.projectiles[this.projectiles.length - 1]; if (p && p.kind === 'frag') p.fuse = Math.max(0.15, p.fuse - seconds); }
  private updateProjectiles(dt: number) {
    for (const p of [...this.projectiles]) {
      p.age += dt; p.fuse -= dt;
      const g = p.kind === 'rocket' ? 0.6 : p.kind === 'grenade40' ? 9 : 14;
      p.vel.y -= g * dt;
      if (p.kind === 'rocket') { p.trail -= dt; if (p.trail <= 0) { p.trail = 0.012; this.particles.smoke(p.pos.x, p.pos.y, p.pos.z, 0.2, 0.5); this.particles.fire(p.pos.x, p.pos.y - 0.4, p.pos.z); } }
      const step = p.vel.length() * dt;
      const d = this.vProj.copy(p.vel).normalize(); // own vector: trace() reuses v1/v2 internally and used to corrupt this direction
      let exploded = false;
      if (step > 0) {
        const tr = p.age > 0.04 ? this.trace(p.pos, d, step + 0.05, p.owner, { dry: true, solidGlass: true }) : null;
        if (tr && tr.kind !== 'none') {
          if (p.kind === 'frag' && tr.kind !== 'character') {
            // bounce
            p.pos.copy(tr.point).addScaledVector(tr.normal, 0.04);
            const n = tr.normal, vn = p.vel.dot(n);
            p.vel.addScaledVector(n, -1.45 * vn).multiplyScalar(0.55);
            if (Math.abs(vn) > 1.5) this.extra('grenadeBounce', p.pos, Math.min(1, Math.abs(vn) / 8));
            p.bounces++;
          } else { p.pos.copy(tr.point).addScaledVector(tr.normal, 0.1); this.detonate(p); exploded = true; }
        } else p.pos.addScaledVector(p.vel, dt);
      }
      if (!exploded && p.pos.y < WATER_LEVEL - 0.3) { this.particles.splash(p.pos.x, WATER_LEVEL, p.pos.z); this.removeProjectile(p); continue; }
      if (!exploded && (p.fuse <= 0 || p.age > 12)) { this.detonate(p); exploded = true; }
      if (!exploded) {
        p.mesh.position.copy(p.pos);
        if (p.kind === 'rocket' || p.kind === 'grenade40') p.mesh.lookAt(this.v2.copy(p.pos).add(p.vel)); else p.mesh.rotation.x += dt * 9;
        if (p.kind === 'molotov') this.particles.fire(p.pos.x, p.pos.y + 0.12, p.pos.z, 0.25);
      }
    }
  }
  private removeProjectile(p: Projectile) { const i = this.projectiles.indexOf(p); if (i >= 0) this.projectiles.splice(i, 1); p.mesh.removeFromParent(); ((p.mesh as THREE.Mesh).material as THREE.Material).dispose(); }
  private detonate(p: Projectile) {
    this.removeProjectile(p);
    if (p.kind === 'molotov') {
      this.extra('glassShatter', p.pos, 0.8, 1.1, 'glass');
      this.audio.play('whoosh', { pos: p.pos, volume: 0.9, pitch: 0.6 });
      const ground = this.physics.ray(p.pos.x, p.pos.y + 0.3, p.pos.z, 0, -1, 0, 6, groups(0xffff, G_STATIC));
      const at = p.pos.clone(); if (ground) at.y = p.pos.y + 0.3 - ground.toi;
      this.fires.push({ pos: at, r: 3.2, t: 9, by: p.owner, tick: 0 });
      for (let i = 0; i < 20; i++) this.particles.fire(at.x + (Math.random() - 0.5) * 3, at.y + 0.2, at.z + (Math.random() - 0.5) * 3, 1.2);
      return;
    }
    this.explode(p.pos, p.owner, p.kind === 'rocket' ? 1.35 : p.kind === 'grenade40' ? 1 : 1.1, p.w);
  }
  /** Explosion: fireball, shock, vehicles damaged, people damaged (via onExplosion when the game provides it). */
  explode(at: THREE.Vector3, by: Character | null, scale = 1, w: WeaponDef = WEAPONS.grenade) {
    this.particles.explosion(at.x, at.y, at.z, scale);
    this.audio.play('explosion', { pos: at, volume: Math.min(1.5, scale) });
    this.flash.position.copy(at).y += 1; this.flashT = FLASH_T * 3; this.flashPeak = 160 * scale;
    const R = 8 * scale;
    for (const c of this.targets()) {
      if (!c.alive || !c.inVehicle) continue;
      const v = c.inVehicle as Vehicle; if (v.position.distanceTo(at) < R * 0.5) this.hitPerson(c, by ?? c, w, 'torso', 0, this.v2.set(0, 1, 0), at);
    }
    if (this.onExplosion) this.onExplosion(at, by, R);
    else for (const c of this.targets()) {
      if (!c.alive || c.inVehicle) continue;
      const dist = c.pos.distanceTo(at); if (dist > R) continue;
      const f = 1 - dist / R; const dmg = (c.isPlayer ? w.playerDamage : w.damage) * f * f * 1.4;
      const dir = this.v2.copy(c.pos).sub(at).setY(0).normalize();
      c.lastHit = { zone: 'torso', dx: dir.x, dz: dir.z, power: 6, blast: true };
      const killed = c.damage(dmg, by, this.time); c.vel.set(dir.x * 7 * f, 4 * f, dir.z * 7 * f); c.knockT = 1.2 * f;
      if (by) this.onHit?.(c, dmg, by, false, killed, w, 'torso');
    }
    for (const h of this.helis()) {
      const dist = h.position.distanceTo(at); if (dist > R * 1.15) continue;
      const f = 1 - dist / (R * 1.15); h.damage(w.damage * 4.5 * f, at.clone(), this.v2.copy(h.position).sub(at).normalize().clone(), by ?? undefined);
    }
    for (const v of this.vehicles()) {
      const dist = v.position.distanceTo(at); if (dist > R) continue;
      const f = 1 - dist / R; const dir = this.v2.copy(v.position).sub(at).normalize();
      v.damage(w.damage * 2.2 * f, at.clone(), dir.clone(), by ?? undefined);
      v.phys.body.applyImpulse({ x: dir.x * 1800 * f * scale, y: 2600 * f * scale, z: dir.z * 1800 * f * scale }, true);
    }
  }
  private updateFires(dt: number) {
    for (const f of [...this.fires]) {
      f.t -= dt; f.tick -= dt;
      const life = Math.min(1, f.t / 2);
      if (Math.random() < 0.9 * life) for (let i = 0; i < 2; i++) { const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * f.r; this.particles.fire(f.pos.x + Math.cos(a) * r, f.pos.y + 0.1, f.pos.z + Math.sin(a) * r, 0.9 + Math.random() * 0.5); }
      if (Math.random() < 0.2 * life) this.particles.smoke(f.pos.x + (Math.random() - 0.5) * f.r, f.pos.y + 1.2, f.pos.z + (Math.random() - 0.5) * f.r, 0.6, 1.2);
      if (f.tick <= 0) {
        f.tick = 0.25;
        for (const c of this.targets()) {
          if (!c.alive || c.inVehicle) continue;
          const d = Math.hypot(c.pos.x - f.pos.x, c.pos.z - f.pos.z); if (d > f.r || Math.abs(c.pos.y - f.pos.y) > 1.5) continue;
          // burning: ~40 health/s for people, ~12/s for the player (ticks of 0.25 s)
          const w = WEAPONS.molotov; const dmg = (c.isPlayer ? 12 : 40) * 0.25;
          const killed = c.damage(dmg, f.by, this.time);
          this.onHit?.(c, dmg, f.by, false, killed, w, 'leg');
        }
      }
      if (f.t <= 0) this.fires.splice(this.fires.indexOf(f), 1);
    }
  }
  get activeProjectiles() { return this.projectiles.length; }
  get activeFires() { return this.fires.length; }

  // ---------------------------------------------------------------- melee
  /** Melee strike in front of the attacker (fists, knife, bat). */
  melee(attacker: Character, w: WeaponDef, targets: Iterable<Character>, vehicles: Iterable<Vehicle>): Character | null {
    const fx = Math.sin(attacker.yaw), fz = Math.cos(attacker.yaw);
    const reach = Math.max(0.9, w.range * 0.55);
    const cx = attacker.pos.x + fx * reach, cz = attacker.pos.z + fz * reach;
    let best: Character | null = null, bd = w.range;
    for (const c of targets) {
      if (c === attacker || !c.alive || c.inVehicle) continue;
      const d = Math.hypot(c.pos.x - cx, c.pos.z - cz);
      if (d < bd && Math.abs(c.pos.y - attacker.pos.y) < 1.2) { bd = d; best = c; }
    }
    if (best) {
      const base = best.isPlayer ? w.playerDamage : w.damage;
      const killed = best.damage(base * (0.9 + Math.random() * 0.2), attacker, this.time);
      best.vel.x += fx * w.knockback * 1.5; best.vel.z += fz * w.knockback * 1.5;
      if (w.id === 'bat') best.knockT = Math.max(best.knockT, 0.6);
      if (best.alive) best.human.playOnce('Hit_Head', 'upper', 0.05);
      this.audio.play('punchHit', { pos: best.pos, pitch: w.id === 'bat' ? 0.7 : w.id === 'knife' ? 1.3 : 1 });
      if (w.id === 'bat') this.extra('hitWood', best.pos, 0.7, 0.8);
      this.particles.impact(best.pos.x, best.headY - 0.3, best.pos.z, -fx, 0, -fz, 'body', w.id === 'fists' ? 0.6 : 1);
      this.onHit?.(best, base, attacker, false, killed, w, 'torso');
      return best;
    }
    for (const v of vehicles) {
      if (v.position.distanceTo(new THREE.Vector3(cx, v.position.y, cz)) < 2.4) { v.damage(w.id === 'bat' ? 10 : 4, new THREE.Vector3(cx, attacker.pos.y + 1, cz), undefined, attacker); this.audio.play('hitMetal', { pos: v.position, volume: 0.4 }); this.onVehicleHit?.(v, attacker); break; }
    }
    if (w.id === 'fists') this.audio.play('punch', { pos: attacker.pos, volume: 0.6 }); else this.extra('swing', attacker.pos, 0.8, w.id === 'bat' ? 0.8 : 1.2, 'whoosh');
    return null;
  }
}

/** A person killed in their seat: stays seated, slumps forward against the wheel / door (the car coasts on). */
export function slumpOccupant(c: Character, v: Vehicle) {
  const h = c.human as typeof c.human & { slump?: () => void };
  if (typeof h.slump === 'function') h.slump();
  else { h.stopOnce(); h.setState('drive'); h.root.rotation.order = 'YXZ'; h.root.rotation.x = 0.5; h.root.rotation.z = (Math.random() < 0.5 ? -1 : 1) * 0.22; }
  if (v.driver === c) { v.input.throttle = 0; v.input.steer *= 0.3; v.input.handbrake = false; v.input.brake = 0; }
}
