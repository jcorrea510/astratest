/** Model: marksman (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
  return longGun(k, { recv: [-0.09, 0.19], recvH: 0.068, barrel: 0.72, guard: 0.3, guardMat: 'tan', stock: 'fixed', stockLen: 0.29, stockMat: 'tan', mag: 'box', magLen: 0.1, optic: 'scope', scopeLen: 0.3, muzzle: 'brake', furniture: 'polymer' });
}
