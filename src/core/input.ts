/** Keyboard, mouse and gamepad input mapped to rebindable actions. */
import type { Action, Settings } from './settings';

export interface PadState { lx: number; ly: number; rx: number; ry: number; lt: number; rt: number; buttons: boolean[]; connected: boolean }
type ActionSource = 'kbm' | 'pad';

const PAD_MAP: Partial<Record<Action, number[]>> = {
  jump: [1], enter: [3], reload: [2], sprint: [0], crouch: [10], wheel: [4], handbrake: [0], horn: [10], lookBehind: [11], map: [8], pause: [9], interact: [2], nextWeapon: [5], prevWeapon: [], headlights: [13], radio: [12], camera: [15],
};

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private released = new Set<string>();
  mouseDX = 0; mouseDY = 0; wheel = 0;
  locked = false;
  pad: PadState = { lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, buttons: [], connected: false };
  private padPrev: boolean[] = [];
  lastSource: ActionSource = 'kbm';
  enabled = true;
  /** Synthetic codes held by automated tests / scripted input. */
  scripted = new Set<string>();
  private captureCb: ((code: string) => void) | null = null;

  constructor(private settings: Settings, private canvas: HTMLElement) {
    window.addEventListener('keydown', e => {
      if (this.captureCb) { e.preventDefault(); const cb = this.captureCb; this.captureCb = null; cb(e.code); return; }
      if (['Tab', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ControlLeft'].includes(e.code) && this.enabled) e.preventDefault();
      if (!e.repeat) { this.pressed.add(e.code); }
      this.down.add(e.code); this.lastSource = 'kbm';
    });
    window.addEventListener('keyup', e => { this.down.delete(e.code); this.released.add(e.code); });
    window.addEventListener('blur', () => { for (const c of this.down) this.released.add(c); this.down.clear(); });
    window.addEventListener('mousedown', e => {
      const code = `Mouse${e.button}`;
      if (this.captureCb) { e.preventDefault(); const cb = this.captureCb; this.captureCb = null; cb(code); return; }
      if (e.target !== canvas && !this.locked) return;
      this.down.add(code); this.pressed.add(code); this.lastSource = 'kbm';
    });
    window.addEventListener('mouseup', e => { const code = `Mouse${e.button}`; this.down.delete(code); this.released.add(code); });
    window.addEventListener('contextmenu', e => { if (e.target === canvas || this.locked) e.preventDefault(); });
    window.addEventListener('mousemove', e => { if (this.locked) { this.mouseDX += e.movementX; this.mouseDY += e.movementY; } });
    window.addEventListener('wheel', e => {
      if (!this.locked) return;
      const code = e.deltaY > 0 ? 'WheelDown' : 'WheelUp';
      this.pressed.add(code); this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
  }
  captureNext(cb: (code: string) => void) { this.captureCb = cb; }
  requestLock() {
    if (document.pointerLockElement === this.canvas) return;
    try {
      const r = (this.canvas as HTMLCanvasElement).requestPointerLock?.() as unknown as Promise<void> | undefined;
      if (r && typeof r.catch === 'function') r.catch(() => { /* user gesture required; we retry on next click */ });
    } catch { /* ignore */ }
  }
  exitLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  private codes(a: Action) { return this.settings.bindings[a] ?? []; }
  private isCodeDown(c: string) { return this.down.has(c) || this.scripted.has(c); }
  held(a: Action): boolean {
    if (!this.enabled) return false;
    if (this.codes(a).some(c => this.isCodeDown(c))) return true;
    const pb = PAD_MAP[a];
    if (pb && pb.some(b => this.pad.buttons[b])) return true;
    if (a === 'fire' && this.pad.rt > 0.5) return true;
    if (a === 'aim' && this.pad.lt > 0.5) return true;
    return false;
  }
  justPressed(a: Action): boolean {
    if (!this.enabled && a !== 'pause') return false;
    if (this.codes(a).some(c => this.pressed.has(c))) return true;
    const pb = PAD_MAP[a];
    if (pb && pb.some(b => this.pad.buttons[b] && !this.padPrev[b])) return true;
    return false;
  }
  justReleased(a: Action): boolean {
    if (this.codes(a).some(c => this.released.has(c))) return true;
    const pb = PAD_MAP[a];
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
      const dz = (v: number) => (Math.abs(v) < 0.12 ? 0 : Math.sign(v) * ((Math.abs(v) - 0.12) / 0.88) ** 1.6);
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
    const pads = navigator.getGamepads?.() ?? [];
    const gp = Array.from(pads).find(p => p && p.connected);
    if (!gp) { this.pad.connected = false; this.pad.buttons = []; return; }
    this.pad.connected = true;
    this.pad.lx = gp.axes[0] ?? 0; this.pad.ly = gp.axes[1] ?? 0; this.pad.rx = gp.axes[2] ?? 0; this.pad.ry = gp.axes[3] ?? 0;
    this.pad.buttons = gp.buttons.map(b => b.pressed);
    this.pad.lt = gp.buttons[6]?.value ?? 0; this.pad.rt = gp.buttons[7]?.value ?? 0;
    if (this.pad.buttons.some(Boolean) || Math.abs(this.pad.lx) + Math.abs(this.pad.ly) > 0.3) this.lastSource = 'pad';
  }
  /** Call at the end of every frame. */
  endFrame() { this.pressed.clear(); this.released.clear(); this.mouseDX = 0; this.mouseDY = 0; this.wheel = 0; }
  /** Scripted input helpers (used by automated playtests). */
  press(code: string) { this.pressed.add(code); this.scripted.add(code); }
  release(code: string) { this.scripted.delete(code); this.released.add(code); }
  tap(code: string) { this.pressed.add(code); }
  clearAll() { this.down.clear(); this.scripted.clear(); }
}
