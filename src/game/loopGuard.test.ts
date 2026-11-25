import { describe, expect, it, vi } from 'vitest';
import { LoopGuard } from './loopGuard';

describe('LoopGuard', () => {
  it('swallows a one-off error, logs it once and keeps running', () => {
    const log = vi.fn(), fatal = vi.fn();
    const g = new LoopGuard({ limit: 3, log, onFatal: fatal });
    expect(g.run(() => { throw new Error('boom'); })).toBe(false);
    expect(g.run(() => undefined)).toBe(true);
    expect(g.consecutive).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    expect(fatal).not.toHaveBeenCalled();
  });
  it('does not repeat the log for the same message, and goes fatal after `limit` in a row', () => {
    const log = vi.fn(), fatal = vi.fn();
    const g = new LoopGuard({ limit: 3, log, onFatal: fatal });
    for (let i = 0; i < 5; i++) g.run(() => { throw new Error('same'); });
    expect(log).toHaveBeenCalledTimes(1);
    expect(fatal).toHaveBeenCalledTimes(1);
    expect(g.fatal).toBe(true);
  });
  it('a success between errors resets the streak', () => {
    const fatal = vi.fn();
    const g = new LoopGuard({ limit: 3, log: () => undefined, onFatal: fatal });
    for (let i = 0; i < 10; i++) { g.run(() => { throw new Error('x'); }); g.run(() => undefined); }
    expect(fatal).not.toHaveBeenCalled();
  });
});
