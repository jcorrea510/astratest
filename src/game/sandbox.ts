/** Sandbox mode: free play with everything unlocked and a tools panel (spawn cars, set the clock, wanted level, teleport...). */
import * as THREE from 'three';
import type { Game } from './game';
import type { GameUI, SandboxAction } from '../ui/contracts';
import { WEAPONS, WEAPON_ORDER } from '../combat/weapons';
import { VEHICLES, type VehicleKind } from '../vehicles/specs';
import { PLACES } from './places';

const KINDS: { value: VehicleKind; label: string }[] = (Object.keys(VEHICLES) as VehicleKind[]).map(k => ({ value: k, label: VEHICLES[k].name }));
const SPOTS: { value: string; label: string; x: number; z: number; y?: number }[] = [
  { value: 'safehouse', label: 'Lantern Ave apartment', x: PLACES.safehouse.x + 4, z: PLACES.safehouse.z },
  { value: 'midtown', label: 'Midtown plaza', x: -200, z: 150 },
  { value: 'heights', label: 'Meridian Heights', x: 95, z: -150 },
  { value: 'park', label: 'Juniper Park', x: 100, z: -350 },
  { value: 'pier', label: 'Pier 9 (Ferris wheel)', x: -50, z: 520, y: 1.3 },
  { value: 'beach', label: 'Strand beach', x: 150, z: 425 },
  { value: 'docks', label: 'Cannery docks', x: 470, z: 150 },
  { value: 'hillside', label: 'Hillside lookout', x: 380, z: -150 },
  { value: 'race', label: 'Coastal Drive start line', x: -436, z: 403.5 },
];

export class Sandbox {
  god = true; infiniteAmmo = true; neverWanted = false; clockRunning = true;
  traffic: number; peds: number;
  private kind: VehicleKind = 'coupe'; private spot = 'pier';
  open = false;
  constructor(private game: Game, private ui: GameUI) {
    this.traffic = game.renderer.quality.traffic; this.peds = game.renderer.quality.pedestrians;
  }
  /** New sandbox session: money, every weapon, full armor. */
  setup() {
    const g = this.game;
    g.money = 50000; g.hour = 18.2; g.player.armor = 100;
    for (const id of WEAPON_ORDER) g.pcombat.give(id, WEAPONS[id].clip * 6 + (WEAPONS[id].cat === 'throw' ? 4 : 0)); // COMBAT: every weapon incl. melee and throwables
    g.pcombat.inv.medkits = 5;
    g.trafficCap = this.traffic; g.pedCap = this.peds;
  }
  actions(): SandboxAction[] {
    const g = this.game;
    return [
      { id: 'god', group: 'Player', label: 'Invincible', kind: 'toggle', value: this.god },
      { id: 'ammo', group: 'Player', label: 'Infinite ammo', kind: 'toggle', value: this.infiniteAmmo },
      { id: 'heal', group: 'Player', label: 'Full health and armor', kind: 'button' },
      { id: 'cash', group: 'Player', label: 'Add $10,000', detail: `$${g.money.toLocaleString('en-US')}`, kind: 'button' },
      { id: 'heat', group: 'Police', label: 'Wanted level', kind: 'slider', value: g.police.heat, min: 0, max: 5, step: 1 },
      { id: 'never', group: 'Police', label: 'Police ignore you', kind: 'toggle', value: this.neverWanted },
      { id: 'hour', group: 'World', label: 'Time of day', kind: 'slider', value: Math.round(g.hour * 4) / 4, min: 0, max: 23.75, step: 0.25 },
      { id: 'clock', group: 'World', label: 'Clock running', kind: 'toggle', value: this.clockRunning },
      { id: 'traffic', group: 'World', label: 'Traffic', kind: 'slider', value: this.traffic, min: 0, max: 40, step: 1 },
      { id: 'peds', group: 'World', label: 'Pedestrians', kind: 'slider', value: this.peds, min: 0, max: 60, step: 1 },
      { id: 'kind', group: 'Vehicles', label: 'Model', kind: 'select', value: this.kind, options: KINDS },
      { id: 'spawn', group: 'Vehicles', label: 'Spawn in front of me', kind: 'button' },
      { id: 'repair', group: 'Vehicles', label: 'Repair my vehicle', kind: 'button' },
      { id: 'spot', group: 'Teleport', label: 'Destination', kind: 'select', value: this.spot, options: SPOTS.map(s => ({ value: s.value, label: s.label })) },
      { id: 'go', group: 'Teleport', label: 'Teleport', kind: 'button' },
    ];
  }
  openPanel(onClose: () => void) {
    this.open = true;
    // sliders are not re-rendered while dragging (rebuilding the panel would drop the drag)
    this.ui.openSandbox(this.actions(), (id, v) => { this.act(id, v); if (this.actions().find(a => a.id === id)?.kind !== 'slider') this.ui.refreshSandbox(this.actions()); }, () => { this.open = false; onClose(); });
  }
  act(id: string, v?: number | string | boolean) {
    const g = this.game, num = Number(v);
    switch (id) {
      case 'god': this.god = !!v; break;
      case 'ammo': this.infiniteAmmo = !!v; break;
      case 'heal': g.player.health = g.player.maxHealth; g.player.armor = 100; break;
      case 'cash': g.addMoney(10000); break;
      case 'heat': if (Number.isFinite(num)) g.police.setHeat(Math.round(num), g.player.pos); break;
      case 'never': this.neverWanted = !!v; if (this.neverWanted) g.police.clear(); break;
      case 'hour': if (Number.isFinite(num)) g.hour = ((num % 24) + 24) % 24; break;
      case 'clock': this.clockRunning = !!v; g.clockRunning = this.clockRunning; break;
      case 'traffic': if (Number.isFinite(num)) { this.traffic = num; g.trafficCap = num; } break;
      case 'peds': if (Number.isFinite(num)) { this.peds = num; g.pedCap = num; } break;
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
    const g = this.game;
    if (this.god && g.player.alive) { g.player.health = g.player.maxHealth; g.player.armor = 100; }
    if (this.infiniteAmmo) for (const id of WEAPON_ORDER) { const w = g.pcombat.inv.weapons[id]; if (w.owned && !WEAPONS[id].melee && w.reserve < WEAPONS[id].clip * 4) w.reserve = WEAPONS[id].clip * 8; }
    if (this.neverWanted && g.police.heat > 0) g.police.clear();
  }
}
