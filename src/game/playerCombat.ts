/** The player's weapons: aiming, firing, reloading, melee combos and the held weapon model. */
import * as THREE from 'three';
import { Inventory, WEAPONS, weaponMesh, MUZZLE, type WeaponId } from '../combat/weapons';
import type { Combat } from '../combat/combat';
import type { Character } from '../actors/character';
import type { Input } from '../core/input';
import type { CameraRig } from './camera';
import type { PlayerController } from './player';
import type { Physics } from '../core/physics';
import type { GameAudio } from '../ui/contracts';
import type { Vehicle } from '../vehicles/vehicle';

const HAND_FIX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
export class PlayerCombat {
  inv = new Inventory();
  private models = new Map<WeaponId, THREE.Group>();
  private holder = new THREE.Group();
  private comboIdx = 0;
  private pendingMelee = -1;
  hipAimT = 0;
  spread = 0;
  hitMarker = 0;
  aimPoint = new THREE.Vector3();
  private tmpO = new THREE.Vector3(); private tmpD = new THREE.Vector3();
  constructor(private player: Character, private ctl: PlayerController, private input: Input, private cam: CameraRig, private combat: Combat, private physics: Physics, private audio: GameAudio, scene: THREE.Scene) {
    scene.add(this.holder);
    for (const id of ['pistol', 'smg', 'shotgun', 'rifle'] as WeaponId[]) { const m = weaponMesh(id); m.visible = false; this.holder.add(m); this.models.set(id, m); }
  }
  get armed() { return !WEAPONS[this.inv.current].melee; }
  get aiming() { return this.ctl.aiming || this.hipAimT > 0; }
  /** Per-frame update (dt in game time). blocked: menus/wheel/vehicle. */
  update(dt: number, blocked: boolean, targets: () => Iterable<Character>, vehicles: () => Iterable<Vehicle>) {
    const c = this.player, h = c.human, inv = this.inv;
    if (inv.tick(dt)) { /* reload finished */ }
    this.hitMarker = Math.max(0, this.hitMarker - dt * 3);
    this.hipAimT = Math.max(0, this.hipAimT - dt);
    const def = inv.def;
    const onFoot = c.alive && !c.inVehicle;
    // weapon cycling
    if (!blocked && onFoot) {
      if (this.input.justPressed('nextWeapon')) { inv.cycle(1); this.audio.play('equip'); }
      if (this.input.justPressed('prevWeapon')) { inv.cycle(-1); this.audio.play('equip'); }
      if (this.input.justPressed('reload') && inv.startReload()) { h.playOnce('Pistol_Reload', 'upper', 0.1); this.audio.play('reload', { pos: c.pos }); }
    }
    // upper body pose
    if (onFoot) h.setUpperMode(this.armed ? (this.aiming ? 'pistol' : 'carry') : 'loco');
    this.spread = Math.max(0, this.spread - dt * 0.18);
    // aim point from the camera centre
    this.cam.aimRay(this.tmpO, this.tmpD);
    const camHit = this.physics.ray(this.tmpO.x, this.tmpO.y, this.tmpO.z, this.tmpD.x, this.tmpD.y, this.tmpD.z, 250, undefined, c.collider);
    this.aimPoint.copy(this.tmpO).addScaledVector(this.tmpD, camHit ? Math.max(camHit.toi, 2.5) : 250);
    // Fire
    const wantFire = !blocked && onFoot && (def.auto ? this.input.held('fire') : this.input.justPressed('fire'));
    if (wantFire) {
      if (!def.melee && inv.state.clip === 0) {
        if (this.input.justPressed('fire')) { this.audio.play('empty', { pos: c.pos }); if (inv.startReload()) { h.playOnce('Pistol_Reload', 'upper', 0.1); this.audio.play('reload', { pos: c.pos }); } }
      } else if (inv.fire()) {
        if (def.melee) {
          const anim = this.comboIdx++ % 2 === 0 ? 'Punch_Jab' : 'Punch_Cross';
          h.playOnce(anim, 'upper', 0.06);
          if (!this.ctl.aiming) c.yaw = this.cam.yaw + Math.PI;
          this.pendingMelee = 0.16;
        } else {
          if (!this.ctl.aiming) { this.hipAimT = 0.7; c.yaw = this.cam.yaw + Math.PI; }
          this.updateModel(); c.human.root.rotation.y = c.yaw;
          const o = this.muzzleWorld(new THREE.Vector3());
          const dir = this.aimPoint.clone().sub(o).normalize();
          const sp = (this.ctl.aiming ? def.aimSpread : def.spread) + this.spread + (c.speed > 1 ? 0.01 : 0);
          const hits = this.combat.shoot(c, def, o, dir, sp);
          if (hits.some(x => x.kind === 'character')) this.hitMarker = 1;
          this.spread = Math.min(0.08, this.spread + def.recoil * 0.4);
          this.cam.pitch += def.recoil * (0.7 + Math.random() * 0.4);
          this.cam.yaw += (Math.random() - 0.5) * def.recoil * 0.5;
          this.cam.addShake(def.shake);
          if (inv.state.clip === 0 && inv.reloading) { h.playOnce('Pistol_Reload', 'upper', 0.1); this.audio.play('reload', { pos: c.pos }); }
        }
      }
    }
    if (this.pendingMelee > 0) {
      this.pendingMelee -= dt;
      if (this.pendingMelee <= 0) { const hit = this.combat.melee(c, def, targets(), vehicles()); if (hit) { this.hitMarker = 1; this.cam.addShake(0.12); } }
    }
    this.updateModel();
  }
  muzzleWorld(out: THREE.Vector3) {
    const m = this.models.get(this.inv.current);
    if (!m || !m.visible) return out.set(this.player.pos.x, this.player.pos.y + 1.4, this.player.pos.z);
    return out.set(0, 0.07, MUZZLE[this.inv.current]).applyMatrix4(m.matrixWorld);
  }
  private updateModel() {
    const c = this.player;
    const show = this.armed && c.alive && !c.inVehicle;
    for (const [id, m] of this.models) m.visible = show && id === this.inv.current;
    if (!show) return;
    const m = this.models.get(this.inv.current)!;
    const hand = c.human.rightHand;
    c.human.root.updateMatrixWorld(true);
    hand.getWorldPosition(m.position);
    if (this.aiming) {
      m.lookAt(this.aimPoint);
      m.position.addScaledVector(new THREE.Vector3(0, 0, 1).applyQuaternion(m.quaternion), 0.04);
    } else {
      hand.getWorldQuaternion(m.quaternion); m.quaternion.multiply(HAND_FIX);
    }
    m.updateMatrixWorld(true);
  }
  give(id: WeaponId, ammo: number) { this.inv.give(id, ammo); }
}
