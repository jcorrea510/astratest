import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { DEFAULT_BINDINGS } from '../core/settings';
import { findConflicts } from './bindings';

/** String literals only (single-quoted or template text), so identifiers like `stylised` are not checked. */
function strings(file: string): string[] {
  const src = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...src.matchAll(/'((?:[^'\\\n]|\\.)+)'|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2]);
}
const PLAYER_TEXT = ['./settingsPanel.ts', './ui.ts', './sandbox.ts', './garageMenu.ts', './controlsPanel.ts', '../game/sandbox.ts'];

describe('player-facing copy', () => {
  it('uses US spelling and one name for the wanted concept (Heat)', () => {
    for (const f of PLAYER_TEXT) for (const t of strings(f)) {
      if (/^[a-z]+$/.test(t)) continue;
      expect(t, `${f}: ${t}`).not.toMatch(/colour|stylis|armour|wanted level|\bwasted\b/i);
    }
  });
  it('has no GTA-iconic death word', () => {
    expect(readFileSync(new URL('./ui.ts', import.meta.url), 'utf8')).not.toMatch(/'Wasted'/);
  });
});

describe('default bindings', () => {
  it('have no conflicts, no Alt key and Q is free for menu tabs', () => {
    expect(findConflicts(DEFAULT_BINDINGS).size).toBe(0);
    for (const keys of Object.values(DEFAULT_BINDINGS)) { expect(keys).not.toContain('AltLeft'); expect(keys).not.toContain('KeyQ'); }
  });
});
