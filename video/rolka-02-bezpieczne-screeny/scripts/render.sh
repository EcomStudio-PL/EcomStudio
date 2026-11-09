#!/usr/bin/env bash
# Full production render: Remotion (1080x1920, 30 FPS, H.264 yuv420p) → loudness master → ffprobe check.
# The voice timing is never altered: mastering = gain + true-peak limiting of the WHOLE mix only.
set -euo pipefail
cd "$(dirname "$0")/.."
OUT_DIR=${OUT_DIR:-out}
NAME=${NAME:-GrovBase_Rolka_02_Bezpieczne_Screeny_1080x1920}
mkdir -p "$OUT_DIR"
BROWSER_ARGS=()
if [[ -n "${REMOTION_BROWSER:-}" ]]; then BROWSER_ARGS=(--browser-executable "$REMOTION_BROWSER"); fi

npx remotion render src/index.ts GrovBaseRolka02 "$OUT_DIR/raw.mp4" \
  --codec h264 --pixel-format yuv420p --crf 17 --audio-codec aac --audio-bitrate 320k \
  --color-space bt709 --concurrency "${CONCURRENCY:-4}" "${BROWSER_ARGS[@]}"

# Mastering of the WHOLE mix (voice timing untouched): gentle compression → gain → true-peak-safe limiter,
# targeting -14 LUFS integrated / <= -1.5 dBTP. The gain is solved iteratively from a measurement.
master() { # $1 = gain dB
  ffmpeg -hide_banner -loglevel error -y -i "$OUT_DIR/raw.mp4" -vn \
    -af "acompressor=threshold=-27dB:ratio=3:attack=4:release=130:knee=6:makeup=6dB,volume=${1}dB,alimiter=limit=-2dB:attack=1.5:release=80:level=false,aresample=48000" \
    -c:a pcm_s16le "$OUT_DIR/master.wav"
  ffmpeg -hide_banner -nostats -i "$OUT_DIR/master.wav" -af ebur128=peak=true:framelog=quiet -f null - 2>&1 | awk '/^ +I:/{print $2}'
}
GAIN=9.5
for _ in 1 2 3; do
  I=$(master "$GAIN")
  GAIN=$(python3 -c "i=float('$I'); g=float('$GAIN'); print(round(g + (-14.0 - i), 2) if abs(i + 14.0) > 0.2 else g)")
  echo "integrated $I LUFS -> gain $GAIN dB"
  python3 -c "import sys; sys.exit(0 if abs(float('$I') + 14.0) <= 0.2 else 1)" && break
done
ffmpeg -hide_banner -loglevel error -y -i "$OUT_DIR/raw.mp4" -i "$OUT_DIR/master.wav" -map 0:v -map 1:a -c:v copy \
  -c:a aac -b:a 320k -ar 48000 -ac 2 -movflags +faststart \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  "$OUT_DIR/$NAME.mp4"
rm -f "$OUT_DIR/master.wav"

ffprobe -v error -show_entries stream=codec_name,width,height,r_frame_rate,pix_fmt,sample_rate,channels:format=duration,bit_rate -of default=nw=1 "$OUT_DIR/$NAME.mp4"
ffmpeg -hide_banner -nostats -i "$OUT_DIR/$NAME.mp4" -af ebur128=peak=true:framelog=quiet -f null - 2>&1 | sed -n '/Summary/,$p'
