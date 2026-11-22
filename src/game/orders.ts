/**
 * R6-F: shouting orders at people and taking hostages (Teen: intimidation only, nothing graphic).
 *
 *  - Hold the Orders key (default G) near a person you are threatening (aiming a gun at them, or close in front of you)
 *    to open a radial menu: Get down (kneel, hands on head), Come here, Hands up, Get in the car, Beat it. Move the mouse /
 *    stick towards an entry (or press its number) and release the key to give the order.
 *  - Whether they obey is a roll: a gun in their face works on most people, a bare fist on few, the brave ones sometimes
 *    refuse, and police / gang members never comply (see `complianceChance`).
 *  - Interact (E) next to somebody who is complying (or from behind) grabs them as a human shield: they stay in front of you
 *    with their hands up, your own shots never hit them, and officers hold fire unless they have a clear line to you. E again
 *    lets go (a shove away). Get into a car with a hostage and they ride in the passenger seat; "Get out" orders them out.
 */
import * as THREE from 'three';
import type { Npc } from '../actors/npc';
import type { Vehicle } from '../vehicles/vehicle';
import type { Game } from './game';
import type { MenuItem } from '../ui/combatfx';
import { keyLabel } from '../core/settings';
import { promptCap } from '../core/gamepad';

export type OrderId = 'kneel' | 'come' | 'hands' | 'car' | 'beat' | 'out';
export const ORDER_LABEL: Record<OrderId, string> = { kneel: 'Get down', come: 'Come here', hands: 'Hands up', car: 'Get in the car', beat: 'Beat it', out: 'Get out' };
const YES = ['“Okay, okay!”', '“Don\'t hurt me!”', '“Whatever you say!”', '“Easy, easy...”'];
const NO = ['“No way, man!”', '“Get lost!”', '“I\'m calling the cops!”', '“You\'re crazy!”'];

export interface ComplyCtx {
  role: 'civilian' | 'gang' | 'police';
  /** 0 = timid .. 1 = fearless */
  nerve: number;
  /** the player holds a gun pointed at this person */
  gunAimed: boolean;
  /** the player has a gun out but is not pointing it at them */
  gunOut: boolean;
  /** they were punched / hurt by the player a moment ago */
  hurt: boolean;
  /** the player's wanted level (a known criminal is scarier) */
  heat: number;
  dist: number;
}
/** Probability 0..1 that a person obeys an order. Police and gang members never do; "Beat it" is always welcome. */
export function complianceChance(order: OrderId, c: ComplyCtx): number {
  if (c.role !== 'civilian') return 0;
  if (order === 'beat') return 1;
  let p = 0.12;
  if (c.gunAimed) p += 0.75; else if (c.gunOut) p += 0.25;
  if (c.hurt) p += 0.25;
  if (c.heat >= 2) p += 0.1;
  p += (0.5 - c.nerve) * 0.4;
  if (c.dist > 10) p -= 0.2;
  if (order === 'car') p -= 0.12; // getting into a stranger's car is a big ask
  if (order === 'out') p = Math.max(p, 0.9);
  return Math.max(0, Math.min(0.97, p));
}
/** Which of `n` radial entries (first one at the top, clockwise) a pointer offset (x right, y down) points at; -1 if too small. */
export function radialPick(n: number, x: number, y: number, deadzone = 14): number {
  if (n <= 0 || Math.hypot(x, y) < deadzone) return -1;
  const a = Math.atan2(y, x) + Math.PI / 2; // 0 = up, clockwise
  const step = Math.PI * 2 / n;
  return Math.round(((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2) / step) % n;
}

export class Orders {
  open = false;
  target: Npc | null = null;
  items: { id: OrderId; label: string }[] = [];
  sel = -1;
  /** the person currently held as a human shield */
  shield: Npc | null = null;
  /** hostages sitting in a car */
  seated: { n: Npc; v: Vehicle; seat: number }[] = [];
  private px = 0; private py = 0;
  private boarding = new Map<Npc, Vehicle>();
  private closeDoors: { v: Vehicle; i: number; t: number }[] = [];
  private hurtAt = new WeakMap<Npc, number>();
  private v1 = new THREE.Vector3(); private v2 = new THREE.Vector3();
  constructor(private g: Game) { }

  /** The player's own car (last one driven) when it is close enough to put somebody in. */
  carNearby(): Vehicle | null {
    const g = this.g, p = g.player.pos;
    const v = g.lastPlayerVehicle;
    if (v && !v.destroyed && v.position.distanceTo(p) < 16 && v.tpl.seats.length > 1 && !this.seated.some(s => s.v === v)) return v;
    return g.vehicles.nearest(p, 8, c => !c.destroyed && !c.driver && c.tpl.seats.length > 1 && !this.seated.some(s => s.v === c)) ?? null;
  }
  noteHurt(n: Npc) { this.hurtAt.set(n, this.g.time); }

  /** Who the player is addressing: the person under the gun, else the nearest civilian right in front, else a hostage in the car. */
  findTarget(): Npc | null {
    const g = this.g, p = g.player;
    for (const s of this.seated) if (s.n.alive && s.v.position.distanceTo(p.pos) < 7) return s.n;
    let best: Npc | null = null, bs = 1e9;
    const aimFrom = this.v1, aimDir = this.v2;
    const aimed = g.pcombat.armed && g.pcombat.aiming;
    if (aimed) g.cam.aimRay(aimFrom, aimDir);
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    for (const n of g.pop.npcs) {
      if (!n.alive || n.role !== 'civilian' || n.char.inVehicle || n.brain === 'inside' || n.brain === 'scripted' || n.brain === 'hostage' || n.far) continue;
      const dx = n.pos.x - p.pos.x, dz = n.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (aimed && d < 24) {
        const cx = n.pos.x - aimFrom.x, cy = n.pos.y + 1.2 - aimFrom.y, cz = n.pos.z - aimFrom.z;
        const along = cx * aimDir.x + cy * aimDir.y + cz * aimDir.z;
        if (along > 0) { const off = Math.hypot(cx - aimDir.x * along, cy - aimDir.y * along, cz - aimDir.z * along); if (off < 1.0 + along * 0.03 && off + along * 0.02 < bs) { bs = off + along * 0.02; best = n; } }
      }
      if (!best && d < 5.5 && d > 0.05 && (dx * fx + dz * fz) / d > 0.45 && d < bs) { bs = d; best = n; }
    }
    return best;
  }
  menuFor(n: Npc): { id: OrderId; label: string }[] {
    if (this.seated.some(s => s.n === n)) return [{ id: 'out', label: ORDER_LABEL.out }];
    const ids: OrderId[] = ['kneel', 'come', 'hands'];
    if (this.carNearby()) ids.push('car');
    ids.push('beat');
    return ids.map(id => ({ id, label: ORDER_LABEL[id] }));
  }

  update(dt: number, raw: number, blocked: boolean) {
    const g = this.g, inp = g.input, p = g.player;
    this.updateDoors(dt);
    this.updateBoarding();
    this.updateSeated();
    this.updateShield();
    const can = !blocked && !g.paused && p.alive && !g.playerVehicle && !g.playerHeli && !g.carEntry.active && !this.shield;
    if (this.open) {
      const look = inp.lookDelta(raw); this.px = Math.max(-90, Math.min(90, this.px + look.x)); this.py = Math.max(-90, Math.min(90, this.py + look.y));
      for (let i = 0; i < this.items.length; i++) if (inp.rawPressed(`Digit${i + 1}`)) { this.sel = i; this.finish(true); return; }
      const pick = radialPick(this.items.length, this.px, this.py); if (pick >= 0) this.sel = pick;
      if (!can || !this.target || !this.target.alive || this.target.pos.distanceTo(p.pos) > 30 || inp.rawPressed('Escape')) { this.finish(false); return; }
      if (!inp.held('orders')) { this.finish(true); return; }
      if (this.target.brain === 'surrender') this.target.stateT = Math.min(this.target.stateT, 0.35); // waits for the order
      g.fx?.showMenu(this.target.brain === 'hostage' ? 'Hostage' : 'Orders', this.items as MenuItem[], this.sel);
      return;
    }
    if (!inp.held('orders')) this.menuLatch = false;
    // key hint while aiming at somebody (the key is rebindable, so name it)
    if (can && !this.open && g.pcombat.armed && g.pcombat.aiming && !inp.held('orders') && (this.hintT -= dt) <= 0) {
      this.hintT = 0.3;
      if (this.findTarget()) g.fx?.say(`Hold ${promptCap(keyLabel(g.settings.bindings.orders[0] ?? 'KeyG'), g.settings.bindings)}  ·  give orders`, 500);
    }
    if (can && inp.held('orders') && !this.menuLatch) {
      const t = this.findTarget();
      if (t) { this.target = t; this.items = this.menuFor(t); this.sel = -1; this.px = this.py = 0; this.open = true; g.fx?.showMenu('Orders', this.items as MenuItem[], -1); }
    }
    if (can && !this.open && inp.justPressed('interact') && !g.interactPrompt()) this.tryGrab();
    else if (this.shield && !blocked && inp.justPressed('interact')) this.releaseShield(true);
  }
  private menuLatch = false;
  private hintT = 0;

  private finish(commit: boolean) {
    const g = this.g, t = this.target, it = this.items[this.sel];
    this.open = false; this.menuLatch = g.input.held('orders'); g.fx?.hideMenu();
    this.target = null;
    if (commit && t && it) this.give(it.id, t);
  }
  /** Gives an order (the menu, tests and scripts all come through here). Returns whether the person obeyed. */
  give(id: OrderId, n: Npc): boolean {
    const g = this.g, p = g.player;
    const ctx: ComplyCtx = {
      role: n.role, nerve: n.nerve, gunAimed: g.pcombat.armed && g.pcombat.aiming, gunOut: g.pcombat.armed, hurt: g.time - (this.hurtAt.get(n) ?? -99) < 20,
      heat: g.police.heat, dist: n.pos.distanceTo(p.pos),
    };
    const ok = Math.random() < complianceChance(id, ctx);
    if (id === 'out') { const s = this.seated.find(x => x.n === n); if (s) this.ejectSeated(s, true); return true; }
    if (n.activity || n.brain === 'idle') g.pop.runner.endAct(n);
    if (!ok) {
      g.fx?.say(NO[(Math.random() * NO.length) | 0]);
      n.brain = 'flee'; n.stateT = 0; n.fleeFrom.copy(p.pos); if (n.nerve < 0.35) n.callCops = true;
      return false;
    }
    g.fx?.say(id === 'beat' ? '“Going, going!”' : YES[(Math.random() * YES.length) | 0], 1500);
    if (id === 'beat') { n.brain = 'flee'; n.stateT = 0; n.fleeFrom.copy(p.pos); n.callCops = false; return true; }
    n.char.human.stopAction(); if (n.char.human.currentState === 'cower' || n.char.human.currentState === 'crouch') n.char.human.setState('loco');
    n.brain = 'ordered'; n.order = id === 'kneel' ? 'kneel' : id === 'hands' ? 'hands' : id === 'come' ? 'come' : 'car';
    n.orderT = 0; n.orderMax = id === 'kneel' ? 40 : 25; n.stateT = 0; n.persistent = true; n.callCops = false;
    if (id === 'car') {
      const v = this.carNearby();
      if (!v) { n.order = 'hands'; return true; }
      const side = v.doorIndex('right', 0) >= 0 ? -1 : 1;
      n.destPt = v.doorPoint(side as 1 | -1, new THREE.Vector3()); this.boarding.set(n, v);
      const di = v.doorIndex(side === -1 ? 'right' : 'left', 0); if (di >= 0) v.setDoor(di, 1);
    }
    return true;
  }

  // ------------------------------------------------------------------------------------------------ boarding / seated
  private updateBoarding() {
    for (const [n, v] of [...this.boarding]) {
      if (!n.alive || n.brain !== 'ordered' || v.destroyed) { this.boarding.delete(n); continue; }
      if (n.order === 'board' || (n.order === 'car' && n.destPt && n.pos.distanceTo(v.position) < 1.9)) { this.boarding.delete(n); this.seat(n, v); }
    }
  }
  /** Puts a person in the front passenger seat (or a rear one) of `v`. */
  seat(n: Npc, v: Vehicle): boolean {
    const g = this.g; if (!n.alive) return false;
    const used = new Set(this.seated.filter(s => s.v === v).map(s => s.seat));
    const free = [1, 2, 3].find(i => i < v.tpl.seats.length && !used.has(i));
    if (free === undefined) return false;
    const sl = v.seatLocal(free), side = sl.x > 0 ? 'left' : 'right', row = sl.z < -0.4 ? 1 : 0;
    let di = v.doorIndex(side, row as 0 | 1); if (di < 0) di = v.doorIndex(side, 0);
    if (di >= 0) { v.setDoor(di, 1); this.closeDoors.push({ v, i: di, t: 0.9 }); }
    if (n.brain === 'hostage') { n.char.heldBy = null; if (this.shield === n) this.shield = null; }
    n.persistent = true; n.order = ''; n.destPt = null; n.tag = 'hostage-seat';
    g.traffic.seat(n, v, free);
    n.char.human.stopAction();
    this.seated.push({ n, v, seat: free });
    g.fx?.say('Hostage on board', 1400);
    return true;
  }
  private ejectSeated(s: { n: Npc; v: Vehicle; seat: number }, ordered: boolean) {
    const g = this.g, { n, v } = s;
    this.seated.splice(this.seated.indexOf(s), 1);
    n.tag = '';
    const side = n.char.human.root.position.x >= 0 ? 1 : -1;
    const di = v.doorIndex(side === 1 ? 'left' : 'right', 0); if (di >= 0) { v.setDoor(di, 1); this.closeDoors.push({ v, i: di, t: 1.2 }); }
    g.traffic.ejectPassenger(n, v);
    if (ordered && n.alive) { n.brain = 'ordered'; n.order = 'hands'; n.orderT = 0; n.orderMax = 7; n.stateT = 0; }
    else n.persistent = false;
  }
  private updateSeated() {
    for (const s of [...this.seated]) {
      const { n, v } = s;
      if (!n.alive || n.disposed || n.char.inVehicle !== v) { this.seated.splice(this.seated.indexOf(s), 1); n.tag = ''; continue; }
      if (v.destroyed) this.ejectSeated(s, false);
    }
  }
  private updateDoors(dt: number) {
    for (const d of [...this.closeDoors]) if ((d.t -= dt) <= 0) { d.v.setDoor(d.i, 0); this.closeDoors.splice(this.closeDoors.indexOf(d), 1); }
  }

  // ------------------------------------------------------------------------------------------------ human shield
  tryGrab(): boolean {
    const g = this.g, p = g.player;
    let best: Npc | null = null, bd = 1.6;
    const fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
    for (const n of g.pop.npcs) {
      if (!n.alive || n.role !== 'civilian' || n.char.inVehicle || n.far || n.brain === 'inside' || n.brain === 'scripted' || n.brain === 'passenger' || n.brain === 'hostage' || n.brain === 'fight') continue;
      const dx = n.pos.x - p.pos.x, dz = n.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (d > bd || (dx * fx + dz * fz) / (d || 1) < 0.3) continue; // in front of the player
      const behind = (Math.sin(n.char.yaw) * -dx + Math.cos(n.char.yaw) * -dz) / (d || 1) < -0.2; // the person is facing away
      if (n.brain === 'ordered' || behind || n.brain === 'cower' || n.brain === 'surrender') { best = n; bd = d; }
    }
    if (!best) return false;
    this.grab(best); return true;
  }
  grab(n: Npc) {
    const g = this.g;
    if (this.shield) this.releaseShield(false);
    if (n.activity || n.brain === 'idle') g.pop.runner.endAct(n);
    n.char.human.stopAction(); n.char.human.setState('loco');
    n.brain = 'hostage'; n.order = ''; n.stateT = 0; n.persistent = true; n.callCops = false; n.char.heldBy = g.player;
    this.shield = n;
    g.police.report('assault', g.player.pos);
    g.fx?.say('Human shield  ·  E to let go', 1800);
  }
  releaseShield(shove: boolean) {
    const n = this.shield; if (!n) return;
    const g = this.g, p = g.player;
    this.shield = null; n.char.heldBy = null; n.persistent = false; n.stateT = 0;
    n.char.human.stopAction('hands_up');
    n.brain = 'flee'; n.fleeFrom.copy(p.pos);
    if (shove && n.alive) { const dx = n.pos.x - p.pos.x, dz = n.pos.z - p.pos.z, d = Math.hypot(dx, dz) || 1; n.char.hitReact(dx / d, dz / d, 0.5); }
  }
  private updateShield() {
    const n = this.shield; if (!n) return;
    const g = this.g;
    if (!n.alive || n.disposed || !g.player.alive) { this.releaseShield(false); return; }
    if (g.playerVehicle) { // driving off with somebody in front of you: they ride along
      const v = g.playerVehicle;
      if (!this.seat(n, v)) this.releaseShield(false);
    }
  }
  /** True when an officer at `from` has no hostage in the way of the player (clear shot), or no hostage is held. */
  clearShot(from: THREE.Vector3): boolean {
    const n = this.shield; if (!n) return true;
    const p = this.g.player;
    const a = this.v1.set(p.pos.x - from.x, 0, p.pos.z - from.z), b = this.v2.set(n.pos.x - from.x, 0, n.pos.z - from.z);
    const al = a.length(); if (al < 0.01) return false;
    const along = b.dot(a) / al; if (along <= 0 || along > al) return true;
    const lateral = Math.hypot(b.x - a.x / al * along, b.z - a.z / al * along);
    return lateral > 0.55; // the hostage stands in the line of fire: hold
  }
  /** Drops everything (respawn). */
  reset() {
    if (this.shield) this.releaseShield(false);
    this.open = false; this.target = null; this.g.fx?.hideMenu();
  }
}
