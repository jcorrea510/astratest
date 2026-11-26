/** Pure traffic rules: kerb clearance, siren yielding and the player's traffic-violation detector (no rendering / physics). */
import type * as THREE from 'three';

export type ViolationKind = 'red_light' | 'speeding' | 'wrong_way' | 'collision' | 'reckless';
export interface Violation { kind: ViolationKind; pos: THREE.Vector3 }

/**
 * How far (m, to the left) a car must shift inside its lane to clear a stopped car on its right.
 * latS = lateral offset of the obstacle's centre (negative = right of us).
 */
export function curbShift(latS: number, ownHalf: number, otherHalf: number, margin = 0.6): number { // Round 9: 0.3 m left cars scraping parked ones
  if (latS > 0.4) return 0;
  const clearance = ownHalf + otherHalf + margin;
  return Math.max(0, Math.min(1.4, clearance - Math.abs(latS)));
}

/** Should a driver at (x,z) heading (fx,fz) give way to a siren vehicle? Behind and closing, or ahead and oncoming. */
export function yieldsToSiren(x: number, z: number, fx: number, fz: number, sx: number, sz: number, sfx: number, sfz: number, ssp: number): boolean {
  const rx = sx - x, rz = sz - z, d = Math.hypot(rx, rz);
  if (d > 60 || d < 0.5) return false;
  const along = rx * fx + rz * fz, lat = Math.abs(rx * fz - rz * fx);
  if (along < 2 && along > -60 && lat < 9 && ssp > 2) return (sfx * fx + sfz * fz) > -0.2 && d < 55; // coming up behind us
  if (along >= 2 && d < 45 && (sfx * fx + sfz * fz) < -0.3 && lat < 14) return true; // oncoming: slow and give room
  return false;
}

export interface LaneProbe { id: number; limit: number; /** metres from the car to the lane centreline */ dist: number; dx: number; dz: number; /** metres left to the stop line (<0 = past it) */ toStop: number; signal: 'green' | 'yellow' | 'red' }
export interface PlayerSample { x: number; z: number; fx: number; fz: number; speed: number; /** |slip angle| rad */ beta: number; nearCars: number; hitCar: boolean }

/** Watches the driven vehicle and reports speeding, red lights, wrong-way driving, collisions and reckless driving. */
export class ViolationMonitor {
  private acc: Record<ViolationKind, number> = { red_light: 0, speeding: 0, wrong_way: 0, collision: 0, reckless: 0 };
  private cool: Record<ViolationKind, number> = { red_light: 0, speeding: 0, wrong_way: 0, collision: 0, reckless: 0 };
  private armed = false; private armedLane = -1;
  constructor(private emit: (v: Violation) => void, private makePos: (x: number, z: number) => THREE.Vector3) { }
  update(dt: number, p: PlayerSample, lane: LaneProbe | null) {
    for (const k of Object.keys(this.cool) as ViolationKind[]) this.cool[k] = Math.max(0, this.cool[k] - dt);
    const fire = (k: ViolationKind, cd: number) => { if (this.cool[k] > 0) return; this.cool[k] = cd; this.acc[k] = 0; this.emit({ kind: k, pos: this.makePos(p.x, p.z) }); };
    const on = lane !== null && lane.dist < 4;
    const track = (k: ViolationKind, cond: boolean, after: number, cd: number) => { this.acc[k] = cond ? this.acc[k] + dt : Math.max(0, this.acc[k] - dt * 2); if (this.acc[k] > after) fire(k, cd); };
    track('speeding', on && p.speed > lane!.limit * 1.7 + 2, 1.2, 10);
    track('wrong_way', on && p.speed > 4 && (p.fx * lane!.dx + p.fz * lane!.dz) < -0.7, 1.5, 10);
    track('reckless', p.speed > 12 && p.beta > 0.55 && p.nearCars > 0, 0.9, 8);
    if (p.hitCar) fire('collision', 1.5);
    // red light: armed while approaching a red stop line at speed; fires when the car carries on across it
    const aligned = lane !== null && (p.fx * lane.dx + p.fz * lane.dz) > 0.5;
    if (on && aligned && lane!.signal === 'red' && lane!.toStop > -1 && lane!.toStop < 16 && p.speed > 3) { this.armed = true; this.armedLane = lane!.id; }
    else if (this.armed && (p.speed < 1.5 || (on && lane!.id === this.armedLane && lane!.signal !== 'red'))) this.armed = false;
    if (this.armed && (!on || lane!.id !== this.armedLane || lane!.toStop < -1)) { this.armed = false; if (p.speed > 3) fire('red_light', 6); }
  }
}

/** Comfortable braking (m/s²) AI drivers plan stops with, and the hardest they will brake for a late amber. */
export const COMFORT_DECEL = 3.4, MAX_DECEL = 5.5, PANIC_DECEL = 8;
/** Round 10: metres from the stop point to where the nose enters the junction box (the bar and zebra, see stopBack). */
export const BOX_EDGE = 4.9;
/** Fastest speed (m/s) from which a car can still halt `d` metres ahead at `decel`. */
export function stopSpeed(d: number, decel = COMFORT_DECEL): number { return Math.sqrt(2 * decel * Math.max(0, d)); }
/**
 * Speed cap for a signalised stop line `dStop` metres ahead (<0 = already past it) at `speed`.
 * Green: free. Amber: carry on only if the car cannot stop before the line at MAX_DECEL (dilemma zone), else stop.
 * Red: stop at the line (a car already across it, dStop < -1, clears the box).
 */
export function signalCap(state: 'green' | 'yellow' | 'red', dStop: number, speed: number, yellowLeft = Infinity): number {
  // across the line and rolling (or well inside the box): keep going; a car that merely overshot and stands still stays put
  if (state === 'green' || dStop < -6) return Infinity;
  // Round 10 (owner: cars run reds, mostly turning left): rolling past the bar is no licence to enter on red. While the
  // nose is still short of the box (BOX_EDGE) and a hard stop gets it there, stop on the crosswalk; only a car that
  // physically cannot stop before the box carries on through.
  if (dStop < -1 && speed > 2.5) {
    if (state === 'red' && dStop > -BOX_EDGE && Math.max(0, speed) ** 2 / (2 * MAX_DECEL) < dStop + BOX_EDGE - 0.3) return 0;
    return Infinity;
  }
  // Round 12 (traffic6 red-runner): a long vehicle (a bus at a stop just before the junction) can stand with its centre already
  // past its stop point (dStop < 0) yet short of the box. Standing there on amber it used to pull away, "committed", and entered
  // the junction after the red. A standing car with too little amber left to clear the box waits for the next green.
  if (state === 'yellow' && speed < 2.5 && dStop < 0 && yellowLeft < 3.5) return 0; // (a car that crept up to the bar on amber at 1-2 m/s re-accelerated into the red)
  if (state === 'yellow' && dStop < Math.max(0, speed) ** 2 / (2 * MAX_DECEL)) {
    // cannot stop comfortably: still go, but only when the line is reached before the red; else brake as hard as a driver would
    if (dStop <= Math.max(0, speed) * yellowLeft + 1 || dStop < Math.max(0, speed) ** 2 / (2 * PANIC_DECEL)) return Infinity;
    return Math.max(0, stopSpeed(dStop - 0.4, PANIC_DECEL) - PEDAL_LAG);
  }
  return Math.max(0, stopSpeed(dStop - 0.4) - PEDAL_LAG);
}
/**
 * Round 10: the AI pedal brakes in proportion to the overspeed, so a car tracking a braking curve runs about this much
 * (m/s) above it: the stop curve is lowered by it so the car halts at the bar instead of rolling over it at walking pace.
 */
export const PEDAL_LAG = 2.4;
/**
 * Round 13 (owner: "cars aren't going on green lights, the ones in the left lane"): a left turner first at its line used
 * to wait for a 5.5 s gap in a non-stop oncoming stream, and its amber "sneak" lasted only 0.8 s while the oncoming cars
 * still counted, so it (and every car queued behind it) sat through several cycles. Like a real driver it now takes the
 * amber to turn once oncoming traffic is stopping, starting while enough amber is left to reach the box before the red
 * (`yellowLeft` s of amber left; ~6 m from a standstill takes ~2.2 s, and it may be under way ~1 s into the all-red).
 */
export const LEFT_CLEAR_MIN = 1.4;
export function mayClearLeft(state: 'green' | 'yellow' | 'red', yellowLeft: number, dStop: number, speed: number): boolean {
  if (state !== 'yellow' || yellowLeft < LEFT_CLEAR_MIN) return false;
  return dStop < 2.5 && dStop > -BOX_EDGE + 0.5 && Math.abs(speed) < 2;
}
/** An approaching car (stop line `dStop` ahead) that will halt for its own amber/red, so a clearing left turner may ignore it. */
export function willStopForSignal(state: 'green' | 'yellow' | 'red', dStop: number, speed: number, yellowLeft = Infinity): boolean {
  return state !== 'green' && dStop > -1 && signalCap(state, dStop, Math.max(0, speed), yellowLeft) !== Infinity;
}
/** Seconds a left turner stands at its line on green before only a really close car still holds it (was 40: three cycles). */
export const LEFT_PATIENCE = 18;
/** Speed cap that halts an AI car at a line `dStop` m ahead (0.4 m short of it), allowing for the pedal's lag. */
export function lineStop(dStop: number): number { return Math.max(0, stopSpeed(dStop - 0.4) - PEDAL_LAG); }
/**
 * Stop-sign rule: halt at the line, wait `waited` s (counted by the caller while standing), then go once `clear`
 * (nobody in the junction). After 6 s the driver goes regardless so nobody deadlocks.
 */
export function stopSignCap(dStop: number, speed: number, waited: number, clear: boolean): number {
  if (dStop < -1) return Infinity;
  if (waited >= 1.5 && (clear || waited > 6)) return Infinity;
  void speed;
  return stopSpeed(dStop - 0.4);
}
/** +1 = left turn, -1 = right turn, 0 = straight, from unit heading before (d0) and after (d1) the turn. */
export function turnSide(d0x: number, d0z: number, d1x: number, d1z: number): number {
  const c = d0x * d1z - d0z * d1x; // heading +z has its left at +x: a left turn gives a negative cross
  return c < -0.5 ? 1 : c > 0.5 ? -1 : 0;
}
/** Is an oncoming car (position rel. to junction centre, heading, speed) close enough that a left-turner must wait? */
/**
 * Round 11 (zero crashes): seconds until a car `d` m out reaches the junction if it keeps accelerating (3 m/s², up to
 * 14 m/s). Judging a gap by the current speed alone let left turners go in front of a car creeping off its line at
 * 2 m/s (12 s away at that speed) that was on them 2.6 s later. Pure (tests).
 */
export function arrivalTime(d: number, v: number, a = 3, vmax = 14): number {
  v = Math.max(0, v);
  if (v >= vmax) return d / v;
  const t1 = (vmax - v) / a, d1 = v * t1 + 0.5 * a * t1 * t1;
  return d <= d1 ? (-v + Math.sqrt(v * v + 2 * a * d)) / a : t1 + (d - d1) / vmax;
}
/** `mayGo`: the car stands first at its own line on green and may pull away any moment (judged from a standstill). */
export function oncomingConflict(ox: number, oz: number, ofx: number, ofz: number, ospeed: number, afx: number, afz: number, mayGo = false): boolean {
  if (ospeed < 1.5 && !mayGo) return false;
  if ((ofx * afx + ofz * afz) > -0.7) return false; // not opposing our approach
  const d = Math.hypot(ox, oz); if (d > 90) return false; // Round 10: 60 m missed a car at 15 m/s 4 s out (Broadway)
  if ((-ox * ofx - oz * ofz) < 0) return false; // already past the junction
  const lat = Math.abs(ox * afz - oz * afx); if (lat > 9.5) return false; // Broadway's far lanes sit ~8 m off its centre
  return arrivalTime(d, ospeed) < LEFT_GAP; // Round 9: a left turn from a standstill takes ~5 s to clear the oncoming lanes
}
/** Seconds of gap a left-turner needs before oncoming traffic arrives (was 4.5: they cut across too often). */
export const LEFT_GAP = 5.5;
export function oncomingRange(): number { return 90;
}
/** A car must not appear inside the dilemma zone of a signal: near a stop line (<70 m) the light has to stay green for the next 5 s. */
export function spawnSafeAtSignal(now: 'green' | 'yellow' | 'red', in5s: 'green' | 'yellow' | 'red', dStop: number): boolean {
  return dStop > 70 || (now === 'green' && in5s === 'green');
}

/** R6-Z1: a far car may spawn at lane position `s` (length `len`) only if every other car on that lane (real or far) keeps >= `gap` m bumper to bumper. */
export function spawnGapClear(s: number, len: number, others: ReadonlyArray<{ s: number; len: number }>, gap = 8): boolean {
  for (const o of others) if (Math.abs(o.s - s) - (o.len + len) * 0.5 < gap) return false;
  return true;
}

/**
 * Round 8: pedal for an AI driver from the speed error (target - current, m/s). Throttle stays proportional; braking is
 * progressive: ~4 m/s^2 when 3 m/s too fast, ~7 at 5 m/s, full from ~8 m/s too fast (it used to be full brake from
 * 3 m/s over: cars "slammed on the brakes" all the time). Standing at a stop: 0. Pure (tests).
 */
export function aiPedal(err: number, speed: number, targetSpeed: number): number {
  if (err >= 0) return Math.min(1, err * 0.35);
  if (targetSpeed < 0.3 && Math.abs(speed) < 0.5) return 0;
  const e = -err;
  return -Math.min(1, Math.max(0, e - 0.3) * 0.13);
}

/** Round 9: the painted stop bar's back edge, metres before the junction edge (zebra 0.7-3.7 m, bar 4.15-4.6 m). */
export const STOP_BAR = 4.6;
/** Metres from the junction edge (lane end) to a stopped car's centre: nose 0.3 m behind the stop bar (it used to stand on the zebra). */
export function stopBack(halfLen: number): number { return STOP_BAR + 0.3 + Math.max(1.8, halfLen); }

/**
 * Round 12 (traffic6): a civilian 'goto' car (bus, taxi) within 20 m of its target used to ignore the signals altogether, so a
 * bus standing at a stop beside the junction crept to its target at ~2 m/s straight through the red. Signals are ignored near
 * the target only when the stop line is not close (the car is dropping someone at a kerb mid-block). Pure (tests).
 */
export function skipSignalNearTarget(dStop: number): boolean { return !(dStop > -BOX_EDGE - 3 && dStop < 25); }
