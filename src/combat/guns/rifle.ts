/** Model: rifle (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
  return longGun(k, { recv: [-0.09, 0.18], recvH: 0.066, barrel: 0.6, guard: 0.26, stock: 'fixed', stockLen: 0.27, mag: 'curved', magLen: 0.19, optic: 'irons', muzzle: 'flash', carry: false });
}
