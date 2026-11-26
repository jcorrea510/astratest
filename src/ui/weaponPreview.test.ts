import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { shopItemWeapon } from './weaponPreview';
import { WEAPONS } from '../combat/weapons';

describe('shop weapon preview', () => {
  it('maps weapon and ammo shop rows to a weapon model, and nothing else', () => {
    for (const id of Object.keys(WEAPONS)) {
      expect(shopItemWeapon(`w:${id}:pistol`)).toBe(id);
      expect(shopItemWeapon(`a:${id}:pistol`)).toBe(id);
    }
    expect(shopItemWeapon('armor')).toBeNull();
    expect(shopItemWeapon('medkit')).toBeNull();
    expect(shopItemWeapon('car:sedan')).toBeNull();
    expect(shopItemWeapon('w:notAGun:pistol')).toBeNull();
  });
  it('never clamps shop descriptions to one line (no ellipsis truncation)', () => {
    const css = readFileSync(new URL('./menus.css', import.meta.url), 'utf8');
    const rules = css.split('\n').filter(l => l.startsWith('.ma-shop-desc'));
    expect(rules.length).toBeGreaterThan(0);
    for (const r of rules) expect(r).not.toMatch(/line-clamp:\s*[1-9]/);
  });
});
