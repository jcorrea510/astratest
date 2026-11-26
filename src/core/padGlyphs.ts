/** Controller families and button labels: the Gamepad id tells Xbox / PlayStation / Switch pads apart; anything else gets the generic (standard-mapping) names. Pure. */
export type PadFamily = 'xbox' | 'playstation' | 'switch' | 'generic';

/** Family from a Gamepad id such as "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)" or "054c-09cc-Wireless Controller". */
export function padFamily(id: string | null | undefined): PadFamily {
  const s = (id ?? '').toLowerCase();
  if (!s) return 'generic';
  if (/xbox|xinput|x-box|vendor: 045e|^045e-/.test(s)) return 'xbox';
  if (/dualsense|dualshock|playstation|ps[345]\b|sony|vendor: 054c|^054c-/.test(s)) return 'playstation';
  if (/pro controller|joy-?con|nintendo|switch|vendor: 057e|^057e-/.test(s)) return 'switch';
  return 'generic';
}
export const FAMILY_NAME: Record<PadFamily, string> = { xbox: 'Xbox controller', playstation: 'PlayStation controller', switch: 'Switch controller', generic: 'Controller' };

/** Canonical (standard-mapping) names, indexed by button number. The generic family uses them as they are. */
export const CANON = ['A', 'B', 'X', 'Y', 'LB', 'RB', 'LT', 'RT', 'View', 'Menu', 'L3', 'R3', 'D↑', 'D↓', 'D←', 'D→'];
const PS: Record<string, string> = { A: 'Cross', B: 'Circle', X: 'Square', Y: 'Triangle', LB: 'L1', RB: 'R1', LT: 'L2', RT: 'R2', View: 'Create', Menu: 'Options' };
const NS: Record<string, string> = { A: 'B', B: 'A', X: 'Y', Y: 'X', LB: 'L', RB: 'R', LT: 'ZL', RT: 'ZR', View: 'Minus', Menu: 'Plus' };
const TABLE: Record<PadFamily, Record<string, string>> = { xbox: {}, generic: {}, playstation: PS, switch: NS };

/** One canonical token ("Y", "LB", "L-Stick", "D-Pad ←") in the family's own words. */
export function familyLabel(token: string, f: PadFamily): string { return TABLE[f][token] ?? token; }
/** A canonical glyph string, possibly several tokens ("LB + RT"), in the family's words. */
export function localizeGlyph(glyph: string, f: PadFamily): string { return glyph.split(' + ').map(t => familyLabel(t.trim(), f)).join(' + '); }
export function buttonLabel(index: number, f: PadFamily): string { return familyLabel(CANON[index] ?? `Button ${index}`, f); }

/** Tracks connect / disconnect from per-poll samples (works without the browser's gamepad events, which need a button press first). */
export class PadWatcher {
  private was = false;
  private name = '';
  /** Feed one sample; returns an event on a change. */
  update(connected: boolean, id: string | undefined): { kind: 'connected' | 'disconnected'; name: string } | null {
    if (connected === this.was) { if (connected && id) this.name = FAMILY_NAME[padFamily(id)]; return null; }
    this.was = connected;
    if (connected) { this.name = FAMILY_NAME[padFamily(id)]; return { kind: 'connected', name: this.name }; }
    return { kind: 'disconnected', name: this.name || FAMILY_NAME.generic };
  }
}
