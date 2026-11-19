/**
 * Highway traffic: AI "human" drivers. Pure simulation (no rendering) in road coordinates (s along, u across).
 * Car following is IDM; lane changes are MOBIL-style (gain + safety for the new follower) preceded by a turn signal;
 * a few aggressive drivers cut in front of the player with a short signal and sometimes brake-check afterwards.
 */
import { NL, laneU, INNER, LANE_W, RAIL_U } from './road';
import { SHAPES } from '../vehicles/shapes';
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import { mpsFromMph } from '../core/units';

export type NpcModel = VehicleKind | 'semi' | 'bus';
export type NpcState = 'cruise' | 'signal' | 'changing' | 'wreck';
export interface Npc {
  id: number; model: NpcModel; heavy: boolean; dir: 1 | -1;
  s: number; u: number; v: number; vd: number; len: number; wid: number; mass: number;
  lane: number; target: number; state: NpcState;
  /** -1 left, 0 off, +1 right (blinker) */ signal: -1 | 0 | 1;
  signalT: number; signalDur: number; chT: number; chDur: number; fromU: number; toU: number; signalHold: number;
  aggr: number; T: number; aMax: number; acc: number; brake: number; hazard: boolean;
  psi: number; spin: number; vu: number; cooldown: number; evalT: number; cutoff: boolean; checkBrake: number; capV: number;
  paint: number; counted: boolean; hits: number; capUntil: number;
}
export interface PlayerRef { s: number; u: number; v: number; len: number; wid: number; psi: number }
export interface LaneChangeEvent { id: number; signalLead: number; cutoff: boolean; t: number }

const CAR_MIX: [VehicleKind, number][] = [['sedan', 20], ['hatch', 12], ['fullsize', 10], ['wagon', 6], ['suv', 16], ['pickup', 10], ['minivan', 7], ['coupe', 5], ['luxury', 4], ['muscle', 3], ['van', 5], ['taxi', 2]];
export const HEAVY_DIMS = { semi: { len: 20.5, wid: 2.6, mass: 14000 }, bus: { len: 12.4, wid: 2.6, mass: 11000 } };

export class Traffic {
  npcs: Npc[] = [];
  player: PlayerRef = { s: 0, u: laneU(1), v: 0, len: 4.7, wid: 1.85, psi: 0 };
  /** 0.5 light .. 1 medium .. 1.6 heavy */ density = 1;
  time = 0;
  lcLog: LaneChangeEvent[] = [];
  stats = { lanechanges: 0, cutoffs: 0, brakeChecks: 0, spawned: 0 };
  private nextId = 1;
  private cutCool = 0;
  constructor(private rand: () => number) {}

  private pickModel(): NpcModel {
    const r = this.rand();
    if (r < 0.075) return 'semi';
    if (r < 0.092) return 'bus';
    let t = this.rand() * CAR_MIX.reduce((a, m) => a + m[1], 0);
    for (const [k, w] of CAR_MIX) { t -= w; if (t <= 0) return k; }
    return 'sedan';
  }

  private makeNpc(dir: 1 | -1, lane: number, s: number, model: NpcModel): Npc {
    const heavy = model === 'semi' || model === 'bus';
    const dims = heavy ? HEAVY_DIMS[model as 'semi' | 'bus'] : { len: SHAPES[model as VehicleKind].L, wid: SHAPES[model as VehicleKind].W, mass: VEHICLES[model as VehicleKind].mass };
    const r = this.rand();
    const aggr = heavy ? 0.05 : r < 0.12 ? 0.7 + this.rand() * 0.3 : Math.max(0, r - 0.4) * 0.5;
    const laneBase = [mpsFromMph(79), mpsFromMph(72), mpsFromMph(66), mpsFromMph(60)][lane];
    const vd = heavy ? mpsFromMph(model === 'bus' ? 62 + this.rand() * 6 : 55 + this.rand() * 8)
      : laneBase * (0.9 + this.rand() * 0.2) * (1 + aggr * 0.1);
    const u = laneU(lane) * dir; // dir 1 -> +u, dir -1 -> -u
    return {
      id: this.nextId++, model, heavy, dir, s, u, v: vd * 0.93, vd, len: dims.len, wid: dims.wid, mass: dims.mass,
      lane, target: lane, state: 'cruise', signal: 0, signalT: 0, signalDur: 1, chT: 0, chDur: 2.5, fromU: u, toU: u, signalHold: 0,
      aggr, T: 1.7 - aggr * 0.9 + this.rand() * 0.4, aMax: heavy ? 0.9 : 1.5 + this.rand() * 1.0 + aggr, acc: 0, brake: 0, hazard: false,
      psi: 0, spin: 0, vu: 0, cooldown: 2 + this.rand() * 6, evalT: this.rand() * 0.6, cutoff: false, checkBrake: 0, capV: Infinity,
      paint: Math.floor(this.rand() * 64), counted: false, hits: 0, capUntil: 0,
    };
  }
  private laneWeights(heavy: boolean): number[] { return heavy ? [0, 0, 0.35, 0.65] : [0.22, 0.3, 0.28, 0.2]; }
  private pickLane(heavy: boolean): number {
    const w = this.laneWeights(heavy); let t = this.rand();
    for (let i = 0; i < NL; i++) { t -= w[i]; if (t <= 0) return i; }
    return NL - 1;
  }
  private isFree(dir: 1 | -1, u: number, s: number, len: number, v: number): boolean {
    for (const o of this.npcs) {
      if (o.dir !== dir || Math.abs(o.u - u) > 2.6) continue;
      if (Math.abs(o.s - s) < (len + o.len) / 2 + 14 + 1.3 * Math.max(v, o.v)) return false;
    }
    if (dir === 1 && Math.abs(this.player.u - u) < 3 && Math.abs(this.player.s - s) < 26 + this.player.v) return false;
    return true;
  }
  /** Tries to add one vehicle; zone: where along the road (relative to the player) it may appear. */
  spawn(dir: 1 | -1, zone: 'front' | 'behind' | 'anywhere'): Npc | null {
    const model = this.pickModel(), heavy = model === 'semi' || model === 'bus';
    const lane = this.pickLane(heavy);
    const p = this.player;
    const s = zone === 'front' ? p.s + 520 + this.rand() * 200 : zone === 'behind' ? p.s - 110 - this.rand() * 70 : p.s - 140 + this.rand() * 760;
    const n = this.makeNpc(dir, lane, s, model);
    if (zone === 'behind' && n.vd < p.v + 3) return null; // would never catch up: skip
    if (zone === 'anywhere' && Math.abs(s - p.s) < 20) return null;
    if (!this.isFree(dir, n.u, s, n.len, n.v)) return null;
    if (zone === 'behind') n.v = Math.min(n.vd, p.v + 4);
    this.npcs.push(n); this.stats.spawned++;
    return n;
  }
  fill(): void {
    for (let i = 0; i < 900 && this.npcs.length < this.target(); i++) this.spawn(this.rand() < 0.3 ? -1 : 1, 'anywhere');
  }
  target(): number { return Math.round(52 * this.density); }

  // ---- queries ----
  /** Nearest vehicle ahead (in travel direction) occupying lateral position `u`; returns [gap, speed] or null. */
  private leaderAt(me: Npc, u: number, from = me.s): { gap: number; v: number } | null {
    let best: { gap: number; v: number } | null = null;
    const dir = me.dir;
    for (const o of this.npcs) {
      if (o === me || o.dir !== dir) continue;
      const ds = (o.s - from) * dir;
      if (ds <= 0 || ds > 400) continue;
      const lat = (me.wid + o.wid) / 2 + 0.45;
      if (Math.abs(o.u - u) > lat && !(o.state === 'changing' && Math.abs(o.toU - u) <= lat) && !(o.state === 'signal' && Math.abs(laneU(o.target) * dir - u) <= lat * 0.6 && o.cutoff)) continue;
      const gap = ds - (me.len + o.len) / 2;
      if (!best || gap < best.gap) best = { gap, v: o.v };
    }
    if (dir === 1) {
      const p = this.player, ds = p.s - from;
      if (ds > 0 && ds < 400 && Math.abs(p.u - u) <= (me.wid + p.wid) / 2 + 0.45) {
        const gap = ds - (me.len + p.len) / 2;
        if (!best || gap < best.gap) best = { gap, v: p.v };
      }
    }
    return best;
  }
  private followerAt(me: Npc, u: number): { gap: number; v: number } | null {
    let best: { gap: number; v: number } | null = null;
    const dir = me.dir;
    for (const o of this.npcs) {
      if (o === me || o.dir !== dir) continue;
      const ds = (me.s - o.s) * dir;
      if (ds <= 0 || ds > 200) continue;
      const lat = (me.wid + o.wid) / 2 + 0.3;
      if (Math.abs(o.u - u) > lat && !(o.state === 'changing' && Math.abs(o.toU - u) <= lat)) continue;
      const gap = ds - (me.len + o.len) / 2;
      if (!best || gap < best.gap) best = { gap, v: o.v };
    }
    if (dir === 1) {
      const p = this.player, ds = me.s - p.s;
      if (ds > 0 && ds < 200 && Math.abs(p.u - u) <= (me.wid + p.wid) / 2 + 0.3) {
        const gap = ds - (me.len + p.len) / 2;
        if (!best || gap < best.gap) best = { gap, v: p.v };
      }
    }
    return best;
  }
  private idm(me: Npc, v: number, vd: number, lead: { gap: number; v: number } | null): number {
    const free = 1 - Math.pow(v / Math.max(1, vd), 4);
    if (!lead) return me.aMax * free;
    const dv = v - lead.v;
    const sStar = 2.4 + Math.max(0, v * me.T + (v * dv) / (2 * Math.sqrt(me.aMax * 2.6)));
    return Math.max(-9, me.aMax * (free - Math.pow(sStar / Math.max(0.3, lead.gap), 2)));
  }

  // ---- lane changes ----
  private evaluate(me: Npc): void {
    if (me.dir !== 1 && me.heavy) return;
    const lead = this.leaderAt(me, me.u);
    const accCur = this.idm(me, me.v, me.vd, lead);
    const minLane = me.model === 'semi' ? 2 : me.model === 'bus' ? 1 : 0;
    const p = this.player;
    // aggressive driver ahead of the player in the next lane over: cut in front
    if (me.dir === 1 && me.aggr > 0.6 && this.cutCool <= 0 && !me.heavy) {
      const ds = me.s - p.s, pl = this.laneOfPlayer();
      if (ds > 9 && ds < 48 && Math.abs(me.lane - pl) === 1 && p.v > 14 && this.rand() < 0.55) {
        const opt = pl;
        if (this.safeFor(me, opt, true)) { this.beginSignal(me, opt, true); this.cutCool = 7 + this.rand() * 8; return; }
      }
    }
    let bestGain = 0, best = -1;
    for (const d of [-1, 1]) {
      const opt = me.lane + d;
      if (opt < minLane || opt >= NL) continue;
      if (!this.safeFor(me, opt, false)) continue;
      const u2 = laneU(opt) * me.dir;
      const l2 = this.leaderAt(me, u2);
      const acc2 = this.idm(me, me.v, me.vd, l2);
      let gain = acc2 - accCur;
      if (d === 1) gain += me.vd < mpsFromMph(68) ? 0.45 : 0.22; // keep right
      if (d === -1 && me.heavy) gain -= 0.6;
      if (d === -1 && lead && lead.v > me.vd * 0.97) gain -= 0.4; // nothing to pass
      if (gain > bestGain) { bestGain = gain; best = opt; }
    }
    const thr = 0.4 - me.aggr * 0.25;
    if (best >= 0 && bestGain > thr) this.beginSignal(me, best, false);
  }
  private laneOfPlayer(): number { return Math.max(0, Math.min(NL - 1, Math.floor((this.player.u - INNER) / LANE_W))); }
  private safeFor(me: Npc, lane: number, cut: boolean): boolean {
    const u2 = laneU(lane) * me.dir;
    const l2 = this.leaderAt(me, u2), f2 = this.followerAt(me, u2);
    const aggr = me.aggr;
    if (l2 && l2.gap < (cut ? 5 : 6 + (cut ? 0 : 0.3) * me.v - aggr * 3)) return false;
    if (l2 && l2.v < me.v - 6 && l2.gap < 30 + me.v) return false;
    if (f2) {
      const need = (cut ? 2.5 : 4.5 - aggr * 1.5) + Math.max(0, f2.v - me.v) * (cut ? 0.8 : 1.5 - aggr * 0.5);
      if (f2.gap < need) return false;
    }
    return true;
  }
  private beginSignal(me: Npc, lane: number, cut: boolean): void {
    me.state = 'signal'; me.target = lane; me.signal = lane > me.lane ? 1 : -1; me.signalT = 0; me.cutoff = cut;
    me.signalDur = cut ? 0.35 + this.rand() * 0.15 : 1.0 + this.rand() * 0.9 - me.aggr * 0.4;
    me.chDur = cut ? 1.1 + this.rand() * 0.4 : me.heavy ? 3.4 : 2.1 + this.rand() * 1.1;
    me.fromU = me.u; me.toU = laneU(lane) * me.dir;
  }
  private beginChange(me: Npc): void {
    me.state = 'changing'; me.chT = 0; me.fromU = me.u;
    this.lcLog.push({ id: me.id, signalLead: me.signalT, cutoff: me.cutoff, t: this.time });
    if (this.lcLog.length > 400) this.lcLog.shift();
    this.stats.lanechanges++; if (me.cutoff) this.stats.cutoffs++;
  }

  // ---- stepping ----
  update(dt: number): void {
    this.time += dt; this.cutCool -= dt;
    const p = this.player;
    for (const n of this.npcs) {
      const dir = n.dir;
      if (n.state === 'wreck') { this.stepWreck(n, dt); continue; }
      // desired speed (brake checks and cut-in speed matching)
      let vd = Math.min(n.vd, n.capV);
      let acc: number;
      if (n.checkBrake > 0) { n.checkBrake -= dt; vd = Math.min(vd, Math.max(8, p.v * 0.45)); }
      const lead = this.leaderAt(n, n.u);
      acc = this.idm(n, n.v, vd, lead);
      if (n.checkBrake > 0 && n.v > vd) acc = Math.min(acc, -4.2);
      if (n.state === 'changing') {
        const l2 = this.leaderAt(n, n.toU); if (l2) acc = Math.min(acc, this.idm(n, n.v, vd, l2));
      }
      n.acc += (acc - n.acc) * Math.min(1, dt * 6);
      n.v = Math.max(0, n.v + n.acc * dt);
      n.s += n.v * dir * dt;
      n.brake = Math.max(0, Math.min(1, -n.acc / 3)) ;
      if (n.checkBrake > 0) n.brake = 1;
      // lane logic
      if (n.state === 'cruise') {
        n.cooldown -= dt; n.evalT -= dt;
        if (n.dir === 1 && n.cooldown <= 0 && n.evalT <= 0) { n.evalT = 0.4 + this.rand() * 0.4; this.evaluate(n); }
        n.u += (laneU(n.lane) * dir - n.u) * Math.min(1, dt * 4);
        n.psi *= Math.max(0, 1 - dt * 6);
        if (n.signalHold > 0) { n.signalHold -= dt; if (n.signalHold <= 0) n.signal = 0; }
      } else if (n.state === 'signal') {
        n.signalT += dt;
        if (n.signalT >= n.signalDur) {
          if (this.safeFor(n, n.target, n.cutoff)) this.beginChange(n);
          else if (n.signalT > n.signalDur + 1.8) { n.state = 'cruise'; n.signal = 0; n.target = n.lane; n.cooldown = 3; n.cutoff = false; }
        }
      } else if (n.state === 'changing') {
        n.chT += dt;
        const t = Math.min(1, n.chT / n.chDur), e = t * t * (3 - 2 * t);
        const prevU = n.u; n.u = n.fromU + (n.toU - n.fromU) * e;
        n.psi = Math.atan2((n.u - prevU) / Math.max(dt, 1e-4), Math.max(5, n.v)); // heading toward the new lane (angle toward +u)
        if (t > 0.5) n.lane = n.target;
        if (t >= 1) {
          n.state = 'cruise'; n.lane = n.target; n.signalHold = 0.45; n.cooldown = n.cutoff ? 2 : 5 + this.rand() * 5; n.psi = 0;
          if (n.cutoff) { n.cutoff = false; n.capV = Math.max(10, p.v * 0.82); if (this.rand() < 0.55) { n.checkBrake = 1.1 + this.rand() * 0.7; this.stats.brakeChecks++; } n.capUntil = 4.5; }
        }
      }
      if (n.capV !== Infinity) { n.capUntil -= dt; if (n.capUntil <= 0) n.capV = Infinity; }
    }
    // despawn + refill
    const lo = p.s - 260, hi = p.s + 800;
    this.npcs = this.npcs.filter(n => n.s > lo && n.s < hi);
    const want = this.target();
    let tries = 3;
    while (this.npcs.length < want && tries-- > 0) {
      const r = this.rand();
      const dir: 1 | -1 = r < 0.28 ? -1 : 1;
      if (dir === -1) { this.spawn(-1, 'front'); continue; }
      this.spawn(1, r < 0.58 && p.v < mpsFromMph(95) ? 'behind' : 'front');
    }
  }
  private stepWreck(n: Npc, dt: number): void {
    n.v = Math.max(0, n.v - 6.5 * dt);
    n.s += n.v * n.dir * Math.cos(n.psi * 0.5) * dt;
    n.u += n.vu * dt; n.vu *= Math.max(0, 1 - 1.1 * dt);
    n.psi += n.spin * dt; n.spin *= Math.max(0, 1 - 1.3 * dt);
    const lim = RAIL_U - n.wid / 2; if (Math.abs(n.u) > lim) { n.u = Math.sign(n.u) * lim; n.vu *= -0.3; }
    if (Math.abs(n.u) < 1.2) { n.u = Math.sign(n.u || 1) * 1.2; n.vu *= -0.3; }
    n.brake = n.v > 0.5 ? 1 : 0; n.hazard = true; n.signal = 0;
  }
  /** The player hit this vehicle at relative speed `rel` (m/s) with a lateral push direction `push` (+1/-1 in u). */
  wreck(n: Npc, rel: number, push: number, forward: number): void {
    n.hits++;
    if (n.state === 'wreck') { n.vu += push * rel * 0.3; n.spin += push * rel * 0.05; return; }
    n.state = 'wreck'; n.signal = 0; n.vu = push * rel * 0.35; n.spin = push * Math.min(4, rel * 0.16) * (0.5 + this.rand()); n.v = Math.max(0, n.v + forward * 0.4);
  }
}
