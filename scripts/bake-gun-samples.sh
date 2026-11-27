#!/usr/bin/env bash
# Bakes public/assets/audio/guns/*.mp3 from the CC0 source recordings (see CREDITS.md / docs/ASSETS.md).
# Usage: scripts/bake-gun-samples.sh <dir with wd/*.ogg and cp/*.ogg>  (downloaded from the raw.githubusercontent.com URLs in docs/ASSETS.md)
set -euo pipefail
SRC="${1:?source dir}"; OUT="$(dirname "$0")/../public/assets/audio/guns"; mkdir -p "$OUT"
# cut NAME SRCFILE START DUR [extra filters] [samplerate]: mono, 30 Hz high-pass, peak-normalised to -1 dBFS, 20 ms fade-out, mp3 ~80 kbps
cut() {
  local name="$1" src="$2" ss="$3" dur="$4" extra="${5:-}" sr="${6:-44100}" tmp; tmp="$(mktemp --suffix=.wav)"
  local f="highpass=f=30${extra:+,$extra},afade=t=out:st=$(awk "BEGIN{print $dur-0.02}"):d=0.02"
  ffmpeg -v error -y -ss "$ss" -t "$dur" -i "$src" -ac 1 -ar "$sr" -af "$f" "$tmp"
  local peak; peak=$(ffmpeg -hide_banner -i "$tmp" -af volumedetect -f null - 2>&1 | sed -n 's/.*max_volume: \(-\?[0-9.]*\) dB.*/\1/p')
  ffmpeg -v error -y -i "$tmp" -af "volume=$(awk "BEGIN{print -1-($peak)}")dB" -c:a libmp3lame -b:a 80k "$OUT/$name.mp3"; rm -f "$tmp"
}
W="$SRC/wd"; C="$SRC/cp"
# survive-the-night-fps multi-take sprites (slice tables from its client/audio/samples.js)
i=1; for s in "0 1.28" "1.34 1.2" "2.6 1.2"; do set -- $s; cut pistol_$i "$W/gun_pistol.ogg" $1 $2; i=$((i+1)); done
cut pistol_4 "$C/shot-pistol.ogg" 0 1.4 "silenceremove=start_periods=1:start_threshold=-40dB"
i=1; for s in "0 1.26" "1.32 1.149" "2.53 1.6"; do set -- $s; cut shotgun_$i "$W/gun_shotgun.ogg" $1 $2; i=$((i+1)); done
cut shotgun_4 "$C/shot-shotgun-alt.ogg" 0 1.5 "silenceremove=start_periods=1:start_threshold=-40dB"
i=1; for s in "0 2" "2.06 1.8" "3.92 1.54"; do set -- $s; cut dbshotgun_$i "$W/gun_dbshotgun.ogg" $1 $2; i=$((i+1)); done
i=1; for s in "0 0.96" "1.02 0.96" "2.04 0.96" "3.06 0.96" "4.08 1.3"; do set -- $s; cut ak_$i "$W/gun_ak47.ogg" $1 $2; i=$((i+1)); done
i=1; for s in "0 1.3" "1.36 0.72" "2.14 1.139" "3.34 0.86" "4.26 0.84"; do set -- $s; cut ar_$i "$W/gun_m4a1.ogg" $1 $2; i=$((i+1)); done
i=1; for s in "0 0.708" "0.768 0.708" "1.536 0.708" "2.304 0.708" "3.072 1.1" "4.232 1.1"; do set -- $s; cut smg_$i "$W/gun_mp5.ogg" $1 $2; i=$((i+1)); done
cut smg_7 "$C/shot-smg.ogg" 0 0.8 "silenceremove=start_periods=1:start_threshold=-40dB"
i=1; for s in "0 2.2" "2.26 2.2"; do set -- $s; cut sniper_$i "$W/gun_rifle.ogg" $1 $2; i=$((i+1)); done
cut sniper_3 "$C/shot-rifle.ogg" 0 1.9 "silenceremove=start_periods=1:start_threshold=-40dB"
cut heavy_1 "$C/shot-heavy.ogg" 0 1.9 "silenceremove=start_periods=1:start_threshold=-40dB"
# magnum: the pistol recordings pitched down ~4.5 semitones (derived, no recording of a magnum was available as CC0 here)
i=1; for s in "0 1.28" "1.34 1.2" "2.6 1.2"; do set -- $s; cut magnum_$i "$W/gun_pistol.ogg" $1 $2 "asetrate=44100*0.77,aresample=44100,lowshelf=f=160:g=4"; i=$((i+1)); done
i=1; for s in "0 1.2" "1.26 1.2" "2.52 1.2" "3.78 1.2" "5.04 1.2" "6.3 2"; do set -- $s; cut far_$i "$W/gun_far.ogg" $1 $2 "" 32000; i=$((i+1)); done
cut rocket_1 "$C/rocket.ogg" 0 1.4
