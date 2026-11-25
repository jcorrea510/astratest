/** Small corner "Saving..." then "Saved" pill, driven by save.ts onSaved. Shown ~1.5 s in total. */
import { onSaved } from '../game/save';
import { h } from './dom';

export const SAVE_SHOW_MS = 1500;
export const SAVING_MS = 450;
export type SavePhase = 'saving' | 'saved' | 'failed' | 'hidden';

/** Phase of the indicator `elapsed` ms after a save attempt. Under Reduce Motion the "Saving..." beat is skipped. */
export function savePhase(elapsed: number, ok: boolean, reduceMotion = false): SavePhase {
  if (elapsed < 0 || elapsed >= SAVE_SHOW_MS) return 'hidden';
  if (!ok) return 'failed';
  return !reduceMotion && elapsed < SAVING_MS ? 'saving' : 'saved';
}

const LABEL: Record<SavePhase, string> = { saving: 'Saving…', saved: 'Saved', failed: 'Save failed', hidden: '' };

export class SaveIndicator {
  readonly el: HTMLDivElement;
  private label: HTMLSpanElement;
  private timers: number[] = [];
  private unsub: () => void;
  constructor(private reduceMotion: () => boolean = () => false) {
    this.el = h('div', 'ma-save');
    this.el.setAttribute('role', 'status'); this.el.setAttribute('aria-live', 'polite');
    this.el.appendChild(h('span', 'ma-save-icon'));
    this.label = h('span', 'ma-save-text');
    this.el.appendChild(this.label);
    this.unsub = onSaved(e => this.flash(e.ok));
  }
  /** Runs the sequence for one save attempt (callable directly by tests). */
  flash(ok: boolean) {
    for (const t of this.timers) window.clearTimeout(t);
    this.timers = [];
    const rm = this.reduceMotion();
    const show = (p: SavePhase) => {
      this.el.dataset.phase = p;
      this.el.classList.toggle('is-visible', p !== 'hidden');
      if (p !== 'hidden') this.label.textContent = LABEL[p];
    };
    const first = savePhase(0, ok, rm);
    show(first);
    if (first === 'saving') this.timers.push(window.setTimeout(() => show(savePhase(SAVING_MS, ok, rm)), SAVING_MS));
    this.timers.push(window.setTimeout(() => show('hidden'), SAVE_SHOW_MS));
  }
  dispose() { this.unsub(); for (const t of this.timers) window.clearTimeout(t); this.el.remove(); }
}
