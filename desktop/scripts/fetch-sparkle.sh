#!/bin/bash
#
# Fetches Sparkle, the usual Mac updater, into desktop/vendor/ so the next
# `npm run build` links it. Pinned to one release and checked against its
# published SHA-256, so the same bytes arrive every time.
#
#   npm run sparkle
#
# Linking Sparkle doesn't turn updates on. That needs a release feed and a
# signing key (README.md, "Turning on updates").
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

VERSION="2.10.0"
SHA256="c2bf58aa8387266ac179357b1415d6f2635f044da8be41042af32425dae6da0c"
URL="https://github.com/sparkle-project/Sparkle/releases/download/${VERSION}/Sparkle-${VERSION}.tar.xz"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
echo "Downloading Sparkle ${VERSION}"
curl -fsSL "$URL" -o "$WORK/sparkle.tar.xz"
echo "${SHA256}  $WORK/sparkle.tar.xz" | shasum -a 256 -c - >/dev/null || {
  echo "The download doesn't match Sparkle ${VERSION}'s published checksum. Stopped." >&2
  exit 1
}
mkdir -p "$WORK/out"
tar -xJf "$WORK/sparkle.tar.xz" -C "$WORK/out"

rm -rf vendor
mkdir -p vendor
ditto "$WORK/out/Sparkle.framework" vendor/Sparkle.framework
# The tools that sign releases and make the update feed (bin/sign_update,
# bin/generate_appcast, bin/generate_keys).
ditto "$WORK/out/bin" vendor/bin
echo "Sparkle ${VERSION} is in desktop/vendor. Run npm run build to link it."
