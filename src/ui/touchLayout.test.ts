import { describe, expect, it } from 'vitest';
import { LAYOUTS, TOP_BUTTONS, MIN_TARGET_PX, axesFor, touchPromptFor, pxSize, stickAxes, touchContext, uFor } from './touchLayout';
import { DEFAULT_BINDINGS } from '../core/settings';

describe('touch layout', () => {
  it('every button is a valid action and at least 44 CSS px on an iPad Air and on a phone', () => {
    for (const [w, h] of [[1180, 820], [844, 390], [932, 430], [1366, 1024]]) {
      const u = uFor(w, h);
      for (const b of [...Object.values(LAYOUTS).flat(), ...TOP_BUTTONS]) {
        expect(b.action in DEFAULT_BINDINGS, b.id).toBe(true);
        expect(pxSize(b.size, u), `${b.id} @${w}x${h}`).toBeGreaterThanOrEqual(MIN_TARGET_PX);
      }
    }
  });
  it('covers the core actions in each context', () => {
    const acts = (c: keyof typeof LAYOUTS) => new Set(LAYOUTS[c].map(b => b.action));
    for (const a of ['fire', 'aim', 'jump', 'sprint', 'enter', 'wheel', 'reload'] as const) expect(acts('foot').has(a), a).toBe(true);
    for (const a of ['forward', 'back', 'handbrake', 'enter', 'horn'] as const) expect(acts('car').has(a), a).toBe(true);
    for (const a of ['handbrake', 'sprint', 'enter'] as const) expect(acts('heli').has(a), a).toBe(true);
    expect(TOP_BUTTONS.map(b => b.action)).toEqual(['pause', 'map']);
  });
  it('buttons in one context do not overlap on an iPad Air or a phone', () => {
    for (const [w, h] of [[1180, 820], [844, 390]]) {
      const u = uFor(w, h);
      for (const [ctx, list] of Object.entries(LAYOUTS)) {
        const boxes = list.map(b => { const s = pxSize(b.size, u); const r = b.right * u, bt = b.bottom * u; return { id: b.id, x0: r, x1: r + s, y0: bt, y1: bt + s }; });
        for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i], b = boxes[j];
          const ox = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), oy = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
          expect(ox > 2 && oy > 2, `${ctx}: ${a.id} overlaps ${b.id} @${w}x${h}`).toBe(false);
        }
      }
    }
  });
  it('picks the context', () => {
    expect(touchContext({ heli: false, vehicle: false })).toBe('foot');
    expect(touchContext({ heli: false, vehicle: true })).toBe('car');
    expect(touchContext({ heli: true, vehicle: true })).toBe('heli');
  });
});

describe('stick maths', () => {
  it('has a dead zone, forward is up, full deflection at the radius', () => {
    expect(stickAxes(3, 2, 56).mag).toBe(0);
    const up = stickAxes(0, -56, 56); expect(up.y).toBeCloseTo(1); expect(up.x).toBeCloseTo(0);
    const right = stickAxes(100, 0, 56); expect(right.x).toBeCloseTo(1); expect(right.mag).toBeCloseTo(1);
    const half = stickAxes(0, 28, 56); expect(half.y).toBeLessThan(0); expect(half.y).toBeGreaterThan(-0.6);
  });
  it('a car steers with x only', () => {
    expect(axesFor('car', { x: 0.4, y: 0.9 })).toEqual({ x: 0.4, y: 0 });
    expect(axesFor('foot', { x: 0.4, y: 0.9 })).toEqual({ x: 0.4, y: 0.9 });
  });
});

describe('touch prompts', () => {
  it('swaps the key cap for the touch button label', () => {
    expect(touchPromptFor('E  Enter the shop', DEFAULT_BINDINGS, 'foot')).toBe('USE  Enter the shop');
    expect(touchPromptFor('F  Take the car', DEFAULT_BINDINGS, 'foot')).toBe('CAR  Take the car');
    expect(touchPromptFor('F  Leave', DEFAULT_BINDINGS, 'car')).toBe('EXIT  Leave');
  });
  it('follows rebound keys and leaves unmapped caps and plain text alone', () => {
    expect(touchPromptFor('Q  Use', { ...DEFAULT_BINDINGS, interact: ['KeyQ'] }, 'foot')).toBe('USE  Use');
    expect(touchPromptFor('Y  Something', DEFAULT_BINDINGS, 'foot')).toBe('Y  Something');
    expect(touchPromptFor('Hold up the clerk', DEFAULT_BINDINGS, 'foot')).toBe('Hold up the clerk');
    expect(touchPromptFor(null, DEFAULT_BINDINGS, 'foot')).toBeNull();
  });
});
