#!/bin/bash
#
# Turns Resources/AppIcon.svg into Resources/AppIcon.icns with the Mac's own
# tools (sips draws the SVG, iconutil packs the sizes). Run it after changing
# the SVG.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
SET="$WORK/AppIcon.iconset"
mkdir -p "$SET"
sips -s format png Resources/AppIcon.svg --out "$WORK/1024.png" >/dev/null
for size in 16 32 128 256 512; do
  sips -z $size $size "$WORK/1024.png" --out "$SET/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z $double $double "$WORK/1024.png" --out "$SET/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$SET" -o Resources/AppIcon.icns
echo "Made Resources/AppIcon.icns"
