/**
 * Round 7: Tidewater Arms as a real walk-in store. The real weapon models hang on the pegboards (GUN_SLOTS); look at one
 * and press Interact to buy it (or ammo for it once owned). The counter opens the full catalogue (armor, first aid, ...).
 */
import * as THREE from 'three';
import type { Game } from './game';
import type { Kiosk } from './robbery';
import { GUN_SLOTS } from '../world/storeKinds';
import { WEAPONS, WEAPON_ORDER, type WeaponId } from '../combat/weapons';
import { weaponMesh } from '../combat/weaponModels';

/** The guns on the wall, in slot order: long guns first (they read best on the long back board), then handguns. Pure. */
export function wallGuns(): WeaponId[] {
  const guns = WEAPON_ORDER.filter(id => { const w = WEAPONS[id]; return !w.melee && w.cat !== 'throw' && w.price > 0; });
  const rank = (id: WeaponId) => ['rifle', 'shotgun', 'heavy', 'smg', 'pistol'].indexOf(WEAPONS[id].cat);
  return [...guns].sort((a, b) => rank(a) - rank(b)).slice(0, GUN_SLOTS.length);
}

export class GunStore {
  private decorated: THREE.Object3D | null = null;
  private guns = wallGuns();
  constructor(private g: Game, private kiosks: () => Kiosk[]) {}
  get kiosk(): Kiosk | undefined { return this.kiosks().find(k => k.def.kind === 'guns'); }
  /** Hangs the weapon models once the store interior exists (it is built lazily near the camera). */
  update() {
    const k = this.kiosk, sh = k?.shell; if (!sh || this.decorated === sh.root) return;
    this.decorated = sh.root;
    this.guns.forEach((id, i) => {
      const s = GUN_SLOTS[i], m = weaponMesh(id);
      m.position.set(s.lx, s.ly, s.lz); m.rotation.set(0, s.yaw, 0); m.scale.setScalar(1.15);
      m.traverse(o => { (o as THREE.Mesh).castShadow = false; });
      sh.root.add(m);
    });
  }
  /** Customer side of the counter, inside the store. */
  atCounter(p: THREE.Vector3): boolean {
    const k = this.kiosk; if (!k || k.phase !== 'open') return false;
    const l = k.frame.toLocal(p); return Math.abs(p.y - k.clerkPos.y) < 2 && Math.abs(l.x + 3) < 1.4 && l.z > 1.6 && l.z < 3.4;
  }
  /** The wall gun the player stands at and faces (within reach), with what Interact would do. */
  facing(p: THREE.Vector3, yaw: number): { id: WeaponId; ammo: boolean; price: number; name: string } | null {
    const k = this.kiosk; if (!k || !k.shell || k.phase === 'closed') return null;
    const l = k.frame.toLocal(p); if (Math.abs(p.y - k.clerkPos.y) > 2) return null;
    const fx = Math.sin(yaw), fz = Math.cos(yaw);
    let best = -1, bd = 1.7;
    this.guns.forEach((_id, i) => {
      const s = GUN_SLOTS[i], d = Math.hypot(s.lx - l.x, s.lz - l.z); if (d > bd) return;
      const w = k.frame.toWorld(s.lx, 0, s.lz), dx = w.x - p.x, dz = w.z - p.z, dl = Math.hypot(dx, dz) || 1;
      if ((dx * fx + dz * fz) / dl < 0.35) return; // must be roughly in front of the player
      bd = d; best = i;
    });
    if (best < 0) return null;
    const id = this.guns[best], w = WEAPONS[id], st = this.g.pcombat.inv.weapons[id];
    const ammo = !!st?.owned;
    return { id, ammo, price: ammo ? w.ammoPrice : w.price, name: w.name };
  }
}
