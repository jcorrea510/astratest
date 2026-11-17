/** In-game HUD. update() runs every frame and only touches the DOM when a value changes. */
import type { CityMap } from '../world/citymap';
import type { HudState, WeaponIcon } from './contracts';
import { FLARE_SVG, WRENCH_SVG, weaponSvg } from './icons';
import { formatMoney, formatTimer } from './geometry';
import { h, setClass, TextSlot, prefersReducedMotion, renderHintText } from './dom';
import { Minimap } from './minimap';
import type { CityPainter } from './mapdraw';

/** Briefly shows an element (adds .is-visible), restarting the timer on every call. */
class Popup {
  private timer = 0;
  constructor(readonly el: HTMLElement) {}
  show(ms: number) {
    window.clearTimeout(this.timer);
    this.el.classList.add('is-visible');
    this.timer = window.setTimeout(() => this.el.classList.remove('is-visible'), ms);
  }
  hide() { window.clearTimeout(this.timer); this.el.classList.remove('is-visible'); }
}

export class Hud {
  readonly el: HTMLDivElement;
  readonly minimap: Minimap;
  /** Objective line; lives in the notice layer's bottom stack (under dialogue) so the two never overlap. */
  readonly objectiveEl: HTMLDivElement;
  private money: TextSlot;
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
  private weaponNameLast: string | null = null;
  private weaponPop: Popup;
  private ammoEl: HTMLDivElement;
  private ammoClip: TextSlot;
  private ammoReserve: TextSlot;
  private objectiveText: TextSlot;
  private objectiveLast: string | null = '\u0000';
  private objectiveShownAt = 0;
  private timerEl: HTMLDivElement;
  private timerText: TextSlot;
  private robberyEl: HTMLDivElement;
  private robberyLabel: TextSlot;
  private robberyCash: TextSlot;
  private robberyFill: HTMLDivElement;
  private robberyLast = -1;
  private locEl: HTMLDivElement;
  private locPop: Popup;
  private locVehicle: TextSlot;
  private district: TextSlot;
  private street: TextSlot;
  private locLast = { district: '', street: '', vehicle: '' as string | null, at: 0 };
  private clock: TextSlot;
  private radarEl: HTMLDivElement;
  private healthFill: HTMLDivElement;
  private armorFill: HTMLDivElement;
  private staminaEl: HTMLDivElement;
  private staminaFill: HTMLDivElement;
  private vitalsEl: HTMLDivElement;
  private speedoEl: HTMLDivElement;
  private speed: TextSlot;
  private speedBar: HTMLDivElement;
  private vehHealthFill: HTMLDivElement;
  private radioPop: Popup;
  private radioName: TextSlot;
  private radioLast: string | null = null;
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
  private started = false;

  constructor(_city: CityMap, painter: CityPainter) {
    this.el = h('div', 'ma-hud');

    // Top centre: radio station popup
    const radio = h('div', 'ma-radio');
    radio.appendChild(h('span', 'ma-radio-icon'));
    const rn = h('span', 'ma-radio-name');
    this.radioName = new TextSlot(rn);
    radio.appendChild(rn);
    this.radioPop = new Popup(radio);
    this.el.appendChild(radio);

    // Top right: money, weapon, heat
    const tr = h('div', 'ma-hud-tr');
    const moneyEl = h('div', 'ma-money');
    const mv = h('div', 'ma-money-value');
    this.money = new TextSlot(mv);
    this.moneyDelta = h('div', 'ma-money-delta');
    moneyEl.append(mv, this.moneyDelta);
    tr.appendChild(moneyEl);
    this.weaponEl = h('div', 'ma-weapon');
    this.weaponIconEl = h('div', 'ma-weapon-icon');
    const wn = h('div', 'ma-weapon-name');
    this.weaponName = new TextSlot(wn);
    this.weaponPop = new Popup(wn);
    this.ammoEl = h('div', 'ma-ammo');
    const ac = h('span', 'ma-ammo-clip'), ar = h('span', 'ma-ammo-reserve');
    this.ammoClip = new TextSlot(ac); this.ammoReserve = new TextSlot(ar);
    this.ammoEl.append(ac, h('span', 'ma-ammo-sep', '/'), ar);
    const wrow = h('div', 'ma-weapon-row');
    wrow.append(this.ammoEl, this.weaponIconEl);
    this.weaponEl.append(wrow, wn);
    tr.appendChild(this.weaponEl);
    this.heatEl = h('div', 'ma-heat');
    this.heatEl.setAttribute('aria-label', 'Heat level');
    for (let i = 0; i < 5; i++) {
      const f = h('span', 'ma-flare');
      f.innerHTML = FLARE_SVG;
      this.heatEl.appendChild(f);
      this.flares.push(f);
    }
    tr.appendChild(this.heatEl);
    this.el.appendChild(tr);

    // Bottom left: radar with the vitals strip hugging its bottom edge
    const bl = h('div', 'ma-hud-bl');
    this.radarEl = h('div', 'ma-radar');
    const ck = h('div', 'ma-radar-clock');
    this.clock = new TextSlot(ck);
    this.radarEl.appendChild(ck);
    this.minimap = new Minimap(painter);
    this.radarEl.appendChild(this.minimap.el);
    this.vitalsEl = h('div', 'ma-vitals');
    const mkBar = (cls: string) => {
      const track = h('div', `ma-vbar ${cls}`);
      const fill = h('div', 'ma-vbar-fill');
      track.append(fill, h('div', 'ma-vbar-notches'));
      this.vitalsEl.appendChild(track);
      return fill;
    };
    this.healthFill = mkBar('ma-vbar-health');
    this.armorFill = mkBar('ma-vbar-armor');
    this.radarEl.appendChild(this.vitalsEl);
    this.staminaEl = h('div', 'ma-stamina');
    this.staminaFill = h('div', 'ma-stamina-fill');
    this.staminaEl.appendChild(this.staminaFill);
    this.radarEl.appendChild(this.staminaEl);
    bl.appendChild(this.radarEl);
    this.el.appendChild(bl);

    // Bottom right: mission bars, location popup, speedometer (bottom-up)
    const br = h('div', 'ma-hud-br');
    this.speedoEl = h('div', 'ma-speedo');
    const sp = h('div', 'ma-speed');
    const spv = h('span', 'ma-speed-value');
    this.speed = new TextSlot(spv);
    sp.append(spv, h('span', 'ma-speed-unit', 'km/h'));
    const sbar = h('div', 'ma-speed-bar');
    this.speedBar = h('div', 'ma-speed-bar-fill');
    sbar.appendChild(this.speedBar);
    const body = h('div', 'ma-body');
    const wr = h('span', 'ma-body-icon'); wr.innerHTML = WRENCH_SVG;
    const bt = h('div', 'ma-body-track');
    this.vehHealthFill = h('div', 'ma-body-fill');
    bt.appendChild(this.vehHealthFill);
    body.append(wr, bt);
    this.speedoEl.append(sp, sbar, body);
    br.appendChild(this.speedoEl);

    this.locEl = h('div', 'ma-loc');
    const lv = h('div', 'ma-loc-vehicle'), ld = h('div', 'ma-loc-district'), ls = h('div', 'ma-loc-street');
    this.locVehicle = new TextSlot(lv); this.district = new TextSlot(ld); this.street = new TextSlot(ls);
    this.locEl.append(lv, ld, ls);
    this.locPop = new Popup(this.locEl);
    br.appendChild(this.locEl);

    const bars = h('div', 'ma-infobars');
    this.timerEl = h('div', 'ma-infobar ma-timer');
    this.timerEl.appendChild(h('span', 'ma-infobar-label', 'Time'));
    const tt = h('span', 'ma-infobar-value');
    this.timerText = new TextSlot(tt);
    this.timerEl.appendChild(tt);
    bars.appendChild(this.timerEl);
    this.robberyEl = h('div', 'ma-infobar ma-robbery');
    const rl = h('span', 'ma-infobar-label');
    this.robberyLabel = new TextSlot(rl);
    const rtrack = h('div', 'ma-robbery-track');
    this.robberyFill = h('div', 'ma-robbery-fill');
    rtrack.appendChild(this.robberyFill);
    const rc = h('span', 'ma-infobar-value ma-robbery-cash');
    this.robberyCash = new TextSlot(rc);
    this.robberyEl.append(rl, rtrack, rc);
    bars.appendChild(this.robberyEl);
    br.appendChild(bars);
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
    const pk = h('kbd', 'ma-key ma-key-lg'), pt = h('span', 'ma-prompt-text');
    this.promptKey = new TextSlot(pk); this.promptText = new TextSlot(pt);
    this.promptEl.append(pk, pt);
    this.el.appendChild(this.promptEl);

    // Objective (mounted by the UI into the bottom stack)
    this.objectiveEl = h('div', 'ma-objective');
    const ot = h('div', 'ma-objective-text');
    this.objectiveText = new TextSlot(ot);
    this.objectiveEl.appendChild(ot);

    this.fpsEl = h('div', 'ma-fps');
    this.fps = new TextSlot(this.fpsEl);
    this.el.appendChild(this.fpsEl);
  }

  private changed(key: string, v: number | string | boolean | null): boolean {
    if (this.last.get(key) === v) return false;
    this.last.set(key, v);
    return true;
  }

  /** Store hold-up meter (null hides it). */
  robbery(s: { label: string; progress: number; cash: number } | null) {
    setClass(this.robberyEl, 'is-visible', !!s);
    if (!s) { this.robberyLast = -1; return; }
    this.robberyLabel.set(s.label);
    this.robberyCash.set(formatMoney(s.cash));
    const p = Math.round(Math.max(0, Math.min(1, s.progress)) * 400) / 400;
    if (p !== this.robberyLast) { this.robberyLast = p; this.robberyFill.style.transform = `scaleX(${p})`; }
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
    const flash = s.heatFlash && filled > 0;
    setClass(this.heatEl, 'is-flash', flash);
    setClass(this.radarEl, 'is-wanted', filled > 0);
    setClass(this.radarEl, 'is-searching', flash);

    // Weapon: the name pops up briefly whenever the weapon changes
    if (s.weaponIcon !== this.weaponIcon) { this.weaponIcon = s.weaponIcon; this.weaponIconEl.innerHTML = weaponSvg(s.weaponIcon); }
    if (s.weaponName !== this.weaponNameLast) {
      const first = this.weaponNameLast === null;
      this.weaponNameLast = s.weaponName;
      this.weaponName.set(s.weaponName);
      if (!first) this.weaponPop.show(2200);
    }
    const melee = s.ammoClip < 0;
    setClass(this.ammoEl, 'is-hidden', melee);
    if (!melee) {
      this.ammoClip.set(String(s.ammoClip));
      this.ammoReserve.set(String(s.ammoReserve));
      setClass(this.ammoEl, 'is-empty', s.ammoClip === 0);
      setClass(this.ammoEl, 'is-reloading', s.reloading);
    }

    // Objective: re-animates when it really changes (not for counters ticking within the same line)
    if (s.objective !== this.objectiveLast) {
      const prev = this.objectiveLast;
      this.objectiveLast = s.objective;
      if (s.objective) {
        this.objectiveText.set(s.objective);
        const sameFamily = !!prev && prev !== '\u0000' && prev.slice(0, 8) === s.objective.slice(0, 8);
        if (!sameFamily && now - this.objectiveShownAt > 600) {
          this.objectiveEl.classList.remove('is-visible'); void this.objectiveEl.offsetWidth;
        }
        this.objectiveShownAt = now;
      }
      setClass(this.objectiveEl, 'is-visible', !!s.objective);
    }
    // Mission timer
    if (this.changed('timer', s.missionTimer === null ? null : Math.ceil(s.missionTimer))) {
      setClass(this.timerEl, 'is-visible', s.missionTimer !== null);
      if (s.missionTimer !== null) { this.timerText.set(formatTimer(s.missionTimer)); setClass(this.timerEl, 'is-urgent', s.missionTimer <= 10); }
    }

    // Location popup: district changes, entering a vehicle, or a new street (rate-limited)
    this.clock.set(s.clock);
    const L = this.locLast;
    const inVeh = s.vehicleSpeedKmh !== null;
    const vname = inVeh ? (s.vehicleName ?? '') : null;
    const districtChanged = s.district !== L.district, streetChanged = s.streetName !== L.street, vehicleChanged = vname !== L.vehicle;
    if (districtChanged || streetChanged || vehicleChanged) {
      this.district.set(s.district);
      this.street.set(s.streetName);
      this.locVehicle.set(vname ?? '');
      setClass(this.locEl, 'has-vehicle', !!vname);
      const show = !this.started ? false : districtChanged || (vehicleChanged && !!vname) || (streetChanged && now - L.at > 9000);
      L.district = s.district; L.street = s.streetName; L.vehicle = vname;
      if (show) { L.at = now; this.locPop.show(4200); }
      else if (vehicleChanged && !vname) this.locPop.hide();
    }
    this.started = true;

    // Vitals
    const hp = s.maxHealth > 0 ? Math.max(0, Math.min(1, s.health / s.maxHealth)) : 0;
    if (this.changed('hp', Math.round(hp * 500))) {
      this.healthFill.style.transform = `scaleX(${hp.toFixed(3)})`;
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
      setClass(this.staminaEl, 'is-visible', stam < 0.995);
    }

    // Vehicle
    setClass(this.speedoEl, 'is-visible', inVeh);
    setClass(this.el, 'in-vehicle', inVeh);
    if (inVeh) {
      const kmh = Math.max(0, Math.round(s.vehicleSpeedKmh ?? 0));
      if (this.changed('kmh', kmh)) {
        this.speed.set(String(kmh));
        this.speedBar.style.transform = `scaleX(${Math.min(1, kmh / 200).toFixed(3)})`;
      }
      const vhp = Math.max(0, Math.min(1, s.vehicleHealth ?? 1));
      if (this.changed('vhp', Math.round(vhp * 200))) {
        this.vehHealthFill.style.transform = `scaleX(${vhp.toFixed(3)})`;
        setClass(this.speedoEl, 'is-damaged', vhp < 0.3);
      }
    }
    // Radio popup
    if (s.radio !== this.radioLast) {
      const prev = this.radioLast;
      this.radioLast = s.radio;
      if (s.radio || (inVeh && prev)) { this.radioName.set(s.radio ?? 'Radio off'); this.radioPop.show(3200); }
    }
    if (!inVeh && !s.radio && this.radioPop.el.classList.contains('is-visible')) this.radioPop.hide();

    // Crosshair + hit marker
    if (this.changed('ch', s.crosshair)) {
      setClass(this.crosshair, 'is-dot', s.crosshair === 'dot');
      setClass(this.crosshair, 'is-aim', s.crosshair === 'aim');
    }
    if (s.crosshair === 'aim') {
      const spread = Math.max(0, Math.min(1.5, s.crosshairSpread));
      const px = Math.round((4 + spread * 30) * 2) / 2;
      if (this.changed('spread', px)) this.crosshair.style.setProperty('--ma-spread', String(px));
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

/** Toasts, help box, subtitles: shown even when the HUD is hidden. */
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
    this.hint.setAttribute('role', 'status');
    this.hintText = h('div', 'ma-hint-text');
    this.hint.appendChild(this.hintText);
    this.hint.appendChild(h('div', 'ma-hint-timer'));
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
      lastEl.dataset.timer = String(window.setTimeout(() => this.dismiss(lastEl), 3800));
      return;
    }
    const t = h('div', `ma-toast ma-toast-${kind}`);
    t.dataset.text = text; t.dataset.kind = kind;
    t.appendChild(h('span', 'ma-toast-text', text));
    t.appendChild(h('span', 'ma-toast-count'));
    this.toasts.appendChild(t);
    const live = Array.from(this.toasts.children).filter(c => !c.classList.contains('is-leaving')) as HTMLElement[];
    while (live.length > 4) { const old = live.shift(); if (old) this.dismiss(old); }
    t.dataset.timer = String(window.setTimeout(() => this.dismiss(t), 3800));
  }
  private dismiss(t: HTMLElement) {
    if (t.classList.contains('is-leaving')) return;
    window.clearTimeout(Number(t.dataset.timer));
    t.classList.add('is-leaving');
    window.setTimeout(() => t.remove(), 320);
  }

  showHint(text: string, seconds: number) {
    renderHintText(this.hintText, text);
    const s = Math.max(1, seconds);
    this.hint.style.setProperty('--ma-hint-s', `${s}s`);
    this.hint.classList.remove('is-visible'); void this.hint.offsetWidth;
    this.hint.classList.add('is-visible');
    window.clearTimeout(this.hintTimer);
    this.hintTimer = window.setTimeout(() => this.hint.classList.remove('is-visible'), s * 1000);
  }

  subtitle(text: string | null, speaker?: string) {
    if (!text) { this.subtitleEl.classList.remove('is-visible'); return; }
    this.subSpeaker.textContent = speaker ? `${speaker}:` : '';
    setClass(this.subSpeaker, 'is-hidden', !speaker);
    this.subText.textContent = text;
    this.subtitleEl.classList.add('is-visible');
  }
}
