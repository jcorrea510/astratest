/** Model: battleRifle (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
  return longGun(k, { recv: [-0.1, 0.2], recvH: 0.072, w: 0.038, barrel: 0.68, br: 0.01, guard: 0.28, guardR: 0.025, guardMat: 'wood', stock: 'wood', stockLen: 0.3, stockMat: 'wood', mag: 'box', magLen: 0.13, optic: 'irons', muzzle: 'brake', furniture: 'polymer' });
}
