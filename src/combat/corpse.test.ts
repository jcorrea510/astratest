import { it, expect } from 'vitest';
import { corpseShootable } from './combat';
it('fresh bodies on the ground can be shot; living, seated or long-gone ones are not (Round 8)', () => {
  expect(corpseShootable({ alive: false, inVehicle: null, deadTime: 3 })).toBe(true);
  expect(corpseShootable({ alive: true, inVehicle: null, deadTime: 0 })).toBe(false);
  expect(corpseShootable({ alive: false, inVehicle: {}, deadTime: 3 })).toBe(false);
  expect(corpseShootable({ alive: false, inVehicle: null, deadTime: 500 })).toBe(false);
});
