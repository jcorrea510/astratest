/** Game orchestrator: owns the world, systems and the main loop. */
import * as THREE from 'three';
import { Renderer } from '../render/renderer';
import { Physics } from '../core/physics';
import { Input } from '../core/input';
import type { Settings } from '../core/settings';
import { generateCity, type CityMap } from '../world/citymap';
import { buildCity, type CityVisuals } from '../world/citybuild';
import type { Assets } from '../world/assets';
import { createHumanTemplate, type HumanTemplate } from '../actors/human';
import { Character } from '../actors/character';
import { randomLook } from '../actors/human';
import { CameraRig } from './camera';
import { PlayerController } from './player';
import { nightUniform, timeUniform } from '../render/materials';
import { signalState } from '../world/citymap';

export const PLAYER_LOOK = { skin: '#c68c63', top: '#e8875a', bottom: '#27324a', shoes: '#f2efe8', hair: '#1f1a17', hat: '#264653', detail: '#2b2b2b', sleeves: 'long' as const, legs: 'pants' as const, hairStyle: 'short' as const, hatStyle: 'none' as const, height: 1.0, build: 1.02 };
export const SPAWN = { x: -300, y: 0.25, z: -107, yaw: Math.PI };

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
  paused = false;
  dayLength = 24 * 60; // seconds of real time per game day
  private acc = 0;
  private last = 0;
  private running = false;
  fps = 60;
  frameMs = 16;
  onFrame: ((dt: number) => void) | null = null;

  constructor(public canvas: HTMLCanvasElement, public settings: Settings, public assets: Assets) {
    this.renderer = new Renderer(canvas);
    this.renderer.setQuality(settings.quality);
    this.input = new Input(settings, canvas);
    this.city = generateCity();
  }
  async init(onProgress: (f: number, label: string) => void) {
    onProgress(0.05, 'Laying out streets');
    await tick();
    this.visuals = buildCity(this.renderer.scene, this.physics, this.assets, this.city);
    onProgress(0.6, 'Waking up the locals');
    await tick();
    this.humanTpl = createHumanTemplate(this.assets.human);
    this.player = new Character(this.physics, this.humanTpl, PLAYER_LOOK, 'player', SPAWN.x, SPAWN.z, SPAWN.y);
    this.player.yaw = SPAWN.yaw;
    this.renderer.scene.add(this.player.human.root);
    this.cam = new CameraRig(this.renderer.camera, this.physics);
    this.cam.snapBehind(SPAWN.yaw);
    this.playerCtl = new PlayerController(this.player, this.input, this.cam);
    onProgress(0.85, 'Warming up the city lights');
    this.physics.world.step();
    await tick();
    // Compile shaders before the first frame to avoid hitches.
    this.update(0);
    this.renderer.renderer.compile(this.renderer.scene, this.renderer.camera);
    onProgress(1, 'Ready');
  }
  start() {
    if (this.running) return;
    this.running = true; this.last = performance.now();
    const loop = (now: number) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const raw = Math.min(0.1, (now - this.last) / 1000); this.last = now;
      this.frameMs = this.frameMs * 0.9 + raw * 1000 * 0.1;
      this.fps = 1000 / Math.max(1, this.frameMs);
      this.frame(raw);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }
  /** Advances the simulation by real-time dt (seconds). Exposed for scripted tests. */
  frame(raw: number) {
    this.input.pollGamepad();
    const dt = this.paused ? 0 : raw * this.timeScale;
    if (!this.paused) {
      this.acc += dt;
      const step = 1 / 60 * Math.min(1, this.timeScale + 0.0001);
      let n = 0;
      while (this.acc >= step && n < 5) { this.fixedUpdate(step); this.acc -= step; n++; }
      if (n === 5) this.acc = 0;
    }
    this.update(dt, raw);
    this.onFrame?.(raw);
    this.renderer.render();
    this.input.endFrame();
  }
  fixedUpdate(dt: number) {
    this.playerCtl.fixedUpdate(dt, { canAim: false, blocked: false });
    this.physics.step(dt);
  }
  update(dt: number, raw = dt) {
    this.time += dt;
    this.hour = (this.hour + (dt / this.dayLength) * 24) % 24;
    if (!this.paused) {
      const look = this.input.lookDelta(raw);
      this.cam.addInput(look.x, look.y, this.settings.sensitivity, this.settings.invertY);
    }
    this.playerCtl.updateAnimation();
    this.player.updateVisual(dt);
    this.cam.baseFov = this.settings.fov;
    this.cam.update(raw, this.player.pos, this.playerCtl.aiming ? 'aim' : 'foot');
    this.renderer.updateEnvironment(this.hour, this.time, this.player.pos);
    nightUniform.value = this.renderer.skyState.night;
    timeUniform.value = this.time;
    this.updateSignals();
    this.cullChunks();
    if (this.visuals.ferris) this.visuals.ferris.rotation.x += dt * 0.05;
  }
  /** Debug helper: spawns a line-up of people in front of a point. */
  debugLineup(n = 6, seed = 1) {
    const out: Character[] = [];
    for (let i = 0; i < n; i++) {
      const c = new Character(this.physics, this.humanTpl, randomLook(seed + i), 'civilian', this.player.pos.x - (n - 1) + i * 2, this.player.pos.z - 4, this.player.pos.y);
      c.yaw = 0; this.renderer.scene.add(c.human.root); out.push(c);
    }
    return out;
  }
  private signalTimer = 0;
  private updateSignals() {
    this.signalTimer -= 1;
    if (this.signalTimer > 0) return; this.signalTimer = 8;
    const col = new THREE.Color();
    const lamps = this.visuals.signalLamps;
    const cols = { red: new THREE.Color(4, 0.25, 0.2), yellow: new THREE.Color(4, 2.4, 0.3), green: new THREE.Color(0.4, 4, 1.6) };
    const off = new THREE.Color(0.06, 0.06, 0.06);
    for (const h of this.visuals.signalHeads) {
      const st = signalState(this.city.intersections[h.inter], h.axis, this.time);
      lamps.setColorAt(h.lamps[0], st === 'red' ? cols.red : off);
      lamps.setColorAt(h.lamps[1], st === 'yellow' ? cols.yellow : off);
      lamps.setColorAt(h.lamps[2], st === 'green' ? cols.green : off);
    }
    void col;
    if (lamps.instanceColor) lamps.instanceColor.needsUpdate = true;
  }
  private cullChunks() {
    const cp = this.renderer.camera.position; const max = this.renderer.quality.drawDistance + 60;
    for (const m of this.visuals.chunkMeshes) {
      const mesh = m as THREE.Mesh;
      const bs = (mesh as unknown as THREE.InstancedMesh).isInstancedMesh ? (mesh as unknown as THREE.InstancedMesh).boundingSphere : mesh.geometry.boundingSphere;
      if (!bs) continue;
      const d = Math.hypot(bs.center.x - cp.x, bs.center.z - cp.z) - bs.radius;
      mesh.visible = d < max;
    }
  }
}
const tick = () => new Promise<void>(r => setTimeout(r, 0));
