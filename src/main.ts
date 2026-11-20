import './style.css';
import { setRealisticDriving } from './vehicles/vehiclePhysics';
import * as THREE from 'three';
import { loadAssets, type Assets } from './world/assets';
import { initPhysics } from './core/physics';
import { loadSettings, saveSettings, safeStorage, type Settings } from './core/settings';
import { Game, PLAYER_LOOK } from './game/game';
import { generateCity, surfaceAt } from './world/citymap';
import { UI } from './ui/ui';
import { renderWeaponIcons } from './ui/icons';
import { Audio } from './audio/audio';
import type { GameAudio, WheelSlot } from './ui/contracts';
import { wheelSlots as combatWheelSlots, currentSlot, selectSlot, scrollSlot } from './combat/wheelSlots';
// Story missions are switched off: the game is a sandbox. missions.ts stays in the repo (unused) so it can return later;
// only its MissionCtx helper (markers, ground height, dialogue) is used by the activities.
import { MissionCtx } from './game/missions';
import { Activities } from './game/activities';
import { Sandbox } from './game/sandbox';
import { readSave, writeSave, safeSavePos, saveSummary, type SaveData } from './game/save';
import type { GameMode } from './game/modes';
import { PLACES } from './game/places';
import { GpsRouter } from './world/gps';
import { ATTRACT_SHOTS, shotCamera } from './ui/attract';
import { installFullscreenShortcut } from './core/fullscreen';

installFullscreenShortcut();

declare global { interface Window { __meridian?: unknown; __game?: Game; __highway?: unknown } }

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
// Realistic weapon icons: render the 3D models once, off the critical path (HUD, wheel and shop read the cache).
setTimeout(() => { renderWeaponIcons(); }, 0);
const city = generateCity();
let game: Game | null = null;
let ctx: MissionCtx | null = null;
let activities: Activities | null = null;
let sandbox: Sandbox | null = null;
let audio: GameAudio | null = null;
let worldPromise: Promise<Game> | null = null;
let started = false;
let autosaveT = 0;
let ourUnlock = false;
let mapByKey = false;
let attract: { shot: number; t: number; dipped: boolean } | null = null;
const DEFAULT_SAT = 1.08;

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
    onStart: (cont, mode) => { void play(cont, mode); },
    onHighway: () => { void openHighway(); },
    onOpenSandbox: () => { if (game?.mode === 'regular') { activities?.openGoals(); return; } if (sandbox && game) { game.menuOpen = true; sandbox.openPanel(() => { if (game) game.menuOpen = false; }); } },
    onResume: () => resume(),
    onPauseRequest: () => { if (game && started && !game.paused && !ui.isMenuOpen()) pause(); },
    onQuitToTitle: () => quitToTitle(),
    onSaveGame: () => saveGame(),
    onSettingsChanged: s => applySettings(s),
    onQualityChanged: q => { settings.quality = q; saveSettings(settings); game?.renderer.setQuality(q); },
    onSetWaypoint: (x, z) => { if (game) { game.waypoint = new THREE.Vector3(x, 0, z); ui.toast('Waypoint set', 'info'); } },
    onUiSound: k => audio?.play(k === 'click' ? 'uiClick' : k === 'hover' ? 'uiHover' : 'uiBack'),
    captureKey: cb => { if (game && started) game.input.captureNext(cb); else captureOnce(cb); },
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
  if (game) { game.cam.shakeScale = settings.cameraShake; game.renderer.setLook(settings.look); setRealisticDriving(settings.driving === 'realistic'); if (game.renderer.qualityName !== settings.quality) game.renderer.setQuality(settings.quality); }
}

/** Loads assets and builds the whole city once; the title screen then flies a camera over it. */
function bootWorld(onProgress: (f: number, label: string) => void): Promise<Game> {
  if (worldPromise) return worldPromise;
  worldPromise = (async () => {
    await initPhysics();
    const assets: Assets = await loadAssets((f, l) => onProgress(f * 0.6, l));
    if (!audio) { audio = new Audio(assets.audio); audio.setVolumes(settings.master, settings.music, settings.sfx); }
    const g = new Game(canvas, settings, assets, audio);
    game = g; window.__game = g;
    await g.init((f, l) => onProgress(0.6 + f * 0.38, l));
    ctx = new MissionCtx(g, ui);
    return g;
  })();
  return worldPromise;
}

// ---------------- Title flyover (attract mode) ----------------
function startAttract(g: Game) {
  g.ghost = true; g.blockedInput = true; g.clockRunning = false;
  g.player.human.root.visible = false;
  g.police.clear();
  attract = { shot: 0, t: 0, dipped: false };
  enterShot(g, 0);
  g.prewarm();
  g.onFrame = raw => attractFrame(g, raw);
  g.start();
}
function enterShot(g: Game, i: number) {
  const s = ATTRACT_SHOTS[i];
  g.hour = s.hour;
  g.police.clear();
  // the (hidden) player stands at the focus so traffic and people fill the shot
  g.player.place(s.focus[0], (ctx?.groundY(s.focus[0], s.focus[1]) ?? 0.2) + 0.05, s.focus[1], 0);
  ui.titleShot(s.name, s.caption);
}
function attractFrame(g: Game, raw: number) {
  const a = attract; if (!a) return;
  const s = ATTRACT_SHOTS[a.shot];
  a.t += raw;
  if (!a.dipped && a.t > s.duration - 0.45) { a.dipped = true; ui.titleDip(); }
  if (a.t >= s.duration) { a.shot = (a.shot + 1) % ATTRACT_SHOTS.length; a.t = 0; a.dipped = false; enterShot(g, a.shot); }
  if (g.player.health < g.player.maxHealth) g.player.health = g.player.maxHealth;
  const cam = g.renderer.camera, c = shotCamera(ATTRACT_SHOTS[a.shot], a.t);
  cam.position.set(c.pos[0], c.pos[1], c.pos[2]);
  cam.lookAt(c.look[0], c.look[1], c.look[2]);
  if (cam.fov !== c.fov) { cam.fov = c.fov; cam.updateProjectionMatrix(); }
}
function stopAttract(g: Game) {
  attract = null;
  g.ghost = false; g.blockedInput = false; g.clockRunning = true;
  g.player.human.root.visible = true;
  g.onFrame = null;
}

// ---------------- Starting play ----------------
async function play(cont: boolean, newMode: GameMode = 'sandbox') {
  if (started) return;
  started = true;
  void audio?.resume();
  ui.showLoading(0.1, 'Entering Port Meridian');
  const t0 = performance.now();
  try {
    const g = await bootWorld((f, l) => ui.showLoading(f, l));
    g.stop();
    stopAttract(g);
    ui.showLoading(0.6, 'Waking up the city');
    activities = new Activities(g, ui, ctx!);
    activities.onSaveRequested = () => saveGame();
    activities.missionActive = () => false;
    sandbox = new Sandbox(g, ui);

    wireGame(g);
    const save = cont ? readSave(storage) : null;
    g.police.clear();
    let loaded = false;
    if (save) { try { applySave(save); loaded = true; } catch (e) { console.error('save could not be applied', e); } }
    if (!loaded) newGameSetup(save ? save.mode : newMode); // a broken save falls back to a fresh start instead of a dead game
    ui.setMode(g.mode);
    activities.parkOwned();
    activities.spawnCards();
    g.cam.update(0.016, g.player.pos, 'foot');
    ui.showLoading(0.85, 'Waking up the city');
    g.prewarm();
    // a short beat on the loading art so the switch from the flyover never flickers
    if (!params.get('autostart')) await new Promise(r => setTimeout(r, Math.max(0, 1300 - (performance.now() - t0))));
    ui.hideTitle();
    ui.hideLoading();
    ui.setHudVisible(true);
    g.onFrame = dt => frame(dt);
    g.start();
    g.input.requestLock();
    if (!loaded) {
      ui.missionCard('Port Meridian', g.mode === 'regular' ? 'Start with nothing. Rob, save up, buy guns at Tidewater Arms and cars at Redline Motors.' : 'Golden hour. The city is yours.', 'start');
      setTimeout(() => ui.showControlsHint(g.mode === 'regular' ? `WASD to move, mouse to look, Shift to sprint, Space to jump. You have fists and $${g.money}. Hold up stores for cash, then buy guns at Tidewater Arms and cars at Redline Motors. Esc: map, goals and saving. Dying costs you a medical bill and every weapon.` : `WASD to move, mouse to look, Shift to sprint, Space to jump. Esc opens the pause menu: map, sandbox tools (spawn cars, set the clock, wanted level, teleport) and saving.`, 10), 3200);
    } else ui.toast('Welcome back to Port Meridian', 'info');
    exposeApi();
  } catch (e) {
    console.error(e);
    ui.showLoading(1, 'Something went wrong while loading. Please reload the page.');
  }
}

function newGameSetup(mode: GameMode) {
  const g = game!;
  sandbox!.setup(mode);
  g.player.health = g.player.maxHealth;
  g.player.place(PLACES.safehouse.x + 4, 0.25, PLACES.safehouse.z, Math.PI * 0.5);
  g.cam.snapBehind(Math.PI * 0.5 + Math.PI);
}
function applySave(s: SaveData) {
  const g = game!, a = activities!;
  g.mode = s.mode; a.loadOwned(s.cars, s.milestones, s.robberies);
  g.money = s.money; g.player.health = s.health; g.player.armor = s.armor; g.hour = s.hour;
  g.pcombat.inv.load({ weapons: s.weapons, current: s.current, medkits: s.medkits });
  g.pcombat.inv.holster(); // resuming never puts a gun in your hand
  for (const c of s.collectibles) a.found.add(c);
  for (const j of s.jumps) a.jumpsDone.add(j);
  g.stats = { ...s.stats };
  sandbox!.applyCaps();
  sandbox!.loadTools(s.tools);
  // Old or hand-edited saves may sit on a roof, in water or off the map: resume on valid ground instead.
  const p = safeSavePos(s.pos, deckAwareSurface, { x: PLACES.safehouse.x, z: PLACES.safehouse.z, yaw: PLACES.safehouse.yaw });
  g.player.place(p.x, ctx!.groundY(p.x, p.z, 0.2) + 0.05, p.z, p.yaw);
  g.cam.snapBehind(p.yaw + Math.PI);
}
/** Surface lookup for saves: water with a raised deck over it (the pier) counts as pavement. */
function deckAwareSurface(x: number, z: number) {
  const s = surfaceAt(city, x, z);
  return s === 'water' && (ctx?.groundY(x, z, 0) ?? 0) > 0.8 ? 'sidewalk' : s;
}
function saveGame(): boolean {
  if (!game || !activities || !sandbox || !started || game.deathT >= 0) return false;
  const g = game;
  const onFoot = !g.playerVehicle; // (in a car or swimming: wake up at the safehouse instead)
  const home = { x: PLACES.safehouse.x, z: PLACES.safehouse.z, yaw: Math.PI / 2 };
  // Never save a roof, a lot or the water: store the nearest street / pavement / park spot (or the safehouse).
  const pos = onFoot && !g.player.swimming ? safeSavePos({ x: g.player.pos.x, z: g.player.pos.z, yaw: g.player.yaw }, deckAwareSurface, home) : home;
  return writeSave(storage, {
    version: 2, savedAt: Date.now(), mode: g.mode, cars: activities.ownedCars, milestones: [...activities.milestones], robberies: activities.robberiesTotal, money: g.money, health: Math.max(1, g.player.health), armor: g.player.armor,
    weapons: g.pcombat.inv.weapons, current: g.pcombat.inv.current, medkits: g.pcombat.inv.medkits,
    missions: [], collectibles: [...activities.found], jumps: [...activities.jumpsDone],
    pos, hour: g.hour, stats: g.stats, tools: sandbox.tools(),
  });
}

function wireGame(g: Game) {
  g.events.onToast = (t, k) => ui.toast(t, k);
  g.events.onDeath = (k, detail) => {
    // slow motion while the world drains to grey; the UI paces the card and tells us when to respawn
    if (k === 'down') { g.targetTimeScale = 0.3; audio?.setSlowMo(1); }
    g.respawnDelay = Infinity;
    ui.showDeath(k, detail, { arrestAnimationDone: k === 'busted' ? g.events.arrestAnimationDone ?? undefined : undefined });
  };
  g.events.onBeforeDown = () => { if (g.wheelOpen) closeWheel(true); activities?.closeShop(); };
  g.events.onRespawn = () => {
    g.respawnDelay = 4.2; g.targetTimeScale = 1; g.timeScale = 1; audio?.setSlowMo(0); setGrade(g, 0);
    ui.toast(g.deathKind === 'down' ? 'Patched up at Juniper Clinic' : 'Released from Meridian PD', 'info');
    if (g.deathNotice) { const n = g.deathNotice; g.deathNotice = ''; setTimeout(() => ui.toast(n, 'warning'), 900); activities?.parkOwned(); }
  };
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && started && game && !game.paused && !ui.isMenuOpen() && !ourUnlock && !activities?.shopIsOpen) pause();
    ourUnlock = false;
  });
  canvas.addEventListener('click', () => { if (game && !game.paused && !ui.isMenuOpen()) game.input.requestLock(); void audio?.resume(); });
  window.addEventListener('blur', () => { if (game && !game.paused && started) pause(); });
}
function setGrade(g: Game, k: number) {
  const u = g.renderer.grade?.uniforms; if (!u) return;
  u.uSat.value = DEFAULT_SAT * (1 - k * 0.92);
  u.uSlow.value = k;
}
function pause() {
  if (!game || game.paused) return;
  if (game.wheelOpen) closeWheel(true);
  activities?.closeShop();
  game.paused = true; ui.setPaused(true); audio?.setPausedMuffle(true);
  ourUnlock = true; game.input.exitLock();
}
function resume() {
  if (!game) return;
  game.paused = false; game.menuOpen = false; ui.setPaused(false); audio?.setPausedMuffle(false);
  game.input.clearAll();
  game.input.requestLock();
}
/** Title menu: the Continue button describes the save (mode, cash, when). */
function showTitle() { const s = readSave(storage); ui.showTitle(!!s, s ? saveSummary(s) : undefined); }
function quitToTitle() {
  saveGame();
  location.href = location.pathname; // the title screen (drop debug query flags such as ?autostart)
}

// ---------------- Inventory wheel ----------------
function wheelSlots(): WheelSlot[] {
  return combatWheelSlots(game!.pcombat.inv, game!.player.health < game!.player.maxHealth); // COMBAT: category wheel
}
function openWheel() {
  const g = game!;
  g.wheelOpen = true; g.targetTimeScale = 0.25; audio?.setSlowMo(1); audio?.play('wheelOpen');
  ui.openWheel(wheelSlots(), currentSlot(g.pcombat.inv));
}
function closeWheel(discard = false) {
  const g = game!;
  const id = ui.closeWheel();
  g.wheelOpen = false; g.targetTimeScale = 1; audio?.setSlowMo(0); audio?.play('wheelClose');
  if (!id || discard || !g.player.alive || g.deathT >= 0) return;
  if (id === 'medkit') { const inv = g.pcombat.inv; if (inv.medkits > 0 && g.player.health < g.player.maxHealth) { inv.medkits--; g.player.health = Math.min(g.player.maxHealth, g.player.health + 60); audio?.play('pickup'); ui.toast('+60 health', 'info'); } }
  else if (selectSlot(g.pcombat.inv, id)) audio?.play('equip');
}

// ---------------- Per-frame UI glue ----------------
function frame(raw: number) {
  const g = game!, a = activities!;
  const input = g.input;
  // pause / map
  if (input.justPressed('pause') && !a.shopIsOpen) { if (g.paused) { /* UI handles Esc in menus */ } else pause(); }
  if (mapByKey && g.paused && !ui.isMenuOpen()) { mapByKey = false; resume(); }
  if (!g.paused && !ui.isMenuOpen() && !a.shopIsOpen && input.justPressed('map')) {
    if (g.wheelOpen) closeWheel();
    g.paused = true; mapByKey = true; audio?.setPausedMuffle(true); ourUnlock = true; g.input.exitLock(); ui.openMap(minimapState());
  }
  // WASTED / ARRESTED pacing (real time, so it also runs while the world is in slow motion)
  if (g.deathT >= 0 && !g.paused) {
    const d = ui.advanceDeath(raw);
    setGrade(g, d.grade);
    if (d.respawn || g.deathT > 20) g.respawnDelay = 0;
  }
  if (!g.paused) {
    // wheel (hold)
    const canWheel = !g.playerVehicle && g.player.alive && g.deathT < 0 && !a.shopIsOpen;
    if (canWheel && input.held('wheel') && !g.wheelOpen) openWheel();
    if (g.wheelOpen) {
      const pad = input.pad;
      ui.updateWheel(input.mouseDX + (pad.connected ? pad.rx * 30 : 0), input.mouseDY + (pad.connected ? pad.ry * 30 : 0));
      // COMBAT: scrolling over a category slot steps through the weapons in it
      const scroll = input.justPressed('nextWeapon') ? 1 : input.justPressed('prevWeapon') ? -1 : 0;
      const hl = scroll ? ui.peekWheel?.() : null;
      if (hl && scroll && scrollSlot(g.pcombat.inv, hl, scroll)) { ui.openWheel(wheelSlots(), hl); audio?.play('uiHover'); }
      if (!input.held('wheel') || !canWheel) closeWheel();
    }
    ctx!.tickDialogue(raw * g.timeScale);
    sandbox?.update();
    a.update(raw * g.timeScale);
    autosaveT += raw;
    if (autosaveT > 60 && g.deathT < 0 && !g.playerVehicle) { autosaveT = 0; saveGame(); }
  }
  // HUD
  const hud = g.hudState(null, null);
  hud.interactPrompt = a.prompt() ?? hud.interactPrompt;
  ui.updateHud(hud);
  ui.updateMinimap(minimapState());
}
let gps: GpsRouter | null = null;
function minimapState() {
  const g = game!;
  const yaw = g.playerVehicle ? g.playerVehicle.yaw : g.cam.yaw + Math.PI;
  // heading: 0 = facing north (-z), positive clockwise. Facing (sin yaw, cos yaw) in x/z.
  const heading = Math.atan2(Math.sin(yaw), -Math.cos(yaw));
  const blips = [...g.baseBlips(), ...activities!.blips()];
  const heat = g.police.heat > 0 && !g.police.state.seen ? { x: g.police.state.lastSeen.x, z: g.police.state.lastSeen.z, r: g.police.state.searchRadius() } : null;
  // GPS: follow the lane graph (roads, ramps, bridges) to the waypoint
  const goal = blips.find(b => b.kind === 'waypoint');
  let route: { x: number; z: number }[] | undefined;
  if (goal && Math.hypot(goal.x - g.player.pos.x, goal.z - g.player.pos.z) > 30) {
    gps ??= new GpsRouter(g.city);
    route = gps.get(performance.now() / 1000, g.player.pos.x, g.player.pos.z, goal.x, goal.z);
  }
  return { x: g.player.pos.x, z: g.player.pos.z, heading, zoom: g.playerVehicle ? 1 + Math.min(1, Math.abs(g.playerVehicle.speed) / 30) : 1, blips, heatRadius: heat, route };
}

/** Test / debugging surface used by the automated playthrough tests. */
function exposeApi() {
  window.__meridian = {
    game, activities, sandbox, ui, settings, PLAYER_LOOK, ctx,
    save: () => saveGame(), read: () => readSave(storage),
    pause, resume, openWheel, closeWheel, quit: quitToTitle,
    /** the GPS route the minimap would draw for the current waypoint (null when none) */
    gps: () => minimapState().route ?? null,
  };
}

// ---------------- Highway mode (endless traffic driving; shares the renderer, never loads the city) ----------------
async function openHighway(auto?: { kind?: string; time?: string; density?: number }) {
  const hw = await import('./highway/hud');
  const start = async (c: { kind: import('./vehicles/specs').VehicleKind; time: 'night' | 'dusk' | 'day'; density: number }) => {
    const { HighwayGame } = await import('./highway');
    void audio?.resume();
    // reuse the city renderer when the title flyover is running (its geometry already lives on that GL context)
    const shared = game ? game.renderer.renderer : null;
    game?.stop();
    ui.setHudVisible(false);
    const renderer = shared ?? new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    if (!shared) { renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; }
    started = true; attract = null;
    const g = new HighwayGame({ renderer, model: c.kind, time: c.time, density: c.density, onQuit: () => { location.href = location.pathname; } });
    window.__highway = g;
    g.start();
  };
  if (auto) { await start({ kind: (auto.kind ?? 'sedan') as never, time: (auto.time ?? 'night') as never, density: auto.density ?? 1 }); return; }
  hw.showHighwayMenu(c => { void start(c); }, () => { showTitle(); });
}

// ---------------- Boot ----------------
if (!webglOk()) {
  ui.showMobileGate();
} else if (isMobile()) {
  ui.showMobileGate();
} else if (params.get('highway') === '1') {
  // direct boot into the highway (no city): ?highway=1&car=coupe&time=night&traffic=1
  void openHighway({ kind: params.get('car') ?? undefined, time: params.get('time') ?? undefined, density: Number(params.get('traffic') ?? '1') });
} else if (params.get('autostart') === '1') {
  void play(params.get('continue') === '1', params.get('mode') === 'regular' ? 'regular' : 'sandbox'); // tests default to the sandbox (cheats on)
} else {
  // loading screen -> live city flyover behind the title menu
  ui.showLoading(0, 'Preparing the city');
  window.addEventListener('pointerdown', () => void audio?.resume(), { once: true, capture: true });
  window.addEventListener('keydown', () => void audio?.resume(), { once: true, capture: true });
  bootWorld((f, l) => { if (!started) ui.showLoading(f, l); })
    .then(g => {
      if (started) return;
      startAttract(g);
      ui.setBackdropLive(true);
      ui.hideLoading();
      showTitle();
      // title-screen debug: jump the flyover to shot i at t seconds (used for screenshots)
      const shot = (i: number, t = 0) => { if (attract) { attract.shot = i % ATTRACT_SHOTS.length; attract.t = t; attract.dipped = false; enterShot(g, attract.shot); } };
      (window as unknown as { __title?: unknown }).__title = { game: g, ui, settings, shot };
    })
    .catch(e => { console.error(e); ui.showLoading(1, 'Something went wrong while loading. Please reload the page.'); });
}
document.title = 'Meridian Afterglow';
