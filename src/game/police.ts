/** Heat (wanted level): crimes raise it, the response escalates, and breaking line of sight loses it. */
import * as THREE from 'three';
import type { Population } from './population';
import type { Traffic, AiCar } from './traffic';
import type { Character } from '../actors/character';
import type { Npc } from '../actors/npc';
import type { CityMap } from '../world/citymap';
import type { GameAudio, LoopVoice } from '../ui/contracts';
import { Dispatch, COP_LOOK, wantedUnits, wantsHelicopter, type UnitKind, type DispatchHooks } from './dispatch';

export type Crime = 'robbery' | 'assault' | 'shooting' | 'kill' | 'copAttack' | 'copKill' | 'carjack' | 'vehicleWreck' | 'copCarTheft' | 'hitPerson';
const CRIME: Record<Crime, { add: number; min: number }> = {
  robbery: { add: 0, min: 2 },
  assault: { add: 0, min: 1 }, shooting: { add: 0, min: 1 }, kill: { add: 1, min: 2 }, copAttack: { add: 1, min: 2 }, copKill: { add: 2, min: 3 },
  carjack: { add: 0, min: 1 }, vehicleWreck: { add: 0, min: 1 }, copCarTheft: { add: 1, min: 2 }, hitPerson: { add: 0, min: 1 },
};
export { COP_LOOK };
export type { UnitKind };
export const UNITS_BY_HEAT = [0, 1, 2, 3, 4, 5];

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
  dispatch: Dispatch;
  /** seconds left in which the player counts as violent (shot or killed someone): cops stop trying to arrest */
  violentT = 0;
  private lastPlayerPos = new THREE.Vector3();
  private progress = new Map<AiCar, { best: number; t: number }>();
  private siren: LoopVoice | null = null;
  onHeatChange: ((heat: number, lost: boolean) => void) | null = null;
  constructor(private city: CityMap, private pop: Population, private traffic: Traffic, private audio: GameAudio, private scene: THREE.Scene) { this.dispatch = new Dispatch(city, pop, traffic, scene); }
  setHooks(h: DispatchHooks) { this.dispatch.hooks = h; }
  /** Cops use lethal force at 3+ stars, or at 2 once the player has been violent. */
  get lethal() { return this.state.heat >= 3 || (this.state.heat === 2 && this.violentT > 0); }
  get heat() { return this.state.heat; }
  report(crime: Crime, at: THREE.Vector3) {
    // A crime counts if police or civilians are around to witness it.
    const nearCop = this.pop.npcs.some(n => n.alive && n.role === 'police' && n.pos.distanceTo(at) < 60);
    const nearCiv = this.pop.npcs.some(n => n.alive && n.role === 'civilian' && n.pos.distanceTo(at) < 35);
    if (!nearCop && !nearCiv && crime !== 'copKill' && crime !== 'copAttack') return;
    if (this.state.add(crime)) { this.audio.play('heatUp'); this.onHeatChange?.(this.state.heat, false); }
    if (crime === 'shooting' || crime === 'kill' || crime === 'copAttack' || crime === 'copKill' || crime === 'assault') this.violentT = 30;
    this.state.lastSeen.copy(at);
  }
  /** Sets the wanted level directly (sandbox tools). */
  setHeat(level: number, at: THREE.Vector3) {
    const before = this.state.heat, h = Math.max(0, Math.min(5, level));
    if (h === 0) { this.clear(); return; }
    this.state.heat = h; this.state.lastSeen.copy(at); this.state.unseenT = 0; this.spawnT = 0;
    if (h > before) { this.audio.play('heatUp'); this.onHeatChange?.(h, false); }
  }
  /** Sandbox: calls one unit of `kind` in right now (raises the wanted level to the one that normally sends it). */
  callUnit(kind: UnitKind, at: THREE.Vector3, camera: THREE.Camera) {
    const min = { police: 1, swat: 3, fbi: 4, army: 5, tank: 5 }[kind];
    if (this.state.heat < min) this.setHeat(min, at);
    const car = this.dispatch.spawnUnit(kind, at, camera, this.state.heat);
    if (car) this.units.push(car);
    return car;
  }
  /** A crime reported by an alarm or a phone call: no witness check. */
  alarm(crime: Crime, at: THREE.Vector3) {
    if (this.state.add(crime)) { this.audio.play('heatUp'); this.onHeatChange?.(this.state.heat, false); }
    this.state.lastSeen.copy(at); this.state.unseenT = 0;
  }
  clear() {
    if (this.state.heat > 0) { this.state.heat = 0; this.onHeatChange?.(0, true); }
    this.standDown();
  }
  private standDown() {
    this.progress.clear();
    for (const u of this.units) { u.mode = 'cruise'; u.target = null; u.v.siren = false; u.persistent = false; u.v.persistent = false; u.ram = false; }
    this.units.length = 0; this.dispatch.standDown();
    for (const n of this.foot) { n.brain = 'wander'; n.node = -1; n.target = null; n.persistent = false; }
    this.foot.length = 0;
  }
  update(dt: number, player: Character, playerInVehicle: boolean, camera: THREE.Camera) {
    const st = this.state;
    // Line of sight from any officer (on foot or driving)
    let seen = false;
    const pp = player.pos;
    for (const n of this.pop.npcs) {
      if (!n.alive || n.role !== 'police') continue;
      // an officer riding in a car is where the car is (their own position is not updated while seated)
      const car = n.char.inVehicle as { position: THREE.Vector3 } | null;
      const d = (car ? car.position : n.pos).distanceTo(pp);
      if (car ? d < 55 : d < 65 && n.losT > 0) { seen = true; break; }
      if (car && d < 90) { const from = car.position.clone(); from.y += 1.4; if (this.pop.runner.hasLOS(from, pp.clone().setY(pp.y + 1.2))) { seen = true; break; } }
    }
    const lost = st.tick(dt, seen, pp);
    if (lost) { this.audio.play('heatLost'); this.onHeatChange?.(0, true); this.standDown(); }
    // Clean dead/removed units
    for (const u of this.units) if (!this.traffic.cars.includes(u)) { u.persistent = false; u.v.persistent = false; u.v.siren = false; }
    this.units = this.units.filter(u => this.traffic.cars.includes(u));
    for (const n of this.foot) if (!n.alive) n.persistent = false;
    this.foot = this.foot.filter(n => this.pop.npcs.includes(n) && n.alive);
    this.violentT = Math.max(0, this.violentT - dt);
    const D = this.dispatch;
    if (D.arrest) D.updateArrest(dt, player);
    // officers that left their unit on their own (shot up, wrecked) still fight
    for (const n of D.collectCrew()) if (!this.foot.includes(n)) { D.arm(n, D.footKind.get(n) ?? 'police', st.heat, this.lethal); this.foot.push(n); }
    for (const [car] of [...D.kinds]) if (!this.traffic.cars.includes(car) && !this.units.includes(car)) { D.kinds.delete(car); D.crew.delete(car); }
    if (st.heat > 0) {
      const target = seen ? pp : st.lastSeen;
      const lethal = this.lethal, pv = player.inVehicle as { position: THREE.Vector3; speed: number; yaw: number; doorPoint(side: 1 | -1): THREE.Vector3 } | null;
      let ui = 0;
      for (const u of this.units) {
        const kind = D.kindOf(u), idx = ui++;
        u.target = target.clone(); u.mode = 'pursuit'; u.ram = st.heat >= 3 && playerInVehicle;
        // tactics against a driving player: ram, cut in ahead to box in, or PIT the rear quarter
        if (playerInVehicle && pv && kind !== 'tank' && u.v.position.distanceTo(pp) < 45 && pv.speed > 6) {
          const fx = Math.sin(pv.yaw), fz = Math.cos(pv.yaw), role = idx % 3;
          if (role === 1 && st.heat >= 2) { u.target.set(pp.x + fx * 16, pp.y, pp.z + fz * 16); u.ram = false; }
          else if (role === 2 && st.heat >= 2) { u.target.set(pp.x - fx * 2.5 + fz * 1.3, pp.y, pp.z - fz * 2.5 - fx * 1.3); u.ram = true; }
        }
        if (kind === 'tank') { u.ram = true; D.updateTank(u, player, dt); continue; }
        // Officers bail out near an on-foot player (or when the car is stuck/close)
        const d = u.v.position.distanceTo(pp);
        let pr = this.progress.get(u); if (!pr) { pr = { best: d, t: 0 }; this.progress.set(u, pr); }
        if (d < pr.best - 3) { pr.best = d; pr.t = 0; } else pr.t += dt;
        const stuck = !playerInVehicle && d < 90 && pr.t > 6;
        if ((!playerInVehicle && d < 22) || (d < 10 && Math.abs(u.v.speed) < 1.5) || stuck) {
          this.progress.delete(u);
          if (stuck) { u.v.input.throttle = 0; u.v.input.handbrake = true; }
          for (const cop of D.bail(u)) { D.arm(cop, kind, st.heat, lethal); this.foot.push(cop); }
          if (kind === 'police' && st.heat >= 2) { const p = u.v.doorPoint(-1); const extra = this.pop.spawn('police', p.x, p.z, Math.max(0.2, u.v.position.y), COP_LOOK); D.arm(extra, 'police', st.heat, lethal); this.foot.push(extra); }
        }
        // far behind and out of sight: let traffic cull it so a fresh unit can come in from the front
        if (d > 260 && !seen) { u.persistent = false; u.v.persistent = false; }
      }
      // Escalate: keep enough units in play, fewer on foot than the cap
      this.spawnT -= dt;
      const need = D.nextNeeded(this.units, st.heat);
      if (this.spawnT <= 0 && need && this.foot.length < Math.min(20, st.heat * 4 + 4)) {
        this.spawnT = this.units.length === 0 ? 0.5 : Math.max(1, 3.2 - st.heat * 0.4);
        const car = D.spawnUnit(need, target, camera, st.heat);
        if (car) this.units.push(car);
      }
      D.updateHeli(dt, player, st.heat, wantsHelicopter(st.heat) && !D.arrest);
      let fi = 0;
      for (const n of this.foot) {
        n.persistent = true; n.target = player;
        const k = D.footKind.get(n) ?? 'police';
        if (n.brain === 'idle' || n.brain === 'wander') n.brain = lethal ? 'combat' : 'chase';
        const dist = n.pos.distanceTo(pp);
        n.lastSeen.copy(target);
        // flanking: officers approach from different sides until they are close
        if (n.brain === 'chase' && dist > 12 && lethal) { const a = Math.atan2(pp.x - n.pos.x, pp.z - n.pos.z) + ((fi % 3) - 1) * 0.7; n.lastSeen.set(pp.x - Math.sin(a) * 6, pp.y, pp.z - Math.cos(a) * 6); }
        n.accuracy = (k === 'police' ? 1.25 : 0.95) - st.heat * 0.1;
        if (dist < 40 && n.losT > 0 && n.stateT % 9 < dt && Math.random() < 0.5) D.shout(n);
        fi++;
      }
      // a stopped car with cops around it: open the door and drag the driver out
      if (playerInVehicle && pv && Math.abs(pv.speed) < 2.5 && !D.arrest && !D.pendingArrest) {
        const near = this.foot.find(n => n.alive && n.pos.distanceTo(pv.position) < 4.2);
        D.dragT = near ? D.dragT + dt : 0;
        if (near && D.dragT > 0.8 && D.hooks) {
          D.dragT = 0;
          const side: 1 | -1 = near.pos.distanceTo(pv.doorPoint(1)) <= near.pos.distanceTo(pv.doorPoint(-1)) ? 1 : -1;
          if (D.hooks.dragOut(player.inVehicle as never, side, near.char)) D.pendingArrest = { cop: near, t: 2.4 };
        }
      } else D.dragT = 0;
    }
    // after the drag-out the cop cuffs the player (unless things are too hot)
    if (D.pendingArrest) {
      const pa = D.pendingArrest; pa.t -= dt;
      if (pa.t <= 0) {
        D.pendingArrest = null;
        if (!playerInVehicle && player.alive && st.heat > 0 && st.heat <= 4 && pa.cop.alive && pa.cop.pos.distanceTo(pp) < 12) D.beginArrest(pa.cop, player);
      }
    }
    this.lastPlayerPos.copy(pp);
    // Siren audio follows the nearest unit with sirens
    let nearest: THREE.Vector3 | null = null, nd = 120;
    for (const u of this.traffic.cars) if (u.v.siren && !u.v.destroyed) { const d = u.v.position.distanceTo(pp); if (d < nd) { nd = d; nearest = u.v.position; } }
    if (nearest) { if (!this.siren) this.siren = this.audio.siren(); this.siren.update(nearest, 1); }
    else if (this.siren) { this.siren.stop(); this.siren = null; }
  }
}
export { wantedUnits };
