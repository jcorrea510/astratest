import { describe, it, expect } from 'vitest';
import { Character } from './character';

describe('hitting someone who is down (Round 8)', () => {
  it('keeps a knocked-out person on the floor instead of playing a standing stagger', () => {
    const played: string[] = [];
    const c = { alive: true, inVehicle: null, blockT: 0, downT: 2.4, getUpAt: 1.25, knockT: 2.4, isPlayer: false, yaw: 0, vel: { x: 0, z: 0 },
      human: { playAction: (n: string) => played.push(n) } } as unknown as Character;
    Character.prototype.hitReact.call(c, 1, 0, 0.6);
    Character.prototype.hitReact.call(c, 1, 0, 1.5);
    expect(played).toEqual([]);
    expect(c.downT).toBeGreaterThan(2.4);
  });
});
