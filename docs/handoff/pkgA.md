# pkgA handoff (boot / resilience)
- ui/bootError.ts + boot.css: showBootError(kind: no-webgl|context-lost|load-failed|crashed) (Retry/Copy details/version); main.ts installResilience (context lost/restored, g.onCrash); game.ts frame loop wrapped by game/loopGuard.ts (30 consecutive throws => stop + crash screen).
- index.html: inline dark first paint + CSS splash + noscript. Phone gate: "Best on a computer or iPad", Continue anyway sets localStorage meridian-afterglow.mobileOk.
- quitToTitle() resets in place (main.ts); not reset: ambient peds/traffic, cars you left parked, looted stores. Reload fallback only if the reset throws. Taxi ride in progress is not explicitly cancelled.
- Save v3 written by main.ts: vehicle (last driven/current car), playSeconds; restoreVehicle() on Continue. Autosave/manual save emit through save.ts onSaved (HUD agent subscribes).
- registerUiAudio + audio.applyChannelSettings wired in bootWorld/applySettings; onUiSound callback is a no-op.
- Tests: tests/e2e/boot.spec.ts, bootquit.spec.ts; units loopGuard/bootError/saveVehicle.
- Item 20 (death/arrest real-time pass) was not run: see final report.
