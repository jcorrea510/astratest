import './style.css';
import * as THREE from 'three';
import { loadAssets, type Assets } from './world/assets';
import { initPhysics } from './core/physics';
import { loadSettings, saveSettings, safeStorage, type Settings } from './core/settings';
import { Game, PLAYER_LOOK } from './game/game';
import { generateCity } from './world/citymap';
import { UI } from './ui/ui';
import { Audio } from './audio/audio';
import type { GameAudio, WheelSlot } from './ui/contracts';
import { MissionCtx, Missions, MISSIONS } from './game/missions';
import { Activities } from './game/activities';
import { readSave, writeSave, type SaveData } from './game/save';
import { WEAPONS, WEAPON_ORDER, type WeaponId } from './combat/weapons';
import { PLACES } from './game/places';

declare global { interface Window { __meridian?: unknown; __game?: Game } }

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = '';
const canvas = document.createElement('canvas');
canvas.id = 'view';
canvas.setAttribute('aria-label', 'Meridian Afterglow game view');
app.appendChild(canvas);
const params = new URLSearchParams(location.search);
const settings: Settings = loadSettings();
if (params.get('quality') === 'low' || params.get('quality') === 'medium' || params.get('quality') === 'high') settings.quality = params.get('quality') as Settings['quality'];
const storage = safeStorage();
const ui = new UI();
const city = generateCity();
let game: Game | null = null;
let missions: Missions | null = null;
let activities: Activities | null = null;
let audio: GameAudio | null = null;
let assetsPromise: Promise<Assets> | null = null;
let assetFrac = 0, assetLabel = 'Preparing the city';
let started = false;
let autosaveT = 0;
let ourUnlock = false;

function isMobile(): boolean {
  const coarse = matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
  const small = Math.min(screen.width, screen.height) < 600;
  return params.get('mobile') === '1' || (coarse && (small || 'ontouchstart' in window));
}
function webglOk(): boolean {
  try { const c = document.createElement('canvas'); return !!c.getContext('webgl2'); } catch { return false; }
}

ui.init({
  city, settings, callbacks: {
    onStart: cont => { void startGame(cont); },
    onResume: () => resume(),
    onQuitToTitle: () => quitToTitle(),
    onSettingsChanged: s => applySettings(s),
    onQualityChanged: q => { settings.quality = q; saveSettings(settings); game?.renderer.setQuality(q); },
    onSetWaypoint: (x, z) => { if (game) { game.waypoint = new THREE.Vector3(x, 0, z); ui.toast('Waypoint set', 'info'); } },
    onUiSound: k => audio?.play(k === 'click' ? 'uiClick' : k === 'hover' ? 'uiHover' : 'uiBack'),
    captureKey: cb => { if (game) game.input.captureNext(cb); else captureOnce(cb); },
  },
});

function captureOnce(cb: (code: string) => void) {
  const k = (e: KeyboardEvent) => { e.preventDefault(); done(e.code); };
  const m = (e: MouseEvent) => { e.preventDefault(); done(`Mouse${e.button}`); };
  const done = (code: string) => { window.removeEventListener('keydown', k, true); window.removeEventListener('mousedown', m, true); cb(code); };
  window.addEventListener('keydown', k, true); window.addEventListener('mousedown', m, true);
}

function applySettings(s: Settings) {
  Object.assign(settings, s);
  saveSettings(settings);
  audio?.setVolumes(settings.master, settings.music, settings.sfx);
  if (game) { game.cam.shakeScale = settings.cameraShake; if (game.renderer.qualityName !== settings.quality) game.renderer.setQuality(settings.quality); }
}

function preload() {
  if (assetsPromise) return assetsPromise;
  assetsPromise = (async () => {
    await initPhysics();
    return loadAssets((f, l) => { assetFrac = f; assetLabel = l; if (!started) return; ui.showLoading(f * 0.6, l); });
  })();
  return assetsPromise;
}

async function startGame(cont: boolean) {
  if (started) return;
  started = true;
  ui.showLoading(assetFrac * 0.6, assetLabel);
  try {
    const assets = await preload();
    if (!audio) { audio = new Audio(assets.audio); audio.setVolumes(settings.master, settings.music, settings.sfx); }
    void audio.resume();
    game = new Game(canvas, settings, assets, audio);
    window.__game = game;
    await game.init((f, l) => ui.showLoading(0.6 + f * 0.4, l));
    const ctx = new MissionCtx(game, ui);
    missions = new Missions(ctx);
    activities = new Activities(game, ui, ctx);
    activities.onSaveRequested = () => saveGame();
    wireGame(game);
    const save = cont ? readSave(storage) : null;
    if (save) applySave(save); else newGameSetup();
    activities.spawnCards();
    ui.hideLoading();
    ui.setHudVisible(true);
    game.onFrame = dt => frame(dt);
    game.start();
    game.input.requestLock();
    if (!save) {
      ui.missionCard('Port Meridian', 'Golden hour. Find Juno on Lantern Ave to get started.', 'start');
      setTimeout(() => ui.showControlsHint('WASD to move, mouse to look, Shift to sprint, Space to jump. Esc pauses. Walk into the glowing amber marker to start a mission.', 9), 3200);
    } else ui.toast('Welcome back to Port Meridian', 'info');
    exposeApi();
  } catch (e) {
    console.error(e);
    ui.showLoading(1, 'Something went wrong while loading. Please reload the page.');
  }
}

function newGameSetup() {
  const g = game!;
  g.money = 250; g.hour = 17.4;
  g.player.place(PLACES.safehouse.x, 0.25, PLACES.safehouse.z, Math.PI * 0.5);
  g.cam.snapBehind(Math.PI * 0.5 + Math.PI);
}
function applySave(s: SaveData) {
  const g = game!;
  g.money = s.money; g.player.health = s.health; g.player.armor = s.armor; g.hour = s.hour;
  g.pcombat.inv.load({ weapons: s.weapons, current: s.current, medkits: s.medkits });
  for (const id of s.missions) if (MISSIONS.some(m => m.id === id)) missions!.completed.add(id);
  for (const c of s.collectibles) activities!.found.add(c);
  for (const j of s.jumps) activities!.jumpsDone.add(j);
  g.stats = { ...s.stats };
  g.player.place(s.pos.x, 0.4, s.pos.z, s.pos.yaw);
  g.cam.snapBehind(s.pos.yaw + Math.PI);
}
function saveGame(): boolean {
  if (!game || !missions || !activities || game.deathT >= 0) return false;
  const g = game;
  const onFoot = !g.playerVehicle;
  const pos = onFoot && !missions.active ? { x: g.player.pos.x, z: g.player.pos.z, yaw: g.player.yaw } : { x: PLACES.safehouse.x, z: PLACES.safehouse.z, yaw: Math.PI / 2 };
  const ok = writeSave(storage, {
    version: 1, savedAt: Date.now(), money: g.money, health: Math.max(1, g.player.health), armor: g.player.armor,
    weapons: g.pcombat.inv.weapons, current: g.pcombat.inv.current, medkits: g.pcombat.inv.medkits,
    missions: [...missions.completed], collectibles: [...activities.found], jumps: [...activities.jumpsDone],
    pos, hour: g.hour, stats: g.stats,
  });
  return ok;
}

function wireGame(g: Game) {
  g.events.onToast = (t, k) => ui.toast(t, k);
  g.events.onDeath = (k, detail) => { ui.showDeath(k, detail); missions?.onPlayerDown(k); };
  g.events.onRespawn = () => { ui.toast(g.deathKind === 'down' ? 'Patched up at Juniper Clinic' : 'Released from Meridian PD', 'info'); };
  missions!.onPassed = () => { saveGame(); };
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && started && game && !game.paused && !ui.isMenuOpen() && !ourUnlock && !activities?.shopIsOpen) pause();
    ourUnlock = false;
  });
  canvas.addEventListener('click', () => { if (game && !game.paused && !ui.isMenuOpen()) game.input.requestLock(); void audio?.resume(); });
  window.addEventListener('blur', () => { if (game && !game.paused && started) pause(); });
}
function pause() {
  if (!game || game.paused) return;
  if (game.wheelOpen) closeWheel();
  game.paused = true; ui.setPaused(true); audio?.setPausedMuffle(true);
  ourUnlock = true; game.input.exitLock();
}
function resume() {
  if (!game) return;
  game.paused = false; game.menuOpen = false; ui.setPaused(false); audio?.setPausedMuffle(false);
  game.input.clearAll();
  game.input.requestLock();
}
function quitToTitle() {
  saveGame();
  location.reload();
}

// ---------------- Inventory wheel ----------------
function wheelSlots(): WheelSlot[] {
  const inv = game!.pcombat.inv;
  const slots: WheelSlot[] = WEAPON_ORDER.filter(id => inv.weapons[id].owned).map(id => ({ id, label: WEAPONS[id].name, icon: WEAPONS[id].icon, detail: WEAPONS[id].melee ? 'Melee' : `${inv.weapons[id].clip} / ${inv.weapons[id].reserve}`, enabled: true }));
  slots.push({ id: 'medkit', label: 'First-aid kit', icon: 'medkit', detail: `x${inv.medkits}`, enabled: inv.medkits > 0 && game!.player.health < game!.player.maxHealth });
  return slots;
}
function openWheel() {
  const g = game!;
  g.wheelOpen = true; g.targetTimeScale = 0.25; audio?.setSlowMo(1); audio?.play('wheelOpen');
  ui.openWheel(wheelSlots(), g.pcombat.inv.current);
}
function closeWheel() {
  const g = game!;
  const id = ui.closeWheel();
  g.wheelOpen = false; g.targetTimeScale = 1; audio?.setSlowMo(0); audio?.play('wheelClose');
  if (!id) return;
  if (id === 'medkit') { const inv = g.pcombat.inv; if (inv.medkits > 0 && g.player.health < g.player.maxHealth) { inv.medkits--; g.player.health = Math.min(g.player.maxHealth, g.player.health + 60); audio?.play('pickup'); ui.toast('+60 health', 'info'); } }
  else if (g.pcombat.inv.select(id as WeaponId)) audio?.play('equip');
}

// ---------------- Per-frame UI glue ----------------
function frame(raw: number) {
  const g = game!, m = missions!, a = activities!;
  const input = g.input;
  // pause / map
  if (input.justPressed('pause') && !a.shopIsOpen) { if (g.paused) { /* UI handles Esc in menus */ } else pause(); }
  if (!g.paused && !ui.isMenuOpen() && input.justPressed('map')) { pause(); ui.openMap(minimapState()); }
  if (!g.paused) {
    // wheel (hold)
    const canWheel = !g.playerVehicle && g.player.alive && g.deathT < 0 && !a.shopIsOpen;
    if (canWheel && input.held('wheel') && !g.wheelOpen) openWheel();
    if (g.wheelOpen) {
      const pad = input.pad;
      ui.updateWheel(input.mouseDX + (pad.connected ? pad.rx * 30 : 0), input.mouseDY + (pad.connected ? pad.ry * 30 : 0));
      if (!input.held('wheel') || !canWheel) closeWheel();
    }
    m.update(raw * g.timeScale);
    a.update(raw * g.timeScale);
    autosaveT += raw;
    if (autosaveT > 60 && !m.active && g.deathT < 0 && !g.playerVehicle) { autosaveT = 0; saveGame(); }
  }
  // HUD
  const hud = g.hudState(m.objective, m.timer);
  hud.interactPrompt = a.prompt() ?? hud.interactPrompt;
  ui.updateHud(hud);
  ui.updateMinimap(minimapState());
}
function minimapState() {
  const g = game!;
  const yaw = g.playerVehicle ? g.playerVehicle.yaw : g.cam.yaw + Math.PI;
  // heading: 0 = facing north (-z), positive clockwise. Facing (sin yaw, cos yaw) in x/z.
  const heading = Math.atan2(Math.sin(yaw), -Math.cos(yaw));
  const blips = [...g.baseBlips(), ...missions!.blips(), ...activities!.blips()];
  const heat = g.police.heat > 0 && !g.police.state.seen ? { x: g.police.state.lastSeen.x, z: g.police.state.lastSeen.z, r: g.police.state.searchRadius() } : null;
  return { x: g.player.pos.x, z: g.player.pos.z, heading, zoom: g.playerVehicle ? 1 + Math.min(1, Math.abs(g.playerVehicle.speed) / 30) : 1, blips, heatRadius: heat };
}

/** Test / debugging surface used by the automated playthrough tests. */
function exposeApi() {
  window.__meridian = {
    game, missions, activities, ui, settings, PLAYER_LOOK,
    save: () => saveGame(), read: () => readSave(storage),
    pause, resume, openWheel, closeWheel,
  };
}

// ---------------- Boot ----------------
if (!webglOk()) {
  ui.showMobileGate();
} else if (isMobile()) {
  ui.showMobileGate();
} else {
  ui.showTitle(!!readSave(storage));
  void preload().catch(e => console.error(e));
  if (params.get('autostart') === '1') void startGame(params.get('continue') === '1');
}
document.title = 'Meridian Afterglow';
