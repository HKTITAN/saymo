# Saymo

Saymo is an open-source motion editor for the Mac. You make motion graphics and edit videos by talking to Claude, by pointing at the part of the film you want changed, or by moving the controls yourself. Every film follows a brand kit, has its own sound design and renders to a sharp 4K video.

It runs on your own laptop with your own Claude account, so your films never leave your Mac unless you save them somewhere.

## What you need

- A Mac running macOS 14 or newer (Apple silicon renders fastest)
- [Homebrew](https://brew.sh)
- [Node.js](https://nodejs.org) 22 or newer
- [Google Chrome](https://www.google.com/chrome/), which draws the frames of every render
- Apple's command line tools: run `xcode-select --install`
- [Claude Code](https://claude.com/claude-code), signed in with your Claude plan or an API key
- About 3 GB of free disk space

## Install

```bash
git clone https://github.com/sethihq/saymo.git
cd saymo
npm run setup
```

Setup checks your Mac, installs ffmpeg and the other video tools, and installs the packages for the app and each engine. If something is missing, it stops and tells you what to install. You can run it again at any time; it skips what's already there.

Then sign in to Claude Code once, if you haven't already:

```bash
claude
```

### Or let your coding agent set it up

Paste this into Claude Code, Codex, Cursor or any coding agent that can run commands on your Mac:

```text
Set up Saymo, an open-source motion editor, on this Mac and start it.

1. Clone https://github.com/sethihq/saymo into ~/saymo (or pull it if it's already there) and work in that folder.
2. Read README.md and docs/setup.md first.
3. Check what this Mac has: macOS 14 or newer, Homebrew, Node.js 22 or newer, Google Chrome, Apple's command line tools (xcode-select -p) and Claude Code (claude --version). Tell me what's missing and how to install it. Ask me before installing anything that needs my password or an app download, such as Homebrew, Node, Chrome or the command line tools.
4. Run npm run setup. If it stops, read what it says, fix that one thing, and run it again.
5. If Claude Code isn't signed in, tell me to run claude in a terminal and sign in, then wait for me.
6. Run npm run dev in the background, wait until http://localhost:3200/studio answers, and open http://localhost:3200 in my browser.
7. Tell me in a few plain sentences what you installed, anything that's still missing, and how to start Saymo again next time (cd ~/saymo && npm run dev).

Don't change any of Saymo's files, don't commit or push anything, and don't paste keys or sign-ins anywhere.
```

## Start the studio

```bash
npm run dev
```

Open http://localhost:3200. The studio only answers your own Mac. Leave the terminal open while you work, and press Ctrl+C in it to stop the studio.

Prefer an app in your Dock? The [Mac app](desktop/README.md) opens the studio in its own window without a terminal.

## Make your first film

1. **Start a film.** On the home page, describe what you want ("a 6 second launch teaser for a note-taking app"), pick a size (16:9, 1:1, 4:5 or 9:16) and press Return. To edit footage instead, drop video files on the home page.
2. **Watch it build.** Claude writes the film while the chat on the left shows each step. The film plays in the middle when it's ready.
3. **Change it by asking.** Type in the chat ("make the title bigger and slower"). Press P and click any part of the film to ask about just that part. The chat always knows the moment the playhead is on.
4. **Change it by hand.** The panel on the right holds the film's words, colours, length, brand kit and sound. Press ⌘Z to undo anything.
5. **Render it.** Use the button at the top right to make a quick draft, or the final video in 4K and 1080p. Finished videos are in `films/<id>/out/`, and the studio can open that folder for you.

Press Space to play or pause, and H to hide every panel.

## Brand kits

Each film follows a brand kit: colours, fonts, logos and the rules for look, motion, sound and words. A new film uses the built-in clean kit (black on white, Geist, one accent at most). To use your own brand, open Brand kits on the home page and make a kit from a guideline PDF, a website, logo and font files, or a two-minute personal style. Kits export and import as `.zip` files.

## Optional extras

None of these are needed to make films:

- **Codex** on your ChatGPT plan, or **Claude with an API key**, as the AI behind the chat. Set them up under AI in the studio's settings.
- **Saving to Google Drive or GitHub**, so every final lands in a Drive folder and each film's source in a GitHub repository. See [connections](docs/connections.md).
- **Using Saymo from other apps**: Claude Desktop, Cursor or Claude Code can make and change films through its MCP server, and the terminal through `npm run studio`. See [use Saymo from other apps](docs/mcp.md).
- **The Rust engine**, for heavy generative scenes: `npm run setup -- --with-rust` (needs [Rust](https://rustup.rs)).

[Setup](docs/setup.md) covers keys, settings and fixes for common problems.

## Update

```bash
git pull
npm run setup
```

Then restart `npm run dev`.

## Where your work lives

Everything you make stays in the Saymo folder on your Mac: films in `films/`, brand kits in `brands/`, speaker posts in `posts/`, saved references in `library/` and sign-ins in `.studio/`. Git ignores all of them, and keys in `.env.local`, so `git pull` never touches your work. Back up those folders to keep your films.

## Also in the box

| Part | Address | What it's for |
| --- | --- | --- |
| **Studio** | `/studio` | Make motion graphics and edit videos with Claude |
| **Post tool** | `/tool` | A sample template: animated speaker posts made without code, downloaded as 4K video |
| **Sample post** | `/post` | The animated post the tool starts from |

## Docs

- [Setup](docs/setup.md): requirements, keys, settings and fixes for common problems
- [How the studio works](docs/studio.md): engines, video editing, sound, brand kits and renders
- [Saving to Google Drive and GitHub](docs/connections.md)
- [Use Saymo from other apps](docs/mcp.md): Claude Desktop, Claude Code, Cursor and the terminal
- [Shortcuts and Raycast](docs/shortcuts.md): start a film from a link
- [Security](docs/security.md): what the studio answers and what Claude can touch
- [The post tool](docs/post-tool.md) and [the sample post](docs/speaker-post.md)
- [Roadmap](docs/roadmap.md)

## How the code is organised

```
src/
  app/                pages and API routes: studio, post tool, sample post
  components/
    studio/           the studio's interface, one folder per area:
      api/            the page's calls to the studio's routes
      home/  film/  video/  chat/  sound/  brand/  library/  settings/  flows/
      ui/             the studio's own panels, switches and decorations
    tool/  post/      the post tool and the sample post
    ui/               shared controls (the DialKit rows, buttons, menus)
    icons/            PikaIcons, written by `npx pikaicons add`
  lib/
    studio/           the studio's server side, one folder per area:
      agent/          Claude and Codex turns, the AI providers, standing rules
      films/          films, the contract, edits, takes, renders, footage
      stage/          the page each film plays in, and the bridge to it
      brands/         brand kits and personal style
      sound/          scores, mixes, voiceovers, reference sounds
      input/          dictation, attachments, slides, scripts
      library/        the reference library and ideas
      connect/        Google Drive, GitHub and cloud folders
      server/         local API token, edition, streaming, file serving
    tool/             the post tool's server side
  content/            the sample post's words
studio/               under the hood, used by the engines (not bundled by Next)
  remotion/  hyperframes/  sound/   each engine, with its own packages
  starters/           what a new film is copied from (html, react, rust, video)
  graphics/  kit/     the graphics library and the shared drawing kit
  effects/            ready-made effects for HTML films
  brands/clean/       the built-in brand kit
  fonts/              open fonts films can use
scripts/
  studio/             renders, checks, sound, transcription, the CLI and MCP server
  post/               the sample post's export, photo, landmark and wordmark
  native/             Swift helpers built on first use (Vision, PDFKit)
  setup.sh  licences.mjs
desktop/              the native Mac app (Swift)
.claude/skills/       what Claude in the studio knows: saymo-film, saymo-sound-design,
                      saymo-video-edit, plus the engines' and craft skills
docs/                 guides; docs/research/ holds dated research notes
```


## Contributing

Run `npx tsc --noEmit`, `npm run lint` and `npm run build` before sending a change, and `node scripts/studio/parts-check.mjs` after touching `studio/effects/` or the starters. House rules for the interface, copy and icons are in [CLAUDE.md](CLAUDE.md).

## Licences

Saymo's own licence is still to be chosen. It builds on:

- HyperFrames (Apache 2.0)
- fframes (MIT)
- Tone.js (MIT)
- skullet (MIT)
- Bricolage Grotesque and Geist (OFL)
- Strudel (AGPL 3.0), in the in-house edition only: it plays the music of films made before the studio's own music bed. The product edition (`STUDIO_EDITION=product`) leaves it out; see [docs/research/licences.md](docs/research/licences.md).
- Remotion: free for individuals, companies of up to 3 people and evaluation; larger companies need a Remotion company licence to use React films.

Every package's licence is in [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md) (`npm run licences` writes it).
