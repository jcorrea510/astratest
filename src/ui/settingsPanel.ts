/** Settings panel: display, input, audio and full key rebinding with conflict highlighting. */
import { ACTION_LABELS, DEFAULT_SETTINGS, keyLabel, type Action, type QualityName, type Settings } from '../core/settings';
import { ACTION_GROUPS, conflictSlots, defaultBindings, findConflicts, withBinding } from './bindings';
import { backButton, button, h } from './dom';
import { BUILD } from '../build';
import { PAD_LAYOUTS, readPad, currentPadFamily, type PadContext } from '../core/gamepad';
import { FAMILY_NAME, buttonLabel } from '../core/padGlyphs';
import { PAD_BINDABLE, PAD_CONTEXTS, PAD_CONTEXT_LABEL, mergedButtons, resetPadContext, withPadBinding } from '../core/padBindings';

export type SettingsTab = 'display' | 'access' | 'input' | 'audio' | 'keys';
const TABS: { id: SettingsTab; label: string }[] = [
  { id: 'display', label: 'Graphics' }, { id: 'access', label: 'Accessibility' }, { id: 'input', label: 'Input' }, { id: 'audio', label: 'Audio' }, { id: 'keys', label: 'Key Bindings' },
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
  private resetAllBtn: HTMLButtonElement;
  private resetAllTimer = 0;
  private captureToken = 0;
  private captureTimer = 0;
  private padCapTimer = 0;
  private padCapCleanup: (() => void) | null = null;
  private padCtx: PadContext = 'foot';
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
    const left = h('div', 'ma-foot-left');
    left.append(hints, h('div', 'ma-about', `About: Meridian Afterglow ${BUILD}`));
    foot.appendChild(left);
    const fr = h('div', 'ma-foot-actions');
    fr.dataset.navRow = '';
    this.resetBtn = button('ma-btn ma-btn-ghost', 'Reset This Page', { onClick: () => this.resetPage() });
    const back = button('ma-btn ma-btn-primary', 'Done', { onClick: () => { this.deps.sound('back'); this.deps.onBack(); } });
    this.resetAllBtn = button('ma-btn ma-btn-ghost', 'Reset All Settings', { onClick: () => this.resetAll() });
    fr.append(this.resetBtn, this.resetAllBtn, back);
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
    const text = d || (this.tab === 'keys' ? this.keysHint() : '');
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
    this.resetBtn.textContent = tab === 'keys' ? 'Reset Keys to Defaults' : 'Reset This Page';
    this.render();
  }

  private update(mut: (s: Settings) => void, qualityChanged = false) {
    const s = structuredClone(this.deps.get());
    mut(s);
    this.deps.set(s, qualityChanged);
  }

  private resetPage() {
    this.deps.sound('click');
    this.disarmResetAll();
    const d = DEFAULT_SETTINGS;
    if (this.tab === 'display') this.update(s => { s.fov = d.fov; s.cameraShake = d.cameraShake; s.showFps = d.showFps; s.look = d.look; s.quality = d.quality; s.blood = d.blood; s.resolutionScale = d.resolutionScale; s.fpsCap = d.fpsCap; }, this.deps.get().quality !== d.quality);
    else if (this.tab === 'access') this.update(s => { s.uiScale = d.uiScale; s.reduceMotion = d.reduceMotion; s.speedBlur = d.speedBlur; s.colorblind = d.colorblind; });
    else if (this.tab === 'input') this.update(s => { s.sensitivity = d.sensitivity; s.adsSensitivity = d.adsSensitivity; s.invertY = d.invertY; s.driving = d.driving; s.aimToggle = d.aimToggle; s.padSensitivity = d.padSensitivity; s.padDeadzone = d.padDeadzone; s.padInvertY = d.padInvertY; s.padBindings = {}; s.vibration = d.vibration; });
    else if (this.tab === 'audio') this.update(s => { s.master = d.master; s.music = d.music; s.sfx = d.sfx; s.ambienceVolume = d.ambienceVolume; s.voiceVolume = d.voiceVolume; s.uiVolume = d.uiVolume; });
    else this.update(s => { s.bindings = defaultBindings(); });
    this.render();
  }

  /** Two-step: the first press arms the button ("Confirm Reset?"), the second (within 4 s) resets every setting, key bindings included. */
  private resetAll() {
    this.deps.sound('click');
    if (this.resetAllBtn.dataset.armed !== '1') {
      this.resetAllBtn.dataset.armed = '1'; this.resetAllBtn.textContent = 'Confirm Reset?'; this.resetAllBtn.classList.add('ma-btn-danger');
      window.clearTimeout(this.resetAllTimer); this.resetAllTimer = window.setTimeout(() => this.disarmResetAll(), 4000);
      return;
    }
    this.disarmResetAll();
    const prevQuality = this.deps.get().quality;
    const fresh = structuredClone(DEFAULT_SETTINGS);
    this.deps.set(fresh, prevQuality !== fresh.quality);
    this.render();
  }
  private disarmResetAll() {
    window.clearTimeout(this.resetAllTimer);
    delete this.resetAllBtn.dataset.armed; this.resetAllBtn.textContent = 'Reset All Settings'; this.resetAllBtn.classList.remove('ma-btn-danger');
  }

  private render() {
    const focusedIdx = Array.from(this.body.querySelectorAll('[data-nav]')).indexOf(document.activeElement as Element);
    this.body.textContent = '';
    const s = this.deps.get();
    const pct = (v: number) => `${Math.round(v * 100)}%`, mult = (v: number) => `${v.toFixed(2)}×`;
    if (this.tab === 'display') {
      this.body.appendChild(this.qualityRow(s.quality));
      this.body.appendChild(this.slider('Render Resolution', 'Renders the 3D view below native size for a smoother frame rate on slower machines. The interface stays sharp.', 0.5, 1, 0.05, s.resolutionScale, pct, v => this.update(x => { x.resolutionScale = v; })));
      this.body.appendChild(this.segRow('Frame Rate Limit', 'Caps the frame rate to save battery and heat. Off follows your display.', [['0', 'Off'], ['30', '30'], ['60', '60']], String(s.fpsCap), v => this.update(x => { x.fpsCap = Number(v) as 0 | 30 | 60; })));
      this.body.appendChild(this.slider('Field of View', 'How much of the street you see.', 50, 80, 1, s.fov, v => `${v}°`, v => this.update(x => { x.fov = v; })));
      this.body.appendChild(this.slider('Camera Shake', 'Impacts, explosions and engine rumble.', 0, 1, 0.05, s.cameraShake, pct, v => this.update(x => { x.cameraShake = v; })));
      this.body.appendChild(this.toggle('Stylized Color Grade', 'Teal and apricot split-tone instead of the neutral photographic look.', s.look === 'stylised', v => this.update(x => { x.look = v ? 'stylised' : 'natural'; })));
      this.body.appendChild(this.toggle('Blood & Gore', 'Spatter, pools, bleeding wounds, and heavy rounds that take a head off. Off: clean hits.', s.blood, v => this.update(x => { x.blood = v; })));
      this.body.appendChild(this.toggle('Show FPS', 'Frame-rate counter in the corner.', s.showFps, v => this.update(x => { x.showFps = v; })));
    } else if (this.tab === 'access') {
      this.body.appendChild(this.slider('Interface Scale', 'Resizes the HUD, menus and prompts.', 0.8, 1.4, 0.05, s.uiScale, pct, v => this.update(x => { x.uiScale = v; })));
      this.body.appendChild(this.segRow('Color-Blind Mode', 'Swaps red and blue alerts, such as the heat indicator and minimap blips, for colors that stay distinct.', [['off', 'Off'], ['deuteranopia', 'Deuteranopia'], ['protanopia', 'Protanopia'], ['tritanopia', 'Tritanopia']], s.colorblind, v => this.update(x => { x.colorblind = v as Settings['colorblind']; })));
      this.body.appendChild(this.toggle('Reduce Motion', 'Tones down camera shake, field-of-view kick, head bob and speed blur.', s.reduceMotion, v => this.update(x => { x.reduceMotion = v; })));
      this.body.appendChild(this.toggle('Speed Blur', 'Radial blur at high speed. Reduce Motion turns it off regardless.', s.speedBlur, v => this.update(x => { x.speedBlur = v; })));
    } else if (this.tab === 'input') {
      this.body.appendChild(this.slider('Look Sensitivity', 'Mouse and right-stick camera speed.', 0.2, 3, 0.05, s.sensitivity, mult, v => this.update(x => { x.sensitivity = v; })));
      this.body.appendChild(this.slider('Aim Sensitivity', 'Look speed while aiming down the sights, relative to Look Sensitivity.', 0.3, 1.5, 0.05, s.adsSensitivity, mult, v => this.update(x => { x.adsSensitivity = v; })));
      this.body.appendChild(this.toggle('Invert Vertical Look', 'Push forward to look down.', s.invertY, v => this.update(x => { x.invertY = v; })));
      this.body.appendChild(this.toggle('Click to Aim', 'Mouse: click aim once to raise the gun, again to lower it (best on a trackpad). Off: hold to aim.', s.aimToggle, v => this.update(x => { x.aimToggle = v; })));
      this.body.appendChild(this.toggle('Realistic Driving', 'Off: arcade assists. On: real-world grip (about 0.9 g for sedans) and more weight transfer.', s.driving === 'realistic', v => this.update(x => { x.driving = v ? 'realistic' : 'arcade'; })));
      this.body.appendChild(this.slider('Controller Look Speed', 'Right-stick camera speed on a gamepad.', 0.3, 3, 0.05, s.padSensitivity, mult, v => this.update(x => { x.padSensitivity = v; })));
      this.body.appendChild(this.slider('Stick Deadzone', 'Ignores small stick movements. Raise it if the camera drifts.', 0, 0.3, 0.01, s.padDeadzone, pct, v => this.update(x => { x.padDeadzone = v; })));
      this.body.appendChild(this.toggle('Invert Controller Look', 'Push the right stick up to look down.', s.padInvertY, v => this.update(x => { x.padInvertY = v; })));
      this.body.appendChild(this.toggle('Vibration', 'Controller rumble for gunfire, crashes and damage.', s.vibration, v => this.update(x => { x.vibration = v; })));
      this.renderPadButtons(s);
      const link = h('div', 'ma-row');
      const lt = h('div', 'ma-row-text');
      lt.appendChild(h('div', 'ma-row-label', 'Keyboard & Mouse Bindings'));
      lt.appendChild(h('div', 'ma-row-desc', 'Rebind every action, primary and secondary.'));
      link.appendChild(lt);
      link.appendChild(button('ma-btn ma-btn-ghost', 'Edit Bindings', { onClick: () => this.cycleTabTo('keys') }));
      this.body.appendChild(link);
    } else if (this.tab === 'audio') {
      this.body.appendChild(this.slider('Master Volume', 'Everything you hear.', 0, 1, 0.05, s.master, pct, v => this.update(x => { x.master = v; })));
      this.body.appendChild(this.slider('Music & Radio', 'Station music and score.', 0, 1, 0.05, s.music, pct, v => this.update(x => { x.music = v; })));
      this.body.appendChild(this.slider('Effects', 'Engines, weapons, impacts and everything the world makes.', 0, 1, 0.05, s.sfx, pct, v => this.update(x => { x.sfx = v; })));
      this.body.appendChild(this.slider('Ambience', 'City, weather and crowd atmosphere.', 0, 1, 0.05, s.ambienceVolume, pct, v => this.update(x => { x.ambienceVolume = v; })));
      this.body.appendChild(this.slider('Voices', 'Pedestrians, police and radio chatter.', 0, 1, 0.05, s.voiceVolume, pct, v => this.update(x => { x.voiceVolume = v; })));
      this.body.appendChild(this.slider('Interface Sounds', 'Menu clicks and notification chimes.', 0, 1, 0.05, s.uiVolume, pct, v => this.update(x => { x.uiVolume = v; })));
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
    const row = this.rowShell('Graphics Quality', QUALITY_INFO[q].desc);
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

  /** Segmented choice row (values are strings). */
  private segRow(label: string, desc: string, opts: [string, string][], value: string, onPick: (v: string) => void) {
    const row = this.rowShell(label, desc);
    const seg = h('div', 'ma-seg');
    seg.dataset.navRow = '';
    for (const [id, name] of opts) {
      const b = button('ma-seg-opt', name, { onClick: () => { if (b.classList.contains('is-selected')) return; this.deps.sound('click'); onPick(id); this.render(); } });
      b.setAttribute('aria-pressed', String(id === value));
      if (id === value) b.classList.add('is-selected');
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

  /** Touch screen (no keyboard to press keys on): the key list is shown for reference only. */
  private touchUi(): boolean { return !!this.el.closest('.has-touch'); }
  private keysHint(): string { return this.touchUi() ? 'Keyboard controls: connect a keyboard to change.' : 'Select a slot, then press a key or mouse button. Esc cancels, Backspace clears.'; }
  private renderKeys(s: Settings) {
    const conflicts = findConflicts(s.bindings);
    const slots = conflictSlots(s.bindings);
    const info = h('div', 'ma-keys-info');
    if (conflicts.size > 0) {
      info.classList.add('is-conflict');
      const parts: string[] = [];
      for (const [code, actions] of conflicts) parts.push(`${keyLabel(code)} → ${actions.map(a => ACTION_LABELS[a]).join(' + ')}`);
      info.textContent = `Key conflict: ${parts.join(' · ')}`;
    } else info.textContent = this.keysHint();
    const locked = this.touchUi();
    if (locked) { info.classList.remove('is-conflict'); info.textContent = this.keysHint(); }
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
          if (locked) { b.disabled = true; b.removeAttribute('data-nav'); } else b.addEventListener('click', () => this.beginCapture(a, slot, b));
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

  /** Controller button rebinding: pick a context, select a slot, press the new button on the pad. */
  private renderPadButtons(s: Settings) {
    const connected = readPad().connected;
    const fam = FAMILY_NAME[currentPadFamily()];
    const sec = h('div', 'ma-keys-group ma-pad-group');
    sec.appendChild(h('div', 'ma-keys-title', 'Controller Buttons'));
    const info = h('div', 'ma-keys-info ma-pad-info', connected ? `${fam}: select a slot, then press the new button. A button used elsewhere in the same mode moves.` : 'No controller detected. Standard button names are shown; connect a pad and press any button.');
    sec.appendChild(info);
    this.note = info;
    sec.appendChild(this.segRow('Controller Mode', 'Buttons are set separately on foot, in vehicles and in the helicopter. Sticks and triggers are fixed.', PAD_CONTEXTS.map(c => [c, PAD_CONTEXT_LABEL[c]] as [string, string]), this.padCtx, v => { this.padCtx = v as PadContext; }));
    const ctx = this.padCtx;
    const cur = mergedButtons(PAD_LAYOUTS[ctx].buttons, s.padBindings?.[ctx]);
    for (const a of PAD_BINDABLE[ctx]) {
      const row = h('div', 'ma-keyrow');
      row.dataset.navRow = '';
      row.appendChild(h('div', 'ma-keyrow-label', ACTION_LABELS[a]));
      const g = cur[a]?.length ? buttonLabel(cur[a]![0], currentPadFamily()) : null;
      const b = button('ma-keyslot ma-padslot', g ?? '—');
      if (!g) b.classList.add('is-empty');
      b.dataset.padAction = a;
      b.setAttribute('aria-label', `${ACTION_LABELS[a]} controller button: ${g ?? 'unbound'}`);
      b.addEventListener('click', () => this.beginPadCapture(ctx, a, b));
      row.appendChild(b);
      sec.appendChild(row);
    }
    const reset = h('div', 'ma-row');
    const rt = h('div', 'ma-row-text');
    rt.appendChild(h('div', 'ma-row-label', `Reset ${PAD_CONTEXT_LABEL[ctx]} Buttons`));
    rt.appendChild(h('div', 'ma-row-desc', 'Back to the default layout for this mode.'));
    reset.appendChild(rt);
    reset.appendChild(button('ma-btn ma-btn-ghost', 'Reset', { onClick: () => { this.deps.sound('click'); this.update(x => { x.padBindings = resetPadContext(x.padBindings ?? {}, ctx); }); this.render(); } }));
    sec.appendChild(reset);
    this.body.appendChild(sec);
  }

  private beginPadCapture(ctx: PadContext, action: Action, b: HTMLButtonElement) {
    this.cancelCapture();
    this.deps.sound('click');
    const token = ++this.captureToken;
    b.classList.add('is-capturing');
    b.textContent = 'Press a button…';
    this.deps.setCapturing(true);
    const onKey = (e: KeyboardEvent) => { if (e.code === 'Escape' && token === this.captureToken) { this.finishCapture(); this.deps.sound('back'); this.render(); this.refocusPad(action); } };
    window.addEventListener('keydown', onKey, true);
    this.padCapCleanup = () => window.removeEventListener('keydown', onKey, true);
    this.captureTimer = window.setTimeout(() => { if (token === this.captureToken) { this.finishCapture(); this.render(); this.refocusPad(action); } }, 8000);
    // buttons already down when the capture opens (the A that selected the slot) are ignored until released
    const heldAtStart = new Set<number>(); readPad().buttons.slice(0, 16).forEach((v, i) => { if (v) heldAtStart.add(i); });
    const poll = () => {
      if (token !== this.captureToken) return;
      const p = readPad();
      if (p.connected) {
        for (const i of [...heldAtStart]) if (!p.buttons[i]) heldAtStart.delete(i);
        const down = p.buttons.slice(0, 16).findIndex((v, i) => v && !heldAtStart.has(i));
        if (down >= 0) {
          this.finishCapture();
          const res = withPadBinding(PAD_LAYOUTS[ctx].buttons, this.deps.get().padBindings ?? {}, ctx, action, down);
          this.deps.sound('click');
          if (res) { this.update(x => { x.padBindings = res.overrides; }); this.render(); this.flashNote(res.displaced.length ? `${buttonLabel(down, currentPadFamily())} now ${ACTION_LABELS[action]}. ${res.displaced.map(d => ACTION_LABELS[d]).join(', ')} unbound: pick a new button.` : `${ACTION_LABELS[action]} set to ${buttonLabel(down, currentPadFamily())}.`, !!res.displaced.length); }
          else { this.render(); this.flashNote('Pause needs a button.', true); }
          this.refocusPad(action);
          return;
        }
      }
      this.padCapTimer = window.setTimeout(poll, 30);
    };
    this.padCapTimer = window.setTimeout(poll, 30);
  }

  private refocusPad(action: Action) {
    this.body.querySelector<HTMLButtonElement>(`.ma-padslot[data-pad-action="${action}"]`)?.focus({ preventScroll: true });
  }

  private flashNote(text: string, warn = true) {
    if (!this.note) return;
    this.note.textContent = text;
    this.note.classList.toggle('is-conflict', warn);
  }

  private refocus(action: Action, slot: number) {
    const label = ACTION_LABELS[action];
    const rows = Array.from(this.body.querySelectorAll<HTMLElement>('.ma-keyrow'));
    const row = rows.find(r => r.querySelector('.ma-keyrow-label')?.textContent === label);
    const btns = row?.querySelectorAll<HTMLButtonElement>('.ma-keyslot');
    btns?.[slot]?.focus({ preventScroll: true });
  }

  private finishCapture() {
    window.clearTimeout(this.captureTimer); window.clearTimeout(this.padCapTimer);
    this.padCapCleanup?.(); this.padCapCleanup = null;
    this.captureToken++;
    this.deps.setCapturing(false);
  }
  private cancelCapture() {
    if (this.body?.querySelector('.is-capturing')) this.finishCapture();
    else { window.clearTimeout(this.captureTimer); window.clearTimeout(this.padCapTimer); this.padCapCleanup?.(); this.padCapCleanup = null; this.captureToken++; }
  }
  isCapturing() { return !!this.body.querySelector('.is-capturing'); }
}
