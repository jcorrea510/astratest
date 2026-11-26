/** Model: smg (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
  return longGun(k, { recv: [-0.08, 0.16], recvH: 0.062, barrel: 0.33, guard: 0.13, guardR: 0.021, stock: 'skeleton', stockLen: 0.22, mag: 'straight', magLen: 0.16, magZ: 0.115, optic: 'dot', muzzle: 'flash' });
}
