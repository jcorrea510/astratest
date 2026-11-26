/**
 * On-screen touch controls (iPad / phone, landscape): floating move stick on the left, drag-to-look on the right, a thumb
 * cluster of labelled buttons that changes with the context (on foot / car / helicopter), pause + map at the top left.
 * It only feeds Input (setTouchAction / setTouchMove / addLook); every pointer is tracked on its own, so move + look + shoot work together.
 * Pure layout and maths live in touchLayout.ts.
 */
import type { Input } from '../core/input';
import type { Action, TouchControlsMode } from '../core/settings';
import { h } from './dom';
import { LAYOUTS, TOP_BUTTONS, LOOK_GAIN, STICK_SPRINT, axesFor, stickAxes, uFor, pxSize, touchWanted, type TouchButton, type TouchContext } from './touchLayout';
import './touch.css';

const NS = 'http://www.w3.org/2000/svg';
/** Original 24x24 line icons, stroked with currentColor. */
const ICONS: Record<string, string> = {
  fire: 'M12 3v4M12 17v4M3 12h4M17 12h4M12 12m-1.6 0a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0',
  aim: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0-2 0',
  jump: 'M12 19V6M6 11l6-6 6 6',
  run: 'M5 6l6 6-6 6M12 6l6 6-6 6',
  car: 'M4 15v-3l2-5h12l2 5v3M4 15h16M7.5 17.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M16.5 17.5m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  use: 'M9 11V6a1.5 1.5 0 0 1 3 0v5M12 10V8a1.5 1.5 0 0 1 3 0v3M15 10a1.5 1.5 0 0 1 3 0v4a6 6 0 0 1-6 6h-1a5 5 0 0 1-4-2l-2-3 2-1 2 1.5V9',
  reload: 'M19 12a7 7 0 1 1-2.2-5.1M19 4v4h-4',
  roll: 'M12 12m-6.5 0a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0-13 0M12 5.5a6.5 6.5 0 0 1 6.5 6.5M16 3l2.5 2.5L16 8',
  wheel: 'M12 12m-8 0a8 8 0 1 0 16 0a8 8 0 1 0-16 0M12 12m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0M12 4v6M5 16l5-3M19 16l-5-3',
  gas: 'M8 20l3-14h3l-1 14M6 20h12',
  brake: 'M6 6h12v12H6z',
  hand: 'M12 12m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M12 9v3.5M12 14.5v.1M4 8a9 9 0 0 0 0 8M20 8a9 9 0 0 1 0 8',
  horn: 'M4 10v4h3l5 4V6L7 10zM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11',
  radio: 'M4 9h16v10H4zM8 9l9-5M8 14h4M15 14h2',
  cam: 'M4 8h4l1.5-2h5L16 8h4v11H4zM12 13.5m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  up: 'M12 19V6M6 11l6-6 6 6',
  down: 'M12 5v13M6 13l6 6 6-6',
  pause: 'M8 5v14M16 5v14',
  map: 'M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2zM9 4v14M15 6v14',
};
function icon(name: string): SVGSVGElement {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.classList.add('ma-touch-ic');
  const p = document.createElementNS(NS, 'path'); p.setAttribute('d', ICONS[name] ?? ICONS.fire); s.appendChild(p);
  return s;
}

export interface TouchState { show: boolean; ctx: TouchContext }

export class TouchControls {
  readonly el: HTMLDivElement;
  private root: HTMLElement;
  private input: Input;
  private enabled = false;
  private sawTouch = false;
  private ctx: TouchContext = 'foot';
  private shown = false;
  private btnEls = new Map<string, HTMLButtonElement>();
  private toggled = new Map<string, boolean>();
  private btnHost = h('div', 'ma-touch-buttons');
  private topHost = h('div', 'ma-touch-top');
  private stickBase = h('div', 'ma-touch-stick');
  private stickKnob = h('div', 'ma-touch-knob');
  private stickGhost = h('div', 'ma-touch-ghost');
  private stick: { id: number; ox: number; oy: number } | null = null;
  private look = new Map<number, { x: number; y: number }>();
  private stickSprint = false;
  private mq: MediaQueryList | null = null;

  constructor(root: HTMLElement, layer: HTMLElement, input: Input, forced = false, mode: TouchControlsMode = 'auto') {
    this.root = root; this.input = input;
    this.el = h('div', 'ma-touch');
    this.el.dataset.touchUi = '';
    const lookZone = h('div', 'ma-touch-look'); lookZone.dataset.zone = 'look';
    const stickZone = h('div', 'ma-touch-move'); stickZone.dataset.zone = 'move';
    this.stickBase.appendChild(this.stickKnob);
    this.stickGhost.appendChild(h('div', 'ma-touch-ghost-knob'));
    this.el.append(lookZone, stickZone, this.stickGhost, this.stickBase, this.btnHost, this.topHost);
    layer.appendChild(this.el);
    this.wireStick(stickZone); this.wireLook(lookZone);
    this.buildTop();
    this.buildButtons();
    // never let the page scroll, zoom, select or open a callout from a touch on the controls
    for (const t of ['contextmenu', 'selectstart', 'dragstart'] as const) this.el.addEventListener(t, e => e.preventDefault());
    document.addEventListener('gesturestart', e => e.preventDefault());
    try { this.mq = matchMedia('(pointer: coarse)'); this.mq.addEventListener?.('change', () => this.refresh()); } catch { /* no matchMedia */ }
    const onPointer = (e: PointerEvent) => {
      const t = e.pointerType === 'touch' || e.pointerType === 'pen';
      const m = e.pointerType === 'mouse';
      if (t !== this.sawTouch || m !== this.sawMouse) { this.sawTouch = t; this.sawMouse = m; this.refresh(); }
    };
    window.addEventListener('pointerdown', onPointer, { capture: true, passive: true });
    // a finger that only drags (no pointerdown reached us yet, e.g. inside an iframe on iOS) still counts
    window.addEventListener('touchstart', () => { if (!this.sawTouch) { this.sawTouch = true; this.sawMouse = false; this.refresh(); } }, { capture: true, passive: true });
    window.addEventListener('blur', () => this.releaseAll());
    this.forced = forced; this.mode = mode;
    this.refresh();
  }
  private forced = false;
  private mode: TouchControlsMode = 'auto';
  private sawMouse = false;
  get isEnabled(): boolean { return this.enabled; }
  /** Settings > Controls > Touch Controls (auto / on / off). */
  setMode(mode: TouchControlsMode) { if (mode === this.mode) return; this.mode = mode; this.refresh(); }
  /** Coarse pointer (touch screen) or a finger just touched: show the controls. A mouse click hides them again unless the screen is coarse. */
  private refresh() {
    let coarse = false; try { coarse = !!this.mq?.matches; } catch { /* ignore */ }
    let maxTouch = 0; try { maxTouch = navigator.maxTouchPoints || ('ontouchstart' in window ? 1 : 0); } catch { /* ignore */ }
    const on = touchWanted(this.mode, { forced: this.forced, coarse, maxTouch, sawTouch: this.sawTouch, sawMouse: this.sawMouse });
    if (on === this.enabled) return;
    this.enabled = on;
    this.input.touchActive = on;
    this.root.classList.toggle('has-touch', on);
    if (!on) this.releaseAll();
    this.syncVisible();
  }

  /** Call every frame (cheap): shows / hides the controls and swaps the button set when the player gets in or out of a vehicle. */
  sync(s: TouchState) {
    if (s.ctx !== this.ctx) { this.ctx = s.ctx; this.releaseAll(); this.buildButtons(); }
    if (s.show !== this.shown) { this.shown = s.show; if (!s.show) this.releaseAll(); this.syncVisible(); }
  }
  private syncVisible() { this.el.classList.toggle('is-on', this.enabled && this.shown); this.el.dataset.ctx = this.ctx; }

  /** Lift every finger: nothing stays held (menu opened, vehicle changed, window lost focus). */
  releaseAll() {
    this.input.clearTouch();
    this.stick = null; this.look.clear(); this.stickSprint = false;
    this.stickBase.classList.remove('is-down'); this.stickGhost.classList.remove('is-hidden');
    this.toggled.clear(); this.sprintBtn = false;
    for (const [, b] of this.btnEls) b.classList.remove('is-down', 'is-on');
  }

  private u(): number { return uFor(window.innerWidth, window.innerHeight, parseFloat(getComputedStyle(this.root).getPropertyValue('--ma-ui-scale')) || 1); }

  // ---------------------------------------------------------------- buttons
  private place(b: HTMLButtonElement, spec: TouchButton, top = false) {
    b.style.setProperty('--sz', `max(44px, calc(${spec.size} * var(--u)))`);
    if (top) return;
    b.style.right = `calc(env(safe-area-inset-right, 0px) + ${spec.right} * var(--u))`;
    b.style.bottom = `calc(env(safe-area-inset-bottom, 0px) + ${spec.bottom} * var(--u))`;
  }
  private makeButton(spec: TouchButton, top = false): HTMLButtonElement {
    const b = h('button', `ma-touch-btn is-${spec.id}`);
    b.type = 'button'; b.dataset.touchBtn = spec.id; b.dataset.action = spec.action;
    b.setAttribute('aria-label', spec.label);
    b.append(icon(spec.icon), h('span', 'ma-touch-lbl', spec.label));
    this.place(b, spec, top);
    this.wireButton(b, spec);
    return b;
  }
  private buildTop() {
    this.topHost.replaceChildren();
    TOP_BUTTONS.forEach((s, i) => { const b = this.makeButton(s, true); b.style.setProperty('--i', String(i)); this.btnEls.set(`top-${s.id}`, b); this.topHost.appendChild(b); });
  }
  private buildButtons() {
    for (const k of [...this.btnEls.keys()]) if (!k.startsWith('top-')) this.btnEls.delete(k);
    this.btnHost.replaceChildren();
    for (const s of LAYOUTS[this.ctx]) { const b = this.makeButton(s); this.btnEls.set(s.id, b); this.btnHost.appendChild(b); }
    this.el.dataset.ctx = this.ctx;
  }
  private wireButton(b: HTMLButtonElement, spec: TouchButton) {
    let id = -1; let last = { x: 0, y: 0 };
    const set = (a: Action, down: boolean) => this.input.setTouchAction(a, down);
    b.addEventListener('pointerdown', e => {
      if (id !== -1) return;
      e.preventDefault(); e.stopPropagation();
      id = e.pointerId; last = { x: e.clientX, y: e.clientY };
      try { b.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      if (spec.kind === 'toggle') {
        const on = !this.toggled.get(spec.id); this.toggled.set(spec.id, on);
        b.classList.toggle('is-on', on); this.applyToggle(spec, on);
      } else { b.classList.add('is-down'); set(spec.action, true); }
    });
    b.addEventListener('pointermove', e => {
      if (e.pointerId !== id || !(spec.look || spec.wheel)) return;
      this.input.addLook((e.clientX - last.x) * LOOK_GAIN, (e.clientY - last.y) * LOOK_GAIN); last = { x: e.clientX, y: e.clientY };
    });
    const up = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      id = -1; b.classList.remove('is-down');
      if (spec.kind !== 'toggle') set(spec.action, false);
    };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('lostpointercapture', up);
  }
  private applyToggle(spec: TouchButton, on: boolean) {
    if (spec.action === 'sprint') { this.sprintBtn = on; this.updateSprint(); } else this.input.setTouchAction(spec.action, on);
  }
  private sprintBtn = false;
  private updateSprint() { this.input.setTouchAction('sprint', this.sprintBtn || this.stickSprint); }

  // ---------------------------------------------------------------- stick (left thumb)
  private wireStick(zone: HTMLElement) {
    zone.addEventListener('pointerdown', e => {
      if (this.stick) return;
      e.preventDefault();
      try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      this.stick = { id: e.pointerId, ox: e.clientX, oy: e.clientY };
      this.stickBase.style.left = `${e.clientX}px`; this.stickBase.style.top = `${e.clientY}px`;
      this.stickBase.classList.add('is-down'); this.stickGhost.classList.add('is-hidden');
      this.moveKnob(0, 0);
    });
    zone.addEventListener('pointermove', e => {
      const s = this.stick; if (!s || e.pointerId !== s.id) return;
      const R = 56 * this.u();
      let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
      const len = Math.hypot(dx, dy);
      if (len > R * 1.5) { // the base follows a finger that wanders, so reversing direction is instant
        const k = (len - R * 1.5) / len; s.ox += dx * k; s.oy += dy * k; dx = e.clientX - s.ox; dy = e.clientY - s.oy;
        this.stickBase.style.left = `${s.ox}px`; this.stickBase.style.top = `${s.oy}px`;
      }
      const a = stickAxes(dx, dy, R);
      const m = axesFor(this.ctx, a);
      this.input.setTouchMove(m.x, m.y);
      const sp = this.ctx === 'foot' && (this.stickSprint ? a.mag > 0.85 : a.mag >= STICK_SPRINT);
      if (sp !== this.stickSprint) { this.stickSprint = sp; this.updateSprint(); }
      this.moveKnob(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (!this.stick || e.pointerId !== this.stick.id) return;
      this.stick = null; this.input.setTouchMove(0, 0);
      if (this.stickSprint) { this.stickSprint = false; this.updateSprint(); }
      this.stickBase.classList.remove('is-down'); this.stickGhost.classList.remove('is-hidden');
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  }
  private moveKnob(dx: number, dy: number) {
    const R = 56 * this.u(), len = Math.hypot(dx, dy), k = len > R ? R / len : 1;
    this.stickKnob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;
  }

  // ---------------------------------------------------------------- camera drag (right side)
  private wireLook(zone: HTMLElement) {
    zone.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { zone.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
      this.look.set(e.pointerId, { x: e.clientX, y: e.clientY });
    });
    zone.addEventListener('pointermove', e => {
      const p = this.look.get(e.pointerId); if (!p) return;
      this.input.addLook((e.clientX - p.x) * LOOK_GAIN, (e.clientY - p.y) * LOOK_GAIN); p.x = e.clientX; p.y = e.clientY;
    });
    const end = (e: PointerEvent) => { this.look.delete(e.pointerId); };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);
  }

  /** Test / diagnostics: rendered size of every button in CSS px (all must be >= 44). */
  buttonSizes(): Record<string, number> {
    const u = this.u(); const o: Record<string, number> = {};
    for (const s of [...LAYOUTS[this.ctx], ...TOP_BUTTONS]) o[s.id] = pxSize(s.size, u);
    return o;
  }
}
