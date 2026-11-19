/**
 * Integration contracts between the game core and the UI / audio layers.
 * The game owns simulation state and calls these interfaces; implementations live in src/ui and src/audio.
 */
import type { CityMap } from '../world/citymap';
import type { Settings, QualityName } from '../core/settings';

// ---------------- UI ----------------
export interface HudState {
  health: number; maxHealth: number; armor: number; money: number;
  heat: number; heatMax: number; heatFlash: boolean; // heat 0..5; flash while police are actively searching (lost sight)
  weaponName: string; weaponIcon: WeaponIcon; ammoClip: number; ammoReserve: number; reloading: boolean; // ammoClip < 0 => melee (no ammo display)
  objective: string | null; // short imperative line under the minimap / top centre
  vehicleSpeedKmh: number | null; vehicleName: string | null; vehicleHealth: number | null; // null when on foot
  district: string; streetName: string; clock: string; // e.g. "18:42"
  crosshair: 'none' | 'dot' | 'aim' | 'scope'; crosshairSpread: number; hitMarker: number; // hitMarker 0..1 fades
  /** COMBAT: reticle over a hittable person (dot turns red); kill marker 0..1 fades; headshot flag for the last hit; scope magnification */
  reticleHot?: boolean; killMarker?: number; headshotMarker?: boolean; scopeZoom?: number;
  interactPrompt: string | null; // e.g. "E  Enter vehicle"
  radio: string | null; // radio station name when in a vehicle
  missionTimer: number | null; // seconds remaining
  stamina: number; // 0..1
  fps: number | null;
}
export type WeaponIcon = 'fists' | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'medkit' | 'armor' | 'knife' | 'bat' | 'revolver' | 'sniper' | 'lmg' | 'launcher' | 'rpg' | 'grenade' | 'molotov';
export interface MinimapBlip { x: number; z: number; kind: 'mission' | 'shop' | 'garage' | 'safehouse' | 'enemy' | 'police' | 'target' | 'waypoint' | 'collectible' | 'vehicle' | 'checkpoint' | 'arms'; label?: string; pulse?: boolean }
export interface MinimapState { x: number; z: number; heading: number; /* radians, 0 = facing -z (north), positive = clockwise */ zoom: number; blips: MinimapBlip[]; route?: { x: number; z: number }[]; heatRadius?: { x: number; z: number; r: number } | null }
export interface WheelSlot { id: string; label: string; icon: WeaponIcon; detail: string; /* e.g. "12 / 48" or "x2" */ enabled: boolean }
export interface ShopItem { id: string; label: string; description: string; price: number; owned?: boolean; disabled?: boolean }

export interface GameUI {
  /** Called once with everything needed. Settings changes are applied via callbacks. */
  init(opts: { city: CityMap; settings: Settings; callbacks: UICallbacks }): void;
  // Screens
  showTitle(hasSave: boolean): void;
  showLoading(fraction: number, label: string): void; // fraction 0..1, safe to call many times
  hideLoading(): void;
  showMobileGate(): void;
  setPaused(paused: boolean): void; // shows/hides pause menu (Resume, Map, Settings, Controls, Save & Quit to title)
  isMenuOpen(): boolean; // true when pause/settings/shop/map/title is visible (game should not take input)
  // HUD
  setHudVisible(v: boolean): void;
  updateHud(s: HudState): void; // called every frame; must be cheap (diff DOM writes)
  updateMinimap(s: MinimapState): void; // called every frame (throttle internally if needed)
  toast(text: string, kind?: 'info' | 'money' | 'heat' | 'mission' | 'warning'): void; // stacked short notifications
  missionCard(title: string, subtitle: string, kind: 'start' | 'passed' | 'failed'): void; // big centred title card ~3 s
  subtitle(text: string | null, speaker?: string): void; // dialogue line at bottom centre (no voice acting)
  /**
   * WASTED / ARRESTED sequence. Grey grade builds, then the title card, then a fade to black; the game respawns when
   * advanceDeath() reports `respawn`. With `arrestAnimationDone`, the card waits until that hook calls back (police
   * handcuff animation); without it the sequence starts at once.
   */
  showDeath(kind: 'down' | 'busted', detail: string, opts?: DeathOpts): void;
  /** Ticks the death sequence with real seconds; returns the grey-grade amount 0..1 and a one-shot respawn signal. */
  advanceDeath?(dt: number): { grade: number; respawn: boolean };
  // Weapon / item wheel
  openWheel(slots: WheelSlot[], selectedId: string): void;
  updateWheel(dirX: number, dirY: number): void; // accumulate pointer/stick direction; highlights a slot
  closeWheel(): string | null; // returns chosen slot id (or null if none)
  peekWheel?(): string | null; // COMBAT: id of the highlighted slot while the wheel is open
  // Shop
  openShop(title: string, items: ShopItem[], money: number, onBuy: (id: string) => void, onClose: () => void): void;
  refreshShop(items: ShopItem[], money: number): void;
  closeShop(): void;
  // Full map (opened from pause menu or the Map key)
  openMap(s: MinimapState): void;
  closeMap(): void;
  // Help
  showControlsHint(text: string, seconds: number): void; // small contextual hint box (e.g. first time in a car)
  // Store hold-ups: a meter while the clerk empties the till (null hides it)
  robberyMeter(s: { label: string; progress: number /*0..1*/; cash: number } | null): void;
  // Sandbox mode: the title offers it (callbacks.onSandbox); in a sandbox game the pause menu gets a
  // "Sandbox tools" entry (callbacks.onOpenSandbox) and the game opens a generic tools panel.
  setMode(mode: 'story' | 'sandbox'): void;
  openSandbox(actions: SandboxAction[], onAction: (id: string, value?: number | string | boolean) => void, onClose: () => void): void;
  refreshSandbox(actions: SandboxAction[]): void; // re-render values (e.g. after a toggle)
  closeSandbox(): void;
}
/** One control in the sandbox tools panel, grouped into sections by `group`. */
export interface SandboxAction {
  id: string; group: string; label: string; detail?: string;
  kind: 'button' | 'toggle' | 'slider' | 'select';
  value?: number | string | boolean; min?: number; max?: number; step?: number; options?: { value: string; label: string }[];
}
export interface DeathOpts { arrestAnimationDone?: (done: () => void) => void }
export interface UICallbacks {
  onStart(continueGame: boolean): void; // title: New game / Continue
  onSandbox?(): void; // unused: the game is sandbox-only (the title's Play starts it)
  onHighway?(): void; // title: the endless highway mode
  onOpenSandbox(): void; // pause menu (sandbox games only): open the tools panel
  onResume(): void;
  onQuitToTitle(): void;
  onSaveGame?(): boolean; // pause menu: save now (returns false when the game can't be saved right now)
  onSettingsChanged(s: Settings): void; // apply + persist (game calls saveSettings)
  onQualityChanged(q: QualityName): void;
  onSetWaypoint(x: number, z: number): void; // clicking the full map
  onUiSound(kind: 'click' | 'hover' | 'back'): void;
  captureKey(cb: (code: string) => void): void; // game routes the next key/mouse press to cb (for rebinding)
}

// ---------------- Audio ----------------
export type SfxName =
  | 'pistol' | 'smg' | 'shotgun' | 'rifle' | 'punch' | 'punchHit' | 'hitBody' | 'hitMetal' | 'hitConcrete' | 'ricochet' | 'reload' | 'empty' | 'equip'
  | 'pickup' | 'money' | 'footstep' | 'jump' | 'land' | 'doorOpen' | 'doorClose' | 'horn' | 'glass' | 'crash' | 'explosion' | 'splash'
  | 'uiClick' | 'uiHover' | 'uiBack' | 'missionStart' | 'missionPass' | 'missionFail' | 'down' | 'checkpoint' | 'wheelOpen' | 'wheelClose'
  | 'heatUp' | 'heatLost' | 'purchase' | 'whoosh' | 'tireScreech' | 'engineStart' | 'shellCasing';
export interface Vec3Like { x: number; y: number; z: number }
export interface EngineVoice { update(opts: { rpm: number /*0..1*/; throttle: number /*0..1*/; pos: Vec3Like; kind: 'car' | 'bike' | 'truck'; damage: number /*0..1*/ }): void; stop(): void }
export interface LoopVoice { update(pos: Vec3Like, volume: number): void; stop(): void; /** sirens only: 0 = auto wail/yelp cycle, 1 wail, 2 yelp, 3 phaser */ tone?: number }
export interface GameAudio {
  /** Must be called from a user gesture (click / key) before sound plays. Safe to call repeatedly. */
  resume(): Promise<void>;
  setVolumes(master: number, music: number, sfx: number): void;
  setListener(pos: Vec3Like, forward: Vec3Like): void;
  play(name: SfxName, opts?: { pos?: Vec3Like; volume?: number; pitch?: number }): void;
  engine(): EngineVoice;
  siren(): LoopVoice;
  skid(): LoopVoice;
  setAmbience(a: { night: number; water: number; traffic: number; park: number; indoors?: number }): void;
  radioNext(): string | null; // cycles stations; returns name (null = radio off)
  setRadioActive(active: boolean): void; // only audible inside vehicles
  setSlowMo(amount: number): void; // 0..1 (inventory wheel)
  setPausedMuffle(paused: boolean): void;
  setMusicMood(mood: 'none' | 'tension' | 'action'): void; // optional mission score layer
}
