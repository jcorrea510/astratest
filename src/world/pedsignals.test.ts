import { describe, it, expect } from 'vitest';
import { generateCity, pedSignal, pedestrianMayCross, signalState, SIGNAL_PERIOD, PED_WALK_TIME, surfaceAt } from './citymap';
import { pedSignalPosts } from './pedsignals';

const city = generateCity();
describe('pedestrian signals', () => {
  it('shows WALK only while the crossed road is red and the cross street has just turned green', () => {
    const inter = city.intersections.find(i => i.signalized)!;
    let walk = 0;
    for (let t = 0; t < SIGNAL_PERIOD * 2; t += 0.1) {
      for (const axis of ['x', 'z'] as const) {
        const s = pedSignal(inter, axis, t);
        if (s === 'walk') { walk++; expect(signalState(inter, axis, t)).toBe('red'); expect(signalState(inter, axis === 'x' ? 'z' : 'x', t)).toBe('green'); }
        // the hand is never absent while the crossed road is moving or about to move
        if (signalState(inter, axis, t) === 'green' || signalState(inter, axis, t) === 'yellow') expect(s).toBe('dont');
        expect(pedestrianMayCross(inter, axis, t)).toBe(s === 'walk');
      }
    }
    expect(walk).toBeGreaterThan(0);
  });
  it('leaves enough time after the last WALK to clear the widest crossing before cross traffic is released', () => {
    const inter = city.intersections.find(i => i.signalized)!;
    // from the last instant of WALK until the crossed road turns green: green remainder + yellow + all-red
    let lastWalk = -1, greenAgain = -1;
    for (let t = 0; t < SIGNAL_PERIOD / 2; t += 0.05) { if (pedSignal(inter, 'x', t) === 'walk') lastWalk = t; }
    for (let t = lastWalk; t < SIGNAL_PERIOD; t += 0.05) if (signalState(inter, 'x', t) === 'green') { greenAgain = t; break; }
    expect(greenAgain - lastWalk).toBeGreaterThan(9);
    expect(PED_WALK_TIME).toBeLessThan(8);
  });
  it('puts a signal pole at both ends of every signalized crosswalk, off the carriageway', () => {
    const posts = pedSignalPosts(city);
    expect(posts.length).toBeGreaterThan(50);
    for (const p of posts) { expect(city.intersections[p.inter].signalized).toBe(true); expect(surfaceAt(city, p.x, p.z)).not.toBe('road'); }
  });
});
