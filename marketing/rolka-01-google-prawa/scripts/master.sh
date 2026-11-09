#!/usr/bin/env bash
# Final delivery: Remotion render → audio mastering for social (−14 LUFS integrated, ≤ −1 dBTP)
# → remux with faststart. The video stream is copied bit-exact from the Remotion render.
# Timing, speed and pitch of the voice are untouched; only level/dynamics of the whole mix are mastered.
#
#   npm run render:raw   # writes out/_render_raw.mp4
#   npm run master       # writes out/GrovBase_Rolka_01_Google_Prawa_1080x1920.mp4
set -euo pipefail
cd "$(dirname "$0")/.."
IN="${1:-out/_render_raw.mp4}"
OUT="${2:-out/GrovBase_Rolka_01_Google_Prawa_1080x1920.mp4}"
TMP="out/_master"
TARGET=-14
mkdir -p "$TMP"

lufs() { ffmpeg -hide_banner -nostats -i "$1" -af ebur128=peak=true -f null - 2>&1 | awk '/^ +I:/{i=$2} /^ +Peak:/{p=$2} END{print i, p}'; }

# 1) the Remotion mix (voice + ducked original music + SFX), 48 kHz stereo
ffmpeg -v error -y -i "$IN" -vn -ac 2 -ar 48000 -c:a pcm_f32le "$TMP/mix.wav"

# 2) speech-friendly glue compression
ffmpeg -v error -y -i "$TMP/mix.wav" -af "acompressor=threshold=-30dB:ratio=3:attack=5:release=120:knee=4" -c:a pcm_f32le "$TMP/glued.wav"

# 3) gain to target + look-ahead peak limiter at −1.6 dBFS; two iterations to land on the target loudness
read -r I0 _ < <(lufs "$TMP/glued.wav")
GAIN=$(python3 -c "print(round($TARGET - ($I0), 2))")
for pass in 1 2; do
  ffmpeg -v error -y -i "$TMP/glued.wav" -af "volume=${GAIN}dB,alimiter=limit=0.832:attack=5:release=60:level=disabled:asc=1:latency=1" -c:a pcm_f32le "$TMP/mastered.wav"
  read -r I1 P1 < <(lufs "$TMP/mastered.wav")
  echo "pass $pass: gain ${GAIN} dB → I ${I1} LUFS, true peak ${P1} dBTP"
  GAIN=$(python3 -c "print(round($GAIN + ($TARGET - ($I1)), 2))")
done

# 4) remux: H.264 copied, AAC-LC 48 kHz 320 kb/s, moov atom first (faststart)
ffmpeg -v error -y -i "$IN" -i "$TMP/mastered.wav" -map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 320k -ar 48000 -ac 2 \
  -movflags +faststart -metadata title="GrovBase — Rolka #1: Google Grafika i prawa do zdjęć" "$OUT"

echo "→ $OUT"
ffprobe -v error -show_entries stream=codec_name,profile,width,height,r_frame_rate,pix_fmt,color_space,color_primaries,color_transfer,sample_rate,channels -show_entries format=duration,size -of default=nw=1 "$OUT"
lufs "$OUT" | awk '{print "loudness I " $1 " LUFS, true peak " $2 " dBTP"}'
