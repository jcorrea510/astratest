import { describe, it, expect } from 'vitest';
import { walksToVehicle } from './npc';

describe('walksToVehicle (kerb guard exemption)', () => {
  it('riders heading for a bus or taxi door may step onto the carriageway', () => {
    expect(walksToVehicle({ activity: 'board', destPt: {} })).toBe(true);
    expect(walksToVehicle({ activity: 'taxi', destPt: {} })).toBe(true);
  });
  it('ordinary walkers and riders without a destination stay guarded', () => {
    expect(walksToVehicle({ activity: '', destPt: null })).toBe(false);
    expect(walksToVehicle({ activity: 'board', destPt: null })).toBe(false);
    expect(walksToVehicle({ activity: 'shop', destPt: {} })).toBe(false);
    expect(walksToVehicle({ activity: 'queue', destPt: null })).toBe(false);
  });
});
