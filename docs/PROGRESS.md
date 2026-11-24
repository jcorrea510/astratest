# Progress (newest first; keep short — git has history)

Resume: read CLAUDE.md, docs/BRIEF9.md + docs/ROUND9.md, this file. Continue unfinished items. Owner rules in CLAUDE.md.

## Round 11 (owner notes 24 Nov night) — see docs/ROUND11.md
- All done and published (4218ff6). Flaky under load only: traffic7 taxi job (passes alone). Probes: .perfprobe/.rcpu/.rprof/.memprobe/.redprobe.
- Can't measure the M1 GPU here: owner's FPS readout now shows CPU ms to tell which side limits.

## Round 10 (owner notes 24 Nov): left turns on red, goals panel
- [x] Left turners ran reds: the pedal lags ~2.4 m/s behind a stop curve, so cars rolled over the bar and the "across and
  rolling" rule let them in; amber "go" ignored the slow-down for the turn. Fix: lag-compensated stop (lineStop), stop on
  the zebra if still short of the box, left turners stop on amber (sneak only from the line), cross traffic waits for a car
  crossing the box, gap check sees 90 m + far-crowd cars, no stopping across oncoming lanes. .redprobe.mjs (3 junctions x
  180 s): red entries ~20 -> 0-3 (amber sneaks), crashes 3-11 -> 0-1. Tests: leftTurn10.test.ts.
- [x] Goals panel text overlapped: icon-less lists put the text in the 70 px icon column and the list squeezed rows. CSS fix; e2e goals10.
- [x] Also fixed (were failing before this round): buses arrived rolling and their door never opened; drivers crawl past a
  standing wreck after the 5 s crash stop; traffic6's red-light check used a stale signal cycle (now __meridian.signal).
- Owner asked about an Xcode/iPad build: answered (WKWebView = same WebKit as Safari; Add to Home Screen already works).

## Round 9 (owner notes 23 Nov) — see docs/ROUND9.md (all items done; gate + publish last)
- Junction probe (.jprobe-style, 120 s): grid 14 -> 3 bumps, Broadway 14 -> 7 (then lanes moved past cross streets).
- Known: mid-game shader compiles ~2 per tour (quality switch); Mac M1 fps not measurable here (no GPU).

## Round 8 (owner play-test 22 Nov on iPad + Mac) — see docs/ROUND8.md
- [x] Mac freezes ~1/s: adaptive resolution thrash (resize on every 33 ms crossing) + lights added mid-game (full shader recompile) + sky env rebuilt every 6 s. All fixed with tests.

Older rounds: see git history of this file.
