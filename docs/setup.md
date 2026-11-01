# Setup

Motion Studio runs on your own Mac. Each person on the team installs it once and signs in with their own Claude and Google accounts.

## What you need

- macOS with [Homebrew](https://brew.sh)
- Node.js 22 or newer
- Google Chrome (renders and exports use it)
- Apple's command line tools (`xcode-select --install`), for the background remover and face finder
- [Claude Code](https://claude.com/claude-code), signed in. The studio's chat runs on your Claude plan, so its requests count against your usage.

## Install

```bash
npm run setup                  # everything but the Rust engine
npm run setup -- --with-rust   # also the Rust engine (needs Rust from rustup.rs)
npm run dev                    # then open http://localhost:3200/studio
```

Setup installs ffmpeg and cmake, the app's packages and each engine's packages. Run it again any time; it skips what's already there.

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

## If something goes wrong

- **"Operation not permitted" in the terminal:** macOS has blocked access to the Desktop. In System Settings, open Privacy & Security, then Full Disk Access. Turn your terminal app off and on again, then quit and reopen it.
- **The studio says it can't reach Claude:** run `claude` once in a terminal and sign in.
- **A render fails:** check that Google Chrome is installed, then run `npm run setup` again.
- **Port 3200 is busy:** another copy of the studio is running. Close it, or stop it with `lsof -ti tcp:3200 | xargs kill`.
