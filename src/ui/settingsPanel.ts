/** Settings panel: display, input, audio and full key rebinding with conflict highlighting. */
import { ACTION_LABELS, DEFAULT_SETTINGS, keyLabel, type Action, type QualityName, type Settings } from '../core/settings';
import { ACTION_GROUPS, conflictSlots, defaultBindings, findConflicts, withBinding } from './bindings';
import { backButton, button, h } from './dom';

export type SettingsTab = 'display' | 'input' | 'audio' | 'keys';
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'display', label: 'Display' }, { id: 'input', label: 'Input' }, { id: 'audio', label: 'Audio' }, { id: 'keys', label: 'Key bindings' },
];
export const QUALITY_INFO: Record<QualityName, { name: string; desc: string }> = {
  low: { name: 'Low', desc: 'Lean and fast: no shadows or bloom, shorter view distance and quieter streets.' },
  medium: { name: 'Medium', desc: 'Balanced for laptops: soft sun shadows, bloom and lively streets.' },
  high: { name: 'High', desc: 'Full afterglow: sharper image, long shadows, anti-aliasing and the busiest city.' },
};

export interface SettingsDeps {
  get(): Settings;
  set(s: Settings, qualityChanged: boolean): void;
  sound(k: 'click' | 'hover' | 'back'): void;
  captureKey(cb: (code: string) => void): void;
  setCapturing(on: boolean): void;
  onBack(): void;
}

export class SettingsPanel {
  readonly el: HTMLDivElement;
  private body: HTMLDivElement;
  private tabButtons = new Map<SettingsTab, HTMLButtonElement>();
  private tab: SettingsTab = 'display';
  private resetBtn: HTMLButtonElement;
  private captureToken = 0;
  private captureTimer = 0;
  private note: HTMLDivElement | null = null;
  private desc: HTMLDivElement;

  constructor(private deps: SettingsDeps) {
    this.el = h('div', 'ma-layer ma-modal-layer ma-settings');
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-label', 'Settings');
    const panel = h('div', 'ma-panel ma-panel-wide');
    const head = h('div', 'ma-panel-head');
    head.appendChild(backButton(() => { this.deps.sound('back'); this.deps.onBack(); }));
    head.appendChild(h('div', 'ma-panel-title', 'Settings'));
    const tabs = h('div', 'ma-tabs');
    tabs.dataset.navRow = '';
    tabs.setAttribute('role', 'tablist');
    for (const t of TABS) {
      const b = button('ma-tab', t.label, { onClick: () => this.selectTab(t.id, true) });
      b.setAttribute('role', 'tab');
      tabs.appendChild(b);
      this.tabButtons.set(t.id, b);
    }
    head.appendChild(tabs);
    panel.appendChild(head);
    this.body = h('div', 'ma-panel-body');
    panel.appendChild(this.body);
    // One description line for the focused row (instead of grey subtitles under every row)
    this.desc = h('div', 'ma-desc');
    panel.appendChild(this.desc);
    this.body.addEventListener('focusin', () => queueMicrotask(() => this.syncDesc()));
    const foot = h('div', 'ma-panel-foot');
    const hints = h('div', 'ma-foot-hints');
    for (const [k, t] of [['↑↓', 'Select'], ['←→', 'Adjust'], ['Q / E', 'Tabs'], ['Esc', 'Back']]) {
      const s = h('span', 'ma-foot-hint');
      s.appendChild(h('kbd', 'ma-key', k)); s.appendChild(document.createTextNode(t));
      hints.appendChild(s);
    }
    foot.appendChild(hints);
    const fr = h('div', 'ma-foot-actions');
    fr.dataset.navRow = '';
    this.resetBtn = button('ma-btn ma-btn-ghost', 'Reset this page', { onClick: () => this.resetPage() });
    const back = button('ma-btn ma-btn-primary', 'Done', { onClick: () => { this.deps.sound('back'); this.deps.onBack(); } });
    fr.append(this.resetBtn, back);
    foot.appendChild(fr);
    panel.appendChild(foot);
    this.el.appendChild(panel);
  }

  open(tab: SettingsTab = 'display') { this.cancelCapture(); this.selectTab(tab, false); }
  close() { this.cancelCapture(); }
  currentTab() { return this.tab; }

  /** True when cycling `dir` from the current tab would wrap around. */
  atEdge(dir: number) {
    const i = TABS.findIndex(t => t.id === this.tab);
    return dir < 0 ? i === 0 : i === TABS.length - 1;
  }

  private syncDesc() {
    const a = document.activeElement as HTMLElement | null;
    const row = a && this.body.contains(a) ? a.closest('.ma-row') : null;
    const d = row?.querySelector('.ma-row-desc')?.textContent ?? '';
    const text = d || (this.tab === 'keys' ? 'Select a slot, then press a key or mouse button. Esc cancels, Backspace clears.' : '');
    if (this.desc.textContent !== text) this.desc.textContent = text;
  }

  cycleTab(dir: number) {
    const i = TABS.findIndex(t => t.id === this.tab);
    const next = TABS[(i + dir + TABS.length) % TABS.length].id;
    this.selectTab(next, true);
    this.tabButtons.get(next)?.focus({ preventScroll: true });
  }

  private selectTab(tab: SettingsTab, sound: boolean) {
    if (sound) this.deps.sound('click');
    this.cancelCapture();
    this.tab = tab;
    for (const [id, b] of this.tabButtons) { b.classList.toggle('is-selected', id === tab); b.setAttribute('aria-selected', String(id === tab)); }
    this.resetBtn.textContent = tab === 'keys' ? 'Reset keys to defaults' : 'Reset this page';
    this.render();
  }

  private update(mut: (s: Settings) => void, qualityChanged = false) {
    const s = structuredClone(this.deps.get());
    mut(s);
    this.deps.set(s, qualityChanged);
  }

  private resetPage() {
    this.deps.sound('click');
    const d = DEFAULT_SETTINGS;
    if (this.tab === 'display') this.update(s => { s.fov = d.fov; s.cameraShake = d.cameraShake; s.showFps = d.showFps; s.look = d.look; s.quality = d.quality; s.blood = d.blood; }, this.deps.get().quality !== d.quality);
    else if (this.tab === 'input') this.update(s => { s.sensitivity = d.sensitivity; s.invertY = d.invertY; s.driving = d.driving; });
    else if (this.tab === 'audio') this.update(s => { s.master = d.master; s.music = d.music; s.sfx = d.sfx; });
    else this.update(s => { s.bindings = defaultBindings(); });
    this.render();
  }

  private render() {
    const focusedIdx = Array.from(this.body.querySelectorAll('[data-nav]')).indexOf(document.activeElement as Element);
    this.body.textContent = '';
    const s = this.deps.get();
    if (this.tab === 'display') {
      this.body.appendChild(this.qualityRow(s.quality));
      this.body.appendChild(this.slider('Field of view', 'How much of the street you see.', 50, 80, 1, s.fov, v => `${v}°`, v => this.update(x => { x.fov = v; })));
      this.body.appendChild(this.slider('Camera shake', 'Impacts, explosions and engine rumble.', 0, 1, 0.05, s.cameraShake, v => `${Math.round(v * 100)}%`, v => this.update(x => { x.cameraShake = v; })));
      this.body.appendChild(this.toggle('Stylised colour grade', 'Teal and apricot split-tone instead of the neutral photographic look.', s.look === 'stylised', v => this.update(x => { x.look = v ? 'stylised' : 'natural'; })));
      this.body.appendChild(this.toggle('Blood', 'Spatter, pools and wound marks when people are shot.', s.blood, v => this.update(x => { x.blood = v; })));
      this.body.appendChild(this.toggle('Show FPS', 'Frame-rate counter in the corner.', s.showFps, v => this.update(x => { x.showFps = v; })));
    } else if (this.tab === 'input') {
      this.body.appendChild(this.slider('Look sensitivity', 'Mouse and right-stick camera speed.', 0.2, 3, 0.05, s.sensitivity, v => `${v.toFixed(2)}×`, v => this.update(x => { x.sensitivity = v; })));
      this.body.appendChild(this.toggle('Realistic driving', 'Off: arcade assists. On: real-world grip (about 0.9 g for sedans) and more weight transfer.', s.driving === 'realistic', v => this.update(x => { x.driving = v ? 'realistic' : 'arcade'; })));
      this.body.appendChild(this.toggle('Invert vertical look', 'Push forward to look down.', s.invertY, v => this.update(x => { x.invertY = v; })));
      const link = h('div', 'ma-row');
      const lt = h('div', 'ma-row-text');
      lt.appendChild(h('div', 'ma-row-label', 'Keyboard & mouse bindings'));
      lt.appendChild(h('div', 'ma-row-desc', 'Rebind every action, primary and secondary.'));
      link.appendChild(lt);
      link.appendChild(button('ma-btn ma-btn-ghost', 'Edit bindings', { onClick: () => this.cycleTabTo('keys') }));
      this.body.appendChild(link);
    } else if (this.tab === 'audio') {
      const pct = (v: number) => `${Math.round(v * 100)}%`;
      this.body.appendChild(this.slider('Master volume', 'Everything you hear.', 0, 1, 0.05, s.master, pct, v => this.update(x => { x.master = v; })));
      this.body.appendChild(this.slider('Music & radio', 'Station music and score.', 0, 1, 0.05, s.music, pct, v => this.update(x => { x.music = v; })));
      this.body.appendChild(this.slider('Effects', 'Engines, weapons, city ambience and menus.', 0, 1, 0.05, s.sfx, pct, v => this.update(x => { x.sfx = v; })));
    } else {
      this.renderKeys(s);
    }
    if (focusedIdx >= 0) {
      const items = this.body.querySelectorAll<HTMLElement>('[data-nav]');
      items[Math.min(focusedIdx, items.length - 1)]?.focus({ preventScroll: true });
    }
    this.syncDesc();
  }

  private cycleTabTo(tab: SettingsTab) { this.selectTab(tab, true); this.tabButtons.get(tab)?.focus({ preventScroll: true }); }

  private rowShell(label: string, desc: string) {
    const row = h('div', 'ma-row');
    const t = h('div', 'ma-row-text');
    t.appendChild(h('div', 'ma-row-label', label));
    t.appendChild(h('div', 'ma-row-desc', desc));
    row.appendChild(t);
    return row;
  }

  private qualityRow(q: QualityName) {
    const row = this.rowShell('Graphics quality', QUALITY_INFO[q].desc);
    row.classList.add('ma-row-quality');
    const seg = h('div', 'ma-seg');
    seg.dataset.navRow = '';
    for (const id of ['low', 'medium', 'high'] as QualityName[]) {
      const b = button('ma-seg-opt', QUALITY_INFO[id].name, {
        onClick: () => {
          if (this.deps.get().quality === id) return;
          this.deps.sound('click');
          this.update(x => { x.quality = id; }, true);
          this.render();
        },
      });
      b.setAttribute('aria-pressed', String(id === q));
      if (id === q) b.classList.add('is-selected');
      b.addEventListener('focus', () => { const d = row.querySelector('.ma-row-desc'); if (d) d.textContent = QUALITY_INFO[id].desc; this.syncDesc(); });
      b.addEventListener('blur', () => { const d = row.querySelector('.ma-row-desc'); if (d) d.textContent = QUALITY_INFO[this.deps.get().quality].desc; });
      seg.appendChild(b);
    }
    row.appendChild(seg);
    return row;
  }

  private slider(label: string, desc: string, min: number, max: number, step: number, value: number, fmt: (v: number) => string, onChange: (v: number) => void) {
    const row = this.rowShell(label, desc);
    const ctl = h('div', 'ma-slider');
    const input = h('input', 'ma-range');
    input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    input.dataset.nav = '';
    input.setAttribute('aria-label', label);
    const out = h('span', 'ma-slider-value', fmt(value));
    const paint = () => {
      const v = Number(input.value);
      input.style.setProperty('--ma-fill', `${((v - min) / (max - min)) * 100}%`);
      out.textContent = fmt(v);
    };
    paint();
    input.addEventListener('input', () => { paint(); onChange(Number(input.value)); });
    ctl.append(input, out);
    row.appendChild(ctl);
    return row;
  }

  private toggle(label: string, desc: string, value: boolean, onChange: (v: boolean) => void) {
    const row = this.rowShell(label, desc);
    const b = button('ma-toggle', '');
    b.setAttribute('role', 'switch');
    b.setAttribute('aria-checked', String(value));
    b.setAttribute('aria-label', label);
    b.appendChild(h('span', 'ma-toggle-track'));
    const txt = h('span', 'ma-toggle-text', value ? 'On' : 'Off');
    b.appendChild(txt);
    b.addEventListener('click', () => {
      const v = b.getAttribute('aria-checked') !== 'true';
      b.setAttribute('aria-checked', String(v));
      txt.textContent = v ? 'On' : 'Off';
      this.deps.sound('click');
      onChange(v);
    });
    row.appendChild(b);
    return row;
  }

  private renderKeys(s: Settings) {
    const conflicts = findConflicts(s.bindings);
    const slots = conflictSlots(s.bindings);
    const info = h('div', 'ma-keys-info');
    if (conflicts.size > 0) {
      info.classList.add('is-conflict');
      const parts: string[] = [];
      for (const [code, actions] of conflicts) parts.push(`${keyLabel(code)} → ${actions.map(a => ACTION_LABELS[a]).join(' + ')}`);
      info.textContent = `Key conflict: ${parts.join(' · ')}`;
    } else info.textContent = 'Select a slot, then press a key or mouse button. Esc cancels, Backspace clears.';
    this.body.appendChild(info);
    this.note = info;
    for (const g of ACTION_GROUPS) {
      const sec = h('div', 'ma-keys-group');
      sec.appendChild(h('div', 'ma-keys-title', g.title));
      for (const a of g.actions) {
        const row = h('div', 'ma-keyrow');
        row.dataset.navRow = '';
        row.appendChild(h('div', 'ma-keyrow-label', ACTION_LABELS[a]));
        for (let slot = 0; slot < 2; slot++) {
          const code = s.bindings[a][slot];
          const b = button('ma-keyslot', code ? keyLabel(code) : '—');
          if (!code) b.classList.add('is-empty');
          if (code && slots.has(`${a}|${code}`)) { b.classList.add('is-conflict'); row.classList.add('is-conflict'); }
          b.setAttribute('aria-label', `${ACTION_LABELS[a]} ${slot === 0 ? 'primary' : 'secondary'}: ${code ? keyLabel(code) : 'unbound'}`);
          b.addEventListener('click', () => this.beginCapture(a, slot, b));
          row.appendChild(b);
        }
        sec.appendChild(row);
      }
      this.body.appendChild(sec);
    }
  }

  private beginCapture(action: Action, slot: number, b: HTMLButtonElement) {
    this.cancelCapture();
    this.deps.sound('click');
    const token = ++this.captureToken;
    b.classList.add('is-capturing');
    b.textContent = 'Press a key…';
    this.deps.setCapturing(true);
    this.captureTimer = window.setTimeout(() => { if (token === this.captureToken) { this.cancelCapture(); this.render(); } }, 8000);
    // Registered synchronously: the click that started this has already passed its mousedown, and the UI's
    // capture-phase key handler stops the Enter that started it from reaching the game's input.
    {
      this.deps.captureKey(code => {
        if (token !== this.captureToken) return;
        this.finishCapture();
        if (code === 'Escape' && action !== 'pause') { this.deps.sound('back'); this.render(); this.refocus(action, slot); return; }
        if (code === 'Backspace' || code === 'Delete') {
          const cur = this.deps.get().bindings[action];
          if (action === 'pause' && cur.length <= 1) { this.render(); this.flashNote('Pause needs at least one key.'); this.refocus(action, slot); return; }
          this.update(x => { x.bindings = withBinding(x.bindings, action, slot, null); });
        } else {
          this.update(x => { x.bindings = withBinding(x.bindings, action, slot, code); });
        }
        this.deps.sound('click');
        this.render();
        this.refocus(action, slot);
      });
    }
  }

  private flashNote(text: string) {
    if (!this.note) return;
    this.note.textContent = text;
    this.note.classList.add('is-conflict');
  }

  private refocus(action: Action, slot: number) {
    const label = ACTION_LABELS[action];
    const rows = Array.from(this.body.querySelectorAll<HTMLElement>('.ma-keyrow'));
    const row = rows.find(r => r.querySelector('.ma-keyrow-label')?.textContent === label);
    const btns = row?.querySelectorAll<HTMLButtonElement>('.ma-keyslot');
    btns?.[slot]?.focus({ preventScroll: true });
  }

  private finishCapture() {
    window.clearTimeout(this.captureTimer);
    this.captureToken++;
    this.deps.setCapturing(false);
  }
  private cancelCapture() {
    if (this.body?.querySelector('.is-capturing')) this.finishCapture();
    else { window.clearTimeout(this.captureTimer); this.captureToken++; }
  }
  isCapturing() { return !!this.body.querySelector('.is-capturing'); }
}
