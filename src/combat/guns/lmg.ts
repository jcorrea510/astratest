/** Model: lmg (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
  return longGun(k, { recv: [-0.1, 0.26], recvH: 0.09, w: 0.044, barrel: 0.85, br: 0.012, guard: 0.22, guardR: 0.03, stock: 'fixed', stockLen: 0.28, mag: 'belt', magZ: 0.14, optic: 'dot', muzzle: 'flash', carry: true, bipod: true });
}
