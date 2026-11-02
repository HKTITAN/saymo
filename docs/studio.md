# How the studio works

What's under the hood of `/studio`: brand kits, the three motion engines, sound design, and how films render.

## Films

A film is a folder in `films/<id>/` with a `film.json` (its size, length, settings and named moments) beside its source. There are two kinds:

- **Motion films** are written in one of the engines below. Claude writes and edits them; the panel changes their settings.
- **Video edits** (`kind: "video"`) cut footage on a timeline. Their `edit.json` holds the tracks: clips from the footage, graphics, music and captions (the contract is `src/lib/studio/edit.ts`). They play and render through Remotion.

Every Claude turn first copies the film into `.history/`, so Undo can put it back.

## Video editing

- **Footage:** dropped files stream to `films/<id>/media/<mid>/`. The studio makes a smooth preview copy, a strip of frames and the sound's shape for the timeline. Renders always use the originals.
- **Captions:** speech is transcribed on this Mac with whisper.cpp (the large-v3-turbo model), tuned for Indian English and taught words like Aerchain and SpendOS. Captions come in three styles.
- **Voiceovers:** the microphone in the Media panel reads typed words in one of the Mac's own voices: Rishi (the default), Tara and Aman in Indian English, Lekha in Hindi. The result lands in the film like any sound file.
- **Graphics:** lower third, title, end card, logo and quote, from `studio/graphics/`. They draw in the film's brand kit.
- **Claude as editor:** Claude can read what's said, find pauses, scene changes and the speaker's face, and look at frames, through `scripts/studio/media-tool.mjs`. The `aerchain-video-edit` skill teaches it to cut talking heads, pace for each platform, caption and reframe.

## Claude in the studio

Each prompt runs `claude -p` on your own sign-in, at high effort, inside the film's folder (`src/lib/studio/claude.ts`). It is told the moment the playhead is on and whatever you pointed at. It may only:

- read the project's code, skills and the film;
- edit the film's own files;
- run the film's checker, a draft render, the media tool, the voiceover tool and the sound renderer, each for that film only.

Footage, keys and other films are off limits, and there is no web access except the links you give while making a brand kit.

## Brand kits (in the studio)

`/studio` opens on a dashboard of every film and every brand kit. A kit is
what makes a film look, move and sound like its brand: colour roles and
ramps, fonts, logos for light and dark grounds, a line texture, rules
(look, motion, sound, words) and a longer guideline for Claude
(`src/lib/studio/brand.ts`).

- Aerchain's full kit ships in `studio/brands/aerchain/` (from the Framer
  guideline /home-ets, the wordmark and the post's tuned film colours) and
  is copied into `brands/aerchain/` the first time the studio needs it.
  Kits made in the studio live in `brands/<id>/`, which git ignores, as
  they may belong to clients.
- A kit's page (`/studio?brand=<id>`) shows it as a specimen board, with
  the settings on the right and Claude on the left. Drop fonts, logos or a
  guideline PDF anywhere on it. "Make a kit from files" on the dashboard
  has Claude read a guideline (and optionally one website) and fill the
  kit in. Kits export and import as `.zip` files.
- Each film picks its kit (the Brand row in the film panel). The stage and
  every render hand the kit to the film: `window.__brand` for HTML films,
  `useBrand()`, `usePalette()`, `useTexture()`, `useBrandFont()` and
  `<BrandLogo>` from `studio-kit` for React films, `brand.json` for Rust
  films. The graphics library draws with them, so a lower third or end
  card takes the film's brand. Aerchain films draw exactly as before.

## Motion engines (under the studio)

The studio at `/studio` is our own motion tool: you see films, a stage and
a chat with Claude, never an engine. Underneath, each film is written for
one of three engines, chosen by Claude (or by the starter a film begins
from), and the studio drives and renders it:

| A film written as | Engine | Good for | Licence |
| --- | --- | --- | --- |
| `html`: `index.html`, moved by a Motion sequence wrapped by `filmTimeline()` at `window.__timelines.main` (GSAP in films made before Motion, in-house only) | [HyperFrames](https://hyperframes.heygen.com) 0.8.227 (`studio/hyperframes`) | Most films: instant to preview, any web type, CSS and SVG, and the one Claude writes best. The default | Apache 2.0, free |
| `react`: `src/Film.jsx`, a component drawn from `useCurrentFrame()` | [Remotion](https://www.remotion.dev) 4.0.539 (`studio/remotion`) | Films driven by data, captions, audio and video clips | Free for individuals, companies of up to 3 people, and evaluation. **Aerchain needs a company licence before using it for real work** (remotion.pro) |
| `rust`: a Cargo crate drawing SVG per frame | [fframes](https://fframes.studio) 1.3.0 (`studio/fframes`) | Heavy generative scenes; renders 4K in seconds on the GPU | MIT, free |

How the studio uses them:

- **New films** are copied from `studio/starters/<html|react|rust>/`: a
  short on-brand film (line texture, Bricolage Grotesque, colour arriving
  from the right, orange once) with a few params (headline, accent colour,
  speed or figure) and named moments (`marks`) in its `film.json`.
- **The stage** (`/studio/stage/<id>`) plays one film at its own pixel size
  in an iframe; the studio owns time and sends `studio:seek` on every frame
  (the message contract is in `src/lib/studio/contract.ts`). Under the hood:
  an HTML film runs as it is, with `window.__film` and `window.__params` set
  before its scripts and its timeline seeked; a React film runs in the
  Remotion Player (bundled by esbuild in well under a second, rebuilt when
  its code changes); a Rust film plays its draft video, which the stage asks
  for whenever the film has changed since the last one. Pointing mode picks
  the element under the pointer (an id or `data-hf-id` in HTML, a
  `data-part` in React) for the chat.
- **Rendering**: `node scripts/studio/render.mjs --film <id> [--draft]` (the
  studio queues them, one at a time, in `src/lib/studio/render.ts`). A
  draft writes `films/<id>/out/draft.mp4` at the film's own size; a final
  writes `4k.mp4` (twice its size) and `1080p.mp4` (its own size). Both make
  `poster.png` at the film's "Cover" mark. For a final, each engine hands
  over lossless frames at twice the film's size and one ffmpeg makes both
  files from them (H.264, BT.709, limited range, 4:2:0; the 1080p file is
  the same frames at half size). HTML films use HyperFrames' renderer, or
  our own Chrome capture at twice the size for shapes it has no 4K preset
  for (4:5); React films use Remotion's renderer; Rust films build into
  one shared folder, `node_modules/.cache/studio-cargo`, so only the first
  build is slow.

### How renders stay crisp

- A final is drawn once, at twice the film's size. The 4K file is those
  frames as they are; the 1080p file is the same frames shrunk to half
  with the lanczos filter, which keeps small type and hairlines sharper
  than averaging. Nothing is drawn twice or scaled twice, so the two files
  always match.
- Colour is tagged BT.709, limited range, 4:2:0, so the orange plays back
  the same in QuickTime, browsers and social apps.
- The 4K file is encoded at quality 90 on Apple's hardware encoder (Apple
  silicon) or x264 slow at CRF 14 (Intel Macs). The 1080p file is x264
  slow at CRF 14, tuned for flat colour and sharp edges. All of these
  measure as visually lossless: on the launch film, 100% crops of small
  type and hairlines sit within 1 dB of the 4:2:0 ceiling.
- Sound is AAC at 320 kb/s, 48 kHz. Files start playing before they have
  fully downloaded (faststart).
- The poster is cut from a lossless frame, not from the video.

### How renders are made fast

`scripts/studio/machine.mjs` looks at each Mac when a render starts: its
cores, its memory, and whether ffmpeg can use Apple's hardware encoder
(VideoToolbox). From that it picks:

- **How many frames Chrome draws at once:** the cores minus two, at most
  8, and only as many as fit in memory after keeping about 6.5 GB for
  macOS, the studio, your browser and Claude (about 0.6 GB a page at 4K,
  0.35 GB at 1080p). So an 8 GB Mac draws a 4K film 2 frames at a time and
  a 16 GB Mac with 10 cores 8 at a time. HyperFrames, Remotion and our own
  4:5 capture all take this number.
- **The encoder:** see above for finals. A draft uses the hardware encoder
  wherever it works; an HTML draft is drawn and encoded in one pass by
  HyperFrames.
- **No repeat work:** each render saves a fingerprint of the film's files,
  settings, footage and sound in `out/render-key.json`. The next render of
  the same kind with the same fingerprint returns at once. If only the
  sound (or its volume) changed, the new sound goes onto the existing
  video in a second or two. A changed sound is rendered while the frames
  are drawn, not after.

`STUDIO_WORKERS` and `STUDIO_ENCODER=x264` override the choice on one Mac
(docs/setup.md). The first line of `out/render-log.txt` says what was
picked.

Measured on an M5 with 16 GB, with other apps running, for the 29 second
1920x1080 60 fps launch film (HTML):

| | Before | Now |
| --- | --- | --- |
| Draft | 48 s | 18 s |
| Final (4K + 1080p) | 150 s | 75 s |
| Either again, nothing changed | the full time | under 1 s |

A 5 second 4:5 HTML film's final went from 23 s to 14 s (its capture now
draws several frames at once).

Set up once per engine (each keeps its own packages; the root is untouched):

```bash
cd studio/remotion && npm install       # Remotion
cd studio/hyperframes && npm install    # HyperFrames, pinned; telemetry is off
```

fframes needs Rust (rustup.rs) and `brew install pkgconf nasm ninja`; its
first build takes about 2.5 minutes. Remotion and HyperFrames render with
Google Chrome.

### Sound design

Every film can have a sound track, composed as code in
`films/<id>/sound/score.js` (the contract is `src/lib/studio/sound.ts`):

- **Music** in [Strudel](https://strudel.cc) (pattern-based live-coding
  music; its synths only, nothing is downloaded) for beds, pulses and
  rhythm.
- **Effects** in [Tone.js](https://tonejs.github.io) at exact film times,
  for hits on the film's moments: air arriving from the right with a
  colour, a tick as a line lands, one bright note when orange lands.

`node scripts/studio/sound.mjs <id>` plays the score in headless Chrome
into offline audio contexts (never to speakers), so a 5 second film's sound
renders in 1 to 3 seconds. It writes `sound/sound.wav` (48 kHz stereo,
exactly the film's length, about -16 LUFS with peaks under -1.5 dBTP),
`peaks.json` and `status.json`, then prints what it hears: loudness, and
each onset with the film moment it lands on (Claude reads this to check its
work). `--check` renders twice and fails if the score isn't repeatable.

The studio renders a film's sound when it is made, after a Claude turn that
changed it, and a moment after its length, values or (for a video film) its
edit change; it waits its turn with video renders (one heavy job at a time,
`src/lib/studio/heavy.ts`). Every render mixes the sound in at the film's
`sound.volume`; in a video film it goes under the footage's own sound, and
its music dips under speech by itself. Starters come with a score; the
**aerchain-sound-design** skill teaches Claude the Aerchain sonic language.

Set up once: `npm ci --prefix studio/sound`. Licences: Strudel is
**AGPL-3.0**, fine for this in-house tool; offering the studio to people
outside Aerchain as a hosted service would oblige publishing its source.
Tone.js is MIT. The rendered audio is ours to use anywhere.

The first experiments are still here: `studio/compositions.json` lists the
same 4 second "Aerchain bands" film made in each engine, rendered with
`node scripts/studio/render.mjs <id> [--draft]` into `studio/out/`.

The studio's chat gets the engines' own skills, installed in `.claude/skills`:
Remotion's (`remotion-dev/skills`), HyperFrames' (`heygen-com/hyperframes`),
fframes' (`fframes.studio`), GSAP's (`greensock/gsap-skills`, for films made
before Motion) and LottieFiles' motion design principles
(`lottiefiles/motion-design-skill`). Each skill that used to point at GSAP
starts with an "In Motion Studio" note saying to write Motion instead; a
skills update overwrites those notes, so put them back after one.
