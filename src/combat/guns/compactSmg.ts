/** Model: compactSmg (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { longGun } from './families';

export function build(k: Kit): Built {
  return longGun(k, { recv: [-0.06, 0.12], recvH: 0.06, w: 0.036, barrel: 0.2, guard: 0.05, guardR: 0.02, stock: 'folded', stockLen: 0.2, mag: 'pistol', magLen: 0.14, magZ: -0.002, optic: 'irons', muzzle: 'none' });
}
