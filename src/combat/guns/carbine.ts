/** Model: carbine ("Kite Carbine"): short AR-pattern carbine, tan furniture, slim stock, brake, tube red dot. */
import type { Kit, Built } from './kit';
import { buildAR } from './rifle';

export function build(k: Kit): Built {
  return buildAR(k, { guardLen: 0.17, barrelEnd: 0.43, furniture: 'tan', stock: 'slim', stockLen: 0.17, muzzle: 'brake', optic: 'dot' });
}
