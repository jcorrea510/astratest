# Round 11 plan (BRIEF11) — overnight; 3 a.m. check-ins fired (08:00 + 11:00 UTC)

- [x] P  Performance (lead). CPU: people culled off screen, hidden subtrees skip matrix updates, grid nearestLane.
      GPU: light pool (14 always-on point lights -> 2/4/8), tone map + grade one pass, Medium shadows every other frame,
      no bloom in daylight, adaptive resolution below native under 45 fps. Memory: static vertex arrays freed after
      upload (heap 990 -> 270 MB), street-dressing vertices 60 -> 32 bytes. FPS readout shows CPU ms (tell CPU- from GPU-bound on the Mac).
- [x] T  Zero AI traffic crashes (lead): accelerating-gap rule, first-at-line cars may go, opposing left turner holds the
      box, kerb shift measured from the lane line (it settled at half: wide cars scraped parked vans). .redprobe.mjs: 0 crashes. Soak: 0 runtime issues, no heap growth.
- [x] H  HUD redesign (R11-H, merged): src/ui/hud.css glass language; mission card, death card, stars, speedo, toasts.
- [x] M  Menus redesign (R11-M, merged): src/ui/menus.css; pause header (no clipped logo), store list + detail pane with stats.
- [x] X  Xcode iPad app (R11-X, merged): ios/, ios.yml CI builds an unsigned .ipa (passes on macos-latest), docs/IOS.md.
- [ ] Z  Gate, publish gh-pages + main (main push publishes the ios-latest release), summary for the owner.
