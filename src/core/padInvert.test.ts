import { describe, it, expect } from 'vitest';
import { padYSign } from './input';

describe('pad invert Y', () => {
  it('pad invert alone flips the stick', () => expect(padYSign({ padInvertY: true })).toBe(-1));
  it('global invert alone leaves the pad sign to the global flip', () => expect(padYSign({ invertY: true })).toBe(1));
  it('both ticked stay inverted instead of cancelling', () => expect(padYSign({ invertY: true, padInvertY: true }) * -1).toBe(-1));
});
