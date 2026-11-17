/**
 * Store hold-ups: street kiosks with a clerk behind the counter. Point a gun at the clerk to start a hold-up,
 * keep them covered while they empty the till, then grab the cash bag before the police arrive.
 */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI, MinimapBlip } from '../ui/contracts';
import type { Npc } from '../actors/npc';
import { STORES, type Store } from './places';

type Phase = 'open' | 'robbing' | 'closed';
interface Kiosk {
  def: Store; root: THREE.Group; shutter: THREE.Mesh; clerk: Npc | null; phase: Phase;
  progress: number; cash: number; uncoveredT: number; reopenAt: number; alarmT: number; pickT: number; brave: boolean;
  front: THREE.Vector3; clerkPos: THREE.Vector3;
}
const W = 4.2, D = 2.6, H = 3.1;
const ROB_TIME = 7; // seconds of covering the clerk to empty the till
const REOPEN = 240; // seconds until a robbed store reopens

/** A sign texture with the store name on a coloured band. */
function signTexture(name: string, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 512; c.height = 96;
  const g = c.getContext('2d')!;
  g.fillStyle = color; g.fillRect(0, 0, 512, 96);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, 78, 512, 18);
  g.fillStyle = '#fff8ec'; g.font = '800 54px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(name.toUpperCase(), 256, 44, 480);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}

export class Robberies {
  kiosks: Kiosk[] = [];
  private active: Kiosk | null = null;
  private lastClip = -1;
  private boostT = 0;
  constructor(private game: Game, private ui: GameUI, groundY: (x: number, z: number) => number) {
    const wall = new THREE.MeshStandardMaterial({ color: '#efe6d6', roughness: 0.8 });
    const counterMat = new THREE.MeshStandardMaterial({ color: '#5a4636', roughness: 0.7 });
    const shutterMat = new THREE.MeshStandardMaterial({ color: '#8f969b', roughness: 0.5, metalness: 0.4 });
    const glow = new THREE.MeshBasicMaterial({ color: '#fff1d0', toneMapped: false });
    for (const def of STORES) {
      const root = new THREE.Group();
      const y0 = groundY(def.x, def.z);
      root.position.set(def.x, y0, def.z); root.rotation.y = def.yaw;
      const awningMat = new THREE.MeshStandardMaterial({ color: def.color, roughness: 0.6 });
      const box = (w: number, h: number, d: number, x: number, y: number, z: number, m: THREE.Material) => { const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mesh.position.set(x, y, z); mesh.castShadow = true; mesh.receiveShadow = true; root.add(mesh); return mesh; };
      // local frame: +z is the customer side
      box(W, H, 0.2, 0, H / 2, -D / 2, wall); // back wall
      box(0.2, H, D, -W / 2, H / 2, 0, wall); box(0.2, H, D, W / 2, H / 2, 0, wall); // sides
      box(W + 0.3, 0.18, D + 1.4, 0, H + 0.09, 0.5, awningMat); // roof + awning
      box(W, 1.05, 0.5, 0, 0.525, D / 2 - 0.25, counterMat); // counter
      box(W + 0.02, 0.9, 0.04, 0, 0.5, D / 2 + 0.01, awningMat); // branded counter front
      box(0.24, 1.0, D + 0.02, -W / 2, 0.5, 0, awningMat); box(0.24, 1.0, D + 0.02, W / 2, 0.5, 0, awningMat); // branded skirts
      box(W, 0.06, 0.62, 0, 1.08, D / 2 - 0.25, wall); // counter top
      box(W - 0.6, 0.5, 0.35, 0, 1.6, -D / 2 + 0.3, awningMat); // shelf of goods
      const tex = signTexture(def.name, def.color);
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.75), new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.6 }));
      sign.position.set(0, H + 0.6, D / 2 + 1.0); root.add(sign);
      const signBack = new THREE.Mesh(new THREE.BoxGeometry(W, 0.75, 0.08), awningMat); signBack.position.set(0, H + 0.6, D / 2 + 0.95); root.add(signBack);
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(W - 0.8, 0.05, 0.15), glow); lamp.position.set(0, H - 0.05, 0.2); root.add(lamp);
      const shutter = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 1.6, 0.06), shutterMat); shutter.position.set(0, 1.9, D / 2 - 0.05); shutter.visible = false; root.add(shutter);
      game.renderer.scene.add(root);
      // colliders (world space)
      const add = (lx: number, ly: number, lz: number, hx: number, hy: number, hz: number) => {
        const p = new THREE.Vector3(lx, ly, lz).applyAxisAngle(new THREE.Vector3(0, 1, 0), def.yaw).add(root.position);
        game.physics.addStaticBox(p.x, p.y, p.z, hx, hy, hz, def.yaw);
      };
      add(0, H / 2, -D / 2, W / 2, H / 2, 0.1); add(-W / 2, H / 2, 0, 0.1, H / 2, D / 2); add(W / 2, H / 2, 0, 0.1, H / 2, D / 2);
      add(0, 0.55, D / 2 - 0.25, W / 2, 0.55, 0.25);
      const front = new THREE.Vector3(Math.sin(def.yaw), 0, Math.cos(def.yaw));
      const clerkPos = new THREE.Vector3(0, 0, -0.35).applyAxisAngle(new THREE.Vector3(0, 1, 0), def.yaw).add(root.position);
      this.kiosks.push({ def, root, shutter, clerk: null, phase: 'open', progress: 0, cash: 0, uncoveredT: 0, reopenAt: 0, alarmT: 0, pickT: 0, brave: false, front, clerkPos });
    }
  }
  blips(): MinimapBlip[] { return this.kiosks.map(k => ({ x: k.def.x, z: k.def.z, kind: 'shop' as const, label: k.phase === 'closed' ? `${k.def.name} (closed)` : k.def.name })); }
  get robbing() { return !!this.active; }
  /** Contextual prompt near an open store. */
  prompt(): string | null {
    const g = this.game; if (g.playerVehicle || this.active) return null;
    for (const k of this.kiosks) {
      if (k.phase !== 'open' || !k.clerk?.alive) continue;
      if (this.customerDist(k) < 7) return g.pcombat.armed ? `Aim at the clerk to hold up ${k.def.name}` : `${k.def.name}  ·  draw a gun to hold it up`;
    }
    return null;
  }
  /** Distance from the player to the counter, or Infinity when they are behind/beside the booth. */
  private customerDist(k: Kiosk) {
    const p = this.game.player.pos, dx = p.x - k.def.x, dz = p.z - k.def.z;
    if (dx * k.front.x + dz * k.front.z < 0.8) return Infinity;
    return Math.hypot(dx, dz);
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
    if (n.alive && n.brain === 'scripted') { n.brain = 'wander'; n.node = -1; n.char.human.setState('loco'); }
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
  update(dt: number) {
    const g = this.game, t = g.time, p = g.player.pos;
    for (const k of this.kiosks) {
      const dist = Math.hypot(p.x - k.def.x, p.z - k.def.z);
      // shutters
      if (k.phase === 'closed' && t > k.reopenAt && dist > 60) { k.phase = 'open'; k.shutter.visible = false; }
      // a clerk staffs every open store the player is near
      if (k.phase === 'open' && dist < 110 && (!k.clerk || (!k.clerk.alive && dist > 60))) { if (k.clerk) this.releaseClerk(k); this.spawnClerk(k); }
      if (k.clerk && dist > 140 && k !== this.active) this.releaseClerk(k);
      if (k.phase === 'open' && k.clerk && !k.clerk.alive) { this.close(k); }
      if (k.phase === 'open' && k.clerk?.alive && k !== this.active && this.covering(k) && !g.inputBlocked) this.begin(k);
    }
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
      const bag = new THREE.Vector3(0, 0.9, 1.75).applyAxisAngle(new THREE.Vector3(0, 1, 0), k.def.yaw).add(k.root.position);
      g.spawnPickup('cash', k.def.cash, bag);
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
    k.phase = 'closed'; k.reopenAt = this.game.time + REOPEN; k.shutter.visible = true;
    const n = k.clerk;
    if (n?.alive && n.role === 'civilian') { n.brain = 'cower'; n.stateT = 0; }
    if (n) { n.persistent = false; k.clerk = null; }
  }
  /** Abandons any hold-up (mission start, death, loading). */
  reset() { if (this.active) { const k = this.active; this.active = null; this.ui.robberyMeter(null); this.close(k); } }
}
