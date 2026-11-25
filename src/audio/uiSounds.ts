/**
 * Import-anywhere UI sound helper: `import { uiSound } from '../audio/uiSounds'; uiSound('select')`.
 * The game registers its Audio instance once (`registerUiAudio(audio)`); until then, calls are silently dropped.
 */
import type { UiSoundName } from './mixer';

export type { UiSoundName } from './mixer';
interface UiCapable { ui?: (name: UiSoundName) => void }
let target: UiCapable | null = null;
export function registerUiAudio(a: UiCapable | null): void { target = a; }
export function uiSound(name: UiSoundName): void { try { target?.ui?.(name); } catch { /* audio never breaks UI */ } }
