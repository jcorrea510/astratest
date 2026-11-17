/**
 * Meridian Afterglow UI layer: screens, HUD, wheel, shop and map. Implements GameUI from ./contracts.
 * Plain DOM + Canvas 2D + inline SVG. One full-screen root overlay (pointer-events: none except on panels).
 */
import './ui.css';
import { DEFAULT_SETTINGS, keyLabel, type Action, type Settings } from '../core/settings';
import type { CityMap } from '../world/citymap';
import type { GameUI, HudState, MinimapState, ShopItem, UICallbacks, WheelSlot } from './contracts';
import { button, h, renderKeyText } from './dom';
import { Hud, Notices } from './hud';
import { CityPainter } from './mapdraw';
import { FullMap } from './fullmap';
import { Wheel } from './wheel';
import { Shop } from './shop';
import { SettingsPanel } from './settingsPanel';
import { ControlsPanel } from './controlsPanel';
import { buildCard, buildDeath, buildLoading, buildMobileGate, monogram, titleArtSvg, wordmark } from './screens';
import { formatMoney } from './geometry';

type NavAction = 'up' | 'down' | 'left' | 'right' | 'select' | 'back' | 'tabPrev' | 'tabNext' | 'zoomIn' | 'zoomOut';
type LayerId = 'title' | 'confirm' | 'pause' | 'settings' | 'controls' | 'map' | 'shop';
interface Layer { id: LayerId; el: HTMLElement; back: () => void; action?: (a: NavAction) => boolean; openedAt: number; prevFocus: Element | null }

const NOOP_CALLBACKS: UICallbacks = {
  onStart: () => {}, onResume: () => {}, onQuitToTitle: () => {}, onSettingsChanged: () => {}, onQualityChanged: () => {},
  onSetWaypoint: () => {}, onUiSound: () => {}, captureKey: () => {},
};

export class UI implements GameUI {
  private root: HTMLDivElement;
  private settings: Settings = structuredClone(DEFAULT_SETTINGS);
  private callbacks: UICallbacks = NOOP_CALLBACKS;
  private city: CityMap | null = null;
  private hud: Hud | null = null;
  private fullmap: FullMap | null = null;
  private hudLayer: HTMLDivElement;
  private notices = new Notices();
  private wheel: Wheel;
  private shop: Shop;
  private settingsPanel: SettingsPanel;
  private controlsPanel: ControlsPanel;
  private titleEl: HTMLDivElement;
  private titleMenu: HTMLDivElement;
  private confirmEl: HTMLDivElement;
  private confirmText: HTMLDivElement;
  private confirmYes: HTMLButtonElement;
  private confirmAction: () => void = () => {};
  private pauseEl: HTMLDivElement;
  private pauseStatus!: HTMLDivElement;
  private loading = buildLoading();
  private loadingOpen = false;
  private loadingHideTimer = 0;
  private mobileEl: HTMLDivElement | null = null;
  private death = buildDeath();
  private deathTimer = 0;
  private card = buildCard();
  private cardTimer = 0;
  private layers: Layer[] = [];
  private hudVisible = true;
  private lastHud: HudState | null = null;
  private lastMinimap: MinimapState | null = null;
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
    noticeLayer.append(tl, this.notices.subtitleEl, this.card.el);
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
    const c = this.buildConfirm();
    this.confirmEl = c.el; this.confirmText = c.text; this.confirmYes = c.yes;
    this.root.appendChild(this.confirmEl);
    const t = this.buildTitle();
    this.titleEl = t.el; this.titleMenu = t.menu;
    this.root.appendChild(this.titleEl);
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
    const attach = () => { if (!this.root.isConnected) document.body.appendChild(this.root); };
    if (document.body) attach(); else document.addEventListener('DOMContentLoaded', attach, { once: true });
  }

  // ---------------------------------------------------------------- setup
  init(opts: { city: CityMap; settings: Settings; callbacks: UICallbacks }): void {
    this.city = opts.city;
    this.settings = structuredClone(opts.settings);
    this.callbacks = opts.callbacks;
    const painter = new CityPainter(opts.city);
    if (this.hud) this.hud.el.remove();
    this.hud = new Hud(opts.city, painter);
    this.hudLayer.appendChild(this.hud.el);
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

  // ---------------------------------------------------------------- screens
  private buildTitle() {
    const el = h('div', 'ma-layer ma-title');
    el.innerHTML = titleArtSvg();
    el.appendChild(h('div', 'ma-title-shade'));
    const content = h('div', 'ma-title-content');
    const top = h('div', 'ma-title-top');
    top.appendChild(monogram());
    top.appendChild(h('div', 'ma-eyebrow', 'Port Meridian · Golden hour'));
    el.appendChild(top);
    content.appendChild(wordmark('ma-wordmark-lg'));
    content.appendChild(h('div', 'ma-tagline', 'One coastal city. Seven districts. The longest sunset of your life.'));
    const menu = h('div', 'ma-menu');
    content.appendChild(menu);
    el.appendChild(content);
    const foot = h('div', 'ma-title-foot');
    foot.appendChild(h('span', '', 'An original game · Every place, person and brand is fictional'));
    const hints = h('span', 'ma-foot-hints');
    for (const [k, t] of [['↑↓', 'Select'], ['Enter', 'Confirm']]) {
      const s = h('span', 'ma-foot-hint');
      s.appendChild(h('kbd', 'ma-key', k)); s.appendChild(document.createTextNode(t));
      hints.appendChild(s);
    }
    foot.appendChild(hints);
    el.appendChild(foot);
    return { el, menu };
  }

  private menuItem(num: string, label: string, sub: string, onClick: () => void, disabled = false) {
    const b = h('button', 'ma-menu-item');
    b.type = 'button';
    b.dataset.nav = '';
    b.disabled = disabled;
    b.appendChild(h('span', 'ma-mi-num', num));
    const tx = h('span', 'ma-mi-text');
    tx.appendChild(h('span', 'ma-mi-label', label));
    tx.appendChild(h('span', 'ma-mi-sub', sub));
    b.appendChild(tx);
    b.appendChild(h('span', 'ma-mi-arrow', '→'));
    b.addEventListener('click', () => { if (!b.disabled) onClick(); });
    return b;
  }

  private buildPause() {
    const el = h('div', 'ma-layer ma-pause');
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', 'Paused');
    const panel = h('div', 'ma-pause-panel');
    panel.appendChild(h('div', 'ma-eyebrow', 'Port Meridian'));
    panel.appendChild(h('div', 'ma-pause-title', 'Paused'));
    const menu = h('div', 'ma-menu ma-menu-compact');
    menu.appendChild(this.menuItem('01', 'Resume', 'Back to the streets', () => { this.sound('click'); this.resume(); }));
    menu.appendChild(this.menuItem('02', 'City map', 'Plan a route, drop a waypoint', () => { this.sound('click'); this.openMapLayer(this.lastMinimap ?? this.defaultMapState()); }));
    menu.appendChild(this.menuItem('03', 'Settings', 'Graphics, input, audio, keys', () => { this.sound('click'); this.openSettings(); }));
    menu.appendChild(this.menuItem('04', 'Controls', 'Keyboard, mouse and gamepad', () => { this.sound('click'); this.openControls(); }));
    menu.appendChild(this.menuItem('05', 'Save & quit to title', 'Progress is saved first', () => { this.sound('click'); this.closeAllLayers(); this.callbacks.onQuitToTitle(); }));
    panel.appendChild(menu);
    const foot = h('div', 'ma-foot-hints');
    for (const [k, t] of [['↑↓', 'Select'], ['Enter', 'Confirm'], ['Esc', 'Resume']]) {
      const s = h('span', 'ma-foot-hint');
      s.appendChild(h('kbd', 'ma-key', k)); s.appendChild(document.createTextNode(t));
      foot.appendChild(s);
    }
    panel.appendChild(foot);
    el.appendChild(panel);
    this.pauseStatus = h('div', 'ma-pause-status');
    el.appendChild(this.pauseStatus);
    return el;
  }

  private refreshPauseStatus() {
    const s = this.lastHud;
    const box = this.pauseStatus;
    box.textContent = '';
    if (!s) return;
    const block = (label: string, value: string, cls = '') => {
      const b = h('div', `ma-status-block ${cls}`);
      b.appendChild(h('div', 'ma-eyebrow', label));
      b.appendChild(h('div', 'ma-status-value', value));
      box.appendChild(b);
    };
    block('Local time', s.clock, 'ma-status-clock');
    block('Location', `${s.district} · ${s.streetName}`);
    block('Wallet', formatMoney(s.money));
    block('Current objective', s.objective ?? 'Free roam: the city is yours.');
  }

  private buildConfirm() {
    const el = h('div', 'ma-layer ma-modal-layer ma-confirm');
    el.setAttribute('role', 'alertdialog');
    const panel = h('div', 'ma-panel ma-confirm-panel');
    panel.appendChild(h('div', 'ma-eyebrow', 'Are you sure?'));
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

  showTitle(hasSave: boolean): void {
    this.hasSave = hasSave;
    this.closeAllLayers();
    this.wheel.hide();
    this.hideDeath();
    this.notices.subtitle(null);
    this.titleMenu.textContent = '';
    const start = (cont: boolean) => { this.sound('click'); this.closeAllLayers(); this.callbacks.onStart(cont); };
    const newGame = this.menuItem('01', 'New game', 'Arrive in Port Meridian', () => {
      if (this.hasSave) this.confirm('Start a new game? Your current save will be replaced the next time the game autosaves.', 'Start new game', () => start(false));
      else start(false);
    });
    const cont = this.menuItem('02', 'Continue', hasSave ? 'Pick up where you left off' : 'No saved game yet', () => start(true), !hasSave);
    const settings = this.menuItem('03', 'Settings', 'Graphics, input, audio, keys', () => { this.sound('click'); this.openSettings(); });
    const controls = this.menuItem('04', 'Controls', 'Keyboard, mouse and gamepad', () => { this.sound('click'); this.openControls(); });
    this.titleMenu.append(newGame, cont, settings, controls);
    this.pushLayer({ id: 'title', el: this.titleEl, back: () => {} }, hasSave ? cont : newGame);
  }

  showLoading(fraction: number, label: string): void {
    const f = Math.max(0, Math.min(1, Number.isFinite(fraction) ? fraction : 0));
    if (!this.loadingOpen) {
      this.loadingOpen = true;
      window.clearTimeout(this.loadingHideTimer);
      this.loading.el.classList.remove('is-leaving');
      this.loading.el.classList.add('is-open');
      renderKeyText(this.loading.tip, this.randomTip());
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
    this.loading.fill.style.transform = 'scaleX(1)';
    this.loading.pct.textContent = '100%';
    this.loading.el.classList.add('is-leaving');
    window.clearTimeout(this.loadingHideTimer);
    this.loadingHideTimer = window.setTimeout(() => this.loading.el.classList.remove('is-open', 'is-leaving'), 450);
  }

  private keyFor(a: Action) { const c = this.settings.bindings[a]?.[0]; return c ? keyLabel(c) : '?'; }
  private randomTip(): string {
    const tips = [
      `Hold [${this.keyFor('wheel')}] to open the wheel. The city slows down while you choose.`,
      `Press [${this.keyFor('enter')}] next to any car to take the wheel. [${this.keyFor('handbrake')}] is the handbrake.`,
      'Heat fades when patrols lose sight of you. Break line of sight and lie low.',
      `Open the city map with [${this.keyFor('map')}] and click anywhere to drop a waypoint.`,
      `Change the station with [${this.keyFor('radio')}]. Every district has its own sound.`,
      'Armor soaks up damage before your health does. Stores sell it by the vest.',
      `[${this.keyFor('crouch')}] dodge-rolls out of trouble on foot.`,
    ];
    return tips[Math.floor(Math.random() * tips.length)];
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

  setPaused(paused: boolean): void {
    if (paused) {
      if (this.layers.some(l => l.id === 'pause' || l.id === 'title')) return;
      this.wheel.hide();
      this.refreshPauseStatus();
      this.pushLayer({ id: 'pause', el: this.pauseEl, back: () => { this.sound('back'); this.resume(); } });
    } else {
      const i = this.layers.findIndex(l => l.id === 'pause');
      if (i < 0) return;
      while (this.layers.length > i) this.popTop();
    }
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
      action: a => { if (a === 'tabPrev' || a === 'tabNext') { this.settingsPanel.cycleTab(a === 'tabPrev' ? -1 : 1); return true; } return false; },
    });
  }
  private openControls() {
    this.controlsPanel.open(this.settings);
    this.pushLayer({
      id: 'controls', el: this.controlsPanel.el, back: () => { this.sound('back'); this.popLayer('controls'); },
      action: a => {
        if (a === 'up' || a === 'down') { this.controlsPanel.scroller.scrollBy({ top: a === 'up' ? -90 : 90 }); return true; }
        return false;
      },
    });
  }

  // ---------------------------------------------------------------- HUD
  setHudVisible(v: boolean): void {
    if (v === this.hudVisible) return;
    this.hudVisible = v;
    this.hudLayer.classList.toggle('is-off', !v);
  }
  updateHud(s: HudState): void {
    this.lastHud = s;
    this.hud?.update(s, this.settings.showFps);
  }
  updateMinimap(s: MinimapState): void {
    this.lastMinimap = s;
    if (this.hudVisible && !this.isMenuOpen()) this.hud?.minimap.update(s);
    this.fullmap?.update(s);
  }
  toast(text: string, kind: 'info' | 'money' | 'heat' | 'mission' | 'warning' = 'info'): void { this.notices.toast(text, kind); }

  missionCard(title: string, subtitle: string, kind: 'start' | 'passed' | 'failed'): void {
    const c = this.card;
    c.eyebrow.textContent = kind === 'start' ? 'New job' : kind === 'passed' ? 'Job complete' : 'Job failed';
    c.title.textContent = title;
    c.sub.textContent = subtitle;
    c.el.classList.remove('is-start', 'is-passed', 'is-failed', 'is-visible');
    void c.el.offsetWidth;
    c.el.classList.add(`is-${kind}`, 'is-visible');
    this.root.classList.add('is-card');
    window.clearTimeout(this.cardTimer);
    this.cardTimer = window.setTimeout(() => { c.el.classList.remove('is-visible'); this.root.classList.remove('is-card'); }, 3200);
  }

  subtitle(text: string | null, speaker?: string): void { this.notices.subtitle(text, speaker); }

  showDeath(kind: 'down' | 'busted', detail: string): void {
    const d = this.death;
    d.eyebrow.textContent = kind === 'down' ? 'You took one too many' : 'The long arm of the law';
    d.word.textContent = kind === 'down' ? 'Out cold' : 'Cuffed';
    d.detail.textContent = detail;
    d.el.classList.remove('is-down', 'is-busted', 'is-visible');
    void d.el.offsetWidth;
    d.el.classList.add(kind === 'down' ? 'is-down' : 'is-busted', 'is-visible');
    this.root.classList.add('is-dead');
    window.clearTimeout(this.deathTimer);
    this.deathTimer = window.setTimeout(() => this.hideDeath(), 3500);
  }
  private hideDeath() {
    window.clearTimeout(this.deathTimer);
    this.death.el.classList.remove('is-visible');
    this.root.classList.remove('is-dead');
  }

  showControlsHint(text: string, seconds: number): void {
    this.notices.showHint(el => renderKeyText(el, text), seconds);
  }

  // ---------------------------------------------------------------- wheel
  openWheel(slots: WheelSlot[], selectedId: string): void {
    this.wheel.show(slots, selectedId);
    this.root.classList.add('is-wheel');
  }
  updateWheel(dirX: number, dirY: number): void { this.wheel.update(dirX, dirY); }
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
        if (a === 'back' || a === 'tabPrev' || a === 'tabNext') return false;
        return fm.action(a);
      },
    }, fm.el.querySelector<HTMLElement>('.ma-map-canvas') ?? undefined);
  }
  private defaultMapState(): MinimapState { return { x: 0, z: 0, heading: 0, zoom: 1, blips: [] }; }

  // ---------------------------------------------------------------- layers & navigation
  private top(): Layer | undefined { return this.layers[this.layers.length - 1]; }

  private pushLayer(l: Omit<Layer, 'openedAt' | 'prevFocus'>, focus?: HTMLElement) {
    const existing = this.layers.findIndex(x => x.id === l.id);
    if (existing >= 0) this.layers.splice(existing, 1);
    const layer: Layer = { ...l, openedAt: performance.now(), prevFocus: document.activeElement };
    this.layers.push(layer);
    l.el.style.zIndex = String(10 + this.layers.length);
    l.el.classList.add('is-open');
    this.root.classList.add('has-menu');
    const target = focus ?? this.navItems(l.el)[0];
    if (target) target.focus({ preventScroll: true });
    else { l.el.tabIndex = -1; l.el.focus({ preventScroll: true }); }
    this.startPad();
  }

  private popLayer(id: LayerId, restoreFocus = true) {
    const i = this.layers.findIndex(l => l.id === id);
    if (i < 0) return;
    const [layer] = this.layers.splice(i, 1);
    this.closeLayerEl(layer);
    if (restoreFocus) {
      const top = this.top();
      const pf = layer.prevFocus as HTMLElement | null;
      if (top && pf && top.el.contains(pf) && typeof pf.focus === 'function') pf.focus({ preventScroll: true });
      else if (top) this.navItems(top.el)[0]?.focus({ preventScroll: true });
    }
    if (!this.layers.length) {
      this.root.classList.remove('has-menu');
      (document.activeElement as HTMLElement | null)?.blur?.();
    }
  }
  private popTop() { const t = this.top(); if (t) this.popLayer(t.id); }

  private closeLayerEl(layer: Layer) {
    layer.el.classList.remove('is-open');
    if (layer.id === 'settings') this.settingsPanel.close();
    if (layer.id === 'map') this.fullmap?.hide();
    if (layer.id === 'shop') this.shop.hide();
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
    if (layer.action?.(act)) return;
    const active = document.activeElement as HTMLElement | null;
    const inLayer = !!active && layer.el.contains(active) && active.matches('[data-nav]');
    switch (act) {
      case 'back': layer.back(); return;
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
