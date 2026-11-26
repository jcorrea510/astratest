import { describe, expect, it, vi } from 'vitest';

async function makeInput() {
  vi.stubGlobal('window', { addEventListener: vi.fn() });
  vi.stubGlobal('document', { addEventListener: vi.fn(), pointerLockElement: null });
  const canvas = { addEventListener: vi.fn() } as unknown as HTMLElement;
  const { Input } = await import('./input');
  const { DEFAULT_SETTINGS } = await import('./settings');
  return new Input(structuredClone(DEFAULT_SETTINGS), canvas);
}

describe('Input: touch controls', () => {
  it('held / justPressed / justReleased follow a touch button', async () => {
    const i = await makeInput();
    i.setTouchAction('fire', true);
    expect(i.held('fire')).toBe(true); expect(i.justPressed('fire')).toBe(true);
    i.endFrame();
    expect(i.held('fire')).toBe(true); expect(i.justPressed('fire')).toBe(false);
    i.setTouchAction('fire', false);
    expect(i.held('fire')).toBe(false); expect(i.justReleased('fire')).toBe(true);
    i.endFrame(); expect(i.justReleased('fire')).toBe(false);
  });
  it('a tap shorter than one frame is still held for that frame', async () => {
    const i = await makeInput();
    i.setTouchAction('reload', true); i.setTouchAction('reload', false);
    expect(i.held('reload')).toBe(true); expect(i.justPressed('reload')).toBe(true);
    i.endFrame();
    expect(i.held('reload')).toBe(false); expect(i.justReleased('reload')).toBe(true);
  });
  it('the stick drives moveAxes and analog throttle; clearAll lets go', async () => {
    const i = await makeInput();
    i.setTouchMove(0.5, -0.8);
    expect(i.moveAxes()).toEqual({ x: 0.5, y: -0.8 });
    expect(i.throttle()).toBeCloseTo(-0.8);
    i.setTouchAction('forward', true); expect(i.throttle()).toBe(1); // a pedal wins over the stick
    i.clearAll();
    expect(i.moveAxes()).toEqual({ x: 0, y: 0 }); expect(i.held('forward')).toBe(false);
  });
  it('drag-look feeds the look delta and is consumed at the end of the frame', async () => {
    const i = await makeInput();
    i.addLook(12, -4);
    expect(i.lookDelta(0.016)).toEqual({ x: 12, y: -4 });
    i.endFrame(); expect(i.lookDelta(0.016)).toEqual({ x: 0, y: 0 });
  });
  it('with touch controls on, the look "lock" is virtual (no pointer lock needed)', async () => {
    const i = await makeInput();
    i.touchActive = true; i.requestLock();
    expect(i.locked).toBe(true); expect(i.virtualLock).toBe(true);
  });
});
