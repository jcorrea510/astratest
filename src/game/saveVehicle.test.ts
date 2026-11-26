import { describe, expect, it } from 'vitest';
import { Color } from 'three';
import { paintIndexFor } from './saveVehicle';

describe('paintIndexFor', () => {
  const paints = ['#c0392b', '#2c3e50', '#f1c40f'];
  it('finds the palette entry a paint came from', () => {
    paints.forEach((hex, i) => expect(paintIndexFor(paints, new Color(hex).convertSRGBToLinear())).toBe(i));
  });
  it('snaps a custom colour to the nearest entry and survives an empty palette', () => {
    expect(paintIndexFor(paints, new Color('#2c3f52').convertSRGBToLinear())).toBe(1);
    expect(paintIndexFor([], { r: 1, g: 1, b: 1 })).toBe(0);
  });
});
