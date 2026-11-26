import { describe, it, expect, afterEach } from 'vitest';
import { padFamily, localizeGlyph, buttonLabel, PadWatcher } from './padGlyphs';
import { sanitizePadBindings, withPadBinding, resetPadContext, mergedButtons, hasPadOverrides } from './padBindings';
import { PAD_LAYOUTS, padGlyph, padHeld, setPadOverrides, setPadFamilyFromId, promptFor, setPromptSource, EMPTY_PAD, type PadState } from './gamepad';
import { loadSettings, SETTINGS_KEY } from './settings';

const pad = (down: number[]): PadState => ({ ...EMPTY_PAD, connected: true, buttons: Array.from({ length: 16 }, (_, i) => down.includes(i)) });
afterEach(() => { setPadOverrides({}); setPadFamilyFromId(undefined); setPromptSource('kbm'); });

describe('pad families and labels', () => {
  it('recognises families from Gamepad ids, generic otherwise', () => {
    expect(padFamily('Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)')).toBe('xbox');
    expect(padFamily('Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)')).toBe('playstation');
    expect(padFamily('054c-0ce6-DualSense Wireless Controller')).toBe('playstation');
    expect(padFamily('Pro Controller (STANDARD GAMEPAD Vendor: 057e Product: 2009)')).toBe('switch');
    expect(padFamily('USB Gamepad (Vendor: 0079 Product: 0011)')).toBe('generic');
    expect(padFamily(undefined)).toBe('generic');
  });
  it('labels buttons in the family words', () => {
    expect(buttonLabel(0, 'playstation')).toBe('Cross'); expect(buttonLabel(3, 'playstation')).toBe('Triangle'); expect(buttonLabel(9, 'playstation')).toBe('Options');
    expect(buttonLabel(0, 'xbox')).toBe('A'); expect(buttonLabel(0, 'switch')).toBe('B'); expect(buttonLabel(7, 'switch')).toBe('ZR');
    expect(localizeGlyph('LB + RT', 'playstation')).toBe('L1 + R2');
    expect(localizeGlyph('L-Stick', 'playstation')).toBe('L-Stick');
  });
  it('padGlyph and prompts follow the connected pad', () => {
    expect(padGlyph('enter', 'foot')).toBe('Y');
    setPadFamilyFromId('DualSense Wireless Controller');
    expect(padGlyph('enter', 'foot')).toBe('Triangle');
    expect(padGlyph('fire', 'foot')).toBe('R2');
    setPromptSource('pad');
    expect(promptFor('E  Enter the car', { enter: ['KeyE'] })).toBe('Triangle  Enter the car');
    setPromptSource('kbm');
    expect(promptFor('E  Enter the car', { enter: ['KeyE'] })).toBe('E  Enter the car');
  });
  it('watcher reports connect and disconnect once each', () => {
    const w = new PadWatcher();
    expect(w.update(false, undefined)).toBeNull();
    expect(w.update(true, 'Xbox Wireless Controller')).toEqual({ kind: 'connected', name: 'Xbox controller' });
    expect(w.update(true, 'Xbox Wireless Controller')).toBeNull();
    expect(w.update(false, undefined)).toEqual({ kind: 'disconnected', name: 'Xbox controller' });
    expect(w.update(false, undefined)).toBeNull();
  });
});

describe('pad rebinding', () => {
  const base = PAD_LAYOUTS.foot.buttons;
  it('moves a button, steals it from the old owner and reports who lost it', () => {
    const r = withPadBinding(base, {}, 'foot', 'jump', 0)!; // A was sprint
    expect(r.displaced).toEqual(['sprint']);
    expect(r.overrides.foot).toEqual({ sprint: [], jump: [0] });
    setPadOverrides(r.overrides);
    expect(padHeld('jump', pad([0]), 'foot')).toBe(true);
    expect(padHeld('jump', pad([2]), 'foot')).toBe(false);
    expect(padHeld('sprint', pad([0]), 'foot')).toBe(false);
    expect(padGlyph('jump', 'foot')).toBe('A');
    expect(padGlyph('sprint', 'foot')).toBeNull();
  });
  it('contexts are independent and reset restores the defaults', () => {
    const r = withPadBinding(base, {}, 'foot', 'reload', 13)!;
    expect(r.overrides.car).toBeUndefined();
    setPadOverrides(r.overrides);
    expect(padHeld('headlights', pad([14]), 'car')).toBe(true);
    const back = resetPadContext(r.overrides, 'foot');
    expect(hasPadOverrides(back)).toBe(false);
    setPadOverrides(back);
    expect(padHeld('reload', pad([1]), 'foot')).toBe(true);
  });
  it('a rebound aim button drives the car drive-by fire and the glyphs', () => {
    const r = withPadBinding(PAD_LAYOUTS.car.buttons, {}, 'car', 'aim', 10)!;
    setPadOverrides(r.overrides);
    expect(padHeld('aim', pad([10]), 'car')).toBe(true);
    expect(padHeld('fire', { ...pad([10]), rt: 1 }, 'car')).toBe(true);
    expect(padHeld('fire', { ...pad([4]), rt: 1 }, 'car')).toBe(false);
    expect(padGlyph('aim', 'car')).toBe('L3');
  });
  it('never leaves Pause without a button', () => {
    expect(withPadBinding(base, {}, 'foot', 'jump', 9)).toBeNull(); // Menu is the only pause button
    expect(mergedButtons(base, {}).pause).toEqual([9]);
  });
  it('sanitizes saved data and survives a settings round trip', () => {
    const dirty = { foot: { jump: [0, 0, 99, 'x', 1.5], pause: [], nope: [1] }, bogus: {}, car: 5 };
    expect(sanitizePadBindings(dirty)).toEqual({ foot: { jump: [0] } });
    expect(sanitizePadBindings('x')).toEqual({});
    const store = { getItem: (k: string) => k === SETTINGS_KEY ? JSON.stringify({ padBindings: { heli: { fire: [3] } } }) : null };
    expect(loadSettings(store).padBindings).toEqual({ heli: { fire: [3] } });
    expect(loadSettings({ getItem: () => JSON.stringify({ padBindings: 7 }) }).padBindings).toEqual({});
  });
});
