/** Keeps the streets alive: spawns/despawns civilians, runs every NPC brain, and resolves danger and vehicle hits. */
import { pedImpact } from './impact';
import * as THREE from 'three';
import { Npc, NpcBrainRunner, streetClock, type NpcEnv, type Role } from '../actors/npc';
import { pedActivity, districtNightFactor } from './schedule';
import { randomLook, warmLookExtras, type HumanTemplate, type Look } from '../actors/human';
import type { FullLook } from '../actors/look';
import type { CityMap } from '../world/citymap';
import { DISTRICT_INFO, districtAt, surfaceAt } from '../world/citymap';
import type { Character } from '../actors/character';
import type { RagdollSystem } from '../actors/ragdoll';
import type { Vehicle } from '../vehicles/vehicle';
import { spawnHidden } from './crowd';
import { animEvery } from '../actors/animLod';
import type { WeaponId } from '../combat/weapons';
import type { GameAudio } from '../ui/contracts';

let LOOK_SEED = 1000;
export class Population {
  npcs: Npc[] = [];
  runner: NpcBrainRunner;
  maxCivilians = 22;
  /** Max people casting shadows at once (set from the graphics preset). */
  shadowBudget = 20;
  /** world clock hour (set by the game each frame); drives crowd size, nightlife and idles */
  hour = 17;
  private lastSpeed = new WeakMap<Vehicle, number>(); private crashT = 0;
  prewarming = false;
  /** last render camera seen (the far crowd culls with it) */
  camera: THREE.Camera | null = null;
  /** civilian slots the off-screen spawner leaves free for far-crowd people walking into view (set by Crowd.wire) */
  reserve = 0;
  /** furthest an off-screen civilian is spawned (the far crowd covers beyond; set by Crowd.wire) */
  spawnMax = 120;
  private spawnT = 0;
  private frustum = new THREE.Frustum();
  private projScreen = new THREE.Matrix4();
  private cullSphere = new THREE.Sphere(); private cullCentre = new THREE.Vector3();
  onKilled: ((n: Npc, by: Character | null, how: 'shot' | 'melee' | 'vehicle' | 'explosion') => void) | null = null;
  constructor(private scene: THREE.Scene, readonly tpl: HumanTemplate, private city: CityMap, private env: NpcEnv, private audio: GameAudio) {
    this.runner = new NpcBrainRunner(env);
  }
  /** Where the player is pointing a gun (set by the game each frame; null when not aiming). */
  aimProvider: (() => { from: THREE.Vector3; dir: THREE.Vector3 } | null) | null = null;
  /** Round 8: a pedestrian struck hard by a car (the game adds blood on the road and on the car) */
  onCarHit: ((ch: Character, v: Vehicle, speed: number) => void) | null = null;
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
      if (n.role === 'civilian' && d < 1.05 && p.speed > 3.2 && n.brain !== 'flee' && n.brain !== 'cower' && n.brain !== 'surrender' && n.brain !== 'fight') {
        // only a runner heading straight at them gets the shoulder-check; a near miss (passing alongside) is not contact, just a glance
        const into = (-dx * p.vel.x - dz * p.vel.z) / (d * p.speed || 1);
        if (d < 0.62 && p.speed > 5 && into > 0.6 && c.knockT <= 0) c.hitReact(dx, dz, 0.55);
        else if (into > 0.3) c.faceTowards(Math.atan2(-dx, -dz), 7, 0.1);
      }
      if (aim && n.role === 'civilian' && d < 28 && n.brain !== 'cower' && n.brain !== 'ordered' && n.brain !== 'hostage') {
        const cx = c.pos.x - aim.from.x, cy = c.pos.y + 1.2 - aim.from.y, cz = c.pos.z - aim.from.z;
        const along = cx * aim.dir.x + cy * aim.dir.y + cz * aim.dir.z;
        if (along > 0) {
          const off = Math.hypot(cx - aim.dir.x * along, cy - aim.dir.y * along, cz - aim.dir.z * along);
          if (off < 0.9 + along * 0.02) {
            // Round 7: frozen with hands up for as long as the gun stays on them (they used to bolt after 2-4 s, before an order could land)
            if (n.brain === 'surrender') n.stateT = Math.min(n.stateT, 0.35);
            else if (n.brain !== 'flee' || d < 6) { n.brain = 'surrender'; n.stateT = 0; n.waitT = 2 + Math.random() * 2.5; }
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
  // ---- Round 7 perf: look warm-up (hair / hat / garment extras are built before the person comes close)
  private warmQ: Look[] = []; private warmKeys = new Set<string>();
  /** build times (ms) of warmed looks (tests / tuning) */ warmMs: number[] = [];
  queueWarm(l: Look) {
    const f = l as Partial<FullLook>, k = `${f.sex}|${f.hairStyle}|${f.hatStyle}|${f.facial}|${f.topStyle}|${f.bottomStyle}`;
    if (this.warmKeys.has(k)) return; this.warmKeys.add(k); this.warmQ.push(l);
  }
  /** Builds queued looks until `budgetMs` is used (at least one when anything is queued). */
  private aheadSeed = -1;
  warmStep(budgetMs: number) {
    const t0 = performance.now();
    // people spawned directly (drivers, shoppers, police...) take the next look seeds: warm a few of those ahead too
    if (this.aheadSeed !== LOOK_SEED) { this.aheadSeed = LOOK_SEED; for (let k = 0; k < 12; k++) this.queueWarm(randomLook(LOOK_SEED + k)); }
    while (this.warmQ.length && (performance.now() - t0 < budgetMs)) { const ms = warmLookExtras(this.tpl, this.warmQ.shift()!); if (this.warmMs.length < 4000) this.warmMs.push(ms); }
  }
  get warmPending() { return this.warmQ.length; }
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
    // Round 8: sustained gunfire / chaos: the scare spreads further and nobody stops to film or freeze
    const now = this.env.time(); this.dangerAt = this.dangerAt.filter(t => now - t < 6); this.dangerAt.push(now);
    const level = this.dangerAt.length; radius *= panicRadiusScale(level);
    for (const n of this.npcs) {
      if (n.alive && n.role === 'civilian' && n.pos.distanceTo(at) <= radius) n.shotAt = this.env.time(); // store shoppers (scripted) read this to drop their hands
      if (!n.alive || n.role !== 'civilian' || n.brain === 'scripted' || n.brain === 'passenger' || n.brain === 'inside' || n.brain === 'hostage') continue; // a hostage in your grip does not bolt
      const d = n.pos.distanceTo(at);
      if (d > radius) continue;
      // hands up but the shooting has started: they stop waiting to be robbed and bolt (a beat later when it is further off)
      if (n.brain === 'surrender') { if (n.alertT <= 0) { n.alertT = 0.15 + Math.random() * 0.45 + Math.min(1.5, Math.max(0, d - 6) * 0.05); n.alertFrom.copy(from); } continue; }
      if (n.brain === 'flee') { n.fleeFrom.copy(from); n.stateT = Math.min(n.stateT, 2); continue; }
      if (n.brain === 'cower' || n.alertT > 0) continue;
      if (d > 9) { n.alertT = Math.min(3, (d - 9) * 0.06) + Math.random() * 0.5; n.alertFrom.copy(from); continue; }
      this.panic(n, from, d);
    }
  }
  private dangerAt: number[] = [];
  private panic(n: Npc, from: THREE.Vector3, d: number) {
    if (n.activity || n.brain === 'idle') this.runner.endAct(n);
    if (this.dangerAt.length >= 3) { // a real shootout: everybody runs for it
      const cornered = n.brain === 'surrender' && d < 2.5;
      n.brain = cornered ? 'cower' : 'flee'; n.stateT = 0; n.fleeFrom.copy(from);
      if (n.char.human.actionName === 'hands_up') n.char.human.stopAction();
      return;
    }
    if (n.brain !== 'surrender' && d > 24 && Math.random() < 0.4) { // too far to be scared: stop and stare / film
      this.runner.startAct(n, 'film', 8 + Math.random() * 14, Math.atan2(from.x - n.pos.x, from.z - n.pos.z)); return;
    }
    const cornered = n.brain === 'surrender' && d < 2.5; // hands up right in front of the gun: nowhere to run
    n.brain = cornered || Math.random() < (d > 8 ? 0.3 : 0.1) ? 'cower' : 'flee'; n.stateT = 0;
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
  /** R6-X: physics ragdoll system (set by Game); without it people fall with the old kinematic knock. */
  ragdolls: RagdollSystem | null = null;
  /** Launches `ch` as a ragdoll off the car `v` (moved out of the car's box first so the solver never has to eject it). */
  private ragHit(ch: Character, v: Vehicle, sp: number, lying: boolean, lateral = 0) {
    const vel = v.phys.body.linvel(), yaw = v.yaw, c = Math.cos(yaw), s = Math.sin(yaw);
    const L = v.tpl.layout, zc = L.zCenter ?? 0, hxh = L.half[0] + 0.12, hzh = L.half[2] + 0.12;
    const dx = ch.pos.x - v.position.x, dz = ch.pos.z - v.position.z;
    let lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < hxh && Math.abs(lz - zc) < hzh) {
      if (Math.abs(lz - zc) / hzh > Math.abs(lx) / hxh * 0.6) lz = zc + (lz - zc >= 0 ? 1 : -1) * (hzh + 0.12); else lx = (lx >= 0 ? 1 : -1) * (hxh + 0.12);
      ch.pos.x = v.position.x + c * lx + s * lz; ch.pos.z = v.position.z - s * lx + c * lz;
    }
    // Round 7: struck by the flank (beside the car, not in front of the bumper): thrown sideways and along, clear of the
    // body. They used to be launched at 12% of the car's speed and get scraped along the side into the ground (jitter).
    if (Math.abs(lx) >= hxh - 0.05 && Math.abs(lz - zc) < hzh - 0.3) {
      const out = lx >= 0 ? 1 : -1, ox = c * out, oz = -s * out, push = 2.2 + Math.min(6, sp * 0.22);
      ch.yaw = Math.atan2(-ox, -oz); // facing the car side, knocked over backwards away from it
      this.ragdolls!.launch(ch, { vx: vel.x * 0.55 + ox * push, vy: 1.1, vz: vel.z * 0.55 + oz * push, spin: lateral * 1.5, getUp: true, lying: false, car: v });
      return;
    }
    const fwd = Math.sign(v.speed) || 1;
    if (!lying) ch.yaw = Math.atan2(vel.x * fwd, vel.z * fwd) + Math.PI; // facing the car, so they fall back onto the hood
    const k = lying ? 0.25 : 0.12;
    this.ragdolls!.launch(ch, { vx: vel.x * k, vy: lying ? 0.8 : 1.6, vz: vel.z * k, spin: lateral * 2.2, getUp: !lying, lying, car: v });
  }
  private hitPt = new THREE.Vector3(); private hitDir = new THREE.Vector3();
  /** Vehicles knock people over. Returns list of people hit this step. */
  vehicleHits(vehicles: Iterable<Vehicle>, player: Character, onPlayerHit: (v: Vehicle, speed: number) => void) {
    this.watchCrashes(vehicles, 1 / 60);
    for (const v of vehicles) {
      // Round 7: ground speed, not just along the nose: a car sliding sideways into someone used to register no hit at
      // all, so its body shoved the walking character into the street (sinking, jittering)
      const lv0 = v.phys.body.linvel(), sp = Math.max(Math.abs(v.speed), Math.hypot(lv0.x, lv0.z));
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
        if (n.char.inVehicle || n.char.ragdoll) continue;
        if (!n.alive) { // a corpse in the way: it is a physical body, the car shoves / rolls over it
          if (this.ragdolls && sp > 3.5 && n.char.deadTime > 0.3 && test(n.char)) this.ragHit(n.char, v, sp, true);
          continue;
        }
        if (n.char.knockT > 0) continue;
        if (!test(n.char)) continue;
        const vel = v.phys.body.linvel();
        const im = pedImpact(sp, lateralOf(n.char), Math.random()), hd = Math.hypot(vel.x, vel.z) || 1, hx2 = vel.x / hd, hz2 = vel.z / hd;
        n.char.knockT = 1;
        if (this.ragdolls && im.outcome !== 'brush') this.ragHit(n.char, v, sp, false, lateralOf(n.char));
        if (im.outcome !== 'brush' && sp > 6) this.onCarHit?.(n.char, v, sp); // Round 8: gore on a hard hit
        n.char.lastHit = { zone: 'torso', dx: hx2, dz: hz2, power: im.outcome === 'over' ? 3.5 : im.outcome === 'hood' ? 3 : 0.8, blast: im.outcome === 'over' };
        const killed = n.char.damage(im.damage, v.driver, this.env.time());
        if (!killed && !n.char.ragdoll) n.char.hitReact(hx2, hz2, im.outcome === 'brush' ? 0.6 : 1.5); // stagger or full knockdown
        if (!n.char.ragdoll) n.char.vel.set(hx2 * im.carry - hz2 * im.side, im.up, hz2 * im.carry + hx2 * im.side);
        if (im.outcome !== 'brush') this.audio.play('hitBody', { pos: n.pos, volume: 1 });
        if (killed) this.onKilled?.(n, v.driver, 'vehicle');
        else if (n.role === 'civilian') { n.brain = 'flee'; n.fleeFrom.copy(v.position); n.stateT = 0; }
        v.damage(im.carDamage, this.hitPt.set(n.char.pos.x, n.char.pos.y + 0.7, n.char.pos.z), this.hitDir.set(hx2, 0, hz2), v.driver);
        continue;
      }
      if (player.alive && !player.inVehicle && player.knockT <= 0 && test(player)) { player.knockT = 1.2; onPlayerHit(v, sp); }
    }
  }
  /** A civilian whose clothes are on fire bolts around in a panic (R6-X). */
  panicBurn(c: Character) {
    const n = this.npcs.find(x => x.char === c); if (!n || n.role !== 'civilian') return;
    n.brain = 'flee'; n.stateT = 0; n.fleeFrom.set(c.pos.x + (Math.random() - 0.5) * 4, 0, c.pos.z + (Math.random() - 0.5) * 4);
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
        // only people actually in the car's path (its width plus a margin) jump: a pedestrian on the footpath beside the lane is not
        const hw = v.tpl.layout.half[0] + 0.55;
        if (Math.abs(lat) > hw || (Math.abs(lat) > hw - 0.5 && surfaceAt(this.city, n.pos.x, n.pos.z) !== 'road')) continue;
        if (n.brain !== 'flee') {
          n.brain = 'flee'; n.stateT = 4; // short dash
          n.fleeFrom.set(n.pos.x - f.z * Math.sign(lat || 1) * 5, 0, n.pos.z + f.x * Math.sign(lat || 1) * 5);
          if (ahead < 6 && Math.abs(lat) < hw - 0.3 && Math.random() < 0.5 && !n.char.human.busy) n.char.human.playOnce('Roll', 'full', 0.05); // a real dive, only when it is about to hit
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
      // Round 7 perf: calm (or simply fleeing / cowering) civilians beyond ~28 m think and sweep their collision capsule at
      // 30 Hz (20 Hz past 50 m) with the accumulated dt: 1-1.5 cm steps at walking pace, invisible at that range
      if (n.role === 'civilian' && fd > 28 && (n.brain === 'wander' || n.brain === 'idle' || n.brain === 'flee' || n.brain === 'cower') && !n.char.ragdoll) {
        n.accDt += dt;
        if ((this.tick + n.id) % (fd > 90 ? 6 : fd > 50 ? 3 : 2) !== 0) continue; // Round 12 perf: 10 Hz past 90 m
        const step = Math.min(n.accDt, 0.1); n.accDt = 0;
        this.runner.update(n, step);
        continue;
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
    this.camera = camera;
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
      if (c.inVehicle) {
        // occupants get the same distance LODs / culling as people on foot (they were all full-detail 15k-tri bodies, shadows
        // included, in every car on the map: ~1.2M triangles a frame on high; R6-V)
        const vp = (c.inVehicle as { position?: THREE.Vector3 }).position ?? c.pos, dv = vp.distanceTo(focus);
        const vis = dv < 14 || dv < 150 && this.frustum.intersectsSphere(this.cullSphere.set(this.cullCentre.set(vp.x, vp.y + 1, vp.z), 3));
        h.mesh.visible = vis;
        // Round 7 perf: seated people barely move: full rate only up close
        n.animAcc += dt;
        if (vis) { h.setBodyLod(dv > 36 ? 2 : dv > 13 ? 1 : 0); if (n.animAcc >= (dv > 40 ? 0.1 : dv > 14 ? 0.05 : 0)) { h.update(n.animAcc); n.animAcc = 0; } }
        h.setDetail(vis && dv < 40); h.mesh.castShadow = dv < 18; for (const e of h.extras) e.castShadow = dv < 12;
        continue;
      }
      const d = c.pos.distanceTo(focus);
      h.root.visible = d < 160;
      if (!h.root.visible) continue;
      n.animAcc += dt;
      // animation rate by distance: smooth near the player (the old 5-10 Hz far rates read as lagging people)
      const inView = d < 4 || this.frustum.intersectsSphere(this.cullSphere.set(this.cullCentre.set(c.pos.x, c.pos.y + 1, c.pos.z), 3)); // generous sphere: the frustum is last frame's, so a quick camera swing must not clip anyone
      // Round 7 perf: people out of view only tick their skeleton 4x a second (their shadows are budgeted to the nearest anyway)
      n.inView = inView;
      const every = animEvery(d, inView, !!c.ragdoll); // Round 12 perf: src/actors/animLod.ts
      n.posed = n.animAcc >= every || !c.alive || !!c.ragdoll;
      if (n.posed) { c.updateVisual(n.animAcc); n.animAcc = 0; } else { h.root.position.copy(c.pos); h.root.rotation.y = c.yaw; }
      this.runner.updateModel(n);
      h.mesh.castShadow = d < 32;
      h.mesh.visible = inView;
      h.setBodyLod(d > 36 ? 2 : d > 13 ? 1 : 0); h.setDetail(d < 48 && inView); for (const e of h.extras) e.castShadow = d < 22; // hair/garment extras are small: beyond ~48 m the shader-painted body carries the look
    }
    // shadow caster budget: only the nearest people are drawn into the shadow map (the rest keep their lit body)
    const sc: { n: Npc; d: number }[] = [];
    for (const n of this.npcs) if (n.char.human.mesh.castShadow && n.brain !== 'inside' && !n.char.inVehicle) sc.push({ n, d: n.char.pos.distanceToSquared(focus) });
    if (sc.length > this.shadowBudget) { sc.sort((x, y) => x.d - y.d); for (let i = this.shadowBudget; i < sc.length; i++) { const h = sc[i].n.char.human; h.mesh.castShadow = false; for (const e of h.extras) e.castShadow = false; } }
    // Despawn
    for (const n of [...this.npcs]) {
      if (n.persistent || n.char.inVehicle) continue;
      const d = n.pos.distanceTo(focus);
      if (d > 170 || (!n.alive && n.char.deadTime > 25 && d > 25) || (!n.alive && n.char.deadTime > 60)) { this.remove(n); }
    }
    // Spawn civilians off-screen on sidewalks
    this.spawnT -= dt;
    const civ = this.npcs.filter(n => n.role === 'civilian' && !n.persistent).length;
    if (this.spawnT <= 0 && civ < this.maxCivilians - this.reserve) {
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
        if (d < (this.prewarming ? 10 : 35) || d > this.spawnMax) continue;
        const dist = districtAt(this.city, p.x, p.z), dens = DISTRICT_INFO[dist].pedDensity * districtNightFactor(dist, this.hour);
        if (Math.random() > dens) continue;
        // Round 8: never spawn where the camera can see (was: allowed in view beyond 80 m, and only the centre point was tested)
        if (!this.prewarming && spawnHidden(d, this.frustum.intersectsSphere(this.cullSphere.set(this.cullCentre.set(p.x, p.y + 1, p.z), 2.5)))) continue;
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

/** Round 8: how far a scare reaches, by how many scares (shots, blasts, crashes) happened in the last 6 s. Pure (tests). */
export function panicRadiusScale(recent: number): number { return recent >= 6 ? 1.8 : recent >= 3 ? 1.4 : 1; }
