# Progress (newest first; keep short — git has history)

Resume: read CLAUDE.md, docs/BRIEF3.md, this file. Continue unfinished items. Owner rules in CLAUDE.md.

## Round 3 (owner playtest, 19 Nov) — status
- [ ] R3-A Combat/death: trails persist, dead cops upright, hit-zone death falls, gun lowered while firing, rocket launcher, lag near cops.
- [x] R3-B Police/people (verify FPS with 90 peds; heli shot down fast — tune Dispatch.attackHeli): remove NPC voices, many more NPCs, smart realistic cops (guns not fists), heli theft = stars + shot down, spotlight dim.
- [x] R3-C Visuals (lamp tweak in game.ts uncommitted until others finish): invisible car bodies, headlights/lights, night brighter, helicopter all-glass.
- [x] R3-D City (gaps: one-way roundabout, west sidewalks/signs/props, cathedral roof check): bigger, curves/character, ~10x walk-in robbable stores, GPS over bridge.
- [x] R3-E UI: realistic weapon wheel + gun icons, settings close button (Esc breaks), Continue on rooftop breaks.
- [ ] R3-Z Full gate, publish.
Running (Sonnet, 23:30 UTC): A adb0a121e53dbc94f, B a49b7fa1bd116d640, C a97c7eebff869bd25, E aa9f94672af96bc41, D a8674013a05f7425c. Resume stopped ones via SendMessage.

## Done before
- Overnight brief (BRIEF2) delivered and live 18 Nov 23:15 UTC (gh-pages 3cd57c4 from main 20e0f25): realistic cars/people/city,
  combat, car entry, helicopters, police escalation, sandbox-only menus, memory fix (soak 327->318 MB).
