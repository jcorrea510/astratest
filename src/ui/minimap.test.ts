import { describe, it, expect } from 'vitest';
import { RIM_KINDS } from './minimap';

describe('minimap rim (Round 7)', () => {
  it('stores, shops and garages are not pinned to the edge when off the map; the waypoint and police are', () => {
    for (const k of ['shop', 'barber', 'clothing', 'garage', 'arms', 'safehouse', 'vehicle', 'collectible']) expect(RIM_KINDS.has(k), k).toBe(false);
    for (const k of ['waypoint', 'police', 'enemy', 'mission']) expect(RIM_KINDS.has(k), k).toBe(true);
  });
});
