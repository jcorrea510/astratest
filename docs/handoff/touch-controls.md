# touch-controls handoff
- New: src/ui/touch.ts (DOM), touchLayout.ts (pure layout + stick maths), touch.css; mounted in the HUD layer from main.ts play(), synced each frame (foot / car / heli sets).
- Input (src/core/input.ts): setTouchAction / setTouchMove / addLook; a sub-frame tap still reads as held+justPressed for one frame.
- Shown on (pointer: coarse) or after a finger touch; ?touch=1 forces it (tests). Mouse click hides it on non-coarse screens. Gear is hidden while touch is on (PAUSE/MAP buttons top-left).
- Tests: touchLayout.test.ts, inputTouch.test.ts, tests/e2e/touch11.spec.ts (port 5307).
- Done later: touch prompt labels (touchPromptFor), key-bindings note on touch, shop tap-to-select then tap-to-buy, heli + menu e2e (touch11b.spec.ts). Open: no touch look-sensitivity setting.
