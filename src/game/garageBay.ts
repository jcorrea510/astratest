/**
 * Round 9 garage visit: drive into the hall, stop, the roll-up door comes down behind you, the camera frames the car and the whole
 * game pauses (game.paused: the same switch the pause menu uses, so traffic, police, peds and timers are frozen). The menu
 * (repair / respray with a live preview / sell / leave) runs over the frozen scene; leaving rolls the door up, then the game resumes.
 * The state machine is driven in real time by tick(raw) from main's frame (activities.update does not run while paused).
 */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI } from '../ui/contracts';
import type { GarageView } from '../ui/garageMenu';
import type { Vehicle } from '../vehicles/vehicle';
import { BAYS, bayAt, bayPark } from './bays';
import { BAY_DOORS } from '../world/garageBuild';

export interface GarageHost {
  view(bay: number): GarageView | null;
  repair(): void;
  paint(hex: string): boolean;
  /** Pays out and forgets the car; returns the vehicle to remove (null: refused). */
  sell(bay: number): Vehicle | null;
}
type State = 'idle' | 'closing' | 'menu' | 'opening';
export const DOOR_TIME = 1.5;
const ease = (k: number) => k * k * (3 - 2 * k);

export class GarageBays {
  state: State = 'idle';
  bay = -1;
  /** 1 = door fully open, 0 = closed */
  private open = 1;
  private t = 0; private clock = 0;
  private car: Vehicle | null = null;
  private carFrom = { x: 0, z: 0, yaw: 0 };
  private camFrom = { pos: new THREE.Vector3(), quat: new THREE.Quaternion(), fov: 60 };
  private origPaint = new THREE.Color();
  private tmpCam = new THREE.PerspectiveCamera();
  private _a = new THREE.Vector3(); private _b = new THREE.Vector3();
  /** called when a visit ends (after the game resumed) */
  onDone: (() => void) | null = null;

  constructor(private game: Game, private ui: GameUI, private host: GarageHost) {
    game.camOverride = raw => this.shot(raw);
  }
  get active() { return this.state !== 'idle'; }
  get menuOpen() { return this.state === 'menu'; }

  /** The bay the player's car is parked in, ready to start a visit (-1: none). */
  bayFor(v: Vehicle): number { return Math.abs(v.speed) < 2.5 ? bayAt(v.position.x, v.position.z) : -1; }

  /** Starts a visit: freezes the world and begins the door sequence. */
  begin(bay: number): boolean {
    const g = this.game, v = g.playerVehicle;
    if (this.state !== 'idle' || !v || bay < 0) return false;
    this.bay = bay; this.car = v; this.state = 'closing'; this.t = 0; this.open = 1;
    const p = v.phys.body.translation();
    this.carFrom = { x: p.x, z: p.z, yaw: v.yaw };
    const cam = g.renderer.camera; this.camFrom.pos.copy(cam.position); this.camFrom.quat.copy(cam.quaternion); this.camFrom.fov = cam.fov;
    this.origPaint.copy(v.paint);
    v.input.throttle = 0; v.input.steer = 0; v.input.handbrake = true;
    g.paused = true; g.menuOpen = true; g.input.exitLock();
    g.audio.setPausedMuffle(true); this.ui.setHudVisible(false);
    g.audio.play('doorClose', { pos: v.position });
    return true;
  }

  /** Real-time driver (call every frame, also while the game is paused). */
  tick(raw: number) {
    if (this.state === 'idle') return;
    this.clock += raw; this.t += raw;
    const door = BAY_DOORS[this.bay];
    if (this.state === 'closing') {
      const k = Math.min(1, this.t / DOOR_TIME);
      this.open = 1 - ease(k); this.glide(ease(k));
      if (k >= 1) { this.state = 'menu'; this.t = 0; this.game.audio.play('doorClose', { pos: this.car?.position }); this.showMenu(); }
    } else if (this.state === 'opening') {
      const k = Math.min(1, this.t / DOOR_TIME);
      this.open = ease(k);
      if (k >= 1) this.finish();
    }
    if (door) { door.scale.y = Math.max(0.04, 1 - this.open * 0.96); door.visible = this.open < 0.995; }
    // the shop-floor fill light: no runtime lights, so lift the ambient terms for the frame (updateEnvironment resets them every frame)
    const r = this.game.renderer, boost = 1 + 1.3 * (1 - this.open);
    r.hemi.intensity *= boost; r.scene.environmentIntensity *= boost;
  }
  /** Moves the car to the middle of the bay, nose to the back wall (kinematic glide while the world is frozen). */
  private glide(k: number) {
    const v = this.car; if (!v) return;
    const park = bayPark(BAYS[this.bay]), f = this.carFrom;
    let dyaw = park.yaw - f.yaw; dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    const y = v.phys.body.translation().y;
    v.phys.teleport(f.x + (park.x - f.x) * k, y, f.z + (park.z - f.z) * k, f.yaw + dyaw * k);
  }

  private showMenu() {
    this.ui.openGarage(this.fresh(), {
      onRepair: () => { this.host.repair(); this.refresh(); },
      onPreview: hex => this.preview(hex),
      onPaint: hex => { if (this.host.paint(hex) && this.car) this.origPaint.copy(this.car.paint); this.refresh(); },
      onSell: () => this.sell(),
      onLeave: () => this.leave(),
    });
  }
  private fresh(): GarageView { return this.host.view(this.bay)!; }
  private refresh() { const v = this.host.view(this.bay); if (v) this.ui.updateGarage(v); }
  private preview(hex: string) { this.car?.respray(hex); }
  private revertPaint() {
    const v = this.car; if (!v) return;
    v.paint.copy(this.origPaint); (v.material.userData.u.uPaint.value as THREE.Color).copy(this.origPaint);
  }
  private sell() {
    const g = this.game, v = this.car; if (!v) return;
    this.revertPaint();
    const sold = this.host.sell(this.bay);
    if (!sold) { this.refresh(); return; }
    this.ui.closeGarage();
    // the player walks out of the sold car, to the front of the hall
    g.exitVehicle(true);
    const b = BAYS[this.bay];
    g.player.place(b.cx - 1.2, g.player.pos.y, b.zf + 2.0, Math.PI);
    g.vehicles.remove(sold);
    this.car = null; this.state = 'opening'; this.t = 0;
    g.audio.play('doorClose', { pos: g.player.pos });
  }
  /** Leave button / Esc */
  private leave() {
    if (this.state !== 'menu') return;
    this.revertPaint();
    this.state = 'opening'; this.t = 0;
    this.game.audio.play('doorClose', { pos: this.car?.position ?? this.game.player.pos });
  }
  private finish() {
    const g = this.game, v = this.car;
    this.state = 'idle'; this.car = null;
    if (v) { v.input.handbrake = false; }
    g.paused = false; g.menuOpen = false; g.audio.setPausedMuffle(false); this.ui.setHudVisible(true);
    g.input.clearAll(); g.input.requestLock();
    const door = BAY_DOORS[this.bay]; if (door) door.visible = false;
    const b = BAYS[this.bay];
    g.cam.snapBehind(g.playerVehicle ? g.playerVehicle.yaw + Math.PI : Math.PI);
    this.bay = -1; void b;
    this.onDone?.();
  }
  /** Drops a visit in progress without any animation (death, teleport, new game). */
  abort() {
    if (this.state === 'idle') return;
    const g = this.game;
    this.revertPaint(); this.ui.closeGarage();
    const door = BAY_DOORS[this.bay]; if (door) { door.scale.y = 0.04; door.visible = false; }
    this.state = 'idle'; this.car = null; this.bay = -1;
    g.paused = false; g.menuOpen = false; g.audio.setPausedMuffle(false); this.ui.setHudVisible(true);
  }

  /** The garage shot: the camera glides from the chase cam to a corner inside the hall, then sways slowly across the bay. */
  private shot(_raw: number): boolean {
    if (this.state === 'idle' || this.bay < 0) return false;
    const g = this.game, cam = g.renderer.camera, b = BAYS[this.bay], y0 = 0.18;
    const sway = Math.cos(this.clock * 0.32);
    const anchor = this._a.set(b.cx + 3.2 * sway, y0 + 1.55 + 0.12 * Math.sin(this.clock * 0.5), b.zf + 1.3);
    const target = this._b.set(b.cx, y0 + 0.75, b.zf + 6.4);
    // shift the car towards the left of the frame (the menu is docked right): aim a little to the right of it
    const dx = target.x - anchor.x, dz = target.z - anchor.z, len = Math.hypot(dx, dz) || 1;
    target.x += (-dz / len) * 1.1; target.z += (dx / len) * 1.1;
    this.tmpCam.position.copy(anchor); this.tmpCam.lookAt(target); this.tmpCam.updateMatrixWorld();
    const k = this.state === 'closing' ? ease(Math.min(1, this.t / DOOR_TIME)) : 1;
    cam.position.copy(this.camFrom.pos).lerp(anchor, k);
    cam.quaternion.copy(this.camFrom.quat).slerp(this.tmpCam.quaternion, k);
    cam.fov = this.camFrom.fov + (56 - this.camFrom.fov) * k; cam.updateProjectionMatrix();
    cam.updateMatrixWorld(true);
    return true;
  }
}
