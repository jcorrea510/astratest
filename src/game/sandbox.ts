/** The game is a sandbox: free roam with a tools panel in the pause menu (spawn cars, set the clock, wanted level, teleport...). */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI, SandboxAction } from '../ui/contracts';
import { WEAPONS, WEAPON_ORDER } from '../combat/weapons';
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import { PLACES } from './places';
import type { SandboxTools } from './save';
import type { UnitKind } from './dispatch';
import { START_CASH, canUseSandbox, type GameMode } from './modes';

const UNITS: { value: UnitKind; label: string }[] = [{ value: 'police', label: 'Police cruiser' }, { value: 'fbi', label: 'FBI SUV' }, { value: 'swat', label: 'SWAT van' }, { value: 'army', label: 'Army truck' }, { value: 'tank', label: 'Tank' }];

const KINDS: { value: VehicleKind; label: string }[] = (Object.keys(VEHICLES) as VehicleKind[]).map(k => ({ value: k, label: VEHICLES[k].name }));
const SPOTS: { value: string; label: string; x: number; z: number; y?: number }[] = [
  { value: 'safehouse', label: 'Lantern Ave apartment', x: PLACES.safehouse.x + 4, z: PLACES.safehouse.z },
  { value: 'midtown', label: 'Midtown plaza', x: -200, z: 150 },
  { value: 'heights', label: 'Meridian Heights', x: 95, z: -150 },
  { value: 'park', label: 'Juniper Park', x: 100, z: -350 },
  { value: 'pier', label: 'Pier 9 (Ferris wheel)', x: -50, z: 945, y: 1.3 },
  { value: 'beach', label: 'Strand beach', x: 150, z: 425 },
  { value: 'docks', label: 'Cannery docks', x: 470, z: 150 },
  { value: 'hillside', label: 'Hillside lookout', x: 380, z: -150 },
  { value: 'race', label: 'Coastal Drive start line', x: -436, z: 403.5 },
];

export class Sandbox {
  god = false; infiniteAmmo = false; neverWanted = false; clockRunning = true;
  private unit: UnitKind = 'police';
  private kind: VehicleKind = 'coupe'; private spot = 'pier';
  open = false;
  constructor(private game: Game, private ui: GameUI) {
  }
  /** A fresh game. Regular: small cash, no weapons, nothing but fists. Sandbox: more cash and a pistol in the pocket. Always holstered. */
  setup(mode: GameMode = 'sandbox') {
    const g = this.game;
    g.mode = mode;
    g.money = START_CASH[mode]; g.hour = 18.2; g.player.armor = 0;
    g.pcombat.inv.strip();
    if (mode === 'sandbox') { g.pcombat.give('pistol', WEAPONS.pistol.clip * 3); g.pcombat.inv.medkits = 1; }
    g.pcombat.inv.holster();
    this.applyCaps();
  }
  get enabled() { return canUseSandbox(this.game.mode); }
  applyCaps() { this.game.clockRunning = this.clockRunning; }
  /** Every weapon incl. melee and throwables, with plenty of ammo. */
  arsenal() {
    if (!this.enabled) return;
    const g = this.game;
    for (const id of WEAPON_ORDER) g.pcombat.give(id, WEAPONS[id].clip * 6 + (WEAPONS[id].cat === 'throw' ? 4 : 0));
    g.pcombat.inv.medkits = Math.max(g.pcombat.inv.medkits, 5);
  }
  tools(): SandboxTools { return { god: this.god, ammo: this.infiniteAmmo, never: this.neverWanted, clock: this.clockRunning }; }
  loadTools(t: SandboxTools | undefined) {
    if (!t || !this.enabled) return;
    this.god = t.god; this.infiniteAmmo = t.ammo; this.neverWanted = t.never; this.clockRunning = t.clock;
    this.game.police.ignoring = this.neverWanted;
    this.applyCaps();
  }
  actions(): SandboxAction[] {
    const g = this.game;
    return [
      { id: 'god', group: 'Player', label: 'Invincible', kind: 'toggle', value: this.god },
      { id: 'ammo', group: 'Player', label: 'Infinite ammo', kind: 'toggle', value: this.infiniteAmmo },
      { id: 'heal', group: 'Player', label: 'Full health and armor', kind: 'button' },
      { id: 'cash', group: 'Player', label: 'Add $10,000', detail: `$${g.money.toLocaleString('en-US')}`, kind: 'button' },
      { id: 'arsenal', group: 'Player', label: 'Give every weapon', kind: 'button' },
      { id: 'heat', group: 'Police', label: 'Wanted level', kind: 'slider', value: g.police.heat, min: 0, max: 5, step: 1 },
      { id: 'unit', group: 'Police', label: 'Unit type', kind: 'select', value: this.unit, options: UNITS },
      { id: 'spawnUnit', group: 'Police', label: 'Spawn police unit', kind: 'button' },
      { id: 'heli', group: 'Police', label: 'Spawn helicopter', kind: 'button' },
      { id: 'armyheli', group: 'Police', label: 'Spawn army gunship', kind: 'button' },
      { id: 'never', group: 'Police', label: 'Police ignore you', detail: 'Cops, soldiers, base guards and gunships leave you alone', kind: 'toggle', value: this.neverWanted },
      { id: 'hour', group: 'World', label: 'Time of day', kind: 'slider', value: Math.round(g.hour * 4) / 4, min: 0, max: 23.75, step: 0.25 },
      { id: 'clock', group: 'World', label: 'Clock running', kind: 'toggle', value: this.clockRunning },
      { id: 'kind', group: 'Vehicles', label: 'Model', kind: 'select', value: this.kind, options: KINDS },
      { id: 'spawn', group: 'Vehicles', label: 'Spawn in front of me', kind: 'button' },
      { id: 'repair', group: 'Vehicles', label: 'Repair my vehicle', kind: 'button' },
      { id: 'spot', group: 'Teleport', label: 'Destination', kind: 'select', value: this.spot, options: SPOTS.map(s => ({ value: s.value, label: s.label })) },
      { id: 'go', group: 'Teleport', label: 'Teleport', kind: 'button' },
    ];
  }
  openPanel(onClose: () => void) {
    if (!this.enabled) { onClose(); return; } // Regular mode: no tools panel
    this.open = true;
    // sliders are not re-rendered while dragging (rebuilding the panel would drop the drag)
    this.ui.openSandbox(this.actions(), (id, v) => { this.act(id, v); if (this.actions().find(a => a.id === id)?.kind !== 'slider') this.ui.refreshSandbox(this.actions()); }, () => { this.open = false; onClose(); });
  }
  act(id: string, v?: number | string | boolean) {
    if (!this.enabled) return; // Regular mode: no cheats, whatever calls this
    const g = this.game, num = Number(v);
    switch (id) {
      case 'god': this.god = !!v; break;
      case 'ammo': this.infiniteAmmo = !!v; break;
      case 'heal': g.player.health = g.player.maxHealth; g.player.armor = 100; break;
      case 'cash': g.addMoney(10000); break;
      case 'arsenal': this.arsenal(); break;
      case 'heat': if (Number.isFinite(num)) g.police.setHeat(Math.round(num), g.player.pos); break;
      case 'unit': if (UNITS.some(u => u.value === v)) this.unit = v as UnitKind; break;
      case 'spawnUnit': g.police.callUnit(this.unit, g.playerVehicle ? g.playerVehicle.position : g.player.pos, g.renderer.camera); break;
      case 'heli': g.spawnHelicopter('civilian'); break;
      case 'armyheli': g.spawnHelicopter('army'); break;
      case 'never': this.neverWanted = !!v; g.police.ignoring = this.neverWanted; if (this.neverWanted) g.police.clear(); break;
      case 'hour': if (Number.isFinite(num)) g.hour = ((num % 24) + 24) % 24; break;
      case 'clock': this.clockRunning = !!v; g.clockRunning = this.clockRunning; break;
      case 'kind': if (KINDS.some(k => k.value === v)) this.kind = v as VehicleKind; break;
      case 'spawn': this.spawnVehicle(); break;
      case 'repair': { const pv = g.playerVehicle; if (pv && !pv.destroyed) { pv.health = pv.spec.health; pv.lightsBroken = false; pv.phys.enginePower = 1; pv.resetBody(); } break; }
      case 'spot': if (SPOTS.some(s => s.value === v)) this.spot = String(v); break;
      case 'go': this.teleport(); break;
    }
  }
  private spawnVehicle() {
    const g = this.game;
    // ahead of whatever the player is in: the seated player's own yaw is not kept up to date
    const pv = g.playerVehicle, yaw = pv ? pv.yaw : g.player.yaw, f = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw));
    const p = pv ? pv.position : g.player.pos, ahead = pv ? 10 : 7;
    const x = p.x + f.x * ahead, z = p.z + f.z * ahead;
    const v = g.vehicles.spawn(this.kind, x, z, yaw, -1, Math.max(0.2, p.y + 0.4));
    g.audio.play('engineStart', { pos: v.position });
  }
  private teleport() {
    const g = this.game, s = SPOTS.find(o => o.value === this.spot); if (!s) return;
    g.police.clear();
    if (g.playerVehicle) g.playerVehicle.phys.teleport(s.x, (s.y ?? 0.2) + 0.6, s.z, g.playerVehicle.yaw);
    else g.player.place(s.x, (s.y ?? 0.2) + 0.1, s.z, g.player.yaw);
  }
  /** Per-frame effects of the toggles. */
  update() {
    if (!this.enabled) { this.god = this.infiniteAmmo = this.neverWanted = false; this.game.police.ignoring = false; return; }
    const g = this.game;
    if (this.god && g.player.alive) { g.player.health = g.player.maxHealth; g.player.armor = 100; }
    if (this.infiniteAmmo) for (const id of WEAPON_ORDER) { const w = g.pcombat.inv.weapons[id]; if (w.owned && !WEAPONS[id].melee && w.reserve < WEAPONS[id].clip * 4) w.reserve = WEAPONS[id].clip * 8; }
    g.police.ignoring = this.neverWanted;
    if (this.neverWanted && g.police.heat > 0) g.police.clear();
  }
}
