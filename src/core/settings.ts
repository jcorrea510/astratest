/** Player settings with presets and persistence. */
export type QualityName = 'low' | 'medium' | 'high';
export interface QualityPreset {
  pixelRatio: number; shadowMap: number; shadowRange: number; bloom: boolean; msaa: number;
  drawDistance: number; pedestrians: number; traffic: number; pointLights: number; particles: number;
  /** cheap instanced far crowds (src/game/crowd.ts): distant cars, pedestrians, curbside parked cars */
  farCars: number; farPeds: number; parked: number;
}
export const QUALITY: Record<QualityName, QualityPreset> = {
  low: { pixelRatio: 0.75, shadowMap: 0, shadowRange: 0, bloom: false, msaa: 0, drawDistance: 260, pedestrians: 40, traffic: 16, pointLights: 0, particles: 300, farCars: 60, farPeds: 140, parked: 250 },
  medium: { pixelRatio: 1, shadowMap: 2048, shadowRange: 34, bloom: true, msaa: 0, drawDistance: 340, pedestrians: 64, traffic: 26, pointLights: 4, particles: 700, farCars: 130, farPeds: 340, parked: 600 },
  high: { pixelRatio: 1.5, shadowMap: 4096, shadowRange: 52, bloom: true, msaa: 4, drawDistance: 420, pedestrians: 120, traffic: 38, pointLights: 8, particles: 1200, farCars: 200, farPeds: 520, parked: 1000 },
};

export type Action =
  | 'forward' | 'back' | 'left' | 'right' | 'sprint' | 'jump' | 'crouch' | 'enter' | 'fire' | 'aim' | 'reload'
  | 'wheel' | 'handbrake' | 'horn' | 'lookBehind' | 'map' | 'pause' | 'interact' | 'nextWeapon' | 'prevWeapon' | 'headlights' | 'radio' | 'camera'
  | 'sirenWail' | 'sirenYelp' | 'sirenPhaser' | 'lightBar';
export const ACTION_LABELS: Record<Action, string> = {
  forward: 'Move forward / Accelerate', back: 'Move back / Brake', left: 'Move left / Steer left', right: 'Move right / Steer right',
  sprint: 'Sprint', jump: 'Jump / Handbrake', crouch: 'Dodge roll', enter: 'Enter / exit vehicle', fire: 'Fire / Punch', aim: 'Aim',
  reload: 'Reload', wheel: 'Inventory wheel (hold)', handbrake: 'Handbrake', horn: 'Horn', lookBehind: 'Look behind', map: 'City map',
  pause: 'Pause', interact: 'Interact / Shop', nextWeapon: 'Next weapon', prevWeapon: 'Previous weapon', headlights: 'Headlights', radio: 'Radio station', camera: 'Camera distance',
  sirenWail: 'Siren: wail', sirenYelp: 'Siren: yelp', sirenPhaser: 'Siren: phaser', lightBar: 'Emergency light bar',
};
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft'], jump: ['Space'], crouch: ['KeyC', 'AltLeft'], enter: ['KeyF'], fire: ['Mouse0'], aim: ['Mouse2'],
  reload: ['KeyR'], wheel: ['Tab', 'KeyQ'], handbrake: ['Space'], horn: ['KeyH'], lookBehind: ['KeyV'], map: ['KeyM'],
  pause: ['Escape', 'KeyP'], interact: ['KeyE'], nextWeapon: ['WheelDown'], prevWeapon: ['WheelUp'], headlights: ['KeyN'], radio: ['Period'], camera: ['KeyB'],
  sirenWail: ['KeyJ'], sirenYelp: ['KeyK'], sirenPhaser: ['KeyL'], lightBar: ['KeyU'],
};
export interface Settings {
  quality: QualityName; sensitivity: number; invertY: boolean; fov: number;
  master: number; music: number; sfx: number; bindings: Record<Action, string[]>; showFps: boolean; cameraShake: number;
}
export const DEFAULT_SETTINGS: Settings = { quality: 'medium', sensitivity: 1, invertY: false, fov: 62, master: 0.8, music: 0.55, sfx: 0.9, bindings: structuredClone(DEFAULT_BINDINGS), showFps: false, cameraShake: 1 };
const KEY = 'meridian-afterglow.settings.v1';

export function loadSettings(storage: Pick<Storage, 'getItem'> | null = safeStorage()): Settings {
  const base = structuredClone(DEFAULT_SETTINGS);
  try {
    const raw = storage?.getItem(KEY);
    if (!raw) return base;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    const merged: Settings = { ...base, ...parsed, bindings: { ...base.bindings, ...(parsed.bindings ?? {}) } };
    if (!(merged.quality in QUALITY)) merged.quality = 'medium';
    merged.sensitivity = clampNum(merged.sensitivity, 0.2, 3, 1);
    merged.master = clampNum(merged.master, 0, 1, 0.8); merged.music = clampNum(merged.music, 0, 1, 0.55); merged.sfx = clampNum(merged.sfx, 0, 1, 0.9);
    merged.fov = clampNum(merged.fov, 50, 80, 62); merged.cameraShake = clampNum(merged.cameraShake, 0, 1, 1);
    for (const k of Object.keys(DEFAULT_BINDINGS) as Action[]) if (!Array.isArray(merged.bindings[k])) merged.bindings[k] = [...DEFAULT_BINDINGS[k]];
    return merged;
  } catch { return base; }
}
export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { storage?.setItem(KEY, JSON.stringify(s)); } catch { /* storage may be unavailable (private mode); settings stay in memory */ }
}
export function detectDefaultQuality(): QualityName {
  try {
    const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
    const cores = navigator.hardwareConcurrency ?? 8;
    if (mem <= 4 || cores <= 4) return 'low';
    return 'medium';
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
