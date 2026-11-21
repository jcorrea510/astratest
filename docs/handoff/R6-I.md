# R6-I handoff (PWA + iPad input) - DONE
- PWA: public/manifest.webmanifest, public/sw.js (stamped per build by vite.config.ts plugin), public/icons/* (scripts/make-icons.py), src/pwa.ts (guarded registration), shell.ts skips iframe when standalone, iOS meta in index.html, safe-area/no-zoom CSS (style.css, ui.css tail).
- Pad: PAD_LAYOUTS foot/car/heli in core/gamepad.ts; Input.padContext set in game.frame; PAD_HELP rewritten (controlsPanel.ts).
- Tests: gamepad.test.ts, pwa.test.ts, tests/e2e/r6i.spec.ts (port 5221 static build).
