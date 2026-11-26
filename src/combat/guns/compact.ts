/** Model: compact (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { pistol } from './families';

export function build(k: Kit): Built {
  return pistol(k, { slide: 0.15, front: 0, h: 0.028, w: 0.025, grip: 0.085, mat: 'chrome', frame: 'polymer' });
}
