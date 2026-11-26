/** Model: autoShotgun (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
  return longGun(k, { recv: [-0.09, 0.2], recvH: 0.075, w: 0.04, barrel: 0.55, br: 0.011, guard: 0.18, guardR: 0.026, stock: 'fixed', stockLen: 0.26, mag: 'drum', magZ: 0.12, optic: 'dot', muzzle: 'brake', carry: false });
}
