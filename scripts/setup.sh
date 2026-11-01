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
