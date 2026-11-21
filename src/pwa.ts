/** Installable-app support: service worker registration with a guard so tests, dev servers and automation are untouched. */
export interface SwEnv { hasSW: boolean; webdriver: boolean; dev: boolean; secure: boolean; optOut: boolean }
export function shouldRegisterSW(e: SwEnv): boolean { return e.hasSW && !e.webdriver && !e.dev && e.secure && !e.optOut; }

export function registerServiceWorker(): void {
  try {
    const env: SwEnv = {
      hasSW: 'serviceWorker' in navigator,
      webdriver: !!navigator.webdriver,
      dev: import.meta.env.DEV,
      secure: window.isSecureContext,
      optOut: new URLSearchParams(location.search).has('nosw') || !/^https?:$/.test(location.protocol), // the desktop app (app://) serves files itself
    };
    if (!shouldRegisterSW(env)) return;
    const go = () => { navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch(() => undefined); };
    if (document.readyState === 'complete') go(); else window.addEventListener('load', go, { once: true });
  } catch { /* never block the game */ }
}
