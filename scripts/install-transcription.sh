#!/bin/bash
# Install everything voice transcription needs, without root.
#
# Three pieces, and all three have to be reachable from the *service's* PATH,
# not your shell's — which is why this installs to one directory and prints the
# absolute paths for `.env` rather than assuming anything is on PATH:
#
#   ffmpeg       Telegram sends Opus; whisper.cpp reads 16 kHz mono WAV
#   whisper-cli  built from source — there are no Linux release binaries
#   a model      the weights, several hundred megabytes
#
# Idempotent: each piece is skipped if it is already there. Safe to re-run after
# a failure, and cheap to run to find out what is missing.
#
# Downloads roughly 600 MB and spends a few minutes compiling. It is not quick.
set -euo pipefail

BIN_DIR="${CONCLAW_BIN_DIR:-$HOME/.local/bin}"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_DIR="${CONCLAW_MODEL_DIR:-$PROJECT_ROOT/data/models}"
# `small` is what this install runs and transcribes at roughly real time.
# `base` is about three times faster and noticeably worse with Russian.
MODEL_SIZE="${WHISPER_MODEL_SIZE:-small}"
WHISPER_VERSION="${WHISPER_VERSION:-1.7.4}"
CMAKE_VERSION="${CMAKE_VERSION:-3.31.6}"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$BIN_DIR" "$MODEL_DIR"

case "$(uname -m)" in
  x86_64|amd64) FFMPEG_ARCH=amd64; CMAKE_ARCH=x86_64 ;;
  aarch64|arm64) FFMPEG_ARCH=arm64; CMAKE_ARCH=aarch64 ;;
  *) echo "unsupported architecture: $(uname -m)" >&2; exit 1 ;;
esac

say() { printf '\n== %s\n' "$1"; }

# --- ffmpeg -----------------------------------------------------------------
# A static build, because the distro package needs root and this box may not
# have any.
if [ -x "$BIN_DIR/ffmpeg" ] && [ -x "$BIN_DIR/ffprobe" ]; then
  say "ffmpeg: уже установлен"
else
  say "ffmpeg: скачиваю статическую сборку (~80 МБ)"
  curl -fsSL -o "$WORK/ffmpeg.tar.xz" \
    "https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-${FFMPEG_ARCH}-static.tar.xz"
  tar -xJf "$WORK/ffmpeg.tar.xz" -C "$WORK"
  found="$(find "$WORK" -maxdepth 2 -type f -name ffmpeg | head -1)"
  cp "$found" "$BIN_DIR/ffmpeg"
  cp "$(dirname "$found")/ffprobe" "$BIN_DIR/ffprobe"
  chmod +x "$BIN_DIR/ffmpeg" "$BIN_DIR/ffprobe"
fi

# --- whisper-cli ------------------------------------------------------------
if [ -x "$BIN_DIR/whisper-cli" ]; then
  say "whisper-cli: уже установлен"
else
  # whisper.cpp publishes no Linux binaries, so it gets built. cmake is only
  # needed for that, and only if the system has none.
  CMAKE_BIN="$(command -v cmake || true)"
  if [ -z "$CMAKE_BIN" ] && [ -x "$BIN_DIR/cmake" ]; then
    CMAKE_BIN="$BIN_DIR/cmake"
  fi
  if [ -z "$CMAKE_BIN" ]; then
    say "cmake: не найден, ставлю локально"
    curl -fsSL -o "$WORK/cmake.tar.gz" \
      "https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/cmake-${CMAKE_VERSION}-linux-${CMAKE_ARCH}.tar.gz"
    tar -xzf "$WORK/cmake.tar.gz" -C "$WORK"
    cp -r "$WORK"/cmake-*/bin/* "$BIN_DIR/"
    cp -r "$WORK"/cmake-*/share/cmake-* "$(dirname "$BIN_DIR")/share/" 2>/dev/null || {
      mkdir -p "$(dirname "$BIN_DIR")/share"
      cp -r "$WORK"/cmake-*/share/cmake-* "$(dirname "$BIN_DIR")/share/"
    }
    CMAKE_BIN="$BIN_DIR/cmake"
  fi

  command -v cc >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1 || {
    echo "нужен компилятор C (gcc/clang) — поставь build-essential и повтори" >&2
    exit 1
  }

  say "whisper.cpp: собираю v${WHISPER_VERSION} (несколько минут)"
  curl -fsSL -o "$WORK/whisper.tar.gz" \
    "https://github.com/ggml-org/whisper.cpp/archive/refs/tags/v${WHISPER_VERSION}.tar.gz"
  tar -xzf "$WORK/whisper.tar.gz" -C "$WORK"
  src="$WORK/whisper.cpp-${WHISPER_VERSION}"
  "$CMAKE_BIN" -S "$src" -B "$src/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
  "$CMAKE_BIN" --build "$src/build" --target whisper-cli -j "$(nproc 2>/dev/null || echo 4)" >/dev/null
  cp "$(find "$src/build" -name whisper-cli -type f | head -1)" "$BIN_DIR/whisper-cli"
  chmod +x "$BIN_DIR/whisper-cli"
fi

# --- model ------------------------------------------------------------------
MODEL_PATH="$MODEL_DIR/ggml-${MODEL_SIZE}.bin"
if [ -s "$MODEL_PATH" ]; then
  say "модель ${MODEL_SIZE}: уже на месте"
else
  say "модель ${MODEL_SIZE}: скачиваю (это самая большая часть)"
  # To a temp name first: an interrupted download that lands on the final path
  # looks installed and fails at transcription time instead.
  curl -fL --progress-bar -o "$MODEL_PATH.part" \
    "https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${MODEL_SIZE}.bin"
  mv "$MODEL_PATH.part" "$MODEL_PATH"
fi

cat <<EOF

Готово. Добавь в .env — абсолютными путями, потому что PATH сервиса это не
PATH твоей оболочки:

FFMPEG_BIN=$BIN_DIR/ffmpeg
WHISPER_BIN=$BIN_DIR/whisper-cli
WHISPER_MODEL=$MODEL_PATH

Проверить: перезапусти сервис и посмотри в логе, нет ли строки
"Voice transcription is not fully set up".
EOF
