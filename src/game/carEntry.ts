/**
 * Getting in and out of vehicles on foot, as a little scripted scene instead of a teleport:
 *
 *   enter:  walk/run to the door handle -> (smash the window of a locked car) -> open the door ->
 *           (grab the driver and throw them out) -> step into the gap, sit down, swing the legs in -> close the door ->
 *           (hotwire a car without keys) -> drive
 *   exit:   open the door -> turn to the door, stand up, step out on that side -> the door swings shut behind you
 *           (bailing out above ~8 m/s is a dive onto the tarmac instead)
 *   pullOut(): anyone (a cop) dragging the occupant of a vehicle out of a given door, player included
 *
 * Works for any `Enterable` (cars and helicopters). Points are in the vehicle's body frame (+x = LEFT = driver side,
 * +z forward); a human being animated in or out is parented to `visual` and its root moved along a short path.
 */
import * as THREE from 'three';
import type { RAPIER } from '../core/physics';
import { groups, ALL, G_STATIC, G_VEHICLE, G_PROP } from '../core/physics';
import type { Character } from '../actors/character';
import type { Npc } from '../actors/npc';
import { wrapAngle } from '../core/rng';
import { Vehicle } from '../vehicles/vehicle';
import type { Game } from './game';

export interface DoorFrame { sg: 1 | -1; outX: number; z0: number; z1: number; belt: number; ground: number }
/** What the entry system needs from a vehicle (Vehicle and Helicopter implement it). */
export interface Enterable {
  group: THREE.Group; visual: THREE.Group;
  readonly position: THREE.Vector3; readonly yaw: number; readonly speed: number;
  destroyed: boolean; driver: Character | null; locked: boolean; doorsLocked: boolean; ignition: boolean; playerUsed: boolean;
  doors: { side: 'left' | 'right'; row: 0 | 1; open: number; amount: number }[];
  phys: { body: RAPIER.RigidBody };
  setDoor(i: number, amount: number): void;
  doorIndex(side: 'left' | 'right', row?: 0 | 1): number;
  doorForSeat(seat: number): number;
  doorFrame(i: number): DoorFrame;
  seatLocal(seat?: number): THREE.Vector3;
  paneOfDoor(i: number): number;
  breakGlass(id: number): boolean;
  isGlassBroken(id: number): boolean;
}

type Phase = 'approach' | 'smash' | 'open' | 'jack' | 'climb' | 'sit' | 'turn' | 'slide' | 'close' | 'hotwire' | 'xopen' | 'xslide' | 'xturn' | 'xstand' | 'xstep';
interface Job {
  kind: 'enter' | 'exit';
  v: Enterable; door: number; seat: number; entrySeat: number; f: DoorFrame;
  phase: Phase; t: number; life: number;
  path: THREE.Vector3[]; startPos: THREE.Vector3; startYaw: number; grabbed: boolean; startled: boolean; opened: boolean; stuck?: number;
}
interface Victim {
  char: Character; npc: Npc | null; v: Enterable; door: number; f: DoorFrame; t: number; dur: number;
  from: THREE.Vector3; to: THREE.Vector3; yaw0: number; yaw1: number; thrown: boolean; puller: Character | null;
}
interface DoorTimer { v: Enterable; door: number; t: number; who: Character | null }

const HALF_PI = Math.PI / 2;
const sm = (t: number) => { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); };
const lerpV = (out: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3, k: number) => out.copy(a).lerp(b, k);
const _w = new THREE.Vector3(), _l = new THREE.Vector3(), _d = new THREE.Vector3();

/** Speed above which leaving a vehicle is a bail-out dive (m/s). */
export const BAIL_SPEED = 8;
/** Hotwiring time (s). */
export const HOTWIRE_TIME = 2.6;

/** Body-frame stand points around a door. */
/** `seat` is the seated root position (Enterable.seatLocal). */
export function doorPoints(f: DoorFrame, seat: THREE.Vector3) {
  const { sg, outX, z0, ground } = f;
  return {
    /** facing the door, hand on the handle at its rear edge */
    handle: new THREE.Vector3(sg * (outX + 0.42), ground, z0 + 0.12),
    /** stepped back while the door swings past */
    back: new THREE.Vector3(sg * (outX + 0.66), ground, z0 - 0.2),
    /** in the opening, back to the seat */
    gap: new THREE.Vector3(sg * (outX + 0.2), ground, seat.z),
    /** root at the end of the sit-down: the clip leaves the hips 0.31 m behind and 0.52 m above the root (`seat` is a seatLocal root) */
    sit: new THREE.Vector3(seat.x + sg * 0.31, seat.y + 0.03, seat.z),
    /** clear of the open door after getting out */
    out: new THREE.Vector3(sg * (outX + 0.85), ground, seat.z - 0.25),
    /** where a dragged-out occupant lands */
    throwTo: new THREE.Vector3(sg * (outX + 1.35), ground, seat.z + 0.25),
  };
}

export class CarEntry {
  job: Job | null = null;
  victims: Victim[] = [];
  private doorTimers: DoorTimer[] = [];
  private lastWarn = 0;
  constructor(private game: Game) { }

  get active() { return !!this.job; }
  /** True while the player's root is animated by this system inside a vehicle (not by the character controller). */
  get parented() { return !!this.job && this.job.phase !== 'approach' && this.job.phase !== 'smash' && this.job.phase !== 'open' && this.job.phase !== 'jack'; }
  /** The engine is not ready: climbing in, closing the door or hotwiring. */
  get blocksDriving() { return !!this.job; }
  get phase() { return this.job?.phase ?? null; }
  /** The vehicle being entered or left. */
  get vehicle() { return this.job?.v ?? null; }

  private get player() { return this.game.player; }

  // ------------------------------------------------------------------------------------------------ entering
  /** Picks the door to use: the driver's unless something blocks it. */
  chooseDoor(v: Enterable, seat = 0): { door: number; entrySeat: number } {
    const d0 = v.doorForSeat(seat);
    if (d0 < 0) return { door: -1, entrySeat: seat };
    if (this.standClear(v, d0)) return { door: d0, entrySeat: seat };
    // passenger side (front right) only if the driver's side is blocked
    const other = v.doorIndex(v.doors[d0].side === 'left' ? 'right' : 'left', 0);
    if (other >= 0 && this.standClear(v, other)) {
      const es = this.seatOfDoor(v, other);
      if (es >= 0) return { door: other, entrySeat: es };
    }
    return { door: d0, entrySeat: seat };
  }
  private seatOfDoor(v: Enterable, door: number) { for (let s = 0; s < 6; s++) { const d = v.doorForSeat(s); if (d === door) return s; if (d === -1 && s > 0) break; } return -1; }
  /** Room for a person outside door i and a clear path from the cabin. */
  standClear(v: Enterable, door: number): boolean {
    const f = v.doorFrame(door), ph = this.game.physics;
    const solid = groups(ALL, G_STATIC | G_VEHICLE | G_PROP);
    const seat = v.seatLocal(Math.max(0, this.seatOfDoor(v, door)));
    const p = v.group.localToWorld(_w.set(f.sg * (f.outX + 0.6), f.ground + 0.95, seat.z));
    if (ph.overlapsCapsule(p.x, p.y + 0.3, p.z, 0.5, 0.3, solid, v.phys.body)) return false;
    if (!ph.ray(p.x, p.y, p.z, 0, -1, 0, 2.2, solid, null, v.phys.body)) return false; // no ground there (pier edge, drop): use the other door
    const c = v.group.localToWorld(new THREE.Vector3(f.sg * f.outX * 0.9, f.ground + 0.95, seat.z));
    const dx = p.x - c.x, dz = p.z - c.z, len = Math.hypot(dx, dz) || 1;
    return !ph.ray(c.x, c.y, c.z, dx / len, 0, dz / len, len, solid, null, v.phys.body);
  }

  /** Starts walking to the vehicle to get in (or to carjack its driver). */
  begin(v: Enterable, seat = 0): boolean {
    if (this.job || v.destroyed || v.locked) return false;
    const { door, entrySeat } = this.chooseDoor(v, seat);
    if (door < 0) return false;
    v.group.updateMatrixWorld();
    const f = v.doorFrame(door);
    const job: Job = { kind: 'enter', v, door, seat, entrySeat, f, phase: 'approach', t: 0, life: 0, path: [], startPos: new THREE.Vector3(), startYaw: 0, grabbed: false, startled: false, opened: false };
    job.path = this.route(v, f, entrySeat);
    this.job = job;
    // a driver who sees you coming from a distance may floor it
    const occ = v.driver && v.driver !== this.player;
    if (occ && v instanceof Vehicle && this.player.pos.distanceTo(v.position) > 2.8 && Math.abs(v.speed) < 3) job.startled = this.game.traffic.startle(v);
    return true;
  }
  /** Waypoints (body frame) from the player around the car to the handle of `door`. */
  private route(v: Enterable, f: DoorFrame, entrySeat: number): THREE.Vector3[] {
    const pts = doorPoints(f, v.seatLocal(entrySeat));
    const pl = v.group.worldToLocal(_l.copy(this.player.pos));
    const out: THREE.Vector3[] = [];
    const half = f.outX + 0.9;
    if (Math.sign(pl.x) !== f.sg && Math.abs(pl.x) > 0.3) {
      // other side of the car: go round the nearer end
      const box = (v as unknown as { tpl?: { front: number; rear: number } }).tpl;
      const front = box?.front ?? 2.4, rear = box?.rear ?? -2.4;
      const zEnd = pl.z > (front + rear) / 2 ? front + 0.9 : rear - 0.9;
      out.push(new THREE.Vector3(Math.sign(pl.x) * half, f.ground, zEnd), new THREE.Vector3(f.sg * half, f.ground, zEnd));
    }
    out.push(pts.handle);
    return out;
  }
  /** Stops whatever is going on (death, arrest, respawn): the player is put back on the ground. */
  cancel() {
    const j = this.job; if (!j) return;
    this.job = null;
    const h = this.player.human;
    if (h.root.parent === j.v.visual) {
      // mid-climb: drop the player at the door
      this.releasePlayer(j.v, j.door, false);
    }
    h.stopAction();
    if (j.kind === 'enter' && j.opened && !j.v.driver) this.doorTimers.push({ v: j.v, door: j.door, t: 0.6, who: null });
  }

  /** Fixed-step movement while walking to the car (the player controller is suspended). */
  fixedUpdate(dt: number) {
    const j = this.job; if (!j) return;
    const c = this.player;
    if (j.phase !== 'approach' && j.phase !== 'smash' && j.phase !== 'open' && j.phase !== 'jack') return;
    const v = j.v;
    if (this.vanished(j)) return;
    v.group.updateMatrixWorld();
    if (j.phase === 'approach') {
      j.life += dt;
      // the car drove off (or never stopped)
      const occ = v.driver && v.driver !== this.player;
      if (occ && Math.abs(v.speed) > 4 && j.life > 0.3) { this.abort('It got away'); return; }
      if (j.life > 7 || v.destroyed || c.pos.distanceTo(v.position) > 14) { this.abort(); return; }
      const target = v.group.localToWorld(_w.copy(j.path[0]));
      const dx = target.x - c.pos.x, dz = target.z - c.pos.z, d = Math.hypot(dx, dz);
      const last = j.path.length === 1;
      // close enough (the car's hull can keep the capsule a few cm off the exact spot)
      if (last && d < 0.45 && c.speed < 0.35 && j.life > 0.25) j.stuck = (j.stuck ?? 0) + dt; else j.stuck = 0;
      if (d < (last ? 0.12 : 0.6) || (j.stuck ?? 0) > 0.2) {
        if (!last) { j.path.shift(); return; }
        if (occ && Math.abs(v.speed) > 1.5) { c.move(_d.set(0, 0, 0), dt); return; } // wait for it to stop
        this.arrive(j);
        return;
      }
      const far = c.pos.distanceTo(v.position) > 4.5 || j.path.length > 1;
      const sp = last && d < 1.2 ? Math.max(1.6, d * 3) : far ? 5.4 : 3.2;
      c.move(_d.set(dx / d * sp, 0, dz / d * sp), dt);
      c.faceTowards(Math.atan2(dx, dz), 12, dt);
      return;
    }
    // at the door: keep hold of the spot, face the car, step back while the door swings
    const pts = doorPoints(j.f, v.seatLocal(j.entrySeat));
    let tgt = pts.handle;
    if (j.phase === 'open' && j.t > 0.25) tgt = pts.back;
    if (j.phase === 'jack') tgt = pts.back;
    const w = v.group.localToWorld(_w.copy(tgt));
    const dx = w.x - c.pos.x, dz = w.z - c.pos.z;
    c.move(_d.set(dx * 6, 0, dz * 6), dt);
    c.faceTowards(v.yaw - j.f.sg * HALF_PI + (j.phase === 'jack' ? j.f.sg * 0.35 : 0), 12, dt);
  }
  private arrive(j: Job) {
    const v = j.v, h = this.player.human;
    if (v instanceof Vehicle && v.driver && v.driver !== this.player) this.game.traffic.release(v); // hold the car still
    else if (v instanceof Vehicle) { v.input.throttle = 0; v.input.handbrake = true; }
    j.t = 0;
    const pane = v.paneOfDoor(j.door);
    if (v.doorsLocked && !v.driver && !v.playerUsed && j.door >= 0) {
      j.phase = 'smash';
      h.playAction('smash_window', {
        onEvent: e => {
          if (e !== 'smash') return;
          if (pane >= 0 && !v.isGlassBroken(pane)) v.breakGlass(pane); else this.game.audio.play('glass', { pos: v.position });
          this.game.audio.play('hitMetal', { pos: v.position, volume: 0.5 });
          this.alarm(v);
        },
      });
    } else this.startOpen(j);
  }
  private startOpen(j: Job) {
    const v = j.v, h = this.player.human;
    j.phase = 'open'; j.t = 0;
    h.playAction(j.f.sg === 1 ? 'open_door' : 'open_door_r', {
      onEvent: e => { if (e === 'open') { v.setDoor(j.door, 1); j.opened = true; this.game.audio.play('doorOpen', { pos: v.position }); } },
    });
  }
  /** Car alarm / witnesses after a break-in. */
  private alarm(v: Enterable) {
    const g = this.game;
    g.pop.danger(v.position, 18, this.player);
    g.police.report('carjack', this.player.pos);
    // somebody nearby shouts (the owner?)
    let best: Npc | null = null, bd = 25;
    for (const n of g.pop.npcs) { if (!n.alive || n.char.inVehicle || n.role !== 'civilian') continue; const d = n.pos.distanceTo(v.position); if (d < bd) { bd = d; best = n; } }
    if (best) { best.char.human.playAction('point'); }
    v.doorsLocked = false;
  }

  // ------------------------------------------------------------------------------------------------ exiting
  /** Starts getting out (animated); bails out of a fast vehicle. Returns false if not in a vehicle. */
  beginExit(v: Enterable, seat = 0): boolean {
    if (this.job) return false;
    v.group.updateMatrixWorld();
    const fast = Math.abs(v.speed) > BAIL_SPEED && !v.destroyed;
    const { door, entrySeat } = this.chooseDoor(v, seat);
    this.game.detachPlayer(v, fast);
    if (fast || door < 0) { this.bail(v, door); return true; }
    const f = v.doorFrame(door);
    this.job = { kind: 'exit', v, door, seat, entrySeat, f, phase: 'xopen', t: 0, life: 0, path: [], startPos: new THREE.Vector3(), startYaw: 0, grabbed: false, startled: false, opened: true };
    v.setDoor(door, 1);
    this.game.audio.play('doorOpen', { pos: v.position });
    return true;
  }
  /** Out of a moving vehicle: a dive and a tumble. */
  private bail(v: Enterable, door: number) {
    const c = this.player;
    const f = door >= 0 ? v.doorFrame(door) : { sg: 1 as const, outX: 1, ground: -0.35, z0: 0, z1: 0, belt: 0 };
    if (door >= 0) v.setDoor(door, 1);
    const p = v.group.localToWorld(_w.set(f.sg * (f.outX + 0.7), f.ground + 0.1, 0));
    const vel = v.phys.body.linvel();
    const out = v.group.localToWorld(new THREE.Vector3(f.sg, 0, 0)).sub(v.position).setY(0).normalize();
    this.putOnGround(c, p, v.yaw);
    this.game.renderer.scene.add(c.human.root);
    c.human.setState('loco');
    c.inVehicle = null; c.setCollision(true);
    c.hitReact(-(vel.x * 0.6 + out.x * 3), -(vel.z * 0.6 + out.z * 3), 1.5);
    c.vel.set(vel.x * 0.55 + out.x * 2.5, 2, vel.z * 0.55 + out.z * 2.5); c.grounded = false;
    this.game.cam.addShake(0.45);
    this.game.audio.play('hitBody', { pos: c.pos });
    if (c.damage(Math.min(30, Math.abs(v.speed) * 0.9), null, this.game.time)) this.game.playerDown('down');
    this.game.events.onVehicleExited(v as Vehicle);
  }

  // ------------------------------------------------------------------------------------------------ pulled out
  /**
   * Drags whoever sits in `seat` of `v` out through the door on `side` (1 = left/driver side, -1 = right) and throws
   * them to the ground; `puller` (e.g. a cop) plays the grab. Works on the player (police arrests) and on NPCs.
   * Returns false if nobody is in that seat.
   */
  /** Police hook: drag the player/driver out of a stopped vehicle (side 1 = left/driver, -1 = right). */
  dragOut(v: Enterable, side: 1 | -1 = 1, puller: Character | null = null): boolean { return this.pullOut(v, side, puller, 0); }
  pullOut(v: Enterable, side: 1 | -1, puller: Character | null, seat = 0): boolean {
    const door = v.doorIndex(side === 1 ? 'left' : 'right', 0);
    if (door < 0) return false;
    const player = this.player;
    let victim: Character | null = null, npc: Npc | null = null;
    if (seat === 0 && v.driver) victim = v.driver;
    else { npc = this.game.pop.npcs.find(n => n.char.inVehicle === v && n.alive && Math.sign(n.char.human.root.position.x) === Math.sign(v.seatLocal(seat).x)) ?? null; victim = npc?.char ?? null; }
    if (!victim) return false;
    if (victim === player) {
      if (this.job) this.cancel();
      this.game.detachPlayer(v, false);
      player.inVehicle = v;
    } else {
      npc = this.game.pop.npcs.find(n => n.char === victim) ?? null;
      if (v instanceof Vehicle) this.game.traffic.release(v);
    }
    v.setDoor(door, 1); this.game.audio.play('doorOpen', { pos: v.position });
    if (puller && puller !== player) {
      puller.yaw = v.yaw - side * HALF_PI;
      puller.human.playAction('pull_out');
    }
    this.throwOut(victim, npc, v, door, seat, puller);
    return true;
  }
  /** Starts the pulled-out animation of an occupant. */
  private throwOut(victim: Character, npc: Npc | null, v: Enterable, door: number, seat: number, puller: Character | null) {
    const f = v.doorFrame(door);
    const sl = v.seatLocal(seat);
    const pts = doorPoints(f, sl);
    if (v.driver === victim) v.driver = null;
    if (npc) { npc.brain = 'scripted'; npc.stateT = 0; }
    v.visual.add(victim.human.root);
    victim.inVehicle = v; victim.setCollision(false);
    victim.human.setState('loco'); victim.human.setSpeed(0);
    victim.human.playAction('pulled_out');
    const from = victim.human.root.position.clone();
    this.victims.push({ char: victim, npc, v, door, f, t: 0, dur: 0.6, from, to: pts.throwTo.clone(), yaw0: 0, yaw1: -f.sg * HALF_PI, thrown: true, puller });
  }
  /** Passengers of a jacked car get out on their own side and run. */
  private passengersFlee(v: Enterable) {
    for (const n of this.game.pop.npcs) {
      if (!n.alive || n.char.inVehicle !== v || n.char === v.driver || this.victims.some(x => x.char === n.char)) continue;
      const side = n.char.human.root.position.x >= 0 ? 'left' : 'right';
      const row = n.char.human.root.position.z < -0.4 ? 1 : 0;
      let door = v.doorIndex(side, row); if (door < 0) door = v.doorIndex(side, 0);
      if (door < 0) continue;
      const f = v.doorFrame(door);
      v.setDoor(door, 1);
      n.brain = 'scripted';
      n.char.human.playAction('exit_car', { rate: 2 });
      const from = n.char.human.root.position.clone();
      const to = doorPoints(f, from).out;
      this.victims.push({ char: n.char, npc: n, v, door, f, t: 0, dur: 0.7, from, to, yaw0: 0, yaw1: f.sg * HALF_PI, thrown: false, puller: null });
    }
  }

  /** True while this system moves the player (walk-up at the door) instead of the player controller. */
  get ownsMovement() { return !!this.job && !this.parented && this.job.kind === 'enter'; }
  /** The player is being dragged out of a vehicle. */
  get playerDragged() { return this.victims.some(v => v.char === this.player); }

  // ------------------------------------------------------------------------------------------------ per frame
  /** Animates entries/exits; returns true when it also updated the player's visuals this frame. */
  update(dt: number): boolean {
    const dragged = this.updateVictims(dt);
    this.updateDoorTimers(dt);
    const j = this.job;
    const c = this.player, h = c.human;
    if (!j) return dragged;
    j.t += dt;
    const v = j.v;
    if (this.vanished(j)) return dragged;
    if (v.destroyed && j.kind === 'enter' && !this.parented) { this.abort(); return dragged; }
    // moving cancels the walk-up (and the break-in before the glass goes)
    if ((j.phase === 'approach' || (j.phase === 'open' && !j.opened) || (j.phase === 'smash' && j.t < 0.3)) && j.life + j.t > 0.2 && !this.game.inputBlocked) {
      const mv = this.game.input.moveAxes();
      if (Math.hypot(mv.x, mv.y) > 0.5) { this.abort(); return dragged; }
    }
    const pts = doorPoints(j.f, v.seatLocal(j.entrySeat));
    const hel = !(v instanceof Vehicle); // helicopters: slower, deliberate climb over the skid
    const tClimb = hel ? 0.55 : 0.2, tSit = hel ? 0.7 : 0.4, tTurn = hel ? 0.35 : 0.22;
    switch (j.phase) {
      case 'approach': h.setState('loco'); h.setSpeed(c.speed); h.setUpperMode('loco'); break;
      case 'smash':
        h.setSpeed(0);
        if (j.t > 0.9) this.startOpen(j);
        break;
      case 'open':
        h.setSpeed(c.speed);
        if (j.t > (v.driver && v.driver !== c ? 0.5 : hel ? 0.8 : 0.42)) {
          if (v.driver && v.driver !== c) { j.phase = 'jack'; j.t = 0; h.playAction('pull_out', { rate: 1.7, onEvent: e => { if (e === 'grab') this.grab(j); } }); }
          else this.startClimb(j);
        }
        break;
      case 'jack':
        h.setSpeed(c.speed);
        if (j.t > 0.8 && j.grabbed) this.startClimb(j);
        else if (j.t > 1.6) this.startClimb(j);
        break;
      case 'climb': { // step into the gap, turning the back to the seat
        const k = sm(j.t / tClimb);
        lerpV(h.root.position, j.startPos, pts.gap, k);
        if (hel) h.root.position.y += Math.sin(Math.min(1, j.t / tClimb) * Math.PI) * 0.3; // boot up on the skid, then over the sill
        h.root.rotation.y = j.startYaw + wrapAngle(j.f.sg * HALF_PI - j.startYaw) * k;
        h.setSpeed(j.t < tClimb * 0.7 ? 1.0 : 0);
        if (j.t >= tClimb) { j.phase = 'sit'; j.t = 0; h.setSpeed(0); h.playAction('enter_car', { rate: hel ? 1.6 : 2.6 }); }
        break;
      }
      case 'sit': { // sit down onto the seat edge
        const k = sm((j.t - 0.04) / (tSit - 0.04));
        lerpV(h.root.position, pts.gap, pts.sit, k);
        h.root.rotation.y = j.f.sg * HALF_PI;
        if (j.t >= tSit) { j.phase = 'turn'; j.t = 0; h.setState('drive'); h.stopAction(); }
        break;
      }
      case 'turn': { // swing the legs in and face forward
        const k = sm(j.t / tTurn);
        lerpV(h.root.position, pts.sit, v.seatLocal(j.entrySeat), k);
        h.root.rotation.y = j.f.sg * HALF_PI * (1 - k);
        if (j.t >= tTurn) {
          if (j.entrySeat !== j.seat) { j.phase = 'slide'; j.t = 0; }
          else this.seated(j);
        }
        break;
      }
      case 'slide': {
        const k = sm(j.t / 0.5);
        lerpV(h.root.position, v.seatLocal(j.entrySeat), v.seatLocal(j.seat), k);
        if (j.t >= 0.5) this.seated(j);
        break;
      }
      case 'close':
        if (j.t > 0.12) {
          if (v instanceof Vehicle && !v.ignition) { j.phase = 'hotwire'; j.t = 0; this.startHotwire(v); }
          else { this.job = null; if (v instanceof Vehicle) this.game.audio.play('engineStart', { pos: v.position }); }
        }
        break;
      case 'hotwire': this.updateHotwire(j, dt); break;
      // ---- exit
      case 'xopen':
        if (j.t > 0.22) { j.phase = j.entrySeat !== j.seat ? 'xslide' : 'xturn'; j.t = 0; }
        break;
      case 'xslide': {
        const k = sm(j.t / 0.45);
        lerpV(h.root.position, v.seatLocal(j.seat), v.seatLocal(j.entrySeat), k);
        if (j.t >= 0.45) { j.phase = 'xturn'; j.t = 0; }
        break;
      }
      case 'xturn': {
        const k = sm(j.t / 0.32);
        lerpV(h.root.position, v.seatLocal(j.entrySeat), pts.sit, k);
        h.root.rotation.y = j.f.sg * HALF_PI * k;
        if (j.t >= 0.32) { j.phase = 'xstand'; j.t = 0; h.playAction('exit_car'); h.setState('loco'); h.setSpeed(0); }
        break;
      }
      case 'xstand': {
        const k = sm(j.t / 0.62);
        lerpV(h.root.position, pts.sit, pts.gap, k);
        h.root.rotation.y = j.f.sg * HALF_PI;
        if (j.t >= 0.62) { j.phase = 'xstep'; j.t = 0; }
        break;
      }
      case 'xstep': {
        const k = sm(j.t / 0.32);
        lerpV(h.root.position, pts.gap, pts.out, k);
        h.root.rotation.y = j.f.sg * HALF_PI + wrapAngle(-0.6 * j.f.sg) * k;
        h.setSpeed(1.4);
        if (j.t >= 0.32) {
          this.job = null;
          this.releasePlayer(v, j.door, true);
          this.doorTimers.push({ v, door: j.door, t: 0.55, who: c });
        }
        break;
      }
    }
    // the player's position follows the animated root (camera, audio, HUD)
    if (this.job && h.root.parent === v.visual) {
      v.group.updateMatrixWorld(true); // parents too: headless frames never render, so the group's world matrix can be stale
      h.root.getWorldPosition(_w);
      c.pos.copy(_w);
      c.body.setNextKinematicTranslation({ x: _w.x, y: _w.y + 0.87, z: _w.z });
      c.yaw = v.yaw + h.root.rotation.y;
      h.update(dt);
    } else if (this.job || (!this.game.playerVehicle && !this.game.playerHeli)) { // seated in a helicopter the root stays in the cabin (local coords)
      c.updateVisual(dt);
    } else h.update(dt);
    return true;
  }
  private grab(j: Job) {
    if (j.grabbed) return;
    j.grabbed = true;
    const v = j.v, d = v.driver;
    if (!d || d === this.player) return;
    const npc = this.game.pop.npcs.find(n => n.char === d) ?? null;
    if (v instanceof Vehicle) this.game.traffic.release(v);
    this.throwOut(d, npc, v, j.door, 0, this.player);
    this.passengersFlee(v);
    this.game.police.report(v instanceof Vehicle && v.kind === 'police' ? 'copCarTheft' : 'carjack', this.player.pos);
    this.game.pop.danger(this.player.pos, 20, this.player);
    this.game.cam.addShake(0.08);
  }
  private startClimb(j: Job) {
    const v = j.v, c = this.player, h = c.human;
    if (v.destroyed || (v.driver && v.driver !== c)) { this.abort(); return; }
    // keep the occupant check honest: someone still in our seat?
    j.phase = 'climb'; j.t = 0;
    h.stopAction(); h.reach.w = 0; h.reach.L = h.reach.R = null;
    v.visual.updateMatrixWorld();
    j.startPos.copy(v.visual.worldToLocal(_w.copy(c.pos)));
    j.startYaw = wrapAngle(c.yaw - v.yaw);
    v.visual.add(h.root);
    h.root.position.copy(j.startPos); h.root.rotation.set(0, j.startYaw, 0);
    c.inVehicle = v; c.setCollision(false); c.vel.set(0, 0, 0);
    v.driver = c; // claim the seat (traffic leaves the car alone)
  }
  private seated(j: Job) {
    const v = j.v;
    j.phase = 'close'; j.t = 0;
    this.game.boardFinished(v, j.seat);
    v.setDoor(j.door, 0);
    this.game.audio.play('doorClose', { pos: v.position });
    v.playerUsed = true; v.doorsLocked = false;
  }
  private startHotwire(v: Vehicle) {
    const h = this.player.human;
    h.playAction('hotwire');
    this.game.events.onToast('Hotwiring...', 'info');
    void v;
  }
  private updateHotwire(j: Job, dt: number) {
    const v = j.v as Vehicle, g = this.game;
    // sparks under the dash, clicks of the wires, a failed crank, then the engine catches
    const sl = v.seatLocal(j.seat);
    if (Math.random() < dt * 9) {
      const p = v.visual.localToWorld(_w.set(sl.x - 0.08, sl.y + 0.62, sl.z + 0.55));
      g.particles.sparks(p.x, p.y, p.z, 3 + Math.floor(Math.random() * 4), 1.6);
      if (Math.random() < 0.5) g.audio.play('reload', { pos: p, volume: 0.25, pitch: 1.6 + Math.random() * 0.6 });
    }
    const was = j.t - dt;
    if (was < 1.3 && j.t >= 1.3) g.audio.play('engineStart', { pos: v.position, volume: 0.6, pitch: 0.75 }); // sputters
    if (j.t >= HOTWIRE_TIME) {
      v.ignition = true;
      this.player.human.stopAction('hotwire');
      g.audio.play('engineStart', { pos: v.position, volume: 1 });
      this.job = null;
    }
  }
  /** The target car was despawned mid-job (e.g. the player teleported far away): its physics body is gone, so drop the job. */
  private vanished(j: NonNullable<CarEntry['job']>): boolean {
    if (!(j.v instanceof Vehicle) || !j.v.disposed) return false;
    j.opened = false; this.abort(); return true;
  }
  private abort(msg?: string) {
    const j = this.job; if (!j) return;
    this.job = null;
    this.player.human.stopAction();
    if (j.opened && !j.v.driver) this.doorTimers.push({ v: j.v, door: j.door, t: 0.5, who: null });
    if (msg && this.game.time - this.lastWarn > 3) { this.lastWarn = this.game.time; this.game.events.onToast(msg, 'info'); }
  }
  /** Puts the player back in the world at the door's stand point. */
  private releasePlayer(v: Enterable, door: number, gentle: boolean) {
    const c = this.player, h = c.human;
    v.group.updateMatrixWorld(true);
    const p = h.root.getWorldPosition(new THREE.Vector3());
    if (!gentle && door >= 0) { const f = v.doorFrame(door); v.group.localToWorld(p.set(f.sg * (f.outX + 0.7), f.ground, 0)); }
    const yaw = v.yaw + h.root.rotation.y;
    this.game.renderer.scene.add(h.root);
    h.root.rotation.set(0, yaw, 0);
    this.putOnGround(c, p, yaw);
    c.inVehicle = null; c.setCollision(true);
    if (v.driver === c) v.driver = null;
    h.setState('loco'); h.stopAction('exit_car');
    this.game.events.onVehicleExited(v as Vehicle);
  }
  /** Places a character at a world point, snapped to the ground below (never inside the car or under the pier). */
  private putOnGround(c: Character, p: THREE.Vector3, yaw: number) {
    const solid = groups(ALL, G_STATIC | G_PROP);
    const hit = this.game.physics.ray(p.x, p.y + 1.2, p.z, 0, -1, 0, 4, solid);
    const y = hit ? p.y + 1.2 - hit.toi + 0.02 : p.y;
    c.place(p.x, y, p.z, yaw);
  }

  private updateVictims(dt: number): boolean {
    let player = false;
    for (const vi of [...this.victims]) {
      vi.t += dt;
      const h = vi.char.human, v = vi.v;
      const k = sm(vi.t / vi.dur);
      if (h.root.parent === v.visual) {
        lerpV(h.root.position, vi.from, vi.to, k);
        // lifted over the sill on the way out
        h.root.position.y += Math.sin(k * Math.PI) * 0.18;
        h.root.rotation.y = vi.yaw0 + wrapAngle(vi.yaw1 - vi.yaw0) * sm(vi.t / (vi.dur * 0.6));
        if (vi.char === this.player) {
          v.visual.updateMatrixWorld(); h.root.getWorldPosition(this.player.pos); this.player.yaw = v.yaw + h.root.rotation.y;
          h.update(dt); player = true;
        }
        if (vi.puller && vi.thrown) this.grip(vi);
        if (vi.puller && vi.puller !== this.player && vi.puller.alive) vi.puller.faceTowards(v.yaw - vi.f.sg * HALF_PI, 8, dt);
      }
      if (vi.t >= vi.dur && h.root.parent === v.visual) this.landVictim(vi);
      if (vi.t >= vi.dur + 0.1) this.victims.splice(this.victims.indexOf(vi), 1);
    }
    return player;
  }
  /** The puller's hands stay on the victim's shoulders (two-bone IK) while he is hauled out and flung, then let go. */
  private grip(vi: Victim) {
    const r = vi.puller!.human.reach, h = vi.char.human, k = vi.t / vi.dur;
    if (k > 0.82) { r.w = 0; r.L = r.R = null; return; }
    r.L ??= new THREE.Vector3(); r.R ??= new THREE.Vector3();
    h.root.updateMatrixWorld(true);
    h.root.localToWorld(r.L.set(0.2, 1.38, 0.04)); h.root.localToWorld(r.R.set(-0.2, 1.38, 0.04));
    r.w = Math.min(1, k * 8);
  }
  private landVictim(vi: Victim) {
    if (vi.puller) { const r = vi.puller.human.reach; r.w = 0; r.L = r.R = null; }
    const c = vi.char, v = vi.v, h = c.human;
    v.visual.updateMatrixWorld();
    const p = h.root.getWorldPosition(new THREE.Vector3());
    const yaw = v.yaw + h.root.rotation.y;
    this.game.renderer.scene.add(h.root);
    this.putOnGround(c, p, yaw);
    c.inVehicle = null; c.setCollision(true);
    if (v.driver === c) v.driver = null;
    h.stopAction();
    const out = v.group.localToWorld(new THREE.Vector3(vi.f.sg, 0, 0)).sub(v.position).setY(0).normalize();
    if (vi.thrown) {
      // thrown on the tarmac on the side they were dragged out of
      c.hitReact(out.x, out.z, 1.5);
      c.vel.set(out.x * 2.6, 0, out.z * 2.6);
      if (c === this.player) {
        this.game.cam.addShake(0.3);
        this.game.events.onVehicleExited(v as Vehicle);
      }
    }
    const n = vi.npc;
    if (n) {
      n.stateT = 0;
      if (vi.thrown && (n.role === 'gang' || (n.role === 'civilian' && Math.random() < 0.18))) {
        // some get up swinging
        n.hostile = true; n.brain = 'combat'; n.target = this.player; n.seenTime = this.game.time; n.lastSeen.copy(this.player.pos);
      } else if (n.role === 'police') { n.brain = 'combat'; n.target = this.player; }
      else {
        n.brain = 'flee'; n.fleeFrom.copy(v.position);
      }
    }
  }
  private updateDoorTimers(dt: number) {
    for (const d of [...this.doorTimers]) {
      d.t -= dt;
      if (d.t > 0) continue;
      this.doorTimers.splice(this.doorTimers.indexOf(d), 1);
      if (d.v.destroyed) continue;
      // leaving at a sprint leaves the door hanging open
      if (d.who && d.who.speed > 4.5) continue;
      if (this.job?.v === d.v) continue;
      d.v.setDoor(d.door, 0);
      this.game.audio.play('doorClose', { pos: d.v.position, volume: 0.9 });
    }
  }
  /** Seconds-free debug summary (tests). */
  debug() { const j = this.job; return j ? { kind: j.kind, phase: j.phase, t: j.t, door: j.door, seat: j.seat } : null; }
}
