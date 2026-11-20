/**
 * Cheap far crowds: instanced low-poly pedestrians (vertex-animated walk, no skinning, no physics) walking the sidewalk graph,
 * instanced simplified cars following the lane graph (queue at lights, no physics), and static curbside parked cars that turn
 * into real stealable vehicles when the player comes close. Everything is 3 draw calls. Real (skinned/physics) actors live in
 * Population/Traffic near the player; this layer fills the distance so the city feels like Manhattan.
 */
import * as THREE from 'three';
import type { CityMap, Lane } from '../world/citymap';
import { samplePath, signalState, pedestrianMayCross, districtAt, DISTRICT_INFO, nearestLane } from '../world/citymap';
import type { VehicleManager } from './vehicles';
import type { Traffic } from './traffic';
import type { Population } from './population';
import type { Vehicle } from '../vehicles/vehicle';
import { PARKED_MIX, VEHICLES } from '../vehicles/specs';
import { yieldsToSiren, signalCap, stopSignCap } from './trafficRules';
import { Rng } from '../core/rng';
import { carActivity, pedActivity, districtNightFactor } from './schedule';

export interface CrowdCaps { farCars: number; farPeds: number; parked: number }

const CAR_PAINT = [0xb8bcc2, 0x1d1f24, 0xe8e8e8, 0x7a1f26, 0x24406b, 0x6b7a86, 0xc9a227, 0x3d5a3a, 0x8a8f95, 0xd8d0c0, 0x2f2f33];
const BUS_PAINT = [0x2a5f9e, 0x3d7a4a, 0xb8bcc2, 0xc9a227];
const SHIRTS = [0x2b4a7a, 0xb23a3a, 0x3a7a4a, 0xd8d8d0, 0x1d1d22, 0x8a5a9a, 0xd89a2b, 0x5a6a7a, 0x9a3a1a, 0x4aa0b0, 0xe0c8c0];
const PANTS = [0x23262f, 0x3a4a6a, 0x4a3a2a, 0x1a1a1a, 0x6a6a70, 0x2f3a2f];
const SKIN = [0xf0c8a0, 0xd9a577, 0xb07a4f, 0x7a4a2f, 0x4f2f20, 0xe8b890];

/** Per-instance tint attributes + optional leg/arm swing, injected into a Lambert material. */
function patchMaterial(mat: THREE.MeshLambertMaterial, walk: boolean) {
  const uniforms = { uTime: { value: 0 } };
  mat.userData.crowdUniforms = uniforms;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = uniforms.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute float aMask; attribute vec3 aTint; attribute vec3 aTint2; attribute vec3 aSkin;
        ${walk ? 'attribute float aSwing; attribute float aPhase; attribute float aAmp; uniform float uTime;' : ''}`)
      .replace('#include <color_vertex>', `#include <color_vertex>
        vec3 tintSel = aMask < 0.5 ? vec3(1.0) : aMask < 1.5 ? aTint : aMask < 2.5 ? aTint2 : aSkin;
        vColor = color.rgb * tintSel;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        ${walk ? 'transformed.z += aSwing * sin(uTime * 6.2 + aPhase) * 0.34 * aAmp;' : ''}`);
  };
}
const hex = (c: number, out: THREE.Color) => out.setHex(c);

function box(w: number, h: number, d: number, x: number, y: number, z: number, col: number, mask: number, swing = 0): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).toNonIndexed();
  g.translate(x, y, z);
  const n = g.attributes.position.count, c = new THREE.Color(col);
  const colors = new Float32Array(n * 3), masks = new Float32Array(n), sw = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // darken lower faces a touch for cheap ambient occlusion
    const shade = g.attributes.normal.getY(i) < -0.5 ? 0.6 : 1;
    colors[i * 3] = c.r * shade; colors[i * 3 + 1] = c.g * shade; colors[i * 3 + 2] = c.b * shade; masks[i] = mask;
    sw[i] = swing === 0 ? 0 : swing * Math.min(1, Math.max(0, (1.5 - g.attributes.position.getY(i)) / 0.8));
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); g.setAttribute('aMask', new THREE.BufferAttribute(masks, 1)); g.setAttribute('aSwing', new THREE.BufferAttribute(sw, 1));
  g.deleteAttribute('uv');
  return g;
}
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  for (const name of ['position', 'normal', 'color', 'aMask', 'aSwing']) {
    const size = parts[0].attributes[name].itemSize; let total = 0; for (const p of parts) total += p.attributes[name].count;
    const arr = new Float32Array(total * size); let o = 0;
    for (const p of parts) { arr.set(p.attributes[name].array as Float32Array, o); o += p.attributes[name].count * size; }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  return out;
}
function carGeometry(): THREE.BufferGeometry {
  return merge([
    box(1.85, 0.62, 4.5, 0, 0.62, 0, 0xffffff, 1),
    box(1.6, 0.52, 2.4, 0, 1.18, -0.2, 0x2a323a, 0),
    box(1.5, 0.08, 1.9, 0, 1.46, -0.2, 0xffffff, 1),
    box(0.22, 0.56, 0.62, 0.9, 0.28, 1.4, 0x111111, 0), box(0.22, 0.56, 0.62, -0.9, 0.28, 1.4, 0x111111, 0),
    box(0.22, 0.56, 0.62, 0.9, 0.28, -1.4, 0x111111, 0), box(0.22, 0.56, 0.62, -0.9, 0.28, -1.4, 0x111111, 0),
    box(1.5, 0.12, 0.06, 0, 0.78, -2.27, 0xc02020, 0),
  ]);
}
/** Head and tail light blocks, drawn unlit (bright) at night through a second instanced mesh that shares the car matrices. */
function carLightGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const sx of [-1, 1]) {
    parts.push(box(0.38, 0.2, 0.08, sx * 0.62, 0.74, 2.27, 0xfff0c0, 0), box(0.34, 0.16, 0.08, sx * 0.66, 0.78, -2.28, 0xff2418, 0));
  }
  return merge(parts);
}
function busGeometry(): THREE.BufferGeometry {
  const L = 11.6;
  const parts = [
    box(2.5, 2.5, L, 0, 1.75, 0, 0xffffff, 1),
    box(2.54, 0.85, L - 1.2, 0, 2.15, 0, 0x28323c, 0),
    box(2.52, 0.14, L, 0, 0.78, 0, 0xe8e8e8, 0),
    box(1.6, 0.3, 3, 0, 3.1, -1.5, 0xb8bcc2, 0),
    box(2.4, 0.5, 0.1, 0, 2.0, L / 2 + 0.01, 0x1a1f26, 0),
    box(2.3, 0.2, 0.1, 0, 3.1, L / 2 + 0.02, 0xffd060, 0),
  ];
  for (const z of [-3.8, 3.4]) for (const sx of [-1, 1]) parts.push(box(0.3, 1.0, 1.0, sx * 1.2, 0.5, z, 0x111111, 0));
  return merge(parts);
}
function pedGeometry(): THREE.BufferGeometry {
  return merge([
    box(0.4, 0.58, 0.24, 0, 1.18, 0, 0xffffff, 1),
    box(0.17, 0.82, 0.18, 0.1, 0.41, 0, 0xffffff, 2, 1), box(0.17, 0.82, 0.18, -0.1, 0.41, 0, 0xffffff, 2, -1),
    box(0.09, 0.56, 0.1, 0.27, 1.17, 0, 0xffffff, 1, -0.8), box(0.09, 0.56, 0.1, -0.27, 1.17, 0, 0xffffff, 1, 0.8),
    box(0.2, 0.24, 0.22, 0, 1.62, 0, 0xffffff, 3),
  ]);
}
function addInstanceAttrs(g: THREE.InstancedBufferGeometry, n: number, walk: boolean) {
  g.setAttribute('aTint', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aTint2', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  g.setAttribute('aSkin', new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3));
  if (walk) { g.setAttribute('aPhase', new THREE.InstancedBufferAttribute(new Float32Array(n), 1)); g.setAttribute('aAmp', new THREE.InstancedBufferAttribute(new Float32Array(n), 1)); }
}
function makeInstanced(base: THREE.BufferGeometry, n: number, walk: boolean): { mesh: THREE.InstancedMesh; geo: THREE.InstancedBufferGeometry } {
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = base.index; for (const k of Object.keys(base.attributes)) geo.setAttribute(k, base.attributes[k]);
  addInstanceAttrs(geo, n, walk);
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  patchMaterial(mat, walk);
  const mesh = new THREE.InstancedMesh(geo, mat, n);
  mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false; mesh.count = 0;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  return { mesh, geo };
}

interface GCar { lane: Lane; s: number; v: number; paint: number; len: number; x: number; z: number; yaw: number; id: number;
  /** lateral blend left over from a lane change (decays) */ ox: number; oz: number; lcCool: number;
  bus: boolean; /** seconds left standing at a stop (buses) */ dwell: number; stopS: number; planLane: number; ssLane?: number; ssWait?: number; /** lateral offset held inside the lane (+ left): clears kerbside parked cars, tucks right for sirens */ ks?: number }
interface GPed { from: number; to: number; t: number; speed: number; wait: number; off: number; look: number; x: number; z: number; /** height on a bridge walkway */ y?: number; yaw: number; tint: number; tint2: number; skin: number; phase: number; leader?: GPed; dead?: boolean }
interface Slot { x: number; z: number; yaw: number; paint: number; kind: number; taken: boolean; real: Vehicle | null; /** health fraction when last put away: a damaged car stays damaged */ hp?: number }
/** Paint of a parked car: the same for the far instanced copy and the real car, so the swap is invisible. */
const parkedPaint = (s: { kind: number; paint: number }) => { const p = VEHICLES[PARKED_MIX[s.kind % PARKED_MIX.length]].paints; return p[s.paint % p.length]; };

const sp = { x: 0, z: 0, dx: 0, dz: 0, y: 0 as number | undefined };
const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), scl = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0), col = new THREE.Color();

/** Cheap crowd members are only removed this close to the player (behind the camera lens); real ones take over from PROMOTE_R. */
const NEAR_KILL = 9, PROMOTE_R = 60;
export class Crowd {
  readonly cars: GCar[] = []; readonly peds: GPed[] = [];
  /** siren vehicles (set by the game from Traffic.sirenSources): far cars pull over for them */
  sirens: { x: number; z: number; fx: number; fz: number; speed: number }[] = [];
  caps: CrowdCaps = { farCars: 0, farPeds: 0, parked: 0 };
  hour = 17; busCount = 0;
  private lightMesh: THREE.InstancedMesh; private busMesh: ReturnType<typeof makeInstanced>;
  private carMesh: ReturnType<typeof makeInstanced>; private pedMesh: ReturnType<typeof makeInstanced>; private parkMesh: ReturnType<typeof makeInstanced>;
  private slots: Slot[] = []; private visSlots: Slot[] = [];
  private rng = new Rng(4242); private nextId = 1; private t = 0; private slowT = 0; private parkT = 0; private slowIdx = 0;
  private carLaneIdx: number[] = [];
  prewarming = false;
  /**
   * Hand-over hooks (wired by the game): a far-crowd car/pedestrian that comes within PROMOTE_R of the player is replaced
   * in place by a real, fully simulated one (return true) instead of vanishing. When the hook declines (real caps full)
   * the cheap one keeps walking/driving until it is almost beside the camera, so nobody blinks out at mid range.
   */
  promoteCar: ((lane: Lane, s: number, bus: boolean) => boolean) | null = null;
  promotePed: ((x: number, z: number, from: number, to: number, yaw: number) => boolean) | null = null;
  /** Connects the hand-over hooks to the real traffic / pedestrian systems; `caps` returns the current real-population caps. */
  wire(traffic: Traffic, pop: Population, caps: () => { traffic: number; peds: number }) {
    this.promoteCar = (lane, s, bus) => {
      if (bus || traffic.cars.length >= caps().traffic) return false;
      samplePath(lane, s, sp);
      for (const o of this.vehicles.list) if (Math.abs(o.position.x - sp.x) < 8 && Math.abs(o.position.z - sp.z) < 8) return false; // never spawn inside a real car
      traffic.spawnOnLane(traffic.pickKind(), lane, s);
      return true;
    };
    this.promotePed = (x, z, from, to, yaw) => {
      if (pop.npcs.filter(n => n.role === 'civilian' && !n.persistent).length >= caps().peds) return false;
      const n = pop.spawn('civilian', x, z, 0.2);
      n.node = from; n.nextNode = to; n.char.yaw = yaw;
      return true;
    };
  }
  constructor(scene: THREE.Scene, private city: CityMap, private vehicles: VehicleManager, private time: () => number) {
    this.carMesh = makeInstanced(carGeometry(), 400, false); this.parkMesh = makeInstanced(carGeometry(), 1200, false);
    this.pedMesh = makeInstanced(pedGeometry(), 900, true);
    this.busMesh = makeInstanced(busGeometry(), 16, false);
    const lg = carLightGeometry(), lm = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    this.lightMesh = new THREE.InstancedMesh(lg, lm, 400); this.lightMesh.instanceMatrix = this.carMesh.mesh.instanceMatrix;
    this.lightMesh.frustumCulled = false; this.lightMesh.castShadow = false; this.lightMesh.count = 0; this.lightMesh.visible = false;
    scene.add(this.carMesh.mesh, this.parkMesh.mesh, this.pedMesh.mesh, this.busMesh.mesh, this.lightMesh);
    this.carLaneIdx = city.lanes.filter(l => !l.connector && l.length > 30).map(l => l.id);
    this.buildSlots();
  }
  /** Curbside slots along every street between intersections. */
  private buildSlots() {
    const r = new Rng(99);
    for (const road of this.city.roads) {
      {
        const a = road.from + 8, b = road.to - 8;
        for (const side of [1, -1]) {
          for (let s = a; s <= b; s += 6.4) {
            if (!r.chance(0.42)) continue;
            const off = side * (road.half - 0.45), along = s + r.range(-0.5, 0.5);
            const x = road.axis === 'x' ? along : road.coord + off, z = road.axis === 'x' ? road.coord + off : along;
            r.chance(0.5); // (keeps the seeded colours / kinds below unchanged)
            // nose with the traffic on this side of the street: heading of the nearest driving lane (right-hand traffic)
            const nl = nearestLane(this.city, x, z);
            if (nl) samplePath(nl.lane, nl.s, sp);
            const yaw = nl ? Math.atan2(sp.dx, sp.dz) : (road.axis === 'x' ? (side > 0 ? -Math.PI / 2 : Math.PI / 2) : (side > 0 ? 0 : Math.PI));
            this.slots.push({ x, z, yaw, paint: r.int(0, CAR_PAINT.length - 1), kind: r.int(0, PARKED_MIX.length - 1), taken: false, real: null });
          }
        }
      }
    }
  }
  /** No parking here (bus stops): the curbside slots within r metres stay empty. */
  clearSlotsNear(x: number, z: number, r: number) { for (const s of this.slots) if ((s.x - x) ** 2 + (s.z - z) ** 2 < r * r) s.taken = true; }
  /** Ghost + real counts within r metres of a point (for tests and HUD debugging). */
  countNear(x: number, z: number, r: number) {
    let cars = 0, peds = 0, parked = 0; const r2 = r * r;
    for (const c of this.cars) if ((c.x - x) ** 2 + (c.z - z) ** 2 < r2) cars++;
    for (const p of this.peds) if ((p.x - x) ** 2 + (p.z - z) ** 2 < r2) peds++;
    for (const s of this.visSlots) if (!s.taken && (s.x - x) ** 2 + (s.z - z) ** 2 < r2) parked++;
    return { cars, peds, parked };
  }
  clear() { this.cars.length = 0; this.peds.length = 0; this.carMesh.mesh.count = 0; this.pedMesh.mesh.count = 0; }

  update(dt: number, focus: THREE.Vector3, caps: CrowdCaps) {
    caps = { farCars: Math.round(caps.farCars * carActivity(this.hour)), farPeds: Math.round(caps.farPeds * pedActivity(this.hour)), parked: caps.parked };
    this.caps = caps; this.t += dt;
    this.lightMesh.visible = this.hour >= 18.8 || this.hour < 6.2;
    const nowT = this.time();
    (this.pedMesh.mesh.material as THREE.MeshLambertMaterial).userData.crowdUniforms.uTime.value = this.t;
    this.updateCars(dt, nowT, focus);
    this.updatePeds(dt, nowT, focus);
    this.parkT -= dt; if (this.parkT <= 0) { this.parkT = 0.6; this.updateParked(focus); }
  }

  // ---------------------------------------------------------------- cars
  private spawnCar(focus: THREE.Vector3, bus = false) {
    for (let tries = 0; tries < 10; tries++) {
      const lane = this.city.lanes[this.carLaneIdx[Math.floor(Math.random() * this.carLaneIdx.length)]];
      if (bus && lane.length < 70) continue;
      const s = 6 + Math.random() * (lane.length - 12);
      samplePath(lane, s, sp);
      const d = Math.hypot(sp.x - focus.x, sp.z - focus.z);
      if (d < (this.prewarming ? 40 : 70) || d > 230) continue;
      if (Math.random() > DISTRICT_INFO[districtAt(this.city, sp.x, sp.z)].trafficDensity) continue;
      if (this.cars.some(c => c.lane === lane && Math.abs(c.s - s) < (bus ? 20 : 13))) continue;
      if (this.vehicles.list.some(o => Math.abs(o.position.x - sp.x) < 10 && Math.abs(o.position.z - sp.z) < 10)) continue;
      this.cars.push({ lane, s, v: lane.speed * 0.8, paint: bus ? BUS_PAINT[Math.floor(Math.random() * BUS_PAINT.length)] : CAR_PAINT[Math.floor(Math.random() * CAR_PAINT.length)], len: bus ? 11.6 : 4.5, x: sp.x, z: sp.z, yaw: Math.atan2(sp.dx, sp.dz), id: this.nextId++, ox: 0, oz: 0, lcCool: Math.random() * 8, bus, dwell: 0, stopS: -1, planLane: -1 });
      return true;
    }
    return false;
  }
  private updateCars(dt: number, t: number, focus: THREE.Vector3) {
    const cars = this.cars, cap = Math.min(this.caps.farCars, 400);
    // recycle: too close (the real traffic takes over), too far, or on top of a real vehicle
    this.slowT -= dt;
    const checkReal = this.slowT <= 0; if (checkReal) this.slowT = 0.4;
    for (let i = cars.length - 1; i >= 0; i--) {
      const c = cars[i], d = Math.hypot(c.x - focus.x, c.z - focus.z);
      let kill = d < NEAR_KILL || d > 250 || i >= cap;
      if (!kill && d < PROMOTE_R && !this.prewarming && this.promoteCar?.(c.lane, c.s, c.bus)) kill = true;
      if (!kill && checkReal && d < 140) for (const o of this.vehicles.list) if (Math.abs(o.position.x - c.x) < 6 && Math.abs(o.position.z - c.z) < 6) { kill = true; break; }
      if (kill) cars.splice(i, 1);
    }
    let spawns = this.prewarming ? 60 : 4;
    while (cars.length < cap && spawns-- > 0) if (!this.spawnCar(focus)) break;
    // a few city buses on the long avenue lanes
    this.busCount = 0; for (const c of cars) if (c.bus) this.busCount++;
    const busCap = Math.min(14, Math.round(cap / 28));
    if (this.busCount < busCap && cars.length < 399 && (this.prewarming || Math.random() < 0.08)) for (let k = 0; k < (this.prewarming ? 6 : 1); k++) if (this.spawnCar(focus, true)) this.busCount++;
    // per-lane ordering for leader lookup
    const byLane = new Map<number, GCar[]>();
    for (const c of cars) { const l = byLane.get(c.lane.id); if (l) l.push(c); else byLane.set(c.lane.id, [c]); }
    for (const c of cars) {
      const lane = c.lane;
      let target = lane.speed * (c.bus ? 0.7 : 0.85);
      c.lcCool -= dt;
      if (c.ox !== 0 || c.oz !== 0) { const k = Math.exp(-dt * 1.1); c.ox *= k; c.oz *= k; if (Math.abs(c.ox) + Math.abs(c.oz) < 0.02) { c.ox = 0; c.oz = 0; } }
      // bus stop: roll once per lane, brake to a halt at the kerb, stand a while, then pull away
      if (c.bus && !lane.connector) {
        if (c.planLane !== lane.id) { c.planLane = lane.id; c.stopS = c.s < lane.length * 0.4 && Math.random() < 0.6 ? c.s + 12 + Math.random() * Math.max(2, lane.length - c.s - 40) : -1; }
        if (c.dwell > 0) { c.dwell -= dt; target = 0; if (c.dwell <= 0) c.stopS = -1; }
        else if (c.stopS > 0) {
          const dStop = c.stopS - c.s;
          if (dStop < -2) c.stopS = -1;
          else { target = Math.min(target, Math.max(0, dStop - 0.5) * 0.7); if (dStop < 1.5 && c.v < 0.5) c.dwell = 7 + Math.random() * 7; }
        }
      }
      if (!lane.connector) {
        const inter = this.city.intersections[lane.intersection];
        const dStop = lane.length - c.s - 5.4;
        if (inter.signalized) target = Math.min(target, signalCap(signalState(inter, lane.axis, t), dStop, c.v));
        else if (dStop > -1) { // stop sign: halt, wait a beat, go once nobody else is in the junction (R6-T)
          if (c.ssLane !== lane.id) { c.ssLane = lane.id; c.ssWait = 0; }
          if (dStop < 1.8 && c.v < 0.4) c.ssWait = (c.ssWait ?? 0) + dt;
          let clear = true;
          if (dStop < 14) for (const o of cars) if (o !== c && o.lane.intersection === lane.intersection && o.lane.connector && o.v > 0.3) { clear = false; break; }
          target = Math.min(target, stopSignCap(dStop, c.v, c.ssWait ?? 0, clear));
        }
      } else target = Math.min(target, 8);
      // kerb lane: hold clear of kerbside parked cars; a siren behind / oncoming: tuck to the kerb and slow down
      let wantKs = !lane.connector && lane.lane === lane.lanes - 1 ? 0.45 : 0;
      for (const sv of this.sirens) if (yieldsToSiren(c.x, c.z, Math.sin(c.yaw), Math.cos(c.yaw), sv.x, sv.z, sv.fx, sv.fz, sv.speed)) { wantKs = -1.3; target = Math.min(target, 3); break; }
      c.ks = (c.ks ?? 0) + (wantKs - (c.ks ?? 0)) * Math.min(1, dt * 2.5);
      const same = byLane.get(lane.id);
      let lead: GCar | null = null, leadGap = 99;
      if (same && same.length > 1) for (const o of same) {
        if (o === c) continue; const gap = o.s - c.s - (o.len + c.len) * 0.5 - 0.5;
        if (gap > -2 && gap < 40) { target = Math.min(target, Math.max(0, gap - 2.5) * 0.9); if (gap < leadGap) { leadGap = gap; lead = o; } }
      }
      // overtake / even out: move to the neighbouring lane when it is free (a stopped bus ahead makes it likely)
      if (!lane.connector && c.lcCool <= 0 && c.v > 3 && c.s > 12 && lane.length - c.s > 32 && !c.bus) {
        const stuck = lead !== null && (lead as GCar).dwell > 0 && leadGap < 24;
        if (stuck || Math.random() < dt * 0.012) {
          const toId = lane.lane > 0 ? lane.leftLane : lane.rightLane;
          if (toId !== undefined) {
            const tl = this.city.lanes[toId], other = byLane.get(toId);
            if (!other || !other.some(o => Math.abs(o.s - c.s) < 16 + o.v * 0.4)) {
              samplePath(tl, Math.min(c.s, tl.length - 0.1), sp);
              c.ox = c.x - sp.x; c.oz = c.z - sp.z; c.lane = tl; c.lcCool = 8 + Math.random() * 10;
              (other ?? byLane.set(toId, []).get(toId)!).push(c);
              (same as GCar[]).splice((same as GCar[]).indexOf(c), 1);
            } else c.lcCool = 1.5;
          } else c.lcCool = 6;
        }
      }
      c.v += THREE.MathUtils.clamp(target - c.v, -7 * dt, 2.6 * dt);
      if (c.v < 0) c.v = 0;
      c.s += c.v * dt;
      if (c.s >= lane.length) {
        if (!lane.next.length) { c.s = lane.length - 0.01; c.v = 0; continue; }
        c.s -= lane.length; c.lane = this.city.lanes[lane.next[Math.floor(Math.random() * lane.next.length)]];
        if (c.s > c.lane.length) c.s = 0;
      }
      samplePath(c.lane, c.s, sp);
      const ks = c.ks ?? 0; c.x = sp.x + c.ox + sp.dz * ks; c.z = sp.z + c.oz - sp.dx * ks; const yaw = Math.atan2(sp.dx, sp.dz); c.yaw = c.yaw + Math.atan2(Math.sin(yaw - c.yaw), Math.cos(yaw - c.yaw)) * Math.min(1, dt * 8);
    }
    const mesh = this.carMesh.mesh, geo = this.carMesh.geo;
    const tint = geo.attributes.aTint as THREE.InstancedBufferAttribute;
    const bm = this.busMesh.mesh, btint = this.busMesh.geo.attributes.aTint as THREE.InstancedBufferAttribute;
    let n = 0, nb = 0;
    for (let i = 0; i < cars.length && n < 400; i++) {
      const c = cars[i];
      if (c.bus && nb >= 16) continue;
      samplePath(c.lane, c.s, sp); const y = c.lane.ys ? (sp.y ?? 0) : 0;
      q.setFromAxisAngle(up, c.yaw); pos.set(c.x, y + 0.05, c.z); m4.compose(pos, q, scl);
      hex(c.paint, col);
      if (c.bus) { bm.setMatrixAt(nb, m4); btint.setXYZ(nb, col.r, col.g, col.b); nb++; }
      else { mesh.setMatrixAt(n, m4); tint.setXYZ(n, col.r, col.g, col.b); n++; }
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; tint.needsUpdate = true;
    this.lightMesh.count = n;
    bm.count = nb; bm.instanceMatrix.needsUpdate = true; btint.needsUpdate = true;
  }

  // ---------------------------------------------------------------- pedestrians
  private spawnPed(focus: THREE.Vector3) {
    const nodes = this.city.pedNodes;
    for (let tries = 0; tries < 12; tries++) {
      const nd = nodes[Math.floor(Math.random() * nodes.length)];
      const e = nd.edges[Math.floor(Math.random() * nd.edges.length)];
      if (e.crossing) continue;
      const to = nodes[e.to], t = Math.random();
      const x = nd.x + (to.x - nd.x) * t, z = nd.z + (to.z - nd.z) * t;
      const d = Math.hypot(x - focus.x, z - focus.z);
      if (d < (this.prewarming ? 30 : 66) || d > 210) continue;
      const dist = districtAt(this.city, x, z);
      if (Math.random() > Math.min(1, DISTRICT_INFO[dist].pedDensity * districtNightFactor(dist, this.hour))) continue;
      const rnd = (n: number) => Math.floor(Math.random() * n);
      const lead: GPed = { from: nd.id, to: e.to, t, speed: 1.1 + Math.random() * 0.7, wait: 0, off: (Math.random() - 0.5) * 1.6, look: 0, x, z, yaw: 0, tint: SHIRTS[rnd(SHIRTS.length)], tint2: PANTS[rnd(PANTS.length)], skin: SKIN[rnd(SKIN.length)], phase: Math.random() * 6.28 };
      this.peds.push(lead);
      // friends walk side by side: pairs and the odd trio
      if (Math.random() < 0.3) for (let k = 1, cnt = Math.random() < 0.25 ? 2 : 1; k <= cnt; k++) {
        this.peds.push({ ...lead, leader: lead, off: lead.off + 0.72 * k, phase: lead.phase + k * 1.3, tint: SHIRTS[rnd(SHIRTS.length)], tint2: PANTS[rnd(PANTS.length)], skin: SKIN[rnd(SKIN.length)] });
      }
      return true;
    }
    return false;
  }
  private updatePeds(dt: number, t: number, focus: THREE.Vector3) {
    const peds = this.peds, cap = Math.min(this.caps.farPeds, 900), nodes = this.city.pedNodes;
    for (let i = peds.length - 1; i >= 0; i--) {
      const p = peds[i], d = Math.hypot(p.x - focus.x, p.z - focus.z);
      let gone = d < NEAR_KILL || d > 235 || i >= cap;
      if (!gone && d < PROMOTE_R && !this.prewarming && this.promotePed?.(p.x, p.z, p.from, p.to, p.yaw)) gone = true;
      if (gone) { p.dead = true; peds.splice(i, 1); }
    }
    let spawns = this.prewarming ? 120 : 10;
    while (peds.length < cap && spawns-- > 0) if (!this.spawnPed(focus)) break;
    for (const p of peds) {
      const lead = p.leader && !p.leader.dead ? p.leader : undefined; if (!lead) p.leader = undefined;
      if (lead) { p.from = lead.from; p.to = lead.to; p.t = lead.t; p.wait = lead.wait; p.speed = lead.speed; }
      const a = nodes[p.from], b = nodes[p.to];
      if (lead) { /* follows its friend */ }
      else if (p.wait > 0) { p.wait -= dt; }
      else {
        const edge = a.edges.find(e => e.to === p.to);
        const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        // wait at the kerb for the walk signal
        if (edge?.crossing && p.t < 0.02 && !pedestrianMayCross(this.city.intersections[edge.crossing.intersection], edge.crossing.axis, t)) { p.wait = 0.5; }
        else {
          p.t += p.speed * dt / len;
          if (p.t >= 1) {
            // arrived: choose the next edge (never straight back unless dead end), sometimes stop to chat / look at a phone
            const opts = b.edges.filter(e => e.to !== p.from);
            const e = (opts.length ? opts : b.edges)[Math.floor(Math.random() * (opts.length || b.edges.length))];
            p.from = p.to; p.to = e.to; p.t = 0;
            if (Math.random() < 0.18) p.wait = 2 + Math.random() * 7;
          }
        }
      }
      const a2 = nodes[p.from], b2 = nodes[p.to];
      const dx = b2.x - a2.x, dz = b2.z - a2.z, l = Math.hypot(dx, dz) || 1;
      const crossing = a2.edges.find(e => e.to === p.to)?.crossing;
      const off = crossing ? (lead ? p.off - lead.off : 0) : p.off;
      p.x = a2.x + dx * p.t - dz / l * off; p.z = a2.z + dz * p.t + dx / l * off; p.y = (a2.y ?? 0) + ((b2.y ?? 0) - (a2.y ?? 0)) * p.t;
      const yaw = Math.atan2(dx, dz); if (p.wait <= 0) p.yaw = yaw;
    }
    const mesh = this.pedMesh.mesh, geo = this.pedMesh.geo;
    const a1 = geo.attributes.aTint as THREE.InstancedBufferAttribute, a2 = geo.attributes.aTint2 as THREE.InstancedBufferAttribute, a3 = geo.attributes.aSkin as THREE.InstancedBufferAttribute;
    const ph = geo.attributes.aPhase as THREE.InstancedBufferAttribute, amp = geo.attributes.aAmp as THREE.InstancedBufferAttribute;
    const n = Math.min(peds.length, 900);
    for (let i = 0; i < n; i++) {
      const p = peds[i];
      q.setFromAxisAngle(up, p.yaw); pos.set(p.x, 0.12 + (p.y ?? 0), p.z); m4.compose(pos, q, scl); mesh.setMatrixAt(i, m4);
      hex(p.tint, col); a1.setXYZ(i, col.r, col.g, col.b); hex(p.tint2, col); a2.setXYZ(i, col.r, col.g, col.b); hex(p.skin, col); a3.setXYZ(i, col.r, col.g, col.b);
      ph.setX(i, p.phase); amp.setX(i, p.wait > 0 ? 0 : 1);
    }
    mesh.count = n; mesh.instanceMatrix.needsUpdate = true; a1.needsUpdate = a2.needsUpdate = a3.needsUpdate = ph.needsUpdate = amp.needsUpdate = true;
  }

  // ---------------------------------------------------------------- parked
  private updateParked(focus: THREE.Vector3) {
    const vis: Slot[] = [], cap = Math.min(this.caps.parked, 1200);
    for (const s of this.slots) {
      const d = Math.hypot(s.x - focus.x, s.z - focus.z);
      if (s.real) {
        const v = s.real;
        const gone = !this.vehicles.list.includes(v) || !v.parked || !!v.driver;
        if (gone) { s.taken = true; s.real = null; }
        else if (d > 110) { s.hp = v.health / v.spec.health; if (s.hp > 0.98) s.hp = undefined; this.vehicles.remove(v); s.real = null; }
        else continue; // the real car stands here
      }
      if (s.taken || d > 230) continue;
      if (d < 55 && !this.prewarming) { this.promote(s); continue; }
      vis.push(s);
    }
    vis.sort((a, b) => (a.x - focus.x) ** 2 + (a.z - focus.z) ** 2 - ((b.x - focus.x) ** 2 + (b.z - focus.z) ** 2));
    if (vis.length > cap) vis.length = cap;
    this.visSlots = vis;
    const mesh = this.parkMesh.mesh, geo = this.parkMesh.geo, tint = geo.attributes.aTint as THREE.InstancedBufferAttribute;
    for (let i = 0; i < vis.length; i++) {
      const s = vis[i]; q.setFromAxisAngle(up, s.yaw); pos.set(s.x, 0.05, s.z); m4.compose(pos, q, scl); mesh.setMatrixAt(i, m4);
      col.set(parkedPaint(s)).convertSRGBToLinear(); tint.setXYZ(i, col.r, col.g, col.b);
    }
    mesh.count = vis.length; mesh.instanceMatrix.needsUpdate = true; tint.needsUpdate = true;
  }
  private promote(s: Slot) {
    if (this.vehicles.list.some(o => Math.abs(o.position.x - s.x) < 3 && Math.abs(o.position.z - s.z) < 3)) { s.taken = true; return; }
    const v = this.vehicles.spawn(PARKED_MIX[s.kind % PARKED_MIX.length], s.x, s.z, s.yaw, s.paint, 0.25);
    v.settleParked(0); // settled at rest height and asleep: tall trucks neither drop nor tip
    if (s.hp !== undefined) v.health = Math.max(1, v.spec.health * s.hp);
    v.parked = true; v.doorsLocked = s.paint % 3 !== 0; v.ignition = false; s.real = v;
  }
}
