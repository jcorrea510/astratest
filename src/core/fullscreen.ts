/** Fullscreen API helpers. Alt+Enter toggles it everywhere (F11 is left to the browser). */
export function isFullscreen(): boolean { return !!document.fullscreenElement; }
export function toggleFullscreen(): void {
  try {
    if (document.fullscreenElement) void document.exitFullscreen?.();
    else void document.documentElement.requestFullscreen?.()?.catch?.(() => {});
  } catch { /* fullscreen can be blocked by the browser or an iframe */ }
}
let installed = false;
export function installFullscreenShortcut(): void {
  if (installed) return; installed = true;
  window.addEventListener('keydown', e => {
    if (e.altKey && (e.code === 'Enter' || e.code === 'NumpadEnter') && !e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); toggleFullscreen(); }
  }, true);
}
