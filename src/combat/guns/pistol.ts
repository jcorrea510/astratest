/** Model: pistol (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { pistol } from './families';

export function build(k: Kit): Built {
  return pistol(k, { slide: 0.185, front: 0, h: 0.032, w: 0.029, grip: 0.105 });
}
