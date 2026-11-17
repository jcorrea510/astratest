/** Heat (wanted level): crimes raise it, the response escalates, and breaking line of sight loses it. */
import * as THREE from 'three';
import type { Population } from './population';
import type { Traffic, AiCar } from './traffic';
import type { Character } from '../actors/character';
import type { Npc } from '../actors/npc';
import type { CityMap } from '../world/citymap';
import { samplePath } from '../world/citymap';
import type { GameAudio, LoopVoice } from '../ui/contracts';
import type { WeaponId } from '../combat/weapons';

export type Crime = 'assault' | 'shooting' | 'kill' | 'copAttack' | 'copKill' | 'carjack' | 'vehicleWreck' | 'copCarTheft' | 'hitPerson';
const CRIME: Record<Crime, { add: number; min: number }> = {
  assault: { add: 1, min: 1 }, shooting: { add: 1, min: 1 }, kill: { add: 1, min: 2 }, copAttack: { add: 1, min: 2 }, copKill: { add: 2, min: 3 },
  carjack: { add: 1, min: 1 }, vehicleWreck: { add: 0, min: 1 }, copCarTheft: { add: 1, min: 2 }, hitPerson: { add: 1, min: 1 },
};
export { COP_LOOK };
export const UNITS_BY_HEAT = [0, 1, 2, 3, 4, 5];
const COP_LOOK = { skin: '#c68c63', top: '#2c3e5c', bottom: '#1e2738', shoes: '#151515', hair: '#2a2420', hat: '#1e2738', detail: '#d9b44a', sleeves: 'short' as const, legs: 'pants' as const, hairStyle: 'short' as const, hatStyle: 'police' as const, height: 1, build: 1.04 };

/** Pure heat bookkeeping (unit tested). */
export class HeatState {
  heat = 0;
  lastSeen = new THREE.Vector3();
  unseenT = 0;
  cooldown = 0; // grace after losing heat
  seen = false;
  add(crime: Crime) {
    const c = CRIME[crime];
    const before = this.heat;
    this.heat = Math.min(5, Math.max(this.heat + c.add, c.min));
    if (this.heat > before) this.unseenT = 0;
    return this.heat > before;
  }
  searchRadius() { return 45 + this.heat * 25; }
  /** Returns true when heat was lost this tick. */
  tick(dt: number, seen: boolean, playerPos: THREE.Vector3): boolean {
    this.seen = seen;
    if (this.heat <= 0) return false;
    if (seen) { this.unseenT = 0; this.lastSeen.copy(playerPos); return false; }
    this.unseenT += dt;
    const outside = playerPos.distanceTo(this.lastSeen) > this.searchRadius();
    const needed = 7 + this.heat * 3;
    if ((outside && this.unseenT > needed) || this.unseenT > needed * 3.5) { this.heat = 0; this.unseenT = 0; return true; }
    return false;
  }
}

export class Police {
  state = new HeatState();
  units: AiCar[] = [];
  foot: Npc[] = [];
  private spawnT = 0;
  private siren: LoopVoice | null = null;
  onHeatChange: ((heat: number, lost: boolean) => void) | null = null;
  constructor(private city: CityMap, private pop: Population, private traffic: Traffic, private audio: GameAudio, private scene: THREE.Scene) { }
  get heat() { return this.state.heat; }
  report(crime: Crime, at: THREE.Vector3) {
    // A crime counts if police or civilians are around to witness it.
    const nearCop = this.pop.npcs.some(n => n.alive && n.role === 'police' && n.pos.distanceTo(at) < 60);
    const nearCiv = this.pop.npcs.some(n => n.alive && n.role === 'civilian' && n.pos.distanceTo(at) < 35);
    if (!nearCop && !nearCiv && crime !== 'copKill' && crime !== 'copAttack') return;
    if (this.state.add(crime)) { this.audio.play('heatUp'); this.onHeatChange?.(this.state.heat, false); }
    this.state.lastSeen.copy(at);
  }
  clear() {
    if (this.state.heat > 0) { this.state.heat = 0; this.onHeatChange?.(0, true); }
    this.standDown();
  }
  private weaponFor(): WeaponId { const h = this.state.heat; return h <= 1 ? 'fists' : h === 2 ? 'pistol' : h === 3 ? (Math.random() < 0.5 ? 'smg' : 'pistol') : h === 4 ? (Math.random() < 0.5 ? 'rifle' : 'smg') : (Math.random() < 0.5 ? 'rifle' : 'shotgun'); }
  private standDown() {
    for (const u of this.units) { u.mode = 'cruise'; u.target = null; u.v.siren = false; u.persistent = false; }
    this.units = [];
    for (const n of this.foot) { n.brain = 'idle'; n.target = null; n.persistent = false; }
    this.foot = [];
  }
  update(dt: number, player: Character, playerInVehicle: boolean, camera: THREE.Camera) {
    const st = this.state;
    // Line of sight from any officer (on foot or driving)
    let seen = false;
    const pp = player.pos;
    for (const n of this.pop.npcs) {
      if (!n.alive || n.role !== 'police') continue;
      const d = n.pos.distanceTo(pp);
      if (n.char.inVehicle ? d < 55 : d < 65 && n.losT > 0) { seen = true; break; }
      if (n.char.inVehicle && d < 90) { const v = n.char.inVehicle as { position: THREE.Vector3 }; const from = v.position.clone(); from.y += 1.4; if (this.pop.runner.hasLOS(from, pp.clone().setY(pp.y + 1.2))) { seen = true; break; } }
    }
    const lost = st.tick(dt, seen, pp);
    if (lost) { this.audio.play('heatLost'); this.onHeatChange?.(0, true); this.standDown(); }
    // Clean dead/removed units
    this.units = this.units.filter(u => this.traffic.cars.includes(u));
    this.foot = this.foot.filter(n => this.pop.npcs.includes(n) && n.alive);
    if (st.heat > 0) {
      const target = seen ? pp : st.lastSeen;
      for (const u of this.units) {
        u.target = target.clone(); u.mode = 'pursuit'; u.ram = st.heat >= 3 && playerInVehicle;
        // Officers bail out near an on-foot player (or when the car is stuck/close)
        const d = u.v.position.distanceTo(pp);
        if ((!playerInVehicle && d < 22) || (d < 10 && Math.abs(u.v.speed) < 1.5)) {
          const cop = this.traffic.eject(u, u.v, 1);
          if (cop) { this.arm(cop); this.foot.push(cop); u.v.siren = true; u.v.persistent = false; }
          if (st.heat >= 2) { const p = u.v.doorPoint(-1); const extra = this.pop.spawn('police', p.x, p.z, Math.max(0.2, u.v.position.y), COP_LOOK); this.arm(extra); extra.brain = 'combat'; this.foot.push(extra); }
        }
      }
      // Escalate: keep enough units in play
      this.spawnT -= dt;
      const wantCars = UNITS_BY_HEAT[st.heat];
      if (this.spawnT <= 0 && this.units.length < wantCars && this.foot.length < st.heat * 3 + 2) {
        this.spawnT = 3.5 - st.heat * 0.4;
        this.spawnUnit(target, camera);
      }
      for (const n of this.foot) { n.persistent = true; n.target = player; if (n.brain === 'idle' || n.brain === 'wander') n.brain = 'chase'; n.lastSeen.copy(target); n.accuracy = 1.25 - st.heat * 0.1; }
    }
    // Siren audio follows the nearest unit with sirens
    let nearest: THREE.Vector3 | null = null, nd = 120;
    for (const u of this.traffic.cars) if (u.v.siren && !u.v.destroyed) { const d = u.v.position.distanceTo(pp); if (d < nd) { nd = d; nearest = u.v.position; } }
    if (nearest) { if (!this.siren) this.siren = this.audio.siren(); this.siren.update(nearest, 1); }
    else if (this.siren) { this.siren.stop(); this.siren = null; }
  }
  private arm(n: Npc) {
    const w = this.weaponFor();
    n.arm(w, this.scene); n.brain = this.state.heat >= 2 ? 'combat' : 'chase'; n.persistent = true; n.stateT = 0;
  }
  private spawnUnit(target: THREE.Vector3, camera: THREE.Camera) {
    const frustum = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
    const sp = { x: 0, z: 0, dx: 0, dz: 0 };
    for (let tries = 0; tries < 20; tries++) {
      const lane = this.city.lanes[Math.floor(Math.random() * this.city.lanes.length)];
      if (lane.connector || lane.length < 30) continue;
      const s = 10 + Math.random() * (lane.length - 20);
      samplePath(lane, s, sp);
      const p = new THREE.Vector3(sp.x, 1, sp.z);
      const d = p.distanceTo(target);
      if (d < 70 || d > 150) continue;
      if (frustum.containsPoint(p) && d < 120) continue;
      // lane must head roughly towards the target
      if ((target.x - sp.x) * sp.dx + (target.z - sp.z) * sp.dz < 0) continue;
      const car = this.traffic.spawnOnLane('police', lane, s, 'pursuit', 'police', COP_LOOK);
      car.persistent = true; car.v.persistent = true; car.target = target.clone();
      this.units.push(car);
      return;
    }
  }
}
