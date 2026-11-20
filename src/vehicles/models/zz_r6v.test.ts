import { it } from 'vitest';
import { getTemplate } from './build';
it('tri counts', { timeout: 120000 }, () => {
  for (const k of ['sedan', 'suv', 'hatch', 'pickup', 'bus', 'van', 'taxi', 'tank'] as const) {
    const t0 = performance.now(); const t = getTemplate(k); const ms = performance.now() - t0;
    process.stdout.write(`TRI ${k} ${t.lods.map(l => (l.body.attributes.position.count / 3) + '/' + ((l.glass?.attributes.position.count ?? 0) / 3)).join(' ')} build ${ms.toFixed(0)}ms\n`);
  }
});
