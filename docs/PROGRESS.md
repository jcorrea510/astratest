# Progress (newest first; keep short — git has history)

Resume: read CLAUDE.md, docs/BRIEF6.md, this file. Continue unfinished items. Owner rules in CLAUDE.md.

## Round 6 (BRIEF6 quality pass; started 12:15 UTC 20 Nov; work until done, then publish + owner summary)
Handoffs: docs/handoff/R6-*.md (each agent keeps its own <=8 lines current). Waves of <=4 agents. Ports: own 52xx per agent.
- [x] R6-V (+V2 near cars/peds always real within 20 m; vanish e2e: base 10 → 0) (Opus) vanishing + LOD + perf: near peds/cars/bus never vanish, no boxy cars/Minecraft peds up close, high playable, car shadow lag/shadow glitch. Uses R5-P2 WIP 975ebd9.
- [x] R6-K (+follow-up: all guns drive-by, window roll-down, reach-in prompt) car entry: parked/curb theft drivable, no feet through floor, shot-out window = no re-break, hold RMB in car = aim/shoot held weapon.
- [x] R6-T traffic AI: obey lights/signs, no stopping mid-road, all cars drive regardless of distance to player, more moving than parked, realistic flow.
- [x] R6-C police/air: taser arrest (no shooting own arrest, no killing arresting cop), react to drawn gun, 3-star always pursue, no SWAT/heli spawning on top (arrive from distance), police heli = spotter only, army heli realistic accuracy, sandbox ignore-police at army base.
- [x] R6-P peds (wave 2): crosswalk walk signals, no jaywalking, no phantom collision/stumble anims, fight back when punched, hands-up pose natural + flee after shots.
- [x] R6-M (game.spec/tour.spec full runs → R6-Z) modes (wave 2): Regular (earn money, no cheats; death = medical bill + lose inventory; buy guns/cars) vs Sandbox; no spawn holding gun; purpose loop (net worth, car showroom/garage goals).
- [x] R6-D driving feel (wave 2): city steering quicker at speed, drift less endless, highway lane change fast.
- [x] R6-S stores (wave 2): distinct store types (convenience, jewelry, bank, liquor, pawn...), physical register robbing, staff/shopper reactions, KO workers with fists, glass bullet holes cleared, windshield holes in sky.
- [ ] R6-F (restarted 22:2x after limit) combat extras (wave 3): orders (hold B: kneel/come here), grab/hostage/kidnap into car, blood, hit feedback when shot.
- [ ] R6-X physics (wave 3): hit peds ride the hood/ragdoll, car body crumple, light posts knock over, molotov fire.
- [ ] R6-A audio (wave 3): gunshots = loud pops, more ambient/vehicle sounds, stop random popping in city.
- [x] R6-U (+shell iframe keeps fullscreen across reloads: shellfs.spec) UI (wave 3): fullscreen persists (highway<->city, menus) + top-right button, front page/title not AI-looking, Play vs Continue clear, map Q/E live rotate + top-down toggle + E-opens-sandbox bug, iPad keyboard/mouse/gamepad, README run-locally.
- [ ] R6-B barber + clothing stores with map icons (wave 3). R6-W world: subway rails end, park blue slab with benches, one-hand gun left-hand lag.
- [ ] R6-Z (also: find the one-off 1285 off-crosswalk peds run + restore a "some peds crossed" assertion in pedsr6p; flaky ped screenshot test; far-car spawn right behind a stopped real car; buses.test flake) full e2e + soak + publish + owner summary.

## Round 5 (owner notes BRIEF5 + "crazy realistic overhaul")
- [x] R5-H Highway: snappy realistic steering (lane change ~1-2 s), no 0.2 s bounce, wheel turns in 1st person, realistic interior.
- [x] R5-P Perf+settings (P2 queued for quiet machine: car tri budget ~13k/car -> real LODs, far-ped impostors, instanced parked cars, clean ms/frame before/after on high, rerun uimenus Sandbox/Esc + gear/P e2e): high graphics smooth with full crowd, no culling pop-out of peds/cars near camera, density sliders removed (tied to quality), settings key/button that isn't Esc.
- [x] R5-T Traffic (+T2: siren yield far cars, gunfire targeting, gridlock cycle fix, green-wave offsets, city buses; flow 4.3 m/s avg ≈ real Midtown): persistent parked cars (no refresh), correct facing, trucks stable/no respawn, no jams, honk when cut off, pull over for accidents/sirens/stolen cop car, flee when shot.
- [x] R5-C Police (+C2: shopper-removal crash fixed, convoy test on new gate, shoot-out verified visually): see traffic violations, stolen cop car always pursued on sight, shot cop car -> cops exit+pursue, heli chase holds heat.
- [x] R5-E Player (+E2: walk through broken panes, NPC IK gun hold, finger curl + trigger finger): shot store glass clears + shoot-through, correct two-hand gun hold, store shoppers move/browse.
- [x] R5-W World (W2 done: pier shoulder exact, denser quay, re-shoots, real precinct cars, bridge walkways, Eastbank signals): visible traffic lights, no posts in crosswalks/cross streets, pier road shoulder, East River volume, bridge top glitch, roof flicker from air, Precinct 4 looks like a precinct.
- [x] R5-A Army (+A2 far LOD, guards, shed roof, sandbox gunship, heli seat teleport fix; A3: flash whiteout bug fixed, smoke+debris, charred wreck): base further out, real base look, armed army helis (guns+missiles) attack + stealable; heli door opens outward.
- [x] R5-M Map (+M2 declutter, collapsible legend, cached pan layer): 3D-looking map (extruded buildings, shading) for full map + minimap.
- [x] R5-G Gaps: highway cockpit rebuilt, buses, bus boarding, bench sitting, peds on bridge walkways; Eastbank signals; run soak.
- [x] R5-Z Published gh-pages 54c2e6a (main 4756ba8) 01:2x UTC 20 Nov: tsc, vitest 298/298, game.spec boot. Full e2e + soak not run.
- [ ] R5-P2 perf (car LODs, instanced parked cars, benchmark) — stopped mid-way at owner's usage limit; partial uncommitted-to-main edits in WIP commit, unverified.

## Round 4 (hyper-realism night, 02:40-12:00 UTC)
- [x] R4-A Driving (no steering retune done: owner still says hard to turn — retune keyboard steering in R4-R): car jitter fwd/back, curbs, easier turns+drift, stolen cop car siren J/K/L + lights key, windshield shatter, bridge camera stutter.
- [x] R4-C City (26329e3; bigger-city extension NOT done — later wave): core grid far less boxy (realistic Manhattan blocks), two-lane roads each way, bigger, shootable store windows.
- [x] R4-D Police (population.ts + actions.ts parts uncommitted, shared; police.spec 3/6 unconfirmed): realistic heat (stars harder, response delay, witnesses/911), army only from Fort Calder at 5 stars, perf with many cops (M1), better handcuffing, peds react to player-as-cop.
- [x] R4-E Player (6697b61): gun held in aim pose while shooting (still broken), faster car entry, physical carjack throw (hands on victim), heli entry anim, better robbing (shoot clerk then rob till), shoppers react.
- [x] R4-F Highway mode (title entry: infinite realistic highway, AI lane changes with signals, cut-offs, 1st/3rd person, high fps) + US units + fullscreen button.
- [x] R4-B Density (game.ts/vehicle.ts hooks uncommitted, shared): Manhattan-level traffic and pedestrians, perf on M1 (instancing/LOD).
- [x] R4-M Manhattan island (2776860): tapered island, west river + 5 bridges, Broadway + Flatiron, map tilt 29deg. East river + Eastbank done 454e78f.
- [x] R4-R Realism audit (mechanics/backend ultra-realistic too): agent screenshots/plays, lists what's still cartoony, fix waves.
- [x] R4-Z Gate + publish: gh-pages 178c6ea (370f507) 11:12 UTC. Gate green (combat3 needs --workers=1 on 4 cores); soak not run.
Round 4 complete. Next round: owner notes; known gaps in final report (no bus, bench sit, bridge walkways, Eastbank signals, highway mirrors/wheel spin).

## Done
- Round 3 published 02:06 UTC 19 Nov (gh-pages b43553e). Round 2 (BRIEF2) 18 Nov.
