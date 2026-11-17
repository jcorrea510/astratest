/** Weapon definitions, inventory rules and procedural weapon models. Pure logic is unit tested. */
import * as THREE from 'three';
import type { WeaponIcon } from '../ui/contracts';

export type WeaponId = 'fists' | 'pistol' | 'smg' | 'shotgun' | 'rifle';
/**
 * Weapon tuning. Angles are radians (a "spread" is the radius of the shot cone as an offset on a unit direction).
 * Shooting model (see PlayerCombat): cone = base x accuracy + bloom + movement, where base is `spread` from the hip or
 * `aimSpread` when aiming, and accuracy settles to `firstShot` after holding still on target for a moment.
 */
export interface WeaponDef {
  id: WeaponId; name: string; icon: WeaponIcon; melee: boolean; damage: number; pellets: number; interval: number; auto: boolean;
  clip: number; reload: number; spread: number; aimSpread: number; recoil: number; range: number; price: number; ammoPrice: number; ammoPack: number;
  sound: 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'punch'; shake: number; knockback: number;
  /** extra seconds when reloading from empty (chambering a round) */ emptyReload: number;
  /** shotgun-style reload: seconds before the first shell and per shell (0 = magazine) */ reloadStart: number; shellReload: number;
  /** damage falloff: full until `falloff[0]` m, linearly down to `falloff[2]` x at `falloff[1]` m */ falloff: [number, number, number];
  headMul: number;
  /** settled accuracy multiplier on the base cone (first-shot accuracy) */ firstShot: number;
  /** spread bloom added per shot, its cap, the pause before it recovers and the recovery rate (1/s, exponential) */ bloom: number; bloomMax: number; bloomDelay: number; bloomRecover: number;
  /** cone added when moving at jog speed (scaled by speed) and while airborne */ movePenalty: number;
  /** camera kick per shot: pitch up, random yaw, consistent yaw drift; recovery delay/rate (1/s) and fraction returned */ kickPitch: number; kickYaw: number; kickDrift: number; recoverDelay: number; recoverRate: number; recoverFrac: number;
  /** visual: weapon slide-back (m), muzzle flip (rad), torso lean (rad), spring rate (1/s) */ kickBack: number; kickFlip: number; kickBody: number; kickRate: number;
  /** muzzle flash size and light intensity */ flash: number; light: number;
  /** seconds after the shot when the empty case is ejected (shotgun: on the pump) */ eject: number;
}
type Base = Omit<WeaponDef, 'emptyReload' | 'reloadStart' | 'shellReload' | 'falloff' | 'headMul' | 'firstShot' | 'bloom' | 'bloomMax' | 'bloomDelay' | 'bloomRecover' | 'movePenalty' | 'kickPitch' | 'kickYaw' | 'kickDrift' | 'recoverDelay' | 'recoverRate' | 'recoverFrac' | 'kickBack' | 'kickFlip' | 'kickBody' | 'kickRate' | 'flash' | 'light' | 'eject'>;
const NONE = { emptyReload: 0, reloadStart: 0, shellReload: 0, falloff: [999, 1000, 1] as [number, number, number], headMul: 1, firstShot: 1, bloom: 0, bloomMax: 0, bloomDelay: 0, bloomRecover: 0, movePenalty: 0, kickPitch: 0, kickYaw: 0, kickDrift: 0, recoverDelay: 0, recoverRate: 0, recoverFrac: 0, kickBack: 0, kickFlip: 0, kickBody: 0, kickRate: 1, flash: 0, light: 0, eject: 0 };
const def = (b: Base, x: Partial<WeaponDef>): WeaponDef => ({ ...NONE, ...b, ...x });
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: def({ id: 'fists', name: 'Fists', icon: 'fists', melee: true, damage: 15, pellets: 1, interval: 0.4, auto: false, clip: 0, reload: 0, spread: 0, aimSpread: 0, recoil: 0, range: 1.7, price: 0, ammoPrice: 0, ammoPack: 0, sound: 'punch', shake: 0.08, knockback: 2 },
    { kickBody: 0.06, kickRate: 12 }),
  // Semi-auto 9 mm: crisp, accurate when settled, a strong snap per shot that mostly recovers.
  pistol: def({ id: 'pistol', name: 'Kestrel P9', icon: 'pistol', melee: false, damage: 26, pellets: 1, interval: 0.17, auto: false, clip: 12, reload: 1.25, spread: 0.03, aimSpread: 0.009, recoil: 0.026, range: 120, price: 400, ammoPrice: 60, ammoPack: 24, sound: 'pistol', shake: 0.1, knockback: 0.6 },
    { emptyReload: 0.25, falloff: [25, 70, 0.6], headMul: 2.2, firstShot: 0.2, bloom: 0.014, bloomMax: 0.05, bloomDelay: 0.07, bloomRecover: 6, movePenalty: 0.02, kickPitch: 0.026, kickYaw: 0.006, kickDrift: 0, recoverDelay: 0.05, recoverRate: 9, recoverFrac: 0.9, kickBack: 0.06, kickFlip: 0.32, kickBody: 0.05, kickRate: 15, flash: 0.9, light: 32, eject: 0 }),
  // Compact SMG: very fast, light per-shot kick with a horizontal wobble; accurate up close, falls off fast.
  smg: def({ id: 'smg', name: 'Mako Compact', icon: 'smg', melee: false, damage: 13, pellets: 1, interval: 0.07, auto: true, clip: 30, reload: 1.6, spread: 0.05, aimSpread: 0.02, recoil: 0.009, range: 90, price: 1200, ammoPrice: 90, ammoPack: 60, sound: 'smg', shake: 0.05, knockback: 0.4 },
    { emptyReload: 0.3, falloff: [15, 45, 0.5], headMul: 1.8, firstShot: 0.5, bloom: 0.0045, bloomMax: 0.04, bloomDelay: 0.09, bloomRecover: 5, movePenalty: 0.012, kickPitch: 0.009, kickYaw: 0.008, kickDrift: 0.0015, recoverDelay: 0.07, recoverRate: 7, recoverFrac: 0.9, kickBack: 0.03, kickFlip: 0.09, kickBody: 0.02, kickRate: 24, flash: 0.75, light: 22, eject: 0 }),
  // Pump shotgun: 9-pellet ring pattern, devastating within ~8 m, big kick, shell-by-shell reload you can interrupt.
  shotgun: def({ id: 'shotgun', name: 'Breaker 12', icon: 'shotgun', melee: false, damage: 12, pellets: 9, interval: 0.8, auto: false, clip: 6, reload: 2.2, spread: 0.085, aimSpread: 0.06, recoil: 0.075, range: 45, price: 1800, ammoPrice: 80, ammoPack: 12, sound: 'shotgun', shake: 0.32, knockback: 4 },
    { reloadStart: 0.3, shellReload: 0.42, falloff: [7, 28, 0.2], headMul: 1.5, firstShot: 0.85, bloom: 0.02, bloomMax: 0.03, bloomDelay: 0.3, bloomRecover: 4, movePenalty: 0.01, kickPitch: 0.075, kickYaw: 0.015, kickDrift: 0, recoverDelay: 0.08, recoverRate: 5, recoverFrac: 0.9, kickBack: 0.11, kickFlip: 0.3, kickBody: 0.12, kickRate: 9, flash: 1.25, light: 55, eject: 0.42 }),
  // Carbine: hard-hitting and laser-accurate when settled and aimed, recoil climbs with a slight right drift.
  rifle: def({ id: 'rifle', name: 'Longline Carbine', icon: 'rifle', melee: false, damage: 30, pellets: 1, interval: 0.115, auto: true, clip: 30, reload: 1.9, spread: 0.045, aimSpread: 0.0055, recoil: 0.013, range: 220, price: 3200, ammoPrice: 120, ammoPack: 60, sound: 'rifle', shake: 0.12, knockback: 1 },
    { emptyReload: 0.35, falloff: [50, 150, 0.75], headMul: 2.5, firstShot: 0.25, bloom: 0.0035, bloomMax: 0.03, bloomDelay: 0.1, bloomRecover: 5, movePenalty: 0.025, kickPitch: 0.013, kickYaw: 0.006, kickDrift: 0.002, recoverDelay: 0.09, recoverRate: 6, recoverFrac: 0.85, kickBack: 0.045, kickFlip: 0.1, kickBody: 0.035, kickRate: 18, flash: 1, light: 36, eject: 0 }),
};
/** Damage multiplier at distance d (metres). */
export function falloffAt(w: WeaponDef, d: number): number {
  const [a, b, m] = w.falloff;
  if (d <= a) return 1; if (d >= b) return m;
  return 1 + (m - 1) * (d - a) / (b - a);
}
export const WEAPON_ORDER: WeaponId[] = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];

export interface WeaponState { owned: boolean; clip: number; reserve: number }
export class Inventory {
  weapons: Record<WeaponId, WeaponState> = { fists: { owned: true, clip: 0, reserve: 0 }, pistol: { owned: false, clip: 0, reserve: 0 }, smg: { owned: false, clip: 0, reserve: 0 }, shotgun: { owned: false, clip: 0, reserve: 0 }, rifle: { owned: false, clip: 0, reserve: 0 } };
  current: WeaponId = 'fists';
  medkits = 0;
  cooldown = 0;
  reloadT = 0;
  /** total length of the reload in progress (or of the current shell for shell-by-shell reloads) */
  reloadDur = 0;
  /** increments each time a shell is loaded (shell-by-shell weapons) so callers can play a sound */
  shellsLoaded = 0;
  /** true while the reload in progress started from an empty clip */
  reloadFromEmpty = false;
  give(id: WeaponId, ammo: number) {
    const w = this.weapons[id];
    if (!w.owned) { w.owned = true; w.clip = Math.min(WEAPONS[id].clip, ammo); ammo -= w.clip; }
    w.reserve += Math.max(0, ammo);
  }
  get def() { return WEAPONS[this.current]; }
  get state() { return this.weapons[this.current]; }
  select(id: WeaponId) { if (this.weapons[id].owned && this.current !== id) { this.current = id; this.reloadT = 0; this.reloadDur = 0; this.cooldown = Math.max(this.cooldown, 0.25); return true; } return false; }
  cycle(dir: 1 | -1) {
    const owned = WEAPON_ORDER.filter(w => this.weapons[w].owned);
    const i = owned.indexOf(this.current);
    this.select(owned[(i + dir + owned.length) % owned.length]);
  }
  /** Advances timers. Returns true when a reload just finished. */
  tick(dt: number): boolean {
    // automatic weapons keep up to one frame of overshoot so the cyclic rate doesn't snap to whole frames
    this.cooldown = Math.max(this.def.auto ? -0.034 : 0, this.cooldown - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) {
        const w = this.state, d = this.def;
        if (d.shellReload > 0) {
          // one shell in; keep going while there is room and ammo
          if (w.clip < d.clip && w.reserve > 0) { w.clip++; w.reserve--; this.shellsLoaded++; }
          if (w.clip < d.clip && w.reserve > 0) { this.reloadT += d.shellReload; this.reloadDur = d.shellReload; return false; }
          this.reloadT = 0; this.reloadDur = 0; return true;
        }
        this.reloadT = 0; this.reloadDur = 0; const take = Math.min(d.clip - w.clip, w.reserve); w.clip += take; w.reserve -= take; return true;
      }
    }
    return false;
  }
  /** Shell-by-shell reloads can be interrupted by firing once at least one shell is in. */
  private get interruptible() { return this.def.shellReload > 0 && this.reloadT > 0 && this.state.clip > 0; }
  canFire(): boolean { const d = this.def; return this.cooldown <= 0 && (this.reloadT <= 0 || this.interruptible) && (d.melee || this.state.clip > 0); }
  /** Consumes one shot; returns false if empty. Starts auto-reload when the clip runs out. */
  fire(): boolean {
    if (!this.canFire()) return false;
    const d = this.def;
    if (this.reloadT > 0) { this.reloadT = 0; this.reloadDur = 0; }
    this.cooldown = (d.auto ? Math.max(-0.034, Math.min(0, this.cooldown)) : 0) + d.interval;
    if (!d.melee) { this.state.clip--; if (this.state.clip === 0 && this.state.reserve > 0) this.startReload(); }
    return true;
  }
  startReload(): boolean {
    const d = this.def, w = this.state;
    if (d.melee || this.reloadT > 0 || w.clip >= d.clip || w.reserve <= 0) return false;
    this.reloadFromEmpty = w.clip === 0;
    this.reloadT = d.shellReload > 0 ? d.reloadStart + d.shellReload : d.reload + (w.clip === 0 ? d.emptyReload : 0);
    this.reloadDur = this.reloadT; return true;
  }
  get reloading() { return this.reloadT > 0; }
  /** 0..1 progress through the current reload (or current shell). */
  get reloadProgress() { return this.reloadDur > 0 ? 1 - this.reloadT / this.reloadDur : 0; }
  toJSON() { return { weapons: this.weapons, current: this.current, medkits: this.medkits }; }
  load(d: { weapons?: Record<WeaponId, WeaponState>; current?: WeaponId; medkits?: number }) {
    if (d.weapons) for (const id of WEAPON_ORDER) if (d.weapons[id]) this.weapons[id] = { ...d.weapons[id] };
    this.weapons.fists.owned = true;
    if (d.current && this.weapons[d.current]?.owned) this.current = d.current;
    this.medkits = d.medkits ?? 0;
  }
}

/** Procedural weapon meshes (metres, muzzle along +z, grip at origin). */
export function weaponMesh(id: WeaponId): THREE.Group {
  const g = new THREE.Group();
  if (id === 'fists') return g;
  const dark = new THREE.MeshStandardMaterial({ color: '#23262b', roughness: 0.45, metalness: 0.6 });
  const mid = new THREE.MeshStandardMaterial({ color: '#4a4f57', roughness: 0.5, metalness: 0.5 });
  const accent = new THREE.MeshStandardMaterial({ color: id === 'rifle' ? '#7a6447' : id === 'shotgun' ? '#6b4a32' : '#c26a3a', roughness: 0.7 });
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material, rx = 0) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); b.rotation.x = rx; b.castShadow = true; g.add(b); return b; };
  const cyl = (r: number, l: number, x: number, y: number, z: number, m: THREE.Material) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 8).rotateX(Math.PI / 2), m); c.position.set(x, y, z); c.castShadow = true; g.add(c); return c; };
  if (id === 'pistol') { box(0.035, 0.04, 0.19, 0, 0.06, 0.05, dark); box(0.03, 0.1, 0.045, 0, 0, -0.005, mid, -0.25); box(0.02, 0.01, 0.03, 0, 0.088, 0.13, accent); }
  if (id === 'smg') { box(0.045, 0.06, 0.3, 0, 0.06, 0.08, dark); box(0.03, 0.1, 0.04, 0, -0.01, 0, mid, -0.2); box(0.028, 0.14, 0.035, 0, -0.03, 0.11, mid); cyl(0.013, 0.1, 0, 0.065, 0.27, dark); box(0.03, 0.04, 0.16, 0, 0.05, -0.14, accent); }
  if (id === 'shotgun') { cyl(0.02, 0.62, 0, 0.07, 0.3, dark); cyl(0.017, 0.5, 0, 0.035, 0.27, mid); box(0.05, 0.06, 0.22, 0, 0.06, 0.02, dark); box(0.04, 0.09, 0.28, 0, 0.02, -0.2, accent, 0.15); box(0.05, 0.05, 0.12, 0, 0.035, 0.3, accent); }
  if (id === 'rifle') { box(0.05, 0.08, 0.42, 0, 0.06, 0.12, dark); cyl(0.014, 0.3, 0, 0.075, 0.48, dark); box(0.03, 0.12, 0.05, 0, -0.03, 0.18, mid, 0.2); box(0.03, 0.1, 0.04, 0, -0.01, 0, mid, -0.2); box(0.045, 0.07, 0.24, 0, 0.04, -0.2, accent); box(0.025, 0.035, 0.12, 0, 0.12, 0.1, mid); }
  return g;
}
export const MUZZLE: Record<WeaponId, number> = { fists: 0, pistol: 0.16, smg: 0.33, shotgun: 0.62, rifle: 0.64 };
