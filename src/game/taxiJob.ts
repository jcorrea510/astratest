/**
 * Round 7: early money. Drive any taxi and stop next to somebody hailing on the kerb: they walk over and get in the back,
 * the GPS shows where they are going, and dropping them off pays a fare (more for longer trips, a tip for a quick one).
 */
import * as THREE from 'three';
import type { Game } from './game';
import type { Npc } from '../actors/npc';
import { districtAt, DISTRICT_INFO, samplePath } from '../world/citymap';

/** Pay for a delivered fare: flag drop + distance, plus a tip when it was quicker than a relaxed drive. Pure: used by tests. */
export function jobFare(metres: number, seconds: number): { fare: number; tip: number } {
  const fare = Math.round(15 + metres * 0.06), par = metres / 9; // ~9 m/s average through town is a fair pace
  const tip = seconds < par ? Math.round(fare * 0.35 * Math.min(1, (par - seconds) / (par * 0.4))) : 0;
  return { fare, tip };
}

type Phase = { kind: 'idle' } | { kind: 'pickup'; n: Npc; t: number } | { kind: 'ride'; n: Npc; dest: THREE.Vector3; dist: number; t: number };

export class TaxiJob {
  phase: Phase = { kind: 'idle' };
  earned = 0; fares = 0;
  private scanT = 0; private hinted = false;
  constructor(private g: Game) {}
  get active() { return this.phase.kind !== 'idle'; }
  prompt(): string | null {
    const ph = this.phase;
    if (ph.kind === 'pickup') return 'Taxi: wait for your fare to get in';
    if (ph.kind === 'ride') return `Taxi: drop your fare at the pin  ·  ${Math.round(this.g.playerVehicle ? this.g.playerVehicle.position.distanceTo(ph.dest) : 0)} m`;
    return this.g.playerVehicle?.kind === 'taxi' ? 'Taxi: stop next to someone hailing to pick up a fare' : null;
  }
  private release(n: Npc, flee = false) {
    const g = this.g, v = n.char.inVehicle as { doorPoint(s: 1 | -1): THREE.Vector3; position: THREE.Vector3; yaw: number } | null;
    if (v) {
      const p = v.doorPoint(1);
      g.renderer.scene.add(n.char.human.root);
      n.char.inVehicle = null; n.char.place(p.x, Math.max(0.2, v.position.y), p.z, v.yaw);
      n.char.setCollision(true); n.char.human.setState('loco'); if (n.model) n.model.visible = true;
    }
    n.persistent = false; n.activity = ''; n.brain = flee ? 'flee' : 'wander'; n.node = -1; n.stateT = 0;
    if (flee) n.fleeFrom.copy(g.player.pos);
  }
  private cancel(msg: string | null) {
    const ph = this.phase;
    if (ph.kind !== 'idle' && ph.n.alive) this.release(ph.n, ph.kind === 'ride');
    if (ph.kind === 'ride' && this.g.waypoint && this.g.waypoint.distanceTo(ph.dest) < 1) this.g.waypoint = null;
    this.phase = { kind: 'idle' };
    if (msg) this.g.events.onToast(msg, 'warning');
  }
  /** A drop-off point on a kerb lane 250-650 m away. */
  private pickDest(from: THREE.Vector3): THREE.Vector3 | null {
    const lanes = this.g.city.lanes;
    for (let k = 0; k < 60; k++) {
      const l = lanes[Math.floor(Math.random() * lanes.length)];
      if (l.connector || l.ys || l.length < 40 || l.lane !== l.lanes - 1) continue;
      const sp = { x: 0, z: 0, dx: 0, dz: 1 }; samplePath(l, l.length * 0.5, sp);
      const d = Math.hypot(sp.x - from.x, sp.z - from.z); if (d < 250 || d > 650) continue;
      return new THREE.Vector3(sp.x, 0, sp.z);
    }
    return null;
  }
  update(dt: number) {
    const g = this.g, pv = g.playerVehicle, ph = this.phase;
    if (!pv || pv.kind !== 'taxi' || pv.destroyed) { if (ph.kind !== 'idle') this.cancel(ph.kind === 'ride' ? 'Your fare got out.' : null); this.hinted = false; return; }
    if (!this.hinted) { this.hinted = true; g.events.onToast('Taxi: stop next to people hailing a cab to earn fares', 'info'); }
    if (ph.kind !== 'idle' && (!ph.n.alive || ph.n.disposed)) { this.cancel(null); return; }
    if (ph.kind === 'idle') {
      this.scanT -= dt; if (this.scanT > 0 || Math.abs(pv.speed) > 3) return; this.scanT = 0.4;
      let best: Npc | null = null, bd = 14;
      for (const n of g.pop.npcs) {
        if (!n.alive || n.far || n.activity !== 'hail' || n.brain !== 'idle' || n.char.inVehicle) continue;
        const d = n.pos.distanceTo(pv.position); if (d < bd) { bd = d; best = n; }
      }
      if (best) { g.pop.runner.endAct(best); best.persistent = true; best.brain = 'scripted'; best.activity = ''; this.phase = { kind: 'pickup', n: best, t: 0 }; }
      return;
    }
    if (ph.kind === 'pickup') {
      ph.t += dt;
      const n = ph.n, c = n.char, door = pv.doorPoint(1), dx = door.x - c.pos.x, dz = door.z - c.pos.z, d = Math.hypot(dx, dz);
      if (d > 25 || ph.t > 25) { this.cancel('The fare gave up on you.'); return; }
      if (d < 1.3 && Math.abs(pv.speed) < 1) {
        g.traffic.seat(n, pv, 2); n.brain = 'passenger';
        g.audio.play('doorClose', { pos: pv.position, volume: 0.6 });
        const dest = this.pickDest(pv.position);
        if (!dest) { this.cancel(null); return; }
        g.waypoint = dest.clone();
        this.phase = { kind: 'ride', n, dest, dist: pv.position.distanceTo(dest), t: 0 };
        g.events.onToast(`Fare: "${DISTRICT_INFO[districtAt(g.city, dest.x, dest.z)].name}, please."  Follow the GPS.`, 'info');
        return;
      }
      if (c.human.currentState !== 'loco') c.human.setState('loco');
      c.move(new THREE.Vector3(dx / d * 2.4, 0, dz / d * 2.4), dt); c.faceTowards(Math.atan2(dx, dz), 8, dt); c.human.setSpeed(c.speed);
      return;
    }
    // ride
    ph.t += dt;
    if (pv.position.distanceTo(ph.dest) < 14 && Math.abs(pv.speed) < 1.5) {
      const { fare, tip } = jobFare(ph.dist, ph.t);
      this.release(ph.n); g.addMoney(fare + tip); g.audio.play('money');
      this.earned += fare + tip; this.fares++;
      if (g.waypoint && g.waypoint.distanceTo(ph.dest) < 1) g.waypoint = null;
      g.events.onToast(tip ? `Fare $${fare} + $${tip} tip` : `Fare $${fare}`, 'money');
      this.phase = { kind: 'idle' }; this.scanT = 2;
    }
  }
}
