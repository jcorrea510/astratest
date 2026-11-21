/** Device detection and per-device defaults (iPad Safari needs a lighter preset and must not be gated as a phone). */
export interface NavLike { userAgent: string; platform?: string; maxTouchPoints?: number }

/** iPadOS 13+ Safari reports itself as a Mac, so look for a touch screen on a "Macintosh". */
export function isIPad(nav: NavLike = navigator): boolean {
  if (/iPad/.test(nav.userAgent)) return true;
  return (nav.platform === 'MacIntel' || /Macintosh/.test(nav.userAgent)) && (nav.maxTouchPoints ?? 0) > 1;
}
export function isIPhone(nav: NavLike = navigator): boolean { return /iPhone|iPod/.test(nav.userAgent); }
/** Phones (and small touch-only screens) get the "use a bigger screen" page; tablets, including iPad, get the game. */
export function isPhoneLike(nav: NavLike, minScreenSide: number): boolean {
  if (isIPad(nav)) return false;
  if (isIPhone(nav)) return true;
  return /Android.*Mobile|Mobile.*Android/.test(nav.userAgent) || minScreenSide < 600;
}
/** Pointer Lock may be missing (older iPad Safari) or rejected: the input layer then falls back to cursor / drag look. */
export function pointerLockSupported(el: { requestPointerLock?: unknown }): boolean {
  return typeof el.requestPointerLock === 'function';
}
export type QualityName = 'low' | 'medium' | 'high';
/** iPad tabs are killed at roughly 1.4 GB: start on the lightest preset unless the player chose one. */
/** No forced preset on iPad: M-series iPads run the normal default (the player can still pick Low). */
export function defaultQualityFor(nav: NavLike = navigator): QualityName | null { void nav; return null; }
/** Launched from the iOS home screen / an installed PWA: there is no browser chrome, so the app is already "fullscreen". */
export function isStandalone(): boolean {
  try {
    const n = navigator as Navigator & { standalone?: boolean };
    return n.standalone === true || ['standalone', 'fullscreen'].some(m => window.matchMedia(`(display-mode: ${m})`).matches);
  } catch { return false; }
}
