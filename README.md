# Motion Studio

Aerchain's in-house tool for motion graphics and video. Bring in footage or start from a blank film, then change it by talking to Claude, by pointing at the part you mean, or by moving the controls yourself. Every film follows a brand kit, has its own sound design, and renders to a crisp video.

It runs on your own Mac, with your own Claude sign-in.

## What's inside

| Part | Address | What it's for |
| --- | --- | --- |
| **Studio** | `/studio` | Make motion graphics and edit videos with Claude. Films, brand kits, sound and renders live here. |
| **Post tool** | `/tool` | Make speaker posts without code: change the words, photo and landmark, then download the 4K video. |
| **Speaker post** | `/` | The original animated post the tool is built on. |

## Set up

You need a Mac with [Homebrew](https://brew.sh), Node.js 22 or newer, Google Chrome and [Claude Code](https://claude.com/claude-code). Then, in this folder:

```bash
npm run setup
npm run dev
```

Open http://localhost:3200/studio. Setup installs the video tools, the app and each engine. Add `-- --with-rust` to also set up the Rust engine. [docs/setup.md](docs/setup.md) covers the details, the optional keys and what to do if something goes wrong.

The server only answers this Mac, and Claude in the studio can only change the film you're working on.

## Using the studio

- **Start a film.** On the studio's home page, make a new motion film or drop in footage to edit a video. Pick a size: 16:9, 1:1, 4:5 or 9:16.
- **Change it by asking.** Type in the chat on the left. Press P and click any part of the film to ask about just that part. The prompt always knows the moment the playhead is on.
- **Change it by hand.** The panel on the right holds the film's settings, size, length, brand and sound. Press ⌘Z to undo.
- **Edit footage.** Trim, split and move clips on the timeline, make captions from the speech, add branded graphics, and add a voiceover in an Indian voice.
- **Render.** Make a quick draft, or the final video in 4K and 1080p. Finals can save themselves to Google Drive, and the film's source to a GitHub library.

Press H to hide every panel, and Space to play.

## Brand kits

Each film follows a brand kit: colours, fonts, logos and the rules for look, motion, sound and words. Aerchain's full kit comes built in. Make a kit from a brand's guideline, links and files, or import one another studio exported.

## Where things are

```
src/app/            pages and routes: studio, post tool, the post, their APIs
src/components/     the interface: studio/, tool/, post/, shared ui/ and icons/
src/lib/studio/     the studio's server side: films, Claude, renders, brands, sound
src/lib/tool/       the post tool's server side
studio/             under the hood: engines, starters, graphics, brand kits
  remotion/  hyperframes/  fframes/  sound/   each engine, with its own packages
  starters/          what a new film is copied from
  graphics/  kit/    the branded graphics and the shared drawing kit
  brands/aerchain/   Aerchain's brand kit
scripts/            setup, exports, renders, transcription, voiceovers
.claude/skills/     what Claude in the studio knows: the engines, motion, the Aerchain look
docs/               the details
```

Your films, posts and brand kits stay on your Mac (`films/`, `posts/`, `brands/`). Git ignores them, and so do keys in `.env.local`.

## Docs

- [Setup](docs/setup.md): requirements, keys and fixes for common problems
- [How the studio works](docs/studio.md): engines, video editing, sound, brand kits, renders
- [Saving to Google Drive and GitHub](docs/connections.md)
- [Use the studio from other apps](docs/mcp.md): Claude Desktop, Claude Code, Cursor (MCP) and the command line
- [Shortcuts and Raycast](docs/shortcuts.md): start a film from a link
- [Security](docs/security.md): who the studio answers, and the local API token
- [The post tool](docs/post-tool.md)
- [The speaker post](docs/speaker-post.md): the original post and its export

## Licences

The studio is for in-house use at Aerchain. It builds on:

- HyperFrames (Apache 2.0)
- fframes (MIT)
- Tone.js (MIT)
- skullet (MIT)
- Bricolage Grotesque (OFL)
- Strudel (AGPL 3.0): fine in-house, but offering the studio to people outside Aerchain as a hosted service would mean publishing its source.
- Remotion: free for individuals, companies of up to 3 people and evaluation. Aerchain needs a company licence before using React films for real work.
