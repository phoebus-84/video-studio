#!/usr/bin/env bash
# Sets up a render engine inside this clone: pinned Node, static ffmpeg,
# npm dependencies, Remotion's browser and, on Linux, the system libraries it needs.
# Run from the repo root (or anywhere): idempotent, safe to repeat.
# On Windows it runs under Git Bash (the engine's SSH shell) and installs no
# system packages: Chrome brings its libraries and Windows its fonts.
#
# sudo is needed only for apt. With passwordless sudo nothing else is required;
# otherwise start with SETUP_SUDO_STDIN=1 and give the password on stdin's first line.
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
# shellcheck source=engine.env
. "$ROOT/packages/render-worker/engine.env"
case "$(uname -s)" in MINGW*|MSYS*) WINDOWS=1 ;; *) WINDOWS= ;; esac
ENGINE=$ROOT/.engine
if [ -n "$WINDOWS" ]; then
  NODE_DIR=$ENGINE/node-v$NODE_VERSION-win-x64
  NODE_BIN=$NODE_DIR
else
  NODE_DIR=$ENGINE/node-v$NODE_VERSION-linux-x64
  NODE_BIN=$NODE_DIR/bin
fi
FFMPEG_DIR=$ENGINE/ffmpeg-$FFMPEG_TAG
BUN_DIR=$ENGINE/bun-v$BUN_VERSION
cd "$ROOT"
mkdir -p "$ENGINE/dl"

step() { printf '==> %s\n' "$*"; }

SUDO_PASS=
if [ "${SETUP_SUDO_STDIN:-}" = 1 ]; then IFS= read -r SUDO_PASS || true; fi
run_sudo() {
  if [ -n "$SUDO_PASS" ]; then printf '%s\n' "$SUDO_PASS" | sudo -S -p '' "$@"; else sudo -n "$@"; fi
}

fetch() { # url file sha256
  if [ -f "$2" ] && echo "$3  $2" | sha256sum -c --status; then return; fi
  curl -fL --retry 3 -o "$2" "$1"
  echo "$3  $2" | sha256sum -c --status || { echo "checksum mismatch for $1" >&2; exit 1; }
}

if [ -z "$WINDOWS" ]; then
step "system packages (apt)"
pick() { # first of the candidates apt knows (Ubuntu 24.04 renamed some to *t64)
  for p in "$@"; do
    if [ -n "$(apt-cache policy "$p" 2>/dev/null | awk '/Candidate:/ && $2 != "(none)" {print $2}')" ]; then echo "$p"; return; fi
  done
  echo "none of: $*" >&2; exit 1
}
PKGS=(libnss3 libnspr4 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1
  libpango-1.0-0 libcairo2 libxshmfence1 libx11-6 libxcb1 libxext6 libdbus-1-3 ca-certificates curl xz-utils unzip
  fonts-noto-core fonts-noto-color-emoji fonts-dejavu fontconfig)
PKGS+=("$(pick libatk1.0-0t64 libatk1.0-0)" "$(pick libatk-bridge2.0-0t64 libatk-bridge2.0-0)"
  "$(pick libcups2t64 libcups2)" "$(pick libasound2t64 libasound2)")
MISSING=()
for p in "${PKGS[@]}"; do dpkg -s "$p" >/dev/null 2>&1 || MISSING+=("$p"); done
if [ ${#MISSING[@]} -gt 0 ]; then
  echo "installing: ${MISSING[*]}"
  run_sudo env DEBIAN_FRONTEND=noninteractive apt-get update -qq
  run_sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends "${MISSING[@]}"
  fc-cache -f >/dev/null 2>&1 || true
else
  echo "all present"
fi
fi

unpack_zip() { # zip dir-inside-it target
  rm -rf "$ENGINE/extract" && mkdir "$ENGINE/extract"
  unzip -q "$1" -d "$ENGINE/extract"
  rm -rf "$3" && mv "$ENGINE/extract/$2" "$3" && rm -rf "$ENGINE/extract"
}

step "node $NODE_VERSION"
if [ -n "$WINDOWS" ]; then
  if [ ! -f "$NODE_BIN/node.exe" ]; then
    fetch "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-win-x64.zip" "$ENGINE/dl/node.zip" "$NODE_WIN_SHA256"
    unpack_zip "$ENGINE/dl/node.zip" "node-v$NODE_VERSION-win-x64" "$NODE_DIR"
  fi
elif [ ! -x "$NODE_BIN/node" ]; then
  fetch "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-x64.tar.xz" "$ENGINE/dl/node.tar.xz" "$NODE_SHA256"
  tar -xJf "$ENGINE/dl/node.tar.xz" -C "$ENGINE"
fi

FFMPEG_RELEASES=https://github.com/BtbN/FFmpeg-Builds/releases/download/$FFMPEG_TAG
if [ -n "$WINDOWS" ]; then
  step "ffmpeg $FFMPEG_WIN_FILE"
  if [ ! -f "$FFMPEG_DIR/bin/ffmpeg.exe" ]; then
    fetch "$FFMPEG_RELEASES/$FFMPEG_WIN_FILE.zip" "$ENGINE/dl/ffmpeg.zip" "$FFMPEG_WIN_SHA256"
    unpack_zip "$ENGINE/dl/ffmpeg.zip" "$FFMPEG_WIN_FILE" "$FFMPEG_DIR"
  fi
else
  step "ffmpeg $FFMPEG_FILE"
  if [ ! -x "$FFMPEG_DIR/bin/ffmpeg" ]; then
    fetch "$FFMPEG_RELEASES/$FFMPEG_FILE.tar.xz" "$ENGINE/dl/ffmpeg.tar.xz" "$FFMPEG_SHA256"
    rm -rf "$ENGINE/ffmpeg-extract" && mkdir "$ENGINE/ffmpeg-extract"
    tar -xJf "$ENGINE/dl/ffmpeg.tar.xz" -C "$ENGINE/ffmpeg-extract"
    mv "$ENGINE/ffmpeg-extract/$FFMPEG_FILE" "$FFMPEG_DIR"
    rmdir "$ENGINE/ffmpeg-extract"
  fi
fi

step "bun $BUN_VERSION"
if [ -n "$WINDOWS" ]; then
  if [ ! -f "$BUN_DIR/bun.exe" ]; then
    fetch "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-windows-x64-baseline.zip" "$ENGINE/dl/bun.zip" "$BUN_WIN_SHA256"
    unpack_zip "$ENGINE/dl/bun.zip" bun-windows-x64-baseline "$BUN_DIR"
  fi
elif [ ! -x "$BUN_DIR/bun" ]; then
  fetch "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-x64-baseline.zip" "$ENGINE/dl/bun.zip" "$BUN_SHA256"
  unpack_zip "$ENGINE/dl/bun.zip" bun-linux-x64-baseline "$BUN_DIR"
fi

step "env.sh"
# Native Windows programs read FFMPEG_PATH, so it is written as C:/... there.
native() { if [ -n "$WINDOWS" ]; then cygpath -m "$1"; else echo "$1"; fi; }
# The engine's own tuning (AVG_* exports added by hand) survives a new run.
tuning=$(grep -E '^export AVG_' "$ENGINE/env.sh" 2>/dev/null || true)
cat > "$ENGINE/env.sh" <<ENVEOF
# generated by packages/render-worker/setup.sh
export PATH="$NODE_BIN:$FFMPEG_DIR/bin:$BUN_DIR:\$PATH"
export FFMPEG_PATH="$(native "$FFMPEG_DIR/bin/ffmpeg")"
export FFPROBE_PATH="$(native "$FFMPEG_DIR/bin/ffprobe")"
ENVEOF
[ -z "$tuning" ] || printf '%s\n' "$tuning" >> "$ENGINE/env.sh"
# shellcheck disable=SC1091
source "$ENGINE/env.sh"

step "bun install (node $(node -v))"
bun install --frozen-lockfile

step "remotion browser"
(cd packages/remotion-composer && node -e "
import('@remotion/renderer').then(async (r) => {
  const s = await r.ensureBrowser();
  console.log('browser', s.type, s.path ?? '');
})")

step "done: node $(node -v), $(ffmpeg -version | head -1)"
