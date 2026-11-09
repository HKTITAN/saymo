# Setup

Saymo runs on your own Mac. Each person on the team installs it once and signs in with their own Claude and Google accounts.

## What you need

- macOS with [Homebrew](https://brew.sh)
- Node.js 22 or newer
- Google Chrome (renders and exports use it)
- Apple's command line tools (`xcode-select --install`), for the background remover and face finder
- [Claude Code](https://claude.com/claude-code), signed in. The studio's chat runs on your Claude plan, so its requests count against your usage. Every studio turn uses Claude Opus 5.5 at high effort, so keep Claude Code up to date (`claude update`). To change it on one Mac, set `STUDIO_MODEL` or `STUDIO_EFFORT` in `.env.local`.

## AI for the chat

Claude on your Claude plan is the default and needs nothing more. Two other AIs are optional, set up from the link button at the top right of the studio, under AI:

- **Codex, on your ChatGPT plan.** Install it yourself, then sign in:

  ```bash
  npm install --global @openai/codex   # or: brew install codex
  codex login                          # sign in with ChatGPT
  ```

- **Claude with an API key**, for teammates without a Claude plan. Make a key at console.anthropic.com and paste it into the AI section. It stays on this Mac in `.studio/connections/anthropic.json` and is billed to that key's account.

Then pick the AI in any prompt box with the small picker next to Point. More in [connections.md](connections.md).

### The product edition

With `STUDIO_EDITION=product` in `.env.local` (see [launch/README.md](launch/README.md)), Claude with an API key is the only AI: there's no Claude plan or Codex option anywhere. Every Claude request (a film's chat, the kit maker, the script writer) uses the saved key, and Claude Code runs with a settings folder of the studio's own (`.studio/claude`), so a Claude sign-in on the Mac is never used. Until a key is saved, each of them says where to paste one. To keep the key in a file of your own instead, set `STUDIO_ANTHROPIC_KEY_FILE` to that file's path (the key alone, or JSON with a `key`).

## Install

```bash
npm run setup                  # everything but the Rust engine
npm run setup -- --with-rust   # also the Rust engine (needs Rust from rustup.rs)
npm run dev                    # then open http://localhost:3200/studio
```

Setup installs ffmpeg and cmake, the app's packages and each engine's packages. Run it again any time; it skips what's already there. It also checks that ffmpeg can use your Mac's hardware video encoder; if it says it can't, run `brew reinstall ffmpeg`.

### Licences

```bash
npm run licences                           # for the edition you run
STUDIO_EDITION=product npm run licences    # what the product ships
```

Run it after adding or updating packages. It lists everything the studio uses that someone else made (the app's and engines' packages, the Rust crates, the speech models, the font, the icons and the borrowed skills) and writes `THIRD-PARTY-NOTICES.md` and `public/licences.json`, which the product edition shows under About and licences on the home page. The product's list leaves out what it doesn't ship (the Strudel music engine and GSAP). Never edit either file by hand.

## Renders on your Mac

Each render looks at the Mac it runs on and sets itself up for it. You don't need to change anything.

- **Drawing frames:** Chrome draws several frames at once, as many as your Mac's cores and memory allow. An 8 GB Mac draws a 4K film with 2 at a time, so it doesn't run out of memory; a 16 GB Mac with 10 cores uses 8.
- **Encoding:** a final's 4K file uses Apple's hardware encoder on Apple silicon Macs, which is about 2.5 times as fast as the software encoder and just as sharp. Intel Macs use the software encoder (x264). The 1080p file always uses x264.
- **No repeat work:** if nothing in the film has changed since its last render of the same kind, the studio hands back that render at once. If only the sound changed, it puts the new sound on the existing video.

The first line of `films/<id>/out/render-log.txt` says what a render chose. To override it on one Mac, add to `.env.local`:

| Setting | Does |
| --- | --- |
| `STUDIO_WORKERS=4` | Draws 4 frames at once. Lower it if your Mac slows down during renders. |
| `STUDIO_ENCODER=x264` | Never uses the hardware encoder. |

## Slides

"Turn slides into a video" takes a PDF, PowerPoint (.pptx, .ppt), Keynote (.key), OpenDocument (.odp) or pictures of slides. From Google Slides, choose File, Download, then PDF or PowerPoint.

- **PDF and pictures** work on any Mac. Setup installs poppler, which draws PDF pages faster; without it the Mac's own PDF reader is used.
- **PowerPoint**: the words, speaker notes, pictures and chart data are read straight from the file. To draw the slides themselves, the studio uses LibreOffice if it's installed (`brew install --cask libreoffice`, optional, about 700 MB), else Keynote. With neither, it asks you to drop a PDF export of the same deck too, which fills in the pictures.
- **Keynote** files are exported by Keynote itself, with their presenter notes. The first time, macOS asks whether your terminal may control Keynote: choose Allow. If Keynote shows a window of its own when it opens (a welcome or sign-in window), close it once and try again, or export a PDF from Keynote (File, Export To, PDF).
- To stop the studio opening Keynote at all, add `STUDIO_KEYNOTE=off` to `.env.local`.

Some things happen the first time you use them:

- **Transcribing speech:** the speech model (about 1.6 GB) is downloaded and built, which takes a few minutes. After that, a minute of speech takes a few seconds.
- **The first Rust film:** takes a few minutes to build. Later ones take seconds.

## Keys

Optional keys go in `.env.local`, one per line. Git never commits this file; never paste a key anywhere else.

| Key | Turns on |
| --- | --- |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Saving renders to Google Drive. One-time Google Cloud setup: [connections.md](connections.md) |
| `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET` | Signing in to GitHub with your own account (otherwise your `gh` sign-in is used) |
| `FIGMA_TOKEN` | Reading Figma links when making a brand kit |
| `AI_GATEWAY_API_KEY` | Making landmarks with AI in the post tool |

Restart `npm run dev` after changing `.env.local`.

## Safety

- The server only answers this Mac (`127.0.0.1`). Studio requests must come from the studio page itself.
- Claude in the studio can only change the open film, and can only run that film's checks, renders and media tools. It has no web access, except for links you give it while making a brand kit.
- Sign-ins for Google Drive and GitHub are kept in `.studio/connections/`, readable only by your Mac user, and never sent to the page or to Claude.
- The API key, if you add one, is kept there too and goes only to the AI you picked it for. Codex runs in macOS's sandbox: it can write only the open film, can't read `.env` files, `.studio/` or other films, and has no web access. The studio never reads or copies Claude's or Codex's own sign-ins.

## If something goes wrong

- **"Operation not permitted" in the terminal:** macOS has blocked access to the Desktop. In System Settings, open Privacy & Security, then Full Disk Access. Turn your terminal app off and on again, then quit and reopen it.
- **The studio says it can't reach Claude:** run `claude` once in a terminal and sign in.
- **A render fails:** check that Google Chrome is installed, then run `npm run setup` again.
- **Your Mac slows down a lot while rendering:** add `STUDIO_WORKERS=2` to `.env.local` and restart `npm run dev`.
- **Port 3200 is busy:** another copy of the studio is running. Close it, or stop it with `lsof -ti tcp:3200 | xargs kill`.
