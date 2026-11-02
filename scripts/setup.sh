#!/usr/bin/env bash
# Sets up Motion Studio on a Mac in one go: the tools it needs, the app's
# packages and each engine's packages. Safe to run again; it skips what's
# already there.
#
#   npm run setup                 everything but the Rust engine
#   npm run setup -- --with-rust  also the Rust engine (fframes)

set -euo pipefail
cd "$(dirname "$0")/.."

WITH_RUST=0
[[ "${1:-}" == "--with-rust" ]] && WITH_RUST=1

step() { printf '\n\033[1m%s\033[0m\n' "$1"; }
ok() { printf '  done: %s\n' "$1"; }
stop() { printf '\n%s\n' "$1" >&2; exit 1; }

step "1. Checking this Mac"
[[ "$(uname)" == "Darwin" ]] || stop "Motion Studio runs on macOS only."
command -v brew >/dev/null || stop "Install Homebrew first (https://brew.sh), then run this again."
NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
(( NODE_MAJOR >= 22 )) || stop "Motion Studio needs Node.js 22 or newer. Install it (https://nodejs.org) and run this again."
[[ -d "/Applications/Google Chrome.app" ]] || stop "Install Google Chrome: the studio renders videos with it."
xcrun --find swiftc >/dev/null 2>&1 || stop "Install Apple's command line tools first: run xcode-select --install"
ok "macOS, Homebrew, Node $(node -v), Chrome, Swift"

step "2. Video and audio tools"
for tool in ffmpeg cmake; do
  if command -v "$tool" >/dev/null; then ok "$tool already installed"; else brew install "$tool"; fi
done
# Renders need x264 (every final) and use Apple's hardware encoder,
# VideoToolbox, where the Mac has it (faster finals and drafts). Homebrew's
# ffmpeg has both; an ffmpeg from elsewhere may not.
ENCODERS=$(ffmpeg -hide_banner -encoders 2>/dev/null || true)
if ! grep -q libx264 <<<"$ENCODERS"; then
  stop "Your ffmpeg can't make H.264 videos (no libx264). Run: brew install ffmpeg, make sure $(brew --prefix)/bin comes first in your PATH, then run this again."
fi
if grep -q h264_videotoolbox <<<"$ENCODERS" &&
  ffmpeg -hide_banner -loglevel error -f lavfi -i testsrc2=s=256x144:r=30 -frames:v 4 -vf format=yuv420p \
    -c:v h264_videotoolbox -b:v 8M -f null - >/dev/null 2>&1; then
  ok "ffmpeg can use this Mac's hardware video encoder (faster renders)"
else
  printf '  note: ffmpeg is not using the hardware video encoder, so renders will be slower.\n'
  printf '        To fix it: brew reinstall ffmpeg\n'
fi

# Turning slides into a video works without these; with them it's faster
# (poppler draws PDF pages) and PowerPoint and OpenDocument files are drawn
# without Keynote (LibreOffice, about 700 MB, so it's left to you).
if command -v pdftoppm >/dev/null; then ok "poppler already installed (PDF slides)"; else brew install poppler; fi
if command -v soffice >/dev/null || [[ -d "/Applications/LibreOffice.app" ]]; then
  ok "LibreOffice already installed (PowerPoint slides)"
else
  printf '  optional: to turn PowerPoint and OpenDocument files into slides without Keynote,\n'
  printf '            run: brew install --cask libreoffice\n'
fi

step "3. The app's packages"
npm ci --no-audit --no-fund

step "4. The engines' packages"
for engine in remotion hyperframes sound; do
  npm ci --prefix "studio/$engine" --no-audit --no-fund
  ok "$engine"
done
(cd studio/hyperframes && npx --no-install hyperframes telemetry disable >/dev/null 2>&1 || true)

if (( WITH_RUST )); then
  step "5. The Rust engine"
  if ! command -v cargo >/dev/null; then
    stop "Install Rust first (https://rustup.rs), then run: npm run setup -- --with-rust"
  fi
  for tool in pkgconf nasm ninja; do
    command -v "$tool" >/dev/null || brew install "$tool"
  done
  ok "Rust $(rustc --version | cut -d' ' -f2); the first Rust film takes a few minutes to build"
fi

step "Ready"
cat <<'EOF'
  Start it:      npm run dev
  Then open:     http://localhost:3200/studio

  Two things happen the first time you use them, so they take longer once:
  - transcribing speech downloads the speech model (about 1.6 GB)
  - Claude in the studio uses your own Claude Code sign-in (run `claude` once if you haven't)

  Optional keys go in .env.local (see docs/setup.md). Never commit that file.
EOF
