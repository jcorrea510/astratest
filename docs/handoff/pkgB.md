# pkgB handoff (menus/settings/copy)
- Settings fields (core/settings.ts, read with `?? default`): padSensitivity, padDeadzone, padInvertY, vibration, adsSensitivity, speedBlur, reduceMotion, colorblind, uiScale, resolutionScale, fpsCap, ambienceVolume, voiceVolume, uiVolume (legacy master/music/sfx unchanged).
- UI scale: `--ma-ui-scale` on <html> (multiplies --u). Also `data-colorblind` and `data-reduce-motion` on <html>.
- resolutionScale/fpsCap: exposed only; renderer owner wires them.
- Version: package.json -> build.ts (VERSION_LABEL for menus, BUILD with hash only in Settings About + FPS counter).
- Menu sounds: ui.ts sound() calls uiSound(); main.ts must registerUiAudio(audio), call audio.applyChannelSettings(s) in onSettingsChanged; onUiSound is now unused.
- Defaults: dodge = C only, wheel = Tab/Z (old saved defaults migrate). Death word = Flatlined. Mode = "Free Roam", pause tab "Tools", no HUD badge.
