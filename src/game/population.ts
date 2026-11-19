/** Keeps the streets alive: spawns/despawns civilians, runs every NPC brain, and resolves danger and vehicle hits. */
import * as THREE from 'three';
import { Npc, NpcBrainRunner, type NpcEnv, type Role } from '../actors/npc';
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
      if (!n.alive || n.char.inVehicle || n.brain === 'scripted' || n.brain === 'passenger' || n.far) continue;
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
  spawn(role: Role, x: number, z: number, y = 0.2, look?: Look, weapon: WeaponId = 'fists'): Npc {
    const n = new Npc(this.env.physics, this.tpl, look ?? randomLook(LOOK_SEED++), role, x, z, y);
    this.scene.add(n.char.human.root);
    if (weapon !== 'fists') n.arm(weapon, this.scene);
    this.npcs.push(n);
    return n;
  }
  adopt(n: Npc) { this.scene.add(n.char.human.root); }
  remove(n: Npc) { const i = this.npcs.indexOf(n); if (i < 0) return; this.npcs.splice(i, 1); n.dispose(); }
  *characters(): Iterable<Character> { for (const n of this.npcs) yield n.char; }
  /** Civilians in a radius react to danger (gunfire, explosions, crashes). */
  danger(at: THREE.Vector3, radius: number, source: Character | null) {
    for (const n of this.npcs) {
      if (!n.alive || n.role !== 'civilian' || n.brain === 'scripted' || n.brain === 'passenger') continue;
      const d = n.pos.distanceTo(at);
      if (d > radius) continue;
      if (n.brain !== 'flee' && n.brain !== 'cower') {
        n.brain = Math.random() < 0.25 && d > 8 ? 'cower' : 'flee'; n.stateT = 0;
        n.fleeFrom.copy(source ? source.pos : at);
        if (n.char.human.actionName === 'hands_up') n.char.human.stopAction();
      } else if (n.brain === 'flee') { n.fleeFrom.copy(source ? source.pos : at); n.stateT = Math.min(n.stateT, 2); }
    }
  }
  /** Vehicles knock people over. Returns list of people hit this step. */
  vehicleHits(vehicles: Iterable<Vehicle>, player: Character, onPlayerHit: (v: Vehicle, speed: number) => void) {
    for (const v of vehicles) {
      const sp = Math.abs(v.speed);
      if (sp < 3) continue;
      const hx = v.tpl.layout.half[0] + 0.35, hz = v.tpl.layout.half[2] + 0.35;
      const yaw = v.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
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
        n.char.knockT = 1;
        if (sp > 8) {
          n.char.damage(sp * 9, v.driver, this.env.time());
          n.char.vel.set(vel.x * 0.6, 3, vel.z * 0.6);
          this.audio.play('hitBody', { pos: n.pos, volume: 1 });
          if (!n.alive) this.onKilled?.(n, v.driver, 'vehicle');
        } else {
          if (n.char.damage(sp * 3, v.driver, this.env.time())) this.onKilled?.(n, v.driver, 'vehicle');
          n.char.vel.set(vel.x * 0.8 + (Math.random() - 0.5) * 2, 0, vel.z * 0.8);
          n.char.human.playOnce('Hit_Chest', 'full', 0.05);
          if (n.role === 'civilian' && n.alive) { n.brain = 'flee'; n.fleeFrom.copy(v.position); n.stateT = 0; }
        }
        v.damage(sp * 1.5);
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
    this.reactToPlayer(dt);
    for (const n of this.npcs) {
      n.far = n.pos.distanceTo(focus) > 75 && n.role === 'civilian' && n.brain === 'wander';
      if (n.char.inVehicle) continue;
      if (n.char.knockT > 0) {
        n.char.knockT -= dt;
        if (!n.alive || n.char.knockT > 0.4) { n.char.vel.multiplyScalar(Math.exp(-dt * 3)); n.char.move(n.char.vel.clone().setY(0), dt, false); continue; }
      }
      this.runner.update(n, dt);
    }
  }
  update(dt: number, camera: THREE.Camera, focus: THREE.Vector3, quality: number) {
    this.maxCivilians = quality;
    // Visuals (throttled animation far away). The skinned meshes are not frustum-culled by three (their bounds are the bind
    // pose), so people outside the view are hidden here: that saves two draw calls (plus shadows) per person behind the camera.
    this.projScreen.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); this.frustum.setFromProjectionMatrix(this.projScreen);
    for (const n of this.npcs) {
      const c = n.char, h = c.human;
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
      h.mesh.castShadow = d < 40;
      const inView = d < 6 || this.frustum.intersectsSphere(this.cullSphere.set(this.cullCentre.set(c.pos.x, c.pos.y + 1, c.pos.z), 2.4));
      h.mesh.visible = inView;
      h.setDetail(d < 70 && inView); for (const e of h.extras) e.castShadow = d < 30;
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
        const p = new THREE.Vector3(nd.x + (to.x - nd.x) * t, 0.2, nd.z + (to.z - nd.z) * t);
        const d = p.distanceTo(focus);
        if (d < (this.prewarming ? 10 : 35) || d > 120) continue;
        const dens = DISTRICT_INFO[districtAt(this.city, p.x, p.z)].pedDensity;
        if (Math.random() > dens) continue;
        if (!this.prewarming && d < 80 && this.frustum.containsPoint(p.clone().setY(1))) continue;
        const n = this.spawn('civilian', p.x, p.z, 0.2);
        n.node = nd.id; n.nextNode = Math.random() < 0.5 ? e.to : nd.id;
        break;
      }
    }
  }
  clearNonPersistent() { for (const n of [...this.npcs]) if (!n.persistent) this.remove(n); }
}
