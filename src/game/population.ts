/** Keeps the streets alive: spawns/despawns civilians, runs every NPC brain, and resolves danger and vehicle hits. */
import { pedImpact } from './impact';
import * as THREE from 'three';
import { Npc, NpcBrainRunner, streetClock, type NpcEnv, type Role } from '../actors/npc';
import { pedActivity, districtNightFactor } from './schedule';
import { randomLook, type HumanTemplate, type Look } from '../actors/human';
import type { CityMap } from '../world/citymap';
import { DISTRICT_INFO, districtAt } from '../world/citymap';
import type { Character } from '../actors/character';
import type { Vehicle } from '../vehicles/vehicle';
import type { WeaponId } from '../combat/weapons';
import type { GameAudio } from '../ui/contracts';

let LOOK_SEED = 1000;
export class Population {
  npcs: Npc[] = [];
  runner: NpcBrainRunner;
  maxCivilians = 22;
  /** world clock hour (set by the game each frame); drives crowd size, nightlife and idles */
  hour = 17;
  private lastSpeed = new WeakMap<Vehicle, number>(); private crashT = 0;
  prewarming = false;
  private spawnT = 0;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private cullSphere = new THREE.Sphere(); private cullCentre = new THREE.Vector3();
  onKilled: ((n: Npc, by: Character | null, how: 'shot' | 'melee' | 'vehicle' | 'explosion') => void) | null = null;
  constructor(private scene: THREE.Scene, private tpl: HumanTemplate, private city: CityMap, private env: NpcEnv, private audio: GameAudio) {
    this.runner = new NpcBrainRunner(env);
  }
  /** Where the player is pointing a gun (set by the game each frame; null when not aiming). */
  aimProvider: (() => { from: THREE.Vector3; dir: THREE.Vector3 } | null) | null = null;
  private reactT = 0;
  /** Civilians react to the player: brushing past ("Watch it!"), running into them, aiming a gun at them. */
  private reactToPlayer(dt: number) {
    this.reactT -= dt; if (this.reactT > 0) return;
    this.reactT = 0.1;
    const p = this.env.player; if (!p.alive || p.inVehicle) return;
    const aim = this.aimProvider?.() ?? null;
    for (const n of this.npcs) {
      if (!n.alive || n.char.inVehicle || n.brain === 'scripted' || n.brain === 'passenger' || n.brain === 'inside' || n.far) continue;
      const c = n.char, dx = c.pos.x - p.pos.x, dz = c.pos.z - p.pos.z, d = Math.hypot(dx, dz);
      if (n.role === 'civilian' && d < 1.05 && p.speed > 3.2 && n.brain !== 'flee' && n.brain !== 'cower' && n.brain !== 'surrender') {
        // shoulder-checked: stumble, glare
        if (d < 0.8 && p.speed > 5 && c.knockT <= 0) c.hitReact(dx, dz, 0.55);
        else c.yaw = Math.atan2(-dx, -dz);
      }
      if (aim && n.role === 'civilian' && d < 28 && n.brain !== 'surrender' && n.brain !== 'cower') {
        const cx = c.pos.x - aim.from.x, cy = c.pos.y + 1.2 - aim.from.y, cz = c.pos.z - aim.from.z;
        const along = cx * aim.dir.x + cy * aim.dir.y + cz * aim.dir.z;
        if (along > 0) {
          const off = Math.hypot(cx - aim.dir.x * along, cy - aim.dir.y * along, cz - aim.dir.z * along);
          if (off < 0.9 + along * 0.02) {
            if (n.brain !== 'flee' || d < 6) { n.brain = 'surrender'; n.stateT = 0; n.waitT = 2 + Math.random() * 2.5; }
          }
        }
      }
    }
  }
  private sirenT = 0; private tick = 0;
  /** The player drives a police car with the light bar on: pedestrians stop, step back from the road edge and watch it go by. */
  private reactToSiren(dt: number) {
    this.sirenT -= dt; if (this.sirenT > 0) return;
    this.sirenT = 0.25;
    const pv = this.env.player.inVehicle as { position: THREE.Vector3; siren?: boolean; sirenOn?: boolean; kind?: string } | null;
    if (!pv || !(pv.sirenOn ?? pv.siren) || !['police', 'fbi', 'swat', 'army'].includes(pv.kind ?? '')) return;
    const vp = pv.position;
    for (const n of this.npcs) {
      if (!n.alive || n.role !== 'civilian' || n.far || n.brain === 'inside' || n.char.inVehicle || n.brain === 'scripted' || n.brain === 'flee' || n.brain === 'cower' || n.brain === 'surrender') continue;
      const c = n.char, dx = c.pos.x - vp.x, dz = c.pos.z - vp.z, d = Math.hypot(dx, dz);
      if (d > 16) continue;
      if (n.brain === 'wander') { n.brain = 'idle'; n.stateT = 2; }
      if (n.brain === 'idle') { c.yaw = Math.atan2(-dx, -dz); if (d < 4 && d > 0.01) c.move(new THREE.Vector3(dx / d * 1.8, 0, dz / d * 1.8), 0.25, false); }
    }
  }
  spawn(role: Role, x: number, z: number, y = 0.2, look?: Look, weapon: WeaponId = 'fists'): Npc {
    const n = new Npc(this.env.physics, this.tpl, look ?? randomLook(LOOK_SEED++), role, x, z, y);
    this.scene.add(n.char.human.root);
    if (weapon !== 'fists') n.arm(weapon, this.scene);
    this.npcs.push(n);
    return n;
  }
  adopt(n: Npc) { this.scene.add(n.char.human.root); }
  remove(n: Npc) { const i = this.npcs.indexOf(n); if (i < 0) return; this.npcs.splice(i, 1); n.dispose(); }
  *characters(): Iterable<Character> { for (const n of this.npcs) if (n.brain !== 'inside') yield n.char; }
  /** Civilians in a radius react to danger (gunfire, explosions, crashes): near ones react at once, far ones a beat later (a wave). */
  danger(at: THREE.Vector3, radius: number, source: Character | null) {
    const from = source ? source.pos : at;
    for (const n of this.npcs) {
      if (!n.alive || n.role !== 'civilian' || n.brain === 'scripted' || n.brain === 'passenger' || n.brain === 'inside') continue;
      const d = n.pos.distanceTo(at);
      if (d > radius) continue;
      if (n.brain === 'flee') { n.fleeFrom.copy(from); n.stateT = Math.min(n.stateT, 2); continue; }
      if (n.brain === 'cower' || n.alertT > 0) continue;
      if (d > 9) { n.alertT = Math.min(3, (d - 9) * 0.06) + Math.random() * 0.5; n.alertFrom.copy(from); continue; }
      this.panic(n, from, d);
    }
  }
  private panic(n: Npc, from: THREE.Vector3, d: number) {
    if (n.activity || n.brain === 'idle') this.runner.endAct(n);
    if (d > 24 && Math.random() < 0.4) { // too far to be scared: stop and stare / film
      this.runner.startAct(n, 'film', 8 + Math.random() * 14, Math.atan2(from.x - n.pos.x, from.z - n.pos.z)); return;
    }
    n.brain = Math.random() < (d > 8 ? 0.3 : 0.1) ? 'cower' : 'flee'; n.stateT = 0;
    n.fleeFrom.copy(from);
    if (n.char.human.actionName === 'hands_up') n.char.human.stopAction();
  }
  /** A crash or other spectacle: people nearby stop and watch, some film it. */
  onlookers(at: THREE.Vector3, radius = 32) {
    for (const n of this.npcs) {
      if (!n.alive || n.role !== 'civilian' || n.far || (n.brain !== 'wander' && !(n.brain === 'idle' && !n.activity))) continue;
      const d = n.pos.distanceTo(at); if (d > radius || d < 3 || Math.random() > 0.55) continue;
      this.runner.startAct(n, Math.random() < 0.6 ? 'film' : 'window', 6 + Math.random() * 14, Math.atan2(at.x - n.pos.x, at.z - n.pos.z));
    }
  }
  private watchCrashes(vehicles: Iterable<Vehicle>, dt: number) {
    this.crashT -= dt;
    for (const v of vehicles) {
      const sp = Math.abs(v.speed), prev = this.lastSpeed.get(v) ?? 0;
      this.lastSpeed.set(v, sp);
      if (prev > 7 && sp < prev * 0.5 && this.crashT <= 0 && !v.destroyed) { this.crashT = 2; this.onlookers(v.position); }
    }
  }
  private hitPt = new THREE.Vector3(); private hitDir = new THREE.Vector3();
  /** Vehicles knock people over. Returns list of people hit this step. */
  vehicleHits(vehicles: Iterable<Vehicle>, player: Character, onPlayerHit: (v: Vehicle, speed: number) => void) {
    this.watchCrashes(vehicles, 1 / 60);
    for (const v of vehicles) {
      const sp = Math.abs(v.speed);
      if (sp < 3) continue;
      const hx = v.tpl.layout.half[0] + 0.35, hz = v.tpl.layout.half[2] + 0.35;
      const yaw = v.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
      const lateralOf = (ch: Character) => { const dx = ch.pos.x - v.position.x, dz = ch.pos.z - v.position.z; return Math.max(-1, Math.min(1, (dx * c - dz * s) / hx)); };
      const test = (ch: Character) => {
        const dx = ch.pos.x - v.position.x, dz = ch.pos.z - v.position.z;
        if (Math.abs(ch.pos.y - v.position.y) > 2) return false;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        return Math.abs(lx) < hx && Math.abs(lz) < hz;
      };
      for (const n of this.npcs) {
        if (!n.alive || n.char.inVehicle || n.char.knockT > 0) continue;
        if (!test(n.char)) continue;
        const vel = v.phys.body.linvel();
        const im = pedImpact(sp, lateralOf(n.char), Math.random()), hd = Math.hypot(vel.x, vel.z) || 1, hx2 = vel.x / hd, hz2 = vel.z / hd;
        n.char.knockT = 1;
        n.char.lastHit = { zone: 'torso', dx: hx2, dz: hz2, power: im.outcome === 'over' ? 3.5 : im.outcome === 'hood' ? 3 : 0.8, blast: im.outcome === 'over' };
        const killed = n.char.damage(im.damage, v.driver, this.env.time());
        if (!killed) n.char.hitReact(hx2, hz2, im.outcome === 'brush' ? 0.6 : 1.5); // stagger or full knockdown
        n.char.vel.set(hx2 * im.carry - hz2 * im.side, im.up, hz2 * im.carry + hx2 * im.side);
        if (im.outcome !== 'brush') this.audio.play('hitBody', { pos: n.pos, volume: 1 });
        if (killed) this.onKilled?.(n, v.driver, 'vehicle');
        else if (n.role === 'civilian') { n.brain = 'flee'; n.fleeFrom.copy(v.position); n.stateT = 0; }
        v.damage(im.carDamage, this.hitPt.set(n.char.pos.x, n.char.pos.y + 0.7, n.char.pos.z), this.hitDir.set(hx2, 0, hz2), v.driver);
        continue;
      }
      if (player.alive && !player.inVehicle && player.knockT <= 0 && test(player)) { player.knockT = 1.2; onPlayerHit(v, sp); }
    }
  }
  /** Civilians dodge vehicles heading straight at them. */
  dodge(vehicles: Iterable<Vehicle>) {
    for (const v of vehicles) {
      const sp = v.speed; if (Math.abs(sp) < 6) continue;
      const f = v.phys.forward();
      for (const n of this.npcs) {
        if (!n.alive || n.role !== 'civilian' || n.brain === 'scripted' || n.char.inVehicle || n.far) continue;
        const dx = n.pos.x - v.position.x, dz = n.pos.z - v.position.z;
        const ahead = (dx * f.x + dz * f.z) * Math.sign(sp);
        if (ahead < 2 || ahead > Math.abs(sp) * 1.1) continue;
        const lat = dx * f.z - dz * f.x;
        if (Math.abs(lat) > 2.2) continue;
        if (n.brain !== 'flee') {
          n.brain = 'flee'; n.stateT = 4; // short dash
          n.fleeFrom.set(n.pos.x - f.z * Math.sign(lat || 1) * 5, 0, n.pos.z + f.x * Math.sign(lat || 1) * 5);
          if (Math.random() < 0.4 && !n.char.human.busy) n.char.human.playOnce('Roll', 'full', 0.05);
        }
      }
    }
  }
  fixedUpdate(dt: number, focus: THREE.Vector3) {
    this.reactToPlayer(dt); this.reactToSiren(dt);
    this.runner.beginTick();
    this.tick++;
    for (const n of this.npcs) {
      if (n.alertT > 0 && (n.alertT -= dt) <= 0 && n.alive && n.brain !== 'flee' && n.brain !== 'cower' && n.brain !== 'scripted' && n.brain !== 'inside') this.panic(n, n.alertFrom, n.pos.distanceTo(n.alertFrom));
      const fd = n.pos.distanceTo(focus);
      n.far = fd > 75 && n.role === 'civilian' && n.brain === 'wander';
      if (n.char.inVehicle) continue;
      if (n.char.knockT > 0) {
        n.char.knockT -= dt;
        if (!n.alive || n.char.knockT > 0.4) { n.char.vel.multiplyScalar(Math.exp(-dt * 3)); n.char.move(n.char.vel.clone().setY(0), dt, false); continue; }
      }
      // distance LOD for officers and gang members: far fighters think every 2nd/4th tick with the accumulated dt
      if (n.role !== 'civilian' && fd > 55 && n.brain !== 'scripted' && n.brain !== 'passenger') {
        n.accDt += dt;
        if ((this.tick + n.id) % (fd > 110 ? 4 : 2) !== 0) continue;
        const step = n.accDt; n.accDt = 0;
        this.runner.update(n, step);
        continue;
      }
      n.accDt = 0;
      this.runner.update(n, dt);
    }
  }
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, quality: number) {
    this.maxCivilians = Math.round(quality * pedActivity(this.hour)); streetClock.hour = this.hour;
    // Visuals (throttled animation far away). The skinned meshes are not frustum-culled by three (their bounds are the bind
    // pose), so people outside the view are hidden here: that saves two draw calls (plus shadows) per person behind the camera.
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const n of this.npcs) {
      const c = n.char, h = c.human;
      if (n.brain === 'inside') { h.root.visible = false; continue; }
      if (!c.alive) {
        c.deadTime += dt;
        if (c.deadTime > 0.05 && c.deadTime < 0.1) h.setState('dead');
      } else if (n.brain !== 'scripted' && n.brain !== 'passenger') {
        if (h.currentState !== 'crouch' && h.currentState !== 'cower' && h.currentState !== 'sit' && h.currentState !== 'talk') h.setState(c.swimming ? 'swim' : 'loco');
        h.setSpeed(c.speed);
      }
      if (c.inVehicle) { h.mesh.visible = true; h.update(dt); continue; }
      const d = c.pos.distanceTo(focus);
      h.root.visible = d < 160;
      if (!h.root.visible) continue;
      n.animAcc += dt;
      const every = d > 90 ? 0.2 : d > 60 ? 0.1 : d > 32 ? 0.05 : 0;
      if (n.animAcc >= every || !c.alive) { c.updateVisual(n.animAcc); n.animAcc = 0; } else { h.root.position.copy(c.pos); h.root.rotation.y = c.yaw; }
      this.runner.updateModel(n);
      h.mesh.castShadow = d < 32;
      const inView = d < 14 || this.frustum.intersectsSphere(this.cullSphere.set(this.cullCentre.set(c.pos.x, c.pos.y + 1, c.pos.z), 3)); // generous sphere: the frustum is last frame's, so a quick camera swing must not clip anyone
      h.mesh.visible = inView;
      h.setDetail(d < 48 && inView); for (const e of h.extras) e.castShadow = d < 22; // hair/garment extras are small: beyond ~48 m the shader-painted body carries the look
    }
    // Despawn
    for (const n of [...this.npcs]) {
      if (n.persistent || n.char.inVehicle) continue;
      const d = n.pos.distanceTo(focus);
      if (d > 170 || (!n.alive && n.char.deadTime > 25 && d > 25) || (!n.alive && n.char.deadTime > 60)) { this.remove(n); }
    }
    // Spawn civilians off-screen on sidewalks
    this.spawnT -= dt;
    const civ = this.npcs.filter(n => n.role === 'civilian' && !n.persistent).length;
    if (this.spawnT <= 0 && civ < this.maxCivilians) {
      this.spawnT = 0.05;
      this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projScreen);
      const nodes = this.city.pedNodes;
      for (let tries = 0; tries < 14; tries++) {
        const nd = nodes[Math.floor(Math.random() * nodes.length)];
        const e = nd.edges[Math.floor(Math.random() * nd.edges.length)];
        if (e.crossing) continue;
        const to = nodes[e.to]; const t = Math.random();
        const p = new THREE.Vector3(nd.x + (to.x - nd.x) * t, 0.2 + (nd.y ?? 0) + ((to.y ?? 0) - (nd.y ?? 0)) * t, nd.z + (to.z - nd.z) * t);
        const d = p.distanceTo(focus);
        if (d < (this.prewarming ? 10 : 35) || d > 120) continue;
        const dist = districtAt(this.city, p.x, p.z), dens = DISTRICT_INFO[dist].pedDensity * districtNightFactor(dist, this.hour);
        if (Math.random() > dens) continue;
        if (!this.prewarming && d < 80 && this.frustum.containsPoint(p.clone().setY(1))) continue;
        const n = this.spawn('civilian', p.x, p.z, p.y);
        n.node = nd.id; n.nextNode = Math.random() < 0.5 ? e.to : nd.id;
        // walking with friends: a quarter of arrivals come as a pair or trio
        if (Math.random() < 0.26 && civ + 1 < this.maxCivilians) {
          for (let k = 0, cnt = Math.random() < 0.3 ? 2 : 1; k < cnt; k++) {
            const m = this.spawn('civilian', p.x + (k + 1) * 0.8, p.z + 0.5, p.y);
            m.node = n.node; m.nextNode = n.nextNode; m.buddy = n; m.speedMul = 1;
          }
        }
        break;
      }
    }
  }
  clearNonPersistent() { for (const n of [...this.npcs]) if (!n.persistent) this.remove(n); }
}
