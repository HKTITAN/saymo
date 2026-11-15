# Saymo

An open-source motion editor for motion graphics and video. Bring in footage or start from a blank film, then change it by talking to Claude, by pointing at the part you mean, or by moving the controls yourself. Every film follows a brand kit, has its own sound design, and renders to a crisp video.

It runs on your own Mac, with your own Claude sign-in.

## What's inside

| Part | Address | What it's for |
| --- | --- | --- |
| **Studio** | `/studio` (and `/`) | Make motion graphics and edit videos with Claude. Films, brand kits, sound and renders live here. |
| **Post tool** | `/tool` | A sample template: make animated speaker posts without code by changing the words, photo and landmark, then download the 4K video. |
| **Sample post** | `/post` | The animated speaker post the tool starts from, filled with sample words. |

## Set up

You need a Mac with [Homebrew](https://brew.sh), Node.js 22 or newer, Google Chrome and [Claude Code](https://claude.com/claude-code). Then, in this folder:

```bash
npm run setup
npm run dev
```

Open http://localhost:3200. Setup installs the video tools, the app and each engine. Add `-- --with-rust` to also set up the Rust engine. [docs/setup.md](docs/setup.md) covers the details, the optional keys and what to do if something goes wrong.

The server only answers this Mac, and Claude in the studio can only change the film you're working on.

## Using the studio

- **Start a film.** On the studio's home page, make a new motion film or drop in footage to edit a video. Pick a size: 16:9, 1:1, 4:5 or 9:16.
- **Change it by asking.** Type in the chat on the left. Press P and click any part of the film to ask about just that part. The prompt always knows the moment the playhead is on.
- **Change it by hand.** The panel on the right holds the film's settings, size, length, brand and sound. Press ⌘Z to undo.
- **Edit footage.** Trim, split and move clips on the timeline, make captions from the speech, add branded graphics, and add a voiceover in an Indian voice.
- **Render.** Make a quick draft, or the final video in 4K and 1080p. Finals can save themselves to Google Drive, and the film's source to a GitHub library.

Press H to hide every panel, and Space to play.

## Brand kits

Each film follows a brand kit: colours, fonts, logos and the rules for look, motion, sound and words. The clean kit (black on white, Geist, one accent at most) comes built in and is the default. Make a kit from a brand's guideline, links and files, start a personal style in two minutes, or import a kit another studio exported.

## Where things are

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

Your films, posts and brand kits stay on your Mac (`films/`, `posts/`, `brands/`). Git ignores them, and so do keys in `.env.local`.

## Docs

- [Setup](docs/setup.md): requirements, keys and fixes for common problems
- [How the studio works](docs/studio.md): engines, video editing, sound, brand kits, renders
- [Saving to Google Drive and GitHub](docs/connections.md)
- [Use the studio from other apps](docs/mcp.md): Claude Desktop, Claude Code, Cursor (MCP) and the command line
- [Shortcuts and Raycast](docs/shortcuts.md): start a film from a link
- [Security](docs/security.md): who the studio answers, and the local API token
- [The post tool](docs/post-tool.md) and [the sample post](docs/speaker-post.md)
- [Roadmap](docs/roadmap.md)

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
