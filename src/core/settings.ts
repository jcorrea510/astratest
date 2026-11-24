/** Player settings with presets and persistence. */
export type QualityName = 'low' | 'medium' | 'high';
export interface QualityPreset {
  pixelRatio: number; shadowMap: number; shadowRange: number; bloom: boolean; msaa: number;
  drawDistance: number; pedestrians: number; traffic: number; pointLights: number; /** Round 11: real point lights shared by all local lights (src/render/lightPool.ts) */ lightPool: number; /** real headlight spots (Round 7) */ headlights: number; particles: number;
  /** cheap instanced far crowds (src/game/crowd.ts): distant cars, pedestrians, curbside parked cars */
  farCars: number; farPeds: number; parked: number;
}
export const QUALITY: Record<QualityName, QualityPreset> = {
  low: { pixelRatio: 0.75, shadowMap: 0, shadowRange: 0, bloom: false, msaa: 0, drawDistance: 260, pedestrians: 40, traffic: 18, pointLights: 0, lightPool: 2, headlights: 1, particles: 300, farCars: 220, farPeds: 140, parked: 110 },
  medium: { pixelRatio: 1, shadowMap: 2048, shadowRange: 34, bloom: true, msaa: 0, drawDistance: 340, pedestrians: 64, traffic: 32, pointLights: 4, lightPool: 4, headlights: 2, particles: 700, farCars: 420, farPeds: 340, parked: 250 },
  high: { pixelRatio: 1.25, shadowMap: 3072, shadowRange: 52, bloom: true, msaa: 2, drawDistance: 420, pedestrians: 120, traffic: 44, pointLights: 8, lightPool: 8, headlights: 4, particles: 1200, farCars: 560, farPeds: 520, parked: 380 },
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
  sprint: ['ShiftLeft'], jump: ['Space'], crouch: ['KeyC', 'AltLeft'], enter: ['KeyF'], fire: ['Mouse0'], aim: ['Mouse2'],
  reload: ['KeyR'], wheel: ['Tab', 'KeyQ'], handbrake: ['Space'], horn: ['KeyH'], lookBehind: ['KeyV'], map: ['KeyM'],
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
}
/** A Mac with a trackpad (not an iPad, which reports as Mac but has touch). */
export function isMacLike(): boolean { try { return typeof navigator !== 'undefined' && /Mac/.test(navigator.platform || navigator.userAgent) && !(navigator.maxTouchPoints > 1); } catch { return false; } }
export const DEFAULT_SETTINGS: Settings = { quality: 'medium', sensitivity: 1, invertY: false, fov: 62, master: 0.8, music: 0.55, sfx: 0.9, bindings: structuredClone(DEFAULT_BINDINGS), showFps: false, cameraShake: 1, look: 'natural', driving: 'arcade', blood: true, aimToggle: isMacLike() };
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
    if (merged.driving !== 'arcade' && merged.driving !== 'realistic') merged.driving = 'arcade';
    delete (merged as unknown as Record<string, unknown>).pedDensity; delete (merged as unknown as Record<string, unknown>).trafficDensity; delete (merged as unknown as Record<string, unknown>).pedestrians; delete (merged as unknown as Record<string, unknown>).traffic;
    // density now follows the graphics preset only (old saves may carry per-slider values; they are simply ignored)
    if (!merged.bindings.pause.includes('KeyP') && !Object.entries(merged.bindings).some(([k, v]) => k !== 'pause' && v.includes('KeyP'))) merged.bindings.pause = [...merged.bindings.pause, 'KeyP']; // Esc also leaves fullscreen: P is always a way in
    for (const k of Object.keys(DEFAULT_BINDINGS) as Action[]) if (!Array.isArray(merged.bindings[k])) merged.bindings[k] = [...DEFAULT_BINDINGS[k]];
    return merged;
  } catch { return base; }
}
export function saveSettings(s: Settings, storage: Pick<Storage, 'setItem'> | null = safeStorage()) {
  try { storage?.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch { /* storage may be unavailable (private mode); settings stay in memory */ }
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
