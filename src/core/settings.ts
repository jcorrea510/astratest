/** Player settings with presets and persistence. */
import { defaultQualityFor } from '../render/perfPolicy';
import { sanitizePadBindings, type PadOverrides } from './padBindings';
export type QualityName = 'low' | 'medium' | 'high';
export interface QualityPreset {
  pixelRatio: number; /** Round 14: max render pixels per frame (the ratio is lowered on big screens to fit) */ pixelBudget: number; /** Round 11: re-render the sun's shadow map every Nth frame */ shadowEvery: number; shadowMap: number; shadowRange: number; bloom: boolean; msaa: number;
  drawDistance: number; pedestrians: number; traffic: number; pointLights: number; /** Round 11: real point lights shared by all local lights (src/render/lightPool.ts) */ lightPool: number; /** real headlight spots (Round 7) */ headlights: number; particles: number;
  /** cheap instanced far crowds (src/game/crowd.ts): distant cars, pedestrians, curbside parked cars */
  farCars: number; farPeds: number; parked: number;
  /** Round 12: screen-space ambient occlusion samples (0 = off) */ ao: number;
}
export const QUALITY: Record<QualityName, QualityPreset> = {
  low: { pixelRatio: 1, pixelBudget: 1.1e6, shadowEvery: 1, shadowMap: 0, shadowRange: 0, bloom: false, msaa: 0, drawDistance: 260, pedestrians: 40, traffic: 18, pointLights: 0, lightPool: 2, headlights: 1, particles: 300, farCars: 220, farPeds: 140, parked: 110, ao: 0 },
  medium: { pixelRatio: 1.5, pixelBudget: 2.4e6, shadowEvery: 2, shadowMap: 2048, shadowRange: 34, bloom: true, msaa: 0, drawDistance: 340, pedestrians: 64, traffic: 32, pointLights: 4, lightPool: 4, headlights: 2, particles: 700, farCars: 420, farPeds: 340, parked: 250, ao: 8 },
  high: { pixelRatio: 2, pixelBudget: 4.2e6, shadowEvery: 1, shadowMap: 3072, shadowRange: 52, bloom: true, msaa: 2, drawDistance: 420, pedestrians: 120, traffic: 44, pointLights: 8, lightPool: 8, headlights: 4, particles: 1200, farCars: 560, farPeds: 520, parked: 380, ao: 12 },
};

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'crouch' | 'enter' | 'fire' | 'aim' | 'reload'
  | 'wheel' | 'handbrake' | 'horn' | 'lookBehind' | 'map' | 'pause' | 'interact' | 'nextWeapon' | 'prevWeapon' | 'headlights' | 'radio' | 'camera'
  | 'sirenWail' | 'sirenYelp' | 'sirenPhaser' | 'lightBar' | 'orders';
export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward / Accelerate', back: 'Move back / Brake', left: 'Move left / Steer left', right: 'Move right / Steer right',
  sprint: 'Sprint', jump: 'Jump / Handbrake', crouch: 'Dodge roll', enter: 'Enter / exit vehicle', fire: 'Fire / Punch', aim: 'Aim',
  reload: 'Reload', wheel: 'Inventory wheel (hold)', handbrake: 'Handbrake', horn: 'Horn', lookBehind: 'Look behind', map: 'City map',
  pause: 'Pause', interact: 'Interact / Shop', nextWeapon: 'Next weapon', prevWeapon: 'Previous weapon', headlights: 'Headlights', radio: 'Radio station', camera: 'Camera distance',
  orders: 'Give orders (hold)', sirenWail: 'Siren: wail', sirenYelp: 'Siren: yelp', sirenPhaser: 'Siren: phaser', lightBar: 'Emergency light bar',
};
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft'], jump: ['Space'], crouch: ['KeyC'], enter: ['KeyF'], fire: ['Mouse0'], aim: ['Mouse2'],
  reload: ['KeyR'], wheel: ['Tab', 'KeyZ'], handbrake: ['Space'], horn: ['KeyH'], lookBehind: ['KeyV'], map: ['KeyM'],
  pause: ['KeyP', 'Escape'], interact: ['KeyE'], nextWeapon: ['WheelDown'], prevWeapon: ['WheelUp'], headlights: ['KeyN'], radio: ['Period'], camera: ['KeyB'],
  orders: ['KeyG'], sirenWail: ['KeyJ'], sirenYelp: ['KeyK'], sirenPhaser: ['KeyL'], lightBar: ['KeyU'],
};
export interface Settings {
  quality: QualityName; sensitivity: number; invertY: boolean; fov: number;
  /** Round 7: aim with a click (toggle) instead of holding the button: on by default on Macs (a held trackpad click turns finger movement into scrolling) */
  aimToggle: boolean;
  master: number; music: number; sfx: number; bindings: Record<Action, string[]>; showFps: boolean; cameraShake: number;
  /** 'natural' = neutral filmic grade (default), 'stylised' = teal/apricot split-tone. */
  look: 'natural' | 'stylised';
  /** 'arcade' = forgiving grip (default); 'realistic' = ~0.9 g sedans, more weight transfer. */
  driving: 'arcade' | 'realistic';
  /** blood spatter, pools and wound marks (Teen: moderate); off = clean hits */
  blood: boolean;
  /** Round 12 (all optional for readers: use `s.x ?? default`). Ranges are enforced by loadSettings. */
  /** gamepad stick look speed multiplier 0.3-3 */ padSensitivity: number;
  /** gamepad stick deadzone 0-0.3 */ padDeadzone: number;
  padInvertY: boolean;
  /** player's controller button rebinds per context (see core/padBindings.ts); {} = defaults */ padBindings: PadOverrides;
  /** controller rumble on/off */ vibration: boolean;
  /** look-speed multiplier while aiming down sights 0.3-1.5 */ adsSensitivity: number;
  /** radial speed blur when driving fast */ speedBlur: boolean;
  /** fewer camera effects (shake, FOV kick, bob, speed blur); defaults from prefers-reduced-motion */ reduceMotion: boolean;
  colorblind: ColorblindMode;
  /** UI scale 0.8-1.4, applied as --ma-ui-scale on :root */ uiScale: number;
  /** render-resolution multiplier on top of the preset pixel ratio, 0.5-1 */ resolutionScale: number;
  /** frame-rate cap: 0 = off */ fpsCap: 0 | 30 | 60;
  /** extra audio buses 0-1 */ ambienceVolume: number; voiceVolume: number; uiVolume: number;
  /** on-screen touch controls: auto = any touchscreen, on = always, off = never */ touchControls: TouchControlsMode;
}
export type TouchControlsMode = 'auto' | 'on' | 'off';
export type ColorblindMode = 'off' | 'deuteranopia' | 'protanopia' | 'tritanopia';
export const COLORBLIND_MODES: ColorblindMode[] = ['off', 'deuteranopia', 'protanopia', 'tritanopia'];
/** A Mac with a trackpad (not an iPad, which reports as Mac but has touch). */
export function isMacLike(): boolean { try { return typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent) && !(navigator.maxTouchPoints > 1); } catch { return false; } }
export function prefersReducedMotion(): boolean { try { return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } }
export const DEFAULT_SETTINGS: Settings = { quality: 'medium', sensitivity: 1, invertY: false, fov: 62, master: 0.8, music: 0.55, sfx: 0.9, bindings: structuredClone(DEFAULT_BINDINGS), showFps: false, cameraShake: 1, look: 'natural', driving: 'arcade', blood: true, aimToggle: isMacLike(),
  padSensitivity: 1, padDeadzone: 0.12, padInvertY: false, padBindings: {}, vibration: true, adsSensitivity: 0.8, speedBlur: true, reduceMotion: prefersReducedMotion(), colorblind: 'off',
  uiScale: 1, resolutionScale: 1, fpsCap: 0, ambienceVolume: 0.8, voiceVolume: 0.9, uiVolume: 0.8, touchControls: 'auto' };
export const SETTINGS_KEY = 'meridian-afterglow.settings.v1';

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Settings {
  const base = structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = storage?.getItem(SETTINGS_KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...base, ...parsed, bindings: { ...base.bindings, ...(parsed.bindings ?? {}) } };
    if (!(merged.quality in QUALITY)) merged.quality = 'medium';
    merged.sensitivity = clampNum(merged.sensitivity, 0.2, 3, 1);
    merged.master = clampNum(merged.master, 0, 1, 0.8); merged.music = clampNum(merged.music, 0, 1, 0.55); merged.sfx = clampNum(merged.sfx, 0, 1, 0.9);
    merged.fov = clampNum(merged.fov, 50, 80, 62); merged.cameraShake = clampNum(merged.cameraShake, 0, 1, 1);
    if (merged.look !== 'natural' && merged.look !== 'stylised') merged.look = 'natural';
    if (typeof merged.blood !== 'boolean') merged.blood = true;
    if (typeof merged.aimToggle !== 'boolean') merged.aimToggle = isMacLike();
    merged.padSensitivity = clampNum(merged.padSensitivity, 0.3, 3, 1); merged.padDeadzone = clampNum(merged.padDeadzone, 0, 0.3, 0.12);
    merged.adsSensitivity = clampNum(merged.adsSensitivity, 0.3, 1.5, 0.8); merged.uiScale = clampNum(merged.uiScale, 0.8, 1.4, 1); merged.resolutionScale = clampNum(merged.resolutionScale, 0.5, 1, 1);
    merged.ambienceVolume = clampNum(merged.ambienceVolume, 0, 1, 0.8); merged.voiceVolume = clampNum(merged.voiceVolume, 0, 1, 0.9); merged.uiVolume = clampNum(merged.uiVolume, 0, 1, 0.8);
    if (typeof merged.padInvertY !== 'boolean') merged.padInvertY = false;
    merged.padBindings = sanitizePadBindings(merged.padBindings);
    if (typeof merged.vibration !== 'boolean') merged.vibration = true;
    if (typeof merged.speedBlur !== 'boolean') merged.speedBlur = true;
    if (typeof merged.reduceMotion !== 'boolean') merged.reduceMotion = prefersReducedMotion();
    if (!COLORBLIND_MODES.includes(merged.colorblind)) merged.colorblind = 'off';
    if (merged.touchControls !== 'on' && merged.touchControls !== 'off') merged.touchControls = 'auto';
    if (merged.fpsCap !== 0 && merged.fpsCap !== 30 && merged.fpsCap !== 60) merged.fpsCap = 0;
    if (merged.driving !== 'arcade' && merged.driving !== 'realistic') merged.driving = 'arcade';
    delete (merged as unknown as Record<string, unknown>).pedDensity; delete (merged as unknown as Record<string, unknown>).trafficDensity; delete (merged as unknown as Record<string, unknown>).pedestrians; delete (merged as unknown as Record<string, unknown>).traffic;
    // density now follows the graphics preset only (old saves may carry per-slider values; they are simply ignored)
    if (!merged.bindings.pause.includes('KeyP') && !Object.entries(merged.bindings).some(([k, v]) => k !== 'pause' && v.includes('KeyP'))) merged.bindings.pause = [...merged.bindings.pause, 'KeyP']; // Esc also leaves fullscreen: P is always a way in
    for (const k of Object.keys(DEFAULT_BINDINGS) as Action[]) if (!Array.isArray(merged.bindings[k])) merged.bindings[k] = [...DEFAULT_BINDINGS[k]];
    migrateBindings(merged.bindings, parsed.bindings);
    return merged;
  } catch { return base; }
}
/** Round 12: the old defaults clashed (Alt opens the browser menu; Q was the wheel and the pause-tab key). Bindings still equal to those defaults move to the new ones; custom choices are kept. */
export function migrateBindings(b: Record<Action, string[]>, saved?: Partial<Record<Action, string[]>>) {
  const same = (a: string[] | undefined, c: string[]) => !!a && a.length === c.length && c.every((k, i) => a[i] === k);
  if (same(saved?.crouch, ['KeyC', 'AltLeft'])) b.crouch = [...DEFAULT_BINDINGS.crouch];
  if (same(saved?.wheel, ['Tab', 'KeyQ'])) b.wheel = [...DEFAULT_BINDINGS.wheel];
}
export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage may be unavailable (private mode); settings stay in memory */ }
}
export function detectDefaultQuality(): QualityName {
  try {
    return defaultQualityFor({ ua: navigator.userAgent, platform: navigator.platform, maxTouchPoints: navigator.maxTouchPoints || 0, cores: navigator.hardwareConcurrency ?? 8, memory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory, dpr: window.devicePixelRatio || 1 });
  } catch { return 'medium'; }
}
function clampNum(v: unknown, a: number, b: number, d: number) { return typeof v === 'number' && Number.isFinite(v) ? Math.min(b, Math.max(a, v)) : d; }
export function safeStorage(): Storage | null { try { return typeof localStorage === 'undefined' ? null : localStorage; } catch { return null; } }
export function keyLabel(code: string): string {
  if (code === 'Mouse0') return 'LMB'; if (code === 'Mouse2') return 'RMB'; if (code === 'Mouse1') return 'MMB';
  if (code === 'WheelUp') return 'Wheel ↑'; if (code === 'WheelDown') return 'Wheel ↓';
  if (code.startsWith('Key')) return code.slice(3); if (code.startsWith('Digit')) return code.slice(5);
  const map: Record<string, string> = { ShiftLeft: 'L-Shift', ShiftRight: 'R-Shift', ControlLeft: 'L-Ctrl', ControlRight: 'R-Ctrl', Space: 'Space', Escape: 'Esc', ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Period: '.', Comma: ',', Tab: 'Tab', AltLeft: 'L-Alt', Enter: 'Enter', Backspace: 'Bksp' };
  return map[code] ?? code;
}
