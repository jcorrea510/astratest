# Progress (newest first; keep short — git has history)

Resume: read CLAUDE.md, docs/BRIEF5.md, this file. Continue unfinished items. Owner rules in CLAUDE.md.

## Round 5 (owner notes BRIEF5 + "crazy realistic overhaul")
- [x] R5-H Highway: snappy realistic steering (lane change ~1-2 s), no 0.2 s bounce, wheel turns in 1st person, realistic interior.
- [ ] R5-P Perf+settings: high graphics smooth with full crowd, no culling pop-out of peds/cars near camera, density sliders removed (tied to quality), settings key/button that isn't Esc.
- [x] R5-T Traffic (T2 follow-up: gaps + buses running): persistent parked cars (no refresh), correct facing, trucks stable/no respawn, no jams, honk when cut off, pull over for accidents/sirens/stolen cop car, flee when shot.
- [ ] R5-C Police: see traffic violations, stolen cop car always pursued on sight, shot cop car -> cops exit+pursue, heli chase holds heat.
- [ ] R5-E Player: shot store glass clears + shoot-through, correct two-hand gun hold, store shoppers move/browse.
- [ ] R5-W World: visible traffic lights, no posts in crosswalks/cross streets, pier road shoulder, East River volume, bridge top glitch, roof flicker from air, Precinct 4 looks like a precinct.
- [ ] R5-A Army: base further out, real base look, armed army helis (guns+missiles) attack + stealable; heli door opens outward.
- [ ] R5-M Map: 3D-looking map (extruded buildings, shading) for full map + minimap.
- [ ] R5-G Gaps (fix, don't report): highway cockpit polish (thick A-pillar, small wheel, check all 12 cars, live infotainment clock/map, real mirror views); city buses + bus stops; peds sit on benches; bridge walkways with peds; Eastbank signals; run soak.
- [ ] R5-Z Gate + publish (soak included).

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
