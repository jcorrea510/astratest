import { describe, it, expect } from 'vitest';
import { jobFare } from './taxiJob';
import { taxiFare, skipFare } from './taxiRide';

describe('Round 7 taxis', () => {
  it('a taxi job pays more for longer trips and tips a quick drive', () => {
    expect(jobFare(500, 999).fare).toBeGreaterThan(jobFare(250, 999).fare);
    expect(jobFare(400, 999).tip).toBe(0);
    expect(jobFare(400, 30).tip).toBeGreaterThan(0);
    expect(jobFare(400, 30).fare + jobFare(400, 30).tip).toBeGreaterThanOrEqual(40); // a starting player earns real money
  });
  it('riding as a passenger costs a flag drop plus distance; skipping costs extra', () => {
    expect(taxiFare(0)).toBe(4);
    expect(taxiFare(1000)).toBe(24);
    expect(skipFare(500)).toBeGreaterThan(0);
  });
});
