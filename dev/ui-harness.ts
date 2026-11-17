// UI harness: renders the UI with a real city and fake game state.
// ?screen=title|loading|hud|pause|settings|controls|wheel|shop|map|death|mobile|card  (&tab=keys &kind=busted|failed|passed &veh=1 &conflict=1 &save=0)
import '../src/style.css';
import { UI } from '../src/ui/ui';
import { generateCity } from '../src/world/citymap';
import { DEFAULT_SETTINGS, type Settings } from '../src/core/settings';
import type { HudState, MinimapState, ShopItem } from '../src/ui/contracts';

const q = new URLSearchParams(location.search);
const screen = q.get('screen') ?? 'hud';
const log: string[] = [];
(window as unknown as { uiLog: string[] }).uiLog = log;

// Fake game backdrop: a warm street-at-dusk gradient with silhouettes, so the HUD is judged over a busy image.
function paintScene() {
  const c = document.getElementById('scene') as HTMLCanvasElement;
  c.width = innerWidth; c.height = innerHeight;
  const g = c.getContext('2d');
  if (!g) return;
  const sky = g.createLinearGradient(0, 0, 0, c.height);
  sky.addColorStop(0, '#5c8a96'); sky.addColorStop(0.45, '#e9b48a'); sky.addColorStop(0.6, '#f3cf9f'); sky.addColorStop(0.61, '#6b6460'); sky.addColorStop(1, '#3b3a3c');
  g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let x = -20; x < c.width; x += 40 + rnd() * 60) {
    const hgt = 80 + rnd() * 260;
    g.fillStyle = `rgba(${40 + rnd() * 30},${55 + rnd() * 30},${62 + rnd() * 30},0.9)`;
    g.fillRect(x, c.height * 0.61 - hgt, 50 + rnd() * 70, hgt);
  }
  g.fillStyle = '#d9d2c0';
  for (let i = 0; i < 6; i++) g.fillRect(c.width / 2 - 4 - i * 2, c.height * 0.62 + i * i * 9 + i * 20, 8 + i * 4, 10 + i * 6);
}
paintScene();

const city = generateCity();
const settings: Settings = structuredClone(DEFAULT_SETTINGS);
if (q.get('conflict')) settings.bindings.forward = ['KeyE', 'ArrowUp'];
const ui = new UI();
(window as unknown as { ui: UI }).ui = ui;
let pendingCapture: ((code: string) => void) | null = null;
const onKey = (e: KeyboardEvent) => { if (pendingCapture) { e.preventDefault(); const cb = pendingCapture; pendingCapture = null; cb(e.code); } };
const onMouse = (e: MouseEvent) => { if (pendingCapture) { e.preventDefault(); const cb = pendingCapture; pendingCapture = null; cb(`Mouse${e.button}`); } };
window.addEventListener('keydown', onKey);
window.addEventListener('mousedown', onMouse);
ui.init({
  city, settings, callbacks: {
    onStart: c => log.push(`start:${c}`),
    onResume: () => log.push('resume'),
    onQuitToTitle: () => { log.push('quit'); ui.showTitle(true); },
    onSettingsChanged: s => log.push(`settings:${s.quality}:${s.master}`),
    onQualityChanged: qn => log.push(`quality:${qn}`),
    onSetWaypoint: (x, z) => log.push(`waypoint:${x.toFixed(0)},${z.toFixed(0)}`),
    onUiSound: () => {},
    captureKey: cb => { pendingCapture = cb; },
  },
});

const veh = q.get('veh') === '1';
const hud: HudState = {
  health: 72, maxHealth: 100, armor: 40, money: 12450, heat: 3, heatMax: 5, heatFlash: q.get('flash') === '1',
  weaponName: 'Vela 9 Pistol', weaponIcon: (q.get('weapon') as HudState['weaponIcon']) ?? 'pistol', ammoClip: 9, ammoReserve: 48, reloading: false,
  objective: 'Follow the courier van to the Cannery Docks without being spotted',
  vehicleSpeedKmh: veh ? 87 : null, vehicleName: veh ? 'Calloway Sprint' : null, vehicleHealth: veh ? 0.68 : null,
  district: 'Saltwater Strand', streetName: 'Boardwalk St', clock: '18:42',
  crosshair: (q.get('crosshair') as HudState['crosshair']) ?? 'aim', crosshairSpread: 0.3, hitMarker: q.get('hit') ? 1 : 0,
  interactPrompt: veh ? null : 'F  Enter vehicle', radio: veh ? 'KMRD 88.4 Golden Hour' : null, missionTimer: 94, stamina: 0.6, fps: 60,
};
const mini: MinimapState = {
  x: -140, z: 260, heading: 0.45, zoom: 1,
  blips: [
    { x: -60, z: 230, kind: 'mission', label: 'The Long Haul', pulse: true },
    { x: -200, z: 300, kind: 'shop', label: 'Corner Store' },
    { x: -120, z: 150, kind: 'arms', label: 'Ironclad Arms' },
    { x: 140, z: 380, kind: 'garage', label: 'Pinwheel Garage' },
    { x: -330, z: 120, kind: 'safehouse', label: 'Safehouse' },
    { x: -150, z: 300, kind: 'enemy' }, { x: -170, z: 290, kind: 'enemy' },
    { x: -100, z: 330, kind: 'police' }, { x: -120, z: 200, kind: 'vehicle' },
    { x: -185, z: 230, kind: 'collectible' }, { x: 300, z: -300, kind: 'target', label: 'Target' },
    { x: -40, z: 300, kind: 'checkpoint' }, { x: 260, z: 60, kind: 'waypoint' },
  ],
  route: [{ x: -140, z: 260 }, { x: -150, z: 260 }, { x: -150, z: 200 }, { x: -50, z: 200 }, { x: 50, z: 200 }, { x: 50, z: 100 }, { x: 250, z: 100 }, { x: 250, z: 60 }],
  heatRadius: { x: -110, z: 240, r: 70 },
};
const shopItems: ShopItem[] = [
  { id: 'pistol', label: 'Vela 9 Pistol', description: 'Reliable sidearm. Quick to draw, forgiving recoil.', price: 400, owned: true },
  { id: 'smg', label: 'Hornet SMG', description: 'Fast, light and hungry for ammo. Great from a car window.', price: 1800 },
  { id: 'shotgun', label: 'Breaker 12 Shotgun', description: 'Devastating up close. Pump action, six shells.', price: 2600 },
  { id: 'rifle', label: 'Longshore Carbine', description: 'Accurate at range with a steady three-round rhythm.', price: 5200 },
  { id: 'armor', label: 'Kevlite Vest', description: 'Restores armor to full.', price: 350 },
  { id: 'ammo', label: 'Ammo crate', description: 'Tops up every weapon you carry.', price: 250, disabled: true },
];

(window as unknown as { __h: HudState }).__h = hud;
ui.setHudVisible(true);
let money = hud.money;
function frame() {
  hud.money = money;
  ui.updateHud(hud);
  ui.updateMinimap(mini);
  requestAnimationFrame(frame);
}
if (!['title', 'loading', 'mobile'].includes(screen)) frame();

const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
const clickText = (sel: string, text: string) => {
  const el = Array.from(document.querySelectorAll<HTMLElement>(sel)).find(e => e.textContent?.includes(text));
  el?.click();
  return !!el;
};

async function run() {
  switch (screen) {
    case 'title': ui.showTitle(q.get('save') !== '0'); break;
    case 'loading': ui.showLoading(0.62, 'Raising the skyline'); break;
    case 'mobile': ui.showMobileGate(); break;
    case 'hud':
      ui.toast('Picked up Hornet SMG', 'info');
      ui.toast('+$250 delivery bonus', 'money');
      ui.toast('Patrols are searching the area', 'heat');
      ui.subtitle('Keep your distance. If he spots you, the whole deal is off.', 'Desi');
      ui.showControlsHint('Hold [Tab] to open the wheel. Time slows while you choose.', 30);
      await delay(400);
      money += 250;
      break;
    case 'pause': ui.setPaused(true); break;
    case 'settings':
      ui.setPaused(true); await delay(50);
      clickText('.ma-pause .ma-menu-item', 'Settings');
      await delay(50);
      if (q.get('tab')) clickText('.ma-tab', q.get('tab') === 'keys' ? 'Key bindings' : q.get('tab') === 'audio' ? 'Audio' : 'Input');
      break;
    case 'controls': ui.setPaused(true); await delay(50); clickText('.ma-pause .ma-menu-item', 'Controls'); break;
    case 'wheel':
      ui.openWheel([
        { id: 'fists', label: 'Fists', icon: 'fists', detail: '—', enabled: true },
        { id: 'pistol', label: 'Vela 9', icon: 'pistol', detail: '9 / 48', enabled: true },
        { id: 'smg', label: 'Hornet', icon: 'smg', detail: '30 / 120', enabled: true },
        { id: 'shotgun', label: 'Breaker 12', icon: 'shotgun', detail: '6 / 18', enabled: true },
        { id: 'rifle', label: 'Longshore', icon: 'rifle', detail: '0 / 0', enabled: false },
        { id: 'medkit', label: 'Med kit', icon: 'medkit', detail: '×2', enabled: true },
        { id: 'armor', label: 'Vest', icon: 'armor', detail: '×1', enabled: true },
      ], 'pistol');
      ui.updateWheel(40, 30);
      break;
    case 'shop':
      ui.openShop('Ironclad Arms', shopItems, money, id => { log.push(`buy:${id}`); const it = shopItems.find(i => i.id === id); if (it) { money -= it.price; it.owned = true; } ui.refreshShop(shopItems, money); }, () => log.push('shopclose'));
      break;
    case 'map': ui.openMap(mini); break;
    case 'death': ui.showDeath(q.get('kind') === 'busted' ? 'busted' : 'down', q.get('kind') === 'busted' ? 'Bail posted: $500. Weapons confiscated.' : 'Patched up at St. Solace Clinic. Hospital bill: $300.'); break;
    case 'card': {
      const k = (q.get('kind') as 'start' | 'passed' | 'failed') ?? 'start';
      ui.missionCard('The Long Haul', k === 'passed' ? 'Reward  +$2,500' : k === 'failed' ? 'The courier got away.' : 'Tail the courier from the Strand to the docks.', k);
      break;
    }
  }
  await delay(Number(q.get('wait') ?? 1300));
  document.title = 'ready';
}
run().catch(e => { document.title = 'error'; const pre = document.createElement('pre'); pre.textContent = String(e?.stack ?? e); document.body.appendChild(pre); });
