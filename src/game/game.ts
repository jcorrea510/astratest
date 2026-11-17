/** Game orchestrator: owns the world, systems and the main loop. */
import * as THREE from 'three';
import { Renderer } from '../render/renderer';
import { Physics } from '../core/physics';
import { Input } from '../core/input';
import type { Settings } from '../core/settings';
import { generateCity, type CityMap, signalState, districtAt, DISTRICT_INFO, AVENUES, STREETS, AVENUE_NAMES, STREET_NAMES } from '../world/citymap';
import { buildCity, type CityVisuals } from '../world/citybuild';
import type { Assets } from '../world/assets';
import { createHumanTemplate, type HumanTemplate, randomLook } from '../actors/human';
import { Character } from '../actors/character';
import { CameraRig } from './camera';
import { PlayerController } from './player';
import { nightUniform, timeUniform, glowTexture } from '../render/materials';
import { Particles, SkidMarks } from '../render/particles';
import { VehicleManager } from './vehicles';
import type { Vehicle } from '../vehicles/vehicle';
import type { GameAudio, HudState, MinimapBlip } from '../ui/contracts';
import { NullAudio } from './nullAudio';
import { Combat } from '../combat/combat';
import { PlayerCombat } from './playerCombat';
import { Population } from './population';
import { Traffic } from './traffic';
import { Police, type Crime } from './police';
import type { Npc } from '../actors/npc';
import { WEAPONS } from '../combat/weapons';

export const PLAYER_LOOK = { skin: '#c68c63', top: '#e8875a', bottom: '#27324a', shoes: '#f2efe8', hair: '#1f1a17', hat: '#264653', detail: '#2b2b2b', sleeves: 'long' as const, legs: 'pants' as const, hairStyle: 'short' as const, hatStyle: 'none' as const, height: 1.0, build: 1.02 };
export const SPAWN = { x: -300, y: 0.25, z: -107, yaw: Math.PI };
export const CLINIC = { x: -60, z: -110, yaw: Math.PI, name: 'Juniper Clinic' };
export const PRECINCT = { x: 40, z: 108, yaw: 0, name: 'Meridian PD' };

export interface Pickup { id: number; kind: 'cash' | 'health' | 'armor' | 'ammo' | 'weapon'; amount: number; weapon?: keyof typeof WEAPONS; pos: THREE.Vector3; mesh: THREE.Object3D; ttl: number; persistent?: boolean }

export class Game {
  renderer: Renderer;
  physics = new Physics();
  input: Input;
  city: CityMap;
  visuals!: CityVisuals;
  humanTpl!: HumanTemplate;
  player!: Character;
  playerCtl!: PlayerController;
  cam!: CameraRig;
  hour = 17.6;
  time = 0;
  timeScale = 1;
  targetTimeScale = 1;
  paused = false;
  menuOpen = false;
  dayLength = 24 * 60;
  private acc = 0;
  private last = 0;
  private running = false;
  fps = 60;
  frameMs = 16;
  onFrame: ((dt: number) => void) | null = null;
  particles!: Particles;
  skids!: SkidMarks;
  vehicles!: VehicleManager;
  combat!: Combat;
  pcombat!: PlayerCombat;
  pop!: Population;
  traffic!: Traffic;
  police!: Police;
  playerVehicle: Vehicle | null = null;
  money = 250;
  pickups: Pickup[] = [];
  private pickupId = 0;
  deathT = -1;
  deathKind: 'down' | 'busted' = 'down';
  stats = { kills: 0, distance: 0, crashes: 0 };
  /** Hooks for UI / missions */
  events = {
    onToast: (_t: string, _k?: 'info' | 'money' | 'heat' | 'mission' | 'warning') => { },
    onDeath: (_k: 'down' | 'busted', _detail: string) => { },
    onRespawn: () => { },
    onMoney: (_delta: number) => { },
    onNpcKilled: (_n: Npc, _by: Character | null) => { },
    onVehicleEntered: (_v: Vehicle) => { },
    onVehicleExited: (_v: Vehicle) => { },
    onExplosion: (_at: THREE.Vector3) => { },
  };
  wheelOpen = false;
  blockedInput = false;
  waypoint: THREE.Vector3 | null = null;
  private entering: { v: Vehicle; t: number; from: THREE.Vector3; jack: boolean } | null = null;
  private lampLights: THREE.PointLight[] = [];
  private lampBulbs!: THREE.InstancedMesh;
  private lampPools!: THREE.InstancedMesh;
  private lampTimer = 0;
  respawnPoint = { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw };

  constructor(public canvas: HTMLCanvasElement, public settings: Settings, public assets: Assets, public audio: GameAudio = new NullAudio()) {
    this.renderer = new Renderer(canvas);
    this.renderer.setQuality(settings.quality);
    this.input = new Input(settings, canvas);
    this.city = generateCity();
  }
  async init(onProgress: (f: number, label: string) => void) {
    onProgress(0.05, 'Laying out streets');
    await tick();
    this.visuals = buildCity(this.renderer.scene, this.physics, this.assets, this.city);
    this.buildLamps();
    onProgress(0.55, 'Waking up the locals');
    await tick();
    this.humanTpl = createHumanTemplate(this.assets.human);
    this.player = new Character(this.physics, this.humanTpl, PLAYER_LOOK, 'player', SPAWN.x, SPAWN.z, SPAWN.y);
    this.player.yaw = SPAWN.yaw; this.player.maxHealth = 100;
    this.renderer.scene.add(this.player.human.root);
    this.cam = new CameraRig(this.renderer.camera, this.physics);
    this.cam.snapBehind(SPAWN.yaw);
    this.cam.shakeScale = this.settings.cameraShake;
    this.playerCtl = new PlayerController(this.player, this.input, this.cam);
    onProgress(0.7, 'Fuelling up');
    await tick();
    this.particles = new Particles(this.renderer.scene, this.renderer.quality.particles);
    this.skids = new SkidMarks(this.renderer.scene);
    this.vehicles = new VehicleManager(this.renderer.scene, this.physics, this.assets, this.particles, this.skids, this.audio);
    this.combat = new Combat(this.physics, this.particles, this.audio, this.renderer.scene);
    this.pcombat = new PlayerCombat(this.player, this.playerCtl, this.input, this.cam, this.combat, this.physics, this.audio, this.renderer.scene);
    this.pop = new Population(this.renderer.scene, this.humanTpl, this.city, {
      physics: this.physics, city: this.city, combat: this.combat, scene: this.renderer.scene, time: () => this.time,
      player: this.player, playerHeat: () => this.police.heat, others: () => this.pop.characters(),
      onArrest: () => this.playerDown('busted'), onWitness: () => { },
    }, this.audio);
    this.traffic = new Traffic(this.city, this.vehicles, this.pop, this.audio, () => this.time);
    this.police = new Police(this.city, this.pop, this.traffic, this.audio, this.renderer.scene);
    this.police.onHeatChange = (h, lost) => { if (lost) this.events.onToast('You lost the heat', 'heat'); else this.events.onToast(`Heat ${h}`, 'heat'); };
    this.wireEvents();
    onProgress(0.85, 'Warming up the city lights');
    this.physics.world.step();
    await tick();
    this.update(0);
    this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera);
    onProgress(1, 'Ready');
  }
  private wireEvents() {
    this.combat.onShot = e => {
      this.pop.danger(e.origin, e.weapon.id === 'shotgun' ? 45 : 35, e.shooter);
      if (e.shooter === this.player) this.police.report('shooting', this.player.pos);
    };
    this.combat.onHit = (target, _dmg, from, _head, killed) => {
      const npc = this.pop.npcs.find(n => n.char === target);
      if (from === this.player && npc) {
        if (npc.role === 'police') this.police.report(killed ? 'copKill' : 'copAttack', this.player.pos);
        else this.police.report(killed ? 'kill' : 'assault', this.player.pos);
        if (npc.role === 'gang' && npc.alive) { npc.hostile = true; npc.brain = 'combat'; npc.target = this.player; npc.seenTime = this.time; npc.lastSeen.copy(this.player.pos); }
        if (npc.role === 'civilian' && npc.alive) { npc.brain = 'flee'; npc.fleeFrom.copy(this.player.pos); npc.stateT = 0; }
        if (killed) { this.stats.kills++; this.onNpcKilled(npc, from); }
      } else if (npc && killed) this.onNpcKilled(npc, from);
      if (target === this.player && killed) this.playerDown('down');
      if (target === this.player) this.cam.addShake(0.15);
    };
    this.combat.onVehicleHit = (v, from) => { if (from === this.player) this.traffic.panic(v); };
    this.pop.onKilled = (n, by) => { if (by === this.player) { this.police.report(n.role === 'police' ? 'copKill' : 'kill', this.player.pos); this.stats.kills++; } this.onNpcKilled(n, by); };
    this.vehicles.onCrash = e => {
      if (e.vehicle === this.playerVehicle) { this.cam.addShake(Math.min(0.8, e.impact / 18)); this.stats.crashes++; this.pop.danger(e.point, 15, this.player); }
    };
    this.vehicles.onExplode = (v, at) => this.explosion(at, this.playerVehicle === v ? null : this.player);
  }
  private onNpcKilled(n: Npc, by: Character | null) {
    if (n.dropMoney > 0 || (n.role !== 'civilian' && Math.random() < 0.8) || Math.random() < 0.3) this.spawnPickup('cash', n.dropMoney || Math.floor(10 + Math.random() * 40), n.pos);
    if (n.weapon !== 'fists' && Math.random() < 0.6) this.spawnPickup('ammo', Math.ceil(WEAPONS[n.weapon].ammoPack / 2), n.pos.clone().add(new THREE.Vector3(0.6, 0, 0.4)), n.weapon);
    this.events.onNpcKilled(n, by);
  }
  explosion(at: THREE.Vector3, by: Character | null) {
    this.pop.danger(at, 60, by);
    this.cam.addShake(Math.max(0, 1 - this.renderer.camera.position.distanceTo(at) / 60));
    for (const c of [this.player, ...this.pop.characters()]) {
      if (!c.alive || c.inVehicle) continue;
      const d = c.pos.distanceTo(at);
      if (d < 8) {
        const killed = c.damage((8 - d) * 18, by, this.time);
        if (c === this.player && !c.alive) this.playerDown('down');
        if (c !== this.player) { c.knockT = 1.2; const dir = c.pos.clone().sub(at).setY(0).normalize(); c.vel.set(dir.x * 7, 4, dir.z * 7); }
        const npc = this.pop.npcs.find(n => n.char === c); if (npc && killed) this.onNpcKilled(npc, by);
      }
    }
    if (by === this.player) this.police.report('vehicleWreck', at);
    this.events.onExplosion(at);
  }
  start() {
    if (this.running) return;
    this.running = true; this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const raw = Math.max(0, Math.min(0.1, (now - this.last) / 1000)); this.last = Math.max(this.last, now);
      this.frameMs = this.frameMs * 0.92 + raw * 1000 * 0.08;
      this.fps = 1000 / Math.max(1, this.frameMs);
      this.frame(raw);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }
  /** Advances the simulation by real-time dt (seconds). Exposed for scripted tests. */
  frame(raw: number, render = true) {
    raw = Number.isFinite(raw) ? Math.max(0, Math.min(0.1, raw)) : 0;
    this.input.pollGamepad();
    this.timeScale += (this.targetTimeScale - this.timeScale) * Math.min(1, raw * 10);
    const dt = this.paused ? 0 : raw * this.timeScale;
    if (!this.paused) {
      this.acc += dt;
      const step = 1 / 60;
      let n = 0;
      while (this.acc >= step && n < 4) { this.fixedUpdate(step); this.acc -= step; n++; }
      if (n === 4) this.acc = 0;
    }
    this.update(dt, raw);
    this.onFrame?.(raw);
    if (render) this.renderer.render();
    this.input.endFrame();
  }
  get inputBlocked() { return this.blockedInput || this.wheelOpen || this.menuOpen || this.deathT >= 0; }
  fixedUpdate(dt: number) {
    const pv = this.playerVehicle;
    const blocked = this.inputBlocked;
    if (pv) {
      const mv = this.input.moveAxes();
      pv.input.throttle = pv.destroyed || blocked ? 0 : this.input.throttle();
      pv.input.steer = blocked ? 0 : -mv.x;
      pv.input.handbrake = !blocked && this.input.held('handbrake');
    }
    this.playerCtl.fixedUpdate(dt, { canAim: this.pcombat.armed, blocked: !!this.entering || blocked });
    if (this.player.knockT > 0) this.player.knockT -= dt;
    this.traffic.fixedUpdate(dt, this.player, pv);
    for (const v of this.vehicles.list) {
      if (!v.driver && v !== pv) { v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true; }
      v.phys.fixedUpdate(dt, v.input);
    }
    this.pop.fixedUpdate(dt, this.player.pos);
    this.physics.step(dt);
    this.vehicles.postStep(this.time);
    this.pop.vehicleHits(this.vehicles.list, this.player, (v, sp) => this.hitByVehicle(v, sp));
    this.pop.dodge(this.vehicles.list);
    if (pv) { const p = pv.position; this.stats.distance += Math.abs(pv.speed) * dt; this.player.pos.set(p.x, p.y, p.z); }
    // Safety net: never fall out of the world
    if (this.player.pos.y < -30 || !Number.isFinite(this.player.pos.x)) this.safeRespawn();
    for (const v of this.vehicles.list) { const p = v.position; if (p.y < -25 || !Number.isFinite(p.x)) { if (v === pv) this.exitVehicle(true); v.phys.teleport(Number.isFinite(p.x) ? p.x : 0, 2, Number.isFinite(p.z) ? p.z : 0, 0); } }
  }
  private hitByVehicle(v: Vehicle, sp: number) {
    if (this.playerVehicle) return;
    const killed = this.player.damage(sp * 4, v.driver, this.time);
    const vel = v.phys.body.linvel();
    this.player.vel.set(vel.x * 0.7, 4, vel.z * 0.7);
    this.player.human.playOnce('Roll', 'full', 0.05);
    this.cam.addShake(0.5);
    this.audio.play('hitBody', { pos: this.player.pos });
    if (killed) this.playerDown('down');
  }
  /** Enter the nearest vehicle (carjacking if occupied) or leave the current one. */
  toggleVehicle() {
    if (this.entering || !this.player.alive || this.deathT >= 0) return;
    if (this.playerVehicle) { this.exitVehicle(); return; }
    const v = this.vehicles.nearest(this.player.pos, 4.2, c => !c.destroyed && !c.locked && Math.abs(c.speed) < 6);
    if (!v) return;
    const jack = !!v.driver && v.driver !== this.player;
    this.entering = { v, t: 0, from: this.player.pos.clone(), jack };
    this.player.human.playOnce('Interact', 'upper', 0.1);
    this.audio.play('doorOpen', { pos: v.position });
  }
  private updateEntering(dt: number) {
    const e = this.entering; if (!e) return;
    e.t += dt;
    const door = e.v.doorPoint(1);
    const k = Math.min(1, e.t / 0.4);
    this.player.pos.lerpVectors(e.from, door, k * k * (3 - 2 * k)); this.player.pos.y = e.from.y;
    this.player.body.setNextKinematicTranslation({ x: this.player.pos.x, y: this.player.pos.y + 0.87, z: this.player.pos.z });
    this.player.faceTowards(Math.atan2(e.v.position.x - door.x, e.v.position.z - door.z), 10, dt);
    this.player.human.setSpeed(k < 1 ? 2 : 0);
    if (e.jack && e.t > 0.3 && e.v.driver && e.v.driver !== this.player) {
      const car = this.traffic.carOf(e.v);
      const n = this.traffic.eject(car, e.v, -1);
      if (n) n.char.human.playOnce('Hit_Chest', 'full', 0.05);
      this.police.report(e.v.kind === 'police' ? 'copCarTheft' : 'carjack', this.player.pos);
      this.pop.danger(this.player.pos, 20, this.player);
    }
    if (e.t >= 0.55) {
      this.entering = null;
      if (e.v.destroyed || (e.v.driver && e.v.driver !== this.player)) return;
      this.seatPlayer(e.v);
    }
  }
  seatPlayer(v: Vehicle) {
    this.playerVehicle = v; v.driver = this.player; this.player.inVehicle = v;
    this.traffic.unpark(v);
    this.player.setCollision(false);
    const h = this.player.human;
    v.visual.add(h.root);
    h.root.position.copy(v.seatOffset()); h.root.rotation.set(0, 0, 0);
    h.setState('drive'); h.setUpperMode('none'); h.setSpeed(0);
    this.cam.snapBehind(v.yaw + Math.PI);
    this.audio.play('doorClose', { pos: v.position });
    this.audio.play('engineStart', { pos: v.position });
    this.audio.setRadioActive(true);
    this.events.onVehicleEntered(v);
  }
  exitVehicle(force = false) {
    const v = this.playerVehicle; if (!v) return;
    void force;
    const pos = this.findExitPoint(v);
    const fast = Math.abs(v.speed) > 9 && !v.destroyed;
    this.playerVehicle = null; v.driver = null; this.player.inVehicle = null;
    v.input.throttle = 0; v.input.handbrake = !fast;
    const h = this.player.human;
    this.renderer.scene.add(h.root);
    this.player.place(pos.x, Math.max(pos.y, v.position.y - 0.2), pos.z, v.yaw);
    this.player.setCollision(true);
    h.setState('loco');
    if (fast) { h.playOnce('Roll', 'full', 0.05); this.player.damage(Math.min(25, Math.abs(v.speed) * 0.8), null, this.time); this.cam.addShake(0.4); }
    this.cam.snapBehind(v.yaw + Math.PI);
    this.audio.play('doorClose', { pos: v.position });
    this.audio.setRadioActive(false);
    this.events.onVehicleExited(v);
  }
  private findExitPoint(v: Vehicle): THREE.Vector3 {
    for (const side of [1, -1] as const) {
      const p = v.doorPoint(side);
      const from = v.position.clone(); from.y += 0.9;
      const dir = p.clone().setY(from.y).sub(from); const len = dir.length(); dir.normalize();
      const hit = this.physics.ray(from.x, from.y, from.z, dir.x, dir.y, dir.z, len + 0.4, undefined, null, v.phys.body);
      if (!hit) { p.y = v.position.y + 0.1; return p; }
    }
    const p = v.position.clone(); p.y += v.tpl.bbox.max.y + 0.3; return p;
  }
  /** The player is down (health 0) or arrested. */
  playerDown(kind: 'down' | 'busted') {
    if (this.deathT >= 0) return;
    this.deathT = 0; this.deathKind = kind;
    if (this.playerVehicle) this.exitVehicle(true);
    if (kind === 'busted') this.player.human.setState('crouch');
    else if (this.player.alive) this.player.kill();
    const fee = Math.min(this.money, Math.max(50, Math.floor(this.money * 0.1)));
    this.addMoney(-fee);
    this.audio.play('down');
    this.events.onDeath(kind, kind === 'down' ? `Medical bill  -$${fee}` : `Bail  -$${fee}`);
  }
  private respawn() {
    const place = this.deathKind === 'down' ? CLINIC : PRECINCT;
    if (this.playerVehicle) this.exitVehicle(true);
    this.player.revive(this.player.maxHealth); this.player.armor = 0;
    this.player.place(place.x, 0.25, place.z, place.yaw);
    this.player.setCollision(true);
    this.renderer.scene.add(this.player.human.root);
    this.cam.snapBehind(place.yaw);
    this.police.clear();
    this.deathT = -1;
    this.player.human.setState('loco');
    this.events.onRespawn();
  }
  safeRespawn() {
    if (this.playerVehicle) this.exitVehicle(true);
    this.player.place(this.respawnPoint.x, 0.3, this.respawnPoint.z, this.respawnPoint.yaw);
  }
  addMoney(d: number) { this.money = Math.max(0, Math.round(this.money + d)); if (d !== 0) this.events.onMoney(d); }
  spawnPickup(kind: Pickup['kind'], amount: number, at: THREE.Vector3, weapon?: keyof typeof WEAPONS, persistent = false): Pickup {
    const g = new THREE.Group();
    const color = kind === 'cash' ? '#6fd08c' : kind === 'health' ? '#ff6b6b' : kind === 'armor' ? '#5fa8ff' : '#ffc37e';
    const core = new THREE.Mesh(kind === 'cash' ? new THREE.BoxGeometry(0.32, 0.08, 0.18) : new THREE.OctahedronGeometry(0.22), new THREE.MeshStandardMaterial({ color, emissive: new THREE.Color(color), emissiveIntensity: 0.6, roughness: 0.4 }));
    core.castShadow = true; g.add(core);
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.35, 0.5, 24).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.35, depthWrite: false }));
    ring.position.y = -0.45; g.add(ring);
    g.position.set(at.x, Math.max(at.y, 0.2) + 0.55, at.z);
    this.renderer.scene.add(g);
    const p: Pickup = { id: this.pickupId++, kind, amount, weapon, pos: g.position, mesh: g, ttl: persistent ? Infinity : 45, persistent };
    this.pickups.push(p); return p;
  }
  private updatePickups(dt: number) {
    for (const p of [...this.pickups]) {
      p.ttl -= dt;
      p.mesh.children[0].rotation.y += dt * 2; p.mesh.children[0].position.y = Math.sin(this.time * 3 + p.id) * 0.06;
      const near = !this.playerVehicle && this.player.alive && Math.hypot(p.pos.x - this.player.pos.x, p.pos.z - this.player.pos.z) < 1.2 && Math.abs(p.pos.y - 0.55 - this.player.pos.y) < 1.6;
      if (near) {
        if (p.kind === 'cash') { this.addMoney(p.amount); this.audio.play('money'); }
        else if (p.kind === 'health') { if (this.player.health >= this.player.maxHealth) continue; this.player.health = Math.min(this.player.maxHealth, this.player.health + p.amount); this.audio.play('pickup'); this.events.onToast('+ Health', 'info'); }
        else if (p.kind === 'armor') { if (this.player.armor >= 100) continue; this.player.armor = Math.min(100, this.player.armor + p.amount); this.audio.play('pickup'); this.events.onToast('+ Armor', 'info'); }
        else if ((p.kind === 'ammo' || p.kind === 'weapon') && p.weapon) { this.pcombat.give(p.weapon, p.amount); this.audio.play('pickup'); this.events.onToast(`${WEAPONS[p.weapon].name}  +${p.amount}`, 'info'); }
        this.removePickup(p);
      } else if (p.ttl <= 0) this.removePickup(p);
    }
  }
  removePickup(p: Pickup) { const i = this.pickups.indexOf(p); if (i >= 0) this.pickups.splice(i, 1); p.mesh.removeFromParent(); }
  update(dt: number, raw = dt) {
    this.time += dt;
    this.hour = (this.hour + (dt / this.dayLength) * 24) % 24;
    const blocked = this.inputBlocked;
    if (!this.paused && !blocked) {
      const look = this.input.lookDelta(raw);
      this.cam.addInput(look.x, look.y, this.settings.sensitivity * (this.pcombat.aiming ? 0.6 : 1), this.settings.invertY);
    }
    if (!this.paused && !blocked && this.input.justPressed('enter')) this.toggleVehicle();
    this.updateEntering(dt);
    const pv = this.playerVehicle;
    if (pv) {
      this.player.human.update(dt);
      if (!blocked) {
        if (this.input.justPressed('horn')) { this.audio.play('horn', { pos: pv.position }); this.pop.danger(pv.position, 10, null); }
        if (this.input.justPressed('headlights')) pv.headlights = !pv.headlights;
        if (this.input.justPressed('camera')) this.cam.zoomLevel = (this.cam.zoomLevel + 1) % 3;
        if (this.input.justPressed('radio')) { const st = this.audio.radioNext(); this.events.onToast(st ? `Radio  ${st}` : 'Radio off', 'info'); }
      }
      if (pv.destroyed && pv.burnTime > 2.5) this.exitVehicle(true);
    } else {
      if (!this.entering) this.playerCtl.updateAnimation();
      this.player.updateVisual(dt);
      if (!blocked && this.input.justPressed('camera')) this.cam.zoomLevel = (this.cam.zoomLevel + 1) % 2;
    }
    this.pcombat.update(dt, blocked || !!this.entering, () => this.pop.characters(), () => this.vehicles.list);
    this.combat.update(dt);
    this.vehicles.update(dt, this.renderer.skyState.night, this.time, this.renderer.camera.position, pv);
    this.pop.update(dt, this.renderer.camera, this.player.pos, this.renderer.quality.pedestrians);
    this.traffic.update(dt, this.renderer.camera, this.player.pos, this.renderer.quality.traffic);
    this.police.update(dt, this.player, !!pv, this.renderer.camera);
    this.updatePickups(dt);
    this.particles.update(dt, this.renderer.renderer.domElement.height);
    if (this.deathT >= 0) { this.deathT += raw; if (this.deathT > 4.2) this.respawn(); }
    this.cam.baseFov = this.settings.fov;
    if (this.deathT >= 0) this.cam.update(raw, this.player.pos, 'dead');
    else if (pv) this.cam.update(raw, pv.position, 'vehicle', { vehicleYaw: pv.yaw + Math.PI, speed: pv.speed, vehicleSize: pv.size, exclude: pv.phys.body });
    else this.cam.update(raw, this.player.pos, this.pcombat.aiming && this.pcombat.armed ? 'aim' : 'foot');
    const camDir = this.renderer.camera.getWorldDirection(new THREE.Vector3());
    this.audio.setListener(this.renderer.camera.position, camDir);
    this.renderer.updateEnvironment(this.hour, this.time, this.player.pos);
    nightUniform.value = this.renderer.skyState.night;
    timeUniform.value = this.time;
    this.updateSignals();
    this.updateLamps(dt);
    this.cullChunks();
    if (this.visuals.ferris) {
      const w = this.visuals.ferris; w.rotation.z += dt * 0.05;
      for (const g of w.userData.gondolas as THREE.Object3D[]) g.rotation.z = -w.rotation.z;
      (w.userData.ringMat as THREE.MeshStandardMaterial).emissiveIntensity = this.renderer.skyState.night * 2.2;
    }
  }
  // ---------------- Street lamps ----------------
  private buildLamps() {
    const heads = this.visuals.lampHeads;
    this.lampBulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6), toneMapped: false }), heads.length);
    this.lampPools = new THREE.InstancedMesh(new THREE.PlaneGeometry(9, 9).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(1, 0.72, 0.42), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), heads.length);
    const m = new THREE.Matrix4();
    heads.forEach((h, i) => { m.makeTranslation(h.x, h.y - 0.1, h.z); this.lampBulbs.setMatrixAt(i, m); m.makeTranslation(h.x, 0.21, h.z); this.lampPools.setMatrixAt(i, m); });
    this.lampBulbs.computeBoundingSphere(); this.lampPools.computeBoundingSphere();
    this.lampPools.renderOrder = 1;
    this.renderer.scene.add(this.lampBulbs, this.lampPools);
    for (let i = 0; i < 8; i++) { const l = new THREE.PointLight(0xffc98a, 0, 22, 1.6); this.renderer.scene.add(l); this.lampLights.push(l); }
  }
  private updateLamps(dt: number) {
    const night = this.renderer.skyState.night;
    const on = THREE.MathUtils.smoothstep(night, 0.15, 0.5);
    (this.lampBulbs.material as THREE.MeshBasicMaterial).color.setRGB(0.4 + on * 3.2, 0.35 + on * 2.6, 0.3 + on * 1.6);
    (this.lampPools.material as THREE.MeshBasicMaterial).opacity = on * 0.55;
    this.lampTimer -= dt;
    const n = this.renderer.quality.pointLights;
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.4;
      const cp = this.renderer.camera.position;
      const sorted = this.visuals.lampHeads.map((h, i) => ({ i, d: h.distanceToSquared(cp) })).sort((a, b) => a.d - b.d);
      this.lampLights.forEach((l, k) => { if (k < n && sorted[k]) l.position.copy(this.visuals.lampHeads[sorted[k].i]).setY(this.visuals.lampHeads[sorted[k].i].y - 0.4); });
    }
    // Lights stay in the scene (constant light count avoids shader recompiles); intensity fades them.
    this.lampLights.forEach((l, k) => { l.intensity = k < n ? on * 28 : 0; });
  }
  private signalTimer = 0;
  private updateSignals() {
    this.signalTimer -= 1;
    if (this.signalTimer > 0) return; this.signalTimer = 8;
    const lamps = this.visuals.signalLamps;
    const cols = { red: new THREE.Color(4, 0.25, 0.2), yellow: new THREE.Color(4, 2.4, 0.3), green: new THREE.Color(0.4, 4, 1.6) };
    const off = new THREE.Color(0.06, 0.06, 0.06);
    for (const h of this.visuals.signalHeads) {
      const st = signalState(this.city.intersections[h.inter], h.axis, this.time);
      lamps.setColorAt(h.lamps[0], st === 'red' ? cols.red : off);
      lamps.setColorAt(h.lamps[1], st === 'yellow' ? cols.yellow : off);
      lamps.setColorAt(h.lamps[2], st === 'green' ? cols.green : off);
    }
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  }
  private cullChunks() {
    const cp = this.renderer.camera.position; const max = this.renderer.quality.drawDistance + 60;
    const shadowR = this.renderer.quality.shadowRange * 1.3 + 10;
    for (const m of this.visuals.chunkMeshes) {
      const mesh = m as THREE.Mesh;
      const bs = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh ? (mesh as unknown as THREE.InstancedMesh).boundingSphere : mesh.geometry.boundingSphere;
      if (!bs) continue;
      const d = Math.hypot(bs.center.x - cp.x, bs.center.z - cp.z) - bs.radius;
      mesh.visible = d < (mesh.userData.small ? Math.min(max, 200) : max);
      if (mesh.userData.shadow === undefined) mesh.userData.shadow = mesh.castShadow;
      const ds = Math.hypot(bs.center.x - this.player.pos.x, bs.center.z - this.player.pos.z) - bs.radius;
      mesh.castShadow = mesh.userData.shadow && ds < shadowR;
    }
  }
  // ---------------- HUD data ----------------
  streetName(x: number, z: number): string {
    let bi = -1, bd = 12; AVENUES.forEach((a, i) => { const d = Math.abs(x - a); if (d < bd) { bd = d; bi = i; } });
    let si = -1, sd = 12; STREETS.forEach((s, i) => { const d = Math.abs(z - s); if (d < sd) { sd = d; si = i; } });
    if (bi >= 0 && (si < 0 || bd < sd)) return AVENUE_NAMES[bi];
    if (si >= 0) return STREET_NAMES[si];
    return '';
  }
  hudState(objective: string | null, timer: number | null): HudState {
    const pv = this.playerVehicle, inv = this.pcombat.inv, def = inv.def;
    const h = Math.floor(this.hour), mi = Math.floor((this.hour % 1) * 60);
    return {
      health: this.player.health, maxHealth: this.player.maxHealth, armor: this.player.armor, money: this.money,
      heat: this.police.heat, heatMax: 5, heatFlash: this.police.heat > 0 && !this.police.state.seen,
      weaponName: def.name, weaponIcon: def.icon, ammoClip: def.melee ? -1 : inv.state.clip, ammoReserve: inv.state.reserve, reloading: inv.reloading,
      objective, vehicleSpeedKmh: pv ? Math.abs(pv.speed) * 3.6 : null, vehicleName: pv ? pv.name : null, vehicleHealth: pv ? pv.health / pv.spec.health : null,
      district: DISTRICT_INFO[districtAt(this.city, this.player.pos.x, this.player.pos.z)].name, streetName: this.streetName(this.player.pos.x, this.player.pos.z),
      clock: `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`,
      crosshair: pv || this.deathT >= 0 ? 'none' : this.pcombat.armed ? (this.pcombat.aiming ? 'aim' : 'dot') : 'none', crosshairSpread: this.pcombat.spread + (this.playerCtl.aiming ? def.aimSpread : def.spread),
      hitMarker: this.pcombat.hitMarker, interactPrompt: this.interactPrompt(), radio: null, missionTimer: timer, stamina: this.playerCtl.stamina,
      fps: this.settings.showFps ? Math.round(this.fps) : null,
    };
  }
  interactPrompt(): string | null {
    if (this.playerVehicle || this.entering || this.deathT >= 0) return null;
    const v = this.vehicles.nearest(this.player.pos, 4.2, c => !c.destroyed && !c.locked && Math.abs(c.speed) < 6);
    if (!v) return null;
    const key = this.settings.bindings.enter[0]?.replace('Key', '') ?? 'F';
    return v.driver ? `${key}  Take the ${v.name}` : `${key}  Enter ${v.name}`;
  }
  baseBlips(): MinimapBlip[] {
    const b: MinimapBlip[] = [];
    for (const n of this.pop.npcs) if (n.alive && (n.role === 'police' || (n.role === 'gang' && n.hostile)) && n.pos.distanceTo(this.player.pos) < 120 && !n.char.inVehicle) b.push({ x: n.pos.x, z: n.pos.z, kind: n.role === 'police' ? 'police' : 'enemy' });
    for (const u of this.police.units) b.push({ x: u.v.position.x, z: u.v.position.z, kind: 'police' });
    if (this.waypoint) b.push({ x: this.waypoint.x, z: this.waypoint.z, kind: 'waypoint' });
    return b;
  }
  /** Debug helper: spawns a line-up of people in front of the player (used for visual checks). */
  debugLineup(n = 6, seed = 1) {
    const out: Character[] = [];
    for (let i = 0; i < n; i++) {
      const c = new Character(this.physics, this.humanTpl, randomLook(seed + i), 'civilian', this.player.pos.x - (n - 1) + i * 2, this.player.pos.z - 4, this.player.pos.y);
      c.yaw = 0; this.renderer.scene.add(c.human.root); out.push(c);
    }
    return out;
  }
}
const tick = () => new Promise<void>(r => setTimeout(r, 0));
export type { Crime };
