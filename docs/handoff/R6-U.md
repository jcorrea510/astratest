# R6-U handoff (fullscreen / title / map / iPad+pad / local run) - DONE
- Fullscreen: core/fullscreen.ts (icon btn `.ma-fs-btn`/`.hw-fs-btn`, Esc keyboard-lock, restore on first key/click after quit-reload); menu rows removed.
- Title: new logo (screens.ts), Big Shoulders Display font, left-aligned menu, no italics (ui.css tail block "R6-U").
- Map: live re-extrude while turning, pitch/top-down (T, R/F, RMB-drag, button), Q/E no longer switch pause tabs on the map (PgUp/PgDn do).
- iPad/pad: core/platform.ts (iPad detect, low preset, phones-only gate), core/gamepad.ts (+test), virtual pointer lock in input.ts, ui.setInputSource pad hints. README "Run it locally", `npm run local` (scripts/local.mjs, MA_BASE).
- Tests: src/core/gamepad.test.ts, tests/e2e/r6u.spec.ts (own static preview), game/uimenus/highway specs adjusted.
