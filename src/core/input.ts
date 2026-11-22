/** Keyboard, mouse and gamepad input mapped to rebindable actions. */
import type { Action, Settings } from './settings';
import { PAD_LAYOUTS, padHeld, setPadContext, type PadContext, readPad, padActive, deadzone, EMPTY_PAD, type PadState } from './gamepad';
import { pointerLockSupported, isIPad } from './platform';
export type { PadState };
export type ActionSource = 'kbm' | 'pad';

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0; mouseDY = 0; wheel = 0;
  locked = false;
  /** True when the browser has no Pointer Lock (iPad Safari): the cursor itself looks around and a finger drag looks too. */
  virtualLock = false;
  private lastTouch = new Map<number, { x: number; y: number }>();
  pad: PadState = { ...EMPTY_PAD, buttons: [] };
  private padPrev: boolean[] = [];
  lastSource: ActionSource = 'kbm';
  /** What the gamepad buttons mean right now; the game sets it each frame (on foot / in a car / in a helicopter). */
  private _padCtx: PadContext = 'foot';
  get padContext(): PadContext { return this._padCtx; }
  set padContext(c: PadContext) { this._padCtx = c; setPadContext(c); }
  enabled = true;
  /** Synthetic codes held by automated tests / scripted input. */
  scripted = new Set<string>();
  private captureCb: ((code: string) => void) | null = null;

  constructor(private settings: Settings, private canvas: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (this.captureCb) { e.preventDefault(); const cb = this.captureCb; this.captureCb = null; cb(e.code); return; }
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft'].includes(e.code) && this.enabled) e.preventDefault();
      if (!e.repeat) { this.pressed.add(e.code); if (this.settings.aimToggle && this.enabled && this.codes('aim').includes(e.code)) this.aimLatch = !this.aimLatch; }
      this.down.add(e.code); this.lastSource = 'kbm';
    });
    window.addEventListener('keyup', e => { this.down.delete(e.code); this.released.add(e.code); });
    window.addEventListener('blur', () => { for (const c of this.down) this.released.add(c); this.down.clear(); });
    window.addEventListener('mousedown', e => {
      const code = `Mouse${e.button}`;
      if (this.captureCb) { e.preventDefault(); const cb = this.captureCb; this.captureCb = null; cb(code); return; }
      if (e.target !== canvas && !this.locked) return;
      this.down.add(code); this.pressed.add(code); this.lastSource = 'kbm';
      if (this.settings.aimToggle && this.codes('aim').includes(code)) this.aimLatch = !this.aimLatch;
    });
    window.addEventListener('mouseup', e => { const code = `Mouse${e.button}`; this.down.delete(code); this.released.add(code); });
    window.addEventListener('contextmenu', e => { if (e.target === canvas || this.locked) e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    window.addEventListener('wheel', e => {
      if (!this.locked) return;
      // Round 7: a trackpad (smooth pixel deltas, sideways too) steers the aim while aiming instead of switching weapons
      if (e.deltaMode === 0 && (e.deltaX !== 0 || Math.abs(e.deltaY) < 40 || !Number.isInteger(e.deltaY)) && this.held('aim')) { this.mouseDX += e.deltaX * 0.9; this.mouseDY += e.deltaY * 0.9; return; }
      const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
      this.pressed.add(code); this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    canvas.addEventListener('pointermove', e => {
      if (!this.virtualLock || e.pointerType !== 'touch') return;
      const prev = this.lastTouch.get(e.pointerId);
      this.lastTouch.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (prev) { this.mouseDX += (e.clientX - prev.x) * 1.4; this.mouseDY += (e.clientY - prev.y) * 1.4; }
    });
    const dropTouch = (e: PointerEvent) => { this.lastTouch.delete(e.pointerId); };
    canvas.addEventListener('pointerup', dropTouch); canvas.addEventListener('pointercancel', dropTouch);
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
  }
  captureNext(cb: (code: string) => void) { this.captureCb = cb; }
  requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    if (!pointerLockSupported(this.canvas)) { this.virtualLock = true; this.locked = true; return; }
    try {
      const r = (this.canvas as HTMLCanvasElement).requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => { if (isIPad()) { this.virtualLock = true; this.locked = true; } /* else: user gesture required; we retry on next click */ });
    } catch { /* ignore */ }
  }
  /** click-to-aim state (settings.aimToggle) */
  aimLatch = false;
  exitLock() { this.aimLatch = false; if (this.virtualLock) this.locked = false; if (document.pointerLockElement) document.exitPointerLock(); }
  private codes(a: Action) { return this.settings.bindings[a] ?? []; }
  private isCodeDown(c: string) { return this.down.has(c) || this.scripted.has(c); }
  held(a: Action): boolean {
    if (!this.enabled) return false;
    if (a === 'aim' && this.settings.aimToggle && this.aimLatch && this.lastSource === 'kbm') return true;
    if (a === 'aim' && this.settings.aimToggle && this.lastSource === 'kbm' && this.codes(a).some(c => c.startsWith('Mouse') && this.down.has(c))) return this.aimLatch;
    if (this.codes(a).some(c => this.isCodeDown(c))) return true;
    return padHeld(a, this.pad, this._padCtx);
  }
  justPressed(a: Action): boolean {
    if (!this.enabled && a !== 'pause') return false;
    if (this.codes(a).some(c => this.pressed.has(c))) return true;
    const pb = PAD_LAYOUTS[this._padCtx].buttons[a];
    if (pb && pb.some(b => this.pad.buttons[b] && !this.padPrev[b])) return true;
    return false;
  }
  /** A raw key code pressed this frame (menu digits, tests); not tied to a rebindable action. */
  rawPressed(code: string): boolean { return this.enabled && this.pressed.has(code); }
  justReleased(a: Action): boolean {
    if (this.codes(a).some(c => this.released.has(c))) return true;
    const pb = PAD_LAYOUTS[this._padCtx].buttons[a];
    if (pb && pb.some(b => !this.pad.buttons[b] && this.padPrev[b])) return true;
    return false;
  }
  /** Movement axes in [-1,1]: x = right, y = forward. */
  moveAxes(): { x: number; y: number } {
    if (!this.enabled) return { x: 0, y: 0 };
    let x = (this.held('right') ? 1 : 0) - (this.held('left') ? 1 : 0);
    let y = (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0);
    if (this.pad.connected && (Math.abs(this.pad.lx) > 0.15 || Math.abs(this.pad.ly) > 0.15)) { x = this.pad.lx; y = -this.pad.ly; }
    const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; }
    return { x, y };
  }
  /** Look delta in "mouse pixel" units for this frame. */
  lookDelta(dt: number): { x: number; y: number } {
    let x = this.mouseDX, y = this.mouseDY;
    if (this.pad.connected) {
      const dz = (v: number) => Math.sign(v) * Math.abs(deadzone(v)) ** 1.6;
      x += dz(this.pad.rx) * 900 * dt; y += dz(this.pad.ry) * 600 * dt;
    }
    if (!this.enabled) return { x: 0, y: 0 };
    return { x, y };
  }
  /** Triggers as analog throttle for driving. */
  throttle(): number {
    if (!this.enabled) return 0;
    if (this.pad.connected && (this.pad.rt > 0.05 || this.pad.lt > 0.05)) return this.pad.rt - this.pad.lt;
    return (this.held('forward') ? 1 : 0) - (this.held('back') ? 1 : 0);
  }
  pollGamepad() {
    this.padPrev = this.pad.buttons.slice();
    this.pad = readPad();
    if (padActive(this.pad)) this.lastSource = 'pad';
  }
  /** Call at the end of every frame. */
  endFrame() { this.pressed.clear(); this.released.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
  /** Scripted input helpers (used by automated playtests). */
  press(code: string) { this.pressed.add(code); this.scripted.add(code); }
  release(code: string) { this.scripted.delete(code); this.released.add(code); }
  tap(code: string) { this.pressed.add(code); }
  clearAll() { this.down.clear(); this.scripted.clear(); }
}
