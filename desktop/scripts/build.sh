#!/bin/bash
#
# Builds "Motion Studio.app" in desktop/build/.
#
# Compiles the Swift sources with swiftc and puts the .app together by hand
# (Info.plist, icon, Contents/MacOS, Contents/Resources). Needs only Apple's
# command line tools, no Xcode project. The same way ~/Desktop/projects/nudge
# builds.
#
#   npm run build         the app, optimised
#   npm run dev           a debug build, opened at once
#   npm run dmg           the app plus a .dmg and a .zip to hand to teammates
#
# Optional, for later (see README.md):
#   MOTION_STUDIO_SIGN_IDENTITY="Developer ID Application: …"  sign for real
#   MOTION_STUDIO_FEED_URL=… MOTION_STUDIO_ED_KEY=…            turn on updates
set -euo pipefail

DESKTOP="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STUDIO="$(cd "$DESKTOP/.." && pwd)"
cd "$DESKTOP"

MODE=release
DMG=0
for arg in "$@"; do
  case "$arg" in
    --debug) MODE=debug ;;
    --dmg) DMG=1 ;;
  esac
done

NAME="Motion Studio"
APP="build/${NAME}.app"
VERSION="$(/usr/bin/plutil -extract version raw -o - package.json)"
ARCH="$(uname -m)"
TARGET="${ARCH}-apple-macos14.0"

if [[ "$MODE" == release ]]; then OPT=(-O -whole-module-optimization); else OPT=(-Onone -g); fi

# Sparkle (updates) is linked only if scripts/fetch-sparkle.sh has fetched it.
SPARKLE=()
if [[ -d vendor/Sparkle.framework ]]; then
  SPARKLE=(-F vendor -framework Sparkle -Xlinker -rpath -Xlinker @executable_path/../Frameworks)
fi

echo "1. Compiling (${MODE}${SPARKLE:+, with Sparkle})"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
SOURCES=()
while IFS= read -r file; do SOURCES+=("$file"); done < <(find Sources -name '*.swift' | sort)
swiftc "${OPT[@]}" -target "$TARGET" -swift-version 5 \
  -framework AppKit -framework SwiftUI -framework WebKit \
  ${SPARKLE[@]+"${SPARKLE[@]}"} \
  -o "$APP/Contents/MacOS/$NAME" "${SOURCES[@]}"

echo "2. Putting the app together"
PLIST="$APP/Contents/Info.plist"
cp Info.plist "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $VERSION" "$PLIST"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $VERSION" "$PLIST"
if [[ -n "${MOTION_STUDIO_FEED_URL:-}" && -n "${MOTION_STUDIO_ED_KEY:-}" ]]; then
  /usr/libexec/PlistBuddy -c "Add :SUFeedURL string $MOTION_STUDIO_FEED_URL" "$PLIST"
  /usr/libexec/PlistBuddy -c "Add :SUPublicEDKey string $MOTION_STUDIO_ED_KEY" "$PLIST"
  echo "   updates on, from $MOTION_STUDIO_FEED_URL"
fi
printf 'APPL????' > "$APP/Contents/PkgInfo"
cp Resources/AppIcon.icns Resources/guard.mjs "$APP/Contents/Resources/"
# The studio folder on this Mac, so the app finds it without asking here.
printf '%s\n' "$STUDIO" > "$APP/Contents/Resources/built-from.txt"
if [[ -d vendor/Sparkle.framework ]]; then
  mkdir -p "$APP/Contents/Frameworks"
  ditto vendor/Sparkle.framework "$APP/Contents/Frameworks/Sparkle.framework"
fi

echo "3. Signing"
if [[ -n "${MOTION_STUDIO_SIGN_IDENTITY:-}" ]]; then
  # A real Developer ID: inside out, with the hardened runtime notarising needs.
  SIGN=(codesign --force --timestamp --options runtime --sign "$MOTION_STUDIO_SIGN_IDENTITY")
  if [[ -d "$APP/Contents/Frameworks/Sparkle.framework" ]]; then
    S="$APP/Contents/Frameworks/Sparkle.framework/Versions/B"
    for part in "$S/XPCServices/Installer.xpc" "$S/XPCServices/Downloader.xpc" "$S/Autoupdate" "$S/Updater.app"; do
      [[ -e "$part" ]] && "${SIGN[@]}" "$part"
    done
    "${SIGN[@]}" "$APP/Contents/Frameworks/Sparkle.framework"
  fi
  "${SIGN[@]}" --entitlements entitlements.plist "$APP"
  echo "   signed as $MOTION_STUDIO_SIGN_IDENTITY"
else
  # "Ad hoc": runs on this Mac. Teammates' Macs will say it's from an
  # unidentified developer until it's signed for real (README.md).
  codesign --force --deep --sign - "$APP"
  echo "   signed ad hoc (no Developer ID yet)"
fi
codesign --verify --deep --strict "$APP"

if (( DMG )); then
  echo "4. Making the .dmg and .zip"
  STAGE="$(mktemp -d)"
  trap 'rm -rf "$STAGE"' EXIT
  ditto "$APP" "$STAGE/$NAME.app"
  ln -s /Applications "$STAGE/Applications"
  DMG_FILE="build/Motion-Studio-${VERSION}-${ARCH}.dmg"
  rm -f "$DMG_FILE"
  hdiutil create -volname "$NAME" -srcfolder "$STAGE" -ov -format UDZO "$DMG_FILE" >/dev/null
  # The .zip is what Sparkle downloads when updates are on.
  ditto -c -k --keepParent "$APP" "build/Motion-Studio-${VERSION}-${ARCH}.zip"
  echo "   $DMG_FILE"
fi

echo
echo "Built $DESKTOP/$APP"
echo "Open it:     open \"$DESKTOP/$APP\""
echo "Install it:  drag it into Applications"
