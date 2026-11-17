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
