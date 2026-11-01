# The speaker post

An animated speaker post in black, orange and stone: the headline and speaker on stone at the left, and on the right a field of scanlines that moves behind the Kuala Lumpur skyline. Built for Darshan Kadam's SpendOS talk; set up so the next speaker is a quick swap.

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
