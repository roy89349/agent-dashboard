#!/usr/bin/env bash
# install-whisper.sh — reproducible LOCAL speech-to-text for the Mission Control voice-note feature.
#
# SELLABILITY: this installs a LOCAL whisper.cpp so voice notes are transcribed ON THE VPS — no external
# STT API, no API keys, no metered/per-minute costs, and the audio never leaves the box. It's the same
# privacy/cost story as the rest of dev-fleet.
#
# What it does (idempotent — safe to re-run):
#   1) installs build deps + ffmpeg (apt if available; otherwise just checks they exist)
#   2) clones/updates + builds whisper.cpp under $WHISPER_DIR
#   3) downloads a ggml model (default: base) under $WHISPER_DIR/models
#   4) prints the WHISPER_BIN / WHISPER_MODEL / FFMPEG_BIN lines to paste into mission-control/.env.local
#
# RESOURCE NOTES (works comfortably on a CPX32-class VPS — 8 vCPU / 16 GB):
#   model        RAM (approx)   speed vs realtime (CPU)   Dutch quality
#   ggml-base     ~0.5 GB        very fast                 ok
#   ggml-small    ~1 GB          fast                      good
#   ggml-medium   ~2.6 GB        slower (~1x realtime)     best for Dutch  ← set MODEL=medium
#   A ~15s voice note transcribes in a few seconds on base/small. Voice notes are short, so a small
#   whisper build stays well within a CPX32; medium is fine too but trades CPU time for accuracy.
#
# Usage:
#   bash deploy/install-whisper.sh                 # base model, default location
#   MODEL=medium bash deploy/install-whisper.sh    # better Dutch
#   WHISPER_DIR=/opt/whisper.cpp MODEL=small bash deploy/install-whisper.sh
set -euo pipefail

WHISPER_DIR="${WHISPER_DIR:-/opt/whisper.cpp}"
MODEL="${MODEL:-base}"           # base | small | medium | large-v3-turbo | ...
REPO="${WHISPER_REPO:-https://github.com/ggml-org/whisper.cpp}"

echo "== whisper.cpp local STT installer =="
echo "   dir=$WHISPER_DIR  model=ggml-$MODEL.bin"

# ── 1) build deps + ffmpeg ──
if command -v apt-get >/dev/null 2>&1; then
  echo "== installing build deps (apt) =="
  sudo apt-get update -y
  sudo apt-get install -y git build-essential cmake ffmpeg curl
else
  echo "== apt-get not found — verifying tools are present =="
  for t in git cmake ffmpeg curl; do
    command -v "$t" >/dev/null 2>&1 || { echo "!! missing '$t' — install it, then re-run"; exit 1; }
  done
fi

# ── 2) clone / update + build ──
if [ -d "$WHISPER_DIR/.git" ]; then
  echo "== updating existing checkout =="
  git -C "$WHISPER_DIR" pull --ff-only || echo "   (pull skipped — using current checkout)"
else
  echo "== cloning whisper.cpp =="
  sudo mkdir -p "$(dirname "$WHISPER_DIR")"
  sudo chown "$(id -un)":"$(id -gn)" "$(dirname "$WHISPER_DIR")" 2>/dev/null || true
  git clone --depth 1 "$REPO" "$WHISPER_DIR"
fi

echo "== building (cmake) =="
cmake -B "$WHISPER_DIR/build" -S "$WHISPER_DIR" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$WHISPER_DIR/build" --config Release -j "$(nproc 2>/dev/null || echo 2)"

# locate the built CLI (newer builds → whisper-cli; older → main)
BIN=""
for cand in "$WHISPER_DIR/build/bin/whisper-cli" "$WHISPER_DIR/build/bin/main" "$WHISPER_DIR/main"; do
  [ -x "$cand" ] && { BIN="$cand"; break; }
done
[ -n "$BIN" ] || { echo "!! could not find the built whisper binary under $WHISPER_DIR/build"; exit 1; }

# ── 3) download the model ──
MODEL_FILE="$WHISPER_DIR/models/ggml-$MODEL.bin"
if [ -f "$MODEL_FILE" ]; then
  echo "== model already present: $MODEL_FILE =="
else
  echo "== downloading ggml-$MODEL model =="
  if [ -x "$WHISPER_DIR/models/download-ggml-model.sh" ]; then
    (cd "$WHISPER_DIR" && bash ./models/download-ggml-model.sh "$MODEL")
  else
    mkdir -p "$WHISPER_DIR/models"
    curl -fsSL -o "$MODEL_FILE" \
      "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-$MODEL.bin"
  fi
fi
[ -f "$MODEL_FILE" ] || { echo "!! model download failed: $MODEL_FILE"; exit 1; }

FFMPEG_BIN="$(command -v ffmpeg || echo ffmpeg)"

cat <<EOF

✅ Done. Add these to mission-control/.env.local (then restart the dashboard):

VOICE_NOTES=on
WHISPER_BIN=$BIN
WHISPER_MODEL=$MODEL_FILE
FFMPEG_BIN=$FFMPEG_BIN
# Optional: WHISPER_LANG=nl   (force Dutch instead of auto-detect)

Quick self-test (should print a transcript):
  $BIN -m $MODEL_FILE -f $WHISPER_DIR/samples/jfk.wav --no-timestamps --output-txt -of /tmp/whisper-selftest && cat /tmp/whisper-selftest.txt

Then send the bot a voice note — it becomes the same "make this a task?" card a text idea does.
EOF
