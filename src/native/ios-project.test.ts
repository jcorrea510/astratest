import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

// Sanity checks for the hand-written Xcode project (nothing here can run Xcode, so catch typos locally).
const root = 'ios/MeridianAfterglow.xcodeproj';
const pbx = readFileSync(`${root}/project.pbxproj`, 'utf8');
const ID = /\b[0-9A-F]{24}\b/g;

/** Object IDs defined at two-tab indent: "ID (comment) = " (the top level of `objects`). */
function definedIds(): string[] {
  return [...pbx.matchAll(/^\t\t([0-9A-F]{24})(?: \/\*[^*]*\*\/)? = /gm)].map(m => m[1]);
}

/** Minimal well-formedness check: balanced, properly nested tags (comments, doctype, declarations and self-closing skipped). */
function checkXml(src: string): void {
  const stack: string[] = [];
  const body = src.replace(/<\?[\s\S]*?\?>/g, '').replace(/<!--[\s\S]*?-->/g, '').replace(/<!DOCTYPE[^>]*>/g, '');
  for (const m of body.matchAll(/<(\/?)([A-Za-z][\w.-]*)([^>]*?)(\/?)>/g)) {
    if (m[4] === '/') continue;
    if (m[1] === '/') expect(stack.pop(), `closing </${m[2]}>`).toBe(m[2]);
    else stack.push(m[2]);
  }
  expect(stack).toEqual([]);
}

describe('ios project', () => {
  it('has balanced braces and parens', () => {
    for (const [o, c] of [['{', '}'], ['(', ')']]) {
      expect(pbx.split(o).length, `${o}${c}`).toBe(pbx.split(c).length);
    }
  });

  it('defines every object ID exactly once and references only defined IDs', () => {
    const defs = definedIds();
    expect(new Set(defs).size).toBe(defs.length);
    const root = pbx.match(/rootObject = ([0-9A-F]{24})/)![1];
    expect(defs).toContain(root);
    const all = new Set(defs);
    for (const id of pbx.match(ID)!) expect(all.has(id), `undefined ID ${id}`).toBe(true);
  });

  it('build files point at file references and live in a build phase', () => {
    for (const m of pbx.matchAll(/^\t\t([0-9A-F]{24}) [^=]*= \{isa = PBXBuildFile; fileRef = ([0-9A-F]{24})/gm)) {
      expect(pbx).toMatch(new RegExp(`^\\t\\t${m[2]}[^=]*= \\{isa = PBXFileReference`, 'm'));
      const uses = pbx.match(new RegExp(`^\\t\\t\\t\\t${m[1]}\\b`, 'gm')) ?? [];
      expect(uses.length, `build file ${m[1]} used in a phase`).toBe(1);
    }
  });

  it('bundles the game folder reference as a resource and checks index.html', () => {
    expect(pbx).toMatch(/lastKnownFileType = folder; path = game;/);
    const res = pbx.match(/PBXResourcesBuildPhase section \*\/([\s\S]*?)End PBXResourcesBuildPhase/)![1];
    expect(res).toMatch(/game in Resources/);
    expect(pbx).toMatch(/PBXShellScriptBuildPhase/);
    expect(pbx).toMatch(/game\/index\.html/);
  });

  it('has the required settings', () => {
    for (const s of ['TARGETED_DEVICE_FAMILY = 2', 'IPHONEOS_DEPLOYMENT_TARGET = 16.0', 'SWIFT_VERSION = 5.0', 'GENERATE_INFOPLIST_FILE = NO',
      'INFOPLIST_FILE = MeridianAfterglow/Info.plist', 'ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon', 'CODE_SIGN_STYLE = Automatic',
      'PRODUCT_BUNDLE_IDENTIFIER = com.meridianafterglow.game']) expect(pbx).toContain(s);
  });

  it('lists only source files that exist', () => {
    for (const f of ['AppDelegate.swift', 'GameViewController.swift', 'GameSchemeHandler.swift', 'Info.plist', 'game/README.md',
      'Assets.xcassets/AppIcon.appiconset/icon-1024.png']) {
      expect(existsSync(`ios/MeridianAfterglow/${f}`), f).toBe(true);
    }
  });

  it('plist, scheme and asset JSON are well-formed', () => {
    const plist = readFileSync('ios/MeridianAfterglow/Info.plist', 'utf8');
    checkXml(plist);
    expect(plist).toContain('UIRequiresFullScreen');
    checkXml(readFileSync(`${root}/xcshareddata/xcschemes/MeridianAfterglow.xcscheme`, 'utf8'));
    for (const j of ['Assets.xcassets/Contents.json', 'Assets.xcassets/AppIcon.appiconset/Contents.json', 'Assets.xcassets/LaunchBlack.colorset/Contents.json']) {
      expect(() => JSON.parse(readFileSync(`ios/MeridianAfterglow/${j}`, 'utf8')), j).not.toThrow();
    }
  });
});
