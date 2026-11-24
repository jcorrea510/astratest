# Round 11 plan (BRIEF11) — overnight; 3 a.m. check-ins scheduled (08:00 + 11:00 UTC)

- [ ] P  Performance (lead): Medium/High smooth on an M1 Air. SwiftShader frame time = GPU-cost proxy (.perfprobe.mjs).
- [ ] T  Zero AI traffic crashes (lead): .redprobe.mjs over many junctions -> 0; zero page errors in a long soak.
- [ ] H  HUD redesign (agent R11-H, worktree): src/ui/hud.ts + new src/ui/hud.css. Real-game look; fix blank mission card.
- [ ] M  Menus redesign (agent R11-M, worktree): pause/title/settings/shop/garage/groom/sandbox/controls/map chrome; fix clipped logo over pause tabs.
- [ ] X  Xcode iPad app (agent R11-X, worktree): ios/ WKWebView app (app://game/), unsigned IPA via macOS CI, docs/IOS.md.
- [ ] Z  Gate, publish gh-pages, summary for the owner.
