/**
 * The player's weapons: aiming, firing, recoil, spread, reloading, melee combos and the held weapon model.
 *
 * Gun feel model (numbers per weapon live in combat/weapons.ts):
 *  - Shot cone = base (hip `spread` / aimed `aimSpread`) x accuracy + bloom + movement. Holding still on target settles
 *    accuracy towards the weapon's `firstShot` multiplier, so a calm first shot is pin-point; every shot adds bloom that
 *    recovers shortly after you stop; moving or jumping widens the cone. `spread` (read by the HUD) is the honest cone
 *    minus the base the HUD adds back.
 *  - Recoil kicks the camera up (plus a little random / drifting yaw) over ~2 frames and then smoothly returns most of
 *    it (`recoverFrac`), never pulling below where the burst started if the player already compensated.
 *  - The weapon model slides back and flips its muzzle, and the torso leans back, all springing back within ~0.15 s.
 */
import * as THREE from 'three';
import { Inventory, WEAPONS, weaponMesh, MUZZLE, type WeaponId, type WeaponDef } from '../combat/weapons';
import type { Combat } from '../combat/combat';
import type { Character } from '../actors/character';
import type { Input } from '../core/input';
import type { CameraRig } from './camera';
import type { PlayerController } from './player';
import { type Physics, groups, G_STATIC } from '../core/physics';
import type { GameAudio } from '../ui/contracts';
import type { AudioExtras, ExtraSfx } from '../audio/sfx';
import type { Vehicle } from '../vehicles/vehicle';

const HAND_FIX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
/** Reload foley timeline as fractions of the reload: [at, sound, only when reloading from empty]. */
const RELOAD_STEPS: Partial<Record<WeaponId, [number, ExtraSfx, boolean][]>> = {
  pistol: [[0.06, 'magOut', false], [0.52, 'magIn', false], [0.84, 'slideRelease', true]],
  smg: [[0.08, 'magOut', false], [0.55, 'magIn', false], [0.8, 'boltRack', true]],
  rifle: [[0.08, 'magOut', false], [0.55, 'magIn', false], [0.8, 'boltRack', true]],
};
const PITCH: Record<WeaponId, number> = { fists: 1, pistol: 1.12, smg: 1.04, shotgun: 0.85, rifle: 0.95 };
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _axis = new THREE.Vector3();
/** Rotates a bone about a world-space axis (applied after the animation mixer, so it never accumulates). */
function rotateBoneWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(_q);
  _axis.copy(axis).applyQuaternion(_q.invert());
  bone.quaternion.premultiply(_q2.setFromAxisAngle(_axis, angle));
  bone.updateMatrixWorld(true);
}

export class PlayerCombat {
  inv = new Inventory();
  private models = new Map<WeaponId, THREE.Group>();
  private holder = new THREE.Group();
  private comboIdx = 0;
  private pendingMelee = -1;
  hipAimT = 0;
  /** Current shot cone minus the weapon's base cone (the HUD adds the base back: crosshairSpread = spread + base). */
  spread = 0;
  /** Current full shot cone (radius, radians-ish). */
  cone = 0;
  hitMarker = 0;
  aimPoint = new THREE.Vector3();
  /** 0..1 how settled the aim is (1 = first-shot accuracy). */
  accuracy = 0;
  bloom = 0;
  private time = 0; private lastShot = -10; private burst = 0;
  private pendingPitch = 0; private pendingYaw = 0; private pitchDebt = 0; private yawDebt = 0; private anchorPitch = 0;
  private kick = 0; private kickDef: WeaponDef = WEAPONS.fists;
  private wasReloading = false; private reloadStep = 0; private shellsSeen = 0;
  private acousticsT = 0;
  private tmpO = new THREE.Vector3(); private tmpD = new THREE.Vector3();
  private spine: THREE.Object3D | null = null;
  constructor(private player: Character, private ctl: PlayerController, private input: Input, private cam: CameraRig, private combat: Combat, private physics: Physics, private audio: GameAudio, scene: THREE.Scene) {
    scene.add(this.holder);
    for (const id of ['pistol', 'smg', 'shotgun', 'rifle'] as WeaponId[]) { const m = weaponMesh(id); m.visible = false; this.holder.add(m); this.models.set(id, m); }
    combat.player = player;
    this.spine = player.human.spine ?? null;
  }
  get armed() { return !WEAPONS[this.inv.current].melee; }
  get aiming() { return this.ctl.aiming || this.hipAimT > 0; }
  private get ax(): Partial<AudioExtras> { return this.audio as GameAudio & Partial<AudioExtras>; }
  private foley(name: ExtraSfx, volume = 1) {
    const c = this.player, pitch = PITCH[this.inv.current] * (0.97 + Math.random() * 0.06);
    if (this.ax.playExtra) this.ax.playExtra(name, { pos: c.pos, volume, pitch });
    else if (name === 'magIn' || name === 'shellInsert') this.audio.play('reload', { pos: c.pos, volume: 0.5 });
  }
  /**
   * Crosshair size for the HUD, which draws a radius of 5 + v x 30 CSS px: converts the true shot cone at the current
   * vertical FOV (degrees) and viewport height (CSS px) so the reticle covers where the shots can land.
   */
  hudSpread(fovDeg: number, viewportPx: number): number {
    const px = this.cone / Math.tan(fovDeg * Math.PI / 360) * viewportPx / 2;
    return Math.min(1.5, Math.max(0, (px - 5) / 30));
  }
  /** Per-frame update (dt in game time). blocked: menus/wheel/vehicle. */
  update(dt: number, blocked: boolean, targets: () => Iterable<Character>, vehicles: () => Iterable<Vehicle>) {
    const c = this.player, h = c.human, inv = this.inv;
    this.time += dt;
    const done = inv.tick(dt);
    const def = inv.def;
    this.reloadFoley(def, done);
    this.hitMarker = Math.max(0, this.hitMarker - dt * 3);
    this.hipAimT = Math.max(0, this.hipAimT - dt);
    const onFoot = c.alive && !c.inVehicle;
    // weapon cycling
    if (!blocked && onFoot) {
      if (this.input.justPressed('nextWeapon')) { inv.cycle(1); this.audio.play('equip', { pitch: PITCH[inv.current] }); }
      if (this.input.justPressed('prevWeapon')) { inv.cycle(-1); this.audio.play('equip', { pitch: PITCH[inv.current] }); }
      if (this.input.justPressed('reload')) inv.startReload();
    }
    // upper body pose
    if (onFoot) h.setUpperMode(this.armed ? (this.aiming ? 'pistol' : 'carry') : 'loco');
    this.updateSpread(dt, def);
    this.updateRecoil(dt, def);
    // aim point from the camera centre
    this.cam.aimRay(this.tmpO, this.tmpD);
    const camHit = this.physics.ray(this.tmpO.x, this.tmpO.y, this.tmpO.z, this.tmpD.x, this.tmpD.y, this.tmpD.z, 250, undefined, c.collider);
    this.aimPoint.copy(this.tmpO).addScaledVector(this.tmpD, camHit ? Math.max(camHit.toi, 2.5) : 250);
    // Fire
    const wantFire = !blocked && onFoot && (def.auto ? this.input.held('fire') : this.input.justPressed('fire'));
    if (wantFire) {
      if (!def.melee && inv.state.clip === 0) {
        // dry fire: click once per trigger pull, then reload if there is ammo
        if (this.input.justPressed('fire') && !inv.reloading) { this.audio.play('empty', { pos: c.pos, pitch: PITCH[inv.current] }); inv.startReload(); }
      } else if (inv.fire()) {
        if (def.melee) {
          const anim = this.comboIdx++ % 2 === 0 ? 'Punch_Jab' : 'Punch_Cross';
          h.playOnce(anim, 'upper', 0.06);
          if (!this.ctl.aiming) c.yaw = this.cam.yaw + Math.PI;
          this.pendingMelee = 0.16;
          this.kickDef = def; this.kick = 0.6;
        } else this.fireRanged(def);
      }
    }
    if (this.pendingMelee > 0) {
      this.pendingMelee -= dt;
      if (this.pendingMelee <= 0) { const hit = this.combat.melee(c, def, targets(), vehicles()); if (hit) { this.hitMarker = 1; this.cam.addShake(0.12); this.kick = 1; } }
    }
    // reload animation on any reload start (manual, empty click or automatic after the last round)
    if (inv.reloading && !this.wasReloading) { h.playOnce('Pistol_Reload', 'upper', 0.1); this.reloadStep = 0; this.shellsSeen = inv.shellsLoaded; }
    this.wasReloading = inv.reloading;
    this.kick *= Math.exp(-this.kickDef.kickRate * dt);
    this.updateModel(true);
    this.probeAcoustics(dt);
  }

  private fireRanged(def: WeaponDef) {
    const c = this.player;
    if (!this.ctl.aiming) { this.hipAimT = 0.7; c.yaw = this.cam.yaw + Math.PI; }
    this.updateModel(); c.human.root.rotation.y = c.yaw;
    const o = this.muzzleWorld(new THREE.Vector3());
    const dir = this.aimPoint.clone().sub(o).normalize();
    const hits = this.combat.shoot(c, def, o, dir, this.cone);
    if (hits.some(x => x.kind === 'character')) this.hitMarker = 1;
    // bloom / accuracy
    const fresh = this.time - this.lastShot > Math.max(0.35, def.interval * 2.5);
    this.burst = fresh ? 1 : this.burst + 1;
    this.bloom = Math.min(def.bloomMax, this.bloom + def.bloom * (this.ctl.aiming ? 1 : 1.35));
    this.accuracy *= 0.3;
    this.lastShot = this.time;
    // camera recoil: applied over ~2 frames, most of it recovers once you stop
    if (fresh) { this.anchorPitch = this.cam.pitch; this.pitchDebt = 0; this.yawDebt = 0; }
    const ramp = def.auto ? Math.min(1.25, 0.85 + this.burst * 0.06) : 1;
    const kp = def.kickPitch * (0.85 + Math.random() * 0.3) * ramp * (this.ctl.aiming ? 1 : 1.2);
    const ky = (Math.random() * 2 - 1) * def.kickYaw + def.kickDrift * Math.min(1, this.burst / 4);
    this.pendingPitch += kp; this.pitchDebt += kp * def.recoverFrac;
    this.pendingYaw += ky; this.yawDebt += ky * 0.5;
    this.cam.addShake(def.shake);
    // weapon / body kick
    this.kickDef = def; this.kick = Math.min(1.4, this.kick + 1);
  }

  private updateSpread(dt: number, def: WeaponDef) {
    const c = this.player, aimed = this.ctl.aiming;
    const still = c.speed < 0.6 && c.grounded;
    if (aimed && still && this.time - this.lastShot > def.interval * 1.3) this.accuracy = Math.min(1, this.accuracy + dt / 0.3);
    else if (!still || !this.aiming) this.accuracy = Math.max(0, this.accuracy - dt * 4);
    if (this.time - this.lastShot > def.bloomDelay) this.bloom *= Math.exp(-def.bloomRecover * dt);
    if (this.bloom < 1e-4) this.bloom = 0;
    const move = Math.min(1.4, c.speed / 4.1) * def.movePenalty + (c.grounded ? 0 : def.movePenalty * 1.5 + 0.02 * (def.melee ? 0 : 1));
    const base = aimed ? def.aimSpread : def.spread;
    this.cone = def.melee ? 0 : base * (1 - this.accuracy * (1 - def.firstShot)) + this.bloom + move;
    this.spread = this.cone - base;
  }

  private updateRecoil(dt: number, def: WeaponDef) {
    const cam = this.cam;
    if (Math.abs(this.pendingPitch) > 1e-6 || Math.abs(this.pendingYaw) > 1e-6) {
      const k = 1 - Math.exp(-dt * 45);
      const p = this.pendingPitch * k, y = this.pendingYaw * k;
      cam.pitch += p; cam.yaw += y; this.pendingPitch -= p; this.pendingYaw -= y;
    }
    if (this.time - this.lastShot > def.recoverDelay && (this.pitchDebt > 1e-5 || Math.abs(this.yawDebt) > 1e-5)) {
      const k = 1 - Math.exp(-dt * Math.max(1, def.recoverRate));
      // never drag the view below where the burst started (the player may already have pulled down)
      const room = Math.max(0, cam.pitch - this.anchorPitch);
      const p = Math.min(this.pitchDebt * k, room);
      cam.pitch -= p; this.pitchDebt = room <= this.pitchDebt * k ? 0 : this.pitchDebt - p;
      const y = this.yawDebt * k; cam.yaw -= y; this.yawDebt -= y;
    }
    cam.pitch = Math.min(0.85, Math.max(-1.2, cam.pitch));
  }

  /** Reload foley in sync with the reload: magazine out / in / slide or bolt; shells one by one and a pump at the end. */
  private reloadFoley(def: WeaponDef, done: boolean) {
    const inv = this.inv;
    if (def.shellReload > 0) {
      if (inv.shellsLoaded !== this.shellsSeen) { this.shellsSeen = inv.shellsLoaded; this.foley('shellInsert', 0.9); }
      if (done && inv.reloadFromEmpty) this.foley('pump', 0.8);
      return;
    }
    const steps = RELOAD_STEPS[def.id];
    if (!steps || !inv.reloading) return;
    const p = inv.reloadProgress;
    while (this.reloadStep < steps.length && p >= steps[this.reloadStep][0]) {
      const [, snd, emptyOnly] = steps[this.reloadStep++];
      if (!emptyOnly || inv.reloadFromEmpty) this.foley(snd);
    }
  }

  /** Every ~0.3 s, measure the walls around the player so gunshots get matching slapback (and open-air tails). */
  private probeAcoustics(dt: number) {
    this.acousticsT -= dt;
    const set = this.ax.setAcoustics; if (!set || this.acousticsT > 0) return;
    this.acousticsT = 0.3;
    const c = this.player, y = c.pos.y + 1.7;
    const walls: { d: number; x: number; z: number }[] = []; let misses = 0;
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * Math.PI * 2, dx = Math.sin(a), dz = Math.cos(a);
      const hit = this.physics.ray(c.pos.x, y, c.pos.z, dx, 0, dz, 60, groups(0xffff, G_STATIC), c.collider);
      if (hit) walls.push({ d: hit.toi, x: dx, z: dz }); else misses++;
    }
    const roof = this.physics.ray(c.pos.x, y, c.pos.z, 0, 1, 0, 12, groups(0xffff, G_STATIC), c.collider);
    set.call(this.audio, { walls, open: misses / 8, indoors: roof && roof.toi < 6 && misses < 2 ? 0.6 : 0 });
  }

  muzzleWorld(out: THREE.Vector3) {
    const m = this.models.get(this.inv.current);
    if (!m || !m.visible) return out.set(this.player.pos.x, this.player.pos.y + 1.4, this.player.pos.z);
    return out.set(0, 0.07, MUZZLE[this.inv.current]).applyMatrix4(m.matrixWorld);
  }
  /** Places the held weapon; `final` (once per frame, after everything else) also applies the torso kick. */
  private updateModel(final = false) {
    const c = this.player;
    const onFoot = c.alive && !c.inVehicle;
    const show = this.armed && onFoot;
    for (const [id, m] of this.models) m.visible = show && id === this.inv.current;
    const k = this.kick, kd = this.kickDef;
    c.human.root.updateMatrixWorld(true);
    // torso leans back with the shot (after the mixer, so it never accumulates)
    if (final && onFoot && k > 0.002 && kd.kickBody > 0 && this.spine) {
      _axis.set(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
      rotateBoneWorld(this.spine, _axis, -k * kd.kickBody);
    }
    if (!show) return;
    const m = this.models.get(this.inv.current)!;
    const hand = c.human.rightHand;
    hand.getWorldPosition(m.position);
    if (this.aiming) {
      m.lookAt(this.aimPoint);
      m.position.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion), 0.04);
      if (k > 0.002) {
        // slide back along the barrel and flip the muzzle up
        m.position.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion), -k * kd.kickBack);
        m.rotateX(-k * kd.kickFlip);
      }
    } else {
      hand.getWorldQuaternion(m.quaternion); m.quaternion.multiply(HAND_FIX);
    }
    m.updateMatrixWorld(true);
  }
  give(id: WeaponId, ammo: number) { this.inv.give(id, ammo); }
}
