/**
 * Highway mode: an endless multi-lane highway drive with AI traffic. Self-contained: own scene, camera, input, HUD, audio.
 * It renders with whatever WebGLRenderer it is handed (the city game's, paused, or a fresh one) and never touches the city.
 */
import * as THREE from 'three';
import { roadAt, hash, laneU, NL, STEP } from './road';
import { Traffic, type Npc } from './traffic';
import { PlayerCar, overlap, type DriveInput } from './player';
import { ChunkBuilder, CL, type Chunk, type ChunkMats } from './chunks';
import { Fleet } from './fleet';
import { SkyDome, PRESETS, type TimeOfDay, type Preset } from './sky';
import { roadTexture, signAtlas, glowTexture } from './textures';
import { HighwayHud } from './hud';
import { HighwayAudio } from './audio';
import { Cockpit, wheelFrac } from './cockpit';
import { mulberry } from './rng';
import { getTemplate } from '../vehicles/models/build';
import { loadSettings } from '../core/settings';
import type { MirrorQuality } from './mirrors';
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import { MPS_TO_MPH, mpsFromMph } from '../core/units';

export interface HighwayOptions {
  renderer: THREE.WebGLRenderer; model: VehicleKind; time: TimeOfDay; density: number; seed?: number;
  onQuit(): void; withHud?: boolean;
}
export type CameraMode = 'third' | 'first';
const AHEAD = 690, BEHIND = 150;
/** mirror reflection quality follows the graphics preset (?quality= overrides the saved setting) */
function mirrorQuality(): MirrorQuality { try { const q = new URLSearchParams(location.search).get('quality') ?? loadSettings().quality; return q === 'low' || q === 'high' ? q : 'medium'; } catch { return 'medium'; } }
const HEAVY_PAINT = ['#c43a31', '#2f6f9a', '#e9e6df', '#1f2226', '#3a6b3a', '#d8a21f', '#7a1f24', '#9a9da1'];

export class HighwayGame {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(64, 16 / 9, 0.12, 1300);
  readonly renderer: THREE.WebGLRenderer;
  readonly traffic: Traffic;
  readonly player: PlayerCar;
  readonly hud: HighwayHud;
  paused = false;
  cameraMode: CameraMode = 'third';
  time = 0;
  score = 0; combo = 0; comboT = 0; closeCalls = 0; topMph = 0; startS = 0; bestMeters = 0;
  preset: Preset;
  private sky = new SkyDome();
  private hemi = new THREE.HemisphereLight(); private sun = new THREE.DirectionalLight();
  private fleet = new Fleet();
  readonly cockpit: Cockpit;
  private builder: ChunkBuilder;
  private chunks = new Map<number, Chunk>();
  private mats!: ChunkMats; private matExtras: { glow: THREE.MeshBasicMaterial; sign: THREE.MeshBasicMaterial; lamp: THREE.MeshBasicMaterial; road: THREE.MeshStandardMaterial; textures: THREE.Texture[] } | null = null;
  private pmrem: THREE.PMREMGenerator; private envRT: THREE.WebGLRenderTarget | null = null;
  private audio = new HighwayAudio(0.5);
  private rand: () => number;
  private keys = new Set<string>();
  private raf = 0; private last = 0; private running = false;
  private origin = new THREE.Vector2();
  private camU = 0; private camPos = new THREE.Vector3(); private shake = 0; private lookBack = false;
  private nearMiss = new Map<number, number>();
  private headlights = true; private hornOn = false; private wreckShown = false; private wreckT = 0;
  private colors = new Map<string, THREE.Color>();
  private metrics = { frames: 0, cpuMs: 0, frameMs: [] as number[], maxFrameMs: 0, calls: 0, tris: 0, stepMs: 0, steps: 0, mirrorCalls: 0 };
  private tmpV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private rp = { x: 0, y: 0, z: 0, theta: 0, slope: 0 };
  private onResize = () => this.resize();
  private onKey: (e: KeyboardEvent) => void; private onKeyUp: (e: KeyboardEvent) => void; private onBlur: () => void;
  private pose = { x: 0, y: 0, z: 0, fx: 0, fy: 0, fz: 0, ux: 0, uy: 1, uz: 0, lx: 0, ly: 0, lz: 0 };
  private seat: { x: number; y: number; z: number };
  /** cockpit eye position relative to the seat cushion (metres up / forward) */
  eyeLift = 0.6; eyeFwd = -0.1;

  constructor(private opts: HighwayOptions) {
    this.renderer = opts.renderer;
    this.rand = mulberry(opts.seed ?? (Date.now() & 0xffffff));
    this.traffic = new Traffic(this.rand); this.traffic.density = opts.density;
    this.player = new PlayerCar(opts.model);
    this.preset = PRESETS[opts.time];
    const sd = getTemplate(opts.model).seats[0]; this.seat = { x: sd?.x ?? 0.37, y: sd?.y ?? 0.7, z: sd?.z ?? 0.1 };
    this.cockpit = new Cockpit(opts.model, mirrorQuality()); this.eyeLift = this.cockpit.dims.eye.y - this.seat.y; this.eyeFwd = this.cockpit.dims.eye.z - this.seat.z;
    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.buildMaterials();
    this.builder = new ChunkBuilder(this.mats);
    this.camera.layers.enable(1); this.cockpit.group.visible = false;
    this.scene.add(this.sky.mesh, this.hemi, this.sun, this.sun.target, this.fleet.group, this.cockpit.group);
    this.scene.fog = new THREE.Fog(0x000000, 100, 600);
    this.applyPreset(this.preset);
    this.hud = new HighwayHud({ onResume: () => this.setPaused(false), onQuit: () => this.quit(), onRetry: () => this.retry(), onPause: () => this.setPaused(true) });
    this.player.onImpact = e => { this.crashFx(e.power, e.kind); };
    this.onKey = e => this.keyDown(e); this.onKeyUp = e => { this.keys.delete(e.code); if (e.code === 'KeyH') this.setHorn(false); if (e.code === 'KeyC') this.lookBack = false; };
    this.onBlur = () => { this.keys.clear(); if (this.running && !this.paused && !this.player.wrecked) this.setPaused(true); };
    window.addEventListener('keydown', this.onKey); window.addEventListener('keyup', this.onKeyUp); window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    this.reset();
  }

  // ------------------------------------------------------------------ setup
  private buildMaterials(): void {
    const aniso = Math.min(8, this.renderer.capabilities.getMaxAnisotropy());
    const roadTex = roadTexture(aniso), atlas = signAtlas(aniso), glowTex = glowTexture();
    const road = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.82, metalness: 0.0, envMapIntensity: 0.6 });
    const ground = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
    const struct = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.15, side: THREE.DoubleSide });
    const lamp = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    const glow = new THREE.MeshBasicMaterial({ map: glowTex, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, side: THREE.DoubleSide });
    const sign = new THREE.MeshBasicMaterial({ map: atlas, side: THREE.DoubleSide });
    const shade = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mats = { road, ground, struct, lamp, glow, sign, shade };
    this.matExtras = { glow, sign, lamp, road, textures: [roadTex, atlas, glowTex] };
  }
  applyPreset(p: Preset): void {
    this.preset = p;
    this.sky.apply(p);
    const fog = this.scene.fog as THREE.Fog; fog.color.set(p.fog); fog.near = p.fogNear; fog.far = p.fogFar;
    this.hemi.color.set(p.hemiSky); this.hemi.groundColor.set(p.hemiGround); this.hemi.intensity = p.hemi;
    this.sun.color.set(p.sun); this.sun.intensity = p.sunI; this.sun.position.set(...p.sunDir).multiplyScalar(100);
    this.renderer.toneMappingExposure = p.exposure;
    this.cockpit.applyPreset(p.top, p.horizon, p.hemiGround, Math.min(1, p.hemi * p.env + 0.3));
    this.fleet.uniforms.uTailBase.value = p.tail; this.fleet.uniforms.uHeadAmt.value = 1;
    const x = this.matExtras!; x.sign.color.setScalar(p.sign); x.lamp.color.setScalar(p.lamps ? 1 : 0.35); x.glow.color.setScalar(0.28 * p.lamps); x.glow.visible = p.lamps > 0;
    // reflections come from a sky-only scene
    const envScene = new THREE.Scene(), dome = new SkyDome(); dome.apply(p); envScene.add(dome.mesh);
    const rt = this.pmrem.fromScene(envScene, 0, 0.1, 2000); this.envRT?.dispose(); this.envRT = rt;
    this.scene.environment = rt.texture; this.scene.environmentIntensity = p.env;
    dome.mesh.geometry.dispose(); (dome.mesh.material as THREE.Material).dispose();
  }

  reset(): void {
    this.traffic.npcs.length = 0;
    this.player.reset(300, 1, mpsFromMph(58));
    this.startS = this.player.s; this.score = 0; this.combo = 0; this.comboT = 0; this.closeCalls = 0; this.topMph = 0; this.wreckShown = false; this.wreckT = 0;
    this.nearMiss.clear();
    this.traffic.player = { s: this.player.s, u: this.player.u, v: this.player.v, len: this.player.len, wid: this.player.wid, psi: 0 };
    this.traffic.fill();
    this.camU = this.player.u;
    this.ensureChunks(true);
    this.updateCamera(0, true);
    this.hud.showWreck(false);
  }
  retry(): void {
    // drop the wreckage near the player and start a fresh run from where it ended
    const keep = this.player.s;
    this.bestMeters = Math.max(this.bestMeters, this.player.s - this.startS);
    this.traffic.npcs = this.traffic.npcs.filter(n => Math.abs(n.s - keep) > 150);
    this.player.reset(keep, 1, mpsFromMph(50)); this.startS = keep;
    this.score = 0; this.combo = 0; this.closeCalls = 0; this.topMph = 0; this.wreckShown = false; this.nearMiss.clear();
    this.hud.showWreck(false); this.hud.popup('Back on the road');
  }
  start(): void {
    if (this.running) return;
    this.running = true; this.resize(); this.audio.start();
    this.last = performance.now();
    const loop = (t: number) => {
      if (!this.running) return;
      this.raf = requestAnimationFrame(loop);
      const raw = Math.max(0, (t - this.last) / 1000); this.last = t; // (rAF timestamps can predate performance.now() on the first frame)
      const m = this.metrics; m.frameMs.push(raw * 1000); if (m.frameMs.length > 600) m.frameMs.shift(); m.maxFrameMs = Math.max(m.maxFrameMs, raw * 1000);
      const c0 = performance.now();
      if (!this.paused) this.step(Math.min(raw, 0.05));
      this.render();
      m.cpuMs += performance.now() - c0; m.frames++;
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void { this.running = false; cancelAnimationFrame(this.raf); }
  quit(): void { this.dispose(); this.opts.onQuit(); }
  dispose(): void {
    this.stop(); this.audio.dispose(); this.hud.dispose();
    window.removeEventListener('keydown', this.onKey); window.removeEventListener('keyup', this.onKeyUp); window.removeEventListener('blur', this.onBlur); window.removeEventListener('resize', this.onResize);
    for (const c of this.chunks.values()) this.builder.dispose(c);
    this.fleet.dispose(); this.cockpit.dispose(); this.envRT?.dispose(); this.pmrem.dispose();
    this.matExtras?.textures.forEach(t => t.dispose());
  }
  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
  }

  // ------------------------------------------------------------------ input
  private keyDown(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.code === 'Escape') { if (!e.repeat && !this.player.wrecked) this.setPaused(!this.paused); e.preventDefault(); return; }
    if (e.repeat) { if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault(); return; }
    this.keys.add(e.code);
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
    if (this.paused) return;
    if (e.code === 'KeyV') this.setCamera(this.cameraMode === 'third' ? 'first' : 'third');
    else if (e.code === 'KeyC') this.lookBack = true;
    else if (e.code === 'KeyH') this.setHorn(true);
    else if (e.code === 'KeyL') this.headlights = !this.headlights;
    else if (e.code === 'KeyR' && this.player.wrecked) this.retry();
  }
  setCamera(m: CameraMode): void { this.cameraMode = m; this.fleet.uniforms.uCabin.value = m === 'first' ? 1 : 0; this.fleet.uniforms.uTrimY.value = this.cockpit.dims.dashY + 0.1; const k = 'player:' + this.opts.model; if (m === 'first') this.fleet.hideGlass.add(k); else this.fleet.hideGlass.delete(k); this.camera.fov = m === 'first' ? 66 : 64; this.camera.layers.enable(1); this.cockpit.group.visible = m === 'first'; this.camera.updateProjectionMatrix(); }
  private setHorn(on: boolean): void { if (on !== this.hornOn) { this.hornOn = on; this.audio.honk(on); } }
  setPaused(p: boolean): void { this.paused = p; this.hud.showPause(p); this.audio.setPaused(p); if (p) this.setHorn(false); if (!p) this.last = performance.now(); }
  private readInput(): DriveInput {
    const k = this.keys, any = (...c: string[]) => c.some(x => k.has(x));
    let steer = (any('KeyD', 'ArrowRight') ? 1 : 0) - (any('KeyA', 'ArrowLeft') ? 1 : 0);
    let throttle = any('KeyW', 'ArrowUp') ? 1 : 0, brake = any('KeyS', 'ArrowDown') ? 1 : 0;
    const pad = navigator.getGamepads?.()[0];
    if (pad && pad.connected) {
      if (Math.abs(pad.axes[0]) > 0.12) steer = pad.axes[0];
      throttle = Math.max(throttle, pad.buttons[7]?.value ?? 0); brake = Math.max(brake, pad.buttons[6]?.value ?? 0);
    }
    return { steer, throttle, brake, handbrake: k.has('Space') };
  }
  /** Test hook: drive with synthetic input instead of the keyboard. */
  override: Partial<DriveInput> | null = null;

  // ------------------------------------------------------------------ simulation
  step(dt: number): void {
    const t0 = performance.now();
    this.time += dt;
    const p = this.player;
    const input = { ...this.readInput(), ...(this.override ?? {}) };
    p.update(dt, input);
    this.traffic.player = { s: p.s, u: p.u, v: p.v, len: p.len, wid: p.wid, psi: p.psi };
    this.traffic.update(dt);
    this.collide();
    this.scoring(dt);
    this.shake = Math.max(0, this.shake - dt * 2.2);
    this.ensureChunks(false);
    if (this.wreckT >= 0 && p.wrecked) {
      this.wreckT += dt;
      if (!this.wreckShown && (this.wreckT > 1.4 || p.v < 0.5)) {
        this.wreckShown = true;
        this.bestMeters = Math.max(this.bestMeters, p.s - this.startS);
        this.hud.showWreck(true, [['Score', Math.round(this.score).toLocaleString('en-US')], ['Distance', `${((p.s - this.startS) / 1609.344).toFixed(2)} mi`], ['Top speed', `${Math.round(this.topMph)} mph`], ['Close calls', String(this.closeCalls)]]);
      }
    }
    this.audio.update(p.v, input.throttle, this.paused);
    this.hud.update({ mph: p.v * MPS_TO_MPH, topMph: VEHICLES[this.opts.model].topSpeed * MPS_TO_MPH, score: this.score, combo: this.combo, mult: 1 + Math.min(this.combo, 9) * 0.5, health: p.health, meters: p.s - this.startS, hour: this.preset.hour + (this.time / 60) * 0.2, bestMeters: this.bestMeters, cockpit: this.cameraMode === 'first' });
    this.metrics.stepMs += performance.now() - t0; this.metrics.steps++;
  }
  private crashFx(power: number, kind: string): void {
    this.shake = Math.min(1, this.shake + 0.25 + power * 0.04);
    this.audio.crash(power); this.hud.flashHit(power);
    this.combo = 0; this.comboT = 0;
    void kind;
  }
  private collide(): void {
    const P = this.player;
    const pr = { s: P.s, u: P.u, len: P.len, wid: P.wid, psi: P.psi };
    for (const n of this.traffic.npcs) {
      if (n.dir !== 1 || Math.abs(n.s - P.s) > 14) continue;
      const o = overlap(pr, { s: n.s, u: n.u, len: n.len, wid: n.wid, psi: n.psi });
      if (!o) continue;
      const mp = P.mass, mn = n.mass, tot = mp + mn;
      P.s -= o.nx * o.depth * (mn / tot); P.u -= o.nz * o.depth * (mn / tot);
      n.s += o.nx * o.depth * (mp / tot); n.u += o.nz * o.depth * (mp / tot);
      pr.s = P.s; pr.u = P.u;
      const pvx = P.v * Math.cos(P.psi), pvz = P.v * Math.sin(P.psi);
      const nvx = n.v * Math.cos(n.psi), nvz = n.v * Math.sin(n.psi) + n.vu;
      const rel = (pvx - nvx) * o.nx + (pvz - nvz) * o.nz;
      if (rel <= 0.05) continue;
      const j = (1.25 * rel) / (1 / mp + 1 / mn);
      const pvx2 = pvx - (j / mp) * o.nx, pvz2 = pvz - (j / mp) * o.nz;
      const nvx2 = nvx + (j / mn) * o.nx, nvz2 = nvz + (j / mn) * o.nz;
      P.v = Math.min(P.v, Math.hypot(pvx2, pvz2));
      P.psi = Math.max(-0.9, Math.min(0.9, Math.atan2(pvz2, Math.max(0.5, pvx2))));
      P.yawRate += Math.sign(o.nz || 1) * -rel * 0.04;
      const dmg = Math.min(70, Math.max(0, (rel - 1.2) * 2.7 * (0.6 + 0.4 * mn / mp)));
      if (dmg > 0) P.hurt(dmg);
      if (rel > 4.5 || n.state === 'wreck') this.traffic.wreck(n, rel, Math.sign(o.nz || 1), 0);
      else { n.psi += Math.sign(o.nz || 1) * 0.12; n.acc = -3; }
      n.v = Math.max(0, nvx2); n.vu = nvz2; n.counted = true;
      this.crashFx(rel, 'car');
      if (rel > 6) this.hud.popup(P.wrecked ? 'WRECKED' : 'CRASH', P.wrecked ? '' : `-${Math.round(dmg)}% condition`);
    }
  }
  private scoring(dt: number): void {
    const P = this.player, mph = P.v * MPS_TO_MPH;
    if (mph > this.topMph) this.topMph = mph;
    if (P.wrecked) return;
    if (this.combo > 0) { this.comboT -= dt; if (this.comboT <= 0) this.combo = 0; }
    if (mph > 45) this.score += (mph - 45) * 0.8 * dt * (1 + Math.min(this.combo, 9) * 0.15);
    const hw = P.halfAcross();
    for (const n of this.traffic.npcs) {
      if (n.dir !== 1 || n.state === 'wreck' || n.counted) continue;
      const ds = n.s - P.s, reach = (n.len + P.len) / 2;
      if (Math.abs(ds) > reach + 8) { const g = this.nearMiss.get(n.id); if (g !== undefined) { if (ds < -reach - 2) this.award(n, g); this.nearMiss.delete(n.id); } continue; }
      if (Math.abs(ds) < reach + 0.5) {
        const gap = Math.abs(n.u - P.u) - (n.wid / 2 + hw);
        if (gap > 0 && gap < 1.5 && P.v > mpsFromMph(40)) this.nearMiss.set(n.id, Math.min(this.nearMiss.get(n.id) ?? 9, gap));
      }
    }
    if (this.nearMiss.size > 80) this.nearMiss.clear();
  }
  private award(n: Npc, gap: number): void {
    n.counted = true;
    const mph = this.player.v * MPS_TO_MPH;
    if (mph < 40) return;
    this.combo++; this.comboT = 4.2; this.closeCalls++;
    const mult = 1 + Math.min(this.combo - 1, 9) * 0.5;
    const pts = Math.round((60 + (mph - 40) * 1.6) * (1 + (1.5 - gap) / 1.5) * mult);
    this.score += pts;
    this.hud.popup(n.heavy ? 'CLOSE CALL  TRUCK' : 'CLOSE CALL', `+${pts}  x${mult.toFixed(1)}`);
  }

  // ------------------------------------------------------------------ chunks
  private ensureChunks(all: boolean): void {
    const s = this.player.s, i0 = Math.floor((s - BEHIND) / CL), i1 = Math.floor((s + AHEAD) / CL);
    let built = 0;
    for (let i = i0; i <= i1; i++) {
      if (this.chunks.has(i)) continue;
      if (!all && built >= 2) break;
      const c = this.builder.build(i); this.chunks.set(i, c); this.scene.add(c.group); built++;
    }
    for (const [i, c] of this.chunks) if (i < i0 - 1 || i > i1 + 1) { c.group.removeFromParent(); this.builder.dispose(c); this.chunks.delete(i); }
  }

  // ------------------------------------------------------------------ rendering
  private color(hex: string): THREE.Color { let c = this.colors.get(hex); if (!c) { c = new THREE.Color(hex); this.colors.set(hex, c); } return c; }
  /** Fills this.pose for a vehicle at road coordinates (angles toward +u). */
  private place(s: number, u: number, psi: number, dir: number, lift: number, roll = 0): void {
    const rp = roadAt(s, this.rp), ct = Math.cos(rp.theta), st = Math.sin(rp.theta);
    const q = this.pose;
    let fx = st * dir, fy = rp.slope * dir, fz = -ct * dir;
    const l = Math.hypot(fx, fy, fz); fx /= l; fy /= l; fz /= l;
    const cp = Math.cos(psi), sp = Math.sin(psi);
    fx = fx * cp + ct * sp; fy = fy * cp; fz = fz * cp + st * sp;
    const fl = Math.hypot(fx, fy, fz); fx /= fl; fy /= fl; fz /= fl;
    // right = f x up(0,1,0)
    let rx = -fz, ry = 0, rz = fx; const rl = Math.hypot(rx, rz) || 1; rx /= rl; rz /= rl;
    let ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    if (roll) { const cr = Math.cos(roll), sr = Math.sin(roll), nrx = rx * cr - ux * sr, nry = ry * cr - uy * sr, nrz = rz * cr - uz * sr; ux = ux * cr + rx * sr; uy = uy * cr + ry * sr; uz = uz * cr + rz * sr; rx = nrx; ry = nry; rz = nrz; }
    q.fx = fx; q.fy = fy; q.fz = fz; q.ux = ux; q.uy = uy; q.uz = uz; q.lx = -rx; q.ly = -ry; q.lz = -rz;
    q.x = rp.x + ct * u - this.origin.x; q.y = rp.y + lift; q.z = rp.z + st * u - this.origin.y;
  }
  private addInstance(model: string, color: THREE.Color, brake: number, indL: number, indR: number, head: number, beam: boolean): void {
    const q = this.pose, [l, up, f] = this.tmpV;
    l.set(q.lx, q.ly, q.lz); up.set(q.ux, q.uy, q.uz); f.set(q.fx, q.fy, q.fz);
    this.fleet.add({ model, x: q.x, y: q.y, z: q.z, left: l, up, fwd: f, color, brake, indL, indR, head, beam });
  }

  render(): void {
    const P = this.player, cam = this.camera;
    // floating origin so far-away coordinates never lose precision
    const pw = roadAt(P.s, this.rp);
    this.origin.set(Math.round(pw.x / 1000) * 1000, Math.round(pw.z / 1000) * 1000);
    for (const c of this.chunks.values()) c.group.position.set(c.origin.x - this.origin.x, c.origin.y, c.origin.z - this.origin.y);
    this.updateCamera(1 / 60, false);
    // vehicles
    const blink = (this.time * 1.7) % 1 < 0.55 ? 1 : 0, head = this.preset.head;
    this.fleet.begin();
    const cp = cam.position, cf = this.tmpV[3]; cam.getWorldDirection(cf);
    for (const n of this.traffic.npcs) {
      const dx = n.s - P.s;
      if (dx > AHEAD + 60 || dx < -BEHIND - 60) continue;
      this.place(n.s, n.u, n.psi, n.dir, 0.38);
      const q = this.pose;
      const rx = q.x - cp.x, rz = q.z - cp.z, dist = Math.hypot(rx, rz);
      if (dist > 20 && (rx * cf.x + rz * cf.z) < -0.15 * dist) continue;
      const col = n.heavy ? this.color(HEAVY_PAINT[n.paint % HEAVY_PAINT.length]) : this.color(VEHICLES[n.model as VehicleKind].paints[n.paint % VEHICLES[n.model as VehicleKind].paints.length]);
      const l = (n.signal === -1 || n.hazard) ? blink : 0, r = (n.signal === 1 || n.hazard) ? blink : 0;
      this.addInstance(n.model, col, n.brake, l, r, head, dist < 260);
    }
    // the player's car
    this.place(P.s, P.u, P.psi, 1, 0.36, P.roll);
    const brk = this.keys.has('KeyS') || this.keys.has('ArrowDown') || this.keys.has('Space') ? 1 : 0;
    this.addInstance((this.cameraMode === 'first' ? 'cab:' : 'player:') + this.opts.model, this.color(VEHICLES[this.opts.model].paints[0]), brk, 0, 0, this.headlights ? Math.max(head, 0.0) : 0, true);
    this.fleet.end();
    this.cockpit.setPose(this.pose);
    this.cockpit.update(P.v * MPS_TO_MPH, P.v, wheelFrac(P.steerAngle / VEHICLES[this.opts.model].maxSteer, P.steer), 1 / 60, { hour: this.preset.hour + (this.time / 60) * 0.2, meters: P.s - this.startS, time: this.time });
    const info = this.renderer.info; info.autoReset = false;
    if (this.cameraMode === 'first') { info.reset(); this.cockpit.mirror.tick(this.renderer, this.scene); this.metrics.mirrorCalls = info.render.calls; }
    info.reset();
    this.renderer.render(this.scene, cam);
    this.metrics.calls = info.render.calls; this.metrics.tris = info.render.triangles;
  }

  private updateCamera(dt: number, snap: boolean): void {
    const P = this.player, cam = this.camera;
    this.camU += (P.u - this.camU) * (snap ? 1 : Math.min(1, dt * 5));
    const k = Math.min(1, P.v / 70);
    const target = new THREE.Vector3(), look = new THREE.Vector3();
    const ox = this.origin.x, oz = this.origin.y;
    if (this.cameraMode === 'third') {
      const back = 6.8 + P.v * 0.02, sCam = P.s - back * (this.lookBack ? -1.6 : 1);
      const rc = roadAt(sCam, this.rp), ct = Math.cos(rc.theta), st = Math.sin(rc.theta);
      target.set(rc.x + ct * this.camU - ox, rc.y + 2.25 + k * 0.5, rc.z + st * this.camU - oz);
      const sl = P.s + (this.lookBack ? -22 : 16), rl = roadAt(sl, this.rp), cl = Math.cos(rl.theta), sn = Math.sin(rl.theta);
      const lu = this.camU * 0.55 + P.u * 0.45 + P.psi * 5;
      look.set(rl.x + cl * lu - ox, rl.y + 1.1, rl.z + sn * lu - oz);
      cam.fov = 62 + k * 16;
    } else {
      this.place(P.s, P.u, P.psi, 1, 0.36, P.roll);
      const q = this.pose, e = this.seat;
      const lookDir = this.lookBack ? -1 : 1;
      target.set(q.x + q.lx * e.x + q.ux * (e.y + this.eyeLift) + q.fx * (e.z + this.eyeFwd), q.y + q.ly * e.x + q.uy * (e.y + this.eyeLift) + q.fy * (e.z + this.eyeFwd), q.z + q.lz * e.x + q.uz * (e.y + this.eyeLift) + q.fz * (e.z + this.eyeFwd));
      look.set(target.x + q.fx * 20 * lookDir, target.y + q.fy * 20 * lookDir - q.uy * 0.9, target.z + q.fz * 20 * lookDir);
      cam.fov = 66 + k * 7;
    }
    if (this.shake > 0) {
      const a = this.shake * 0.12, t = this.time * 61;
      target.x += Math.sin(t) * a; target.y += Math.cos(t * 1.3) * a; target.z += Math.sin(t * 0.7) * a;
    }
    cam.position.copy(target); cam.up.set(0, 1, 0); cam.lookAt(look);
    cam.near = this.cameraMode === 'first' ? 0.08 : 0.3; cam.updateProjectionMatrix();
    this.sky.mesh.position.copy(cam.position);
    this.sun.target.position.copy(cam.position);
    void snap;
  }

  // ------------------------------------------------------------------ test / debug
  stats() {
    const m = this.metrics, sorted = [...m.frameMs].sort((a, b) => a - b), n = sorted.length;
    return {
      frames: m.frames, avgFrameMs: n ? m.frameMs.reduce((a, b) => a + b, 0) / n : 0, p95FrameMs: n ? sorted[Math.floor(n * 0.95)] : 0, maxFrameMs: m.maxFrameMs,
      avgCpuMs: m.frames ? m.cpuMs / m.frames : 0, avgStepMs: m.steps ? m.stepMs / m.steps : 0, calls: m.calls, mirrorCalls: m.mirrorCalls, mirrorRenders: this.cockpit.mirror.renders, triangles: m.tris,
      chunks: this.chunks.size, npcs: this.traffic.npcs.length, lanechanges: this.traffic.stats.lanechanges, cutoffs: this.traffic.stats.cutoffs,
      mph: this.player.v * MPS_TO_MPH, score: this.score, health: this.player.health, camera: this.cameraMode, s: this.player.s,
    };
  }
}
void NL; void STEP; void hash; void laneU;
