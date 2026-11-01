# Aerchain speaker post

An animated speaker post in black, orange and stone: the headline and speaker on
stone at the left, and on the right a field of scanlines that moves behind the
Kuala Lumpur skyline.
Built for Darshan Kadam's SpendOS talk; set up so the next speaker is a quick swap.

## See it

```bash
npm run dev
```

Then open http://localhost:3200. The Kuala Lumpur skyline, the Petronas Towers
at its centre, stands across the foot of the line panel, and the lines move in
the sky behind it.

The motion follows the Solvd reference video. The panel moves between black,
orange and stone in stepped wipes: an orange staircase rises, stone sweeps down
from the top, an orange pixel circle bursts out of the right edge, then black
slides back in from the middle. The logo changes colour line by line as each
wipe passes behind it, and the orange "ai" flips. Each change sets off on an
even 1.5 second beat and rests about a third of a second before the next, the
loop point included, so the loop runs as one steady pulse. The bands ease into
the left edge instead of stopping dead, and the circle is a true pixel circle
that springs out, overshoots and settles. **Before** at the top right (or B)
shows the motion exactly as measured from the reference, and **After** brings
the post's own timing back.

## Make a post in the tool

Open http://localhost:3200/tool. Every post made there is listed with a live
thumbnail; **New post** starts the next speaker for the same event (headline,
date, place and landmark kept, speaker cleared), and each card's menu
duplicates or deletes it. Open a post to edit it:

- **Animation**: pick one of four (or press 1 to 4). Each tile plays when the
  pointer is over it, and the post's preview and video use the one picked.
  1 **Scenes** is the original post's animation; 2 **Burst** makes every
  change of colour the stepped circle; 3 **Tide** is calm and orange only, a
  staircase that rolls in, breathes and rolls out; 4 **Signal** thinks,
  decides and acts: lines search, settle into steps, then fire across.
- **Headline**: one line per row. A line too long for the stone panel
  shrinks the whole headline to fit.
- **Speaker**: drop in any photo. The face is framed as on the original
  post and the background is made the same plain grey (switch that off to
  keep the photo's own). Drag the square or zoom to change the crop.
- **Date and time**: pick the dates and time, and the two lines are written
  with the right weekdays; you can still type over them.
- **Location**: two lines. Under them, each of their words is a button: tap
  the ones to set in orange on the post, like the city.
- **Landmark**: type a city or a landmark under **Make one with AI** ("Dubai")
  and it is made in the same black and white style as the towers, cut out and
  ready, in about 20 seconds; every try is kept under **Earlier tries** to
  switch back to. Or drop in a photo of the place: its background is removed
  with the Mac's own background remover (the one behind Finder's Remove
  Background), and a PNG that is already cut out keeps its own edges. Place
  it with the sliders, or drag it in the preview and pinch to resize.

Everything saves as you type. **Make 4K video** renders the post exactly as
`npm run export` does (about 4 minutes), then **Download** offers the video
and the still, each in 4K and 1080p. Anything that still does not fit, like
a location line running into the line panel, is listed under the preview.

Making landmarks with AI goes through Vercel's AI Gateway with Google's
Nano Banana 2.1 model (`src/lib/tool/generate.ts`): the original towers go
along as the style example on a magenta screen, and the answer comes back on
the same screen, which is keyed out. It needs `AI_GATEWAY_API_KEY` in
`.env.local` (git ignores it; this Mac's key, "Speaker post tool (local)",
is capped at $5 a month) and a card on the Vercel account, which unlocks
Vercel's free monthly AI credit. Each picture costs about 4 cents. To make a
new key: `vercel ai-gateway api-keys create --limit 5 --refresh-period monthly`.

The original post below is untouched by the tool: the tool starts with a
copy of it. Posts live in `posts/<id>/` (the words in `post.json`, plus the
photos, image and videos), which git ignores; deleting the folder starts
the tool afresh. The background remover is compiled from
`scripts/vision.swift` the first time it is needed, which takes a moment.

## The original post

Space pauses. Where the skyline stands is `skyline.place` in
`src/content/post.ts`: it moves sideways, lifts (below zero it sinks) and
scales from its foot, and past a scale of 1.00 the image is enlarged beyond its
own pixels and softens in 4K. **Download 4K** at the end of the toolbar saves
the post as a 3840 x 2160 video (it serves the file made by `npm run export`,
so export first).

## Export

```bash
npm run export
```

That exports Scenes; name others to export them too (`npm run export --
burst tide signal`, or `all`). Files land in `export/`, each in 4K and in
1080p.

- `aerchain-speaker-<name>-4k.png` and `aerchain-speaker-<name>.png`: the still
  (the rising staircase), 3840 x 2160 and 1920 x 1080
- `aerchain-speaker-<name>-scenes-4k.mp4` and `aerchain-speaker-<name>-scenes.mp4`:
  3840 x 2160 and 1920 x 1080, 60 fps, the loop played twice, opening on the
  still frame so the thumbnail is the design

Every frame is rendered one by one at 4K, so the videos are smooth and loop
cleanly; the 1080p files are the same frames at half size. A full export takes
about ten minutes. It uses Google Chrome, which is already on this Mac.

## Make the next speaker post by hand

The tool does all of this without the command line. By hand:

1. Put the photo in `assets/speakers/`.
2. Make the square tile (numbers are the crop's left, top and size in the
   original photo's pixels):
   ```bash
   node scripts/photo.mjs assets/speakers/jane-doe.png jane-doe 20 10 330
   ```
3. Put the landmark in `assets/places/` and cut it out. A PNG that is already
   cut out on a transparent background keeps its own edges; any other photo
   needs a flat, single-colour sky, read from its top-left corner. The numbers
   are where the tallest point sits (540 is halfway down the post), then the
   part of the image to keep: its left, right and bottom edges in the image's
   own pixels. Kuala Lumpur was made with:
   ```bash
   node scripts/skyline.mjs assets/places/kuala-lumpur-skyline.png kuala-lumpur 65 18 767 860
   ```
   Where the image meets the bottom and sides of the panel, crop just inside
   its soft outer edge, so the lines never show through beneath it. The bigger
   the image, the sharper it is in 4K.
4. Edit `src/content/post.ts`: headline lines, name, role, company, photo
   paths, the event's date and location (with the words to set in orange),
   the landmark's name and files, and the slug used for file names.
5. `npm run export`.

## Where things are

- `src/content/post.ts`: the words, the photo and the landmark
- `src/components/post/post.tsx`: layout of the post
- `src/components/post/lines.ts`: the scanlines, their motion and the logo animation.
  Scenes reads as a storyboard: its times in `SCENE_TIMING`, the two looks in `SCENE_LOOKS`;
  Burst, Tide and Signal follow it, each with its own storyboard
- `src/components/post/palette.ts`: black, orange and stone
- `src/components/post/wordmark-paths.ts`: the Aerchain wordmark (from `assets/brand/aerchain-wordmark.svg`)
- `src/app/download/[motion]/route.ts`: hands the 4K video to the Download 4K button
- `src/components/tool/`: the tool's screens; `src/app/api/posts/`: its saving, uploads and exports
- `src/lib/tool/`: how tool posts are stored, their photo and landmark treatments, and the export queue
- `scripts/export.mjs`, `scripts/photo.mjs`, `scripts/skyline.mjs`: export, speaker photo, landmark cut-out
  (`npm run export -- --post <id>` exports a tool post; the tool runs it for you)
- `scripts/vision.swift`: background removal and face finding for the tool
- `assets/places/`: the landmark image
- `assets/reference/`: the line texture, the layout reference and the reference video

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
| `html`: `index.html`, a paused GSAP timeline at `window.__timelines.main` | [HyperFrames](https://hyperframes.heygen.com) 0.8.227 (`studio/hyperframes`) | Most films: instant to preview, any web type, CSS and SVG, and the one Claude writes best. The default | Apache 2.0, free |
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
  `poster.png` at the film's "Cover" mark. Each engine hands over lossless
  frames and one ffmpeg encodes them exactly as `npm run export` does
  (H.264, tagged BT.709, the small copy being the big frames at half size).
  HTML films use HyperFrames' renderer, or a Chrome capture at twice the
  size for shapes it has no 4K preset for (4:5); React films use Remotion's
  renderer; Rust films build into one shared folder,
  `node_modules/.cache/studio-cargo`, so only the first build is slow.

Typical times on this Mac for a 5 second 1920x1080 film:

| | HTML | React | Rust |
| --- | --- | --- | --- |
| Stage ready | under 1 s | under 1 s | 10 to 20 s (its draft) |
| Draft | 8 s | 19 to 22 s | 10 s |
| Final (4K + 1080p) | 15 s | 56 s | 22 s |

Set up once per engine (each keeps its own packages; the root is untouched):

```bash
cd studio/remotion && npm install       # Remotion
cd studio/hyperframes && npm install    # HyperFrames, pinned; telemetry is off
```

fframes needs Rust (rustup.rs) and `brew install pkgconf nasm ninja`; its
first build takes about 2.5 minutes. Remotion and HyperFrames render with
Google Chrome.

The first experiments are still here: `studio/compositions.json` lists the
same 4 second "Aerchain bands" film made in each engine, rendered with
`node scripts/studio/render.mjs <id> [--draft]` into `studio/out/`.

The studio's chat gets the engines' own skills, installed in `.claude/skills`:
Remotion's (`remotion-dev/skills`), HyperFrames' (`heygen-com/hyperframes`),
fframes' (`fframes.studio`), GSAP's (`greensock/gsap-skills`) and
LottieFiles' motion design principles (`lottiefiles/motion-design-skill`).
