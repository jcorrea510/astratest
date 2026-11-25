/**
 * Boot / crash screens that do not depend on the game UI (they must work when the UI, WebGL or the world failed to build).
 * Plain DOM + boot.css. Kinds: no-webgl, load-failed, crashed (Retry reloads), context-lost (recovering overlay, Reload after a wait).
 */
import './boot.css';
import { VERSION_LABEL, BUILD } from '../build';

export type BootErrorKind = 'no-webgl' | 'context-lost' | 'load-failed' | 'crashed';
export interface ErrorCopy { title: string; message: string; hint: string }

export function errorCopy(kind: BootErrorKind): ErrorCopy {
  switch (kind) {
    case 'no-webgl': return {
      title: 'Graphics are not available',
      message: 'Meridian Afterglow needs WebGL 2 to draw the city, and this browser could not start it.',
      hint: 'Turn on hardware acceleration in your browser settings (Chrome and Edge: Settings, System, Use graphics acceleration when available), update your graphics driver or browser, then press Retry.',
    };
    case 'context-lost': return {
      title: 'Graphics reset, recovering…',
      message: 'The graphics card reset itself. The game is paused and will pick up where it left off in a moment.',
      hint: 'If this stays on screen, reload the page. Your last save is safe.',
    };
    case 'crashed': return {
      title: 'The game stopped unexpectedly',
      message: 'Something went wrong and the game could not carry on. Your last save is safe.',
      hint: 'Press Retry to reload. If it keeps happening, copy the details and send them along.',
    };
    default: return {
      title: 'Port Meridian did not load',
      message: 'Something went wrong while loading the game.',
      hint: 'Check your connection and press Retry. If it keeps happening, copy the details and send them along.',
    };
  }
}

/** Plain-text report for the Copy details button. */
export function formatDetails(kind: BootErrorKind, err?: unknown, extra: { ua?: string; url?: string; when?: Date } = {}): string {
  const e = err instanceof Error ? `${err.name}: ${err.message}${err.stack ? `\n${err.stack.split('\n').slice(1, 6).join('\n')}` : ''}` : err !== undefined ? String(err) : 'none';
  return [
    `Meridian Afterglow ${BUILD}`,
    `Problem: ${kind}`,
    `Time: ${(extra.when ?? new Date()).toISOString()}`,
    `Page: ${extra.url ?? (typeof location !== 'undefined' ? location.origin + location.pathname : '')}`,
    `Browser: ${extra.ua ?? (typeof navigator !== 'undefined' ? navigator.userAgent : '')}`,
    `Error: ${e}`,
  ].join('\n');
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls: string, text?: string): HTMLElementTagNameMap[K] => {
  const n = document.createElement(tag); n.className = cls; if (text !== undefined) n.textContent = text; return n;
};

let current: HTMLElement | null = null;
let recoverTimer = 0;

export function hideBootError(): void {
  window.clearTimeout(recoverTimer);
  current?.remove(); current = null;
}

export interface ShowOptions { error?: unknown; onRetry?: () => void; retryLabel?: string }

/** Shows (or replaces) the full-window error panel. Returns its element. */
export function showBootError(kind: BootErrorKind, opts: ShowOptions = {}): HTMLElement {
  hideBootError();
  const copy = errorCopy(kind);
  const retry = opts.onRetry ?? (() => location.reload());
  const root = el('div', 'ma-boot-error');
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-labelledby', 'ma-boot-title');
  root.dataset.kind = kind;
  const box = el('div', 'ma-boot-box');
  box.appendChild(el('div', 'ma-boot-mark', 'MERIDIAN AFTERGLOW'));
  const title = el('h1', 'ma-boot-title', copy.title); title.id = 'ma-boot-title';
  box.appendChild(title);
  box.appendChild(el('p', 'ma-boot-msg', copy.message));
  box.appendChild(el('p', 'ma-boot-hint', copy.hint));
  const row = el('div', 'ma-boot-actions');
  const mkBtn = (label: string, primary: boolean, fn: () => void, cls = '') => {
    const b = el('button', `ma-boot-btn${primary ? ' is-primary' : ''} ${cls}`.trim(), label); b.type = 'button'; b.addEventListener('click', fn); row.appendChild(b); return b;
  };
  if (kind === 'context-lost') {
    root.classList.add('is-recovering');
    box.appendChild(el('div', 'ma-boot-spinner'));
    recoverTimer = window.setTimeout(() => { // no restore after a while: offer the reload
      if (current !== root) return;
      mkBtn('Reload', true, () => location.reload(), 'ma-boot-reload');
      box.appendChild(row);
    }, 8000);
  } else {
    mkBtn(opts.retryLabel ?? 'Retry', true, retry, 'ma-boot-retry');
    const copyBtn = mkBtn('Copy details', false, () => {
      const text = formatDetails(kind, opts.error);
      const done = (ok: boolean) => { copyBtn.textContent = ok ? 'Copied' : 'Copy unavailable'; };
      try { const p = navigator.clipboard?.writeText(text); if (p) p.then(() => done(true), () => done(false)); else done(false); } catch { done(false); }
    }, 'ma-boot-copy');
    box.appendChild(row);
  }
  box.appendChild(el('div', 'ma-boot-ver', VERSION_LABEL));
  root.appendChild(box);
  document.body.appendChild(root);
  current = root;
  (root.querySelector('.ma-boot-retry') as HTMLElement | null)?.focus();
  return root;
}
