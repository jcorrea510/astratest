import { describe, it, expect } from 'vitest';
import { mph, fmtDistance, fmtClock12 } from './units';

describe('US units', () => {
  it('converts m/s to mph', () => { expect(Math.round(mph(26.8224))).toBe(60); });
  it('formats distances in feet under a tenth of a mile, miles above', () => {
    expect(fmtDistance(30)).toBe('100 ft');
    expect(fmtDistance(804.67)).toBe('0.5 mi');
    expect(fmtDistance(40000)).toBe('25 mi');
  });
  it('formats a 12-hour clock with AM/PM', () => {
    expect(fmtClock12(0)).toBe('12:00 AM');
    expect(fmtClock12(12.5)).toBe('12:30 PM');
    expect(fmtClock12(18.7)).toBe('6:42 PM');
    expect(fmtClock12(7.05)).toBe('7:03 AM');
  });
});
