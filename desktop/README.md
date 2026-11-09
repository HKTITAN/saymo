# Saymo for the Mac

Saymo as a Mac app: open it from the Dock or Applications like any other app. No Terminal, no `npm run dev`. The window shows the studio; quitting the app stops the studio.

It's a small native app written in Swift (SwiftUI and AppKit, about 3.7 MB). It doesn't contain the studio itself: it runs the studio from the studio folder on your Mac, the same folder `npm run dev` uses, so your films, brand kits, sign-ins and `.env.local` stay exactly where they are.

## Make it and open it

```bash
cd desktop
npm run build      # makes build/Saymo.app
npm run open       # opens it
npm run dmg        # also makes build/Saymo-0.1.0-arm64.dmg (and a .zip) to hand to teammates
npm run dev        # a quicker debug build, opened at once
```

Only Apple's command line tools are needed (`xcode-select --install`). There are no packages to install: `npm run` only runs the scripts in `scripts/`.

To keep it, drag `build/Saymo.app` into Applications.

**The first time you open each new build**, macOS asks whether Saymo may open files in your Desktop folder (the studio folder is there). Click Allow. Until the app is signed with a Developer ID (below), macOS sees every rebuild as a new app and asks again.

**On a teammate's Mac**, an app that isn't signed with a Developer ID is blocked the first time. Open it once, then go to System Settings, Privacy & Security, and click Open Anyway next to Saymo.

## What happens when it opens

1. **It reads your Mac's setup.** An app opened from the Dock doesn't see what Terminal sees (Homebrew, Node from fnm or nvm, Claude Code), so it asks your login shell once, the same way a new Terminal window would.
2. **It finds the studio folder**: the one it was built from, or the usual places (`~/Desktop/projects/saymo`, `~/Documents/GitHub/saymo` and others). If it can't find one, it asks you to choose it. File, Choose Studio Folder changes it later.
3. **It checks the Mac** for what the studio needs (below). If something is missing, it says what, what it's for and how to get it, in plain words.
4. **It builds the studio** if the folder's code changed since the last time (about 15 seconds here, longer the first time). The build goes into `.next/desktop/a` or `.next/desktop/b` inside the studio folder, never into the dev server's files. If a build fails, the last good one opens instead.
5. **It starts the studio** on this Mac only (127.0.0.1), on port 3201 so it never takes 3200 from `npm run dev`. If 3201 is busy it picks any free port. Then the window shows `/studio`.

While it works, the window shows the studio's own working mark and one line saying what's happening. Logs stay out of sight; if something fails, the screen says what to do, and Show details reveals the log with a button to copy it.

Quitting the app (or closing its window) stops the studio's server and everything it started: renders, Claude, the speech server. If the app itself crashes, a small helper (`Resources/guard.mjs`) notices and stops them anyway. Opening the app again while it's open just brings its window forward.

When the folder's code is unchanged, it's ready in about half a second.

## What it checks

| Check | Needed for | If it's missing |
| --- | --- | --- |
| Node.js 22 or newer | Everything (required) | Download the LTS version from nodejs.org |
| Studio packages | Everything (required) | Install what's missing (runs `npm run setup`) |
| Video engine packages | Previews and renders | Install what's missing |
| ffmpeg | Renders and sound | Install what's missing |
| Google Chrome | Drawing frames | Download from google.com/chrome |
| Claude Code | The chat | Install from claude.com/claude-code and sign in once |
| Apple's command line tools | Background remover, face finder | Install tools (Apple's own window) |
| Homebrew | Installing ffmpeg and the other tools | Install from brew.sh |

**Install what's missing** runs the studio's own `scripts/setup.sh` and shows which step it's on. It's offered only when Homebrew, Node, Chrome and Apple's tools are already there, because setup needs them. Missing things that only turn off some features can be skipped with Open the studio; the app asks again only if something new goes missing.

## Choices, and why

**Swift.** Like Pond's Mac app, it's native: 3.7 MB, it starts at once, and it looks and behaves like a Mac app. The window is a web view (WebKit, the engine Safari uses).

**The Mac's own Node, not one inside the app.** The studio already needs Node on the Mac: setup installs the engines with npm, and the studio starts its renders and tools with the same Node it runs on. One Node for all of it avoids two versions disagreeing, and keeps the app small. The app finds it (fnm, nvm, Homebrew or nodejs.org) and says so plainly if it's missing or too old.

**Films stay in the studio folder.** The studio keeps everything relative to its folder (films, brand kits, `.studio/` sign-ins, `.env.local`), and that's how the team uses it in-house today. Moving films to `~/Library/Application Support/Saymo` would mean changing the studio itself and keeping two copies in step, so it waits until the product edition needs it. The app's own files are small and separate:

- `~/Library/Application Support/Saymo/`: `settings.json` (studio folder, port, skipped checks) and `builds.json` (which build is ready)
- `~/Library/Logs/Saymo/`: `launch.log`, `build.log`, `server.log`, `setup.log` (Help, Show Logs)

Nothing secret is bundled or logged: the app never reads `.env.local`, `.studio/connections/` or `.studio/api-token`, it only notices when `.env.local` changes so it can rebuild.

**Feels like an app, not a page.** The page never bounces past its top or bottom, there's no swipe back and forth between pages and no pinch zoom (View, Zoom In and Zoom Out instead). Links that leave the studio open in your browser. Downloads go to Downloads. The mic (dictation) and camera (reels) work after macOS asks once.

## Things to know

- **Studio code changes take effect on the next launch** (or File, Rebuild the Studio). The app itself rarely needs updating: new studio features arrive when the studio folder is updated.
- **Google Drive sign-in**: Google only sends you back to addresses listed on the Google Cloud client, which today are for port 3200. Add `http://localhost:3201/api/studio/connect/google/callback` and `http://127.0.0.1:3201/api/studio/connect/google/callback` there too (docs/connections.md). The sign-in opens in your browser; come back to the app when it's done.
- **The window is WebKit, the studio is built for Chrome.** Renders still use Chrome, so films come out the same. If something in the interface looks or behaves differently from Chrome, open `http://127.0.0.1:3201/studio` in Chrome to compare, and the Develop menu in Safari can inspect the app's page.
- **Closing the window during a render stops the render**, as stopping `npm run dev` would.

## Turning on updates (Sparkle)

The app is wired for [Sparkle](https://sparkle-project.org), the usual Mac updater, and it stays off until a release exists. `npm run sparkle` fetches Sparkle 2.10.0 (checked against its published checksum) into `vendor/`, and the next build links it. Updates turn on only when a build is given a feed address and a public key; without them the app never checks. Teammates' apps can't fetch from a private GitHub repo, so the feed and downloads need a public home: a separate public releases repo, GitHub Pages or any web space.

1. Make the signing keys once: `vendor/bin/generate_keys`. The private key stays in your Keychain; it prints the public key.
2. Raise `version` in `desktop/package.json`.
3. Build with updates on (and signed, see below; macOS only installs updates to a signed app):

   ```bash
   SAYMO_FEED_URL=https://…/appcast.xml SAYMO_ED_KEY=<public key> \
   SAYMO_SIGN_IDENTITY="Developer ID Application: …" npm run dmg
   ```

4. Put the `.zip` in a folder with earlier ones and run `vendor/bin/generate_appcast <folder>`; upload the zips and `appcast.xml` to the feed address.

The app then checks on its own, and Saymo, Check for Updates appears in the menu.

## Signing, notarising and Homebrew (later)

What's needed so teammates can open it without Open Anyway, get updates, and install it with Homebrew:

1. **An Apple Developer Program membership** ($99 a year) and, in it, a **Developer ID Application** certificate, installed in your Keychain.
2. **Sign**: `SAYMO_SIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)" npm run dmg` signs Sparkle and the app with the hardened runtime and `entitlements.plist` (mic and camera). Then sign the .dmg: `codesign --sign "Developer ID Application: …" --timestamp build/Saymo-0.1.0-arm64.dmg`.
3. **Notarise** (Apple checks it for malware, about 5 to 15 minutes):

   ```bash
   xcrun notarytool store-credentials saymo --apple-id <you@…> --team-id <TEAMID>   # once; asks for an app-specific password
   xcrun notarytool submit build/Saymo-0.1.0-arm64.dmg --keychain-profile saymo --wait
   xcrun stapler staple build/Saymo-0.1.0-arm64.dmg
   ```

4. **Homebrew**: publish the .dmg somewhere public, then add a cask to a tap, as Pond does (its `Casks/pond.rb`):

   ```ruby
   cask "saymo" do
     version "0.1.0"
     sha256 "<shasum -a 256 of the dmg>"
     url "https://github.com/<owner>/<public-repo>/releases/download/v#{version}/Saymo-#{version}-arm64.dmg"
     name "Saymo"
     desc "Make motion graphics and videos with Claude"
     homepage "https://github.com/<owner>/<public-repo>"
     depends_on macos: ">= :sonoma"
     app "Saymo.app"
     zap trash: ["~/Library/Application Support/Saymo", "~/Library/Logs/Saymo"]
   end
   ```

   Teammates then run `brew install --cask <owner>/<tap>/saymo`. Homebrew needs a public download, and it asks for a signed, notarised app.

Pond's whole pipeline (a GitHub Action that builds, signs, notarises, uploads the release and updates the cask on every `v*` tag) is a good model once the above works by hand.

## Files

| File | What it is |
| --- | --- |
| `Sources/App.swift` | The app: window, menu, quitting |
| `Sources/Launcher.swift` | Opening steps, and the lines the loader shows |
| `Sources/LaunchView.swift`, `Sources/Working.swift` | The launch screens and the working mark |
| `Sources/StudioWindow.swift` | The window and its web view (links, downloads, mic, no bounce) |
| `Sources/ShellEnvironment.swift`, `Sources/Checks.swift` | Reading your Mac's setup, and the checks |
| `Sources/Builder.swift`, `Sources/Server.swift`, `Sources/Job.swift` | Building and running the studio |
| `Sources/Updates.swift` | Sparkle, off until configured |
| `Resources/guard.mjs` | Stops everything the studio started when the app goes |
| `Resources/AppIcon.svg` | The icon, a placeholder; `npm run icon` rebuilds `AppIcon.icns` |
| `studio.tsconfig.json` | Used by the app's build of the studio, so Next never edits the repo's tsconfig.json |
| `Info.plist`, `entitlements.plist` | The app's details and, for real signing, its permissions |

The repo's `next.config.ts` has one addition for the app: with `STUDIO_DESKTOP_DIST` set (only the app sets it), Next builds into that folder and skips type-checking. Without it, `npm run dev` and `npm run build` behave as before.
