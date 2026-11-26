/** Model: compact "Wren .380" - small hammerless pocket pistol, chrome slide over a slim polymer frame. */
import type { Kit, Built } from './kit';
import { handgun } from './pistol';

export function build(k: Kit): Built {
  return handgun(k, {
    slide: 0.148, slideH: 0.0285, slideW: 0.0215, frameW: 0.0205, gripW: 0.0235, gripLen: 0.068, rake: 0.30, depth: 0.0305,
    slideMat: 'chrome', dots: false, rail: false, frontSerr: false, rearSerr: 5, guardZ: 0.9, magW: 0.0155, takedown: false, grooves: false, backIn: 0.011,
  });
}
