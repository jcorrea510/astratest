import { describe, expect, it } from 'vitest';
import { DEFAULT_BINDINGS, ACTION_LABELS, type Action } from '../core/settings';
import { ACTION_GROUPS, conflictSlots, findConflicts, withBinding } from './bindings';
import { accumulateDirection, clampToRadius, formatMoney, formatTimer, mapScreenToWorld, mapWorldToScreen, slotFromDirection, worldToMinimap } from './geometry';

describe('wheel direction', () => {
  it('maps cardinal directions to slots of an 8-slot wheel (0 = top, clockwise)', () => {
    expect(slotFromDirection(0, -1, 8)).toBe(0);
    expect(slotFromDirection(1, -1, 8)).toBe(1);
    expect(slotFromDirection(1, 0, 8)).toBe(2);
    expect(slotFromDirection(0, 1, 8)).toBe(4);
    expect(slotFromDirection(-1, 0, 8)).toBe(6);
    expect(slotFromDirection(-1, -1, 8)).toBe(7);
  });
  it('handles wheels with fewer slots', () => {
    expect(slotFromDirection(0, -1, 3)).toBe(0);
    expect(slotFromDirection(1, 0.6, 3)).toBe(1);
    expect(slotFromDirection(-1, 0.6, 3)).toBe(2);
    expect(slotFromDirection(0, 1, 0)).toBe(-1);
  });
  it('accumulates deltas and clamps to the max radius', () => {
    const acc = { x: 0, y: 0 };
    accumulateDirection(acc, 300, 0, 100);
    expect(acc.x).toBeCloseTo(100); expect(acc.y).toBeCloseTo(0);
    accumulateDirection(acc, -100, -100, 100);
    expect(Math.hypot(acc.x, acc.y)).toBeLessThanOrEqual(100.0001);
    expect(slotFromDirection(acc.x, acc.y, 8)).toBe(0);
  });
});

describe('minimap transform', () => {
  it('keeps north up when heading is 0', () => {
    const p = worldToMinimap(10, 10, 0, 2, 10, 0);
    expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(-20);
    const e = worldToMinimap(0, 0, 0, 1, 5, 0);
    expect(e.x).toBeCloseTo(5); expect(e.y).toBeCloseTo(0);
  });
  it('rotates so the facing direction points up', () => {
    // facing east (heading +90deg): a point to the east appears straight up
    const p = worldToMinimap(0, 0, Math.PI / 2, 1, 50, 0);
    expect(p.x).toBeCloseTo(0); expect(p.y).toBeCloseTo(-50);
    // and a point to the south appears to the right
    const s = worldToMinimap(0, 0, Math.PI / 2, 1, 0, 50);
    expect(s.x).toBeCloseTo(50); expect(s.y).toBeCloseTo(0);
  });
  it('clamps off-edge points to the rim', () => {
    const p = { x: 300, y: 400 };
    expect(clampToRadius(p, 50)).toBe(true);
    expect(p.x).toBeCloseTo(30); expect(p.y).toBeCloseTo(40);
    const q = { x: 3, y: 4 };
    expect(clampToRadius(q, 50)).toBe(false);
  });
  it('full map screen <-> world round-trips', () => {
    const v = { cx: 40, cz: -20, scale: 0.6, w: 1000, h: 700 };
    const s = mapWorldToScreen(v, 123, 456);
    const w = mapScreenToWorld(v, s.x, s.y);
    expect(w.x).toBeCloseTo(123); expect(w.z).toBeCloseTo(456);
  });
});

describe('key bindings', () => {
  it('default bindings have no conflicts (jump and handbrake share Space by design)', () => {
    expect(findConflicts(DEFAULT_BINDINGS).size).toBe(0);
  });
  it('detects a key bound to two simultaneous actions', () => {
    const b = withBinding(DEFAULT_BINDINGS, 'forward', 0, 'KeyE');
    const c = findConflicts(b);
    expect(c.get('KeyE')?.sort()).toEqual(['forward', 'interact']);
    expect(conflictSlots(b).has('interact|KeyE')).toBe(true);
  });
  it('does not flag foot-only vs vehicle-only overlaps', () => {
    const b = withBinding(DEFAULT_BINDINGS, 'horn', 0, 'ShiftLeft'); // sprint (foot) vs horn (vehicle)
    expect(findConflicts(b).size).toBe(0);
  });
  it('edits slots without duplicating within an action', () => {
    let b = withBinding(DEFAULT_BINDINGS, 'forward', 1, 'KeyW'); // moving a key swaps slots
    expect(b.forward).toEqual(['ArrowUp', 'KeyW']);
    b = withBinding(b, 'forward', 1, 'KeyI');
    expect(b.forward).toEqual(['ArrowUp', 'KeyI']);
    b = withBinding(b, 'forward', 0, null);
    expect(b.forward).toEqual(['KeyI']);
    expect(DEFAULT_BINDINGS.forward).toEqual(['KeyW', 'ArrowUp']);
  });
  it('groups cover every action exactly once', () => {
    const all = ACTION_GROUPS.flatMap(g => g.actions);
    expect(new Set(all).size).toBe(all.length);
    expect(all.sort()).toEqual((Object.keys(ACTION_LABELS) as Action[]).sort());
  });
});

describe('formatting', () => {
  it('formats money and timers', () => {
    expect(formatMoney(12500)).toBe('$12,500');
    expect(formatMoney(-40)).toBe('-$40');
    expect(formatTimer(75.2)).toBe('1:16');
    expect(formatTimer(-3)).toBe('0:00');
  });
});
