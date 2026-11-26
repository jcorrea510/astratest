# Gamepad (Round 12)
- Pure: src/core/padGlyphs.ts (family from Gamepad id, labels, PadWatcher), padBindings.ts (per-context button overrides, stored in settings.padBindings), gamepad.ts (setPadOverrides/layoutButtons/padGlyph/padGlyphAll).
- UI: settingsPanel Input tab "Controller Buttons" (mode seg + slot rebind by pressing a pad button), controlsPanel pad column is live + family-named, menus.css .is-pad focus ring, ui.ts ignores pad nav while capturing.
- main.ts installPadWatch: connect/disconnect toast, pause on disconnect when last input was the pad.
- Tests: src/core/padBindings.test.ts, tests/e2e/gamepad12.spec.ts (fake pad via getGamepads override).
- Fixed/left: triggers, sticks, fire/aim stay fixed (not rebindable); menu buttons fixed (A/B/LB/RB/LT/RT).
