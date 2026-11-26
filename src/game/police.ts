/** Heat (wanted level): crimes raise it, the response escalates, and breaking line of sight loses it. */
import * as THREE from 'three';
import type { Population } from './population';
import type { Traffic, AiCar } from './traffic';
import type { Character } from '../actors/character';
import type { Npc } from '../actors/npc';
import type { CityMap } from '../world/citymap';
import type { GameAudio, LoopVoice } from '../ui/contracts';
import { signalState, nearestLane } from '../world/citymap';
import { Dispatch, COP_LOOK, wantedUnits, wantsHelicopter, type UnitKind, type DispatchHooks } from './dispatch';

export type Crime = 'robbery' | 'assault' | 'shooting' | 'kill' | 'copAttack' | 'copKill' | 'carjack' | 'vehicleWreck' | 'copCarTheft' | 'hitPerson' | 'heliTheft' | 'policeHeliTheft' | 'traffic' | 'brandish';
/** min = star level this crime guarantees once reported; further stars come from sustained fighting (see HeatState.tick). */
const CRIME: Record<Crime, { min: number }> = {
  robbery: { min: 2 } /* Round 9 (owner: robbing was too easy): an armed hold-up is a two-star call */, assault: { min: 1 }, shooting: { min: 1 }, kill: { min: 2 }, copAttack: { min: 2 }, copKill: { min: 2 },
  carjack: { min: 1 }, vehicleWreck: { min: 1 }, copCarTheft: { min: 2 }, hitPerson: { min: 1 }, heliTheft: { min: 3 }, policeHeliTheft: { min: 4 }, traffic: { min: 1 }, brandish: { min: 2 },
};
export { COP_LOOK };
export type { UnitKind };
export const UNITS_BY_HEAT = [0, 1, 2, 3, 4, 5];
/** Tuning (seconds of cops-in-contact combat, officers killed) for each escalation step; unit tested. */
export const ESCALATE = { star3: { combat: 15, copKills: 2 }, star4: { combat: 150, copKills: 6 }, star5: { combat: 300 } };
/** A witness needs this long to dial 911 (civilians), officers radio it in faster. Dispatch then needs HOLD more before a car rolls. */
export const CALL_DELAY = { civ: [3, 6] as const, cop: 1 };
export const DISPATCH_HOLD = 14;
export type ViolationKind = 'red_light' | 'speeding' | 'wrong_way' | 'collision' | 'reckless';
const COP_KINDS = ['police', 'fbi', 'swat', 'army', 'tank'];
/** Speeding counts when the player is more than 15 mph (6.7 m/s) over the lane's limit. Pure, unit tested. */
/** Metres within which a police helicopter's spotlight can find the player; further out it is still flying in. */
export const HELI_SIGHT_RANGE = 200;
/** Longest a helicopter counts as "still flying in" (it spawns 380-700 m out and climbs over the towers on the way). */
export const HELI_INBOUND_MAX = 90;
/** Still on its first approach: never yet within sight range, not flying in for too long, and closing in (not this far behind its best approach: the player has outrun it). Pure. */
export const heliInbound = (arrived: boolean, inT: number, hd: number, bestD: number) => !arrived && inT < HELI_INBOUND_MAX && hd < bestD + 40;
/**
 * Seconds the search timer stays held after a scan: 2.5 with the spotlight on the player; 0.5 while the helicopter is still on its
 * first approach (`inbound`: it has never been within sight range and has flown in for under HELI_INBOUND_MAX s); else 0.
 * A helicopter the player has since outrun (beyond sight range after arriving, or never catching up) no longer holds the heat.
 */
export const heliHold = (hd: number, los: boolean, inbound = true) => hd < HELI_SIGHT_RANGE ? (los ? 2.5 : 0) : inbound ? 0.5 : 0;
export const isSpeeding = (speed: number, limit: number) => Math.abs(speed) > limit + 6.7;
/** A vehicle moving from (px,pz) to (x,z) enters the box of a signalised junction while its light is red. Pure, unit tested. */
export function ranRedLight(city: Pick<CityMap, 'intersections'>, px: number, pz: number, x: number, z: number, time: number): boolean {
  const dx = x - px, dz = z - pz;
  if (Math.hypot(dx, dz) < 0.001) return false;
  for (const it of city.intersections) {
    if (!it.signalized || Math.abs(x - it.x) > it.halfX + 6 || Math.abs(z - it.z) > it.halfZ + 6) continue;
    const inNow = Math.abs(x - it.x) < it.halfX && Math.abs(z - it.z) < it.halfZ, inBefore = Math.abs(px - it.x) < it.halfX && Math.abs(pz - it.z) < it.halfZ;
    if (!inNow || inBefore) continue;
    const axis: 'x' | 'z' = Math.abs(dz) > Math.abs(dx) ? 'z' : 'x';
    if (signalState(it, axis, time) === 'red') return true;
  }
  return false;
}

/** Pure heat bookkeeping (unit tested). */
/** Seconds out of sight (and outside the search radius) before the stars go. Pure. */
export function heatLoseTime(heat: number): number { return 14 + heat * 6; }
export class HeatState {
  heat = 0;
  lastSeen = new THREE.Vector3();
  unseenT = 0;
  cooldown = 0; // grace after losing heat
  seen = false;
  /** seconds of sustained combat while officers have eyes on the player (drives the 3rd to 5th star) */
  combatT = 0;
  copKills = 0;
  /** set by tick when a star was gained from escalation */
  raised = false;
  add(crime: Crime) {
    const c = CRIME[crime];
    const before = this.heat;
    if (crime === 'copKill') this.copKills++;
    this.heat = Math.min(5, Math.max(this.heat, c.min));
    if (this.heat > before) this.unseenT = 0;
    return this.heat > before;
  }
  /** Round 9 balance (owner: "cops don't stay on you"): wider search, longer to lose them (1 star ~20 s, 3 stars ~32 s). */
  searchRadius() { return 60 + this.heat * 30; }
  /** Returns true when heat was lost this tick. `engaged`: the player is fighting right now. */
  tick(dt: number, seen: boolean, playerPos: THREE.Vector3, engaged = false): boolean {
    this.seen = seen; this.raised = false;
    if (this.heat <= 0) { this.combatT = 0; this.copKills = 0; return false; }
    if (seen && engaged) this.combatT += dt; else this.combatT = Math.max(0, this.combatT - dt * 0.25);
    const E = ESCALATE, before = this.heat;
    if (this.heat >= 2 && this.heat < 3 && (this.combatT >= E.star3.combat || this.copKills >= E.star3.copKills)) this.heat = 3;
    if (this.heat === 3 && (this.combatT >= E.star4.combat || this.copKills >= E.star4.copKills)) this.heat = 4;
    if (this.heat === 4 && this.combatT >= E.star5.combat) this.heat = 5;
    if (this.heat > before) { this.raised = true; this.unseenT = 0; }
    if (seen) { this.unseenT = 0; this.lastSeen.copy(playerPos); return false; }
    this.unseenT += dt;
    const outside = playerPos.distanceTo(this.lastSeen) > this.searchRadius();
    const needed = heatLoseTime(this.heat);
    if ((outside && this.unseenT > needed) || this.unseenT > needed * 3) { this.heat = 0; this.unseenT = 0; this.combatT = 0; this.copKills = 0; return true; }
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
  /** set every frame by Game: the player is pointing a firearm (officers who see it open fire at once, no warning shot needed) */
  armedThreat = false;
  private player: Character | null = null;
  /** Sandbox 'Police ignore you': no heat, no reactions to the player, no scans. */
  ignoring = false;
  private seeT = 0; private seenNow = false; private eyeA = new THREE.Vector3(); private eyeB = new THREE.Vector3();
  private yieldT = 0; private yielded = new Set<AiCar>();
  /** Player drives a police car with the light bar on (and is not wanted): civilian traffic slows to a stop at the kerb. */
  private yieldTraffic(dt: number, pv: { position: THREE.Vector3; siren?: boolean; sirenOn?: boolean; kind?: string } | null) {
    this.yieldT -= dt; if (this.yieldT > 0) return;
    this.yieldT = 0.4;
    const on = !!pv && !!(pv.sirenOn ?? pv.siren) && ['police', 'fbi', 'swat', 'army'].includes(pv.kind ?? '') && this.state.heat === 0;
    for (const c of this.traffic.cars) {
      const near = on && c.mode === 'cruise' && !c.persistent && c.driver.role === 'civilian' && c.v.position.distanceTo(pv!.position) < 40;
      if (near) { c.maxSpeed = 0.5; this.yielded.add(c); }
      else if (this.yielded.has(c)) { if (c.maxSpeed === 0.5) c.maxSpeed = undefined; this.yielded.delete(c); }
    }
    for (const c of this.yielded) if (!this.traffic.cars.includes(c)) this.yielded.delete(c);
  }
  /** clock for traffic signals (Game sets it to the world time Traffic uses) */
  clock: () => number = () => (this.traffic as unknown as { time?: () => number }).time?.() ?? 0;
  /** the player's current stolen police vehicle (cops that see the player in it pursue, whatever the heat) */
  stolenCop: object | null = null; private pendingStolen = false;
  private heliSeeT = 0; private heliRef: object | null = null; private heliInT = 0; private heliArrived = false; private heliBestD = Infinity; private violT = 0; private vPrev = new THREE.Vector3(); private vPrevOk = false; private limitT = 0; private limit = 14;
  private bails: { car: AiCar; t: number }[] = [];
  private violCool = 0; private strictSeen = false; private eyeC = new THREE.Vector3(); private speedT = 0; private violKind: ViolationKind | null = null; private playerFast = false;
  private extDetector = false;
  private extDetected: { kind: ViolationKind; pos: THREE.Vector3 } | null = null;
  /** Anything that detects the player breaking a traffic law reports it here (traffic.ts hook or the built-in detector). */
  violation(kind: ViolationKind, pos: THREE.Vector3) { this.extDetected = { kind, pos: pos.clone() }; }
  /** Subscribe to an external violation emitter (traffic.onPlayerTrafficViolation); switches the built-in detector off. */
  useViolationSource(sub: (cb: (e: { kind: ViolationKind; pos: THREE.Vector3 }) => void) => void) { this.extDetector = true; sub(e => this.violation(e.kind, e.pos)); }
  private arrived = new Set<AiCar>();
  private progress = new Map<AiCar, { best: number; t: number }>();
  private siren: LoopVoice | null = null;
  /** seconds of rapid unit dispatch left (stolen helicopter) */
  rushT = 0;
  onHeatChange: ((heat: number, lost: boolean) => void) | null = null;
  constructor(private city: CityMap, private pop: Population, private traffic: Traffic, private audio: GameAudio, private scene: THREE.Scene) {
    this.dispatch = new Dispatch(city, pop, traffic, scene);
    const sub = (traffic as unknown as { onPlayerTrafficViolation?: (cb: (e: { kind: ViolationKind; pos: THREE.Vector3 }) => void) => void }).onPlayerTrafficViolation;
    if (typeof sub === 'function') this.useViolationSource(cb => sub.call(traffic, cb));
  }
  setHooks(h: DispatchHooks) { this.dispatch.hooks = h; }
  /** Cops use lethal force at 3+ stars, or at 2 once the player has been violent. */
  get lethal() { return copsMayShoot(this.state.heat, this.violentT > 0, this.playerArmed); }
  /** set every frame by Game: the player has a firearm out (equipped, on foot or in a car). Round 9: unarmed = never shot. */
  playerArmed = false;
  get heat() { return this.state.heat; }
  /** Pending 911 calls: a witness has seen the crime and is dialling. */
  pending: { crime: Crime; at: THREE.Vector3; t: number; witness: Npc | null }[] = [];
  /** seconds before the dispatcher sends the first car after a call (call-taking + rolling out) */
  holdT = 0;
  private shootScan = 0;
  private static readonly VIOLENT: Crime[] = ['shooting', 'kill', 'copAttack', 'copKill', 'assault'];
  /** Someone who saw (or, for gunfire, heard) the crime, or null. Officers beat civilians because they radio it faster. */
  findWitness(crime: Crime, at: THREE.Vector3): Npc | null {
    const eye = new THREE.Vector3(at.x, at.y + 1.3, at.z), head = new THREE.Vector3();
    let best: Npc | null = null, bd = Infinity;
    for (const n of this.pop.npcs) {
      if (!n.alive || (n.role !== 'police' && n.role !== 'civilian') || n.brain === 'dead') continue;
      const car = n.char.inVehicle as { position: THREE.Vector3 } | null;
      const pos = car ? car.position : n.pos;
      const d = pos.distanceTo(at), cop = n.role === 'police';
      const range = cop ? 70 : 38;
      if (d > range) continue;
      const near = (crime === 'shooting' || crime === 'kill') && d < 22; // gunfire is heard
      if (!near) { head.set(pos.x, pos.y + 1.6, pos.z); if (!this.pop.runner.hasLOS(head, eye)) continue; }
      const score = d - (cop ? 1000 : 0);
      if (score < bd) { bd = score; best = n; }
    }
    return best;
  }
  report(crime: Crime, at: THREE.Vector3) {
    if (this.ignoring) return;
    if (crime === 'copCarTheft') this.pendingStolen = true;
    // Officers on scene react to violence at once, but the heat only rises once somebody has seen it and called it in.
    if (Police.VIOLENT.includes(crime)) this.violentT = 30;
    if (crime === 'shooting') { // one witness scan per half second: shots are reported every trigger pull
      if (this.shootScan > 0 || this.pending.some(p => p.crime === 'shooting')) return;
      this.shootScan = 0.5;
    }
    const witness = this.findWitness(crime, at);
    if (!witness && crime !== 'copKill') return; // dead officers get radioed in by their partners/dispatch
    const cop = !witness || witness.role === 'police';
    const [lo, hi] = CALL_DELAY.civ;
    this.pending.push({ crime, at: at.clone(), t: cop ? CALL_DELAY.cop + (witness ? 0 : 1.5) : lo + Math.random() * (hi - lo), witness });
    this.state.lastSeen.copy(at);
  }
  private tickCalls(dt: number) {
    this.shootScan = Math.max(0, this.shootScan - dt);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const p = this.pending[i]; p.t -= dt;
      if (p.witness && !p.witness.alive) { // the witness was silenced: any other eyes on the scene?
        const w = this.findWitness(p.crime, p.at);
        if (!w) { this.pending.splice(i, 1); continue; }
        p.witness = w; p.t = w.role === 'police' ? CALL_DELAY.cop : CALL_DELAY.civ[0];
      }
      if (p.t > 0) continue;
      this.pending.splice(i, 1);
      this.call911(p.crime, p.at);
    }
  }
  /** A call reaches the dispatcher: stars rise and, if no unit is out yet, a response is queued after DISPATCH_HOLD. */
  call911(crime: Crime, at: THREE.Vector3) {
    const first = this.state.heat === 0 && this.units.length === 0;
    if (this.state.add(crime)) { this.audio.play('heatUp'); this.onHeatChange?.(this.state.heat, false); }
    if (first) this.holdT = DISPATCH_HOLD;
    this.state.lastSeen.copy(at); this.state.unseenT = 0;
  }
  /** Sets the wanted level directly (sandbox tools). */
  setHeat(level: number, at: THREE.Vector3) {
    if (this.ignoring) return;
    const before = this.state.heat, h = Math.max(0, Math.min(5, level));
    if (h === 0) { this.clear(); return; }
    this.state.heat = h; this.state.lastSeen.copy(at); this.state.unseenT = 0; this.spawnT = 0; this.holdT = 0;
    if (h > before) { this.audio.play('heatUp'); this.onHeatChange?.(h, false); }
  }
  /** Sandbox: calls one unit of `kind` in right now (raises the wanted level to the one that normally sends it). */
  callUnit(kind: UnitKind, at: THREE.Vector3, camera: THREE.Camera) {
    const min = { police: 1, swat: 3, fbi: 4, army: 5, tank: 5 }[kind];
    if (this.state.heat < min) this.setHeat(min, at);
    const car = this.dispatch.spawnUnit(kind, at, camera, this.state.heat, 'near');
    if (car) this.units.push(car);
    return car;
  }
  /** A crime reported by an alarm or a phone call: no witness check. */
  alarm(crime: Crime, at: THREE.Vector3) {
    if (this.ignoring) return;
    if (crime === 'copCarTheft') this.pendingStolen = true;
    this.call911(crime, at);
    if (crime === 'heliTheft' || crime === 'policeHeliTheft') { this.rushT = 40; this.spawnT = 0; this.violentT = 30; this.holdT = 0; } // a stolen aircraft is seen by the whole city: no dispatch delay
  }
  clear() {
    if (this.state.heat > 0) { this.state.heat = 0; this.onHeatChange?.(0, true); }
    this.standDown();
    this.pending.length = 0; this.holdT = 0;
  }
  private standDown() {
    this.arrived.clear(); this.bails.length = 0;
    this.progress.clear();
    for (const u of this.units) { u.mode = 'cruise'; u.target = null; u.v.siren = false; u.persistent = false; u.v.persistent = false; u.ram = false; }
    this.units.length = 0; this.dispatch.standDown();
    for (const n of this.foot) { n.brain = 'wander'; n.node = -1; n.target = null; n.persistent = false; }
    this.foot.length = 0;
  }
  private adopt(car: AiCar, target: THREE.Vector3) {
    if (this.units.includes(car) || this.dispatch.kindOf(car) !== 'police' && this.dispatch.kinds.has(car)) return;
    this.units.push(car); this.dispatch.kinds.set(car, 'police');
    car.patrol = false; car.persistent = true; car.v.persistent = true; car.v.siren = true; car.mode = 'pursuit'; car.target = target.clone();
  }
  /** Built-in traffic-law detector (red light, speeding); an external source (useViolationSource) replaces it. */
  private detectViolation(dt: number, pv: { position: THREE.Vector3; speed: number; kind?: string } | null) {
    if (this.extDetected) { this.violKind = this.extDetected.kind; this.violT = 2; this.extDetected = null; }
    if (!pv || pv.kind === 'helicopter' || (pv as { siren?: boolean }).siren && COP_KINDS.includes(pv.kind ?? '')) { this.vPrevOk = false; this.speedT = 0; return; }
    if (!this.extDetector) {
      const p = pv.position;
      this.limitT -= dt;
      if (this.limitT <= 0) { this.limitT = 0.5; const nl = nearestLane(this.city, p.x, p.z, true); this.limit = nl && nl.dist < 7 && !nl.lane.connector ? nl.lane.speed : 99; }
      this.speedT = isSpeeding(pv.speed, this.limit) ? this.speedT + dt : 0;
      if (this.speedT > 1) { this.violKind = 'speeding'; this.violT = 2; }
      if (this.vPrevOk && Math.abs(pv.speed) > 3 && ranRedLight(this.city, this.vPrev.x, this.vPrev.z, p.x, p.z, this.clock())) { this.violKind = 'red_light'; this.violT = 2; }
      this.vPrev.copy(p); this.vPrevOk = true;
    }
  }
  private trackStolen(pv: { kind?: string; stolenPolice?: boolean } | null) {
    const cop = !!pv && COP_KINDS.includes(pv.kind ?? '');
    if (cop && this.pendingStolen) { pv!.stolenPolice = true; this.pendingStolen = false; }
    this.stolenCop = cop && pv!.stolenPolice ? pv : null;
  }
  /** Runs on every sight scan: stolen police car spotted, traffic violation witnessed, ambient patrol cars that see the player join in. */
  private onScan(strict: boolean, watchers: AiCar[], pv: { speed: number } | null, pp: THREE.Vector3) {
    const st = this.state;
    this.playerFast = !!pv && Math.abs(pv.speed) > 8;
    if (strict && this.stolenCop && st.heat < 2) { // a cop recognises the stolen cruiser: at least 2 stars, again and again until the player is out of sight
      st.heat = 2; st.lastSeen.copy(pp); st.unseenT = 0; this.violentT = Math.max(this.violentT, 0);
      if (this.units.length === 0) this.holdT = Math.min(this.holdT || 4, 4);
      this.audio.play('heatUp'); this.onHeatChange?.(2, false);
    }
    if (strict && this.violT > 0 && this.violCool <= 0) {
      this.violT = 0; this.violCool = 12;
      if (st.heat === 0) { // witnessed: one star and a pull-over attempt with lights and siren
        if (st.add('traffic')) { this.audio.play('heatUp'); this.onHeatChange?.(1, false); }
        st.lastSeen.copy(pp); st.unseenT = 0; this.holdT = this.units.length ? 0 : 5;
      }
    }
    if (st.heat > 0) for (const c of watchers) if (c.driver.alive && c.mode !== 'park') this.adopt(c, pp);
  }
  /** The player shot at a police car (or an officer inside it): the crew reacts at once. */
  onVehicleShot(v: unknown) {
    if (this.ignoring) return;
    const car = this.traffic.carOf(v as never);
    if (!car || car.driver.role !== 'police' || !car.driver.alive || this.bails.some(b => b.car === car)) return;
    const pp = this.lastPlayerPos;
    this.violentT = 30;
    this.adopt(car, pp);
    if (this.state.heat < 2) { this.state.add('copAttack'); this.state.lastSeen.copy(pp); this.state.unseenT = 0; this.audio.play('heatUp'); this.onHeatChange?.(this.state.heat, false); if (this.units.length <= 1) this.holdT = Math.min(this.holdT || 3, 3); }
    if (this.playerFast) return; // the player is driving off: the crew chases instead
    if (this.dispatch.kindOf(car) !== 'police') return;
    car.maxSpeed = 0.4; // brake now
    this.bails.push({ car, t: 0.7 });
  }
  /** Called when the player's bullet hit an officer; a seated officer counts as a shot at the car. */
  copHit(n: Npc) { const v = n.char.inVehicle; if (v) this.onVehicleShot(v); }
  private updateBails(dt: number) {
    for (let i = this.bails.length - 1; i >= 0; i--) {
      const b = this.bails[i]; b.t -= dt; if (b.t > 0) continue;
      this.bails.splice(i, 1);
      const car = b.car; car.maxSpeed = undefined;
      if (!this.traffic.cars.includes(car)) continue;
      const v = car.v, pp = this.lastPlayerPos;
      const side: 1 | -1 = v.doorPoint(1).distanceTo(pp) >= v.doorPoint(-1).distanceTo(pp) ? 1 : -1; // exit on the far side: the car is the cover
      v.setDoor(v.doorIndex(side === 1 ? 'left' : 'right'), 1);
      let ci = 0;
      for (const cop of this.dispatch.bail(car, side)) {
        this.dispatch.arm(cop, 'police', Math.max(2, this.state.heat), true); this.foot.push(cop);
        cop.char.human.playAction('exit_car', { rate: 2 });
        // cover = the car's far corner as seen from the player (the body shields them, the corner lets them aim); one officer per side
        const ax = v.position.x - pp.x, az = v.position.z - pp.z, al = Math.hypot(ax, az) || 1, sg = ci++ % 2 === 0 ? 1 : -1;
        cop.coverPoint = cop.goal = new THREE.Vector3(v.position.x + ax / al * 1.2 - az / al * 1.6 * sg, v.position.y, v.position.z + az / al * 1.2 + ax / al * 1.6 * sg);
        cop.holdCoverT = 4; cop.crouching = true;
      }
    }
  }
  private ignoreT = 0;
  /** 'Police ignore you': wipe all heat and orders, stand every officer down, and keep them from re-acquiring the player. */
  private ignoreTick(dt: number) {
    this.ignoreT -= dt;
    this.pending.length = 0; this.violentT = 0; this.armedThreat = false;
    if (this.state.heat > 0 || this.units.length || this.foot.length || this.dispatch.heli) this.clear();
    if (this.ignoreT > 0) return;
    this.ignoreT = 0.25;
    const p = this.player;
    for (const n of this.pop.npcs) if (n.role === 'police' && n.target === p && (n.brain === 'combat' || n.brain === 'chase')) { n.brain = 'idle'; n.target = null; n.persistent = false; }
  }
  /** Puts an officer on foot into the fight against the player right now (weapon out, target acquired, no reaction delay). */
  engage(n: Npc, aimed = false) {
    const st = this.state, p = this.player; if (!p) return;
    if (!this.foot.includes(n)) this.foot.push(n);
    this.dispatch.arm(n, 'police', Math.max(st.heat, 1), this.lethal);
    n.persistent = true; n.target = p; n.lastSeen.copy(p.pos); n.losT = 1; n.seenTime = this.clock(); n.think = 0;
    if (aimed) n.aimT = Math.max(n.aimT, 0.75);
  }
  /** An officer sees the player pointing a gun: 2 stars at once (officers radio it faster than any 911 call) and everyone who sees it draws and fires. */
  private brandish(cops: Npc[], pp: THREE.Vector3) {
    const st = this.state;
    this.violentT = Math.max(this.violentT, 30);
    if (st.add('brandish')) { this.audio.play('heatUp'); this.onHeatChange?.(st.heat, false); if (this.units.length === 0) this.holdT = Math.min(this.holdT || 6, 6); }
    st.lastSeen.copy(pp); st.unseenT = 0;
    for (const n of cops) this.engage(n, true);
  }
  update(dt: number, player: Character, playerInVehicle: boolean, camera: THREE.Camera) {
    const st = this.state;
    this.player = player;
    if (this.ignoring) { this.ignoreTick(dt); return; }
    // Line of sight from any officer (on foot or driving), any helicopter with eyes on the player; re-evaluated 4x per second, held in between
    this.seeT -= dt; this.violCool = Math.max(0, this.violCool - dt); this.violT = Math.max(0, this.violT - dt); this.heliSeeT = Math.max(0, this.heliSeeT - dt);
    const pp = player.pos;
    const pvAny = player.inVehicle as { position: THREE.Vector3; speed: number; kind?: string; stolenPolice?: boolean } | null;
    this.detectViolation(dt, pvAny);
    this.trackStolen(pvAny);
    if (this.seeT <= 0) {
      this.seeT = 0.25;
      let seen = false, strict = false;
      this.eyeB.set(pp.x, pp.y + 1.2, pp.z);
      const watchers: AiCar[] = [], sighted: Npc[] = [];
      for (const n of this.pop.npcs) {
        if (!n.alive || n.role !== 'police') continue;
        // an officer riding in a car is where the car is (their own position is not updated while seated)
        const car = n.char.inVehicle as { position: THREE.Vector3 } | null;
        const at = car ? car.position : n.pos, d = at.distanceTo(pp);
        if (d > 90) continue;
        let sees = false;
        if (car ? d < 55 : d < 65 && n.losT > 0) sees = true;
        let ls = false;
        if (d < 8) ls = true;
        else if (d < (car ? 90 : 65)) { this.eyeA.set(at.x, at.y + (car ? 1.4 : 1.6), at.z); ls = this.pop.runner.hasLOS(this.eyeA, this.eyeB); }
        if (ls) { sees = true; strict = true; if (!car && n.brain !== 'scripted' && n.brain !== 'dead' && n.brain !== 'inside') sighted.push(n); if (car) { const ac = this.traffic.carOf(car as never); if (ac && !watchers.includes(ac)) watchers.push(ac); } }
        if (sees) seen = true;
      }
      // a police helicopter keeps the player in its spotlight until something solid is between them
      const hl = this.dispatch.heli;
      if (hl && !hl.destroyed) {
        const hp = hl.position, hd = Math.hypot(hp.x - pp.x, hp.z - pp.z);
        if (hl !== this.heliRef) { this.heliRef = hl; this.heliInT = 0; this.heliArrived = false; this.heliBestD = Infinity; }
        this.heliInT += 0.25; this.heliBestD = Math.min(this.heliBestD, hd); if (hd < HELI_SIGHT_RANGE) this.heliArrived = true; // one scan every 0.25 s
        if (hd < HELI_SIGHT_RANGE) {
          this.eyeA.set(hp.x, hp.y - 2.5, hp.z);
          const to = this.eyeC.copy(this.eyeB), len = this.eyeA.distanceTo(to);
          if (pvAny && len > 4) to.sub(this.eyeA).multiplyScalar(1 - 2.5 / len).add(this.eyeA); // stop short of the player's own vehicle collider
          if (this.pop.runner.hasLOS(this.eyeA, to)) { this.heliSeeT = heliHold(hd, true); strict = true; }
        } else this.heliSeeT = Math.max(this.heliSeeT, heliHold(hd, false, heliInbound(this.heliArrived, this.heliInT, hd, this.heliBestD))); // still flying in from the precinct: the search is not called off while it is on its way (but an outrun helicopter does not hold it)
      }
      if (this.heliSeeT > 0) seen = true;
      this.seenNow = seen;
      this.strictSeen = strict;
      this.onScan(strict, watchers, pvAny, pp);
      // pulling a gun on an officer: he fires at once. And while wanted, any officer on foot with a clear view is in the fight, never standing by.
      if (this.armedThreat && !pvAny && sighted.length) this.brandish(sighted.filter(n => n.pos.distanceTo(pp) < 45), pp);
      else if (st.heat > 0 && !this.dispatch.arrest) for (const n of sighted) if ((n.brain === 'idle' || n.brain === 'wander' || n.brain === 'flee') && n.pos.distanceTo(pp) < 60) this.engage(n);
    }
    const seen = this.seenNow;
    this.updateBails(dt);
    this.tickCalls(dt); this.yieldTraffic(dt, player.inVehicle as never);
    const lost = st.tick(dt, seen, pp, this.violentT > 0);
    if (st.raised) { this.audio.play('heatUp'); this.onHeatChange?.(st.heat, false); }
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
      const inHeli = (player.inVehicle as { kind?: string } | null)?.kind === 'helicopter';
      for (const u of this.units) {
        const kind = D.kindOf(u), idx = ui++;
        if (u.target) u.target.copy(target); else u.target = target.clone(); u.mode = 'pursuit'; u.ram = st.heat >= 3 && playerInVehicle;
        // Round 9: chase where the suspect is going (half a second ahead), at the suspect's speed
        u.targetVel = seen && pv ? Math.abs(pv.speed) : 0;
        if (seen && pv && Math.abs(pv.speed) > 5) u.target.set(pp.x + Math.sin(pv.yaw) * pv.speed * 0.5, pp.y, pp.z + Math.cos(pv.yaw) * pv.speed * 0.5);
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
        if (!this.bails.some(b => b.car === u) && ((!playerInVehicle && d < 22) || (inHeli && d < 55) || (d < 10 && Math.abs(u.v.speed) < 1.5) || stuck)) {
          this.progress.delete(u);
          if (stuck) { u.v.input.throttle = 0; u.v.input.handbrake = true; }
          for (const cop of D.bail(u)) { D.arm(cop, kind, st.heat, lethal); this.foot.push(cop); }
          if (kind === 'police' && st.heat >= 2) { const p = u.v.doorPoint(-1); const extra = this.pop.spawn('police', p.x, p.z, Math.max(0.2, u.v.position.y), COP_LOOK); D.arm(extra, 'police', st.heat, lethal); this.foot.push(extra); }
        }
        // far behind and out of sight: let traffic cull it so a fresh unit can come in from the front
        if (d < 110) this.arrived.add(u);
        if (d > 260 && !seen && this.arrived.has(u)) { u.persistent = false; u.v.persistent = false; }
      }
      // Escalate: keep enough units in play, fewer on foot than the cap
      this.spawnT -= dt; this.holdT = Math.max(0, this.holdT - dt);
      this.rushT = Math.max(0, this.rushT - dt);
      const extra = this.rushT > 0 ? 4 : 0;
      const need = D.nextNeeded(this.units, st.heat, extra);
      if (this.spawnT <= 0 && this.holdT <= 0 && need && this.foot.length < Math.min(this.rushT > 0 ? 32 : 20, st.heat * 4 + 4 + extra * 2)) {
        this.spawnT = this.rushT > 0 ? 0.45 : this.units.length === 0 ? 0.5 : Math.max(2.5, 6 - st.heat * 0.5);
        const car = D.spawnUnit(need, target, camera, st.heat);
        if (car) this.units.push(car);
      }
      D.updateHeli(dt, player, st.heat, (wantsHelicopter(st.heat) || (inHeli && st.heat >= 3)) && !D.arrest, inHeli, camera);
      if (inHeli && lethal) D.attackHeli(dt, player.inVehicle as never, this.foot, st.heat);
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
        if (!playerInVehicle && player.alive && st.heat > 0 && st.heat <= 4 && pa.cop.alive && pa.cop.pos.distanceTo(pp) < 12) D.beginArrest(pa.cop, player, false);
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


/**
 * Round 9 (owner: "cops shoot you even if you're unarmed"): officers use their guns only against a suspect with a firearm
 * out, at 3+ stars (or 2 once violent); an unarmed suspect is chased, tased and cuffed. At 5 stars (army) anything goes. Pure.
 */
/** Whether the police treat the player as armed: a gun out, or flying a helicopter (an aircraft cannot be tased and cuffed, it is shot down). Pure. */
export function policeSeesArmed(alive: boolean, gunOut: boolean, inHeli: boolean): boolean { return alive && (gunOut || inHeli); }

export function copsMayShoot(heat: number, violent: boolean, playerArmed: boolean): boolean {
  if (heat >= 5) return true;
  return playerArmed && (heat >= 3 || (heat === 2 && violent));
}
