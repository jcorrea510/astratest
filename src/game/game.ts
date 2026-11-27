/** Game orchestrator: owns the world, systems and the main loop. */
import * as THREE from 'three';
import { shouldSkipRaf, nearestLamps } from './frameUtil';
import { addPooledLight } from '../render/lightPool';
import { Renderer, skipHiddenMatrices } from '../render/renderer';
import { Physics, groups, ALL, G_STATIC, G_VEHICLE, G_PROP } from '../core/physics';
import { Input } from '../core/input';
import type { Settings } from '../core/settings';
import { distToPath } from '../world/westside';
import { generateCity, type CityMap, signalState, districtAt, surfaceAt, WATER_LEVEL, DISTRICT_INFO, AVENUES, STREETS, AVENUE_NAMES, STREET_NAMES } from '../world/citymap';
import { precinctCarSpots } from '../world/precinct';
import { buildCity, type CityVisuals } from '../world/citybuild';
import { worldGlass } from '../world/glass';
import type { Assets } from '../world/assets';
import { Human, loadHumanTemplate, warmBodies, type HumanTemplate, randomLook, PLAYER_DEFAULT_LOOK } from '../actors/human';
import { Character } from '../actors/character';
import { CameraRig } from './camera';
import { PlayerController } from './player';
import { nightUniform, timeUniform, glowTexture } from '../render/materials';
import { Particles, SkidMarks } from '../render/particles';
import { VehicleManager } from './vehicles';
import { pedImpact } from './impact';
import { setRealisticDriving } from '../vehicles/vehiclePhysics';
import { Vehicle } from '../vehicles/vehicle';
import type { GameAudio, HudState, MinimapBlip } from '../ui/contracts';
import { NullAudio } from './nullAudio';
import { Combat } from '../combat/combat';
import { PlayerCombat } from './playerCombat';
import { Population } from './population';
import { RagdollSystem } from '../actors/ragdoll';
import { Breakables } from './breakables';
import { Traffic } from './traffic';
import { Crowd } from './crowd';
import { BusService } from './buses';
import { BENCHES } from '../world/benches';
import { Police, policeSeesArmed, type Crime } from './police';
import type { Npc } from '../actors/npc';
import { WEAPONS } from '../combat/weapons';
import { downPenalty, type GameMode } from './modes';
import { CarEntry, type Enterable } from './carEntry';
import { COP_LOOK } from './dispatch';
import { getTemplate } from '../vehicles/models/build';
import { TRAFFIC_MIX, PARKED_MIX } from '../vehicles/specs';
import { HeliManager } from '../vehicles/helicopterManager';
import { ArmyAir, HeliArms, armyAirWanted, inArmyBase } from './armyAir'; // R5-A: army base gunships
import { armyLayout, buildArmyBaseLod, armyLodVisible } from '../world/armybase';
import { ArmyGuards, guardsHostile } from './armyGuards';
import { farIdleVehicle, chunkCull, type ChunkBox } from './farLod';
import { fullscreenSettling } from '../core/fullscreen';
import { Helicopter } from '../vehicles/helicopter';
import { fmtClock12 } from '../core/units';
import type { HeliVariant } from '../vehicles/helicopterModel';
import { Blood } from '../render/blood'; // R6-F
import { CombatFx } from '../ui/combatfx';
import { Orders } from './orders';
import { signalLampColors, signalOffColors } from '../render/signalColors';
import { TaxiRide } from './taxiRide';
import { TaxiJob } from './taxiJob';
import { LoopGuard } from './loopGuard';

export const PLAYER_LOOK = PLAYER_DEFAULT_LOOK; // [PEOPLE] distinctive default outfit
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
  /** sandbox overrides: traffic / pedestrian caps (null = quality preset) and a stoppable clock */
  trafficCap: number | null = null; pedCap: number | null = null; clockRunning = true;
  targetTimeScale = 1;
  paused = false;
  menuOpen = false;
  /** Round 9: a scripted camera (the garage bay) that takes over the rig while it returns true. */
  camOverride: ((raw: number) => boolean) | null = null;
  dayLength = 24 * 60;
  private acc = 0;
  private rafEma = 16.7; private lastRaf = 0;
  private camDirTmp = new THREE.Vector3();
  private _airDir = new THREE.Vector3();
  private _airVel = new THREE.Vector3();
  private lampPick: { i: number; d: number }[] = [];
  private last = 0;
  private running = false;
  fps = 60; /** Round 11: smoothed CPU ms per frame (sim + draw submission) */ cpuMs = 8;
  frameMs = 16;
  onFrame: ((dt: number) => void) | null = null;
  particles!: Particles;
  skids!: SkidMarks;
  vehicles!: VehicleManager;
  combat!: Combat;
  pcombat!: PlayerCombat;
  pop!: Population;
  ragdolls!: RagdollSystem;
  breakables!: Breakables;
  private lampOrig: THREE.Vector3[] = [];
  traffic!: Traffic;
  crowd!: Crowd;
  buses!: BusService;
  /** every bench in the world (debug / tests) */
  readonly benches = BENCHES;
  police!: Police;
  playerVehicle: Vehicle | null = null;
  /** R6-F: orders / hostages, blood, damage feedback */
  orders!: Orders; taxi!: TaxiRide; taxiJob!: TaxiJob; blood!: Blood; fx: CombatFx | null = null;
  private lowRingT = 0; private wasLow = false;
  /** the car the player last got out of (kept out of mission clean-ups) */
  lastPlayerVehicle: Vehicle | null = null;
  money = 250;
  /** Regular (earn everything, losses on death) or Sandbox (tools, no losses). Set when a game starts / loads. */
  mode: GameMode = 'sandbox';
  pickups: Pickup[] = [];
  private pickupId = 0;
  deathT = -1;
  deathKind: 'down' | 'busted' = 'down';
  /** [UI] regular mode: what the death cost (shown as a notice after respawning) */
  deathNotice = '';
  /** [UI] seconds from going down to respawning (the UI stretches it while an arrest animation / title card plays) */
  respawnDelay = 4.2;
  /** [UI] title-screen flyover: the hidden player cannot be hit or go down */
  ghost = false;
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
    onBeforeDown: () => { },
    /** [UI] police hook: set to play the handcuff animation; call done() when it ends and the ARRESTED card follows */
    arrestAnimationDone: null as ((done: () => void) => void) | null,
  };
  wheelOpen = false;
  blockedInput = false;
  waypoint: THREE.Vector3 | null = null;
  /** CAR-ENTRY: animated getting in / out, carjacks, break-ins and hotwiring */
  carEntry!: CarEntry;
  helis!: HeliManager;
  playerHeli: Helicopter | null = null;
  armyAir!: ArmyAir; heliArms!: HeliArms; armyGuards!: ArmyGuards; armyLod!: THREE.Mesh;
  private lampLights: THREE.PointLight[] = [];
  private lampBulbs!: THREE.InstancedMesh;
  private lampPools!: THREE.InstancedMesh;
  private lampHalos!: THREE.InstancedMesh;
  private lampTimer = 0;
  private prevVehSpeed = 0;
  respawnPoint = { x: SPAWN.x, z: SPAWN.z, yaw: SPAWN.yaw };
  private ambT = 0;
  /** Police vehicle models are built one per ~1.5 s in the background so the first patrol car never hitches a fight. */
  private warmKinds: ('police' | 'fbi' | 'swat' | 'army' | 'tank')[] = ['police', 'fbi', 'swat', 'army', 'tank'];
  private warmT = 4;

  constructor(public canvas: HTMLCanvasElement, public settings: Settings, public assets: Assets, public audio: GameAudio = new NullAudio()) {
    this.renderer = new Renderer(canvas);
    this.renderer.setQuality(settings.quality); this.renderer.setLook(settings.look);
    setRealisticDriving(settings.driving === 'realistic');
    this.input = new Input(settings, canvas);
    this.city = generateCity();
  }
  async init(onProgress: (f: number, label: string) => void) {
    onProgress(0.05, 'Laying out streets');
    await tick();
    this.visuals = buildCity(this.renderer.scene, this.physics, this.assets, this.city);
    // Freeze every static mesh under visuals.root (skipping the rotating Ferris wheel and its gondolas)
    const ferris = this.visuals.ferris;
    const freezeStatic = (o: THREE.Object3D) => {
      if (o === ferris) return;
      o.updateMatrix();
      o.updateMatrixWorld(true);
      o.matrixAutoUpdate = false;
      o.matrixWorldAutoUpdate = false;
      for (let i = 0; i < o.children.length; i++) freezeStatic(o.children[i]);
    };
    this.visuals.root.updateMatrix();
    this.visuals.root.updateMatrixWorld(true);
    this.visuals.root.matrixAutoUpdate = false;
    for (let i = 0; i < this.visuals.root.children.length; i++) freezeStatic(this.visuals.root.children[i]);
    skipHiddenMatrices(this.visuals.root);
    this.buildLamps();
    onProgress(0.55, 'Waking up the locals');
    await tick();
    this.humanTpl = await loadHumanTemplate(this.assets.human); // [PEOPLE] realistic bodies + retargeted clips
    Human.lodFrom = this.renderer.camera.position;
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
    this.helis = new HeliManager(this.renderer.scene, this.physics, this.particles, this.audio);
    this.helis.init();
    this.carEntry = new CarEntry(this);
    this.combat = new Combat(this.physics, this.particles, this.audio, this.renderer.scene);
    this.combat.worldGlass = worldGlass;
    this.blood = new Blood(this.renderer.scene); this.blood.enabled = this.settings.blood; this.combat.blood = this.blood;
    try { this.fx = new CombatFx(this.canvas.parentElement ?? document.body); } catch { this.fx = null; }
    worldGlass.onBreak = pane => { this.particles.decals.clearIn(pane.x, pane.y, pane.z, pane.yaw, pane.w, pane.h, pane.inst >= 0 ? 1.7 : 0.4); }; // shot-out glass loses its bullet holes
    this.combat.groundSurface = (x, z) => surfaceAt(this.city, x, z); // dirt on park/beach ground, splashes on water
    this.pcombat = new PlayerCombat(this.player, this.playerCtl, this.input, this.cam, this.combat, this.physics, this.audio, this.renderer.scene);
    this.pop = new Population(this.renderer.scene, this.humanTpl, this.city, {
      physics: this.physics, city: this.city, combat: this.combat, scene: this.renderer.scene, time: () => this.time,
      player: this.player, playerHeat: () => this.police.heat, others: () => this.pop.characters(), movers: () => this.movers(),
      onArrest: (by) => { if (this.deathT < 0 && !this.playerVehicle) this.police.dispatch.beginArrest(by, this.player); }, copsLethal: () => this.police.lethal, copsHoldFire: (by) => this.police.dispatch.arresting || (!!by && !this.orders.clearShot(by.pos)), armedThreat: () => this.police.armedThreat, onWitness: () => { },
    }, this.audio);
    this.combat.onIgnite = c => this.pop.panicBurn(c);
    this.ragdolls = new RagdollSystem(this.physics); this.pop.ragdolls = this.ragdolls;
    this.breakables = new Breakables(this.renderer.scene, this.physics, this.visuals.breakables, {
      onLamp: (i, on) => this.setLamp(i, on), sfx: (n, at, vol) => this.audio.play(n as 'crash', { pos: at, volume: vol }),
      splash: (x, y, z, n) => this.particles.splash(x, y, z, n), sparks: (x, y, z, n) => this.particles.sparks(x, y, z, n, 6),
    });
    // Round 8 gore: a hard hit by a car leaves blood on the road (and keeps bleeding), sprayed along the car's path
    this.pop.onCarHit = (ch, v, sp) => {
      const b = this.blood; if (!b.enabled) return;
      const vel = v.phys.body.linvel(), hd = Math.hypot(vel.x, vel.z) || 1, d = new THREE.Vector3(vel.x / hd, 0.2, vel.z / hd), k = Math.min(2, sp / 9);
      const at = new THREE.Vector3(ch.pos.x, ch.pos.y + 1, ch.pos.z);
      this.particles.blood(at.x, at.y, at.z, d.x, 0.5, d.z, 1.2 * k);
      b.hit(at, d, ch.pos.y, k, null, null);
      for (let i = 0; i < Math.round(2 + k * 2); i++) b.splat(ch.pos.x + d.x * (1 + i * 1.3), ch.pos.y + 0.01, ch.pos.z + d.z * (1 + i * 1.3), 0, 1, 0, 0.25 + Math.random() * 0.25);
      if (!ch.alive) b.pool(ch.pos.x, ch.pos.y, ch.pos.z, ch.pos);
    };
    this.pop.aimProvider = () => { if (!this.pcombat.threatening || !this.pcombat.armed) return null; const from = new THREE.Vector3(), dir = new THREE.Vector3(); this.cam.aimRay(from, dir); return { from, dir }; }; // [PEOPLE] civilians react to being aimed at
    this.traffic = new Traffic(this.city, this.vehicles, this.pop, this.audio, () => this.time);
    this.buses = new BusService(this.renderer.scene, this.city, this.traffic, this.pop, () => this.time);
    this.crowd = new Crowd(this.renderer.scene, this.city, this.vehicles, () => this.time);
    this.crowd.onNewLook = l => this.pop.queueWarm(l); // Round 7 perf: build a far person's hair / clothes extras before they come close
    for (const r of this.buses.routes) for (const st of r.stops) this.crowd.clearSlotsNear(st.x, st.z, 14); // no parking at bus stops
    this.crowd.wire(this.traffic, this.pop, () => ({ traffic: this.trafficCap ?? this.renderer.quality.traffic, peds: this.pop.maxCivilians })); // far crowd hands over to real cars/people (no vanishing)
    this.police = new Police(this.city, this.pop, this.traffic, this.audio, this.renderer.scene);
    this.police.dispatch.initLights(); // Round 8: lights exist from the start
    this.police.clock = () => this.time;
    this.police.setHooks({
      combat: this.combat, cam: this.cam, night: () => this.renderer.skyState.night,
      dragOut: (v, side, puller) => this.carEntry.dragOut(v, side, puller),
      busted: () => this.playerDown('busted'),
      spawnHeli: (x, z, yaw) => this.spawnHelicopter('police', x, z, yaw),
      removeHeli: h => this.helis.remove(h),
      sfx: (name, at) => this.audio.play(name, { pos: at }),
    });
    this.orders = new Orders(this);
    this.taxiJob = new TaxiJob(this);
    const game = this; // eslint-disable-line @typescript-eslint/no-this-alias
    this.taxi = new TaxiRide({
      player: this.player as never, traffic: this.traffic, vehicles: this.vehicles, city: this.city,
      get waypoint() { return game.waypoint; }, get money() { return game.money; }, addMoney: d => this.addMoney(d),
      scene: this.renderer.scene, toast: (m, k) => this.events.onToast(m, (k ?? 'info') as never), sound: (n, p) => this.audio.play(n as never, { pos: p }),
    });
    this.events.arrestAnimationDone = this.police.dispatch.animHook; // [POLICE] the cop cuffs the player before the ARRESTED card
    this.police.onHeatChange = (h, lost) => { if (lost) this.events.onToast('You lost the heat', 'heat'); else this.events.onToast(`Heat ${h}`, 'heat'); };
    this.wireEvents();
    this.playerCtl.onFallDamage = (d) => { if (!this.ghost && this.player.damage(d, null, this.time)) this.playerDown('down'); };
    this.playerCtl.onSound = (snd, vol) => { if (snd === 'footstep') { this.stepSound(this.player.pos, vol); return; } this.audio.play(snd, { pos: this.player.pos, volume: vol, pitch: 1 }); if (snd === 'splash') this.particles.splash(this.player.pos.x, this.player.pos.y + 1, this.player.pos.z); };
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
      if (e.shooter === this.player) this.traffic.gunfire(e.origin, this.player.pos, e.hits); // drivers nearby floor it
      if (e.shooter === this.player) this.police.report('shooting', this.player.pos);
    };
    this.combat.onHit = (target, _dmg, from, _head, killed, w) => {
      const npc = this.pop.npcs.find(n => n.char === target);
      if (from === this.player && npc) {
        if (npc.role === 'police') { this.police.report(killed ? 'copKill' : 'copAttack', this.player.pos); this.police.copHit(npc); }
        else this.police.report(killed ? 'kill' : 'assault', this.player.pos);
        if (npc.role === 'gang' && npc.alive) { npc.hostile = true; npc.brain = 'combat'; npc.target = this.player; npc.seenTime = this.time; npc.lastSeen.copy(this.player.pos); }
        if (npc.role === 'civilian' && npc.alive) this.pop.runner.provoke(npc, this.player, w.id === 'fists', killed); // bare-fisted: brave people fight back
        if (killed) { this.stats.kills++; this.onNpcKilled(npc, from); }
      } else if (npc && killed) this.onNpcKilled(npc, from);
      if (target === this.player && killed) this.playerDown('down');
      if (target === this.player) this.onPlayerHurt(from, _dmg);
      else if (from === this.player && npc?.role === 'civilian') this.orders.noteHurt(npc);
    };
    this.combat.onVehicleHit = (v, from) => { if (from === this.player) { this.police.onVehicleShot(v); this.traffic.panic(v); } };
    this.combat.helis = () => this.helis.list;
    this.combat.onExplosion = (at, by, R) => this.explosion(at, by, R); // COMBAT: grenades / rockets damage people like car explosions
    this.pop.onKilled = (n, by) => { if (by === this.player) { this.police.report(n.role === 'police' ? 'copKill' : 'kill', this.player.pos); this.stats.kills++; } this.onNpcKilled(n, by); };
    this.pcombat.onKill = (headshot) => { this.renderer.pulseImpact(headshot ? 0.36 : 0.18); };
    this.vehicles.onCrash = e => {
      if (e.vehicle === this.playerVehicle) {
        this.cam.addShake(Math.min(0.8, e.impact / 18));
        if (e.impact > 7) this.renderer.pulseImpact(Math.min(0.75, (e.impact - 6) / 14));
        this.stats.crashes++; this.pop.danger(e.point, 15, this.player);
      }
    };
    this.vehicles.onExplode = (v, at) => this.explosion(at, v.lastDamagedBy === this.player ? this.player : null);
    this.helis.onExplode = (h, at) => this.explosion(at, h.lastDamagedBy === this.player ? this.player : null);
    // R5-A: Fort Calder gunships (hostile AI) and the player's chin gun / missiles; parked army vehicles in the motor pool
    this.armyAir = new ArmyAir({
      combat: this.combat, physics: this.physics, remove: h => this.helis.remove(h),
      spawn: (x, y, z, yaw) => this.helis.spawn('army', x, y, z, yaw),
      takeBaseHeli: () => this.helis.pads.find(p => /Fort Calder/.test(p.def.name) && p.heli && !p.heli.destroyed && !p.heli.driver && !p.heli.aiOwned && !p.heli.playerUsed)?.heli ?? null,
    });
    this.heliArms = new HeliArms(this.combat, this.physics);
    this.armyLod = buildArmyBaseLod();
    this.armyLod.updateMatrix(); this.armyLod.updateMatrixWorld(true); this.armyLod.matrixAutoUpdate = false; this.armyLod.matrixWorldAutoUpdate = false;
    this.renderer.scene.add(this.armyLod); // far silhouette of Fort Calder
    this.armyGuards = new ArmyGuards(this.pop); this.armyGuards.init();
    for (const m of armyLayout().motorPool) { const v = this.vehicles.spawn(m.kind, m.x, m.z, m.yaw, -1, 0.3); v.persistent = true; }
    for (const c of precinctCarSpots()) { const v = this.vehicles.spawn('police', c.x, c.z, c.yaw, -1, 0.3); v.persistent = true; } // parked patrol cars in the Precinct 4 lot (stealable)
    this.helis.onCrash = (h, imp) => { if (h === this.playerHeli) { this.cam.addShake(Math.min(0.9, imp / 14)); this.stats.crashes++; } };
  }
  private onNpcKilled(n: Npc, by: Character | null) {
    if (n.dropMoney > 0 || (n.role !== 'civilian' && Math.random() < 0.8) || Math.random() < 0.3) this.spawnPickup('cash', n.dropMoney || Math.floor(10 + Math.random() * 40), n.pos);
    if (n.weapon !== 'fists' && Math.random() < 0.6) this.spawnPickup('ammo', Math.ceil(WEAPONS[n.weapon].ammoPack / 2), n.pos.clone().add(new THREE.Vector3(0.6, 0, 0.4)), n.weapon);
    this.events.onNpcKilled(n, by);
  }
  /** Fort Calder: player weapons in an army gunship, trespass warning, and the hostile gunships (armyAir.ts). */
  private trespassWarned = false;
  private updateArmyAir(dt: number, ph: Helicopter | null, pv: Vehicle | null, blocked: boolean) {
    if (ph?.armed && !blocked && !this.paused) {
      const cam = this.renderer.camera, dir = cam.getWorldDirection(this._airDir);
      const missile = this.input.held('aim') || this.input.held('reload');
      this.heliArms.update(dt, ph, { fire: this.input.held('fire'), missile }, cam.position, dir, this.player);
    }
    this.armyLod.visible = armyLodVisible(this.renderer.camera.position.x, this.renderer.camera.position.z);
    const ignored = this.police.ignoring; // sandbox 'Police ignore you' covers the army too: guards, base defences and gunships
    if (ignored) this.armyAir.trespassT = 0;
    this.armyGuards.update(dt, guardsHostile(this.police.heat, this.player.pos.x, this.player.pos.z, this.armyAir.trespassT) && this.player.alive, this.player.pos, ignored);
    const on = inArmyBase(this.player.pos.x, this.player.pos.z, 4) && this.player.alive && this.deathT < 0;
    this.armyAir.trespassT = on ? this.armyAir.trespassT + dt : Math.max(0, this.armyAir.trespassT - dt * 0.4);
    if (on && !ignored && !this.trespassWarned) { this.trespassWarned = true; this.events.onToast('Fort Calder: restricted. Turn around.', 'warning'); }
    if (!on && this.armyAir.trespassT === 0) this.trespassWarned = false;
    const heat = this.police.heat;
    this.armyAir.wantedHeavy = heat >= 5;
    const v = (pv ?? ph) as { position: THREE.Vector3; phys: { body: { linvel(): { x: number; y: number; z: number } } }; damage: never } | null;
    const lv = v ? v.phys.body.linvel() : null;
    this.armyAir.update(dt, !ignored && this.player.alive && armyAirWanted(heat, this.armyAir.trespassT, !!ph?.armed), {
      pos: v ? v.position : this.player.pos, vel: lv ? this._airVel.set(lv.x, lv.y, lv.z) : this.player.vel, vehicle: v as never, onFoot: !v,
    });
  }
  explosion(at: THREE.Vector3, by: Character | null, R = 8) {
    this.pop.danger(at, 60, by);
    const prox = Math.max(0, 1 - this.renderer.camera.position.distanceTo(at) / 60);
    this.cam.addShake(prox);
    if (prox > 0.05) this.renderer.pulseImpact(0.32 + prox * 0.68);
    for (const c of [this.player, ...this.pop.characters()]) {
      if (!c.alive || c.inVehicle) continue;
      const d = c.pos.distanceTo(at);
      if (d < R) {
        const od = c.pos.clone().sub(at).setY(0); if (od.lengthSq() > 1e-4) od.normalize(); c.lastHit = { zone: 'torso', dx: od.x, dz: od.z, power: 6, blast: true };
        const killed = c.damage((R - d) * 18, by, this.time);
        if (c === this.player && !c.alive) this.playerDown('down');
        if (c !== this.player) { c.knockT = 1.2; const dir = c.pos.clone().sub(at).setY(0).normalize(); c.vel.set(dir.x * 7, 4, dir.z * 7); }
        const npc = this.pop.npcs.find(n => n.char === c); if (npc && killed) this.onNpcKilled(npc, by);
      }
    }
    if (by === this.player) this.police.report('vehicleWreck', at);
    this.events.onExplosion(at);
  }
  /** Frame-loop guard: one thrown error is logged and the loop carries on; repeated every frame it stops and calls onCrash. */
  readonly guard: LoopGuard = new LoopGuard({ onFatal: e => { this.running = false; this.onCrash?.(e); } });
  onCrash: ((e: unknown) => void) | null = null;
  get isRunning(): boolean { return this.running; }
  start() {
    if (this.running) return;
    this.guard.reset();
    this.running = true; this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      if (fullscreenSettling()) { this.last = now; return; } // the browser is switching fullscreen: leave the main thread free for it (core/fullscreen)
      // ProMotion (120 Hz rAF): render every other callback so the GPU draws 60 fps; the skipped callback's time folds into the next dt
      // the display rate comes from callback-to-callback gaps (a skipped callback still counts), the skip from the time since the last drawn frame
      const gap = now - this.last; this.rafEma = this.rafEma * 0.9 + Math.min(50, Math.max(0, now - this.lastRaf)) * 0.1; this.lastRaf = now;
      if (shouldSkipRaf(gap, this.rafEma)) return;
      const raw = Math.max(0, Math.min(0.1, gap / 1000)); this.last = Math.max(this.last, now);
      this.frameMs = this.frameMs * 0.92 + raw * 1000 * 0.08;
      this.fps = 1000 / Math.max(1, this.frameMs);
      const c0 = performance.now(); this.guard.run(() => this.frame(raw)); this.cpuMs = this.cpuMs * 0.92 + (performance.now() - c0) * 0.08;
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }
  /** Advances the simulation by real-time dt (seconds). Exposed for scripted tests. */
  frame(raw: number, render = true) {
    raw = Number.isFinite(raw) ? Math.max(0, Math.min(0.1, raw)) : 0;
    this.input.padContext = this.playerHeli ? 'heli' : this.playerVehicle || this.taxi?.riding ? 'car' : 'foot';
    this.input.pollGamepad();
    this.timeScale += (this.targetTimeScale - this.timeScale) * Math.min(1, raw * 10);
    const dt = this.paused ? 0 : raw * this.timeScale;
    if (!this.paused) {
      this.acc += dt;
      const step = 1 / 60;
      let n = 0;
      while (this.acc >= step && n < 4) { this.fixedUpdate(step); this.acc -= step; n++; }
      if (n === 4) this.acc = Math.min(this.acc, step); // spiral guard: drop the backlog but keep a sub-step remainder (no jitter from a hard reset)
    }
    Vehicle.renderAlpha = this.paused ? 1 : Math.min(1, this.acc * 60);
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
      pv.input.throttle = pv.destroyed || blocked || !pv.ignition || this.carEntry.blocksDriving ? 0 : this.input.throttle();
      pv.input.steer = blocked ? 0 : -mv.x;
      pv.input.handbrake = !blocked && this.input.held('handbrake');
    }
    const ph = this.playerHeli;
    if (ph) {
      const mv = this.input.moveAxes(), on = !blocked && !ph.destroyed && !this.carEntry.blocksDriving;
      ph.input.lift = !on ? 0 : this.input.held('handbrake') ? 1 : this.input.held('sprint') || this.input.held('crouch') ? -1 : 0;
      ph.input.pitch = on ? this.input.throttle() : 0;
      ph.input.yaw = on ? -mv.x : 0;
    }
    if (this.carEntry.ownsMovement) this.carEntry.fixedUpdate(dt);
    else this.playerCtl.fixedUpdate(dt, { canAim: this.pcombat.armed, blocked: this.carEntry.active || blocked });
    if (this.player.knockT > 0) this.player.knockT -= dt;
    this.traffic.fixedUpdate(dt, this.player, pv);
    const pp = this.player.pos;
    this.physics.streamStatics(pp.x, pp.z); // only static props near the player stay in the physics world (Round 12 perf)
    for (const v of this.vehicles.list) {
      if (!v.driver && v !== pv) {
        v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true;
        // Round 12 perf: an abandoned / base vehicle far from the player and at rest sleeps (it was running tyre rays every step)
        const b = v.phys.body;
        if (!b.isSleeping()) { const lv = b.linvel(), dx = v.position.x - pp.x, dz = v.position.z - pp.z; if (farIdleVehicle(dx * dx + dz * dz, lv.x * lv.x + lv.y * lv.y + lv.z * lv.z)) b.sleep(); }
      }
      v.phys.fixedUpdate(dt, v.input);
    }
    this.pop.fixedUpdate(dt, this.player.pos);
    this.helis.fixedUpdate(dt, this.player.pos);
    this.physics.step(dt);
    this.ragdolls.update(dt);
    this.vehicles.postStep(this.time);
    this.helis.postStep();
    this.pop.vehicleHits(this.vehicles.list, this.player, (v, sp) => this.hitByVehicle(v, sp));
    this.pop.dodge(this.vehicles.list);
    this.breakables.update(dt, this.vehicles.list, this.player.pos);
    if (pv) { const p = pv.position; this.stats.distance += Math.abs(pv.speed) * dt; this.player.pos.set(p.x, p.y, p.z); }
    if (ph) { const p = ph.position; this.player.pos.set(p.x, p.y, p.z); if (p.y < -25 || !Number.isFinite(p.x)) { this.exitVehicle(true); ph.teleport(Number.isFinite(p.x) ? p.x : 0, 2, Number.isFinite(p.z) ? p.z : 0, 0); } }
    // Safety net: never fall out of the world
    if (this.player.pos.y < -30 || !Number.isFinite(this.player.pos.x)) this.safeRespawn();
    for (const v of this.vehicles.list) { const p = v.position; if (p.y < -25 || !Number.isFinite(p.x)) { if (v === pv) this.exitVehicle(true); v.phys.teleport(Number.isFinite(p.x) ? p.x : 0, 2, Number.isFinite(p.z) ? p.z : 0, 0); } }
  }
  private hitByVehicle(v: Vehicle, sp: number) {
    if (this.playerVehicle || this.ghost || this.player.inVehicle) return;
    const vel = v.phys.body.linvel(), hd = Math.hypot(vel.x, vel.z) || 1, hx = vel.x / hd, hz = vel.z / hd;
    const lat = Math.max(-1, Math.min(1, ((this.player.pos.x - v.position.x) * Math.cos(v.yaw) - (this.player.pos.z - v.position.z) * Math.sin(v.yaw)) / (v.tpl.layout.half[0] + 0.35)));
    const im = pedImpact(sp, lat, Math.random());
    this.player.lastHit = { zone: 'torso', dx: hx, dz: hz, power: im.outcome === 'over' ? 3.5 : im.outcome === 'hood' ? 3 : 0.8, blast: im.outcome === 'over' };
    const killed = this.player.damage(im.damage, v.driver, this.time);
    this.player.vel.set(hx * im.carry - hz * im.side, Math.max(4, im.up), hz * im.carry + hx * im.side); this.player.grounded = false; // let the knock-up happen
    if (!killed) this.player.human.playOnce('Roll', 'full', 0.05);
    v.damage(im.carDamage, new THREE.Vector3(this.player.pos.x, this.player.pos.y + 0.7, this.player.pos.z), new THREE.Vector3(hx, 0, hz), v.driver);
    this.cam.addShake(0.5);
    this.audio.play('hitBody', { pos: this.player.pos });
    if (killed) this.playerDown('down');
  }
  /** Far-crowd caps: the quality preset scaled by the sandbox traffic/pedestrian sliders. */
  crowdCaps() {
    const q = this.renderer.quality, tc = this.trafficCap === null ? 1 : this.trafficCap / q.traffic, pc = this.pedCap === null ? 1 : this.pedCap / q.pedestrians;
    return { farCars: Math.round(q.farCars * tc), farPeds: Math.round(q.farPeds * pc), parked: Math.round(q.parked * Math.min(1, tc)) };
  }
  /** Fills the streets around the player before the first frame (so the city never starts empty). */
  prewarm() {
    this.renderer.camera.updateMatrixWorld(true);
    this.pop.prewarming = this.traffic.prewarming = this.crowd.prewarming = true;
    for (let i = 0; i < 70; i++) {
      this.traffic.update(0.4, this.renderer.camera, this.player.pos, this.renderer.quality.traffic);
      this.pop.update(0.2, this.renderer.camera, this.player.pos, this.renderer.quality.pedestrians);
    }
    this.crowd.update(0.1, this.player.pos, this.crowdCaps());
    this.pop.warmStep(120_000); // behind the loading screen: every look on the streets so far
    // Round 7 perf: build the emergency-vehicle models and the body LODs behind the loading screen (they were built during
    // the first seconds of play: 0.6-0.75 s freezes each)
    warmBodies(this.humanTpl); for (const k of this.warmKinds.splice(0)) getTemplate(k);
    for (const k of new Set([...TRAFFIC_MIX.map(m => m.kind), ...PARKED_MIX])) getTemplate(k); // every street car model too (a far parked car of an unbuilt kind was simply not drawn)
    this.pop.prewarming = this.traffic.prewarming = this.crowd.prewarming = false;
    // compile the cop/gun shader variants now (off to the side, one frame) so the first fight doesn't hitch
    try {
      const p = this.player.pos, cop = this.pop.spawn('police', p.x + 2, p.z + 2, p.y, COP_LOOK);
      this.police.dispatch.arm(cop, 'police', 3, true);
      this.renderer.render(); this.pop.remove(cop);
    } catch { /* warm-up only */ }
    for (let i = 0; i < 30; i++) this.fixedUpdate(1 / 60);
    this.warmShaders();
  }
  /**
   * Round 9 (Mac perf): compiles every material in the scene, hidden ones included (store interiors, light pools, gore,
   * far LODs), behind the loading screen. A program first compiled mid-game is a visible hitch on Macs (slow Metal compiles).
   */
  warmShaders() {
    const hidden: THREE.Object3D[] = [];
    this.renderer.scene.traverse(o => { if (!o.visible) { hidden.push(o); o.visible = true; } });
    try { this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera); } catch { /* warm-up only */ }
    // Round 11 (memory): one cheap draw of everything into a 1x1 target uploads every vertex buffer now, so the static
    // world's CPU copies are released at load (render/gpuOnly.ts) instead of whenever each piece first comes into view
    const S = this.renderer.scene, R = this.renderer.renderer, culled: THREE.Object3D[] = [];
    S.traverse(o => { if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    const rt = new THREE.WebGLRenderTarget(1, 1), ov = S.overrideMaterial, basic = new THREE.MeshBasicMaterial();
    try { S.overrideMaterial = basic; R.setRenderTarget(rt); R.render(S, this.renderer.camera); } catch { /* warm-up only */ }
    finally { S.overrideMaterial = ov; R.setRenderTarget(null); rt.dispose(); basic.dispose(); for (const o of culled) o.frustumCulled = true; }
    for (const o of hidden) o.visible = false;
  }
  /** Enter the nearest vehicle (walk to the door; carjacking if occupied) or get out of the current one. */
  toggleVehicle() {
    if (this.carEntry.active || this.carEntry.playerDragged || !this.player.alive || this.deathT >= 0) return;
    if (this.taxi.riding) { this.taxi.exit(); return; }
    if (this.playerVehicle) { this.carEntry.beginExit(this.playerVehicle); return; }
    if (this.playerHeli) { this.carEntry.beginExit(this.playerHeli); return; }
    const lift = this.helis.liftNear(this.player.pos);
    if (lift) {
      this.player.place(lift.to.x, lift.to.y + 0.05, lift.to.z, this.player.yaw);
      this.audio.play('doorClose', { pos: lift.to, volume: 0.6 });
      this.events.onToast(lift.up ? `${lift.pad.def.name}` : 'Street level', 'info');
      return;
    }
    const t = this.enterTarget();
    if (t) this.carEntry.begin(t);
  }
  /** The vehicle F would get into (nearest car or helicopter within reach). */
  enterTarget(): Enterable | null {
    const p = this.player.pos;
    const v = this.vehicles.nearest(p, 6, c => !c.destroyed && !c.locked && Math.abs(c.speed) < 6);
    const h = this.helis.nearest(p, 8, c => !c.destroyed && !c.driver && c.grounded);
    if (v && h) return v.position.distanceTo(p) <= h.position.distanceTo(p) - 1.5 ? v : h;
    return v ?? h;
  }
  /** Called by CarEntry when the player has sat down (no camera snap: the follow camera eases over). */
  boardFinished(v: Enterable, _seat = 0) {
    const h = this.player.human;
    h.setState('drive'); h.setUpperMode('none'); h.setSpeed(0);
    const firstUse = !v.playerUsed;
    this.player.inVehicle = v; v.driver = this.player; v.playerUsed = true;
    if (firstUse) { // stealing aircraft or police/army vehicles raises the wanted level
      if (v instanceof Helicopter) this.police.alarm(v.variant === 'police' ? 'policeHeliTheft' : 'heliTheft', this.player.pos);
      else if (['police', 'fbi', 'swat', 'army', 'tank'].includes((v as Vehicle).kind)) this.police.alarm('copCarTheft', this.player.pos);
    }
    if (v instanceof Helicopter) {
      if (v.armed) this.events.onToast('Gunship: Fire = chin gun  ·  Aim (right mouse) or R = missiles', 'info');
      this.playerHeli = v; v.engineOn = true; v.parked = false;
      this.audio.play('engineStart', { pos: v.position, pitch: 0.7 });
      this.events.onVehicleEntered(v as unknown as Vehicle);
      return;
    }
    const car = v as Vehicle;
    this.playerVehicle = car; this.traffic.unpark(car);
    this.audio.setRadioActive(car.ignition);
    this.events.onVehicleEntered(car);
  }
  /** Ends driving `v` without moving the player (CarEntry animates the exit). */
  detachPlayer(v: Enterable, fast: boolean) {
    if (v === this.playerVehicle) {
      const car = this.playerVehicle;
      this.playerVehicle = null; this.lastPlayerVehicle = car; this.traffic.protect = car;
      car.input.throttle = 0; car.input.steer = 0; car.input.handbrake = !fast;
    }
    if (v === this.playerHeli) {
      const hh = this.playerHeli; this.playerHeli = null;
      hh.input.lift = 0; hh.input.pitch = 0; hh.input.yaw = 0;
      if (hh.grounded) hh.engineOn = false;
    }
    if (v.driver === this.player) v.driver = null;
    this.audio.setRadioActive(false);
  }
  /** Sandbox / debug: parks a helicopter (variant civilian | news | police) next to the player or at a point. */
  spawnHelicopter(variant: HeliVariant = 'civilian', x = this.player.pos.x + 8, z = this.player.pos.z, yaw = this.player.yaw): Helicopter {
    const hit = this.physics.ray(x, this.player.pos.y + 20, z, 0, -1, 0, 60);
    const h = this.helis.spawn(variant, x, hit ? this.player.pos.y + 20 - hit.toi : this.player.pos.y, z, yaw);
    h.persistent = true; return h;
  }
  /** Instantly seats the player (scripts/tests; players walk in through CarEntry). */
  seatPlayer(v: Vehicle) {
    this.carEntry?.cancel();
    if (this.playerHeli) this.exitVehicle(true);
    v.playerUsed = true; v.doorsLocked = false; v.ignition = true;
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
  /** Instantly out of the vehicle (scripts, death, flooding); the F key goes through CarEntry.beginExit instead. */
  exitVehicle(force = false) {
    this.carEntry?.cancel();
    const ph = this.playerHeli;
    if (ph) {
      this.detachPlayer(ph, false);
      const p = ph.doorPoint(1);
      this.renderer.scene.add(this.player.human.root);
      this.player.place(p.x, Math.max(p.y, ph.position.y - 1), p.z, ph.yaw);
      this.player.inVehicle = null; this.player.setCollision(true); this.player.human.setState('loco');
      this.events.onVehicleExited(ph as unknown as Vehicle);
      return;
    }
    const v = this.playerVehicle; if (!v) return;
    void force;
    const pos = v.flooded ? v.position.clone().setY(WATER_LEVEL - 1.3) : this.findExitPoint(v);
    const fast = Math.abs(v.speed) > 9 && !v.destroyed;
    this.playerVehicle = null; v.driver = null; this.player.inVehicle = null; this.lastPlayerVehicle = v; this.traffic.protect = v;
    v.input.throttle = 0; v.input.handbrake = !fast;
    const h = this.player.human;
    this.renderer.scene.add(h.root);
    this.player.place(pos.x, v.flooded ? pos.y : Math.max(pos.y, v.position.y - 0.2), pos.z, v.yaw);
    this.player.setCollision(true);
    h.setState('loco');
    if (fast) { h.playOnce('Roll', 'full', 0.05); this.cam.addShake(0.4); if (this.player.damage(Math.min(25, Math.abs(v.speed) * 0.8), null, this.time)) this.playerDown('down'); }
    this.cam.snapBehind(v.yaw + Math.PI);
    this.audio.play('doorClose', { pos: v.position });
    this.audio.setRadioActive(false);
    this.events.onVehicleExited(v);
  }
  /**
   * A door-side spot the player can stand on: a clear path from the seat at knee, waist and head height,
   * room for a person, and ground near the car's level (so never over a railing or off the pier).
   */
  private findExitPoint(v: Vehicle): THREE.Vector3 {
    const solid = groups(ALL, G_STATIC | G_VEHICLE | G_PROP), body = v.phys.body, c = v.position;
    const g = this.physics.ray(c.x, c.y + 0.5, c.z, 0, -1, 0, 6, solid, null, body);
    const carGround = g ? c.y + 0.5 - g.toi : c.y - 0.6;
    for (const side of [1, -1] as const) {
      const p = v.doorPoint(side);
      const dx = p.x - c.x, dz = p.z - c.z, len = Math.hypot(dx, dz) || 1;
      let blocked = false;
      for (const h of [0.4, 0.95, 1.6]) if (this.physics.ray(c.x, carGround + h, c.z, dx / len, 0, dz / len, len + 0.45, solid, null, body)) { blocked = true; break; }
      if (blocked || this.physics.overlapsCapsule(p.x, carGround + 1.0, p.z, 0.5, 0.34, solid, body)) continue;
      const down = this.physics.ray(p.x, carGround + 1.2, p.z, 0, -1, 0, 2.4, solid, null, body);
      if (!down) continue;
      p.y = carGround + 1.2 - down.toi + 0.05; return p;
    }
    const p = v.position.clone(); p.y += v.tpl.bbox.max.y + 0.3; return p;
  }
  /** The player is down (health 0) or arrested. */
  playerDown(kind: 'down' | 'busted') {
    if (this.deathT >= 0 || this.ghost) return;
    this.deathT = 0; this.deathKind = kind;
    this.carEntry?.cancel();
    this.events.onBeforeDown();
    this.wheelOpen = false; this.targetTimeScale = 1;
    if (this.playerVehicle) this.exitVehicle(true);
    if (kind === 'busted') this.player.human.setState('crouch');
    else if (this.player.alive) this.player.kill();
    const pen = downPenalty(this.mode, kind, this.money), fee = pen.fee;
    this.addMoney(-fee);
    this.audio.play('down');
    if (pen.loseGear) { this.pcombat.inv.strip(); this.player.armor = 0; }
    this.deathNotice = pen.notice;
    this.events.onDeath(kind, pen.loseGear ? (kind === 'down' ? `Medical bill  -$${fee}` : `Fined  -$${fee}`) : (kind === 'down' ? 'Patched up, no charge' : 'Released, no charge'));
  }
  private respawn() {
    this.orders.reset();
    const place = this.deathKind === 'down' ? CLINIC : PRECINCT;
    this.carEntry?.cancel();
    if (this.playerVehicle) this.exitVehicle(true);
    this.player.revive(this.player.maxHealth); this.player.armor = 0;
    this.pcombat.inv.holster(); // never respawn with a gun in hand
    this.player.place(place.x, 0.25, place.z, place.yaw);
    this.player.setCollision(true);
    this.renderer.scene.add(this.player.human.root);
    this.cam.snapBehind(place.yaw);
    this.police.clear(); this.police.dispatch.endArrest(this.player);
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
    if (!this.pickups.length) return;
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const p = this.pickups[i];
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
  removePickup(p: Pickup) { const i = this.pickups.indexOf(p); if (i >= 0) this.pickups.splice(i, 1); p.mesh.removeFromParent(); p.mesh.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } }); }
  update(dt: number, raw = dt) {
    this.time += dt;
    if (this.clockRunning) this.hour = (this.hour + (dt / this.dayLength) * 24) % 24;
    const blocked = this.inputBlocked;
    if (!this.paused && !blocked && !this.orders.open) {
      const look = this.input.lookDelta(raw);
      this.cam.addInput(look.x, look.y, this.settings.sensitivity * this.pcombat.lookScale, this.settings.invertY);
    }
    if (!this.paused && !blocked && this.input.justPressed('enter')) this.toggleVehicle();
    const handled = this.carEntry.update(dt);
    const pv = this.playerVehicle, ph = this.playerHeli;
    if (ph) {
      if (!handled) this.player.human.update(dt);
      if (!blocked && this.input.justPressed('camera')) this.cam.zoomLevel = (this.cam.zoomLevel + 1) % 3;
      // a burning chopper: jump
      if (ph.destroyed && !this.carEntry.active) this.carEntry.beginExit(ph);
    } else if (this.taxi.riding) {
      this.player.human.update(dt);
      if (!blocked && this.input.justPressed('camera')) this.cam.zoomLevel = (this.cam.zoomLevel + 1) % 3;
    } else if (pv) {
      if (!handled) this.player.human.update(dt);
      if (!blocked) {
        if (this.input.justPressed('horn')) { this.audio.play('horn', { pos: pv.position }); this.pop.danger(pv.position, 10, null); }
        if (this.input.justPressed('headlights')) pv.headlights = !pv.headlights;
        this.vehicles.sirenKeys(pv, a => this.input.justPressed(a));
        if (this.input.justPressed('camera')) this.cam.zoomLevel = (this.cam.zoomLevel + 1) % 3;
        if (this.input.justPressed('radio')) { const st = this.audio.radioNext(); this.events.onToast(st ? `Radio  ${st}` : 'Radio off', 'info'); }
      }
      if ((pv.destroyed && pv.burnTime > 2.5) || pv.flooded) this.exitVehicle(true);
    } else {
      if (!handled) { this.playerCtl.updateAnimation(); this.player.updateVisual(dt); }
      if (!blocked && this.input.justPressed('camera')) this.cam.zoomLevel = (this.cam.zoomLevel + 1) % 2;
    }
    this.orders.update(dt, raw, blocked);
    this.updateHurtFx(dt);
    this.pcombat.update(dt, blocked || this.paused || this.carEntry.active || this.taxi.riding, () => this.pop.characters(), () => this.vehicles.list);
    this.combat.update(dt);
    this.pop.shadowBudget = this.renderer.quality.shadowMap >= 3072 ? 26 : 16;
    this.vehicles.shadowBudget = this.renderer.quality.shadowMap >= 3072 ? 14 : 8;
    this.vehicles.setHeadlightCount(this.renderer.quality.headlights ?? 1);
    this.vehicles.setBarLightCount(this.renderer.quality.bloom ? 1 : 0); // Round 9: real red/blue light on Medium+ (fixed count: no recompiles)
    this.vehicles.lodFov = this.renderer.camera.fov; // Round 14: LOD by screen size (zoomed aim keeps detail)
    this.vehicles.update(dt, this.renderer.skyState.night, this.time, this.renderer.camera.position, pv, this.renderer.camera);
    this.helis.update(dt, this.time, this.renderer.skyState.night, this.renderer.camera.position, ph, this.player.pos);
    this.pop.update(dt, this.renderer.camera, this.player.pos, this.pedCap ?? this.renderer.quality.pedestrians);
    this.pedSteps();
    this.traffic.update(dt, this.renderer.camera, this.player.pos, this.trafficCap ?? this.renderer.quality.traffic);
    this.crowd.hour = this.pop.hour = this.traffic.hour = this.hour; // street-life schedules
    this.crowd.sirens = this.traffic.sirenSources;
    this.buses.update(dt, this.player.pos);
    this.taxi.update(dt); this.taxiJob.update(dt);
    this.crowd.update(dt, this.player.pos, this.crowdCaps());
    this.pop.warmStep(2);
    this.police.playerArmed = policeSeesArmed(this.player.alive, this.pcombat.armed, !!ph);
    this.police.armedThreat = !pv && !ph && this.player.alive && this.deathT < 0 && this.pcombat.armed && this.pcombat.aiming && !this.carEntry.active;
    this.police.update(dt, this.player, !!pv || !!ph, this.renderer.camera);
    this.updateArmyAir(dt, ph, pv, blocked);
    this.updatePickups(dt);
    this.particles.update(dt, this.renderer.renderer.domElement.height);
    if (this.deathT >= 0 && !this.paused) { this.deathT += raw; if (this.deathT > this.respawnDelay) this.respawn(); }
    if (!this.player.alive && this.deathT < 0) this.playerDown('down'); // safety net: never leave a dead player without the respawn flow
    this.cam.baseFov = this.settings.fov;
    if (this.camOverride?.(raw)) { /* scripted shot (garage) */ }
    else if (this.deathT >= 0) this.cam.update(raw, this.player.pos, this.police.dispatch.arrest ? 'cinematic' : 'dead');
    else if (ph) this.cam.update(raw, ph.position, 'vehicle', { vehicleYaw: ph.yaw + Math.PI, speed: ph.speed, vehicleSize: ph.size, exclude: ph.phys.body, lookBack: !this.inputBlocked && this.input.held('lookBehind') });
    else if (pv) {
      const accel = dt > 1e-4 ? (pv.speed - this.prevVehSpeed) / dt : 0;
      this.prevVehSpeed = pv.speed;
      const lv = pv.phys.body.linvel(), fwd = pv.phys.forward();
      const latVel = lv.x * -fwd.z + lv.z * fwd.x, fwdVel = lv.x * fwd.x + lv.z * fwd.z;
      const slipAngle = Math.abs(fwdVel) > 3 ? Math.atan2(latVel, Math.abs(fwdVel)) : 0;
      this.cam.update(raw, pv.position, 'vehicle', { vehicleYaw: pv.visualYaw + Math.PI, speed: pv.speed, vehicleSize: pv.size, exclude: pv.phys.body, lookBack: !this.inputBlocked && this.input.held('lookBehind'), free: this.pcombat.driveAim, steer: pv.input.steer, accel, slipAngle });
    } else if (this.taxi.vehicle) { this.prevVehSpeed = 0; const tv = this.taxi.vehicle; this.cam.update(raw, tv.position, 'vehicle', { vehicleYaw: tv.visualYaw + Math.PI, speed: tv.speed, vehicleSize: tv.size, exclude: tv.phys.body, lookBack: !this.inputBlocked && this.input.held('lookBehind'), free: true }); }
    else { this.prevVehSpeed = 0; this.cam.update(raw, this.player.pos, this.pcombat.aiming && this.pcombat.armed ? 'aim' : 'foot'); }
    const camDir = this.renderer.camera.getWorldDirection(this.camDirTmp);
    this.audio.setListener(this.renderer.camera.position, camDir);
    this.warmT -= raw;
    if (this.warmT <= 0 && this.warmKinds.length && !this.paused) { this.warmT = 1.5; getTemplate(this.warmKinds.shift()!); }
    this.ambT -= raw;
    if (this.ambT <= 0) {
      this.ambT = 0.5;
      const p = this.player.pos;
      const water = Math.max(0, 1 - Math.min(Math.max(0, 440 - p.z), p.z > -60 ? Math.max(0, 480 - p.x) : 999) / 90);
      const d = districtAt(this.city, p.x, p.z);
      let near = 0; for (const v of this.vehicles.list) if (v.driver && v.position.distanceToSquared(p) < 8100) near++;
      this.audio.setAmbience({ night: this.renderer.skyState.night, water, traffic: Math.min(1, near / 8 + (d === 'heights' ? 0.3 : 0.1)), park: d === 'juniper' ? 1 : d === 'hillside' ? 0.6 : d === 'strand' ? 0.3 : 0, altitude: Math.min(1, Math.max(0, (this.renderer.camera.position.y - 25) / 70)) });
    }
    this.renderer.updateEnvironment(this.hour, this.time, this.player.pos);
    nightUniform.value = this.renderer.skyState.night; worldGlass.night = nightUniform.value;
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
  private extra(name: 'hitThud' | 'earRing', volume: number) { (this.audio as unknown as Partial<{ playExtra(n: string, o?: { volume?: number }): void }>).playExtra?.(name, { volume }); }
  /** The player was hit: red arrow towards the shooter, vignette, thud, camera flinch. */
  private onPlayerHurt(from: Character, dmg: number) {
    this.cam.addShake(0.15 + Math.min(0.2, dmg / 120));
    this.renderer.pulseImpact(Math.min(0.6, 0.2 + dmg / 90));
    this.cam.addInput((Math.random() - 0.5) * 8, -7, 1, false); // a small kick up and sideways
    this.extra('hitThud', Math.min(1, 0.5 + dmg / 40));
    if (from === this.player || !from.pos) return;
    const dx = from.pos.x - this.player.pos.x, dz = from.pos.z - this.player.pos.z;
    let rel = (this.cam.forwardYaw - Math.atan2(dx, dz)) * 180 / Math.PI;
    rel = ((rel + 540) % 360) - 180; // 0 ahead, +right, -left, ±180 behind
    this.fx?.hurt(rel, dmg);
  }
  /** R6-A: surface footstep (road/sidewalk/lot concrete, park grass, beach sand, quay wood). */
  private stepSound(p: THREE.Vector3, vol: number): void {
    const s = surfaceAt(this.city, p.x, p.z), a = this.audio as unknown as { footstep?: (s: string, p: THREE.Vector3, v: number) => void };
    if (a.footstep) a.footstep(s === 'park' ? 'grass' : s === 'beach' ? 'sand' : s === 'quay' ? 'wood' : 'concrete', p, vol * 0.8); else this.audio.play('footstep', { pos: p, volume: vol });
  }
  private pedPhase = new Map<number, number>();
  /** R6-A: peds within 15 m step on the same foot plants as the player. */
  private pedSteps(): void {
    const pp = this.player.pos;
    for (const n of this.pop.npcs) {
      const c = n.char; if (!n.alive || c.inVehicle) continue;
      if (Math.abs(c.pos.x - pp.x) > 15 || Math.abs(c.pos.z - pp.z) > 15) { this.pedPhase.delete(n.id); continue; }
      const ph = c.human.locoPhase, last = this.pedPhase.get(n.id); this.pedPhase.set(n.id, ph);
      if (last === undefined || c.speed < 0.6) continue;
      const crossed = (a: number) => (last < a && ph >= a) || (last > ph && (ph >= a || last < a));
      if (crossed(0.08) || crossed(0.58)) this.stepSound(c.pos, 0.3);
    }
  }
  private updateHurtFx(dt: number) {
    this.blood.enabled = this.settings.blood;
    this.blood.update(dt);
    const fx = this.fx; if (!fx) return;
    fx.root.style.visibility = this.menuOpen || this.paused ? 'hidden' : 'visible';
    const frac = this.player.health / this.player.maxHealth, alive = this.player.alive && this.deathT < 0;
    fx.update(dt, frac, alive);
    this.renderer.setHurt(fx.lowHealth);
    const low = alive && frac < 0.3;
    this.lowRingT -= dt;
    if (low && (!this.wasLow || this.lowRingT <= 0)) { this.extra('earRing', 1); this.lowRingT = 9; }
    this.wasLow = low;
  }
  // ---------------- Street lamps ----------------
  private buildLamps() {
    const heads = this.visuals.lampHeads;
    this.lampOrig = heads.map(h => h.clone());
    this.lampBulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.22, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.85, 0.6), toneMapped: false }), heads.length);
    this.lampPools = new THREE.InstancedMesh(new THREE.PlaneGeometry(10.5, 10.5).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(1, 0.66, 0.32), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }), heads.length);
    // Volumetric atmospheric lamp halo: two crossed vertical quads per bulb head (1 instanced draw call, zero CPU billboarding)
    const haloGeo = new THREE.BufferGeometry();
    const s = 1.65;
    haloGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -s, -s, 0,  s, -s, 0,  s, s, 0,  -s, -s, 0,  s, s, 0, -s, s, 0,
      0, -s, -s,  0, -s, s,  0, s, s,   0, -s, -s, 0, s, s,  0, s, -s,
    ], 3));
    haloGeo.setAttribute('uv', new THREE.Float32BufferAttribute([
      0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
      0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1,
    ], 2));
    this.lampHalos = new THREE.InstancedMesh(haloGeo, new THREE.MeshBasicMaterial({ map: glowTexture(), color: new THREE.Color(1, 0.72, 0.36), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }), heads.length);
    const m = new THREE.Matrix4();
    this.lampPoolY = heads.map(h => this.groundUnder(h));
    heads.forEach((h, i) => {
      m.makeTranslation(h.x, h.y - 0.1, h.z);
      this.lampBulbs.setMatrixAt(i, m);
      this.lampHalos.setMatrixAt(i, m);
      m.makeTranslation(h.x, this.lampPoolY[i], h.z);
      this.lampPools.setMatrixAt(i, m);
    });
    this.lampBulbs.computeBoundingSphere(); this.lampPools.computeBoundingSphere(); this.lampHalos.computeBoundingSphere();
    this.lampBulbs.updateMatrix(); this.lampBulbs.updateMatrixWorld(true); this.lampBulbs.matrixAutoUpdate = false; this.lampBulbs.matrixWorldAutoUpdate = false;
    this.lampPools.updateMatrix(); this.lampPools.updateMatrixWorld(true); this.lampPools.matrixAutoUpdate = false; this.lampPools.matrixWorldAutoUpdate = false;
    this.lampHalos.updateMatrix(); this.lampHalos.updateMatrixWorld(true); this.lampHalos.matrixAutoUpdate = false; this.lampHalos.matrixWorldAutoUpdate = false;
    this.lampPools.renderOrder = 1; this.lampHalos.renderOrder = 2;
    this.renderer.scene.add(this.lampBulbs, this.lampPools, this.lampHalos);
    for (let i = 0; i < 8; i++) this.lampLights.push(addPooledLight(this.renderer.scene, new THREE.PointLight(0xffc98a, 0, 22, 1.6), 1)); // Round 11: virtual, the light pool shows the nearest
  }
  /**
   * Round 7: height for a lamp's light pool: the lowest ground among five rays under the head (+3 cm), so the pool lies
   * flat on the road (the raised pavement simply hides its edge) instead of hovering at a fixed 0.21 m, or far below a
   * freeway deck. Pure apart from the rays.
   */
  private groundUnder(h: THREE.Vector3): number {
    let lo = Infinity;
    for (const [dx, dz] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) {
      const hit = this.physics.ray(h.x + dx, h.y - 0.6, h.z + dz, 0, -1, 0, 14, groups(0xffff, G_STATIC));
      if (hit) lo = Math.min(lo, h.y - 0.6 - hit.toi);
    }
    return (Number.isFinite(lo) ? lo : 0) + 0.03;
  }
  lampPoolY: number[] = [];
  /** A lamp head broken (on=false) or restored: bulb, light pool and the nearest-light pick all follow. */
  private setLamp(i: number, on: boolean) {
    const h = this.visuals.lampHeads[i], o = this.lampOrig[i]; if (!h || !o || !this.lampBulbs) return;
    const m = new THREE.Matrix4();
    if (on) {
      h.copy(o);
      m.makeTranslation(h.x, h.y - 0.1, h.z);
      this.lampBulbs.setMatrixAt(i, m);
      this.lampHalos?.setMatrixAt(i, m);
      m.makeTranslation(h.x, this.lampPoolY[i] ?? 0.03, h.z);
      this.lampPools.setMatrixAt(i, m);
    } else {
      h.set(0, -5000, 0);
      m.makeScale(0, 0, 0);
      this.lampBulbs.setMatrixAt(i, m);
      this.lampHalos?.setMatrixAt(i, m);
      this.lampPools.setMatrixAt(i, m);
    }
    this.lampBulbs.instanceMatrix.needsUpdate = true; this.lampPools.instanceMatrix.needsUpdate = true;
    if (this.lampHalos) this.lampHalos.instanceMatrix.needsUpdate = true;
  }
  private updateLamps(dt: number) {
    const night = this.renderer.skyState.night;
    const on = THREE.MathUtils.smoothstep(night, 0.15, 0.5);
    (this.lampBulbs.material as THREE.MeshBasicMaterial).color.setRGB(0.4 + on * 1.65, 0.35 + on * 1.32, 0.3 + on * 0.82);
    (this.lampPools.material as THREE.MeshBasicMaterial).opacity = on * 0.36;
    if (this.lampHalos) (this.lampHalos.material as THREE.MeshBasicMaterial).opacity = on * 0.24;
    this.lampTimer -= dt;
    const n = 8; // Round 11: every nearby lamp asks for light; the light pool decides how many are real
    if (this.lampTimer <= 0) {
      this.lampTimer = 0.4;
      const cp = this.renderer.camera.position;
      const sorted = nearestLamps(this.visuals.lampHeads, cp, n, this.lampPick);
      for (let k = 0; k < this.lampLights.length; k++) { const e = sorted[k]; if (k < n && e) { const hd = this.visuals.lampHeads[e.i]; this.lampLights[k].position.set(hd.x, hd.y - 0.4, hd.z); } }
    }
    // Lights stay in the scene (constant light count avoids shader recompiles); intensity fades them.
    for (let k = 0; k < this.lampLights.length; k++) this.lampLights[k].intensity = k < n ? on * 30 : 0;
  }
  /** Round 9: vehicles pedestrians must get out of the way of: siren cars, and the player's car when it comes fast. */
  private moverList: { x: number; z: number; fx: number; fz: number; speed: number; siren: boolean }[] = [];
  private moverPool: { x: number; z: number; fx: number; fz: number; speed: number; siren: boolean }[] = [];
  private movers() {
    const out = this.moverList; out.length = 0;
    let pi = 0;
    const push = (x: number, z: number, fx: number, fz: number, speed: number, siren: boolean) => {
      let item = this.moverPool[pi];
      if (!item) item = this.moverPool[pi] = { x: 0, z: 0, fx: 0, fz: 0, speed: 0, siren: false };
      item.x = x; item.z = z; item.fx = fx; item.fz = fz; item.speed = speed; item.siren = siren;
      out.push(item); pi++;
    };
    const sirens = this.traffic.sirenSources;
    for (let i = 0; i < sirens.length; i++) { const s = sirens[i]; push(s.x, s.z, s.fx, s.fz, s.speed, true); }
    const pv = this.playerVehicle;
    if (pv && !pv.sirenOn && Math.abs(pv.speed) > 8) {
      const f = pv.phys.forward(), sg = pv.speed < 0 ? -1 : 1;
      push(pv.position.x, pv.position.z, f.x * sg, f.z * sg, Math.abs(pv.speed), false);
    }
    return out;
  }
  private signalTimer = 0;
  private updateSignals() {
    this.signalTimer -= 1;
    if (this.signalTimer > 0) return; this.signalTimer = 8;
    const lamps = this.visuals.signalLamps;
    const night = this.renderer.skyState.night;
    const cols = signalLampColors(this.renderer.quality.bloom, night), off = signalOffColors(night);
    for (const h of this.visuals.signalHeads) {
      const st = signalState(this.city.intersections[h.inter], h.axis, this.time);
      lamps.setColorAt(h.lamps[0], st === 'red' ? cols.red : off[0]);
      lamps.setColorAt(h.lamps[1], st === 'yellow' ? cols.yellow : off[1]);
      lamps.setColorAt(h.lamps[2], st === 'green' ? cols.green : off[2]);
    }
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
    this.visuals.pedSignals.update(this.time);
  }
  private cullN = 0;
  private cullChunks() {
    if ((this.cullN++ % 3) !== 0) return; // Round 7 perf: distances move little in 3 frames (60 m margin)
    const cp = this.renderer.camera.position; const max = this.renderer.quality.drawDistance + 60;
    // far from the ground (flying over roofs) a 15 cm near plane leaves ~1 cm depth steps, so coplanar roof layers flicker: push it out
    { const cam = this.renderer.camera, nn = Math.min(2, 0.15 + Math.max(0, cp.y - 15) * 0.012); if (Math.abs(cam.near - nn) > 0.05 || (nn === 0.15 && cam.near !== 0.15)) { cam.near = nn; cam.updateProjectionMatrix(); } }
    const shadowR = this.renderer.quality.shadowRange * 1.3 + 10;
    this.visuals.treeLod?.update(cp.x, cp.z, this.player.pos.x, this.player.pos.z, Math.min(max, 140), shadowR);
    for (const m of this.visuals.chunkMeshes) {
      const mesh = m as THREE.Mesh;
      const inst = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh, bb = inst ? null : mesh.geometry?.boundingBox, bs = inst ? (mesh as unknown as THREE.InstancedMesh).boundingSphere : mesh.geometry.boundingSphere;
      if (!bb && !bs) continue;
      let cb = mesh.userData.cbox as ChunkBox | undefined;
      if (!cb) { cb = bb ? { minX: bb.min.x, maxX: bb.max.x, minZ: bb.min.z, maxZ: bb.max.z, maxY: bb.max.y } : { minX: bs!.center.x - bs!.radius, maxX: bs!.center.x + bs!.radius, minZ: bs!.center.z - bs!.radius, maxZ: bs!.center.z + bs!.radius, maxY: bs!.center.y + bs!.radius }; mesh.userData.cbox = cb; }
      const small = !!mesh.userData.small;
      const r = chunkCull(cb, cp.x, cp.z, this.player.pos.x, this.player.pos.z, small ? Math.min(max, mesh.userData.reachCap ?? 140) : max * (mesh.userData.farScale ?? 1), shadowR, small, mesh.visible); // R14 CW: footprint boxes, not spheres; CITY: facades reach further (farScale)
      mesh.visible = r.visible;
      if (mesh.userData.shadow === undefined) mesh.userData.shadow = mesh.castShadow;
      mesh.castShadow = mesh.userData.shadow && r.cast;
    }
  }
  // ---------------- HUD data ----------------
  streetName(x: number, z: number): string {
    // nearest road: on sidewalks, plazas and courtyards too
    if (x < AVENUES[0] - 20) { let best = '', bd = 40; for (const p of this.city.paths) if (p.kind === 'street') { const d = distToPath(p, x, z); if (d < bd) { bd = d; best = p.name; } } if (best) return best; } // Old Town / Seacliff street names
    let bi = -1, bd = 60; AVENUES.forEach((a, i) => { const d = Math.abs(x - a); if (d < bd) { bd = d; bi = i; } });
    let si = -1, sd = 60; STREETS.forEach((s, i) => { const d = Math.abs(z - s); if (d < sd) { sd = d; si = i; } });
    if (bi >= 0 && (si < 0 || bd < sd)) return AVENUE_NAMES[bi];
    if (si >= 0) return STREET_NAMES[si];
    return '';
  }
  hudState(objective: string | null, timer: number | null): HudState {
    const pv = this.playerVehicle ?? this.playerHeli, inv = this.pcombat.inv, def = inv.def; // CAR-ENTRY: helicopters too
    const car = this.playerVehicle;
    return {
      health: this.player.health, maxHealth: this.player.maxHealth, armor: this.player.armor, money: this.money,
      heat: this.police.heat, heatMax: 5, heatFlash: this.police.heat > 0 && !this.police.state.seen,
      weaponName: this.playerHeli?.armed ? `Chin gun  ·  Missiles ${this.heliArms.missiles}` : def.name, weaponIcon: def.icon, reloading: inv.reloading,
      objective, vehicleSpeedKmh: pv ? Math.abs(pv.speed) * 3.6 : null, vehicleName: pv ? pv.name : null, vehicleHealth: pv ? pv.health / pv.spec.health : null,
      vehicleGear: car ? car.gear : null, vehicleRpm: car ? car.rpm : null,
      waypointDistM: this.waypoint ? Math.hypot(this.waypoint.x - this.player.pos.x, this.waypoint.z - this.player.pos.z) : null,
      district: DISTRICT_INFO[districtAt(this.city, this.player.pos.x, this.player.pos.z)].name, streetName: this.streetName(this.player.pos.x, this.player.pos.z),
      clock: fmtClock12(this.hour),
      ...this.pcombat.hud(), ...((pv && !this.pcombat.driveAim) || this.deathT >= 0 ? { crosshair: 'none' as const, crosshairSpread: 0 } : {}),
      interactPrompt: this.interactPrompt(), radio: null, missionTimer: timer, stamina: this.playerCtl.stamina,
      fps: this.settings.showFps ? Math.round(this.fps) : null, cpuMs: this.cpuMs,
    };
  }
  interactPrompt(): string | null {
    const key = this.settings.bindings.enter[0]?.replace('Key', '') ?? 'F';
    if (this.deathT >= 0) return null;
    const ce = this.carEntry;
    if (ce.phase === 'hotwire') return 'Hotwiring...';
    if (this.playerVehicle || this.playerHeli || ce.active) return null;
    const lift = this.helis.liftNear(this.player.pos);
    if (lift) return lift.up ? `${key}  Elevator to the helipad` : `${key}  Elevator down`;
    const v = this.enterTarget();
    if (!v) return null;
    const name = (v as { name?: string }).name ?? 'vehicle';
    if (v.driver) return `${key}  Take the ${name}`;
    if (v.doorsLocked && !v.playerUsed) return v.isGlassBroken(v.paneOfDoor(0)) ? `${key}  Reach in and open the ${name}` : `${key}  Break into the ${name}`;
    return `${key}  Enter ${name}`;
  }
  baseBlips(): MinimapBlip[] {
    const b: MinimapBlip[] = [];
    for (const n of this.pop.npcs) if (n.alive && (n.role === 'police' || (n.role === 'gang' && n.hostile)) && n.pos.distanceTo(this.player.pos) < 120 && !n.char.inVehicle) b.push({ x: n.pos.x, z: n.pos.z, kind: n.role === 'police' ? 'police' : 'enemy', yaw: n.role === 'police' ? n.char.yaw : undefined });
    for (const u of this.police.units) b.push({ x: u.v.position.x, z: u.v.position.z, kind: 'police', yaw: u.v.yaw });
    if (this.waypoint) b.push({ x: this.waypoint.x, z: this.waypoint.z, kind: 'waypoint' });
    for (const s of this.helis.pads) b.push({ x: s.pos.x, z: s.pos.z, kind: 'vehicle', label: s.def.name }); // CAR-ENTRY: helipads
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
