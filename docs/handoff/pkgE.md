# pkgE audio + save (done)
- src/audio/mixer.ts: pure channel gains, DuckState, UI recipes; core.ts wires hideGain/duckMusic/duckAmb/voiceIn + setChannelVolume/playUi/setHidden.
- audio.ts: setChannelVolume(ch,v), applyChannelSettings(settings), ui(name), visibility suspend/fade (bound on first resume).
- uiSounds.ts: registerUiAudio(audio) once; menus import uiSound('select').
- save.ts v3: vehicle (parseVehicle/vehicleSpawn), playSeconds, slots (readSave/writeSave slot arg), onSaved/lastSaved.
- Remaining (other packages): main.ts must fill SaveData.vehicle on save and spawn via vehicleSpawn on load.
