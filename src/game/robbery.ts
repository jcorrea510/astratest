/**
 * Store hold-ups: street kiosks with a clerk behind the counter. Point a gun at the clerk to start a hold-up,
 * keep them covered while they empty the till, then grab the cash bag before the police arrive.
 */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI, MinimapBlip } from '../ui/contracts';
import type { Npc } from '../actors/npc';
import { STORES, STORE_W, STORE_D, type Store } from './places';
import { buildStoreShell, storeFrame, type StoreShell, type StoreFrame } from '../world/interiors';
import { CURB_HEIGHT } from '../world/citymap';
import { StoreExtras, newEx, type ExState, type Host } from './storeExtras';
import { aisleWaypoint, newLife, queueSpot, PAY_SPOT, DOOR_IN, DOOR_OUT, WALK_SPEED, type ShopLife } from './storeLife';

type Phase = 'open' | 'robbing' | 'closed';
export interface Kiosk {
  /** extras state (clerk knock-out, aim reactions, bank heist) */ ex: ExState;
  def: Store; /** interior is built lazily when the camera comes near */ shell: StoreShell | null; frame: StoreFrame; pos: THREE.Vector3; clerk: Npc | null; phase: Phase;
  progress: number; cash: number; uncoveredT: number; reopenAt: number; alarmT: number; pickT: number; brave: boolean;
  /** direction the counter faces (towards customers) */
  front: THREE.Vector3; clerkPos: THREE.Vector3; customer: THREE.Vector3; door: number;
  /** shoppers wandering the aisles (2-5), their reactions and the register state when the clerk is out of the picture */
  shoppers: Shopper[]; /** seconds until the next shopper walks in */ refillT: number; clerkT: number; clerkTurn: number; panicT: number; callT: number; called: boolean; looting: number; looted: boolean;
}
export interface Shopper { n: Npc; act: 'browse' | 'handsUp' | 'cower' | 'flee' | 'out'; caller: boolean; delay: number; life: ShopLife; /** game time the hands went up */ upAt?: number }
const _v0 = new THREE.Vector3();
const ROB_TIME = 7; // seconds of covering the clerk to empty the till
const REOPEN = 240; // seconds until a robbed store reopens

export class Robberies {
  kiosks: Kiosk[] = [];
  active: Kiosk | null = null;
  extras: StoreExtras;
  private lastClip = -1;
  private boostT = 0;
  private light = new THREE.PointLight(0xfff2dc, 0, 14, 1.4);
  constructor(private game: Game, private ui: GameUI, groundY: (x: number, z: number) => number) {
    game.renderer.scene.add(this.light);
    this.extras = new StoreExtras(game, ui, this as unknown as Host);
    for (const def of STORES) {
      void groundY; // stores sit on the pavement (a raycast would hit the floors above)
      const frame = storeFrame(def, CURB_HEIGHT);
      const front = new THREE.Vector3(Math.sin(def.yaw), 0, Math.cos(def.yaw));
      this.kiosks.push({ ex: newEx(), def, shell: null, frame, pos: new THREE.Vector3(def.x, 0, def.z), clerk: null, phase: 'open', progress: 0, cash: 0, uncoveredT: 0, reopenAt: 0, alarmT: 0, pickT: 0, brave: false, shoppers: [], refillT: 8, clerkT: 4, clerkTurn: 0, panicT: -1, callT: 0, called: false, looting: 0, looted: false, front, clerkPos: frame.clerk, customer: frame.customer, door: 0 });
    }
  }
  blips(): MinimapBlip[] { return this.kiosks.map(k => ({ x: k.def.x, z: k.def.z, kind: (k.def.kind === 'barber' ? 'barber' : k.def.kind === 'clothing' ? 'clothing' : 'shop') as 'shop' | 'barber' | 'clothing', label: k.phase === 'closed' ? `${k.def.name} (closed)` : k.def.name })); }
  get robbing() { return !!this.active; }
  /** The store the player is standing in, if any. */
  inside(): Kiosk | null {
    const p = this.game.player.pos;
    for (const k of this.kiosks) { const l = k.frame.toLocal(p); if (Math.abs(l.x) < STORE_W / 2 && Math.abs(l.z) < STORE_D / 2 && l.y > -1 && l.y < 4) return k; }
    return null;
  }
  /** Contextual prompt inside an open store. */
  prompt(): string | null {
    const g = this.game; if (g.playerVehicle || this.active) return null;
    { const x = this.extras.prompt(); if (x) return x; }
    for (const k of this.kiosks) {
      if (k.phase !== 'open' || !k.clerk?.alive) continue;
      if (this.customerDist(k) < 7) return g.pcombat.armed ? `Aim at the clerk to hold up ${k.def.name}` : `${k.def.name}  ·  draw a gun to hold it up`;
    }
    return null;
  }
  /** Distance from the player to the counter when on the customer side inside the store (or in the doorway), else Infinity. */
  private customerDist(k: Kiosk) {
    const l = k.frame.toLocal(this.game.player.pos);
    if (Math.abs(l.x) > STORE_W / 2 + 0.5 || l.z > STORE_D / 2 + 1.5 || l.z < k.frame.counterZ + 0.3 || l.y < -1.5 || l.y > 4) return Infinity;
    return Math.hypot(l.x + 3.0, l.z - k.frame.counterZ);
  }
  private spawnShoppers(k: Kiosk) {
    const g = this.game, cnt = 2 + Math.floor(Math.random() * 4), f = k.frame;
    for (let i = 0; i < cnt; i++) {
      const lx = -4.3 + Math.random() * 6.2, lz = 2.4 + Math.random() * 1.7, p = f.toWorld(lx, 0.05, lz);
      const n = g.pop.spawn('civilian', p.x, p.z, p.y);
      n.persistent = true; n.brain = 'scripted'; n.tag = 'shopper'; n.char.yaw = Math.random() * 6.28;
      n.char.human.setState(Math.random() < 0.5 ? 'talk' : 'loco'); n.char.human.setSpeed(0);
      k.shoppers.push({ n, act: 'browse', caller: i === 0 && cnt > 2 && Math.random() < 0.8, delay: Math.random() * 0.7, life: newLife('walk', Math.random) });
    }
  }
  /** Everyone in the store notices trouble: shots, a hold-up, a body behind the counter. */
  panic(k: Kiosk, aim = false) {
    if (k.panicT >= 0) return;
    k.panicT = 0; if (!aim) k.alarmT = Math.max(k.alarmT, 0.01);
    const g = this.game;
    let i = 0;
    for (const s of k.shoppers) {
      if (!s.n.alive) continue;
      const r = i++ % 3; s.n.char.human.stopAction();
      s.act = aim ? 'handsUp' : r === 0 ? 'handsUp' : r === 1 ? 'cower' : 'flee';
      s.upAt = g.time; s.delay = aim ? Math.random() * 0.45 : s.delay;
      if (s.caller && !aim) s.act = 'cower';
    }
    if (!aim) g.audio.play('heatUp', { pos: k.pos, volume: 0.7 });
  }
  private updateShoppers(k: Kiosk, dt: number, dist: number) {
    const g = this.game;
    // shoppers removed from the population elsewhere (despawn, tests, sandbox clean-up) have a disposed body: drop them
    if (k.shoppers.some(s => !g.pop.npcs.includes(s.n))) k.shoppers = k.shoppers.filter(s => g.pop.npcs.includes(s.n));
    if (k.phase === 'open' && dist < 60 && k.shoppers.length === 0 && !k.looted) this.spawnShoppers(k);
    if (dist > 140) { for (const s of k.shoppers) { s.n.persistent = false; if (s.n.alive) s.n.brain = 'wander'; } k.shoppers = []; k.panicT = -1; k.called = false; k.looted = false; return; }
    if (k.panicT >= 0) {
      k.panicT += dt;
      // one shopper calls 911 a few seconds in, if they are alive and still in the store
      const caller = k.shoppers.find(s => s.caller && s.n.alive);
      if (caller && !k.called && k.panicT > 3.5) {
        k.called = true; caller.n.char.human.playAction('point');
        g.police.report('robbery', new THREE.Vector3(k.def.x, 0, k.def.z)); this.ui.toast('Someone inside called 911', 'heat');
      }
    }
    const door = k.frame.toWorld(3.1, 0.05, 4.2), out = k.frame.toWorld(3.1, 0.05, 8.5);
    for (const s of k.shoppers) {
      const n = s.n, c = n.char; if (!n.alive) continue;
      if (s.act === 'browse') { this.browse(k, s, dt); continue; }
      if (s.act === 'out') continue;
      if (s.delay > 0) { s.delay -= dt; continue; }
      const h = c.human;
      if (s.act === 'handsUp') {
        c.faceTowards(Math.atan2(g.player.pos.x - c.pos.x, g.player.pos.z - c.pos.z), 8, dt);
        if (h.actionName !== 'hands_up') h.playAction('hands_up', { hold: true });
        if (k.panicT > 9 && dist > 12) s.act = 'flee';
        // shots fired in the store: nobody keeps their hands up waiting for the next one
        if (g.time - n.shotAt < 1.5 && n.shotAt > (s.upAt ?? 0)) { h.stopAction('hands_up'); s.act = Math.random() < 0.25 ? 'cower' : 'flee'; }
      } else if (s.act === 'cower') {
        if (h.currentState !== 'cower') h.setState('cower');
        if (k.panicT > 14 && dist > 14) { h.setState('loco'); s.act = 'flee'; }
      } else if (s.act === 'flee') {
        if (h.actionName === 'hands_up') h.stopAction('hands_up');
        if (h.currentState !== 'loco') h.setState('loco');
        const tgt = c.pos.distanceTo(door) < 1.2 || (k.frame.toLocal(c.pos).z > 4.4) ? out : door;
        const dx = tgt.x - c.pos.x, dz = tgt.z - c.pos.z, d = Math.hypot(dx, dz);
        if (d < 1.0 && tgt === out) { s.act = 'out'; n.brain = 'flee'; n.fleeFrom.copy(g.player.pos); n.stateT = 0; n.persistent = false; continue; }
        c.move(new THREE.Vector3(dx / d * 5.6, 0, dz / d * 5.6), dt); c.faceTowards(Math.atan2(dx, dz), 12, dt); h.setSpeed(c.speed);
      }
    }
  }
  /** Shopper daily life: walk the aisle, stop at the shelf and look, queue at the till, pay, leave. */
  private browse(k: Kiosk, s: Shopper, dt: number) {
    const f = k.frame, n = s.n, c = n.char, h = c.human, L = s.life;
    const lp = f.toLocal(c.pos);
    const goTo = (x: number, z: number, speed: number, tol: number) => { // steer towards a store-local point; true on arrival
      const tw = f.toWorld(x, 0.05, z), dx = tw.x - c.pos.x, dz = tw.z - c.pos.z, d = Math.hypot(dx, dz);
      if (d < tol) { c.move(_v0.set(0, 0, 0), dt); h.setSpeed(c.speed); return true; }
      if (h.currentState !== 'loco') h.setState('loco');
      c.move(_v0.set(dx / d * speed, 0, dz / d * speed), dt); c.faceTowards(Math.atan2(dx, dz), 7, dt); h.setSpeed(c.speed);
      if (Math.abs(d - L.lastD) < 0.4 * dt) L.stuck += dt; else L.stuck = 0; // wedged on a fixture: pick another point
      L.lastD = d; return false;
    };
    const faceLocal = (dx: number, dz: number) => { const a = f.toWorld(lp.x, 0, lp.z), b = f.toWorld(lp.x + dx, 0, lp.z + dz); c.faceTowards(Math.atan2(b.x - a.x, b.z - a.z), 6, dt); };
    const idle = () => { if (h.currentState !== 'loco') h.setState('loco'); c.move(_v0.set(0, 0, 0), dt); h.setSpeed(0); };
    switch (L.st) {
      case 'walk': {
        if (!L.wx && !L.wz) { const w = aisleWaypoint(Math.random, lp); L.wx = w.x; L.wz = w.z; L.stuck = 0; }
        if (goTo(L.wx, L.wz, WALK_SPEED, 0.35)) { L.st = 'look'; L.t = 2.2 + Math.random() * 3; L.wx = L.wz = 0; h.playAction('Interact', { layer: 'upper', fade: 0.25 }); }
        else if (L.stuck > 1.2) { L.wx = L.wz = 0; }
        break;
      }
      case 'look': { // face the shelf, handle the goods
        idle(); faceLocal(0, -1); L.t -= dt;
        if (L.t <= 0) {
          h.stopAction('Interact');
          const queued = k.shoppers.filter(q => q.act === 'browse' && (q.life.st === 'queue' || q.life.st === 'pay')).length;
          if (L.buys && queued < 3 && k.clerk?.alive) { L.st = 'queue'; L.arrive = this.game.time; L.wx = L.wz = 0; }
          else if (Math.random() < 0.3) { L.st = 'leave'; }
          else { L.st = 'walk'; }
        }
        break;
      }
      case 'queue': {
        const line = k.shoppers.filter(q => q.act === 'browse' && (q.life.st === 'queue' || q.life.st === 'pay')).sort((a, b) => a.life.arrive - b.life.arrive);
        const idx = Math.max(0, line.indexOf(s)), spot = idx === 0 ? PAY_SPOT : queueSpot(idx - 1);
        if (goTo(spot.x, spot.z, WALK_SPEED, 0.3)) {
          idle(); faceLocal(idx === 0 ? 0 : -1, idx === 0 ? -1 : -0.3);
          if (idx === 0) { L.st = 'pay'; L.t = 3.5; h.playAction('Interact', { layer: 'upper', fade: 0.25 }); }
        }
        break;
      }
      case 'pay': {
        idle(); faceLocal(0, -1); L.t -= dt;
        if (L.t <= 0) { h.stopAction('Interact'); L.st = 'leave'; }
        break;
      }
      case 'leave': {
        const past = lp.z > 4.4;
        const tgt = past ? DOOR_OUT : DOOR_IN;
        if (goTo(tgt.x, tgt.z, WALK_SPEED * 1.15, past ? 0.8 : 0.5) && past) {
          s.act = 'out'; n.persistent = false; n.brain = 'wander'; n.node = -1; h.setState('loco'); // strolls off down the pavement
          k.shoppers.splice(k.shoppers.indexOf(s), 1); k.refillT = Math.min(k.refillT, 3 + Math.random() * 8);
        }
        break;
      }
      case 'enter': {
        if (lp.z <= 4.0 || goTo(DOOR_IN.x, DOOR_IN.z, WALK_SPEED * 1.15, 0.5)) { L.st = 'walk'; L.wx = L.wz = 0; }
        break;
      }
    }
  }
  /** Clerk keeps busy behind the counter: serves whoever is paying, otherwise tidies the back shelf every so often. */
  private clerkLife(k: Kiosk, dt: number) {
    const n = k.clerk; if (!n?.alive || k.ex.koT > 0) return;
    const c = n.char, h = c.human, f = k.frame;
    const paying = k.shoppers.some(q => q.act === 'browse' && q.life.st === 'pay');
    k.clerkT -= dt;
    if (paying && k.clerkTurn !== 2) { k.clerkTurn = 2; k.clerkT = 3.2; h.playAction('Interact', { layer: 'upper', fade: 0.25 }); }
    else if (!paying && k.clerkTurn === 2) { k.clerkTurn = 0; k.clerkT = 3 + Math.random() * 4; h.stopAction('Interact'); }
    if (k.clerkTurn === 0 && k.clerkT <= 0) { k.clerkTurn = 1; k.clerkT = 3 + Math.random() * 2; h.playAction('Interact', { layer: 'upper', fade: 0.25 }); }
    else if (k.clerkTurn === 1 && k.clerkT <= 0) { k.clerkTurn = 0; k.clerkT = 5 + Math.random() * 7; h.stopAction('Interact'); }
    const yaw = k.def.yaw + (k.clerkTurn === 1 ? Math.PI * 0.85 : 0);
    c.faceTowards(yaw, 5, dt); void f;
  }
  /** A new shopper walks in from the pavement once someone has left. */
  private refill(k: Kiosk, dt: number) {
    if (k.shoppers.length >= 2 || k.panicT >= 0 || k.phase !== 'open') return;
    k.refillT -= dt; if (k.refillT > 0) return;
    k.refillT = 10 + Math.random() * 12;
    const g = this.game, p = k.frame.toWorld(DOOR_OUT.x, 0.05, DOOR_OUT.z + 0.5);
    const n = g.pop.spawn('civilian', p.x, p.z, p.y);
    n.persistent = true; n.brain = 'scripted'; n.tag = 'shopper'; n.char.human.setState('loco'); n.char.human.setSpeed(0);
    k.shoppers.push({ n, act: 'browse', caller: false, delay: 0, life: newLife('enter', Math.random) });
  }
  private spawnClerk(k: Kiosk) {
    const g = this.game, c = k.clerkPos;
    const n = g.pop.spawn('civilian', c.x, c.z, c.y + 0.05);
    n.persistent = true; n.brain = 'scripted'; n.char.yaw = k.def.yaw; n.char.human.setState('talk'); n.tag = 'clerk';
    k.clerk = n; k.brave = Math.random() < 0.12;
  }
  private releaseClerk(k: Kiosk) {
    const n = k.clerk; if (!n) return; k.clerk = null; k.ex.koT = 0; k.ex.hp = -1;
    n.persistent = false;
    if (n.alive && n.brain === 'scripted') { g_remove(this.game, n); }
  }
  /** True when the camera is pointing at the clerk and the player holds a gun up. */
  private covering(k: Kiosk): boolean {
    const g = this.game, n = k.clerk; if (!n?.alive || k.ex.koT > 0 || !g.pcombat.armed || !g.pcombat.aiming || g.playerVehicle) return false;
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
    let built = 0;
    for (const k of this.kiosks) {
      const d = Math.hypot(k.def.x - cp.x, k.def.z - cp.z);
      if (!k.shell && d < 125 && built < 1) { k.shell = buildStoreShell(this.game.renderer.scene, this.game.physics, k.def, CURB_HEIGHT); built++; } // one per frame: no hitch
      if (k.shell) k.shell.root.visible = d < 110;
    }
  }
  /** Interiors built so far (they are created on approach). */
  get builtCount() { return this.kiosks.filter(k => k.shell).length; }
  update(dt: number, missionActive = false) {
    this.cull();
    const g = this.game, t = g.time, p = g.player.pos;
    if (missionActive && this.active) this.reset();
    const insideK = this.inside();
    for (const k of this.kiosks) {
      const dist = Math.hypot(p.x - k.def.x, p.z - k.def.z);
      // shutters come down once the player has left a robbed store; it reopens later
      if (k.phase === 'closed' && t > k.reopenAt && dist > 60) { k.phase = 'open'; k.shell?.setClosed(false); this.extras.reset(k); k.panicT = -1; k.called = false; k.looted = false; k.alarmT = 0; for (const s of k.shoppers) { s.n.persistent = false; if (s.n.alive && s.n.brain === 'scripted') s.n.brain = 'wander'; } k.shoppers = []; }
      const sh = k.shell;
      if (sh) {
        const closedNow = k.phase === 'closed' && dist > 9;
        if (closedNow !== sh.shutter.visible) sh.setClosed(closedNow);
        // automatic sliding doors
        const near = dist < 8.5 && k.phase !== 'closed' || (k.phase === 'closed' && dist < 9 && !sh.shutter.visible);
        const door0 = k.door; k.door = THREE.MathUtils.clamp(k.door + (near ? dt : -dt) * 2.2, 0, 1);
        if ((door0 === 0) !== (k.door === 0) && dist < 20) (g.audio as unknown as { storeBell?: (p: THREE.Vector3) => void }).storeBell?.(k.pos); // R6-A door chime on open / shut
        sh.setDoor(k.door * k.door * (3 - 2 * k.door));
        sh.alarm.visible = k.alarmT > 0 && (k.phase === 'robbing' || k.panicT >= 0 || (k.phase === 'closed' && t < k.reopenAt - REOPEN + 40)) && Math.sin(t * 12) > 0;
      }
      // a clerk staffs every open store the player is near
      if (k.clerk && !g.pop.npcs.includes(k.clerk)) k.clerk = null; // removed elsewhere: its body is disposed
      if (k.phase === 'open' && dist < 110 && (!k.clerk || (!k.clerk.alive && dist > 60))) { if (k.clerk) this.releaseClerk(k); this.spawnClerk(k); }
      if (k.clerk && dist > 140 && k !== this.active) this.releaseClerk(k);
      if (k.phase === 'open' && k.clerk && !k.clerk.alive) this.panic(k);
      this.updateShoppers(k, dt, dist);
      if (k.phase === 'open' && dist < 70 && k !== this.active && k.panicT < 0) { this.clerkLife(k, dt); this.refill(k, dt); }
      if (k.phase === 'open' && k.panicT < 0 && k !== this.active && k.shoppers.length && g.pcombat.lastShot > this.shotClip[this.kiosks.indexOf(k)] && dist < 28) this.panic(k);
      this.shotClip[this.kiosks.indexOf(k)] = g.pcombat.lastShot;
      this.extras.update(k, dt, dist, insideK);
      if (k.phase === 'open' && k.clerk?.alive && k !== this.active && !missionActive && this.covering(k) && !g.inputBlocked) this.begin(k);
    }
    // one shared interior light follows the player into a store
    const inS = this.inside();
    if (inS) { this.light.position.copy(inS.frame.light); this.light.intensity = 9; } else this.light.intensity = 0;
    const k = this.active; if (!k) return;
    const n = k.clerk;
    // shots fired nearby make the clerk hurry
    const clip = g.pcombat.inv.state.clip;
    if (this.lastClip >= 0 && clip < this.lastClip) this.boostT = 1.5;
    this.lastClip = clip; this.boostT = Math.max(0, this.boostT - dt);
    if (!n?.alive) { this.active = null; this.ui.robberyMeter(null); this.game.audio.setMusicMood('none'); k.phase = 'open'; this.ui.toast('The clerk is down. Get behind the counter and clean out the register.', 'warning'); this.panic(k); return; }
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
    k.cash = Math.round(this.till(k) * k.progress);
    k.shell?.setDrawer(k.progress > 0.12 ? 1 : 0); k.shell?.setBills(1 - k.progress);
    this.ui.robberyMeter({ label: k.uncoveredT > 0 ? 'Keep the clerk covered!' : `Holding up ${k.def.name}`, progress: k.progress, cash: k.cash });
    if (k.progress >= 1) {
      k.shell?.burst(); this.extras.holdupDone(k);
      g.spawnPickup('cash', this.till(k), k.frame.bag.clone());
      n.char.human.setState('crouch');
      this.end(true, `Grab the cash: $${this.till(k)}`);
    }
  }
  private shotClip: number[] = [];
  private begin(k: Kiosk) {
    const g = this.game;
    this.active = k; k.phase = 'robbing'; k.progress = 0; k.uncoveredT = 0; k.alarmT = 0; k.pickT = 0.4; this.lastClip = g.pcombat.inv.state.clip;
    k.clerk!.char.yaw = k.def.yaw; k.clerk!.char.human.stopAction('hands_up'); k.ex.aimOnly = false; this.extras.holdupStarted(k);
    g.pop.danger(k.pos, 25, g.player); this.panic(k);
    this.ui.toast('Hold-up! Keep the clerk covered.', 'warning');
    g.audio.setMusicMood('tension');
  }
  /** Holdups completed this session (milestones). */
  completed = 0;
  /** A till's take: Regular mode pays 1.6x so that cars and guns are within reach of an honest criminal career. */
  mult() { return this.game.mode === 'regular' ? 1.6 : 1; }
  till(k: Kiosk) { return Math.round(k.def.cash * (this.game.mode === 'regular' ? 1.6 : 1)); }
  private end(success: boolean, msg: string | null) {
    const k = this.active; if (!k) return;
    if (success) this.completed++;
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
