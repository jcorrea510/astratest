import { describe, it, expect, afterEach, vi } from 'vitest';
import { readPad, deadzone, padGlyph, padActive, PAD_MAP, padHeld } from './gamepad';
import { Input } from './input';
import { DEFAULT_SETTINGS } from './settings';
import { isIPad, isPhoneLike, defaultQualityFor } from './platform';

const btn = (pressed: boolean, value = pressed ? 1 : 0) => ({ pressed, touched: pressed, value });
function fakePad(over: { axes?: number[]; buttons?: Partial<Record<number, number>> } = {}): Gamepad {
  const buttons = Array.from({ length: 17 }, (_, i) => { const v = over.buttons?.[i] ?? 0; return btn(v > 0.5, v); });
  return { connected: true, axes: over.axes ?? [0, 0, 0, 0], buttons, id: 'Test Pad', index: 0, mapping: 'standard', timestamp: 0 } as unknown as Gamepad;
}
function mockPads(pad: Gamepad | null) { Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [pad, null, null, null] }); }

afterEach(() => { Reflect.deleteProperty(navigator, 'getGamepads'); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('gamepad', () => {
  it('reads sticks, triggers and buttons from a mocked navigator.getGamepads', () => {
    const p = readPad(() => [null, fakePad({ axes: [0.5, -1, 0.2, 0.9], buttons: { 0: 1, 7: 0.8, 6: 0.2 } })]);
    expect(p.connected).toBe(true);
    expect([p.lx, p.ly, p.rx, p.ry]).toEqual([0.5, -1, 0.2, 0.9]);
    expect(p.buttons[0]).toBe(true); expect(p.rt).toBeCloseTo(0.8); expect(p.lt).toBeCloseTo(0.2);
    expect(readPad(() => [null, null]).connected).toBe(false);
    expect(readPad(() => { throw new Error('blocked'); }).connected).toBe(false);
  });
  it('deadzone rescales and clips', () => {
    expect(deadzone(0.05)).toBe(0); expect(deadzone(-0.1)).toBe(0);
    expect(deadzone(1)).toBe(1); expect(deadzone(-1)).toBe(-1);
    expect(deadzone(0.56)).toBeCloseTo(0.5, 1);
  });
  it('drives the Input actions: sticks move and look, triggers fire / aim / throttle', () => {
    const noop = { addEventListener() {}, removeEventListener() {} };
    vi.stubGlobal('window', noop); vi.stubGlobal('document', { ...noop, pointerLockElement: null });
    const input = new Input(structuredClone(DEFAULT_SETTINGS), noop as unknown as HTMLElement);
    mockPads(fakePad({ axes: [0.9, -0.8, 0.9, 0], buttons: { 7: 1, 6: 1, 9: 1 } }));
    input.pollGamepad();
    expect(input.pad.connected).toBe(true); expect(input.lastSource).toBe('pad');
    const m = input.moveAxes(); expect(m.x).toBeGreaterThan(0.3); expect(m.y).toBeGreaterThan(0.3);
    expect(input.lookDelta(0.1).x).toBeGreaterThan(10);
    expect(input.held('fire')).toBe(true); expect(input.held('aim')).toBe(true);
    expect(input.justPressed('pause')).toBe(true);
    input.endFrame(); input.pollGamepad();
    expect(input.justPressed('pause')).toBe(false); // edge, not level
    mockPads(fakePad({ buttons: { 7: 1 } })); input.pollGamepad();
    expect(input.throttle()).toBe(1);
    mockPads(fakePad({ buttons: { 6: 1 } })); input.pollGamepad();
    expect(input.throttle()).toBe(-1);
    mockPads(null); input.pollGamepad();
    expect(input.pad.connected).toBe(false); expect(input.held('fire')).toBe(false);
  });
  it('glyph labels follow the action map', () => {
    expect(padGlyph('fire')).toBe('RT'); expect(padGlyph('aim')).toBe('LT');
    expect(padGlyph('pause')).toBe('Menu'); expect(padGlyph('enter')).toBe('Y');
    expect(padGlyph('sirenWail')).toBeNull();
    expect(Object.keys(PAD_MAP).length).toBeGreaterThan(10);
    expect(padActive(readPad(() => [fakePad({ axes: [0.9, 0, 0, 0] })]))).toBe(true);
  });
});

describe('iPad detection', () => {
  const ipadOS = { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15', platform: 'MacIntel', maxTouchPoints: 5 };
  const mac = { ...ipadOS, maxTouchPoints: 0 };
  const iphone = { userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148', platform: 'iPhone', maxTouchPoints: 5 };
  it('recognises iPadOS desktop-class Safari, not Macs or phones', () => {
    expect(isIPad(ipadOS)).toBe(true); expect(isIPad(mac)).toBe(false); expect(isIPad(iphone)).toBe(false);
  });
  it('only phones are gated; iPad gets the low memory preset', () => {
    expect(isPhoneLike(ipadOS, 820)).toBe(false); expect(isPhoneLike(iphone, 390)).toBe(true);
    expect(defaultQualityFor(ipadOS)).toBeNull(); // owner: M4 iPad runs the normal preset expect(defaultQualityFor(mac)).toBeNull();
  });
});

describe('gamepad layouts by context', () => {
  const pad = (b: Partial<Record<number, number>>) => readPad(() => [fakePad({ buttons: b })]);
  it('on foot: RT fires, LT aims, A sprints, X jumps, Y enters / interacts, LB wheel, B reload', () => {
    expect(padHeld('fire', pad({ 7: 1 }), 'foot')).toBe(true);
    expect(padHeld('aim', pad({ 6: 1 }), 'foot')).toBe(true);
    expect(padHeld('sprint', pad({ 0: 1 }), 'foot')).toBe(true);
    expect(padHeld('jump', pad({ 2: 1 }), 'foot')).toBe(true);
    expect(padHeld('enter', pad({ 3: 1 }), 'foot')).toBe(true);
    expect(padHeld('interact', pad({ 3: 1 }), 'foot')).toBe(true);
    expect(padHeld('wheel', pad({ 4: 1 }), 'foot')).toBe(true);
    expect(padHeld('reload', pad({ 1: 1 }), 'foot')).toBe(true);
    expect(padHeld('crouch', pad({ 10: 1 }), 'foot')).toBe(true);
    expect(padHeld('jump', pad({ 0: 1 }), 'foot')).toBe(false);
  });
  it('in a vehicle: RB handbrake, B camera, LB aims, RT only fires while aiming, LT is not aim', () => {
    expect(padHeld('handbrake', pad({ 5: 1 }), 'car')).toBe(true);
    expect(padHeld('camera', pad({ 1: 1 }), 'car')).toBe(true);
    expect(padHeld('aim', pad({ 4: 1 }), 'car')).toBe(true);
    expect(padHeld('aim', pad({ 6: 1 }), 'car')).toBe(false);
    expect(padHeld('fire', pad({ 7: 1 }), 'car')).toBe(false);
    expect(padHeld('fire', pad({ 7: 1, 4: 1 }), 'car')).toBe(true);
    expect(padHeld('wheel', pad({ 4: 1 }), 'car')).toBe(false);
    expect(padHeld('sprint', pad({ 0: 1 }), 'car')).toBe(false);
    expect(padHeld('radio', pad({ 15: 1 }), 'car')).toBe(true);
    expect(padHeld('headlights', pad({ 14: 1 }), 'car')).toBe(true);
  });
  it('in a helicopter: RB climbs, LB descends, X guns, B missile; RT is pitch not fire', () => {
    expect(padHeld('handbrake', pad({ 5: 1 }), 'heli')).toBe(true);
    expect(padHeld('sprint', pad({ 4: 1 }), 'heli')).toBe(true);
    expect(padHeld('fire', pad({ 2: 1 }), 'heli')).toBe(true);
    expect(padHeld('fire', pad({ 7: 1 }), 'heli')).toBe(false);
    expect(padHeld('reload', pad({ 1: 1 }), 'heli')).toBe(true);
  });
  it('Input follows its context, and glyphs follow the layout', () => {
    const noop = { addEventListener() {}, removeEventListener() {} };
    vi.stubGlobal('window', noop); vi.stubGlobal('document', { ...noop, pointerLockElement: null });
    const input = new Input(structuredClone(DEFAULT_SETTINGS), noop as unknown as HTMLElement);
    mockPads(fakePad({ buttons: { 5: 1 } })); input.padContext = 'car'; input.pollGamepad();
    expect(input.held('handbrake')).toBe(true); expect(input.held('orders')).toBe(false);
    input.padContext = 'foot'; expect(input.held('handbrake')).toBe(false); expect(input.held('orders')).toBe(true);
    expect(padGlyph('handbrake', 'car')).toBe('RB'); expect(padGlyph('aim', 'car')).toBe('LB'); expect(padGlyph('fire', 'car')).toBe('LB + RT');
    expect(padGlyph('jump', 'foot')).toBe('X'); expect(padGlyph('camera', 'car')).toBe('B');
    input.padContext = 'foot';
  });
});
