/** In-game HUD. update() runs every frame and only touches the DOM when a value changes. */
import type { CityMap } from '../world/citymap';
import type { HudState, WeaponIcon } from './contracts';
import { FLARE_SVG, weaponSvg } from './icons';
import { formatMoney, formatTimer } from './geometry';
import { h, setClass, TextSlot, prefersReducedMotion } from './dom';
import { Minimap } from './minimap';
import type { CityPainter } from './mapdraw';

export class Hud {
  readonly el: HTMLDivElement;
  readonly minimap: Minimap;
  private money: TextSlot;
  private moneyEl: HTMLDivElement;
  private moneyDelta: HTMLDivElement;
  private moneyShown = 0;
  private moneyFrom = 0;
  private moneyTarget: number | null = null;
  private moneyT0 = 0;
  private moneyText = '';
  private heatEl: HTMLDivElement;
  private flares: HTMLSpanElement[] = [];
  private heatShown = -1;
  private weaponEl: HTMLDivElement;
  private weaponIconEl: HTMLDivElement;
  private weaponIcon: WeaponIcon | null = null;
  private weaponName: TextSlot;
  private ammoEl: HTMLDivElement;
  private ammoClip: TextSlot;
  private ammoReserve: TextSlot;
  private objectiveEl: HTMLDivElement;
  private objectiveText: TextSlot;
  private objectiveLast: string | null = '\u0000';
  private timerEl: HTMLDivElement;
  private timerText: TextSlot;
  private district: TextSlot;
  private street: TextSlot;
  private clock: TextSlot;
  private healthFill: HTMLDivElement;
  private healthGhost: HTMLDivElement;
  private armorFill: HTMLDivElement;
  private staminaRow: HTMLDivElement;
  private staminaFill: HTMLDivElement;
  private vitalsEl: HTMLDivElement;
  private vehicleEl: HTMLDivElement;
  private vehicleName: TextSlot;
  private speed: TextSlot;
  private gauge: SVGPathElement;
  private vehHealthFill: HTMLDivElement;
  private radioEl: HTMLDivElement;
  private radioName: TextSlot;
  private radioLast: string | null = null;
  private radioTimer = 0;
  private crosshair: HTMLDivElement;
  private hitmarker: HTMLDivElement;
  private promptEl: HTMLDivElement;
  private promptKey: TextSlot;
  private promptText: TextSlot;
  private promptLast: string | null = '\u0000';
  private fpsEl: HTMLDivElement;
  private fps: TextSlot;
  private last = new Map<string, number | string | boolean | null>();
  private reduced = prefersReducedMotion();

  constructor(_city: CityMap, painter: CityPainter) {
    this.el = h('div', 'ma-hud');

    // Top centre: objective + mission timer
    const tc = h('div', 'ma-hud-tc');
    this.objectiveEl = h('div', 'ma-objective');
    this.objectiveEl.appendChild(h('div', 'ma-eyebrow ma-objective-label', 'Objective'));
    const ot = h('div', 'ma-objective-text');
    this.objectiveText = new TextSlot(ot);
    this.objectiveEl.appendChild(ot);
    tc.appendChild(this.objectiveEl);
    this.timerEl = h('div', 'ma-timer');
    const tt = h('span', 'ma-timer-text');
    this.timerText = new TextSlot(tt);
    this.timerEl.appendChild(tt);
    tc.appendChild(this.timerEl);
    this.el.appendChild(tc);

    // Top right: money, heat, weapon
    const tr = h('div', 'ma-hud-tr');
    this.moneyEl = h('div', 'ma-money');
    const mv = h('span', 'ma-money-value');
    this.money = new TextSlot(mv);
    this.moneyEl.appendChild(mv);
    this.moneyDelta = h('div', 'ma-money-delta');
    this.moneyEl.appendChild(this.moneyDelta);
    tr.appendChild(this.moneyEl);
    this.heatEl = h('div', 'ma-heat');
    this.heatEl.setAttribute('aria-label', 'Heat level');
    for (let i = 0; i < 5; i++) {
      const f = h('span', 'ma-flare');
      f.innerHTML = FLARE_SVG;
      this.heatEl.appendChild(f);
      this.flares.push(f);
    }
    tr.appendChild(this.heatEl);
    this.weaponEl = h('div', 'ma-weapon');
    this.weaponIconEl = h('div', 'ma-weapon-icon');
    const wmeta = h('div', 'ma-weapon-meta');
    const wn = h('div', 'ma-weapon-name');
    this.weaponName = new TextSlot(wn);
    this.ammoEl = h('div', 'ma-ammo');
    const ac = h('span', 'ma-ammo-clip'), ar = h('span', 'ma-ammo-reserve');
    this.ammoClip = new TextSlot(ac); this.ammoReserve = new TextSlot(ar);
    this.ammoEl.append(ac, ar, h('span', 'ma-ammo-reload', 'Reloading'));
    wmeta.append(wn, this.ammoEl);
    this.weaponEl.append(wmeta, this.weaponIconEl);
    tr.appendChild(this.weaponEl);
    this.el.appendChild(tr);

    // Bottom left: minimap + location + vitals
    const bl = h('div', 'ma-hud-bl');
    this.minimap = new Minimap(painter);
    bl.appendChild(this.minimap.el);
    const side = h('div', 'ma-hud-side');
    const loc = h('div', 'ma-location');
    const ck = h('div', 'ma-clock'), di = h('div', 'ma-district'), st = h('div', 'ma-street');
    this.clock = new TextSlot(ck); this.district = new TextSlot(di); this.street = new TextSlot(st);
    loc.append(ck, di, st);
    side.appendChild(loc);
    this.vitalsEl = h('div', 'ma-vitals');
    const mkBar = (cls: string, label: string) => {
      const row = h('div', `ma-bar ${cls}`);
      row.appendChild(h('span', 'ma-bar-label', label));
      const track = h('div', 'ma-bar-track');
      const ghost = h('div', 'ma-bar-ghost');
      const fill = h('div', 'ma-bar-fill');
      track.append(ghost, fill);
      row.appendChild(track);
      this.vitalsEl.appendChild(row);
      return { row, fill, ghost };
    };
    const hb = mkBar('ma-bar-health', 'Health');
    this.healthFill = hb.fill; this.healthGhost = hb.ghost;
    const ab = mkBar('ma-bar-armor', 'Armor');
    this.armorFill = ab.fill;
    const sb = mkBar('ma-bar-stamina', 'Stamina');
    this.staminaRow = sb.row; this.staminaFill = sb.fill;
    side.appendChild(this.vitalsEl);
    bl.appendChild(side);
    this.el.appendChild(bl);

    // Bottom right: vehicle
    const br = h('div', 'ma-hud-br');
    this.radioEl = h('div', 'ma-radio');
    this.radioEl.appendChild(h('div', 'ma-eyebrow', 'Now tuned'));
    const rn = h('div', 'ma-radio-name');
    this.radioName = new TextSlot(rn);
    this.radioEl.appendChild(rn);
    br.appendChild(this.radioEl);
    this.vehicleEl = h('div', 'ma-vehicle');
    const vn = h('div', 'ma-vehicle-name');
    this.vehicleName = new TextSlot(vn);
    const gaugeWrap = h('div', 'ma-gauge');
    gaugeWrap.innerHTML = '<svg viewBox="0 0 120 120" aria-hidden="true"><path class="ma-gauge-track" pathLength="100" d="M24.6 95.4A50 50 0 1 1 95.4 95.4"/><path class="ma-gauge-fill" pathLength="100" d="M24.6 95.4A50 50 0 1 1 95.4 95.4"/></svg>';
    this.gauge = gaugeWrap.querySelector('.ma-gauge-fill') as SVGPathElement;
    const sp = h('div', 'ma-speed');
    const spv = h('span', 'ma-speed-value');
    this.speed = new TextSlot(spv);
    sp.append(spv, h('span', 'ma-speed-unit', 'km/h'));
    gaugeWrap.appendChild(sp);
    const vh = h('div', 'ma-bar ma-bar-vehicle');
    vh.appendChild(h('span', 'ma-bar-label', 'Body'));
    const vt = h('div', 'ma-bar-track');
    this.vehHealthFill = h('div', 'ma-bar-fill');
    vt.appendChild(this.vehHealthFill);
    vh.appendChild(vt);
    this.vehicleEl.append(vn, gaugeWrap, vh);
    br.appendChild(this.vehicleEl);
    this.el.appendChild(br);

    // Centre: crosshair + hit marker
    this.crosshair = h('div', 'ma-crosshair');
    for (const d of ['t', 'r', 'b', 'l']) this.crosshair.appendChild(h('span', `ma-ch-tick ma-ch-${d}`));
    this.crosshair.appendChild(h('span', 'ma-ch-dot'));
    this.el.appendChild(this.crosshair);
    this.hitmarker = h('div', 'ma-hitmarker');
    for (const d of ['a', 'b', 'c', 'd']) this.hitmarker.appendChild(h('span', `ma-hm-${d}`));
    this.el.appendChild(this.hitmarker);

    // Bottom centre: interact prompt
    this.promptEl = h('div', 'ma-prompt');
    const pk = h('kbd', 'ma-key'), pt = h('span', 'ma-prompt-text');
    this.promptKey = new TextSlot(pk); this.promptText = new TextSlot(pt);
    this.promptEl.append(pk, pt);
    this.el.appendChild(this.promptEl);

    this.fpsEl = h('div', 'ma-fps');
    this.fps = new TextSlot(this.fpsEl);
    this.el.appendChild(this.fpsEl);
  }

  private changed(key: string, v: number | string | boolean | null): boolean {
    if (this.last.get(key) === v) return false;
    this.last.set(key, v);
    return true;
  }

  update(s: HudState, showFps: boolean) {
    const now = performance.now();
    // Money with animated count and delta
    if (this.moneyTarget === null) { this.moneyTarget = s.money; this.moneyShown = s.money; this.moneyFrom = s.money; }
    else if (s.money !== this.moneyTarget) {
      const delta = s.money - this.moneyTarget;
      this.moneyFrom = this.moneyShown; this.moneyTarget = s.money; this.moneyT0 = now;
      this.moneyDelta.textContent = (delta > 0 ? '+' : '−') + formatMoney(Math.abs(delta));
      setClass(this.moneyDelta, 'is-neg', delta < 0);
      this.moneyDelta.classList.remove('is-show');
      void this.moneyDelta.offsetWidth;
      this.moneyDelta.classList.add('is-show');
    }
    if (this.moneyShown !== this.moneyTarget) {
      const k = this.reduced ? 1 : Math.min(1, (now - this.moneyT0) / 750);
      const e = 1 - (1 - k) ** 3;
      this.moneyShown = k >= 1 ? this.moneyTarget : this.moneyFrom + (this.moneyTarget - this.moneyFrom) * e;
    }
    const mt = formatMoney(this.moneyShown);
    if (mt !== this.moneyText) { this.moneyText = mt; this.money.set(mt); }

    // Heat
    const filled = Math.max(0, Math.min(5, Math.ceil(s.heat - 0.05)));
    if (filled !== this.heatShown) {
      for (let i = 0; i < 5; i++) {
        const on = i < filled;
        if (on && i >= this.heatShown && this.heatShown >= 0) { this.flares[i].classList.remove('is-pop'); void this.flares[i].offsetWidth; this.flares[i].classList.add('is-pop'); }
        setClass(this.flares[i], 'is-on', on);
      }
      this.heatShown = filled;
    }
    setClass(this.heatEl, 'is-visible', filled > 0);
    setClass(this.heatEl, 'is-flash', s.heatFlash && filled > 0);

    // Weapon
    if (s.weaponIcon !== this.weaponIcon) { this.weaponIcon = s.weaponIcon; this.weaponIconEl.innerHTML = weaponSvg(s.weaponIcon); }
    this.weaponName.set(s.weaponName);
    const melee = s.ammoClip < 0;
    setClass(this.ammoEl, 'is-hidden', melee);
    if (!melee) {
      this.ammoClip.set(String(s.ammoClip));
      this.ammoReserve.set(String(s.ammoReserve));
      setClass(this.ammoEl, 'is-empty', s.ammoClip === 0);
      setClass(this.ammoEl, 'is-reloading', s.reloading);
    }

    // Objective
    if (s.objective !== this.objectiveLast) {
      this.objectiveLast = s.objective;
      if (s.objective) {
        this.objectiveText.set(s.objective);
        this.objectiveEl.classList.remove('is-visible'); void this.objectiveEl.offsetWidth;
      }
      setClass(this.objectiveEl, 'is-visible', !!s.objective);
    }
    // Mission timer
    if (this.changed('timer', s.missionTimer === null ? null : Math.ceil(s.missionTimer))) {
      setClass(this.timerEl, 'is-visible', s.missionTimer !== null);
      if (s.missionTimer !== null) { this.timerText.set(formatTimer(s.missionTimer)); setClass(this.timerEl, 'is-urgent', s.missionTimer <= 10); }
    }

    // Location
    this.district.set(s.district);
    this.street.set(s.streetName);
    this.clock.set(s.clock);

    // Vitals
    const hp = s.maxHealth > 0 ? Math.max(0, Math.min(1, s.health / s.maxHealth)) : 0;
    if (this.changed('hp', Math.round(hp * 500))) {
      this.healthFill.style.transform = `scaleX(${hp.toFixed(3)})`;
      this.healthGhost.style.transform = `scaleX(${hp.toFixed(3)})`;
      setClass(this.vitalsEl, 'is-low', hp < 0.25);
    }
    const ar = Math.max(0, Math.min(1, s.armor / 100));
    if (this.changed('ar', Math.round(ar * 500))) {
      this.armorFill.style.transform = `scaleX(${ar.toFixed(3)})`;
      setClass(this.vitalsEl, 'no-armor', ar <= 0);
    }
    const stam = Math.max(0, Math.min(1, s.stamina));
    if (this.changed('st', Math.round(stam * 200))) {
      this.staminaFill.style.transform = `scaleX(${stam.toFixed(3)})`;
      setClass(this.staminaRow, 'is-visible', stam < 0.995);
    }

    // Vehicle
    const inVeh = s.vehicleSpeedKmh !== null;
    setClass(this.vehicleEl, 'is-visible', inVeh);
    if (inVeh) {
      const kmh = Math.max(0, Math.round(s.vehicleSpeedKmh ?? 0));
      if (this.changed('kmh', kmh)) {
        this.speed.set(String(kmh));
        this.gauge.style.strokeDashoffset = String(100 - Math.min(1, kmh / 220) * 100);
      }
      this.vehicleName.set(s.vehicleName ?? '');
      const vhp = Math.max(0, Math.min(1, s.vehicleHealth ?? 1));
      if (this.changed('vhp', Math.round(vhp * 200))) {
        this.vehHealthFill.style.transform = `scaleX(${vhp.toFixed(3)})`;
        setClass(this.vehicleEl, 'is-damaged', vhp < 0.3);
      }
    }
    // Radio toast
    if (s.radio !== this.radioLast) {
      const prev = this.radioLast;
      this.radioLast = s.radio;
      if (s.radio || (inVeh && prev)) {
        this.radioName.set(s.radio ?? 'Radio off');
        this.radioEl.classList.add('is-visible');
        window.clearTimeout(this.radioTimer);
        this.radioTimer = window.setTimeout(() => this.radioEl.classList.remove('is-visible'), 3200);
      }
    }
    if (!inVeh && this.radioEl.classList.contains('is-visible') && !s.radio) this.radioEl.classList.remove('is-visible');

    // Crosshair + hit marker
    if (this.changed('ch', s.crosshair)) {
      setClass(this.crosshair, 'is-dot', s.crosshair === 'dot');
      setClass(this.crosshair, 'is-aim', s.crosshair === 'aim');
    }
    if (s.crosshair === 'aim') {
      const spread = Math.max(0, Math.min(1.5, s.crosshairSpread));
      const px = Math.round((5 + spread * 30) * 2) / 2;
      if (this.changed('spread', px)) this.crosshair.style.setProperty('--ma-spread', `${px}px`);
    }
    const hm = Math.round(Math.max(0, Math.min(1, s.hitMarker)) * 20) / 20;
    if (this.changed('hm', hm)) { this.hitmarker.style.opacity = String(hm); this.hitmarker.style.setProperty('--ma-hm', String(hm)); }

    // Interact prompt: "E  Enter vehicle" -> key cap + text
    if (s.interactPrompt !== this.promptLast) {
      this.promptLast = s.interactPrompt;
      if (s.interactPrompt) {
        const m = /^(\S{1,12})\s{2,}(.+)$/.exec(s.interactPrompt);
        this.promptKey.set(m ? m[1] : '');
        setClass(this.promptKey.el, 'is-hidden', !m);
        this.promptText.set(m ? m[2] : s.interactPrompt);
      }
      setClass(this.promptEl, 'is-visible', !!s.interactPrompt);
    }

    // FPS
    const showF = showFps && s.fps !== null;
    setClass(this.fpsEl, 'is-visible', showF);
    if (showF) this.fps.set(`${Math.round(s.fps ?? 0)} FPS`);
  }
}

/** Toasts, contextual hint, subtitles: shown even when the HUD is hidden. */
export class Notices {
  readonly toasts: HTMLDivElement;
  readonly hint: HTMLDivElement;
  readonly subtitleEl: HTMLDivElement;
  private hintText: HTMLDivElement;
  private hintTimer = 0;
  private subSpeaker: HTMLSpanElement;
  private subText: HTMLSpanElement;

  constructor() {
    this.toasts = h('div', 'ma-toasts');
    this.toasts.setAttribute('aria-live', 'polite');
    this.hint = h('div', 'ma-hint');
    this.hint.appendChild(h('div', 'ma-eyebrow', 'Tip'));
    this.hintText = h('div', 'ma-hint-text');
    this.hint.appendChild(this.hintText);
    this.subtitleEl = h('div', 'ma-subtitle');
    this.subSpeaker = h('span', 'ma-subtitle-speaker');
    this.subText = h('span', 'ma-subtitle-text');
    this.subtitleEl.append(this.subSpeaker, this.subText);
  }

  toast(text: string, kind: 'info' | 'money' | 'heat' | 'mission' | 'warning') {
    const lastEl = this.toasts.lastElementChild as HTMLElement | null;
    if (lastEl && !lastEl.classList.contains('is-leaving') && lastEl.dataset.text === text && lastEl.dataset.kind === kind) {
      const n = Number(lastEl.dataset.count ?? '1') + 1;
      lastEl.dataset.count = String(n);
      const c = lastEl.querySelector('.ma-toast-count');
      if (c) c.textContent = `×${n}`;
      window.clearTimeout(Number(lastEl.dataset.timer));
      lastEl.dataset.timer = String(window.setTimeout(() => this.dismiss(lastEl), 3600));
      return;
    }
    const t = h('div', `ma-toast ma-toast-${kind}`);
    t.dataset.text = text; t.dataset.kind = kind;
    t.appendChild(h('span', 'ma-toast-mark'));
    t.appendChild(h('span', 'ma-toast-text', text));
    t.appendChild(h('span', 'ma-toast-count'));
    this.toasts.appendChild(t);
    const live = Array.from(this.toasts.children).filter(c => !c.classList.contains('is-leaving')) as HTMLElement[];
    while (live.length > 4) { const old = live.shift(); if (old) this.dismiss(old); }
    t.dataset.timer = String(window.setTimeout(() => this.dismiss(t), 3600));
  }
  private dismiss(t: HTMLElement) {
    if (t.classList.contains('is-leaving')) return;
    window.clearTimeout(Number(t.dataset.timer));
    t.classList.add('is-leaving');
    window.setTimeout(() => t.remove(), 320);
  }

  showHint(render: (el: HTMLElement) => void, seconds: number) {
    render(this.hintText);
    this.hint.classList.remove('is-visible'); void this.hint.offsetWidth;
    this.hint.classList.add('is-visible');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hint.classList.remove('is-visible'), Math.max(1, seconds) * 1000);
  }

  subtitle(text: string | null, speaker?: string) {
    if (!text) { this.subtitleEl.classList.remove('is-visible'); return; }
    this.subSpeaker.textContent = speaker ? speaker : '';
    setClass(this.subSpeaker, 'is-hidden', !speaker);
    this.subText.textContent = text;
    this.subtitleEl.classList.add('is-visible');
  }
}
