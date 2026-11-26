import { describe, it, expect } from 'vitest';
import { StaticStream, STREAM_ENABLE_R } from './staticStream';
import { WEAPONS } from '../combat/weapons';

interface Fake { id: number; on: boolean; gone?: boolean }
const make = () => {
  const apply = (c: Fake, on: boolean) => { c.on = on; };
  const s = new StaticStream<Fake>(apply, c => !c.gone);
  // game-side setEnabled goes through intercept, exactly like the patched collider prototype
  const setEnabled = (c: Fake, on: boolean) => { c.on = s.intercept(c, on); };
  return { s, setEnabled };
};
const col = (id: number): Fake => ({ id, on: true });

describe('StaticStream (static collider streaming)', () => {
  it('switches off colliders beyond the radius and back on when the focus comes near', () => {
    const { s } = make();
    const near = col(1), far = col(2), mid = col(3);
    s.add(near, 10, 10); s.add(far, 1500, 0); s.add(mid, 300, 0);
    s.update(0, 0, true);
    expect(near.on).toBe(true); expect(mid.on).toBe(true); expect(far.on).toBe(false);
    expect(s.off).toBe(1);
    s.update(1400, 0);
    expect(far.on).toBe(true); expect(near.on).toBe(false); expect(mid.on).toBe(false);
  });
  it('hysteresis: a collider just past the enable radius is not toggled on a small move', () => {
    const { s } = make();
    const a = col(1);
    s.add(a, 440, 0);
    s.update(0, 0, true); // 440 m: cell rect min distance decides (cell 6 spans 384..448 -> 384 <= 430): enabled
    expect(a.on).toBe(true);
    s.update(-60, 0); // rect distance 444 <= disableR 480: still on
    expect(a.on).toBe(true);
    s.update(-100, 0);
    expect(a.on).toBe(false);
  });
  it('ignores tiny moves (no per-frame work)', () => {
    const { s } = make();
    s.add(col(1), 0, 0);
    expect(s.update(0, 0)).toBe(true);
    expect(s.update(3, 4)).toBe(false);
    expect(s.update(30, 0)).toBe(true);
  });
  it('game code that disables a collider (vault gap, broken glass) is never overridden by the stream', () => {
    const { s, setEnabled } = make();
    const gap = col(1); s.add(gap, 0, 0);
    setEnabled(gap, false); // game: shutter open -> collider off
    s.update(0, 0, true);
    s.update(2000, 0); s.update(0, 0); // leaves and returns
    expect(gap.on).toBe(false);
    setEnabled(gap, true); expect(gap.on).toBe(true);
    s.update(2000, 0);
    expect(gap.on).toBe(false); // streamed out
    setEnabled(gap, false); s.update(0, 0); expect(gap.on).toBe(false); // wanted off while away stays off on return
    setEnabled(gap, true); expect(gap.on).toBe(true);
  });
  it('colliders the game removed are skipped', () => {
    const { s } = make();
    const a = col(1); s.add(a, 0, 0);
    s.update(0, 0, true);
    s.update(3000, 0);
    expect(a.on).toBe(false);
    a.gone = true; a.on = false;
    expect(() => s.update(0, 0)).not.toThrow();
    expect(a.on).toBe(false);
  });
});

describe('stream radius vs weapons', () => {
  it('stays beyond the longest weapon range so shots never pass through streamed-out walls and glass', () => {
    const longest = Math.max(...Object.values(WEAPONS).map(w => w.range ?? 0));
    expect(STREAM_ENABLE_R).toBeGreaterThan(longest + 20);
  });
});
