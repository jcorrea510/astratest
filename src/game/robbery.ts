/**
 * Store hold-ups: street kiosks with a clerk behind the counter. Point a gun at the clerk to start a hold-up,
 * keep them covered while they empty the till, then grab the cash bag before the police arrive.
 */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI, MinimapBlip } from '../ui/contracts';
import type { Npc } from '../actors/npc';
import { STORES, STORE_W, STORE_D, type Store } from './places';
import { buildStoreShell, type StoreShell } from '../world/interiors';
import { CURB_HEIGHT } from '../world/citymap';

type Phase = 'open' | 'robbing' | 'closed';
interface Kiosk {
  def: Store; root: THREE.Group; shell: StoreShell; clerk: Npc | null; phase: Phase;
  progress: number; cash: number; uncoveredT: number; reopenAt: number; alarmT: number; pickT: number; brave: boolean;
  /** direction the counter faces (towards customers) */
  front: THREE.Vector3; clerkPos: THREE.Vector3; customer: THREE.Vector3; door: number;
}
const ROB_TIME = 7; // seconds of covering the clerk to empty the till
const REOPEN = 240; // seconds until a robbed store reopens

export class Robberies {
  kiosks: Kiosk[] = [];
  private active: Kiosk | null = null;
  private lastClip = -1;
  private boostT = 0;
  private light = new THREE.PointLight(0xfff2dc, 0, 14, 1.4);
  constructor(private game: Game, private ui: GameUI, groundY: (x: number, z: number) => number) {
    game.renderer.scene.add(this.light);
    for (const def of STORES) {
      void groundY; const y0 = CURB_HEIGHT; // stores sit on the pavement (a raycast would hit the floors above)
      const shell = buildStoreShell(game.renderer.scene, game.physics, def, y0);
      const front = new THREE.Vector3(Math.sin(def.yaw), 0, Math.cos(def.yaw));
      this.kiosks.push({ def, root: shell.root, shell, clerk: null, phase: 'open', progress: 0, cash: 0, uncoveredT: 0, reopenAt: 0, alarmT: 0, pickT: 0, brave: false, front, clerkPos: shell.clerk, customer: shell.customer, door: 0 });
    }
  }
  blips(): MinimapBlip[] { return this.kiosks.map(k => ({ x: k.def.x, z: k.def.z, kind: 'shop' as const, label: k.phase === 'closed' ? `${k.def.name} (closed)` : k.def.name })); }
  get robbing() { return !!this.active; }
  /** The store the player is standing in, if any. */
  inside(): Kiosk | null {
    const p = this.game.player.pos;
    for (const k of this.kiosks) { const l = k.shell.toLocal(p); if (Math.abs(l.x) < STORE_W / 2 && Math.abs(l.z) < STORE_D / 2 && l.y > -1 && l.y < 4) return k; }
    return null;
  }
  /** Contextual prompt inside an open store. */
  prompt(): string | null {
    const g = this.game; if (g.playerVehicle || this.active) return null;
    for (const k of this.kiosks) {
      if (k.phase !== 'open' || !k.clerk?.alive) continue;
      if (this.customerDist(k) < 7) return g.pcombat.armed ? `Aim at the clerk to hold up ${k.def.name}` : `${k.def.name}  ·  draw a gun to hold it up`;
    }
    return null;
  }
  /** Distance from the player to the counter when on the customer side inside the store (or in the doorway), else Infinity. */
  private customerDist(k: Kiosk) {
    const l = k.shell.toLocal(this.game.player.pos);
    if (Math.abs(l.x) > STORE_W / 2 + 0.5 || l.z > STORE_D / 2 + 1.5 || l.z < k.shell.counterZ + 0.3 || l.y < -1.5 || l.y > 4) return Infinity;
    return Math.hypot(l.x + 3.0, l.z - k.shell.counterZ);
  }
  private spawnClerk(k: Kiosk) {
    const g = this.game, c = k.clerkPos;
    const n = g.pop.spawn('civilian', c.x, c.z, c.y + 0.05);
    n.persistent = true; n.brain = 'scripted'; n.char.yaw = k.def.yaw; n.char.human.setState('talk'); n.tag = 'clerk';
    k.clerk = n; k.brave = Math.random() < 0.12;
  }
  private releaseClerk(k: Kiosk) {
    const n = k.clerk; if (!n) return; k.clerk = null;
    n.persistent = false;
    if (n.alive && n.brain === 'scripted') { g_remove(this.game, n); }
  }
  /** True when the camera is pointing at the clerk and the player holds a gun up. */
  private covering(k: Kiosk): boolean {
    const g = this.game, n = k.clerk; if (!n?.alive || !g.pcombat.armed || !g.pcombat.aiming || g.playerVehicle) return false;
    if (this.customerDist(k) > 13) return false;
    const cam = g.renderer.camera, dir = cam.getWorldDirection(new THREE.Vector3());
    const to = new THREE.Vector3(n.pos.x, n.pos.y + 1.25, n.pos.z).sub(cam.position);
    const d = to.length(); to.normalize();
    return dir.dot(to) > Math.cos(Math.min(0.5, Math.atan2(1.3, d) + 0.12));
  }
  /** missionActive: hold-ups are off during story missions (and one in progress is called off). */
  /** Store interiors (about 9 draw calls each) only render when the camera is near enough to see into them. */
  cull() {
    const cp = this.game.renderer.camera.position;
    for (const k of this.kiosks) k.root.visible = Math.hypot(k.def.x - cp.x, k.def.z - cp.z) < 110;
  }
  update(dt: number, missionActive = false) {
    this.cull();
    const g = this.game, t = g.time, p = g.player.pos;
    if (missionActive && this.active) this.reset();
    for (const k of this.kiosks) {
      const dist = Math.hypot(p.x - k.def.x, p.z - k.def.z);
      // shutters come down once the player has left a robbed store; it reopens later
      if (k.phase === 'closed' && t > k.reopenAt && dist > 60) { k.phase = 'open'; k.shell.setClosed(false); }
      const closedNow = k.phase === 'closed' && dist > 9;
      if (closedNow !== k.shell.shutter.visible) k.shell.setClosed(closedNow);
      // automatic sliding doors
      const near = dist < 8.5 && k.phase !== 'closed' || (k.phase === 'closed' && dist < 9 && !k.shell.shutter.visible);
      k.door = THREE.MathUtils.clamp(k.door + (near ? dt : -dt) * 2.2, 0, 1);
      k.shell.setDoor(k.door * k.door * (3 - 2 * k.door));
      k.shell.alarm.visible = k.alarmT > 0 && (k.phase === 'robbing' || (k.phase === 'closed' && t < k.reopenAt - REOPEN + 40)) && Math.sin(t * 12) > 0;
      // a clerk staffs every open store the player is near
      if (k.phase === 'open' && dist < 110 && (!k.clerk || (!k.clerk.alive && dist > 60))) { if (k.clerk) this.releaseClerk(k); this.spawnClerk(k); }
      if (k.clerk && dist > 140 && k !== this.active) this.releaseClerk(k);
      if (k.phase === 'open' && k.clerk && !k.clerk.alive) { this.close(k); }
      if (k.phase === 'open' && k.clerk?.alive && k !== this.active && !missionActive && this.covering(k) && !g.inputBlocked) this.begin(k);
    }
    // one shared interior light follows the player into a store
    const inS = this.inside();
    if (inS) { this.light.position.copy(inS.shell.light); this.light.intensity = 9; } else this.light.intensity = 0;
    const k = this.active; if (!k) return;
    const n = k.clerk;
    // shots fired nearby make the clerk hurry
    const clip = g.pcombat.inv.state.clip;
    if (this.lastClip >= 0 && clip < this.lastClip) this.boostT = 1.5;
    this.lastClip = clip; this.boostT = Math.max(0, this.boostT - dt);
    if (!n?.alive) { this.end(false, 'The clerk is down. The till stays shut.'); return; }
    if (g.deathT >= 0) { this.end(false, null); return; }
    k.alarmT += dt;
    if (k.alarmT > 3 && k.alarmT - dt <= 3) { g.police.alarm('robbery', new THREE.Vector3(k.def.x, 0, k.def.z)); this.ui.toast(`${k.def.name}: silent alarm tripped`, 'heat'); }
    if (k.brave && k.alarmT > 1.6 && n.role === 'civilian') {
      // this one keeps a pistol under the counter
      n.role = 'gang'; n.hostile = true; n.arm('pistol', g.renderer.scene); n.brain = 'combat'; n.target = g.player; n.seenTime = t; n.lastSeen.copy(p);
      this.ui.toast('The clerk pulled a gun!', 'warning');
      this.end(false, null); return;
    }
    if (this.covering(k)) {
      k.uncoveredT = 0;
      k.progress = Math.min(1, k.progress + dt / ROB_TIME * (this.boostT > 0 ? 1.8 : 1));
      k.pickT -= dt; if (k.pickT <= 0) { k.pickT = 1.3; n.char.human.playOnce('PickUp_Table', 'full', 0.15); g.audio.play('money', { pos: n.pos, volume: 0.4 }); }
    } else {
      k.uncoveredT += dt;
      if (k.uncoveredT > 2.5 || this.customerDist(k) > 16) { this.end(false, 'You let the clerk off the hook.'); return; }
    }
    k.cash = Math.round(k.def.cash * k.progress);
    this.ui.robberyMeter({ label: k.uncoveredT > 0 ? 'Keep the clerk covered!' : `Holding up ${k.def.name}`, progress: k.progress, cash: k.cash });
    if (k.progress >= 1) {
      g.spawnPickup('cash', k.def.cash, k.shell.bag.clone());
      n.char.human.setState('crouch');
      this.end(true, `Grab the cash: $${k.def.cash}`);
    }
  }
  private begin(k: Kiosk) {
    const g = this.game;
    this.active = k; k.phase = 'robbing'; k.progress = 0; k.uncoveredT = 0; k.alarmT = 0; k.pickT = 0.4; this.lastClip = g.pcombat.inv.state.clip;
    k.clerk!.char.yaw = k.def.yaw;
    g.pop.danger(k.root.position, 25, g.player);
    this.ui.toast('Hold-up! Keep the clerk covered.', 'warning');
    g.audio.setMusicMood('tension');
  }
  private end(success: boolean, msg: string | null) {
    const k = this.active; if (!k) return;
    this.active = null; this.ui.robberyMeter(null); this.game.audio.setMusicMood('none');
    if (msg) this.ui.toast(msg, success ? 'money' : 'warning');
    if (!success && k.alarmT <= 3 && k.clerk?.alive && k.clerk.role === 'civilian') { this.game.police.alarm('robbery', new THREE.Vector3(k.def.x, 0, k.def.z)); }
    this.close(k);
  }
  private close(k: Kiosk) {
    k.phase = 'closed'; k.reopenAt = this.game.time + REOPEN;
    const n = k.clerk;
    if (n?.alive && n.role === 'civilian') { n.brain = 'cower'; n.stateT = 0; }
    if (n) { n.persistent = false; k.clerk = null; }
  }
  /** Abandons any hold-up (mission start, death, loading). */
  reset() { if (this.active) { const k = this.active; this.active = null; this.ui.robberyMeter(null); this.close(k); } }
}

/** Sends a released clerk off to wander (or removes one stuck behind a counter far from the player). */
function g_remove(game: Game, n: Npc) { n.brain = 'wander'; n.node = -1; n.char.human.setState('loco'); void game; }
