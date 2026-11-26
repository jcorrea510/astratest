import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { errorCopy, formatDetails, type BootErrorKind } from './bootError';

const KINDS: BootErrorKind[] = ['no-webgl', 'context-lost', 'load-failed', 'crashed'];

describe('boot error copy', () => {
  it('every kind has a title, a message and a hint, and WebGL failure is not the phone gate wording', () => {
    for (const k of KINDS) { const c = errorCopy(k); expect(c.title.length).toBeGreaterThan(5); expect(c.message.length).toBeGreaterThan(20); expect(c.hint.length).toBeGreaterThan(20); }
    expect(errorCopy('no-webgl').message).not.toMatch(/bigger screen|laptop/i);
    expect(errorCopy('no-webgl').hint).toMatch(/hardware acceleration/i);
    expect(errorCopy('context-lost').title).toMatch(/recovering/i);
  });
  it('formats a copyable report with version, kind, time and the error', () => {
    const t = formatDetails('crashed', new Error('boom'), { ua: 'UA', url: 'https://x/y', when: new Date('2026-11-25T00:00:00Z') });
    expect(t).toMatch(/Meridian Afterglow v/);
    expect(t).toContain('Problem: crashed');
    expect(t).toContain('2026-11-25T00:00:00.000Z');
    expect(t).toContain('Error: Error: boom');
    expect(formatDetails('load-failed', undefined, { ua: 'u', url: 'x' })).toContain('Error: none');
  });
});

describe('boot screens copy', () => {
  it('uses US spelling and Heat wording in the screens and error panels', () => {
    for (const f of ['./screens.ts', './bootError.ts']) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      const strs = [...src.matchAll(/'((?:[^'\\\n]|\\.)+)'|`((?:[^`\\]|\\.)*)`/g)].map(m => m[1] ?? m[2]);
      for (const t of strs) { if (/^[a-z-]+$/.test(t)) continue; expect(t, `${f}: ${t}`).not.toMatch(/colour|tyre|armour|wanted level|\bwanted\b|\bcentre\b/i); }
    }
  });
  it('the phone gate offers Continue anyway and no longer prints the page URL', () => {
    const src = readFileSync(new URL('./screens.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/Continue anyway/);
    expect(src).not.toMatch(/ma-mobile-url/);
  });
});
