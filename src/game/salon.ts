/**
 * Barber shops and clothing stores: walk in, press the interact key, and a panel opens with a live preview on the player
 * (the camera orbits them). Regular mode pays per change, Sandbox is free. The bought look is kept (saved as `appearance`).
 */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI } from '../ui/contracts';
import type { Kiosk } from './robbery';
import { STORE_W, STORE_D } from './places';
import type { FullLook } from '../actors/look';
import { tabsFor, optionPrice, lookCost, type ShopType } from './grooming';
import type { GroomState } from '../ui/groom';

/** Where the player stands while previewing (store-local metres, facing the mirror on the back wall) and how far the camera orbits. */
const SPOT: Record<ShopType, { x: number; z: number; dist: number }> = { barber: { x: 1.9, z: -1.5, dist: 1.9 }, clothing: { x: -1.4, z: -2.6, dist: 2.6 } };
const TITLE: Record<ShopType, string> = { barber: 'Barber chair', clothing: 'Fitting room' };

interface Session { k: Kiosk; type: ShopType; owned: FullLook; pending: FullLook; back: THREE.Vector3; backYaw: number; angle: number; focus: THREE.Vector3 }

export class Salon {
  private session: Session | null = null;
  /** Called after a purchase (the game saves). */
  onChanged: (() => void) | null = null;
  constructor(private game: Game, private ui: GameUI, private kiosks: () => Kiosk[]) {}
  get isOpen() { return !!this.session; }
  /** The look the player owns (an unpaid preview does not count). */
  ownedLook(): FullLook { return this.session?.owned ?? this.game.player.human.look; }
  private onMove = (e: MouseEvent) => { if ((e.buttons & 1) && !(e.target as HTMLElement | null)?.closest?.('.ma-panel')) this.drag(e.movementX); };
  /** The barber / clothing store the player stands in. */
  inside(): { k: Kiosk; type: ShopType } | null {
    const g = this.game; if (g.playerVehicle || !g.player.alive) return null;
    const p = g.player.pos;
    for (const k of this.kiosks()) {
      if (k.def.kind !== 'barber' && k.def.kind !== 'clothing') continue;
      const l = k.frame.toLocal(p);
      if (Math.abs(l.x) < STORE_W / 2 && Math.abs(l.z) < STORE_D / 2 && l.y > -1 && l.y < 4) return { k, type: k.def.kind };
    }
    return null;
  }
  prompt(key: string): string | null {
    if (this.session) return null;
    const s = this.inside(); if (!s) return null;
    return s.type === 'barber' ? `${key}  Get a haircut at ${s.k.def.name}` : `${key}  Try on outfits at ${s.k.def.name}`;
  }
  private state(): GroomState {
    const s = this.session!, g = this.game, free = g.mode === 'sandbox';
    const prices: Record<string, number> = {}, values: Record<string, string> = {};
    for (const t of tabsFor(s.type, s.owned.sex)) {
      values[t.id] = (s.pending as unknown as Record<string, string>)[t.id];
      for (const o of t.options) prices[`${t.id}:${o.id}`] = optionPrice(t, o.id, s.owned);
    }
    return { values, prices, total: lookCost(s.type, s.owned, s.pending), money: g.money, free };
  }
  open() {
    const found = this.inside(); if (!found || this.session) return;
    const g = this.game, { k, type } = found;
    g.pcombat.inv.holster();
    const owned = { ...g.player.human.look } as FullLook;
    const spot = SPOT[type], at = k.frame.toWorld(spot.x, 0.05, spot.z);
    const back = g.player.pos.clone(), backYaw = g.player.yaw;
    g.player.place(at.x, at.y + 0.02, at.z, k.def.yaw + Math.PI); // face the back wall (the mirror)
    g.player.updateVisual(0);
    this.session = { k, type, owned, pending: { ...owned }, back, backYaw, angle: 0, focus: new THREE.Vector3(at.x, at.y + 1.25, at.z) };
    g.menuOpen = true; g.input.exitLock();
    window.addEventListener('mousemove', this.onMove);
    this.ui.openGroom({
      title: TITLE[type], subtitle: k.def.name, tabs: tabsFor(type, owned.sex),
      onPick: (tab, id) => this.pick(tab, id), onPay: () => { this.pay(); }, onClose: () => this.close(false),
    }, this.state());
  }
  /** Previews one option on the player. */
  pick(tab: string, id: string) {
    const s = this.session; if (!s) return;
    (s.pending as unknown as Record<string, string>)[tab] = id;
    this.game.player.human.applyLook(s.pending);
    this.ui.updateGroom(this.state());
  }
  /** Pays for the pending look (Regular) or applies it (Sandbox). Returns true when bought. */
  pay(): boolean {
    const s = this.session; if (!s) return false;
    const g = this.game, total = lookCost(s.type, s.owned, s.pending), free = g.mode === 'sandbox';
    if (total <= 0) return false;
    if (!free && g.money < total) { this.ui.toast(`You need $${total - g.money} more`, 'warning'); return false; }
    if (!free) g.addMoney(-total);
    g.audio.play('purchase');
    s.owned = { ...s.pending };
    this.ui.toast(s.type === 'barber' ? 'Fresh cut. Looking sharp.' : 'New threads. Nice fit.', 'money');
    this.ui.updateGroom(this.state());
    this.onChanged?.();
    return true;
  }
  /** Leaves the chair: an unpaid preview is thrown away, the player goes back to where they stood. */
  close(hideUi = true) {
    const s = this.session; if (!s) return;
    this.session = null;
    window.removeEventListener('mousemove', this.onMove);
    const g = this.game;
    g.player.human.applyLook(s.owned);
    g.player.place(s.back.x, s.back.y, s.back.z, s.backYaw);
    g.cam.preview = null; g.cam.snapBehind(s.backYaw + Math.PI);
    g.menuOpen = false;
    if (hideUi) this.ui.closeGroom();
  }
  update(dt: number) {
    const s = this.session; if (!s) return;
    s.angle += dt * 0.45;
    // the camera starts in front of the face (between the player and the mirror) and slowly circles
    this.game.cam.preview = { focus: s.focus, yaw: s.k.def.yaw + Math.PI + s.angle, dist: SPOT[s.type].dist, pitch: 0.05, fov: 40 };
  }
  /** Drag to spin the preview. */
  drag(dx: number) { if (this.session) this.session.angle -= dx * 0.01; }
}
