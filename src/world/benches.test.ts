import { describe, it, expect, beforeEach } from 'vitest';
import { BENCHES, registerBench, nearestFreeBench } from './benches';

describe('bench registry', () => {
  beforeEach(() => { BENCHES.length = 0; });
  it('finds the nearest free bench within reach at the same level', () => {
    registerBench(10, 0, 0, 0); registerBench(3, 0, 0, 1); registerBench(2, 6, 0, 0);
    expect(nearestFreeBench(0, 0, 0, 20)?.x).toBe(3);
    BENCHES[1].occupied = true;
    expect(nearestFreeBench(0, 0, 0, 20)?.x).toBe(10);
    expect(nearestFreeBench(0, 0, 0, 5)).toBeNull();
  });
});
