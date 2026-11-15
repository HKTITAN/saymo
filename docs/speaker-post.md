# The sample speaker post

An animated speaker post in black, orange and stone: the headline and speaker
on stone at the left, and on the right a field of scanlines that moves behind
a landmark, filled with sample words.

## See it

```bash
npm run dev
```

Then open http://localhost:3200/post. The India Gate stands across the foot of
the line panel, and the lines move in the sky behind it.

The panel moves between black, orange and stone in stepped wipes: an orange
staircase rises, stone sweeps down from the top, an orange pixel circle bursts
out of the right edge, then black slides back in from the middle. The wordmark
changes colour line by line as each wipe passes behind it, and its orange "o"
turns over. Each change sets off on an even 1.5 second beat and rests about a
third of a second before the next, the loop point included, so the loop runs as
one steady pulse.

Space pauses. Where the landmark stands is `skyline.place` in
`src/content/post.ts`: it moves sideways, lifts (below zero it sinks) and scales
from its foot. **Download 4K** at the end of the toolbar saves the post as a
3840 x 2160 video (it serves the file made by `npm run export`, so export
first).

## Export

```bash
npm run export
```

That exports Scenes; name others to export them too (`npm run export --
burst tide signal`, or `all`). Files land in `export/`, each in 4K and in
1080p:

- `speaker-post-<name>-4k.png` and `speaker-post-<name>.png`: the still (the
  rising staircase), 3840 x 2160 and 1920 x 1080
- `speaker-post-<name>-scenes-4k.mp4` and `speaker-post-<name>-scenes.mp4`:
  3840 x 2160 and 1920 x 1080, 60 fps, the loop played twice, opening on the
  still frame so the thumbnail is the design

Every frame is rendered one by one at 4K, so the videos are smooth and loop
cleanly; the 1080p files are the same frames at half size. A full export takes
about ten minutes and uses Google Chrome.

## Make your own post

1. Make the square photo tile (the numbers are the crop's left, top and size in
   the original photo's pixels):
   ```bash
   node scripts/post/photo.mjs ~/Pictures/jane-doe.png jane-doe 20 10 330
   ```
2. Put the landmark in `assets/places/` and cut it out. A PNG that is already
   cut out on a transparent background keeps its own edges; any other photo
   needs a flat, single-colour sky, read from its top-left corner. The numbers
   are where the tallest point sits (540 is halfway down the post), then the
   part of the image to keep: its left, right and bottom edges in the image's
   own pixels:
   ```bash
   node scripts/post/skyline.mjs assets/places/kuala-lumpur-skyline.png kuala-lumpur 65 18 767 860
   ```
3. Edit `src/content/post.ts`: headline lines, name, role, company, photo,
   the event's date and location (with the words to set in orange), the
   landmark's name and files, and the slug used for file names.
4. `npm run export`.

## Where things are

- `src/content/post.ts`: the words, the photo and the landmark
- `src/components/post/post.tsx`: layout of the post
- `src/components/post/lines.ts`: the scanlines, their motion and the wordmark
  animation. Scenes reads as a storyboard: its times in `SCENE_TIMING`, the two
  looks in `SCENE_LOOKS`; Burst, Tide and Signal follow it
- `src/components/post/palette.ts`: black, orange and stone
- `src/components/post/wordmark-paths.ts`: the wordmark, drawn from Bricolage
  Grotesque by `scripts/post/wordmark.py`
- `src/app/download/[motion]/route.ts`: hands the 4K video to the Download 4K
  button
- `scripts/post/export.mjs`, `scripts/post/photo.mjs`, `scripts/post/skyline.mjs`: export,
  speaker photo, landmark cut-out
- `assets/places/`: the landmark images
