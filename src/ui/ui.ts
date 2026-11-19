/**
 * Meridian Afterglow UI layer: screens, HUD, wheel, shop, map and sandbox tools. Implements GameUI from ./contracts.
 * Plain DOM + Canvas 2D + inline SVG. One full-screen root overlay (pointer-events: none except on panels).
 */
import '@fontsource/barlow-condensed/latin-600.css';
import '@fontsource/barlow-condensed/latin-700.css';
import '@fontsource/barlow-condensed/latin-800.css';
import '@fontsource/barlow-condensed/latin-800-italic.css';
import '@fontsource/barlow-condensed/latin-900-italic.css';
import '@fontsource/barlow/latin-500.css';
import '@fontsource/barlow/latin-600.css';
import '@fontsource/barlow/latin-700.css';
import './ui.css';
import { DEFAULT_SETTINGS, keyLabel, type Action, type Settings } from '../core/settings';
import type { CityMap } from '../world/citymap';
import type { GameUI, HudState, MinimapState, ShopItem, UICallbacks, WheelSlot, SandboxAction, DeathOpts } from './contracts';
import { button, h, renderKeyText, setClass } from './dom';
import { Hud, Notices } from './hud';
import { CityPainter } from './mapdraw';
import { FullMap } from './fullmap';
import { Wheel } from './wheel';
import { Shop } from './shop';
import { SettingsPanel } from './settingsPanel';
import { ControlsPanel } from './controlsPanel';
import { SandboxPanel } from './sandbox';
import { buildCard, buildCredits, buildDeath, buildLoading, buildMobileGate, logo, titleArtSvg, DEATH_TIMING, deathGrade } from './screens';
import { formatMoney } from './geometry';

type NavAction = 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'tabPrev' | 'tabNext' | 'zoomIn' | 'zoomOut';
type LayerId = 'title' | 'confirm' | 'pause' | 'settings' | 'controls' | 'map' | 'shop' | 'sandbox' | 'credits';
interface Layer { id: LayerId; el: HTMLElement; back: () => void; action?: (a: NavAction) => boolean; openedAt: number; prevFocus: Element | null }
type PauseTab = 'map' | 'sandbox' | 'settings' | 'controls' | 'quit';
const PAUSE_TABS: { id: PauseTab; label: string }[] = [
  { id: 'map', label: 'Map' }, { id: 'sandbox', label: 'Sandbox' },
  { id: 'settings', label: 'Settings' }, { id: 'controls', label: 'Controls' }, { id: 'quit', label: 'Quit' },
];
/** Pause tabs that open their own layer docked under the pause header. */
const DOCKED: Partial<Record<PauseTab, LayerId>> = { map: 'map', sandbox: 'sandbox', settings: 'settings', controls: 'controls' };
const DOCKABLE = new Set<LayerId>(['map', 'sandbox', 'settings', 'controls']);
export const GAME_VERSION = 'v0.3.0';
const TITLE_ITEMS: Record<string, string> = {
  play: 'Sandbox: a pistol, some cash and a whole city. Spawn cars, set the wanted level or time, teleport: Esc, then the Sandbox tab.',
  continue: 'Pick up where you left off: your cash, guns, spot in the city and the time of day.',
  settings: 'Graphics, audio, camera and controls.',
  controls: 'Every key and gamepad button.',
  credits: 'Who made this, and the open assets and fonts it uses.',
};

interface Session { time: number; earned: number; spent: number; passed: number; topSpeed: number; distance: number; maxHeat: number; postcards: string | null; lastMoney: number | null; lastT: number }
const freshSession = (): Session => ({ time: 0, earned: 0, spent: 0, passed: 0, topSpeed: 0, distance: 0, maxHeat: 0, postcards: null, lastMoney: null, lastT: 0 });

const NOOP_CALLBACKS: UICallbacks = {
  onStart: () => {}, onResume: () => {}, onQuitToTitle: () => {}, onSettingsChanged: () => {}, onQualityChanged: () => {},
  onSetWaypoint: () => {}, onUiSound: () => {}, captureKey: () => {}, onSandbox: () => {}, onOpenSandbox: () => {},
};

function footHints(pairs: [string, string][], cls = 'ma-foot-hints'): HTMLDivElement {
  const el = h('div', cls);
  for (const [k, t] of pairs) {
    const s = h('span', 'ma-foot-hint');
    s.appendChild(h('kbd', 'ma-key', k)); s.appendChild(document.createTextNode(t));
    el.appendChild(s);
  }
  return el;
}

export class UI implements GameUI {
  private root: HTMLDivElement;
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private callbacks: UICallbacks = NOOP_CALLBACKS;
  private city: CityMap | null = null;
  private hud: Hud | null = null;
  private fullmap: FullMap | null = null;
  private hudLayer: HTMLDivElement;
  private bottomStack: HTMLDivElement;
  private notices = new Notices();
  private wheel: Wheel;
  private shop: Shop;
  private settingsPanel: SettingsPanel;
  private controlsPanel: ControlsPanel;
  private sandbox: SandboxPanel;
  private sandboxClose: () => void = () => {};
  private titleEl: HTMLDivElement;
  private titleMenu: HTMLDivElement;
  private titleDesc!: HTMLDivElement;
  private titleShotName!: HTMLDivElement;
  private titleShotCap!: HTMLDivElement;
  private titleDipEl!: HTMLDivElement;
  private titlePressed = false;
  private credits = buildCredits();
  private confirmEl: HTMLDivElement;
  private confirmText: HTMLDivElement;
  private confirmYes: HTMLButtonElement;
  private confirmAction: () => void = () => {};
  private pauseEl: HTMLDivElement;
  private pauseTabs = new Map<PauseTab, HTMLButtonElement>();
  private pausePanes = new Map<PauseTab, HTMLDivElement>();
  private pauseTab: PauseTab = 'map';
  private pauseInline: PauseTab = 'quit';
  private pauseClock!: HTMLDivElement;
  private pauseMoney!: HTMLDivElement;
  private pausePlace!: HTMLDivElement;
  private saveItem!: HTMLButtonElement;
  private loading = buildLoading();
  private loadingOpen = false;
  private loadingHideTimer = 0;
  private tipTimer = 0;
  private tipIndex = -1;
  private stillIndex = Math.floor(Math.random() * 8) - 1;
  private mobileEl: HTMLDivElement | null = null;
  private death = buildDeath();
  private deathSeq: { kind: 'down' | 'busted'; t: number; waiting: boolean; waitT: number; respawned: boolean } | null = null;
  private deathFadeTimer = 0;
  private card = buildCard();
  private cardTimer = 0;
  private layers: Layer[] = [];
  private hudVisible = true;
  private lastHud: HudState | null = null;
  private lastMinimap: MinimapState | null = null;
  private session: Session = freshSession();
  private capturing = false;
  private swallowClickUntil = 0;
  private padRaf = 0;
  private padPrev: boolean[] | null = null;
  private padRepeat = new Map<string, number>();
  private padLast = 0;
  private hasSave = false;

  constructor() {
    this.root = h('div', 'ma-root');
    this.root.setAttribute('data-ui', 'meridian');
    this.hudLayer = h('div', 'ma-hud-layer');
    this.root.appendChild(this.hudLayer);
    const noticeLayer = h('div', 'ma-notice-layer');
    const tl = h('div', 'ma-notice-tl');
    tl.append(this.notices.hint, this.notices.toasts);
    this.bottomStack = h('div', 'ma-bottom-stack');
    this.bottomStack.appendChild(this.notices.subtitleEl);
    noticeLayer.append(tl, this.bottomStack, this.card.el);
    this.root.appendChild(noticeLayer);

    const sound = (k: 'click' | 'hover' | 'back') => this.sound(k);
    this.wheel = new Wheel(sound);
    this.root.appendChild(this.wheel.el);
    this.root.appendChild(this.death.el);

    this.pauseEl = this.buildPause();
    this.root.appendChild(this.pauseEl);
    this.shop = new Shop(sound);
    this.root.appendChild(this.shop.el);
    this.settingsPanel = new SettingsPanel({
      get: () => this.settings,
      set: (s, q) => this.applySettings(s, q),
      sound,
      captureKey: cb => this.callbacks.captureKey(code => { if (code.startsWith('Mouse')) this.swallowClickUntil = performance.now() + 2000; cb(code); }),
      setCapturing: on => { this.capturing = on; this.root.classList.toggle('is-capturing', on); },
      onBack: () => this.popLayer('settings'),
    });
    this.root.appendChild(this.settingsPanel.el);
    this.controlsPanel = new ControlsPanel(sound, () => this.popLayer('controls'));
    this.root.appendChild(this.controlsPanel.el);
    this.sandbox = new SandboxPanel(sound, () => this.requestSandboxClose());
    this.root.appendChild(this.sandbox.el);
    const c = this.buildConfirm();
    this.confirmEl = c.el; this.confirmText = c.text; this.confirmYes = c.yes;
    this.root.appendChild(this.confirmEl);
    const t = this.buildTitle();
    this.titleEl = t.el; this.titleMenu = t.menu;
    this.root.appendChild(this.titleEl);
    this.root.appendChild(this.credits.el);
    this.credits.back.addEventListener('click', () => { this.sound('back'); this.popLayer('credits'); });
    this.root.appendChild(this.loading.el);

    window.addEventListener('keydown', this.onKeyDown, true);
    // After a mouse button is captured for rebinding, swallow the click it produces (until that button is released).
    for (const type of ['click', 'auxclick', 'contextmenu'] as const) {
      window.addEventListener(type, e => {
        if (performance.now() < this.swallowClickUntil) { e.preventDefault(); e.stopPropagation(); }
      }, true);
    }
    window.addEventListener('mouseup', () => {
      if (performance.now() < this.swallowClickUntil) window.setTimeout(() => { this.swallowClickUntil = 0; }, 0);
    }, true);
    this.root.addEventListener('pointerover', e => {
      const top = this.top();
      const t = (e.target as Element | null)?.closest?.('[data-nav]') as HTMLElement | null;
      if (!top || !t || !top.el.contains(t) || t === document.activeElement || (t as HTMLButtonElement).disabled) return;
      if (t instanceof HTMLInputElement) return;
      t.focus({ preventScroll: true });
      this.sound('hover');
    });
    this.root.addEventListener('contextmenu', e => { if (this.layers.length) e.preventDefault(); });
    // Canvas text (radar, city map) uses the bundled faces: make sure they are loaded before the first draw.
    try { void document.fonts?.load('800 12px "Barlow Condensed"'); void document.fonts?.load('700 12px "Barlow Condensed"'); } catch { /* optional */ }
    const attach = () => { if (!this.root.isConnected) document.body.appendChild(this.root); };
    if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach, { once: true });
  }

  // ---------------------------------------------------------------- setup
  init(opts: { city: CityMap; settings: Settings; callbacks: UICallbacks }): void {
    this.city = opts.city;
    this.settings = structuredClone(opts.settings);
    this.callbacks = opts.callbacks;
    const painter = new CityPainter(opts.city);
    if (this.hud) { this.hud.el.remove(); this.hud.objectiveEl.remove(); }
    this.hud = new Hud(opts.city, painter);
    this.hudLayer.appendChild(this.hud.el);
    this.bottomStack.appendChild(this.hud.objectiveEl);
    if (this.fullmap) this.fullmap.el.remove();
    this.fullmap = new FullMap(opts.city, painter, (x, z) => this.callbacks.onSetWaypoint(x, z), () => this.popLayer('map'), k => this.sound(k));
    this.pauseEl.after(this.fullmap.el);
  }

  private sound(k: 'click' | 'hover' | 'back') { try { this.callbacks.onUiSound(k); } catch { /* audio is optional */ } }

  private applySettings(s: Settings, qualityChanged: boolean) {
    this.settings = s;
    this.callbacks.onSettingsChanged(structuredClone(s));
    if (qualityChanged) this.callbacks.onQualityChanged(s.quality);
  }

  // ---------------------------------------------------------------- title
  private buildTitle() {
    const el = h('div', 'ma-layer ma-title');
    el.innerHTML = titleArtSvg();
    el.appendChild(h('div', 'ma-title-shade'));
    el.appendChild(h('div', 'ma-title-bars'));
    const content = h('div', 'ma-title-content');
    content.appendChild(logo('ma-logo-title'));
    const tag = h('div', 'ma-title-mode');
    tag.append(h('span', 'ma-title-mode-badge', 'Sandbox'), h('span', 'ma-title-mode-text', 'Open-world sandbox'));
    content.appendChild(tag);
    const menu = h('div', 'ma-menu ma-title-menu');
    content.appendChild(menu);
    this.titleDesc = h('div', 'ma-title-desc');
    content.appendChild(this.titleDesc);
    el.appendChild(content);
    const press = h('div', 'ma-title-press');
    press.appendChild(h('span', 'ma-title-press-text', 'Press any key'));
    el.appendChild(press);
    const shot = h('div', 'ma-title-shot');
    this.titleShotName = h('div', 'ma-title-shot-name');
    this.titleShotCap = h('div', 'ma-title-shot-cap');
    shot.append(this.titleShotName, this.titleShotCap);
    el.appendChild(shot);
    const foot = h('div', 'ma-title-foot');
    const legal = h('span', 'ma-legal');
    legal.append(h('b', '', GAME_VERSION), document.createTextNode('  ·  An original game. Every place, person and brand in Port Meridian is fictional.'));
    foot.appendChild(legal);
    foot.appendChild(footHints([['↑↓', 'Select'], ['Enter', 'Confirm'], ['Esc', 'Back']]));
    el.appendChild(foot);
    this.titleDipEl = h('div', 'ma-title-dip');
    el.appendChild(this.titleDipEl);
    el.addEventListener('pointerdown', () => { if (!this.titlePressed && this.top()?.id === 'title') this.revealTitleMenu(); });
    return { el, menu };
  }

  private menuItem(label: string, onClick: () => void, disabled = false, key = '') {
    const b = h('button', 'ma-menu-item');
    b.type = 'button';
    b.dataset.nav = '';
    if (key) b.dataset.item = key;
    b.disabled = disabled;
    b.appendChild(h('span', 'ma-mi-label', label));
    b.addEventListener('click', () => { if (!b.disabled) onClick(); });
    if (key && TITLE_ITEMS[key]) b.addEventListener('focus', () => { this.titleDesc.textContent = TITLE_ITEMS[key]; });
    return b;
  }

  showTitle(hasSave: boolean): void {
    this.hasSave = hasSave;
    this.closeAllLayers();
    this.wheel.hide();
    this.hideDeath();
    this.notices.subtitle(null);
    this.hud?.robbery(null);
    this.session = freshSession();
    this.titleMenu.textContent = '';
    const start = (cont: boolean) => { this.sound('click'); this.closeAllLayers(); this.titleEl.classList.add('is-starting'); this.callbacks.onStart(cont); };
    const play = this.menuItem('Play', () => {
      if (this.hasSave) this.confirm('Start a new game? Your saved game will be replaced the next time you save.', 'Start new game', () => start(false));
      else start(false);
    }, false, 'play');
    const items = [play];
    let cont: HTMLButtonElement | null = null;
    if (hasSave) { cont = this.menuItem('Continue', () => start(true), false, 'continue'); items.unshift(cont); }
    items.push(
      this.menuItem('Settings', () => { this.sound('click'); this.openSettings(); }, false, 'settings'),
      this.menuItem('Controls', () => { this.sound('click'); this.openControls(); }, false, 'controls'),
      this.menuItem('Credits', () => { this.sound('click'); this.openCredits(); }, false, 'credits'),
    );
    this.titleMenu.append(...items);
    this.titleEl.classList.remove('is-starting');
    setClass(this.titleEl, 'is-pressed', this.titlePressed);
    this.pushLayer({ id: 'title', el: this.titleEl, back: () => {} }, this.titlePressed ? (cont ?? play) : undefined);
    if (!this.titlePressed) { (document.activeElement as HTMLElement | null)?.blur?.(); this.titleEl.tabIndex = -1; this.titleEl.focus({ preventScroll: true }); }
  }
  /** "Press any key" -> the logo settles and the menu slides in. */
  private revealTitleMenu() {
    if (this.titlePressed) return;
    this.titlePressed = true;
    this.titleEl.classList.add('is-pressed');
    this.sound('click');
    const first = this.titleMenu.querySelector<HTMLElement>('[data-nav]');
    if (first) first.focus({ preventScroll: true });
  }
  /** Title backdrop: the running game renders the city behind the menu (the painted skyline is the fallback). */
  setBackdropLive(live: boolean): void { setClass(this.titleEl, 'is-live', live); }
  /** Flyover shot changed: caption bottom-right. */
  titleShot(name: string, caption: string): void {
    this.titleShotName.textContent = name;
    this.titleShotCap.textContent = caption;
    const p = this.titleShotName.parentElement!;
    p.classList.remove('is-in'); void p.offsetWidth; p.classList.add('is-in');
    this.titleDipEl.classList.remove('is-dip');
  }
  /** Dip to black ahead of a cut between flyover shots. */
  titleDip(): void { this.titleDipEl.classList.add('is-dip'); }
  hideTitle(): void { if (this.layers.some(l => l.id === 'title')) this.popLayer('title', false); this.titleEl.classList.remove('is-starting'); }

  private openCredits() {
    this.pushLayer({ id: 'credits', el: this.credits.el, back: () => { this.sound('back'); this.popLayer('credits'); },
      action: a => { if (a === 'up' || a === 'down') { this.credits.scroller.scrollBy({ top: a === 'up' ? -90 : 90 }); return true; } return false; } }, this.credits.back);
  }

  // ---------------------------------------------------------------- confirm
  private buildConfirm() {
    const el = h('div', 'ma-layer ma-modal-layer ma-confirm');
    el.setAttribute('role', 'alertdialog');
    const panel = h('div', 'ma-panel ma-confirm-panel');
    panel.appendChild(h('div', 'ma-confirm-head', 'Are you sure?'));
    const text = h('div', 'ma-confirm-text');
    panel.appendChild(text);
    const row = h('div', 'ma-foot-actions');
    row.dataset.navRow = '';
    const no = button('ma-btn ma-btn-ghost', 'Cancel', { onClick: () => { this.sound('back'); this.popLayer('confirm'); } });
    const yes = button('ma-btn ma-btn-primary', 'Confirm', { onClick: () => { this.sound('click'); this.popLayer('confirm'); this.confirmAction(); } });
    row.append(no, yes);
    panel.appendChild(row);
    el.appendChild(panel);
    return { el, text, yes };
  }

  private confirm(text: string, yesLabel: string, action: () => void) {
    this.confirmText.textContent = text;
    this.confirmYes.textContent = yesLabel;
    this.confirmAction = action;
    this.pushLayer({ id: 'confirm', el: this.confirmEl, back: () => { this.sound('back'); this.popLayer('confirm'); } }, this.confirmYes);
  }

  // ---------------------------------------------------------------- loading
  showLoading(fraction: number, label: string): void {
    const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
    if (!this.loadingOpen) {
      this.loadingOpen = true;
      window.clearTimeout(this.loadingHideTimer);
      this.loading.el.classList.remove('is-leaving');
      this.loading.el.classList.add('is-open');
      this.nextTip();
      window.clearInterval(this.tipTimer);
      this.tipTimer = window.setInterval(() => this.nextTip(), 5500);
    }
    this.loading.fill.style.transform = `scaleX(${f.toFixed(4)})`;
    const pct = `${Math.round(f * 100)}%`;
    if (this.loading.pct.textContent !== pct) this.loading.pct.textContent = pct;
    if (this.loading.label.textContent !== label) this.loading.label.textContent = label;
    this.loading.el.setAttribute('aria-valuenow', String(Math.round(f * 100)));
  }

  hideLoading(): void {
    if (!this.loadingOpen) return;
    this.loadingOpen = false;
    window.clearInterval(this.tipTimer);
    this.loading.fill.style.transform = 'scaleX(1)';
    this.loading.pct.textContent = '100%';
    this.loading.el.classList.add('is-leaving');
    window.clearTimeout(this.loadingHideTimer);
    this.loadingHideTimer = window.setTimeout(() => this.loading.el.classList.remove('is-open', 'is-leaving'), 450);
  }

  private nextTip() {
    const tips = this.tips();
    let i = Math.floor(Math.random() * tips.length);
    if (i === this.tipIndex) i = (i + 1) % tips.length;
    this.tipIndex = i;
    const st = this.loading.stills;
    if (st.length) { this.stillIndex = (this.stillIndex + 1) % st.length; st.forEach((e, k) => setClass(e, 'is-on', k === this.stillIndex)); }
    const box = this.loading.tipBox;
    box.classList.remove('is-in'); void box.offsetWidth;
    renderKeyText(this.loading.tip, tips[i]);
    box.classList.add('is-in');
  }

  private keyFor(a: Action) { const c = this.settings.bindings[a]?.[0]; return c ? keyLabel(c) : '?'; }
  private tips(): string[] {
    return [
      `Hold [${this.keyFor('wheel')}] to open the weapon wheel. The city slows down while you choose.`,
      `Press [${this.keyFor('enter')}] next to any car to take the wheel. [${this.keyFor('handbrake')}] is the handbrake.`,
      'Heat fades when patrols lose sight of you. Break line of sight and lie low.',
      `Open the city map with [${this.keyFor('map')}] and click anywhere to drop a waypoint.`,
      `Change the station with [${this.keyFor('radio')}]. Every district has its own sound.`,
      'Armor soaks up damage before your health does. Stores sell it by the vest.',
      `[${this.keyFor('crouch')}] dodge-rolls out of trouble on foot.`,
      'The Glow Garage on 5th St resprays your ride and cools off the police.',
      'Sunset postcards are hidden all over Port Meridian. Each one pays out.',
      'The pause menu has the sandbox tools: spawn any car, set the clock or the wanted level, or teleport across the city.',
      'Aim at a store clerk to start a hold-up. The till empties faster the closer you stand. The alarm brings the police.',
      `Hit [${this.keyFor('pause')}] and pick Save game, or rest at the Lantern Ave safehouse, to keep your cash, guns and spot in the city.`,
    ];
  }

  showMobileGate(): void {
    if (!this.mobileEl) { this.mobileEl = buildMobileGate(); this.root.appendChild(this.mobileEl); }
    this.closeAllLayers();
    this.hideLoading();
    // Portrait phones: crop the skyline art around the sun and the pier wheel.
    const art = this.mobileEl.querySelector('svg.ma-art');
    if (art && window.innerHeight > window.innerWidth) art.setAttribute('viewBox', '820 120 700 780');
    this.mobileEl.classList.add('is-open');
    this.root.classList.add('is-mobile-gate');
  }

  // ---------------------------------------------------------------- pause
  private buildPause() {
    const el = h('div', 'ma-layer ma-pause');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Paused');
    el.appendChild(h('div', 'ma-pause-backdrop'));
    const head = h('div', 'ma-pause-head');
    const brand = h('div', 'ma-pause-brand');
    brand.appendChild(logo('ma-logo-pause'));
    head.appendChild(brand);
    const meta = h('div', 'ma-pause-meta');
    this.pausePlace = h('div', 'ma-pause-place');
    this.pauseClock = h('div', 'ma-pause-clock');
    this.pauseMoney = h('div', 'ma-pause-money');
    meta.append(this.pausePlace, this.pauseClock, this.pauseMoney);
    head.appendChild(meta);
    el.appendChild(head);

    const tabs = h('div', 'ma-pause-tabs');
    tabs.dataset.navRow = '';
    tabs.setAttribute('role', 'tablist');
    for (const t of PAUSE_TABS) {
      const b = button('ma-ptab', t.label, { onClick: () => { if (this.pauseTab !== t.id || DOCKED[t.id]) { this.sound('click'); this.selectPauseTab(t.id); } } });
      b.dataset.tab = t.id;
      b.setAttribute('role', 'tab');
      // Inline tabs follow keyboard focus; tabs that open a full view need Enter / click.
      b.addEventListener('focus', () => { if (!DOCKED[t.id] && this.pauseTab !== t.id && this.top()?.id === 'pause') this.selectPauseTab(t.id); });
      tabs.appendChild(b);
      this.pauseTabs.set(t.id, b);
    }
    el.appendChild(tabs);

    const body = h('div', 'ma-pause-body');
    const pane = h('div', 'ma-pane ma-pane-quit');
    pane.setAttribute('role', 'tabpanel');
    body.appendChild(pane);
    this.pausePanes.set('quit', pane);
    const menu = h('div', 'ma-menu ma-pause-menu');
    menu.appendChild(this.menuItem('Resume', () => { this.sound('click'); this.resume(); }));
    this.saveItem = this.menuItem('Save game', () => {
      const ok = this.callbacks.onSaveGame?.() ?? false;
      this.sound(ok ? 'click' : 'back');
      this.toast(ok ? 'Game saved' : 'Can\'t save right now', ok ? 'info' : 'warning');
      this.refreshPause('quit');
    });
    menu.appendChild(this.saveItem);
    menu.appendChild(this.menuItem('Save & quit to title', () => { this.sound('click'); this.closeAllLayers(); this.callbacks.onQuitToTitle(); }));
    pane.appendChild(menu);
    pane.appendChild(h('div', 'ma-quit-stats'));
    el.appendChild(body);
    el.appendChild(footHints([['Q / E', 'Tabs'], ['↑↓←→', 'Select'], ['Enter', 'Open'], ['Esc', 'Resume']], 'ma-foot-hints ma-pause-foot'));
    return el;
  }

  /** The game is sandbox-only; kept for the GameUI contract. */
  setMode(_mode: 'story' | 'sandbox'): void { /* sandbox only */ }

  setPaused(paused: boolean): void {
    if (paused) {
      if (this.layers.some(l => l.id === 'pause' || l.id === 'title')) return;
      this.wheel.hide();
      this.root.classList.remove('is-wheel');
      this.pauseTab = 'quit'; this.pauseInline = 'quit';
      this.showPaneFor('quit');
      this.pushLayer({
        id: 'pause', el: this.pauseEl, back: () => { this.sound('back'); this.resume(); },
        action: a => { if (a === 'tabPrev' || a === 'tabNext') { this.sound('click'); this.selectPauseTab(this.neighbourTab(this.pauseTab, a === 'tabPrev' ? -1 : 1)); return true; } return false; },
      }, this.pauseTabs.get('map'));
      this.selectPauseTab('map'); // like the genre: pausing opens on the map
    } else {
      const i = this.layers.findIndex(l => l.id === 'pause');
      if (i < 0) return;
      while (this.layers.length > i) this.popTop();
    }
  }

  private neighbourTab(t: PauseTab, dir: number): PauseTab {
    const i = PAUSE_TABS.findIndex(x => x.id === t);
    return PAUSE_TABS[(i + dir + PAUSE_TABS.length) % PAUSE_TABS.length].id;
  }

  /** Marks a tab selected and shows its pane (inline tabs) without touching layers. */
  private showPaneFor(tab: PauseTab) {
    for (const [id, b] of this.pauseTabs) { setClass(b, 'is-selected', id === tab); b.setAttribute('aria-selected', String(id === tab)); }
    const docked = !!DOCKED[tab];
    setClass(this.pauseEl, 'is-docked', docked);
    if (!docked) {
      for (const [id, p] of this.pausePanes) setClass(p, 'is-active', id === tab);
    }
    this.refreshPause(tab);
  }

  private selectPauseTab(tab: PauseTab) {
    if (!this.layers.some(l => l.id === 'pause')) return;
    // Close whatever docked view sits above the pause menu.
    while (this.top() && this.top()!.id !== 'pause') {
      const t = this.top()!;
      if (t.id === 'sandbox') { this.sandbox.hide(); const cb = this.sandboxClose; this.sandboxClose = () => {}; this.popLayer('sandbox', false, true); cb(); }
      else if (DOCKABLE.has(t.id)) this.popLayer(t.id, false, true); else break;
    }
    if (this.top()?.id !== 'pause') return;
    this.pauseTab = tab;
    this.showPaneFor(tab);
    if (tab === 'map') this.openMapLayer(this.lastMinimap ?? this.defaultMapState());
    else if (tab === 'sandbox') this.callbacks.onOpenSandbox();
    else if (tab === 'settings') this.openSettings();
    else if (tab === 'controls') this.openControls();
    else {
      this.pauseInline = tab;
      const b = this.pauseTabs.get(tab);
      if (b && document.activeElement !== b) b.focus({ preventScroll: true });
    }
  }

  /** A docked view was closed: the pause menu shows its last inline tab again. */
  private pauseRevealed() {
    this.pauseTab = this.pauseInline;
    this.showPaneFor(this.pauseInline);
    this.pauseTabs.get(this.pauseInline)?.focus({ preventScroll: true });
  }

  private refreshPause(tab: PauseTab) {
    const s = this.lastHud;
    if (this.pauseClock.textContent !== (s?.clock ?? '')) this.pauseClock.textContent = s?.clock ?? '';
    this.pauseMoney.textContent = s ? formatMoney(s.money) : '';
    this.pausePlace.textContent = s ? s.district : '';
    if (tab === 'quit') this.renderStats();
  }

  private renderStats() {
    const pane = this.pausePanes.get('quit')!.querySelector<HTMLElement>('.ma-quit-stats')!;
    pane.textContent = '';
    const S = this.session;
    pane.appendChild(h('div', 'ma-label ma-stats-head', 'This session'));
    const grid = h('div', 'ma-stats-grid');
    const tile = (label: string, value: string) => {
      const t = h('div', 'ma-stat');
      t.appendChild(h('div', 'ma-label', label));
      t.appendChild(h('div', 'ma-stat-value', value));
      grid.appendChild(t);
    };
    const mins = Math.floor(S.time / 60);
    tile('Time on the streets', mins >= 60 ? `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, '0')}m` : `${mins}m ${String(Math.floor(S.time % 60)).padStart(2, '0')}s`);
    tile('Money earned', formatMoney(S.earned));
    tile('Money spent', formatMoney(S.spent));
    tile('Distance driven', S.distance >= 1000 ? `${(S.distance / 1000).toFixed(1)} km` : `${Math.round(S.distance)} m`);
    tile('Top speed', `${Math.round(S.topSpeed)} km/h`);
    tile('Highest wanted level', S.maxHeat > 0 ? `${S.maxHeat} / 5` : 'Clean');
    if (S.postcards) tile('Postcards found', S.postcards);
    pane.appendChild(grid);
  }

  private resume() {
    this.setPaused(false);
    this.callbacks.onResume();
  }

  isMenuOpen(): boolean { return this.layers.length > 0 || this.loadingOpen || !!this.mobileEl?.classList.contains('is-open'); }

  private openSettings() {
    this.settingsPanel.open();
    this.pushLayer({
      id: 'settings', el: this.settingsPanel.el, back: () => { this.sound('back'); this.popLayer('settings'); },
      action: a => {
        if (a !== 'tabPrev' && a !== 'tabNext') return false;
        const dir = a === 'tabPrev' ? -1 : 1;
        if (this.isDocked() && this.settingsPanel.atEdge(dir)) { this.sound('click'); this.selectPauseTab(this.neighbourTab('settings', dir)); }
        else this.settingsPanel.cycleTab(dir);
        return true;
      },
    });
  }
  private openControls() {
    this.controlsPanel.open(this.settings);
    this.pushLayer({
      id: 'controls', el: this.controlsPanel.el, back: () => { this.sound('back'); this.popLayer('controls'); },
      action: a => {
        if (a === 'up' || a === 'down') { this.controlsPanel.scroller.scrollBy({ top: a === 'up' ? -90 : 90 }); return true; }
        if ((a === 'tabPrev' || a === 'tabNext') && this.isDocked()) { this.sound('click'); this.selectPauseTab(this.neighbourTab('controls', a === 'tabPrev' ? -1 : 1)); return true; }
        return false;
      },
    });
  }
  /** True when a view is docked under the pause header (rather than opened from the title or a key). */
  private isDocked() { return this.layers.some(l => l.id === 'pause'); }

  // ---------------------------------------------------------------- HUD
  setHudVisible(v: boolean): void {
    if (v === this.hudVisible) return;
    this.hudVisible = v;
    this.hudLayer.classList.toggle('is-off', !v);
    this.root.classList.toggle('hud-off', !v);
  }
  updateHud(s: HudState): void {
    this.lastHud = s;
    this.track(s);
    this.hud?.update(s, this.settings.showFps);
  }
  /** Session statistics derived from what the HUD receives (real numbers only). */
  private track(s: HudState) {
    const S = this.session, now = performance.now();
    const dt = S.lastT ? Math.min(0.25, Math.max(0, (now - S.lastT) / 1000)) : 0;
    S.lastT = now;
    if (!this.isMenuOpen()) {
      S.time += dt;
      if (s.vehicleSpeedKmh !== null) {
        const kmh = Math.abs(s.vehicleSpeedKmh);
        S.distance += (kmh / 3.6) * dt;
        if (kmh > S.topSpeed) S.topSpeed = kmh;
      }
    }
    if (S.lastMoney !== null && s.money !== S.lastMoney) {
      const d = s.money - S.lastMoney;
      if (d > 0) S.earned += d; else S.spent -= d;
    }
    S.lastMoney = s.money;
    const heat = Math.max(0, Math.min(5, Math.ceil(s.heat - 0.05)));
    if (heat > S.maxHeat) S.maxHeat = heat;
  }
  updateMinimap(s: MinimapState): void {
    this.lastMinimap = s;
    if (this.hudVisible && !this.isMenuOpen()) this.hud?.minimap.update(s);
    this.fullmap?.update(s);
  }
  toast(text: string, kind: 'info' | 'money' | 'heat' | 'mission' | 'warning' = 'info'): void {
    const pc = /postcard\D{0,12}(\d+)\s*\/\s*(\d+)/i.exec(text);
    if (pc) this.session.postcards = `${pc[1]} / ${pc[2]}`;
    this.notices.toast(text, kind);
  }

  missionCard(title: string, subtitle: string, kind: 'start' | 'passed' | 'failed'): void {
    const c = this.card;
    if (kind === 'passed' && /mission passed/i.test(title)) this.session.passed++;
    c.title.textContent = title;
    // "Lantern Lights  ·  +$1,500" -> mission name + reward
    const m = kind === 'passed' ? /^(.*?)\s+·\s+([+-]?\$[\d,]+)\s*$/.exec(subtitle) : null;
    c.name.textContent = m ? m[1] : '';
    c.reward.textContent = m ? m[2] : '';
    c.sub.textContent = m ? '' : subtitle;
    setClass(c.name, 'is-hidden', !m);
    setClass(c.reward, 'is-hidden', !m);
    setClass(c.sub, 'is-hidden', !!m || !subtitle);
    c.el.classList.remove('is-start', 'is-passed', 'is-failed', 'is-visible', 'is-leaving');
    void c.el.offsetWidth;
    c.el.classList.add(`is-${kind}`, 'is-visible');
    this.root.classList.add('is-card');
    window.clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => {
      c.el.classList.add('is-leaving');
      this.cardTimer = window.setTimeout(() => { c.el.classList.remove('is-visible', 'is-leaving'); this.root.classList.remove('is-card'); }, 450);
    }, kind === 'start' ? 2900 : 3400);
  }

  subtitle(text: string | null, speaker?: string): void { this.notices.subtitle(text, speaker); }

  showDeath(kind: 'down' | 'busted', detail: string, opts: DeathOpts = {}): void {
    const d = this.death;
    d.word.textContent = kind === 'down' ? 'Wasted' : 'Arrested';
    d.detail.textContent = '';
    const m = /^(.*?)\s+([+−-]\$[\d,]+)\s*$/.exec(detail);
    if (m) { d.detail.appendChild(h('span', '', m[1])); d.detail.appendChild(h('span', 'ma-death-fee', m[2].replace('-', '−'))); }
    else d.detail.textContent = detail;
    window.clearTimeout(this.deathFadeTimer);
    d.el.classList.remove('is-down', 'is-busted', 'is-visible', 'is-card', 'is-black', 'is-out');
    void d.el.offsetWidth;
    d.el.classList.add(kind === 'down' ? 'is-down' : 'is-busted', 'is-visible');
    this.root.classList.add('is-dead');
    const seq = { kind, t: 0, waiting: !!opts.arrestAnimationDone, waitT: 0, respawned: false };
    this.deathSeq = seq;
    if (opts.arrestAnimationDone) {
      try { opts.arrestAnimationDone(() => { if (this.deathSeq === seq) seq.waiting = false; }); } catch { seq.waiting = false; }
    }
  }
  /** Paces the WASTED / ARRESTED sequence (call every frame with real seconds). */
  advanceDeath(dt: number): { grade: number; respawn: boolean } {
    const q = this.deathSeq;
    if (!q) return { grade: 0, respawn: false };
    const step = Number.isFinite(dt) ? Math.max(0, Math.min(0.25, dt)) : 0;
    if (q.waiting) { q.waitT += step; if (q.waitT > DEATH_TIMING.maxWait) q.waiting = false; return { grade: 0, respawn: false }; }
    q.t += step;
    const el = this.death.el;
    if (q.t >= DEATH_TIMING.card && !el.classList.contains('is-card')) { el.classList.add('is-card'); this.sound('back'); }
    if (q.t >= DEATH_TIMING.black) el.classList.add('is-black');
    if (q.t >= DEATH_TIMING.respawn && !q.respawned) {
      q.respawned = true;
      this.deathSeq = null;
      // respawned: hold black a beat, then fade back in on the new spot
      el.classList.remove('is-card');
      this.deathFadeTimer = window.setTimeout(() => { el.classList.add('is-out'); this.deathFadeTimer = window.setTimeout(() => this.hideDeath(), 700); }, 120);
      return { grade: 1, respawn: true };
    }
    return { grade: deathGrade(q.t), respawn: false };
  }
  private hideDeath() {
    window.clearTimeout(this.deathFadeTimer);
    this.deathSeq = null;
    this.death.el.classList.remove('is-visible', 'is-card', 'is-black', 'is-out');
    this.root.classList.remove('is-dead');
  }

  showControlsHint(text: string, seconds: number): void { this.notices.showHint(text, seconds); }

  robberyMeter(s: { label: string; progress: number; cash: number } | null): void { this.hud?.robbery(s); }

  // ---------------------------------------------------------------- wheel
  openWheel(slots: WheelSlot[], selectedId: string): void {
    this.wheel.show(slots, selectedId);
    this.root.classList.add('is-wheel');
  }
  updateWheel(dirX: number, dirY: number): void { this.wheel.update(dirX, dirY); }
  peekWheel(): string | null { return this.wheel.peek(); } // COMBAT
  closeWheel(): string | null {
    this.root.classList.remove('is-wheel');
    return this.wheel.hide();
  }

  // ---------------------------------------------------------------- shop
  openShop(title: string, items: ShopItem[], money: number, onBuy: (id: string) => void, onClose: () => void): void {
    if (this.shop.isOpen()) this.popLayer('shop', false);
    this.shop.show(title, items, money, onBuy, () => { this.popLayer('shop', false); onClose(); });
    this.pushLayer({ id: 'shop', el: this.shop.el, back: () => this.shop.requestClose() }, this.shop.el.querySelector<HTMLElement>(':focus') ?? undefined);
  }
  refreshShop(items: ShopItem[], money: number): void { if (this.shop.isOpen()) this.shop.refresh(items, money); }
  closeShop(): void {
    if (!this.shop.isOpen()) return;
    this.shop.hide();
    this.popLayer('shop');
  }

  // ---------------------------------------------------------------- sandbox
  openSandbox(actions: SandboxAction[], onAction: (id: string, value?: number | string | boolean) => void, onClose: () => void): void {
    if (this.sandbox.isOpen()) this.popLayer('sandbox', false);
    this.sandboxClose = onClose;
    this.sandbox.show(actions, onAction);
    this.pushLayer({ id: 'sandbox', el: this.sandbox.el, back: () => this.requestSandboxClose() });
  }
  private requestSandboxClose() {
    if (!this.sandbox.isOpen()) return;
    this.sound('back');
    this.sandbox.hide();
    this.popLayer('sandbox');
    const cb = this.sandboxClose;
    this.sandboxClose = () => {};
    cb();
  }
  refreshSandbox(actions: SandboxAction[]): void { this.sandbox.refresh(actions); }
  closeSandbox(): void {
    if (!this.sandbox.isOpen()) return;
    this.sandbox.hide();
    this.sandboxClose = () => {};
    this.popLayer('sandbox');
  }

  // ---------------------------------------------------------------- map
  openMap(s: MinimapState): void { this.openMapLayer(s); }
  closeMap(): void { this.popLayer('map'); }
  private openMapLayer(s: MinimapState) {
    const fm = this.fullmap;
    if (!fm) return;
    if (fm.isOpen()) { fm.update(s); return; }
    fm.show(s);
    this.pushLayer({
      id: 'map', el: fm.el, back: () => { this.sound('back'); this.popLayer('map'); },
      action: a => {
        if (a === 'back') return false;
        if (a === 'tabPrev' || a === 'tabNext') {
          if (!this.isDocked()) return false;
          this.sound('click'); this.selectPauseTab(this.neighbourTab('map', a === 'tabPrev' ? -1 : 1));
          return true;
        }
        return fm.action(a);
      },
    }, fm.el.querySelector<HTMLElement>('.ma-map-canvas') ?? undefined);
  }
  private defaultMapState(): MinimapState { return { x: 0, z: 0, heading: 0, zoom: 1, blips: [] }; }

  // ---------------------------------------------------------------- layers & navigation
  private top(): Layer | undefined { return this.layers[this.layers.length - 1]; }

  private syncRootClasses() {
    setClass(this.root, 'has-menu', this.layers.length > 0);
    setClass(this.root, 'is-paused', this.layers.some(l => l.id === 'pause'));
  }

  private pushLayer(l: Omit<Layer, 'openedAt' | 'prevFocus'>, focus?: HTMLElement) {
    const existing = this.layers.findIndex(x => x.id === l.id);
    if (existing >= 0) this.layers.splice(existing, 1);
    const layer: Layer = { ...l, openedAt: performance.now(), prevFocus: document.activeElement };
    this.layers.push(layer);
    l.el.style.zIndex = String(10 + this.layers.length);
    l.el.classList.add('is-open');
    this.syncRootClasses();
    const target = focus ?? this.navItems(l.el)[0];
    if (target) target.focus({ preventScroll: true });
    else { l.el.tabIndex = -1; l.el.focus({ preventScroll: true }); }
    this.startPad();
  }

  /** `quiet`: closing a docked view to switch pause tabs (the pause menu is not "revealed"). */
  private popLayer(id: LayerId, restoreFocus = true, quiet = false) {
    const i = this.layers.findIndex(l => l.id === id);
    if (i < 0) return;
    const [layer] = this.layers.splice(i, 1);
    this.closeLayerEl(layer);
    this.syncRootClasses();
    const top = this.top();
    if (restoreFocus) {
      const pf = layer.prevFocus as HTMLElement | null;
      if (top && pf && top.el.contains(pf) && typeof pf.focus === 'function') pf.focus({ preventScroll: true });
      else if (top) this.navItems(top.el)[0]?.focus({ preventScroll: true });
    }
    if (!quiet && top?.id === 'pause' && DOCKABLE.has(id)) this.pauseRevealed();
    if (!this.layers.length) (document.activeElement as HTMLElement | null)?.blur?.();
  }
  private popTop() { const t = this.top(); if (t) this.popLayer(t.id, true, true); }

  private closeLayerEl(layer: Layer) {
    layer.el.classList.remove('is-open');
    if (layer.id === 'settings') this.settingsPanel.close();
    if (layer.id === 'map') this.fullmap?.hide();
    if (layer.id === 'shop') this.shop.hide();
    if (layer.id === 'sandbox') this.sandbox.hide();
  }

  private closeAllLayers() {
    while (this.layers.length) this.popTop();
  }

  private navItems(root: HTMLElement): HTMLElement[] {
    return Array.from(root.querySelectorAll<HTMLElement>('[data-nav]')).filter(e => !(e as HTMLButtonElement).disabled && e.getClientRects().length > 0);
  }

  private focusItem(el: HTMLElement) {
    if (el === document.activeElement) return;
    el.focus({ preventScroll: true });
    el.scrollIntoView({ block: 'nearest' });
    this.sound('hover');
  }

  private onKeyDown = (e: KeyboardEvent) => {
    if (this.capturing) return; // the game's input routes this key to the rebinding capture
    const layer = this.top();
    if (!layer) return;
    e.stopPropagation(); // menus own the keyboard while open
    if (layer.id === 'title' && !this.titlePressed) {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key) || e.repeat) return;
      e.preventDefault(); this.revealTitleMenu(); return;
    }
    const act = this.keyAction(e, layer);
    if (!act) return;
    e.preventDefault();
    if (e.repeat && (act === 'select' || act === 'back' || act === 'tabPrev' || act === 'tabNext')) return;
    this.nav(act);
  };

  private keyAction(e: KeyboardEvent, layer: Layer): NavAction | null {
    const c = e.code;
    if (layer.id === 'pause' && this.settings.bindings.pause.includes(c)) return 'back';
    if (layer.id === 'map' && this.settings.bindings.map.includes(c)) return 'back';
    switch (c) {
      case 'ArrowUp': case 'KeyW': return 'up';
      case 'ArrowDown': case 'KeyS': return 'down';
      case 'ArrowLeft': case 'KeyA': return 'left';
      case 'ArrowRight': case 'KeyD': return 'right';
      case 'Enter': case 'NumpadEnter': return 'select';
      case 'Escape': case 'Backspace': return 'back';
      case 'Tab': return e.shiftKey ? 'up' : 'down';
      case 'KeyQ': case 'PageUp': return 'tabPrev';
      case 'KeyE': case 'PageDown': return 'tabNext';
      case 'Equal': case 'NumpadAdd': return 'zoomIn';
      case 'Minus': case 'NumpadSubtract': return 'zoomOut';
      default: return null;
    }
  }

  private nav(act: NavAction) {
    const layer = this.top();
    if (!layer) return;
    if (layer.id === 'title' && !this.titlePressed) { this.revealTitleMenu(); return; } // gamepad: any button
    if (layer.action?.(act)) return;
    const active = document.activeElement as HTMLElement | null;
    const inLayer = !!active && layer.el.contains(active) && active.matches('[data-nav]');
    switch (act) {
      case 'back': {
        const under = this.layers[this.layers.length - 2];
        // One level: Settings / Controls / Sandbox return to the pause menu; the map (the view pausing opens on) and the pause menu resume.
        if (layer.id === 'map' && under?.id === 'pause') { under.back(); return; }
        layer.back(); return;
      }
      case 'select':
        if (inLayer && active && !(active instanceof HTMLInputElement)) active.click();
        else if (!inLayer) { const f = this.navItems(layer.el)[0]; if (f) this.focusItem(f); }
        return;
      case 'up': case 'down': this.moveRow(layer, act === 'up' ? -1 : 1); return;
      case 'left': case 'right': {
        const dir = act === 'left' ? -1 : 1;
        if (inLayer && active instanceof HTMLInputElement && active.type === 'range') {
          const before = active.value;
          if (dir < 0) active.stepDown(); else active.stepUp();
          if (active.value !== before) { active.dispatchEvent(new Event('input', { bubbles: true })); this.sound('hover'); }
          return;
        }
        this.moveCol(layer, dir);
        return;
      }
      default: return;
    }
  }

  private rowsOf(layer: Layer) {
    const items = this.navItems(layer.el);
    const rows: Element[] = [];
    const rowItems = new Map<Element, HTMLElement[]>();
    for (const it of items) {
      const rr = it.closest('[data-nav-row]');
      const r = rr && layer.el.contains(rr) ? rr : it;
      let list = rowItems.get(r);
      if (!list) { list = []; rowItems.set(r, list); rows.push(r); }
      list.push(it);
    }
    return { items, rows, rowItems };
  }

  private moveRow(layer: Layer, dir: number) {
    const { items, rows, rowItems } = this.rowsOf(layer);
    if (!items.length) return;
    const cur = document.activeElement as HTMLElement;
    if (!items.includes(cur)) { this.focusItem(items[dir > 0 ? 0 : items.length - 1]); return; }
    const rr = cur.closest('[data-nav-row]');
    const r = rr && layer.el.contains(rr) ? rr : cur;
    const ri = rows.indexOf(r);
    const col = rowItems.get(r)?.indexOf(cur) ?? 0;
    const next = rows[(ri + dir + rows.length) % rows.length];
    const list = rowItems.get(next) ?? [];
    const sel = list.find(x => x.classList.contains('is-selected'));
    const target = sel ?? list[Math.min(col, list.length - 1)];
    if (target) this.focusItem(target);
  }

  private moveCol(layer: Layer, dir: number) {
    const cur = document.activeElement as HTMLElement;
    const { rowItems } = this.rowsOf(layer);
    const rr = cur?.closest?.('[data-nav-row]');
    if (!rr || !layer.el.contains(rr)) return;
    const list = rowItems.get(rr) ?? [];
    const i = list.indexOf(cur);
    if (i < 0 || list.length < 2) return;
    const t = list[(i + dir + list.length) % list.length];
    this.focusItem(t);
  }

  // ---------------------------------------------------------------- gamepad
  private startPad() {
    if (this.padRaf || typeof navigator.getGamepads !== 'function') return;
    this.padPrev = null; this.padLast = performance.now();
    this.padRaf = requestAnimationFrame(this.padLoop);
  }

  private padLoop = (t: number) => {
    this.padRaf = 0;
    if (!this.layers.length) { this.padPrev = null; this.padRepeat.clear(); return; }
    const dt = Math.min(0.1, (t - this.padLast) / 1000);
    this.padLast = t;
    let gp: Gamepad | null = null;
    try { gp = Array.from(navigator.getGamepads()).find(p => p && p.connected) ?? null; } catch { gp = null; }
    if (gp) {
      const btn = gp.buttons.map(b => b.pressed);
      const ax = gp.axes[0] ?? 0, ay = gp.axes[1] ?? 0;
      const prev = this.padPrev;
      this.padPrev = btn;
      if (prev) {
        const edge = (i: number) => !!btn[i] && !prev[i];
        const onMap = this.top()?.id === 'map';
        if (edge(0)) this.nav('select');
        if (edge(1)) this.nav('back');
        if (edge(4)) this.nav('tabPrev');
        if (edge(5)) this.nav('tabNext');
        if (onMap) {
          this.fullmap?.pan(ax, ay, dt);
          if ((gp.buttons[7]?.value ?? 0) > 0.5 && this.repeat('zi', true, t)) this.nav('zoomIn');
          else if ((gp.buttons[6]?.value ?? 0) > 0.5 && this.repeat('zo', true, t)) this.nav('zoomOut');
          else { this.repeat('zi', false, t); this.repeat('zo', false, t); }
        }
        const stick = !onMap;
        const dirs: [NavAction, boolean][] = [
          ['up', !!btn[12] || (stick && ay < -0.55)], ['down', !!btn[13] || (stick && ay > 0.55)],
          ['left', !!btn[14] || (stick && ax < -0.55)], ['right', !!btn[15] || (stick && ax > 0.55)],
        ];
        for (const [a, held] of dirs) if (this.repeat(a, held, t)) this.nav(a);
      }
    } else this.padPrev = null;
    this.padRaf = requestAnimationFrame(this.padLoop);
  };

  /** Key-repeat for held directions: fires on press, then after 380 ms every 110 ms. */
  private repeat(key: string, held: boolean, t: number): boolean {
    if (!held) { this.padRepeat.delete(key); return false; }
    const next = this.padRepeat.get(key);
    if (next === undefined) { this.padRepeat.set(key, t + 380); return true; }
    if (t >= next) { this.padRepeat.set(key, t + 110); return true; }
    return false;
  }
}
