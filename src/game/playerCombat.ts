/**
 * The player's weapons: aiming, firing, recoil, spread, reloading, throwables, melee and the held weapon model.
 *
 * Aim pipeline (combat/aim.ts): the reticle is a dot at the screen centre. Every frame the camera's centre ray is traced
 * (through the world and people's bone capsules, ignoring the player) to find the aim point and whether a person is
 * under the dot (the dot turns red). A shot leaves the muzzle towards that aim point; spread is a cone around it, so
 * shots are always centred on the dot. Scoped rifles zoom the camera (mouse wheel steps the zoom).
 *
 * Gun feel model (numbers per weapon live in combat/weapons.ts):
 *  - Shot cone = base (hip `spread` / aimed `aimSpread`) x accuracy + bloom + movement.
 *  - Recoil kicks the camera up (plus a little random / drifting yaw) over ~2 frames and then smoothly returns most of
 *    it (`recoverFrac`), never pulling below where the burst started if the player already compensated.
 *  - The weapon model slides back and flips its muzzle, slides / pumps / bolts cycle, magazines drop out and go back in
 *    during reloads, and the torso leans back, all springing back within ~0.15 s.
 */
import { rumble } from '../core/haptics';
import * as THREE from 'three';
import { Inventory, WEAPONS, weaponMesh, weaponParts, type WeaponId, type WeaponDef, type WeaponParts } from '../combat/weapons';
import { muzzleWorld, weaponAnchors } from '../combat/weaponModels';
import { solveHold, makeHoldOut, onFootUpperMode, supportGripWeight } from '../combat/gunHold';
import type { Combat } from '../combat/combat';
import { aimSearchStart, shotDirection } from '../combat/aim';
import { type Character, meleeTargets, MELEE_POWER } from '../actors/character'; // [PEOPLE] melee strike targeting
import type { Input } from '../core/input';
import type { CameraRig } from './camera';
import type { PlayerController } from './player';
import { type Physics, groups, G_STATIC } from '../core/physics';
import type { GameAudio, HudState } from '../ui/contracts';
import type { AudioExtras, ExtraSfx } from '../audio/sfx';
import type { Vehicle } from '../vehicles/vehicle';

const HAND_FIX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
/** Reload foley timeline as fractions of the reload: [at, sound, only when reloading from empty]. */
const RELOAD_STEPS: Record<string, [number, ExtraSfx, boolean][]> = {
  pistolMag: [[0.06, 'magOut', false], [0.52, 'magIn', false], [0.84, 'slideRelease', true]],
  longMag: [[0.08, 'magOut', false], [0.55, 'magIn', false], [0.8, 'boltRack', true]],
  revolver: [[0.05, 'cylinderOpen', false], [0.62, 'magIn', false], [0.86, 'slideRelease', false]],
  break: [[0.06, 'cylinderOpen', false], [0.45, 'shellInsert', false], [0.6, 'shellInsert', false], [0.85, 'slideRelease', false]],
  belt: [[0.06, 'magOut', false], [0.3, 'cylinderOpen', false], [0.62, 'magIn', false], [0.86, 'boltRack', false]],
  single: [[0.1, 'magOut', false], [0.7, 'magIn', false]],
};
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _axis = new THREE.Vector3();
const _wn = new THREE.Vector3(), _gr = new THREE.Vector3();
const _sr = new THREE.Vector3(), _sl = new THREE.Vector3(), _lo = new THREE.Vector3(), _dir = new THREE.Vector3(), _a1 = new THREE.Vector3(), _a2 = new THREE.Vector3(), _qr = new THREE.Quaternion();
/** Rotates a bone about a world-space axis (applied after the animation mixer, so it never accumulates). */
function rotateBoneWorld(bone: THREE.Object3D, axis: THREE.Vector3, angle: number) {
  if (!bone.parent) return;
  bone.parent.getWorldQuaternion(_q);
  _axis.copy(axis).applyQuaternion(_q.invert());
  bone.quaternion.premultiply(_q2.setFromAxisAngle(_axis, angle));
  bone.updateMatrixWorld(true);
}
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/** Seconds the gun stays raised after firing from the hip. */
const HIP_HOLD = 1.6;
export class PlayerCombat {
  inv = new Inventory();
  private models = new Map<WeaponId, { g: THREE.Group; parts: WeaponParts }>();
  private holder = new THREE.Group();
  private comboIdx = 0;
  private pendingMelee = -1;
  hipAimT = 0;
  /** Current shot cone minus the weapon's base cone (legacy HUD value). */
  spread = 0;
  /** Current full shot cone (radius, radians-ish). */
  cone = 0;
  hitMarker = 0; killMarker = 0; headshotMarker = false;
  onKill: ((headshot: boolean) => void) | null = null;
  aimPoint = new THREE.Vector3();
  /** person under the reticle (alive), or null */
  aimTarget: Character | null = null;
  /** distance from the camera to the aim point */
  aimDist = 0;
  /** 0..1 how settled the aim is (1 = first-shot accuracy). */
  accuracy = 0;
  bloom = 0;
  /** scope zoom step (0 = widest) while aiming a scoped weapon */
  zoomStep = 0;
  private time = 0; lastShot = -10; private burst = 0;
  private pendingPitch = 0; private pendingYaw = 0; private pitchDebt = 0; private yawDebt = 0; private anchorPitch = 0;
  private kick = 0; private kickDef: WeaponDef = WEAPONS.fists;
  private wasReloading = false; private reloadStep = 0; private shellsSeen = 0;
  private acousticsT = 0;
  /** cycling (pump / bolt / slide lock) animation 0..1 and its kind */
  private cycleT = 0; private cycleKind: 'pump' | 'bolt' | null = null;
  private cookT = -1;
  /** gun-hold IK: blend 0..1 (0 = gun follows the animated hand, e.g. while reloading), raise 0..1 (0 = low ready) */
  private holdW = 0; private raiseT = 0; private holdDt = 1 / 60; private holdOut = makeHoldOut();
  private shR: THREE.Object3D | null = null; private shL: THREE.Object3D | null = null;
  private tmpO = new THREE.Vector3(); private tmpD = new THREE.Vector3(); private tmpV = new THREE.Vector3();
  private spine: THREE.Object3D | null = null;
  constructor(private player: Character, private ctl: PlayerController, private input: Input, private cam: CameraRig, private combat: Combat, private physics: Physics, private audio: GameAudio, scene: THREE.Scene) {
    scene.add(this.holder);
    combat.player = player;
    this.spine = player.human.spine ?? null;
  }
  get armed() { return !WEAPONS[this.inv.current].melee; }
  /** the last gun held that can be fired from a car seat (Round 7: aim in a car draws it) */
  lastCarGun: WeaponId | null = null;
  get aiming() { return this.ctl.aiming || this.hipAimT > 0 || this.driveAim; }
  /** Round 8: a gun really pointed at people: the aim button held (or drive-by), or a shot in the last 1.5 s. A reload or a
   * gun merely raised from the hip no longer counts (bystanders put their hands up for no reason). */
  get threatening() { return isThreatening(this.ctl.aiming, this.driveAim, this.time - this.lastShot); }
  /** R6-K drive-by: holding aim inside a car with a one-handed gun puts it out the window; fire then shoots along the camera aim point. */
  driveAim = false;
  private wasDriveAim = false; private wasMode = 'none';
  private rolled: { v: Vehicle; pane: number } | null = null;
  /** Side of the car (+1 left / -1 right) the camera aim point lies on. */
  driveSide(v: Vehicle) {
    const dx = this.aimPoint.x - v.position.x, dz = this.aimPoint.z - v.position.z;
    return dx * Math.cos(v.yaw) - dz * Math.sin(v.yaw) >= 0 ? 1 : -1;
  }
  /** Winds down the window on the aimed side while a drive-by aim is held, and winds it back up afterwards. */
  private driveWindow(v: Vehicle | null) {
    let want: { v: Vehicle; pane: number } | null = null;
    if (v && this.driveAim) { const d = v.doorIndex(this.driveSide(v) === 1 ? 'left' : 'right', 0); const pane = d >= 0 ? v.paneOfDoor(d) : -1; if (pane >= 0) want = { v, pane }; }
    const r = this.rolled;
    if (r && (!want || want.v !== r.v || want.pane !== r.pane)) { r.v.rollWindow(r.pane, false); this.rolled = null; }
    if (want) { want.v.rollWindow(want.pane, true); this.rolled = want; }
    if (!v) { this.lean = this.leanApplied = 0; return; } // left the car: the entry/exit animation owns the root again
    // lean toward the open window (far side: across the seat) so the arm reaches it
    // Round 8: lean right into the open window (it was 8 cm: the arm could not reach out and the gun stayed in the cabin)
    const tgt = this.driveAim ? driveLean(this.driveSide(v)) : 0;
    this.lean += (tgt - this.lean) * 0.25;
    const root = this.player.human.root, dl = this.lean - this.leanApplied;
    if (Math.abs(dl) > 1e-5 && root.parent) { root.position.x += dl; this.leanApplied = this.lean; }
  }
  private lean = 0; private leanApplied = 0; private bodyHidden = false;
  /** Drive-by hold: moves the gun so its grip sits in the open window (barrel out), within reach of the shoulder. */
  private driveHold(H: ReturnType<typeof makeHoldOut>, an: ReturnType<typeof weaponAnchors>, shoulder: THREE.Vector3, armLen: number) {
    const v = this.player.inVehicle as Vehicle; const side = this.driveSide(v);
    const di = v.doorIndex(side === 1 ? 'left' : 'right', 0); if (di < 0) return;
    const f = v.doorFrame(di);
    _wn.set(f.sg * (f.outX + 0.22), f.belt + 0.1, (f.z0 + f.z1) / 2); // grip well outside the door line: forearm out of the window
    v.visual.updateMatrixWorld(); v.visual.localToWorld(_wn);
    _gr.copy(an.grip).applyQuaternion(H.quat).add(H.pos);
    H.pos.add(_wn.sub(_gr));
    _gr.copy(an.grip).applyQuaternion(H.quat).add(H.pos); // new grip position
    const dist = _gr.distanceTo(shoulder), maxR = armLen * (an.butt ? 1.15 : 1.06);
    if (dist > maxR) H.pos.addScaledVector(_gr.sub(shoulder).normalize(), -(dist - maxR)); // far-side aim: the arm stretches over the dash
  }
  /** Aiming down a scope right now. */
  get scoped() { return this.ctl.aiming && this.inv.def.scope > 0 && !this.inv.reloading && this.player.alive && !this.player.inVehicle; }
  /** Vertical FOV of the scope (degrees) for the current zoom step. */
  get scopeFov() { const s = this.inv.def.scope; return s / (1 + this.zoomStep * (s < 16 ? 1.2 : 0.8)); }
  /** Mouse-look sensitivity multiplier (slower when aiming, much slower through a scope). */
  get lookScale() { return this.scoped ? Math.max(0.12, this.scopeFov / 62) : this.aiming ? 0.6 : 1; }
  private get ax(): Partial<AudioExtras> { return this.audio as GameAudio & Partial<AudioExtras>; }
  private foley(name: ExtraSfx, volume = 1) {
    const c = this.player, pitch = 0.97 + Math.random() * 0.06;
    if (this.ax.playExtra) this.ax.playExtra(name, { pos: c.pos, volume, pitch });
    else if (name === 'magIn' || name === 'shellInsert') this.audio.play('reload', { pos: c.pos, volume: 0.5 });
  }
  private model(id: WeaponId) {
    let m = this.models.get(id);
    if (!m) { const g = weaponMesh(id); g.visible = false; this.holder.add(g); m = { g, parts: weaponParts(g) }; this.models.set(id, m); }
    return m;
  }
  /** Legacy HUD crosshair size (the dot reticle no longer grows; kept for compatibility). */
  hudSpread(fovDeg: number, viewportPx: number): number {
    const px = this.cone / Math.tan(fovDeg * Math.PI / 360) * viewportPx / 2;
    return Math.min(1.5, Math.max(0, (px - 5) / 30));
  }
  /** Reticle / weapon part of the HUD state. */
  hud(): Pick<HudState, 'crosshair' | 'crosshairSpread' | 'reloadProgress' | 'reticleHot' | 'hitMarker' | 'killMarker' | 'headshotMarker' | 'scopeZoom' | 'ammoClip' | 'ammoReserve'> {
    const def = this.inv.def, st = this.inv.state, c = this.player;
    const show = c.alive && (!c.inVehicle || this.driveAim);
    const throwable = def.cat === 'throw';
    return {
      crosshair: !show ? 'none' : this.scoped ? 'scope' : this.armed || this.aiming ? (this.aiming ? 'aim' : 'dot') : 'none',
      crosshairSpread: show && !def.melee && !throwable ? Math.min(1, Math.max(0, this.cone * 14)) : 0,
      reloadProgress: this.inv.reloading ? this.inv.reloadProgress : 0,
      reticleHot: !!this.aimTarget && show, hitMarker: this.hitMarker, killMarker: this.killMarker, headshotMarker: this.headshotMarker,
      scopeZoom: this.scoped ? Math.round(62 / this.scopeFov * 10) / 10 : 0,
      ammoClip: def.melee ? -1 : throwable ? this.inv.total() : st.clip, ammoReserve: throwable ? 0 : st.reserve,
    };
  }
  /** Per-frame update (dt in game time). blocked: menus/wheel/vehicle. */
  update(dt: number, blocked: boolean, targets: () => Iterable<Character>, vehicles: () => Iterable<Vehicle>) {
    const c = this.player, h = c.human, inv = this.inv;
    this.combat.people = targets; this.combat.vehicles = vehicles;
    this.cam.camera.getWorldPosition(this.combat.listener);
    this.time += dt;
    const done = inv.tick(dt);
    const def = inv.def;
    this.reloadFoley(def, done);
    this.hitMarker = Math.max(0, this.hitMarker - dt * 3.2);
    this.killMarker = Math.max(0, this.killMarker - dt * 1.4);
    // Keep the weapon raised while the trigger is held (or the gun is mid-reload) and ~1.6 s after the last shot, so it never dips between rounds.
    if (!blocked && !inv.def.melee && inv.def.cat !== 'throw' && (this.input.held('fire') || inv.reloading) && c.alive && !c.inVehicle) this.hipAimT = Math.max(this.hipAimT, HIP_HOLD);
    this.hipAimT = Math.max(0, this.hipAimT - dt);
    const onFoot = c.alive && !c.inVehicle;
    // camera jammed against the head (tight alley, wall behind): hide the body rather than show the inside of the head
    if (this.cam.hideBody && onFoot) { if (!this.bodyHidden) { this.bodyHidden = true; h.root.visible = false; } }
    else if (this.bodyHidden) { this.bodyHidden = false; h.root.visible = true; }
    const veh = c.inVehicle as Vehicle | null;
    const inCar = c.alive && !!veh && typeof veh.kind === 'string' && veh.kind !== 'tank';
    // Round 7: aiming in a car with fists or a heavy weapon out draws the last gun you used (that works from a seat)
    if (inCar && !blocked && this.input.held('aim') && (inv.def.melee || inv.def.cat === 'heavy')) { // throwables are thrown from the window as before
      const g = this.lastCarGun && inv.weapons[this.lastCarGun] ? this.lastCarGun : (['pistol', 'smg', 'shotgun', 'rifle'] as const).map(c => inv.categoryPick(c)).find(Boolean);
      if (g) inv.select(g);
    }
    if (!inv.def.melee && inv.def.cat !== 'heavy' && inv.def.cat !== 'throw') this.lastCarGun = inv.current;
    const def0 = inv.def;
    this.driveAim = inCar && !blocked && this.input.held('aim') && !def0.melee && def0.cat !== 'heavy';
    const mode = this.driveAim ? (def0.cat === 'pistol' || def0.cat === 'smg' ? 'pistol' : def0.cat === 'throw' ? 'none' : 'rifle') : 'none';
    if (inCar && (this.driveAim !== this.wasDriveAim || mode !== this.wasMode)) h.setUpperMode(mode);
    this.wasDriveAim = this.driveAim; this.wasMode = mode;
    this.driveWindow(inCar ? veh : null);
    if (this.driveAim && this.input.justPressed('reload')) inv.startReload();
    // Gun up from the hip (fire without the aim button): the body must keep facing the camera line, not the run direction.
    this.ctl.hipRaised = onFoot && this.armed && this.hipAimT > 0 && !inv.def.melee && inv.def.cat !== 'throw';
    // weapon cycling (the mouse wheel zooms instead while looking through a scope)
    if (!blocked && onFoot) {
      if (this.scoped) {
        const steps = def.scope < 16 ? 3 : 2;
        if (this.input.justPressed('nextWeapon')) this.zoomStep = Math.max(0, this.zoomStep - 1);
        if (this.input.justPressed('prevWeapon')) this.zoomStep = Math.min(steps - 1, this.zoomStep + 1);
      } else {
        if (this.input.justPressed('nextWeapon')) this.switchTo(1);
        if (this.input.justPressed('prevWeapon')) this.switchTo(-1);
      }
      if (this.input.justPressed('reload')) inv.startReload();
    }
    this.cam.scopeFov = this.scoped ? this.scopeFov : null;
    // upper body pose
    if (onFoot) h.setUpperMode(onFootUpperMode(this.armed, this.aiming, def.twoHanded));
    this.updateSpread(dt, def);
    this.updateRecoil(dt, def);
    if (needsAimTrace(!!c.inVehicle, this.driveAim, c.alive)) this.updateAim(onFoot); else this.aimTarget = null; // seated without drive-by aim: nothing reads the aim ray
    // Fire
    if (!blocked && (onFoot || this.driveAim)) {
      if (def.cat === 'throw') this.updateThrow(dt, def);
      else {
        const pressed = this.input.justPressed('fire');
        if (pressed) inv.pull();
        const wantFire = def.auto || inv.burstLeft > 0 ? this.input.held('fire') || pressed || inv.burstLeft > 0 : pressed; // a tap shorter than a frame still fires once
        if (wantFire) {
          if (!def.melee && inv.state.clip === 0) {
            if (pressed && !inv.reloading) { this.audio.play('empty', { pos: c.pos }); inv.startReload(); }
          } else if (inv.fire()) {
            if (def.melee) this.startMelee(def);
            else this.fireRanged(def);
          }
        }
      }
    } else this.cookT = -1;
    this.meleeWho = targets; this.meleeCars = vehicles; // [PEOPLE] used at the melee strike frame
    if (this.pendingMelee > 0) {
      this.pendingMelee -= dt;
      if (this.pendingMelee <= 0) { const hit = this.combat.melee(c, def, targets(), vehicles()); if (hit) { this.hitMarker = 1; if (!hit.alive) { this.killMarker = 1; this.headshotMarker = false; this.onKill?.(false); } this.cam.addShake(def.id === 'bat' ? 0.2 : 0.12); this.kick = 1; } }
    }
    // reload animation on any reload start (manual, empty click or automatic after the last round)
    if (inv.reloading && !this.wasReloading) { h.playOnce('Pistol_Reload', 'upper', 0.1, { rate: Math.min(1.6, Math.max(0.6, 1.8 / Math.max(0.6, inv.reloadDur))) }); this.reloadStep = 0; this.shellsSeen = inv.shellsLoaded; }
    this.wasReloading = inv.reloading;
    this.kick *= Math.exp(-this.kickDef.kickRate * dt);
    this.cycleT = Math.max(0, this.cycleT - dt);
    this.holdDt = dt;
    this.updateModel(true);
    this.probeAcoustics(dt);
  }
  private switchTo(dir: 1 | -1) { const before = this.inv.current; this.inv.cycle(dir); if (this.inv.current !== before) { this.audio.play('equip'); this.zoomStep = 0; } }

  /** Traces the camera's centre ray: aim point, aim distance and the person under the reticle. */
  private updateAim(onFoot: boolean) {
    const c = this.player;
    this.cam.aimRay(this.tmpO, this.tmpD);
    const chest = this.tmpV.set(c.pos.x, c.pos.y + 1.35, c.pos.z);
    const start = onFoot ? aimSearchStart(this.tmpO, this.tmpD, chest) : 0;
    const o = this.tmpO.clone().addScaledVector(this.tmpD, start);
    const range = 400;
    const tr = this.combat.trace(o, this.tmpD, range, c, { dry: true, excludeVehicle: c.inVehicle as Vehicle | null });
    this.aimPoint.copy(tr.point);
    this.aimDist = start + tr.t;
    this.aimTarget = tr.kind === 'character' && tr.character?.alive && this.aimDist < Math.max(60, this.inv.def.range) ? tr.character : null;
  }

  private fireRanged(def: WeaponDef) {
    const c = this.player;
    if (!this.ctl.aiming && !this.driveAim) { this.hipAimT = HIP_HOLD; c.yaw = this.cam.yaw + Math.PI; }
    if (!this.driveAim) c.human.root.rotation.y = c.yaw; // seated in a car the body keeps its seat pose
    this.updateModel();
    const o = this.safeMuzzle(new THREE.Vector3());
    const dir = shotDirection(o, this.aimPoint, this.tmpD, new THREE.Vector3()) as THREE.Vector3;
    const veh = this.driveAim ? c.inVehicle as Vehicle : null;
    const hits = this.combat.shoot(c, def, o, dir, this.cone + (veh ? Math.min(0.05, Math.abs(veh.speed) * 0.0015) : 0), veh);
    for (const x of hits) if (x.kind === 'character') { this.hitMarker = 1; if (x.killed) { this.killMarker = 1; this.headshotMarker = !!x.headshot; this.onKill?.(!!x.headshot); } }
    if (def.mode === 'pump' || def.mode === 'bolt') { this.cycleKind = def.mode; setCycle(this, def); }
    // bloom / accuracy
    const fresh = this.time - this.lastShot > Math.max(0.35, def.interval * 2.5);
    this.burst = fresh ? 1 : this.burst + 1;
    this.bloom = Math.min(def.bloomMax, this.bloom + def.bloom * (this.ctl.aiming ? 1 : 1.35));
    this.accuracy *= 0.3;
    this.lastShot = this.time;
    // camera recoil: applied over ~2 frames, most of it recovers once you stop
    if (fresh) { this.anchorPitch = this.cam.pitch; this.pitchDebt = 0; this.yawDebt = 0; }
    const ramp = def.auto ? Math.min(1.25, 0.85 + this.burst * 0.06) : 1;
    const scopeK = this.scoped ? 0.6 : 1;
    const kp = def.kickPitch * (0.85 + Math.random() * 0.3) * ramp * (this.ctl.aiming ? 1 : 1.2) * scopeK;
    const ky = ((Math.random() * 2 - 1) * def.kickYaw + def.kickDrift * Math.min(1, this.burst / 4)) * scopeK;
    this.pendingPitch += kp; this.pitchDebt += kp * def.recoverFrac;
    this.pendingYaw += ky; this.yawDebt += ky * 0.5;
    this.cam.addShake(def.shake, true);
    rumble(Math.min(0.6, 0.16 + def.shake * 0.9), 55); // light tap per shot; the cooldown keeps full-auto from buzzing
    // weapon / body kick
    this.kickDef = def; this.kick = Math.min(1.4, this.kick + 1);
  }
  /** Muzzle position; pulled back to the chest side of any wall the barrel pokes through (so close cover can't eat shots). */
  private safeMuzzle(out: THREE.Vector3) {
    const c = this.player; this.muzzleWorld(out);
    const cx = c.pos.x, cy = c.pos.y + 1.4, cz = c.pos.z;
    const dx = out.x - cx, dy = out.y - cy, dz = out.z - cz, len = Math.hypot(dx, dy, dz);
    if (len > 0.05) {
      const hit = this.physics.ray(cx, cy, cz, dx / len, dy / len, dz / len, len, groups(0xffff, G_STATIC | 0x0002), c.collider, (c.inVehicle as Vehicle | null)?.phys.body ?? null);
      if (hit) out.set(cx + dx / len * Math.max(0, hit.toi - 0.06), cy + dy / len * Math.max(0, hit.toi - 0.06), cz + dz / len * Math.max(0, hit.toi - 0.06));
    }
    return out;
  }

  /** Throwables: press to pull the pin (a frag cooks while held), release to throw; longer holds throw further. */
  private updateThrow(dt: number, def: WeaponDef) {
    const inv = this.inv, c = this.player;
    if (this.input.justPressed('fire') && this.cookT < 0 && inv.canFire()) { this.cookT = 0; if (def.id === 'grenade') this.foley('pinPull', 0.8); c.human.playOnce('Punch_Cross', 'upper', 0.12, { from: 0, to: 0.18, rate: 0.6 }); }
    if (this.cookT >= 0) {
      this.cookT += dt;
      const release = !this.input.held('fire') || (def.id === 'grenade' && this.cookT > 3);
      if (release && inv.fire()) {
        if (!this.ctl.aiming && !this.driveAim) { this.hipAimT = 0.5; c.yaw = this.cam.yaw + Math.PI; }
        const power = 0.7 + Math.min(0.6, this.cookT * 0.6);
        const hand = c.human.rightHand.getWorldPosition(new THREE.Vector3()); hand.y += 0.25;
        const dir = this.aimPoint.clone().sub(hand).normalize(); if (dir.lengthSq() < 0.5) dir.copy(this.tmpD);
        this.combat.launch(c, def, hand, dir, 0, power);
        if (def.id === 'grenade') this.combat.cookFuse(this.cookT);
        c.human.playOnce('Punch_Cross', 'upper', 0.05, { rate: 1.4 });
        this.audio.play('whoosh', { pos: c.pos, volume: 0.5, pitch: 1.4 });
        this.combat.onShot?.({ shooter: c, weapon: def, origin: hand, hits: [] });
        this.cookT = -1;
        if (inv.total() === 0) inv.cycle(-1);
      }
    }
  }

  /**
   * [PEOPLE] MELEE: a real move (wind-up, strike, recover; fists chain jab -> cross -> hook on quick presses).
   * Damage is dealt only at the strike frame (Character.onMeleeStrike), to the nearest person within ~1.2 m in front
   * (bat/knife reach a little further); the victim flinches, staggers or is knocked down (hook, bat).
   */
  private startMelee(def: WeaponDef) {
    const c = this.player;
    if (!this.ctl.aiming) c.yaw = this.cam.yaw + Math.PI;
    c.onMeleeStrike = kind => {
      const reach = def.id === 'bat' ? 1.9 : def.id === 'knife' ? 1.4 : 1.25;
      const near = meleeTargets(c, this.meleeWho?.() ?? [], reach);
      const hit = this.combat.melee(c, def, near.slice(0, 1), near.length ? [] : this.meleeCars?.() ?? []);
      if (!hit) return;
      this.hitMarker = 1; if (!hit.alive) { this.killMarker = 1; this.headshotMarker = false; this.onKill?.(false); }
      this.cam.addShake(def.id === 'bat' ? 0.2 : kind === 'hook' ? 0.16 : 0.1); this.kick = 1;
      hit.vel.x = 0; hit.vel.z = 0; // the reaction below sets the push (a punch moves people a step, not metres)
      if (hit.alive) hit.hitReact(hit.pos.x - c.pos.x, hit.pos.z - c.pos.z, MELEE_POWER[kind]);
    };
    if (c.startMelee(def.id === 'bat' ? 'bat' : def.id === 'knife' ? 'knife' : 'fists')) { this.kickDef = def; this.kick = 0.3; }
  }
  private meleeWho: (() => Iterable<Character>) | null = null;
  private meleeCars: (() => Iterable<Vehicle>) | null = null;

  private updateSpread(dt: number, def: WeaponDef) {
    const c = this.player, aimed = this.ctl.aiming || this.driveAim;
    const still = c.speed < 0.6 && c.grounded;
    if (aimed && still && this.time - this.lastShot > def.interval * 1.3) this.accuracy = Math.min(1, this.accuracy + dt / 0.3);
    else if (!still || !this.aiming) this.accuracy = Math.max(0, this.accuracy - dt * 4);
    if (this.time - this.lastShot > def.bloomDelay) this.bloom *= Math.exp(-def.bloomRecover * dt);
    if (this.bloom < 1e-4) this.bloom = 0;
    const move = Math.min(1.4, c.speed / 4.1) * def.movePenalty + (c.grounded ? 0 : def.movePenalty * 1.5 + 0.02 * (def.melee ? 0 : 1));
    const base = this.scoped ? def.aimSpread * 0.5 : aimed ? def.aimSpread : def.spread;
    this.cone = def.melee || def.cat === 'throw' ? 0 : base * (1 - this.accuracy * (1 - def.firstShot)) + this.bloom + move;
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
      if (done && inv.reloadFromEmpty) { this.foley('pump', 0.8); this.cycleKind = 'pump'; this.cycleT = 0.001; setCycle(this, def); }
      return;
    }
    const key = def.reloadKind === 'mag' ? (def.twoHanded ? 'longMag' : 'pistolMag') : def.reloadKind;
    const steps = RELOAD_STEPS[key];
    if (!steps || !inv.reloading) return;
    const p = inv.reloadProgress;
    while (this.reloadStep < steps.length && p >= steps[this.reloadStep][0]) {
      const [, snd, emptyOnly] = steps[this.reloadStep++];
      if (!emptyOnly || inv.reloadFromEmpty) this.foley(snd);
    }
  }
  /** internal: starts the pump / bolt cycle animation (set via setCycle so the timing is shared with reloads) */
  _cycle(dur: number) { this.cycleT = dur; }

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
    const id = this.inv.current; const m = WEAPONS[id].melee ? null : this.model(id);
    if (!m || !m.g.visible) return out.set(this.player.pos.x, this.player.pos.y + 1.4, this.player.pos.z);
    return muzzleWorld(m.g, out);
  }
  /** Places the held weapon and animates its parts; `final` (once per frame, after everything else) also applies the torso kick. */
  private updateModel(final = false) {
    const c = this.player, inv = this.inv, def = inv.def;
    const onFoot = c.alive && (!c.inVehicle || this.driveAim);
    const thrownAway = def.cat === 'throw' && (inv.state.clip === 0 || inv.reloading);
    const show = !(def.id === 'fists') && onFoot && !thrownAway && !this.scoped;
    for (const [id, m] of this.models) m.g.visible = show && id === inv.current;
    const k = this.kick, kd = this.kickDef;
    c.human.root.updateMatrixWorld(true);
    if (final && onFoot && k > 0.002 && kd.kickBody > 0 && this.spine) {
      _axis.set(Math.cos(c.yaw), 0, -Math.sin(c.yaw));
      rotateBoneWorld(this.spine, _axis, -k * kd.kickBody);
    }
    if (def.id === 'fists' || !onFoot) return;
    const { g: m, parts } = this.model(def.id);
    if (this.scoped) { m.visible = false; }
    const hand = c.human.rightHand;
    const ranged = !def.melee && def.cat !== 'throw';
    // 1) the gun as the animation holds it (follows the right hand bone)
    hand.getWorldPosition(m.position); hand.getWorldQuaternion(m.quaternion); m.quaternion.multiply(HAND_FIX);
    // 2) the gun as it should be held: seated on the shoulder / out in front on the aim line; hands follow it
    const wantW = ranged && !this.scoped && !inv.reloading ? 1 : 0;
    const dt = this.holdDt, k1 = dt === 0 ? 1 : 1 - Math.exp(-dt * 12);
    this.holdW += (wantW - this.holdW) * k1;
    this.raiseT += ((this.aiming ? 1 : 0) - this.raiseT) * (dt === 0 ? 1 : 1 - Math.exp(-dt * 9));
    this.shR ??= c.human.model.getObjectByName('DEF-upper_armR') ?? null; this.shL ??= c.human.model.getObjectByName('DEF-upper_armL') ?? null;
    const hold = this.holdW > 0.002 && ranged && this.shR && this.shL;
    if (hold) {
      const H = this.holdOut, an = weaponAnchors(m), long = !!an.butt;
      this.shR!.getWorldPosition(_sr); this.shL!.getWorldPosition(_sl);
      // aim direction: shoulder -> aim point when raised, else the body forward pitched down (low ready)
      const lowPitch = long ? 0.85 : 0.3;
      _lo.set(Math.sin(c.yaw) * Math.cos(lowPitch), -Math.sin(lowPitch), Math.cos(c.yaw) * Math.cos(lowPitch));
      _dir.copy(this.aimPoint).sub(_sr); if (_dir.lengthSq() < 1.2) _dir.copy(this.tmpD); _dir.normalize();
      _dir.lerp(_lo, 1 - smooth(0, 1, this.raiseT)).normalize();
      c.human.rightHand.parent!.getWorldPosition(_a1); c.human.rightHand.getWorldPosition(_a2);
      const oneHand = this.driveAim && (def.cat === 'pistol' || def.cat === 'smg');
      solveHold({ shR: _sr, shL: _sl, armLen: _sr.distanceTo(_a1) + _a1.distanceTo(_a2), dir: _dir, anchors: oneHand ? { ...an, butt: null, support: null } : an, supportHand: !oneHand && this.raiseT > 0.4, raise: this.raiseT }, H);
      if (this.driveAim) this.driveHold(H, an, _sr, _sr.distanceTo(_a1) + _a1.distanceTo(_a2));
      const w = this.holdW;
      m.position.lerp(H.pos, w); m.quaternion.slerp(H.quat, w);
    }
    if (this.aiming && ranged && !hold) {
      m.lookAt(this.aimPoint);
      if (m.position.distanceToSquared(this.aimPoint) < 1) m.quaternion.setFromEuler(new THREE.Euler(-this.cam.pitch, this.cam.yaw + Math.PI, 0, 'YXZ'));
    }
    if (k > 0.002 && this.aiming && ranged) {
      m.position.addScaledVector(_dir.set(0, 0, 1).applyQuaternion(m.quaternion), -k * kd.kickBack);
      m.rotateX(-k * kd.kickFlip);
    }
    // reload: the gun rolls and dips while the magazine comes out and goes back in
    const rp = inv.reloading ? inv.reloadProgress : 0;
    if (inv.reloading && def.shellReload === 0) {
      const tilt = smooth(0, 0.12, rp) * (1 - smooth(0.82, 1, rp));
      m.rotateZ(-0.55 * tilt); m.rotateX(0.35 * tilt);
    }
    animateParts(parts, def, inv.reloading ? rp : -1, k, this.cycleKind ? 1 - this.cycleT / cycleDur(def) : -1, inv.state.clip === 0 && !inv.reloading);
    if (this.cycleT <= 0) this.cycleKind = null;
    m.updateMatrixWorld(true);
    if (final) c.human.trigger = k > 0.3 ? 1 : 0;
    if (final && hold) { // hands onto the gun as it ended up (recoil, reload tilt and pump included)
      const an = weaponAnchors(m), H = this.holdOut, w = this.holdW, h = c.human;
      _a1.copy(an.grip).add(_a2.set(-0.017, 0, 0)); H.rPalm.copy(_a1).applyMatrix4(m.matrixWorld);
      h.gripSolve('R', H.rPalm, _q.copy(m.quaternion).multiply(_qr.copy(H.quat).invert().multiply(H.rQuat)), w);
      if (H.hasLeft) {
        if (an.support && parts.pump) { _a1.copy(an.support); _a1.z += parts.pump.position.z - ((parts.pump.userData.rest as THREE.Vector3 | undefined)?.z ?? parts.pump.position.z); H.lPalm.copy(_a1).applyMatrix4(m.matrixWorld); }
        else if (an.support) H.lPalm.copy(an.support).applyMatrix4(m.matrixWorld);
        else { _a1.copy(an.grip).add(_a2.set(0.017, -0.012, 0.012)); H.lPalm.copy(_a1).applyMatrix4(m.matrixWorld); }
        h.gripSolve('L', H.lPalm, _q.copy(m.quaternion).multiply(_qr.copy(H.quat).invert().multiply(H.lQuat)), w * supportGripWeight(!!an.butt, this.raiseT));
      }
    }
  }
  give(id: WeaponId, ammo: number) { this.inv.give(id, ammo); }
}

const cycleDur = (def: WeaponDef) => (def.mode === 'bolt' ? 0.85 : 0.5);
function setCycle(pc: PlayerCombat, def: WeaponDef) { pc._cycle(cycleDur(def)); }

/**
 * Moves magazine / slide / pump / bolt. `rp` = reload progress (-1 = not reloading), `kick` = firing kick 0..1.4,
 * `cyc` = pump/bolt cycle progress 0..1 (-1 = none), `locked` = slide locked back on empty.
 */
function animateParts(p: WeaponParts, def: WeaponDef, rp: number, kick: number, cyc: number, locked: boolean) {
  const reset = (o: THREE.Object3D | null) => { if (!o) return; const r = o.userData.rest as THREE.Vector3 | undefined; const rr = o.userData.restRot as THREE.Euler | undefined; if (r) o.position.copy(r); if (rr) o.rotation.copy(rr); o.visible = true; };
  reset(p.mag); reset(p.slide); reset(p.pump); reset(p.bolt);
  // slide blowback on each shot, locked back when empty (pistols); revolver cylinder swings out on reload
  if (p.slide) {
    if (def.reloadKind === 'revolver') {
      if (rp >= 0) { const out = smooth(0.02, 0.15, rp) * (1 - smooth(0.78, 0.92, rp)); p.slide.position.x -= 0.03 * out; p.slide.rotation.z = -0.4 * out; }
    } else p.slide.position.z -= Math.min(0.028, kick * 0.02 + (locked || (rp >= 0 && rp < 0.8 && def.reloadKind === 'mag') ? 0.022 : 0));
  }
  if (p.mag && rp >= 0 && (def.reloadKind === 'mag' || def.reloadKind === 'belt' || def.reloadKind === 'single')) {
    // out: drop down out of the well; gone while the hand fetches a new one; in: slide back up and seat
    const out = smooth(0.06, 0.3, rp), back = smooth(0.42, 0.58, rp);
    const off = def.reloadKind === 'single' ? new THREE.Vector3(0, 0, 0.25) : new THREE.Vector3(0, -0.22, -0.03);
    const t = back > 0 ? 1 - back : out;
    p.mag.position.addScaledVector(off, t);
    p.mag.visible = !(rp > 0.3 && rp < 0.42);
  }
  if (p.pump && cyc >= 0) { const s = Math.sin(Math.min(1, cyc) * Math.PI); p.pump.position.z -= 0.085 * s; }
  if (p.bolt && cyc >= 0) {
    const u = smooth(0, 0.2, cyc) * (1 - smooth(0.8, 1, cyc)), b = smooth(0.2, 0.45, cyc) * (1 - smooth(0.55, 0.8, cyc));
    p.bolt.rotation.z = 1.1 * u; p.bolt.position.z -= 0.07 * b;
  }
}

/** Pure (tests): see PlayerCombat.threatening. */
/** The per-frame dry aim trace is only needed on foot or while aiming from a car window; skipping it saves the vehicle glass ray tests. */
export function needsAimTrace(inVehicle: boolean, driveAim: boolean, alive: boolean): boolean { return !alive || !inVehicle || driveAim; }

export function isThreatening(aimHeld: boolean, driveAim: boolean, sinceShot: number): boolean { return aimHeld || driveAim || sinceShot < 1.5; }

/** Round 8: how far (m, car-local x, + = left) the driver leans for a drive-by: well into the near window, or across the seat. Pure. */
export function driveLean(side: number): number { return side === 1 ? 0.32 : -0.4; }
