Let me know right now if you need anything. If you don’t tell me right now then do not pause for any questions you need to figure it out. I'm asleep until morning, so this job is yours end to end. You're in the AstroTest repo and cloud environment, which is new and empty.

## Goal
Build a complete, polished, playable 3D open-world action game in the style of the GTA series. It runs in the browser and is hosted on GitHub Pages from this repo.

Everything in it must be original: an invented city, invented brands, names and characters, your own UI. GTA is the genre reference only. Copy none of its names, logos, characters, music, map or HUD. Keep the tone around a Teen rating: stylized action, no gore, no sexual content.

## What the game needs
- On foot: responsive third-person movement, a smooth camera that never clips through walls, over-the-shoulder aiming.
- Driving: get in and out of any vehicle. Weighty, fun handling with a handbrake, collisions and visible damage. Several vehicle types that drive differently. Traffic that follows lanes and signals and reacts to you.
- Shooting: melee plus several guns that each feel distinct, with ammo, recoil and hit reactions. Enemies who fight back intelligently. Health and armor.
- Inventory wheel: hold a key to open a radial weapon and item wheel that slows time.
- People: the player, pedestrians and enemies look and move like people, with varied bodies and outfits and smoothly blended animation. No T-poses, sliding feet or popping. They react to danger, to cars and to you.
- City: a compact fictional city, about a two-minute drive across, with distinct districts, props, signage, a day-night cycle with working street and car lights, and ambient sound.
- Police heat: crimes raise a heat level, the response escalates, and you can lose it.
- Things to do: about five missions that each play differently, free roam that's fun by itself, money and somewhere to spend it.
- Menus and HUD: title screen, pause menu, settings (graphics quality, sensitivity, volume, key rebinding), a HUD with minimap, controls help, autosave, loading screen.

Not needed: multiplayer, voice acting, building interiors, aircraft, boats, a huge map.

## The bar
Quality over quantity. When they conflict: no bugs first, then look and feel, then amount of content. I'd much rather have a small, dense city where everything feels great than a big one with rough edges. Go deep before wide: get one block, one car, one gun and one pedestrian looking and playing well, then expand. Cut a feature only as a last resort, cut it cleanly, and tell me. Never ship anything rough or half-finished.

It has to look very good. Pick one cohesive art direction and carry it through lighting, shadows, atmosphere, post-processing, materials, animation, UI and type. Stylized and consistent beats realistic and uneven. No placeholder boxes or capsules in the finished game. Add the touches that make it feel finished: particles, tire marks, muzzle flash, camera shake, a sound for every action. Judge it from real screenshots at several times of day and keep iterating until any of them could go on a store page.

If you have internet access, use high-quality CC0 or public-domain models, animations, textures and audio (Kenney, Quaternius, KayKit, Poly Haven and ambientCG are good sources) and log each one's source and license in CREDITS.md. Use nothing with an unclear license. If you can't download assets, build stylized models and animation in code to the same standard.

Target desktop Chrome, Safari and Firefox with keyboard and mouse, plus gamepad, at 60 fps on an M1 MacBook Air. You can't test on that machine, so set budgets (draw calls, triangles, texture memory, frame time) that make it safe, and offer quality presets. Keep the download lean and show loading progress. Touch controls are a stretch goal. Without them, phones get a clean "play this on a computer" screen, not a broken game.

The stack is your call. GitHub Pages only serves static files, so this is a client-side web game. A code-first WebGL engine such as Three.js or Babylon.js with a real physics engine is the obvious fit.

## Permissions
You're authorized to do anything this needs in this repo and environment without asking: create and delete files, install packages, download assets, run servers and browsers, commit, push, add branches and workflows, change repository settings, turn on GitHub Pages, and make the repo public if Pages requires it. If the environment blocks something (no network, no push rights, no access to settings), don't stop. Work around it, finish everything else, and leave me the shortest possible list of manual steps.

## Working through the night
Don't ask me questions or wait for approval. I won't see them. Where something is unclear, make the call a careful game director would, note it, and keep going. This message outranks any skill or default guidance that would have you pause.

You can be cut off at any moment by a usage limit, a timeout or a context reset, so keep the work resumable:
- First, save this whole message word for word as docs/BRIEF.md, write a milestone plan with acceptance checks in docs/PLAN.md, and write a short AGENTS.md with the run, test and build commands and these resume rules.
- Keep docs/PROGRESS.md current: done, in progress, next, decisions, known issues. Update it at every milestone and before any long step.
- Commit every working increment, and push if you can. Every commit should build and run.
- Whenever you start or resume, including when all I say is "continue", read BRIEF.md and PROGRESS.md and carry on from the first unfinished item. Never start over.
- If a usage limit stops you, pick up again as soon as it resets, as many times as it takes. Right now, set up whatever you have that makes this happen without me (a scheduled follow-up in this chat, a goal, an automation), and remove it when you're finished.

Keep going until everything under "Done when" is true. Don't stop at a good-enough version to save time or usage. If you can use subagents, use them for work that splits cleanly and for a fresh-eyes playtest and code review before you call it done.

## No bugs
You're the QA team. I won't be testing this for you. Prove it works by playing it, not by reading the code.
- Automated tests for game logic, plus headless-browser tests that play the game with scripted input: new game, walk, take a car, drive, crash, shoot, use the wheel, gain and lose heat, finish every mission, die and respawn, save, reload, change settings.
- Look at the screenshots from those runs yourself and fix anything that looks wrong or cheap.
- A soak run: 15+ minutes of scripted chaos with no errors, stuck states, falling through the world or steady memory growth.
- No console errors or warnings, no failed requests, clean lint, typecheck and build.
- Test the production build served from the subpath Pages will use (/<repo-name>/), where asset paths usually break.
- After the last feature, run full bug-bash passes and keep fixing until two passes in a row find nothing. Fix root causes and add a test for each bug.

## Done when
- The game is live at this repo's GitHub Pages URL and redeploys automatically, ideally through a GitHub Actions workflow that runs the tests first. If you couldn't push or change settings, everything is committed and my only steps are the ones you list.
- Every feature above is in, feels good and has passed the checks, or was cut and is listed.
- A new player can open the URL and play through every mission with no help from me.
- README.md covers the game, the controls, and how to run, test and deploy it. CREDITS.md lists every third-party asset.
- Your final message gives me the URL, what's in the game, what you cut and why, the evidence (test counts, soak results, screenshots), known issues, and any manual steps left. Be straight: if something isn't finished or wasn't verified, say so.
