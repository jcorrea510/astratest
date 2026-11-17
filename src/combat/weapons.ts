/** Weapon definitions, inventory rules and procedural weapon models. Pure logic is unit tested. */
import * as THREE from 'three';
import type { WeaponIcon } from '../ui/contracts';

export type WeaponId = 'fists' | 'pistol' | 'smg' | 'shotgun' | 'rifle';
export interface WeaponDef {
  id: WeaponId; name: string; icon: WeaponIcon; melee: boolean; damage: number; pellets: number; interval: number; auto: boolean;
  clip: number; reload: number; spread: number; aimSpread: number; recoil: number; range: number; price: number; ammoPrice: number; ammoPack: number;
  sound: 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'punch'; shake: number; knockback: number;
}
export const WEAPONS: Record<WeaponId, WeaponDef> = {
  fists: { id: 'fists', name: 'Fists', icon: 'fists', melee: true, damage: 14, pellets: 1, interval: 0.42, auto: false, clip: 0, reload: 0, spread: 0, aimSpread: 0, recoil: 0, range: 1.7, price: 0, ammoPrice: 0, ammoPack: 0, sound: 'punch', shake: 0.08, knockback: 2 },
  pistol: { id: 'pistol', name: 'Kestrel P9', icon: 'pistol', melee: false, damage: 24, pellets: 1, interval: 0.2, auto: false, clip: 12, reload: 1.3, spread: 0.035, aimSpread: 0.008, recoil: 0.028, range: 120, price: 400, ammoPrice: 60, ammoPack: 24, sound: 'pistol', shake: 0.12, knockback: 0.6 },
  smg: { id: 'smg', name: 'Mako Compact', icon: 'smg', melee: false, damage: 14, pellets: 1, interval: 0.075, auto: true, clip: 30, reload: 1.7, spread: 0.06, aimSpread: 0.024, recoil: 0.013, range: 90, price: 1200, ammoPrice: 90, ammoPack: 60, sound: 'smg', shake: 0.07, knockback: 0.4 },
  shotgun: { id: 'shotgun', name: 'Breaker 12', icon: 'shotgun', melee: false, damage: 12, pellets: 8, interval: 0.85, auto: false, clip: 6, reload: 2.2, spread: 0.1, aimSpread: 0.07, recoil: 0.11, range: 40, price: 1800, ammoPrice: 80, ammoPack: 12, sound: 'shotgun', shake: 0.35, knockback: 4 },
  rifle: { id: 'rifle', name: 'Longline Carbine', icon: 'rifle', melee: false, damage: 32, pellets: 1, interval: 0.13, auto: true, clip: 25, reload: 2.0, spread: 0.05, aimSpread: 0.006, recoil: 0.035, range: 220, price: 3200, ammoPrice: 120, ammoPack: 50, sound: 'rifle', shake: 0.16, knockback: 1 },
};
export const WEAPON_ORDER: WeaponId[] = ['fists', 'pistol', 'smg', 'shotgun', 'rifle'];

export interface WeaponState { owned: boolean; clip: number; reserve: number }
export class Inventory {
  weapons: Record<WeaponId, WeaponState> = { fists: { owned: true, clip: 0, reserve: 0 }, pistol: { owned: false, clip: 0, reserve: 0 }, smg: { owned: false, clip: 0, reserve: 0 }, shotgun: { owned: false, clip: 0, reserve: 0 }, rifle: { owned: false, clip: 0, reserve: 0 } };
  current: WeaponId = 'fists';
  medkits = 0;
  cooldown = 0;
  reloadT = 0;
  give(id: WeaponId, ammo: number) {
    const w = this.weapons[id];
    if (!w.owned) { w.owned = true; w.clip = Math.min(WEAPONS[id].clip, ammo); ammo -= w.clip; }
    w.reserve += Math.max(0, ammo);
  }
  get def() { return WEAPONS[this.current]; }
  get state() { return this.weapons[this.current]; }
  select(id: WeaponId) { if (this.weapons[id].owned && this.current !== id) { this.current = id; this.reloadT = 0; this.cooldown = Math.max(this.cooldown, 0.25); return true; } return false; }
  cycle(dir: 1 | -1) {
    const owned = WEAPON_ORDER.filter(w => this.weapons[w].owned);
    const i = owned.indexOf(this.current);
    this.select(owned[(i + dir + owned.length) % owned.length]);
  }
  /** Advances timers. Returns true when a reload just finished. */
  tick(dt: number): boolean {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.reloadT > 0) {
      this.reloadT -= dt;
      if (this.reloadT <= 0) { this.reloadT = 0; const w = this.state, d = this.def; const take = Math.min(d.clip - w.clip, w.reserve); w.clip += take; w.reserve -= take; return true; }
    }
    return false;
  }
  canFire(): boolean { const d = this.def; return this.cooldown <= 0 && this.reloadT <= 0 && (d.melee || this.state.clip > 0); }
  /** Consumes one shot; returns false if empty. Starts auto-reload when the clip runs out. */
  fire(): boolean {
    if (!this.canFire()) return false;
    const d = this.def;
    this.cooldown = d.interval;
    if (!d.melee) { this.state.clip--; if (this.state.clip === 0 && this.state.reserve > 0) this.startReload(); }
    return true;
  }
  startReload(): boolean {
    const d = this.def, w = this.state;
    if (d.melee || this.reloadT > 0 || w.clip >= d.clip || w.reserve <= 0) return false;
    this.reloadT = d.reload; return true;
  }
  get reloading() { return this.reloadT > 0; }
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
