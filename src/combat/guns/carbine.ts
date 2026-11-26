/** Model: carbine (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
  return longGun(k, { recv: [-0.08, 0.17], recvH: 0.065, barrel: 0.46, guard: 0.18, stock: 'tube', stockLen: 0.24, mag: 'curved', magLen: 0.17, optic: 'dot', muzzle: 'flash', furniture: 'tan' });
}
