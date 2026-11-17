# Credits and licenses

Meridian Afterglow, Port Meridian, its characters, story, brands, interface and custom code/art direction are original to this project.

## Third-party art and audio

The files below are included in the repository. Inclusion does not mean all are rendered in the final game; remove unused assets before release.

| Local files | Author / source | License |
| --- | --- | --- |
| `public/assets/city/models/*.glb` and `models/Textures/colormap.png` | Kenney, [Starter Kit City Builder](https://github.com/KenneyNL/Starter-Kit-City-Builder), commit `4535092b740b378b700efd9df9e27a631815b84a` | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/assets/vehicles/models/*.glb` and `models/Textures/colormap.png` | Kenney, [Starter Kit Racing](https://github.com/KenneyNL/Starter-Kit-Racing), commit `2f2e5f2646dda89cb21d4e8539bab60c6e955dc8` | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) |
| `public/assets/vehicles/audio/engine.ogg`, `engine-motorcycle.ogg`, `impact.ogg` | Kenney, Starter Kit Racing (same source/commit) | CC0 1.0 |
| `public/assets/vehicles/audio/skid.ogg` | [Landeplage](https://github.com/Landeplage), distributed in Kenney Starter Kit Racing (same source/commit) | CC0 1.0 |

The official source README explicitly licenses included sprites, models and sound effects as CC0; the racing README separately confirms the skid effect is CC0. Copies are retained alongside assets as `SOURCE-README.md`. Those READMEs describe the upstream Godot kits, not this game. No upstream game code is copied. CC0 does not require attribution; it is provided for traceability.

## Libraries

Dependency versions and transitive licenses are recorded in `package-lock.json` and package distributions. Three.js (MIT), Rapier (Apache-2.0), Vite (MIT), TypeScript (Apache-2.0), Vitest (MIT), Playwright (Apache-2.0) and ESLint (MIT) support development/runtime as applicable. Verify this list against the final manifest before release.
