/** Fullscreen helpers. Alt+Enter toggles it everywhere (F11 is left to the browser); a small icon button does the same. */
type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => Promise<void> | void };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };
const KEY = 'ma.wantFullscreen';
/** The game runs inside a same-origin shell iframe (src/shell.ts); fullscreen lives on the top document so reloads of the game keep it. */
function fsDoc(): Document { try { if (window.top && window.top !== window) return window.top.document; } catch { /* cross-origin */ } return document; }
function fsNav(): Navigator { try { if (window.top && window.top !== window) return window.top.navigator; } catch { /* cross-origin */ } return navigator; }

export function fullscreenSupported(): boolean {
  const d = fsDoc() as FsDoc & { webkitFullscreenEnabled?: boolean };
  return !!(d.fullscreenEnabled || d.webkitFullscreenEnabled);
}
export function isFullscreen(): boolean { const d = fsDoc() as FsDoc; return !!(d.fullscreenElement || d.webkitFullscreenElement); }
export function enterFullscreen(): void {
  try {
    const el = fsDoc().documentElement as FsEl;
    const r = el.requestFullscreen ? el.requestFullscreen() : el.webkitRequestFullscreen?.();
    (r as Promise<void> | undefined)?.catch?.(() => {});
  } catch { /* fullscreen can be blocked by the browser or an iframe */ }
}
export function exitFullscreen(): void {
  try { const d = fsDoc() as FsDoc; const r = d.exitFullscreen ? d.exitFullscreen() : d.webkitExitFullscreen?.(); (r as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* ignore */ }
}
export function toggleFullscreen(): void { if (isFullscreen()) exitFullscreen(); else enterFullscreen(); }

/** A page reload (save and quit) drops fullscreen; remember it so the next key press or click puts it back. */
export function rememberFullscreen(): void { try { if (isFullscreen()) sessionStorage.setItem(KEY, '1'); } catch { /* storage blocked */ } }
function wantsRestore(): boolean { try { return sessionStorage.getItem(KEY) === '1'; } catch { return false; } }
function clearRestore(): void { try { sessionStorage.removeItem(KEY); } catch { /* ignore */ } }

let installed = false;
export function installFullscreenShortcut(): void {
  if (installed) return; installed = true;
  window.addEventListener('keydown', e => {
    if (e.altKey && (e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); toggleFullscreen(); }
  }, true);
  // While fullscreen, ask the browser to let the page have Esc (the pause key) so pausing never drops fullscreen; hold Esc to leave.
  fsDoc().addEventListener('fullscreenchange', () => {
    try {
      const kb = (fsNav() as Navigator & { keyboard?: { lock?: (k: string[]) => Promise<void>; unlock?: () => void } }).keyboard;
      if (isFullscreen()) void kb?.lock?.(['Escape'])?.catch?.(() => {}); else kb?.unlock?.();
    } catch { /* Keyboard Lock is Chromium-only */ }
  });
  if (wantsRestore()) {
    const again = (e: Event) => {
      if (e instanceof KeyboardEvent && e.code === 'Escape') return;
      window.removeEventListener('keydown', again, true); window.removeEventListener('pointerdown', again, true);
      clearRestore(); if (!isFullscreen()) enterFullscreen();
    };
    window.addEventListener('keydown', again, true); window.addEventListener('pointerdown', again, true);
  }
}

const FS_ICON_ENTER = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>';
const FS_ICON_EXIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="square"/></svg>';
/** A small icon-only fullscreen toggle (top-right corner). Style it with `.ma-fs-btn` / `.hw-fs-btn`. */
export function createFullscreenButton(cls: string, id = 'fs-toggle'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button'; b.className = cls; b.id = id;
  const sync = () => { const on = isFullscreen(); b.innerHTML = on ? FS_ICON_EXIT : FS_ICON_ENTER; b.title = on ? 'Exit fullscreen (Alt+Enter)' : 'Fullscreen (Alt+Enter)'; b.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen'); b.setAttribute('aria-pressed', String(on)); };
  sync();
  fsDoc().addEventListener('fullscreenchange', sync); fsDoc().addEventListener('webkitfullscreenchange', sync);
  b.addEventListener('click', e => { e.stopPropagation(); toggleFullscreen(); b.blur(); });
  if (!fullscreenSupported()) b.hidden = true;
  return b;
}
