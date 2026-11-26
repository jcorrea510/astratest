/** Model: heavyPistol (see combat/weapons.ts for its name and stats). */
import type { Kit, Built } from './kit';
import { pistol } from './families';

export function build(k: Kit): Built { const r = pistol(k, { slide: 0.215, front: 0, h: 0.036, w: 0.032, grip: 0.115, mat: 'steel', frame: 'tan' }); return r; }
