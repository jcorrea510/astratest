# Plan and acceptance gates
1. Foundation: Vite/TypeScript/Three.js/Rapier, reproducible install, run/build/check commands, title and loading shell. Gate: build, typecheck, baseline tests and browser render.
2. Vertical slice: art-directed one-block environment, articulated animated human, third-person collision-aware camera, physical car and one weapon. Gate: real browser walk/enter/drive/crash/aim/fire and screenshots.
3. World and simulation: districts, traffic/signals, varied vehicles and people, combat, inventory, police and day/night audio/lighting. Gate: scripted feature checks, bounded rendering budgets and screenshots across time.
4. Complete game: five distinct missions, economy/shop, progression, HUD/minimap, settings/rebinding/gamepad, saves and respawn, desktop-only mobile screen. Gate: complete each mission and reload progression via browser tests.
5. Polish and QA: lint/typecheck/build/unit/e2e, production /astratest/ verification, 15-minute soak, fresh-eyes review/playtest, two clean bug-bash passes after last fix. Gate: documented evidence, reviewed screenshots, no unexplained console/network failures.
6. Release: README/CREDITS, CI and Pages workflow, push and deploy, live verification. Gate: verified live URL or concrete access blocker with minimal manual steps; disclose all cuts and unverified targets.

Direction: original coastal city “Port Meridian”; game “Meridian Afterglow”. Warm apricot sunlight, cool teal shadows, muted clay architecture, luminous cyan/amber navigation, editorial typography. Dense stylized diorama with human-scale detail. Target <=200 draw calls, <=250k visible triangles, <=64 MiB textures, bounded entity/particle pools; low/medium/high presets. These are targets until measured.
