# hudperf handoff
- Money string cached by rounded value (`MoneyText` in ui/geometry.ts); hud.ts only formats when the value changes.
- Minimap: redraw every 66 ms (`MINIMAP_INTERVAL_MS`), tone+vignette pre-rendered once per size into an overlay canvas (no per-frame gradient/fillRect).
- `ui.minimapWanted()` lets main.ts skip building MinimapState (blips, GPS) on frames where no redraw is due (menus: 250 ms refresh of lastMinimap).
- Money delta animation restarts via rAF instead of a forced layout (`offsetWidth`).
- Tests: src/ui/hudCache.test.ts. Probe numbers (swiftshader, us/frame): hud 29 -> 3-5, minimap 56 -> ~20, state build 8-17 -> ~3 avg.
