# Asset research and integration notes

## Verified and downloaded

Official Kenney Git repositories were reachable with platform Git authentication. Direct requests to kenney.nl, quaternius.com and api.github.com returned proxy tunnel 403; avoid interpreting that as missing credentials. Source and CC0 evidence are in CREDITS.md and copied upstream README files.

- City: 4 small buildings, garage, two tree clusters, fountain, tiny palette texture. `public/assets/city/models/`.
- Vehicles: four truck color variants and motorcycle, palette texture; engine/impact/skid audio. `public/assets/vehicles/`.
- Roughly 1 MB total; inspect exact file sizes when pruning unused assets.
- All GLBs reference `Textures/colormap.png` relative to model URL. Preserve these directories. No external runtime requests are required.
- Truck GLBs have named nodes `body`, `underside`, `wheel-back-left`, `wheel-back-right`, `wheel-front-left`, `wheel-front-right`. They support wheel rotation/steering, squash/damage displacement and instanced cloning; no animation clips.
- Palette materials can be reworked for apricot/teal direction while retaining original model geometry.

## Human assets

Kenney Starter-Kit-3D-Platformer commit `3fa8a04b1c01ab23db43123d4ce814a34c3fc7f0` has a CC0 87 KB character with static/idle/walk/jump animation clips. Inspection revealed an antenna/robot design, so it was deliberately NOT added: it does not meet the human requirement. No suitable licensed human asset has yet been verified. Procedural articulated humans remain a viable original-art path, but must be reviewed visually and animated carefully.

## Integration acceptance

Before shipping any included model: load it through GLTFLoader at the production subpath; verify texture requests; inspect bounds/orientation and human/car scale; review screenshots; count mesh/material draws; merge static geometry or instance repeated props; remove unused source assets. Vehicles need actual differentiated handling and visible damage independent of model choice. City assets alone do not establish a finished district.

## Gunshot recordings (Round 9, R9-S)
Real recorded gunshots replace the synthesised shots (synth stays as fallback: `src/audio/gunsynth.ts`, used when a sample fails to load or for tests).
- Sources (raw.githubusercontent.com, the only reachable host; freesound itself is blocked here so each file's CC0 status rests on these repos' per-file credit tables, which cite the freesound page and author; both repos are MIT and list every file as CC0 1.0):
  - `webdevcody/survive-the-night-fps/main/client/audio/samples/gun_{pistol,shotgun,dbshotgun,ak47,m4a1,mp5,rifle,far}.ogg`, multi-take sprites; slice table in its `samples.js` (copied into `scripts/bake-gun-samples.sh`).
  - `ryno4ever16/cp2020-augmented/main/sounds/{shot-pistol,shot-smg,shot-rifle,shot-shotgun-alt,shot-heavy,rocket-launch}.ogg` (freesound pages: michorvath 427592/427598/427595, qubodup 182051, ajhartman42295 668071, Jarusca 521377).
- Original freesound authors and ids per take group: see CREDITS.md. Checked: all are recordings (spectra/decays of real shots), none synthetic.
- Baked set (42 files, ~640 KB, mono mp3 ~80 kbps, 44.1 kHz; distant `far_*` 32 kHz): pistol(4) magnum(3, derived: pistol pitched down) smg(7) ar(5) ak(5) shotgun(4) dbshotgun(3) sniper(3)+heavy(.50)(1) far(6) rocket(1). Rebuild: download the files above to `<dir>/wd` and `<dir>/cp`, run `scripts/bake-gun-samples.sh <dir>`.
- Mapping per weapon sound: `GUN_SETS` in `src/audio/gunSamples.ts` (class takes + playback-rate/gain trim; distant set re-pitched per class). Playback in `src/audio/sfx.ts` (`gunshot`), loaded in `src/audio/audio.ts` (fetch at Audio construction, decode once the context exists).
- Gaps: no real silenced, magnum or RPG recordings were available (magnum is derived; RPG/launcher use a rocket launch recording). Suppressed weapons would need a recording (none exist in WEAPONS today).
