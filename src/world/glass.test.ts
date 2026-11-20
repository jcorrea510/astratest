import { describe, it, expect } from 'vitest';
import { WorldGlass, HITS_TO_BREAK } from './glass';

describe('WorldGlass break hook', () => {
  it('fires onBreak once with the pane geometry when the last hit shatters it (decals are cleared from there)', () => {
    const w = new WorldGlass(); const id = w.add(4, 2, 6, 0.5, 2.2, 1.8);
    const seen: { x: number; y: number; z: number; yaw: number; w: number; h: number }[] = [];
    w.onBreak = p => seen.push({ x: p.x, y: p.y, z: p.z, yaw: p.yaw, w: p.w, h: p.h });
    for (let i = 0; i < HITS_TO_BREAK - 1; i++) w.hitGlass(id);
    expect(seen.length).toBe(0);
    w.hitGlass(id); w.hitGlass(id);
    expect(seen).toEqual([{ x: 4, y: 2, z: 6, yaw: 0.5, w: 2.2, h: 1.8 }]);
  });
});
